# -*- coding: utf-8 -*-
"""
Генерация NFT коллекции PIXEL ORIGINS.

Слои (снизу вверх): Background (GIF) → Character (PNG) → Frame (GIF)

  python generate_nft.py --metadata --all          # только JSON (без картинок)
  python generate_nft.py --metadata --all --gif    # JSON + GIF
  python generate_nft.py --recompose --gif --all # только GIF по готовым metadata
  python generate_nft.py --recompose --gif --all --skip-existing --workers 4  # resume + parallel

Зависимости:
  pip install Pillow
  ffmpeg (опционально, для MP4)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

try:
    from PIL import Image, ImageSequence
except ImportError:
    Image = None  # type: ignore

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def resolve_folder(primary: Path, fallbacks: list[str]) -> Path:
    if primary.exists():
        return primary
    parent = primary.parent
    for name in fallbacks:
        p = parent / name
        if p.exists():
            return p
    return primary


def find_asset(folder: Path, name: str, extensions: tuple[str, ...]) -> Path | None:
    for ext in extensions:
        p = folder / f"{name}{ext}"
        if p.exists():
            return p
    target = name.lower()
    if folder.exists():
        for f in folder.iterdir():
            if f.is_file() and f.suffix.lower() in extensions and f.stem.lower() == target:
                return f
    return None


def weighted_pick(pool: dict[str, dict], rng) -> str:
    items = [(k, v) for k, v in pool.items() if int(v.get("weight", 0)) > 0]
    if not items:
        raise SystemExit("Empty trait pool for weighted pick")
    keys = [k for k, _ in items]
    weights = [int(v["weight"]) for _, v in items]
    return rng.choices(keys, weights=weights, k=1)[0]


def build_one_of_one_map(edition_size: int, cfg: dict, rng) -> dict[int, str]:
    """edition number -> unique character (each appears exactly once)."""
    names: list[str] = list(cfg.get("oneOfOneCharacters", []))
    if not names:
        return {}
    if edition_size < len(names):
        raise SystemExit(
            f"editionSize {edition_size} < oneOfOneCharacters {len(names)}"
        )
    editions = rng.sample(range(1, edition_size + 1), len(names))
    rng.shuffle(names)
    return {e: names[i] for i, e in enumerate(sorted(editions))}


def regular_character_pool(char_traits: dict, cfg: dict) -> dict[str, dict]:
    oo = set(cfg.get("oneOfOneCharacters", []))
    return {
        k: v for k, v in char_traits.items()
        if k not in oo and not v.get("one_of_one") and int(v.get("weight", 0)) > 0
    }


def allocate_character_counts(
    char_pool: dict[str, dict],
    total_editions: int,
    min_count: int,
    rng,
    cfg: dict,
) -> dict[str, int]:
    """Tier-based allocation with per-character score + jitter for natural spread."""
    if not char_pool:
        raise SystemExit("Empty regular character pool")
    if total_editions < len(char_pool) * min_count:
        raise SystemExit(
            f"Not enough editions ({total_editions}) for min {min_count} "
            f"x {len(char_pool)} characters"
        )

    tier_ranges: dict[str, list[int]] = cfg.get("characterCountRanges", {
        "Mythic": [2, 5],
        "Legendary": [3, 9],
        "Epic": [5, 14],
        "Rare": [8, 22],
        "Uncommon": [12, 32],
        "Common": [10, 36],
    })

    by_tier: dict[str, list[str]] = {}
    for name, data in char_pool.items():
        tier = data.get("tier", "Common")
        by_tier.setdefault(tier, []).append(name)

    raw: dict[str, float] = {}
    for tier, names in by_tier.items():
        lo, hi = tier_ranges.get(tier, [min_count, min_count + 8])
        lo = max(min_count, lo)
        hi = max(lo, hi)
        scores = [int(char_pool[n].get("score", 1)) for n in names]
        min_s, max_s = min(scores), max(scores)
        span = max_s - min_s

        for name in names:
            score = int(char_pool[name].get("score", 1))
            if span > 0:
                rank = (score - min_s) / span
            else:
                rank = 0.5
            rank = max(0.0, min(1.0, rank + rng.uniform(-0.22, 0.22)))
            raw[name] = lo + (hi - lo) * rank

    scale = total_editions / sum(raw.values())
    counts = {name: max(min_count, int(value * scale)) for name, value in raw.items()}

    assigned = sum(counts.values())
    fracs = sorted(
        ((name, value * scale - int(value * scale)) for name, value in raw.items()),
        key=lambda item: item[1],
        reverse=True,
    )

    idx = 0
    while assigned < total_editions:
        name = fracs[idx % len(fracs)][0]
        counts[name] += 1
        assigned += 1
        idx += 1

    idx = 0
    trim_order = sorted(
        counts.keys(),
        key=lambda n: (raw[n], n),
    )
    while assigned > total_editions:
        name = trim_order[idx % len(trim_order)]
        if counts[name] > min_count:
            counts[name] -= 1
            assigned -= 1
        idx += 1
        if idx > len(trim_order) * (max(counts.values()) + 5):
            raise SystemExit("Could not balance character counts to edition total")

    return counts


def build_character_deck(counts: dict[str, int], rng) -> list[str]:
    deck: list[str] = []
    for name in sorted(counts.keys()):
        deck.extend([name] * counts[name])
    rng.shuffle(deck)
    return deck


def make_dna(trait_values: dict[str, str]) -> str:
    raw = "-".join(f"{k}:{v}" for k, v in sorted(trait_values.items()))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def image_url(cfg: dict, edition: int) -> str:
    ext = str(cfg.get("imageFormat", "gif")).lstrip(".")
    return f"{cfg['imageBaseUrl']}/{edition}.{ext}"


def animation_url(cfg: dict, edition: int) -> str:
    """OpenSea token page — тот же GIF, что и image (hover + страница токена)."""
    if cfg.get("animationUseSameAsImage", True):
        return image_url(cfg, edition)
    ext = str(cfg.get("animationFormat", cfg.get("imageFormat", "gif"))).lstrip(".")
    base = cfg.get("animationBaseUrl", cfg["imageBaseUrl"])
    return f"{base}/{edition}.{ext}"


def ensure_traits(cfg: dict) -> Path:
    traits_dir = (ROOT / cfg["paths"]["traits"]).resolve()
    required = [
        traits_dir / "character_traits.json",
        traits_dir / "background_traits.json",
        traits_dir / "frame_traits.json",
    ]
    if any(not p.exists() for p in required):
        print("Traits not found — running assign_rarity.py ...")
        import assign_rarity
        assign_rarity.main()
    return traits_dir


def resize_rgba(img: Image.Image, size: int) -> Image.Image:
    if img.size != (size, size):
        return img.resize((size, size), Image.Resampling.LANCZOS)
    return img


def progress(iterable, total: int, label: str, enabled: bool = True):
    if not enabled:
        return iterable
    try:
        from tqdm import tqdm
        return tqdm(iterable, total=total, desc=label, unit="nft", mininterval=0.5)
    except ImportError:
        return iterable


def log(msg: str, verbose: bool = True) -> None:
    if verbose:
        print(msg, flush=True)


def atomic_replace(tmp: Path, final: Path) -> None:
    """Windows-safe: finished file only appears when write is complete."""
    final.parent.mkdir(parents=True, exist_ok=True)
    os.replace(tmp, final)


def output_ready(path: Path, min_bytes: int = 512) -> bool:
    try:
        return path.is_file() and path.stat().st_size >= min_bytes
    except OSError:
        return False


# ---------------------------------------------------------------------------
# metadata
# ---------------------------------------------------------------------------

def build_attributes(
    bg: str,
    character: str,
    frame: str,
    cfg: dict,
    is_one_of_one: bool = False,
) -> list[dict]:
    attrs = [
        {"trait_type": "Background", "value": bg},
        {"trait_type": "Character", "value": character},
        {"trait_type": "Frame", "value": frame},
    ]
    if not is_one_of_one:
        stage = cfg.get("stageTrait", {"trait_type": "Stage_1", "value": "1"})
        attrs.append({
            "trait_type": stage.get("trait_type", "Stage_1"),
            "value": str(stage.get("value", "1")),
        })
    else:
        for trait in cfg.get("oneOfOneTraits", [
            {"trait_type": "Edition", "value": "1_of_1"},
            {"trait_type": "Tier", "value": "Legendary"},
        ]):
            attrs.append(dict(trait))
    return attrs


def generate_metadata_pool(
    edition_size: int,
    cfg: dict,
    char_traits: dict,
    bg_traits: dict,
    frame_traits: dict,
    seed: int,
) -> list[dict]:
    import random
    rng = random.Random(seed)
    dna_set: set[str] = set()
    pool: list[dict] = []

    oo_map = build_one_of_one_map(edition_size, cfg, rng)
    char_pool = regular_character_pool(char_traits, cfg)

    missing_oo = [n for n in cfg.get("oneOfOneCharacters", []) if n not in char_traits]
    if missing_oo:
        raise SystemExit(f"1/1 characters missing in traits: {', '.join(missing_oo)}")

    min_count = max(2, int(cfg.get("minCharacterCount", 2)))
    regular_slots = edition_size - len(oo_map)
    char_counts = allocate_character_counts(char_pool, regular_slots, min_count, rng, cfg)
    char_deck = build_character_deck(char_counts, rng)
    deck_idx = 0

    count_values = list(char_counts.values())
    print(f"1/1 characters: {len(oo_map)} (editions assigned at random)")
    print(
        f"Regular character pool: {len(char_pool)} "
        f"(min {min_count}, total {regular_slots}, "
        f"counts {min(count_values)}–{max(count_values)}, "
        f"avg {sum(count_values)/len(count_values):.1f})"
    )

    for edition in range(1, edition_size + 1):
        if edition in oo_map:
            character = oo_map[edition]
        else:
            if deck_idx >= len(char_deck):
                raise SystemExit("Character deck exhausted — allocation mismatch")
            character = char_deck[deck_idx]
            deck_idx += 1

        for attempt in range(3000):
            bg = weighted_pick(bg_traits, rng)
            frame = weighted_pick(frame_traits, rng)
            traits = {"Background": bg, "Character": character, "Frame": frame}
            dna = make_dna(traits)
            if dna not in dna_set:
                dna_set.add(dna)
                break
        else:
            raise SystemExit(f"Unique DNA not found for edition {edition}")

        meta = {
            "name": f"{cfg['namePrefix']} #{edition}",
            "description": cfg["description"],
            "image": image_url(cfg, edition),
            "dna": dna,
            "edition": edition,
            "date": int(time.time() * 1000),
            "attributes": build_attributes(
                bg, character, frame, cfg, is_one_of_one=edition in oo_map
            ),
            "compiler": cfg.get("compiler", "Pixel Collection Engine"),
            "animation_url": animation_url(cfg, edition),
            "_traits": traits,
            "_one_of_one": edition in oo_map,
        }
        pool.append(meta)
    return pool, char_counts


def write_metadata_files(pool: list[dict], meta_dir: Path) -> None:
    meta_dir.mkdir(parents=True, exist_ok=True)
    for meta in pool:
        edition = meta["edition"]
        out = {k: v for k, v in meta.items() if not k.startswith("_")}
        (meta_dir / str(edition)).write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def write_summary(
    pool: list[dict],
    build_dir: Path,
    cfg: dict,
    char_allocation: dict[str, int] | None = None,
) -> None:
    summary = {
        "editionSize": len(pool),
        "layers": cfg["layersOrder"],
        "oneOfOneCharacters": cfg.get("oneOfOneCharacters", []),
        "oneOfOneEditions": {},
        "characterAllocation": char_allocation or {},
        "backgroundCounts": {},
        "characterCounts": {},
        "frameCounts": {},
    }
    for meta in pool:
        traits = meta["_traits"]
        edition = meta["edition"]
        char = traits["Character"]
        if meta.get("_one_of_one"):
            summary["oneOfOneEditions"][str(edition)] = char
        summary["backgroundCounts"][traits["Background"]] = (
            summary["backgroundCounts"].get(traits["Background"], 0) + 1
        )
        summary["characterCounts"][char] = (
            summary["characterCounts"].get(char, 0) + 1
        )
        summary["frameCounts"][traits["Frame"]] = (
            summary["frameCounts"].get(traits["Frame"], 0) + 1
        )

    (build_dir / "collection_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (build_dir / "one_of_one_editions.json").write_text(
        json.dumps(summary["oneOfOneEditions"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# GIF / animation helpers
# ---------------------------------------------------------------------------

def gif_frame_count(img: Image.Image, max_scan: int = 512) -> int:
    """Безопасный подсчёт кадров (без бесконечного seek)."""
    n = getattr(img, "n_frames", 1)
    if isinstance(n, int) and 1 < n <= max_scan:
        return n
    count = 0
    try:
        for _ in ImageSequence.Iterator(img):
            count += 1
            if count >= max_scan:
                print(f"[WARN] GIF capped at {max_scan} frames", flush=True)
                break
    except Exception:
        pass
    return max(1, count)


def load_gif_layers(path: Path, size: int, max_frames: int) -> tuple[list[Image.Image], list[int]]:
    """Декодирует GIF один раз в память — быстрее чем seek на каждый кадр."""
    img = Image.open(path)
    n = gif_frame_count(img, max_scan=max_frames)
    if n > max_frames:
        print(f"[WARN] {path.name}: {n} frames -> cap {max_frames}", flush=True)
        n = max_frames

    frames: list[Image.Image] = []
    durations: list[int] = []
    for i in range(n):
        img.seek(i)
        frame = resize_rgba(img.convert("RGBA").copy(), size)
        frames.append(frame)
        d = img.info.get("duration", 100)
        durations.append(int(d) if d and d > 0 else 100)
    img.close()
    return frames, durations


def gif_total_ms(durs: list[int]) -> int:
    return sum(durs) if durs else 100


def time_to_frame_index(elapsed_ms: int, durs: list[int]) -> int:
    total = gif_total_ms(durs)
    if total <= 0:
        return 0
    elapsed_ms = elapsed_ms % total
    acc = 0
    for i, d in enumerate(durs):
        if elapsed_ms < acc + d:
            return i
        acc += d
    return 0


def lcm(a: int, b: int) -> int:
    return abs(a * b) // math.gcd(a, b) if a and b else max(a, b, 1)


def build_animation_timeline(
    n_bg: int,
    bg_durs: list[int],
    n_fr: int,
    fr_durs: list[int],
    master: str,
) -> list[tuple[int, int, int]]:
    """
    Returns list of (bg_index, frame_index, duration_ms).
    master:
      frame  — один полный цикл рамки (фон крутится по времени)
      background — один полный цикл фона
      both   — lcm: оба слоя завершают цикл (может быть очень длинно)
    """
    if master == "background":
        n_out = n_bg
        primary = "bg"
    elif master == "both":
        n_out = lcm(n_bg, n_fr)
        primary = "lcm"
    else:
        n_out = n_fr
        primary = "fr"

    timeline: list[tuple[int, int, int]] = []
    elapsed = 0

    for i in range(n_out):
        if primary == "bg":
            bg_i = i
            fr_i = time_to_frame_index(elapsed, fr_durs)
            dur = bg_durs[bg_i]
        elif primary == "lcm":
            bg_i = i % n_bg
            fr_i = i % n_fr
            dur = fr_durs[fr_i]
        else:
            fr_i = i
            bg_i = time_to_frame_index(elapsed, bg_durs)
            dur = fr_durs[fr_i]

        timeline.append((bg_i, fr_i, dur))
        elapsed += dur

    return timeline


def normalize_durations(durations: list[int], target_ms: int) -> list[int]:
    """Растягивает/сжимает тайминг пропорционально до target_ms (один цикл рамки)."""
    total = sum(durations)
    if total <= 0 or target_ms <= 0:
        return durations
    if total == target_ms:
        return durations
    scale = target_ms / total
    new = [max(20, int(round(d * scale))) for d in durations]
    diff = target_ms - sum(new)
    if diff != 0:
        new[-1] = max(20, new[-1] + diff)
    return new


def compose_animated(
    bg_path: Path,
    char_path: Path,
    frame_path: Path,
    size: int,
    master: str = "frame",
    max_frames: int = 256,
    target_duration_ms: int | None = None,
    verbose: bool = True,
) -> tuple[list[Image.Image], list[int]]:
    log(f"    load bg: {bg_path.name}", verbose)
    bg_frames, bg_durs = load_gif_layers(bg_path, size, max_frames)
    log(f"    load frame: {frame_path.name} ({len(bg_frames)} bg / loading frame...)", verbose)
    fr_frames, fr_durs = load_gif_layers(frame_path, size, max_frames)
    char = resize_rgba(Image.open(char_path).convert("RGBA"), size)

    n_bg = len(bg_frames)
    n_fr = len(fr_frames)
    timeline = build_animation_timeline(n_bg, bg_durs, n_fr, fr_durs, master)
    log(f"    compose {len(timeline)} frames (bg={n_bg}, frame={n_fr})", verbose)

    frames: list[Image.Image] = []
    durations: list[int] = []

    for bg_i, fr_i, dur in timeline:
        canvas = bg_frames[bg_i].copy()
        canvas = Image.alpha_composite(canvas, char)
        canvas = Image.alpha_composite(canvas, fr_frames[fr_i])
        frames.append(canvas)
        durations.append(dur)

    total_ms = sum(durations)
    if target_duration_ms and target_duration_ms > 0 and total_ms != target_duration_ms:
        durations = normalize_durations(durations, target_duration_ms)
        log(
            f"    duration normalized: {total_ms}ms -> {sum(durations)}ms",
            verbose,
        )
    else:
        log(f"    duration: {total_ms}ms ({len(frames)} frames)", verbose)

    return frames, durations


# ---------------------------------------------------------------------------
# images (static)
# ---------------------------------------------------------------------------

def compose_static_frame(
    bg_path: Path,
    char_path: Path,
    frame_path: Path | None,
    size: int,
) -> Image.Image:
    bg = Image.open(bg_path)
    if getattr(bg, "n_frames", 1) > 1:
        bg.seek(0)
    canvas = resize_rgba(bg.convert("RGBA"), size)
    char = resize_rgba(Image.open(char_path).convert("RGBA"), size)
    canvas = Image.alpha_composite(canvas, char)
    if frame_path:
        fr = Image.open(frame_path)
        if getattr(fr, "n_frames", 1) > 1:
            fr.seek(0)
        canvas = Image.alpha_composite(canvas, resize_rgba(fr.convert("RGBA"), size))
    return canvas


def save_webp_static(img: Image.Image, path: Path, method: int = 4) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    img.save(tmp, "WEBP", quality=90, method=method)
    atomic_replace(tmp, path)


def save_webp_animated(
    frames: list[Image.Image],
    durations: list[int],
    path: Path,
    method: int = 4,
) -> None:
    if not frames:
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    out_frames = [f.convert("RGBA") for f in frames]
    out_frames[0].save(
        tmp,
        save_all=True,
        append_images=out_frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        format="WEBP",
        quality=85,
        method=method,
    )
    atomic_replace(tmp, path)


def save_gif_animated(frames: list[Image.Image], durations: list[int], path: Path) -> None:
    if not frames:
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    out_frames = [f.convert("RGBA") for f in frames]
    out_frames[0].save(
        tmp,
        save_all=True,
        append_images=out_frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        format="GIF",
        optimize=False,
    )
    atomic_replace(tmp, path)


def frames_to_mp4(frames: list[Image.Image], durations: list[int], mp4_path: Path) -> bool:
    """MP4 через PNG-секвенцию + ffmpeg concat (надёжнее чем webp→mp4)."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not frames:
        return False

    mp4_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="pixel_nft_") as td:
        tmp = Path(td)
        lines: list[str] = []
        for i, (frame, dur) in enumerate(zip(frames, durations)):
            fp = tmp / f"frame_{i:05d}.png"
            frame.convert("RGBA").save(fp, "PNG")
            lines.append(f"file '{fp.as_posix()}'")
            lines.append(f"duration {max(dur, 20) / 1000.0:.4f}")
        # concat требует дублировать последний file без duration
        last = tmp / f"frame_{len(frames) - 1:05d}.png"
        lines.append(f"file '{last.as_posix()}'")

        list_file = tmp / "concat.txt"
        list_file.write_text("\n".join(lines), encoding="utf-8")

        cmd = [
            ffmpeg, "-y",
            "-f", "concat", "-safe", "0", "-i", str(list_file),
            "-vsync", "vfr",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(mp4_path),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"[ERR] ffmpeg #{mp4_path.stem}: {r.stderr[-500:]}")
            return False
    return True


