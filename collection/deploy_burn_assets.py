# -*- coding: utf-8 -*-
"""
Deploy Stage 2/3 burn assets — slug-named GIFs + metadata (Test/ layout).

Stage 2: re-pack build/stage2_stage3/ → slug GIFs (no re-render).
Stage 3: render Stage_3 + Background_Stage3 + Frames_Stage3.

  python deploy_burn_assets.py --stage 2
  python deploy_burn_assets.py --stage 3
  python deploy_burn_assets.py --all
  python deploy_burn_assets.py --stage 3 --limit 5

Output:
  build/deploy/Test/stage2/images/{slug}.gif
  build/deploy/Test/stage2/metadata/{slug}
  build/deploy/Test/stage3/images/{slug}.gif
  build/deploy/Test/stage3/metadata/{slug}
  build/deploy/Test/stage2-variants.json
  build/deploy/Test/stage3-variants.json
  build/deploy/Test/UPLOAD.txt
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from generate_nft import (
    CONFIG_PATH,
    compose_animated,
    ensure_traits,
    find_asset,
    load_json,
    save_gif_animated,
    weighted_pick,
)
from upgrade_stage import (
    asset_dirs_for_stage,
    list_variant_pngs,
    load_stage_config,
    load_traits_for_stage,
    stage_char_dir,
    trait_name_for_variant,
)

ROOT = Path(__file__).resolve().parent
S2_MANIFEST = ROOT / "build" / "stage2_stage3" / "manifest.json"
S2_IMAGES = ROOT / "build" / "stage2_stage3" / "images"

URLS = {
    "test": {
        "deploy_root": ROOT / "build" / "deploy" / "Test",
        "img_s2": "https://pixeltripnft.website/Test/stage2/images",
        "img_s3": "https://pixeltripnft.website/Test/stage3/images",
        "meta_s2": "https://pixeltripnft.website/Test/stage2/metadata",
        "meta_s3": "https://pixeltripnft.website/Test/stage3/metadata",
    },
    "production": {
        "deploy_root": ROOT / "build" / "deploy",
        "img_s2": "https://pixeltripnft.website/stage2/images",
        "img_s3": "https://pixeltripnft.website/stage3/images",
        "meta_s2": "https://pixeltripnft.website/stage2/metadata",
        "meta_s3": "https://pixeltripnft.website/stage3/metadata",
    },
}

DEPLOY_ROOT = URLS["test"]["deploy_root"]
IMG_S2 = URLS["test"]["img_s2"]
IMG_S3 = URLS["test"]["img_s3"]
META_S2 = URLS["test"]["meta_s2"]
META_S3 = URLS["test"]["meta_s3"]


def ensure_stage3_slug(slug: str) -> str:
    """Stage 3 GIFs and metadata files always use the Full_* prefix."""
    return slug if slug.startswith("Full_") else f"Full_{slug}"


def apply_target(target: str) -> None:
    global DEPLOY_ROOT, IMG_S2, IMG_S3, META_S2, META_S3
    t = URLS[target]
    DEPLOY_ROOT = t["deploy_root"]
    IMG_S2 = t["img_s2"]
    IMG_S3 = t["img_s3"]
    META_S2 = t["meta_s2"]
    META_S3 = t["meta_s3"]


def slug_meta(
    slug: str,
    bg: str,
    frame: str,
    stage: int,
    cfg: dict,
    img_base: str,
) -> dict:
    label = slug.replace("_", " ")
    stage_desc = (
        "Reached Stage 2 through the burn-to-evolve journey."
        if stage == 2
        else "A fully ascended tripper. Reached Stage 3 through the burn-to-evolve journey."
    )
    img = f"{img_base.rstrip('/')}/{slug}.gif"
    return {
        "name": f"{cfg.get('namePrefix', 'PIXEL TRIP')} — {label}",
        "description": f"{cfg['description']} {stage_desc}",
        "image": img,
        "animation_url": img,
        "external_url": "https://pixeltripnft.website",
        "attributes": [
            {"trait_type": "Background", "value": bg},
            {"trait_type": "Character", "value": slug},
            {"trait_type": "Frame", "value": frame},
            {"trait_type": "Stage", "value": str(stage)},
        ],
        "compiler": cfg.get("compiler", "Pixel Collection Engine"),
    }


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def deploy_stage2(cfg: dict) -> tuple[dict, list[dict]]:
    if not S2_MANIFEST.exists():
        raise SystemExit(f"Missing {S2_MANIFEST} — run: python generate_stage2_stage3.py")

    manifest = load_json(S2_MANIFEST)
    items: list[dict] = manifest.get("items") or []
    if not items:
        raise SystemExit("Stage 2 manifest is empty")

    out_img = DEPLOY_ROOT / "stage2" / "images"
    out_meta = DEPLOY_ROOT / "stage2" / "metadata"
    out_img.mkdir(parents=True, exist_ok=True)
    out_meta.mkdir(parents=True, exist_ok=True)

    variants_by_char: dict[str, list[dict]] = defaultdict(list)
    deployed: list[dict] = []

    for row in items:
        slug = row["character"]
        bg = row["background"]
        frame = row["frame"]
        stage1 = row["stage1_character"]
        edition = row["edition"]
        src = Path(row.get("gif") or S2_IMAGES / f"{edition}.gif")
        if not src.is_file():
            src = S2_IMAGES / f"{edition}.gif"
        if not src.is_file():
            raise SystemExit(f"Missing GIF for {slug}: {src}")

        dst = out_img / f"{slug}.gif"
        shutil.copy2(src, dst)

        meta = slug_meta(slug, bg, frame, 2, cfg, IMG_S2)
        (out_meta / slug).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        entry = {"slug": slug, "bg": bg, "frame": frame}
        variants_by_char[stage1].append(entry)
        deployed.append({**entry, "stage1_character": stage1})

    # dedupe variants per character (same slug)
    catalog: dict[str, list[dict]] = {}
    for char, rows in sorted(variants_by_char.items()):
        seen: set[str] = set()
        uniq: list[dict] = []
        for r in rows:
            if r["slug"] in seen:
                continue
            seen.add(r["slug"])
            uniq.append(r)
        catalog[char] = uniq

    write_json(DEPLOY_ROOT / "stage2-variants.json", catalog)
    return catalog, deployed


def iter_stage3_variants(stage_cfg: dict, char_root: Path) -> list[dict]:
    block = stage_cfg.get("stages", {}).get("3", {})
    char_map: dict = block.get("characterMap") or {}
    rows: list[dict] = []

    for folder in sorted(d for d in char_root.iterdir() if d.is_dir()):
        entry = char_map.get(folder.name)
        variants_map: dict[str, str] = {}
        if isinstance(entry, dict):
            variants_map = entry.get("variants") or {}

        seen: set[str] = set()
        for png in list_variant_pngs(folder):
            slug = trait_name_for_variant(png.stem, variants_map)
            if slug in seen:
                continue
            seen.add(slug)
            rows.append({
                "stage1_character": folder.name,
                "slug": slug,
                "png": png,
            })
    return rows


def render_stage3_one(
    slug: str,
    char_png: Path,
    bg: str,
    frame: str,
    cfg: dict,
    bg_dir: Path,
    frame_dir: Path,
    out_img: Path,
    out_meta: Path,
) -> dict:
    slug = ensure_stage3_slug(slug)
    bg_asset = find_asset(bg_dir, bg, (".gif", ".png", ".webp"))
    frame_asset = find_asset(frame_dir, frame, (".gif", ".png", ".webp"))
    if not bg_asset or not frame_asset:
        raise FileNotFoundError(f"{slug}: missing bg={bg} or frame={frame}")

    size = int(cfg.get("canvasSize", 1024))
    target_ms = cfg.get("animationDurationMs")
    target_ms = int(target_ms) if target_ms and int(target_ms) > 0 else None

    frames, durs = compose_animated(
        bg_asset,
        char_png,
        frame_asset,
        size,
        master=cfg.get("animationMaster", "frame"),
        max_frames=int(cfg.get("animationMaxFrames", 256)),
        target_duration_ms=target_ms,
        verbose=False,
    )
    gif_path = out_img / f"{slug}.gif"
    save_gif_animated(frames, durs, gif_path)

    meta = slug_meta(slug, bg, frame, 3, cfg, IMG_S3)
    (out_meta / slug).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"slug": slug, "bg": bg, "frame": frame, "gif": str(gif_path)}


def merge_stage3_maps(existing: dict, new_maps: dict) -> dict:
    from_s2 = dict(existing.get("fromStage2Slug") or {})
    from_s2.update(new_maps.get("fromStage2Slug") or {})

    default = dict(existing.get("defaultByChar") or {})
    for key, val in (new_maps.get("defaultByChar") or {}).items():
        default.setdefault(key, val)

    pool = dict(existing.get("poolByChar") or {})
    for key, rows in (new_maps.get("poolByChar") or {}).items():
        merged = list(pool.get(key) or [])
        seen = {r.get("slug") for r in merged}
        for row in rows:
            if row.get("slug") not in seen:
                merged.append(row)
                seen.add(row.get("slug"))
        pool[key] = merged

    closed = set(existing.get("stage3VoteClosedCharacters") or [])
    closed.update(new_maps.get("stage3VoteClosedCharacters") or [])

    out = {
        "fromStage2Slug": from_s2,
        "defaultByChar": default,
        "poolByChar": pool,
    }
    if closed:
        out["stage3VoteClosedCharacters"] = sorted(closed)
    return out


def load_existing_stage3_maps() -> dict:
    for path in (
        DEPLOY_ROOT / "stage3-variants.json",
        ROOT.parent / "website" / "src" / "burn" / "stage3-variants.json",
    ):
        if path.is_file():
            data = load_json(path)
            if isinstance(data, dict) and data.get("fromStage2Slug"):
                return data
    return {"fromStage2Slug": {}, "defaultByChar": {}, "poolByChar": {}}


def resolve_stage3_char_root(cfg: dict, override: str | None) -> Path:
    if override:
        p = (ROOT / override).resolve()
        if not p.is_dir():
            raise SystemExit(f"Stage 3 char root not found: {p}")
        return p
    return stage_char_dir(cfg, 3)


def build_stage3_maps(
    s3_deployed: list[dict],
    s2_catalog: dict[str, list[dict]],
) -> dict:
    s2_slug_set = {v["slug"] for variants in s2_catalog.values() for v in variants}
    from_s2: dict[str, dict] = {}

    pool_by_char: dict[str, list[dict]] = defaultdict(list)

    for row in s3_deployed:
        slug = row["slug"]
        stage1 = row["stage1_character"]
        entry = {"slug": slug, "bg": row["bg"], "frame": row["frame"]}

        if slug.startswith("Full_"):
            s2_guess = slug[len("Full_"):]
            if s2_guess in s2_slug_set:
                from_s2[s2_guess] = entry

        pool_by_char[stage1].append(entry)

    by_char = {k: v[0] for k, v in pool_by_char.items() if len(v) == 1}

    return {
        "fromStage2Slug": from_s2,
        "defaultByChar": by_char,
        "poolByChar": dict(pool_by_char),
    }


def deploy_stage3(
    cfg: dict,
    s2_catalog: dict,
    seed: int,
    limit: int,
    *,
    char_root: Path | None = None,
    merge_maps: bool = False,
    manifest_name: str = "manifest.json",
) -> list[dict]:
    stage_cfg = load_stage_config()
    traits_dir = ensure_traits(cfg)
    bg_traits, frame_traits = load_traits_for_stage(traits_dir, 3)
    bg_dir, frame_dir = asset_dirs_for_stage(cfg, 3)
    char_root = char_root or stage_char_dir(cfg, 3)

    catalog = iter_stage3_variants(stage_cfg, char_root)
    if limit > 0:
        catalog = catalog[:limit]
    if not catalog:
        raise SystemExit("No Stage_3 variants found")

    out_img = DEPLOY_ROOT / "stage3" / "images"
    out_meta = DEPLOY_ROOT / "stage3" / "metadata"
    out_img.mkdir(parents=True, exist_ok=True)
    out_meta.mkdir(parents=True, exist_ok=True)

    rng = random.Random(seed)
    deployed: list[dict] = []

    for i, row in enumerate(catalog, 1):
        bg = weighted_pick(bg_traits, rng)
        frame = weighted_pick(frame_traits, rng)
        print(f"[S3 {i}/{len(catalog)}] {row['slug']}  bg={bg}  frame={frame}")
        entry = render_stage3_one(
            row["slug"],
            row["png"],
            bg,
            frame,
            cfg,
            bg_dir,
            frame_dir,
            out_img,
            out_meta,
        )
        deployed.append({**entry, "stage1_character": row["stage1_character"]})

    maps = build_stage3_maps(deployed, s2_catalog)
    if merge_maps:
        maps = merge_stage3_maps(load_existing_stage3_maps(), maps)
    write_json(DEPLOY_ROOT / "stage3-variants.json", maps)

    manifest = {
        "type": "stage3_catalog",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(deployed),
        "image_base_url": IMG_S3,
        "metadata_base_url": META_S3,
        "char_root": str(char_root),
        "items": deployed,
    }
    write_json(DEPLOY_ROOT / "stage3" / manifest_name, manifest)
    return deployed


def sync_frontend_configs(s2_catalog: dict) -> None:
    burn_dir = ROOT.parent / "website" / "src" / "burn"
    if burn_dir.is_dir():
        if s2_catalog:
            write_json(burn_dir / "stage2-variants.json", s2_catalog)
        s3_src = DEPLOY_ROOT / "stage3-variants.json"
        if s3_src.exists():
            shutil.copy2(s3_src, burn_dir / "stage3-variants.json")


def write_upload_readme(s2_count: int, s3_count: int, production: bool) -> None:
    prefix = "" if production else "Test/"
    root_hint = "public_html/" if production else "public_html/Test/"
    text = f"""PIXEL TRIP — Stage 2 upload pack ({s2_count} variants)
