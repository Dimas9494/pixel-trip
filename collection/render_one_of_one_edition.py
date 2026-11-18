#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Render one 1/1 collection edition with Stage 3 layer folders (Background_Stage3 / Frames_Stage3).

Example (OS_Gemesis on #3263):
  python render_one_of_one_edition.py --edition 3263 --character OS_Gemesis \
    --background OS_Gemesis_Signature --frame OS_Gemesis_Crown --stage 3
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

from generate_nft import (
    CONFIG_PATH,
    build_attributes,
    compose_animated,
    find_asset,
    image_url,
    animation_url,
    load_json,
    resolve_folder,
    save_gif_animated,
)


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent


def make_dna(trait_values: dict[str, str]) -> str:
    raw = "-".join(f"{k}:{v}" for k, v in sorted(trait_values.items()))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def stage1_layer_dirs(cfg: dict) -> tuple[Path, Path]:
    paths = cfg.get("paths", {})
    bg = resolve_folder((ROOT / paths.get("backgrounds", "../Backgrounds")).resolve(), ["Backgrounds", "Background"])
    fr = resolve_folder((ROOT / paths.get("frames", "../Frames")).resolve(), ["Frames"])
    return bg, fr


def layer_dirs(
    cfg: dict,
    stage: int,
    *,
    bg_dir: Path | None,
    frame_dir: Path | None,
    allow_stage1_fallback: bool,
) -> tuple[Path, Path]:
    if bg_dir is not None and frame_dir is not None:
        return bg_dir, frame_dir
    if stage != 3:
        return stage1_layer_dirs(cfg)
    block = (cfg.get("stageAssetPaths") or {}).get("3") or {}
    bg = (ROOT / block.get("backgrounds", "../Background_Stage3")).resolve()
    fr = (ROOT / block.get("frames", "../Frames_Stage3")).resolve()
    if bg.is_dir() and fr.is_dir():
        return bg, fr
    msg = (
        f"Stage 3 folders required: {bg} and {fr}\n"
        "Add OS_Gemesis_Signature.gif / OS_Gemesis_Crown.gif there (S3-style assets), "
        "or pass --bg-dir / --frame-dir, or --allow-stage1-fallback for dev only."
    )
    if allow_stage1_fallback:
        print(f"[WARN] {msg}\n[WARN] Using Stage 1 Backgrounds/Frames — not valid for production S3 look.")
        return stage1_layer_dirs(cfg)
    raise SystemExit(msg)


def write_metadata(
    edition: int,
    character: str,
    bg: str,
    frame: str,
    cfg: dict,
    dna: str,
) -> Path:
    meta = {
        "name": f"{cfg['namePrefix']} #{edition}",
        "description": cfg["description"],
        "image": image_url(cfg, edition),
        "dna": dna,
        "edition": edition,
        "date": int(time.time() * 1000),
        "attributes": build_attributes(bg, character, frame, cfg, is_one_of_one=True),
        "compiler": cfg.get("compiler", "Pixel Collection Engine"),
        "animation_url": animation_url(cfg, edition),
    }
    meta_dir = ROOT / "build" / "metadata"
    meta_dir.mkdir(parents=True, exist_ok=True)
    path = meta_dir / str(edition)
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> None:
    p = argparse.ArgumentParser(description="Render single 1/1 PIXEL TRIP edition")
    p.add_argument("--edition", type=int, required=True)
    p.add_argument("--character", required=True, help="Character trait value / PNG stem in Characters/")
    p.add_argument("--background", required=True, help="Background asset stem")
    p.add_argument("--frame", required=True, help="Frame asset stem")
    p.add_argument("--stage", type=int, default=3, choices=(1, 2, 3))
    p.add_argument("--bg-dir", type=Path, default=None, help="Override backgrounds folder")
    p.add_argument("--frame-dir", type=Path, default=None, help="Override frames folder")
    p.add_argument(
        "--allow-stage1-fallback",
        action="store_true",
        help="If Stage 3 folders missing, use Stage 1 Backgrounds/Frames (dev only)",
    )
    p.add_argument("--skip-gif", action="store_true", help="Only write metadata JSON")
    args = p.parse_args()

    cfg = load_json(CONFIG_PATH)
    char_png = find_asset((REPO / "Characters").resolve(), args.character, (".png",))
    if not char_png:
        raise SystemExit(f"Character PNG not found: Characters/{args.character}.png")

    bg_override = args.bg_dir.resolve() if args.bg_dir else None
    fr_override = args.frame_dir.resolve() if args.frame_dir else None
    if (bg_override is None) ^ (fr_override is None):
        raise SystemExit("Pass both --bg-dir and --frame-dir, or neither.")
    bg_dir, frame_dir = layer_dirs(
        cfg,
        args.stage,
        bg_dir=bg_override,
        frame_dir=fr_override,
        allow_stage1_fallback=args.allow_stage1_fallback,
    )
    bg_path = find_asset(bg_dir, args.background, (".gif", ".png", ".webp"))
    frame_path = find_asset(frame_dir, args.frame, (".gif", ".png", ".webp"))
    if not bg_path or not frame_path:
        raise SystemExit(f"Missing bg/frame under {bg_dir} / {frame_dir}")

    traits = {
        "Background": args.background,
        "Character": args.character,
        "Frame": args.frame,
    }
    dna = make_dna(traits)
    meta_path = write_metadata(args.edition, args.character, args.background, args.frame, cfg, dna)
    print(f"Wrote {meta_path}")

    if args.skip_gif:
        return

    size = int(cfg.get("canvasSize", 1024))
    target_ms = cfg.get("animationDurationMs")
    target_ms = int(target_ms) if target_ms and int(target_ms) > 0 else None

    print(f"Compose: bg={bg_path.name} char={char_png.name} frame={frame_path.name} (stage {args.stage})")
    frames, durs = compose_animated(
        bg_path,
        char_png,
        frame_path,
        size,
        master=cfg.get("animationMaster", "frame"),
        max_frames=int(cfg.get("animationMaxFrames", 256)),
        target_duration_ms=target_ms,
        verbose=True,
    )
    out = ROOT / "build" / "images" / f"{args.edition}.gif"
    out.parent.mkdir(parents=True, exist_ok=True)
    save_gif_animated(frames, durs, out)
    print(f"Wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()