def load_metadata_traits(meta_dir: Path, from_edition: int, to_edition: int) -> list[dict]:
    pool: list[dict] = []
    for edition in range(from_edition, to_edition + 1):
        path = meta_dir / str(edition)
        if not path.exists():
            continue
        data = load_json(path)
        traits = {}
        for attr in data.get("attributes", []):
            t = attr.get("trait_type", "")
            if t in ("Background", "Character", "Frame"):
                traits[t] = attr["value"]
        if len(traits) == 3:
            pool.append({"edition": edition, "_traits": traits})
    return pool


def _render_cfg_snapshot(cfg: dict) -> dict:
    return {
        "canvasSize": int(cfg.get("canvasSize", 1024)),
        "animationMaster": cfg.get("animationMaster", "frame"),
        "animationMaxFrames": int(cfg.get("animationMaxFrames", 256)),
        "animationDurationMs": cfg.get("animationDurationMs"),
        "webpMethod": int(cfg.get("webpMethod", 4)),
    }


def render_one_edition(
    meta: dict,
    cfg_snap: dict,
    char_dir: Path,
    bg_dir: Path,
    frame_dir: Path,
    build_dir: Path,
    static: bool,
    animated: bool,
    mp4: bool,
    gif_out: bool,
    skip_existing: bool,
    verbose: bool,
) -> tuple[int, str | None]:
    """Render a single edition. Returns (edition, error_message)."""
    if Image is None:
        return meta["edition"], "Pillow not installed"

    edition = meta["edition"]
    traits = meta["_traits"]
    bg_name = traits["Background"]
    char_name = traits["Character"]
    frame_name = traits["Frame"]

    size = cfg_snap["canvasSize"]
    anim_master = cfg_snap["animationMaster"]
    max_frames = cfg_snap["animationMaxFrames"]
    target_duration_ms = cfg_snap.get("animationDurationMs")
    if target_duration_ms is not None:
        target_duration_ms = int(target_duration_ms)
        if target_duration_ms <= 0:
            target_duration_ms = None
    webp_method = cfg_snap["webpMethod"]

    opensea_gif_dir = build_dir / "images"
    img_webp_dir = build_dir / "images_webp"
    anim_webp_dir = build_dir / "animations_webp"
    anim_mp4_dir = build_dir / "animations"

    gif_path = opensea_gif_dir / f"{edition}.gif"
    if skip_existing and gif_out and output_ready(gif_path):
        log(f"    skip #{edition} (gif exists)", verbose)
        return edition, None
    if skip_existing and static and output_ready(img_webp_dir / f"{edition}.webp"):
        if not (animated or mp4 or gif_out):
            return edition, None

    bg_asset = find_asset(bg_dir, bg_name, (".gif", ".png", ".webp"))
    char_asset = find_asset(char_dir, char_name, (".png",))
    frame_asset = find_asset(frame_dir, frame_name, (".gif", ".png", ".webp"))

    if not bg_asset or not char_asset or not frame_asset:
        return edition, f"missing asset bg={bg_name} char={char_name} frame={frame_name}"

    log(f"  #{edition}  bg={bg_name}  char={char_name}  frame={frame_name}", verbose)

    anim_frames: list[Image.Image] | None = None
    anim_durs: list[int] | None = None

    if static:
        log("    static webp...", verbose)
        img = compose_static_frame(bg_asset, char_asset, frame_asset, size)
        save_webp_static(img, img_webp_dir / f"{edition}.webp", method=webp_method)

    if animated or mp4 or gif_out:
        anim_frames, anim_durs = compose_animated(
            bg_asset, char_asset, frame_asset, size,
            master=anim_master,
            max_frames=max_frames,
            target_duration_ms=target_duration_ms,
            verbose=verbose,
        )
        if animated:
            log(f"    webp anim ({len(anim_frames)} frames)...", verbose)
            save_webp_animated(
                anim_frames, anim_durs,
                anim_webp_dir / f"{edition}.webp",
                method=webp_method,
            )
        if gif_out:
            log("    gif...", verbose)
            save_gif_animated(anim_frames, anim_durs, gif_path)
        if mp4:
            log("    mp4...", verbose)
            ok = frames_to_mp4(anim_frames, anim_durs, anim_mp4_dir / f"{edition}.mp4")
            if not ok:
                return edition, "MP4 encode failed"

    log(f"    done #{edition}", verbose)
    return edition, None


