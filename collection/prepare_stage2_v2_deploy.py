# -*- coding: utf-8 -*-
"""
Stage 2 V2 batch → production deploy pack (GIF + metadata + stage2-variants merge).

  python prepare_stage2_v2_deploy.py
  python prepare_stage2_v2_deploy.py --dry-run
  python prepare_stage2_v2_deploy.py --character Crying_Bling

Steps: copy Stage 2 V2 → Stage_2, sync stage_config, render GIFs, write deploy pack.
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from batch_stage_variants import load_json, save_json, scan_folders, sync_config
from deploy_burn_assets import apply_target, slug_meta, write_json

apply_target("production")
IMG_S2 = "https://pixeltripnft.website/stage2/images"
META_S2 = "https://pixeltripnft.website/stage2/metadata"
from generate_nft import (
    CONFIG_PATH,
    compose_animated,
    ensure_traits,
    find_asset,
    load_json as nft_load_json,
    save_gif_animated,
    weighted_pick,
)
from generate_stage_test import iter_catalog_variants, load_traits_for_stage
from upgrade_stage import (
    asset_dirs_for_stage,
    load_stage_config,
    stage_char_dir,
)

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
V2_DIR = REPO / "Stage 2 V2"
DEPLOY_ROOT = ROOT / "build" / "deploy"
OUT_IMG = DEPLOY_ROOT / "stage2" / "images"
OUT_META = DEPLOY_ROOT / "stage2" / "metadata"
VARIANTS_WEB = REPO / "website" / "src" / "burn" / "stage2-variants.json"
VARIANTS_DEPLOY = DEPLOY_ROOT / "stage2-variants.json"

def discover_v2_characters() -> list[str]:
    if not V2_DIR.is_dir():
        raise SystemExit(f"Missing folder: {V2_DIR}")
    return sorted(
        d.name
        for d in V2_DIR.iterdir()
        if d.is_dir() and any(d.glob("*.png"))
    )


def copy_v2_to_stage2(chars: list[str], dry_run: bool) -> None:
    cfg = load_json(CONFIG_PATH)
    stage2_root = (ROOT / cfg["stagePaths"]["2"]).resolve()
    stage2_root.mkdir(parents=True, exist_ok=True)
    for name in chars:
        src = V2_DIR / name
        dst = stage2_root / name
        if not src.is_dir():
            raise SystemExit(f"Missing source folder: {src}")
        if dry_run:
            print(f"[DRY] copy {src} -> {dst}")
            continue
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
        print(f"[OK] copied {name} -> Stage_2/")


def sync_stage_config(dry_run: bool) -> None:
    rows = scan_folders(2)
    if dry_run:
        print("[DRY] sync stage_config.json from Stage_2 scan")
        return
    rc = sync_config(2, rows, force=False, dry_run=False)
    if rc != 0:
        raise SystemExit("stage_config sync failed")


def render_variant(
    row: dict,
    cfg: dict,
    bg_traits: dict,
    frame_traits: dict,
    bg_dir: Path,
    frame_dir: Path,
    rng: random.Random,
    dry_run: bool,
) -> dict:
    slug = row["slug"]
    bg = weighted_pick(bg_traits, rng)
    frame = weighted_pick(frame_traits, rng)
    stage1 = row["stage1_character"]

    if dry_run:
        print(f"  [DRY] {slug}  bg={bg}  frame={frame}")
        return {"slug": slug, "bg": bg, "frame": frame, "stage1_character": stage1}

    bg_asset = find_asset(bg_dir, bg, (".gif", ".png", ".webp"))
    frame_asset = find_asset(frame_dir, frame, (".gif", ".png", ".webp"))
    if not bg_asset or not frame_asset:
        raise SystemExit(f"[{slug}] missing bg={bg} or frame={frame}")

    size = int(cfg.get("canvasSize", 1024))
    max_frames = int(cfg.get("animationMaxFrames", 256))
    target_ms = cfg.get("animationDurationMs")
    target_ms = int(target_ms) if target_ms and int(target_ms) > 0 else None

    frames, durs = compose_animated(
        bg_asset,
        row["png"],
        frame_asset,
        size,
        master=cfg.get("animationMaster", "frame"),
        max_frames=max_frames,
        target_duration_ms=target_ms,
        verbose=False,
    )

    gif_path = OUT_IMG / f"{slug}.gif"
    save_gif_animated(frames, durs, gif_path)

    meta = slug_meta(slug, bg, frame, 2, cfg, IMG_S2)
    meta["date"] = int(time.time() * 1000)
    (OUT_META / slug).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"  [OK] {slug}  bg={bg}  frame={frame}")
    return {"slug": slug, "bg": bg, "frame": frame, "stage1_character": stage1}


def merge_variants(new_entries: dict[str, list[dict]], dry_run: bool) -> dict:
    base: dict = {}
    for path in (VARIANTS_WEB, VARIANTS_DEPLOY):
        if path.is_file():
            base = load_json(path)
            break

    merged = dict(base)
    for char, variants in new_entries.items():
        merged[char] = variants

    if not dry_run:
        write_json(VARIANTS_DEPLOY, merged)
        write_json(VARIANTS_WEB, merged)
    return merged


def write_file_list(slugs: list[str]) -> Path:
    """Flat list for FTP upload (gif + metadata slug per line, then variants JSON)."""
    path = DEPLOY_ROOT / "STAGE2_V2_BATCH_FILES.txt"
    lines: list[str] = []
    for slug in sorted(slugs):
        lines.append(f"{slug}.gif")
        lines.append(slug)
    lines.append("stage2-variants.json")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def write_upload_readme(chars: list[str], counts: dict[str, int], total: int) -> None:
    lines = [
        "PIXEL TRIP — Stage 2 V2 batch upload",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        "LOCAL PACK:",
        f"  {DEPLOY_ROOT / 'stage2' / 'images'}",
        f"  {DEPLOY_ROOT / 'stage2' / 'metadata'}",
        f"  {VARIANTS_DEPLOY}",
        "",
        "SERVER (production):",
        "  public_html/stage2/images/{Slug}.gif",
        "  public_html/stage2/metadata/{Slug}",
        "  public_html/stage2-variants.json",
        "",
        "WEBSITE (rebuild after variants JSON):",
        "  cd website && npm run build",
        "  upload burn.html + assets/*",
        "",
        "CHARACTERS:",
    ]
    for c in chars:
        lines.append(f"  {c}: {counts.get(c, 0)} variants")
    lines += [
        "",
        f"Total new GIFs: {total}",
        "",
        "BURN: after upload, holders can burn 2x same Stage 1 character -> Stage 2.",
        "OpenSea: Refresh metadata on evolved tokens after sync.",
    ]
    (DEPLOY_ROOT / "STAGE2_V2_UPLOAD.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Deploy Stage 2 V2 character batch")
    p.add_argument(
        "--character",
        action="append",
        dest="characters",
        help="Repeatable; default: all folders in Stage 2 V2 with PNGs",
    )
    p.add_argument("--seed", type=int, default=4242)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--skip-copy", action="store_true", help="Stage_2 folders already copied")
    p.add_argument("--skip-config", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    chars = args.characters or discover_v2_characters()
    if not chars:
        raise SystemExit(f"No character folders with PNGs in {V2_DIR}")

    print("Stage 2 V2 deploy batch")
    print("Characters:", ", ".join(chars))
    if args.dry_run:
        print("Mode: DRY RUN\n")

    if not args.skip_copy:
        copy_v2_to_stage2(chars, args.dry_run)

    if not args.skip_config:
        sync_stage_config(args.dry_run)

    cfg = nft_load_json(CONFIG_PATH)
    stage_cfg = load_stage_config()
    traits_dir = ensure_traits(cfg)
    bg_traits, frame_traits = load_traits_for_stage(traits_dir, 2)
    bg_dir, frame_dir = asset_dirs_for_stage(cfg, 2)
    char_root = stage_char_dir(cfg, 2)
    rng = random.Random(args.seed)

    if not args.dry_run:
        OUT_IMG.mkdir(parents=True, exist_ok=True)
        OUT_META.mkdir(parents=True, exist_ok=True)

    new_catalog: dict[str, list[dict]] = {}
    counts: dict[str, int] = {}
    all_slugs: list[str] = []
    total = 0

    for char in chars:
        catalog = iter_catalog_variants(stage_cfg, 2, char_root, char)
        if not catalog:
            print(f"[WARN] no variants for {char}", file=sys.stderr)
            continue
        print(f"\n{char} ({len(catalog)} variants)")
        entries: list[dict] = []
        for row in catalog:
            entry = render_variant(row, cfg, bg_traits, frame_traits, bg_dir, frame_dir, rng, args.dry_run)
            entries.append({"slug": entry["slug"], "bg": entry["bg"], "frame": entry["frame"]})
            all_slugs.append(entry["slug"])
        new_catalog[char] = entries
        counts[char] = len(entries)
        total += len(entries)

    merged = merge_variants(new_catalog, args.dry_run)
    if not args.dry_run:
        write_upload_readme(chars, counts, total)
        file_list = write_file_list(all_slugs)
        manifest = {
            "generated": datetime.now(timezone.utc).isoformat(),
            "characters": chars,
            "counts": counts,
            "total_variants": total,
        }
        write_json(DEPLOY_ROOT / "stage2_v2_manifest.json", manifest)

    print(f"\n[OK] {total} variants for {len(chars)} characters")
    if not args.dry_run:
        print(f"Deploy pack: {DEPLOY_ROOT / 'stage2'}")
        print(f"Upload guide: {DEPLOY_ROOT / 'STAGE2_V2_UPLOAD.txt'}")
        print(f"FTP file list: {file_list}")
        print(f"stage2-variants.json: {len(merged)} characters total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
