#!/usr/bin/env python3
"""Merge Stage 2 V2 batch 3 characters into stage2-variants.json from deploy metadata."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
META_DIR = ROOT / "build" / "deploy" / "stage2" / "metadata"
VARIANTS_WEB = REPO / "website" / "src" / "burn" / "stage2-variants.json"
VARIANTS_DEPLOY = ROOT / "build" / "deploy" / "stage2-variants.json"
STAGE_CONFIG = ROOT / "stage_config.json"

BATCH3_CHARACTERS = [
    "Bubble_Girl",
    "Cat_Headphones",
    "Dollar_Hood",
    "Gummy_Shock",
    "Hooded_Doom",
    "Mint_Disco_Dancer",
    "Stoned_Jason",
    "Tricorn_Skull",
]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def trait(meta: dict, name: str) -> str | None:
    for attr in meta.get("attributes") or []:
        if attr.get("trait_type") == name:
            return attr.get("value")
    return None


def main() -> None:
    cfg = load_json(STAGE_CONFIG)
    stage2 = cfg["stages"]["2"]["characterMap"]
    variants = load_json(VARIANTS_WEB)

    added = 0
    for char in BATCH3_CHARACTERS:
        if char not in stage2:
            raise SystemExit(f"Missing in stage_config: {char}")
        slugs = list(stage2[char]["variants"].keys())
        entries = []
        for slug in sorted(slugs):
            meta_path = META_DIR / slug
            if not meta_path.is_file():
                raise SystemExit(f"Missing metadata: {meta_path}")
            meta = load_json(meta_path)
            bg = trait(meta, "Background")
            frame = trait(meta, "Frame")
            if not bg or not frame:
                raise SystemExit(f"Missing bg/frame in {meta_path}")
            entries.append({"slug": slug, "bg": bg, "frame": frame})
        variants[char] = entries
        added += len(entries)
        print(f"[OK] {char}: {len(entries)} variants")

    for path in (VARIANTS_WEB, VARIANTS_DEPLOY):
        path.write_text(json.dumps(variants, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[OK] wrote {path} ({len(variants)} characters)")

    print(f"Total batch 3 slugs merged: {added}")


if __name__ == "__main__":
    main()