def _render_edition_job(job: dict) -> tuple[int, str | None]:
    return render_one_edition(
        meta=job["meta"],
        cfg_snap=job["cfg_snap"],
        char_dir=Path(job["char_dir"]),
        bg_dir=Path(job["bg_dir"]),
        frame_dir=Path(job["frame_dir"]),
        build_dir=Path(job["build_dir"]),
        static=job["static"],
        animated=job["animated"],
        mp4=job["mp4"],
        gif_out=job["gif_out"],
        skip_existing=job["skip_existing"],
        verbose=job["verbose"],
    )


def render_assets(
    pool: list[dict],
    cfg: dict,
    char_dir: Path,
    bg_dir: Path,
    frame_dir: Path,
    build_dir: Path,
    static: bool,
    animated: bool,
    mp4: bool,
    gif_out: bool,
    from_edition: int,
    to_edition: int,
    verbose: bool = True,
    skip_existing: bool = False,
    workers: int = 1,
) -> None:
    if Image is None:
        raise SystemExit("Install Pillow: pip install Pillow")

    subset = [m for m in pool if from_edition <= m["edition"] <= to_edition]
    total = len(subset)
    cfg_snap = _render_cfg_snapshot(cfg)
    workers = max(1, int(workers))

    if workers > 1 and total > 1:
        log(f"Parallel render: {total} editions, {workers} workers", verbose)
        jobs = [
            {
                "meta": meta,
                "cfg_snap": cfg_snap,
                "char_dir": str(char_dir),
                "bg_dir": str(bg_dir),
                "frame_dir": str(frame_dir),
                "build_dir": str(build_dir),
                "static": static,
                "animated": animated,
                "mp4": mp4,
                "gif_out": gif_out,
                "skip_existing": skip_existing,
                "verbose": False,
            }
            for meta in subset
        ]
        done = 0
        failed: list[str] = []
        t0 = time.time()
        with ProcessPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(_render_edition_job, j): j["meta"]["edition"] for j in jobs}
            for fut in as_completed(futures):
                edition, err = fut.result()
                done += 1
                if err:
                    failed.append(f"#{edition}: {err}")
                    print(f"[WARN] #{edition} {err}", flush=True)
                elif done % 25 == 0 or done == total:
                    elapsed = time.time() - t0
                    rate = done / elapsed if elapsed > 0 else 0
                    print(f"[progress] {done}/{total} ({rate:.1f}/s)", flush=True)
        if failed:
            print(f"[WARN] {len(failed)} edition(s) failed", flush=True)
        return

    for idx, meta in enumerate(subset, start=1):
        edition = meta["edition"]
        log(f"[{idx}/{total}] #{edition}", verbose)
        _, err = render_one_edition(
            meta, cfg_snap, char_dir, bg_dir, frame_dir, build_dir,
            static, animated, mp4, gif_out, skip_existing, verbose,
        )
        if err:
            print(f"[WARN] #{edition} {err}", flush=True)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate PIXEL ORIGINS NFT collection")
    p.add_argument("--metadata", action="store_true", help="Write JSON metadata")
    p.add_argument("--images", action="store_true", help="Render static WebP previews")
    p.add_argument("--animated", action="store_true", help="Render animated WebP")
    p.add_argument("--gif", action="store_true", help="Render animated GIF to build/images (OpenSea hover)")
    p.add_argument("--mp4", action="store_true", help="Render MP4 via ffmpeg (needs ffmpeg)")
    p.add_argument("--recompose", action="store_true", help="Use existing build/metadata (skip trait roll)")
    p.add_argument("--all", action="store_true", help="Use editionSize from config")
    p.add_argument("--size", type=int, default=10, help="Edition count if not --all")
    p.add_argument("--seed", type=int, default=1111)
    p.add_argument("--from", dest="from_edition", type=int, default=1, metavar="N")
    p.add_argument("--to", dest="to_edition", type=int, default=0, metavar="N")
    p.add_argument("--quiet", action="store_true", help="Less console output")
    p.add_argument("--skip-existing", action="store_true", help="Skip editions with valid output GIF already on disk")
    p.add_argument("--workers", type=int, default=1, metavar="N", help="Parallel workers (default 1, try 4 on multi-core PC)")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    # default: metadata only if nothing specified
    if not args.metadata and not args.images and not args.animated and not args.gif and not args.mp4:
        args.metadata = True

    cfg = load_json(CONFIG_PATH)
    traits_dir = ensure_traits(cfg)
    build_dir = (ROOT / cfg["paths"]["build"]).resolve()
    build_dir.mkdir(parents=True, exist_ok=True)

    char_traits = load_json(traits_dir / "character_traits.json")
    bg_traits = load_json(traits_dir / "background_traits.json")
    frame_traits = load_json(traits_dir / "frame_traits.json")

    edition_size = int(cfg["editionSize"]) if args.all else args.size

    char_dir = resolve_folder((ROOT / cfg["paths"]["characters"]).resolve(), ["Characters"])
    bg_dir = resolve_folder((ROOT / cfg["paths"]["backgrounds"]).resolve(), ["Background", "Backgrounds"])
    frame_dir = resolve_folder((ROOT / cfg["paths"]["frames"]).resolve(), ["Frames"])

    to_edition = args.to_edition if args.to_edition > 0 else edition_size

    if args.recompose:
        meta_dir = build_dir / "metadata"
        pool = load_metadata_traits(meta_dir, args.from_edition, to_edition)
        if not pool:
            raise SystemExit(f"No metadata in {meta_dir} for range {args.from_edition}-{to_edition}")
        print(f"Recompose mode: {len(pool)} tokens from metadata")
    else:
        print(f"Edition size: {edition_size}")
        print(f"Background: {bg_dir} ({len(bg_traits)} traits)")
        print(f"Characters: {char_dir} ({len(char_traits)} traits)")
        print(f"Frames:     {frame_dir} ({len(frame_traits)} traits)")
        print(f"Seed: {args.seed}")
        print(f"Animation master: {cfg.get('animationMaster', 'frame')}")
        print()

        pool, char_counts = generate_metadata_pool(
            edition_size, cfg, char_traits, bg_traits, frame_traits, args.seed
        )

    if args.metadata and not args.recompose:
        meta_dir = build_dir / "metadata"
        write_metadata_files(pool, meta_dir)
        write_summary(
            pool,
            build_dir,
            cfg,
            char_allocation=char_counts if not args.recompose else None,
        )
        print(f"[OK] Metadata: {meta_dir} ({edition_size} files, no extension)")
        print(f"[OK] Summary:  {build_dir / 'collection_summary.json'}")
        if not (args.images or args.animated or args.mp4 or args.gif):
            print("(Images skipped — add --gif to render GIF)")

    if args.images or args.animated or args.mp4 or args.gif:
        render_assets(
            pool, cfg, char_dir, bg_dir, frame_dir, build_dir,
            static=args.images,
            animated=args.animated,
            mp4=args.mp4,
            gif_out=args.gif,
            from_edition=args.from_edition,
            to_edition=to_edition,
            verbose=not args.quiet,
            skip_existing=args.skip_existing,
            workers=args.workers,
        )
        if args.gif:
            print(f"[OK] OpenSea GIF: {build_dir / 'images'}  (*.gif → image in metadata)")
        if args.images or args.animated:
            print(f"[OK] WebP images: {build_dir / 'images_webp'}")
        if args.animated:
            print(f"[OK] Anim WebP:   {build_dir / 'animations_webp'}")
        if args.mp4:
            print(f"[OK] MP4:         {build_dir / 'animations'}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