Target: {"PRODUCTION" if production else "TEST"}

ЛОКАЛЬНО (slug-имена, НЕ 1.gif 2.gif):
  collection/build/deploy/{"" if production else "Test/"}stage2/images/Kiss_Ape.gif
  collection/build/deploy/{"" if production else "Test/"}stage2/metadata/Kiss_Ape

НЕ ЗАЛИВАТЬ из build/stage2_stage3/images/ — там только номера 1.gif, 2.gif…

ЗАЛИВКА НА СЕРВЕР
  stage2/images/*.gif       →  {root_hint}stage2/images/
  stage2/metadata/*         →  {root_hint}stage2/metadata/
  stage2-variants.json      →  {root_hint}stage2-variants.json

ПРОВЕРКА
  {IMG_S2}/Kiss_Ape.gif
  {META_S2}/Kiss_Ape
"""
    if s3_count:
        text += f"""
Stage 3: {s3_count} variants
  stage3/images/*.gif  →  {root_hint}stage3/images/
  stage3/metadata/*    →  {root_hint}stage3/metadata/
"""
    (DEPLOY_ROOT / "UPLOAD.txt").write_text(text, encoding="utf-8")
    if production and s2_count:
        (DEPLOY_ROOT / "STAGE2_UPLOAD.txt").write_text(text, encoding="utf-8")
    if production and s3_count:
        (DEPLOY_ROOT / "STAGE3_UPLOAD.txt").write_text(
            f"""PIXEL TRIP — Stage 3 PRODUCTION upload ({s3_count} variants)

ЛОКАЛЬНО
  build/deploy/stage3/images/*.gif      (Full_Glitch_Diva.gif …)
  build/deploy/stage3/metadata/*
  build/deploy/stage3-variants.json

ЗАЛИВКА (public_html, БЕЗ Test/)
  stage3/images/*.gif       →  public_html/stage3/images/
  stage3/metadata/*         →  public_html/stage3/metadata/
  stage3-variants.json      →  public_html/stage3-variants.json

ПРОВЕРКА
  {IMG_S3}/Full_Glitch_Diva.gif
  {META_S3}/Full_Glitch_Diva

Слои: Stage_3/ + Background_Stage3/ + Frames_Stage3/
""",
            encoding="utf-8",
        )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Deploy slug-named Stage 2/3 burn assets")
    p.add_argument("--stage", type=int, choices=[2, 3], help="Deploy one stage only")
    p.add_argument("--all", action="store_true", help="Deploy Stage 2 + Stage 3")
    p.add_argument("--seed", type=int, default=4242)
    p.add_argument("--limit", type=int, default=0, help="Limit Stage 3 renders (0=all)")
    p.add_argument("--production", action="store_true", help="Main site paths (/stage2/, not /Test/stage2/)")
    p.add_argument(
        "--char-root",
        default="",
        help='Override Stage 3 PNG root (e.g. "../Stage 3 V2")',
    )
    p.add_argument(
        "--merge-s3-map",
        action="store_true",
        help="Merge new fromStage2Slug into existing stage3-variants.json",
    )
    p.add_argument(
        "--s3-manifest-name",
        default="manifest.json",
        help="Manifest filename under build/deploy/stage3/ (batch: manifest-stage3-v2.json)",
    )
    p.add_argument("--no-sync-frontend", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    apply_target("production" if args.production else "test")

    if not args.stage and not args.all:
        args.all = True

    cfg = load_json(CONFIG_PATH)
    s2_catalog: dict[str, list[dict]] = {}
    s2_count = s3_count = 0

    if args.all or args.stage == 2:
        print("=== Stage 2 deploy (slug pack) ===")
        s2_catalog, s2_rows = deploy_stage2(cfg)
        s2_count = len(s2_rows)
        print(f"[OK] Stage 2: {s2_count} GIFs, {len(s2_catalog)} character lines\n")

    if args.all or args.stage == 3:
        if not s2_catalog:
            s2_path = DEPLOY_ROOT / "stage2-variants.json"
            if s2_path.exists():
                s2_catalog = load_json(s2_path)
            else:
                _, s2_rows = deploy_stage2(cfg)
                s2_catalog, _ = deploy_stage2(cfg)

        print("=== Stage 3 render + deploy ===")
        s3_root = resolve_stage3_char_root(cfg, args.char_root or None)
        print(f"[S3] char root: {s3_root}")
        s3_rows = deploy_stage3(
            cfg,
            s2_catalog,
            args.seed,
            args.limit,
            char_root=s3_root,
            merge_maps=args.merge_s3_map,
            manifest_name=args.s3_manifest_name,
        )
        s3_count = len(s3_rows)
        print(f"\n[OK] Stage 3: {s3_count} GIFs\n")

    if not args.no_sync_frontend:
        sync_frontend_configs(s2_catalog)
        print("[OK] Synced website/src/burn/stage2-variants.json (+ stage3 if ready)")

    write_upload_readme(s2_count, s3_count, args.production)
    print(f"[OK] Pack ready: {DEPLOY_ROOT}")
    print(f"[OK] {DEPLOY_ROOT / 'UPLOAD.txt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
