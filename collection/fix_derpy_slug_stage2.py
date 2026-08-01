#!/usr/bin/env python3
"""Rename Stage 2 batch: Derpy_Slime -> Derpy_Slug (wrong Stage 1 character)."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
OLD = "Derpy_Slime"
NEW = "Derpy_Slug"
STAGE_CONFIG = ROOT / "stage_config.json"
DEPLOY_VARIANTS = ROOT / "build" / "deploy" / "stage2-variants.json"
WEB_VARIANTS = REPO / "website" / "src" / "burn" / "stage2-variants.json"
DEPLOY_S2 = ROOT / "build" / "deploy" / "stage2"


def rename_slug(name: str) -> str:
    return name.replace(f"{OLD}_", f"{NEW}_") if name.startswith(f"{OLD}_") else name


def rename_folder_tree(src: Path, dst: Path) -> None:
    if not src.is_dir():
        raise SystemExit(f"Missing folder: {src}")
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True, exist_ok=True)
    for png in sorted(src.glob("*.png")):
        new_name = rename_slug(png.stem) + png.suffix
        shutil.copy2(png, dst / new_name)
    print(f"[OK] {src.name} -> {dst.name} ({len(list(dst.glob('*.png')))} png)")


def patch_stage_config() -> None:
    cfg = json.loads(STAGE_CONFIG.read_text(encoding="utf-8"))
    char_map = cfg["stages"]["2"]["characterMap"]
    if OLD not in char_map:
        raise SystemExit(f"{OLD} not in stage_config.json")
    entry = char_map.pop(OLD)
    variants = {rename_slug(k): rename_slug(v) for k, v in entry["variants"].items()}
    char_map[NEW] = {"folder": NEW, "variants": variants}
    STAGE_CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[OK] stage_config: {OLD} -> {NEW} ({len(variants)} variants)")


def patch_variants_json(path: Path) -> None:
    if not path.is_file():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    if OLD in data:
        slugs = [{**v, "slug": rename_slug(v["slug"])} for v in data.pop(OLD)]
        data[NEW] = slugs
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[OK] {path.relative_to(REPO)}: {OLD} -> {NEW}")


def remove_old_deploy_assets() -> None:
    img_dir = DEPLOY_S2 / "images"
    meta_dir = DEPLOY_S2 / "metadata"
    removed = 0
    for path in list(img_dir.glob(f"{OLD}_*.gif")) + list(meta_dir.glob(f"{OLD}_*")):
        path.unlink(missing_ok=True)
        removed += 1
    print(f"[OK] removed {removed} old {OLD} deploy file(s)")


def main() -> None:
    for rel in ("Stage 2 V2", "Stage_2"):
        src = REPO / rel / OLD
        dst = REPO / rel / NEW
        if src.is_dir():
            rename_folder_tree(src, dst)
            shutil.rmtree(src)
    patch_stage_config()
    patch_variants_json(DEPLOY_VARIANTS)
    patch_variants_json(WEB_VARIANTS)
    remove_old_deploy_assets()
    print("\nNext: python prepare_stage2_v2_deploy.py --character Derpy_Slug --skip-copy")


if __name__ == "__main__":
    main()
