# -*- coding: utf-8 -*-
"""
Safe Stage 2 batch deploy — avoids past mistakes:
- explicit character list only
- sync stage_config before render
- additive catalog merge (abort if catalog shrinks)
- merge calldata charIds (never replace whole file)
- inline imports (Cyrillic path safe, no subprocess)
"""
from __future__ import annotations

import json
import random
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

COLLECTION = Path(__file__).resolve().parent
sys.path.insert(0, str(COLLECTION))

from generate_nft import CONFIG_PATH, ensure_traits, load_json as nft_load_json  # noqa: E402
from generate_stage_test import iter_catalog_variants, load_traits_for_stage  # noqa: E402
from prepare_stage2_v2_deploy import (  # noqa: E402
    OUT_IMG,
    OUT_META,
    copy_v2_to_stage2,
    render_variant,
    sync_stage_config,
)
from upgrade_stage import asset_dirs_for_stage, load_stage_config, stage_char_dir  # noqa: E402

ROOT = COLLECTION.parent
WEB_VARIANTS = ROOT / "website/src/burn/stage2-variants.json"
DEP_VARIANTS = ROOT / "collection/build/deploy/stage2-variants.json"
WEB_CONFIG = ROOT / "website/src/burn/config.js"
CHAR_MAP = ROOT / "website/char-map.json"
META_DIR = ROOT / "collection/build/deploy/stage2/metadata"
DEPLOY = ROOT / "collection/build/deploy"

BATCH_TAG = "batch37"
CHARACTERS = [
    "Druid",
    "Jester_Cat",
    "Lightning_Glam",
    "Miner",
    "Monk",
]


def merge_catalog(new_entries: dict[str, list[dict]]) -> dict:
    base = json.loads(WEB_VARIANTS.read_text(encoding="utf-8"))
    before = len(base)
    for name, variants in new_entries.items():
        base[name] = variants
    if len(base) < before:
        raise SystemExit(f"Catalog shrank ({before} → {len(base)}) — aborted")
    payload = json.dumps(base, ensure_ascii=False, indent=2) + "\n"
    WEB_VARIANTS.write_text(payload, encoding="utf-8")
    DEP_VARIANTS.write_text(payload, encoding="utf-8")
    return base


def merge_calldata(names: list[str]) -> Path:
    char_map = json.loads(CHAR_MAP.read_text(encoding="utf-8"))
    path = DEPLOY / f"calldata-stage2-v2-{BATCH_TAG}.json"
    calldata = {
        "comment": "Remix → EvolvePixelTrip (0x1B174b30A0ABA50bd73aF305caDB01e23bfda0EC) → setCharacterPaths",
        "function": "setCharacterPaths(uint16[] charIds, uint8[] paths)",
        "pathLegend": {"0": "Blocked", "1": "Normal S1→S2→S3", "2": "DirectToS3"},
        "batch": BATCH_TAG,
        "charIds": [char_map[n] for n in names],
        "paths": [1] * len(names),
        "names": list(names),
    }
    order = sorted(zip(calldata["charIds"], calldata["names"], calldata["paths"]))
    calldata["charIds"] = [r[0] for r in order]
    calldata["names"] = [r[1] for r in order]
    calldata["paths"] = [r[2] for r in order]
    path.write_text(json.dumps(calldata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def write_checklist(counts: dict[str, int], total: int, catalog_size: int) -> None:
    char_map = json.loads(CHAR_MAP.read_text(encoding="utf-8"))
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines = [
        f"PIXEL TRIP — Stage 2 V2 deploy checklist ({BATCH_TAG})",
        "",
        "NEW CHARACTERS:",
    ]
    for name in CHARACTERS:
        lines.append(f"  {name}: charId={char_map[name]}, {counts[name]} variants")
    lines.extend([
        "",
        f"New GIFs this batch: {total}",
        f"Catalog total characters: {catalog_size}",
        f"Footer: {stamp}-{BATCH_TAG}-{catalog_size}c",
    ])
    (DEPLOY / f"STAGE2_V2_CHECKLIST_{BATCH_TAG}.txt").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def write_ftp_list(slugs: list[str]) -> None:
    lines: list[str] = []
    for slug in sorted(slugs):
        lines.extend([f"{slug}.gif", slug])
    lines.append("stage2-variants.json")
    (DEPLOY / "STAGE2_V2_BATCH_FILES.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def bump_build_tag() -> None:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    text = WEB_CONFIG.read_text(encoding="utf-8")
    text = re.sub(
        r"export const BURN_PROGRAM_VERSION = `[^`]+`;",
        f"export const BURN_PROGRAM_VERSION = `{stamp}-{BATCH_TAG}-${{BURNABLE_CHARS.size}}c`;",
        text,
        count=1,
    )
    WEB_CONFIG.write_text(text, encoding="utf-8")


def render_batch(*, skip_copy: bool = False, skip_sync: bool = False) -> tuple[dict[str, list[dict]], list[str], dict[str, int], int]:
    if not skip_copy:
        copy_v2_to_stage2(CHARACTERS, dry_run=False)
    if not skip_sync:
        sync_stage_config(dry_run=False)

    cfg = nft_load_json(CONFIG_PATH)
    stage_cfg = load_stage_config()
    traits_dir = ensure_traits(cfg)
    bg_traits, frame_traits = load_traits_for_stage(traits_dir, 2)
    bg_dir, frame_dir = asset_dirs_for_stage(cfg, 2)
    char_root = stage_char_dir(cfg, 2)
    rng = random.Random(4242)

    OUT_IMG.mkdir(parents=True, exist_ok=True)
    OUT_META.mkdir(parents=True, exist_ok=True)

    new_catalog: dict[str, list[dict]] = {}
    counts: dict[str, int] = {}
    all_slugs: list[str] = []
    total = 0

    for char in CHARACTERS:
        catalog = iter_catalog_variants(stage_cfg, 2, char_root, char)
        if not catalog:
            raise SystemExit(f"No variants for {char} — check Stage_2/{char} and stage_config.json")
        print(f"\n{char} ({len(catalog)} variants)")
        entries: list[dict] = []
        for row in catalog:
            entry = render_variant(
                row, cfg, bg_traits, frame_traits, bg_dir, frame_dir, rng, dry_run=False
            )
            entries.append({"slug": entry["slug"], "bg": entry["bg"], "frame": entry["frame"]})
            all_slugs.append(entry["slug"])
        new_catalog[char] = entries
        counts[char] = len(entries)
        total += len(entries)

    return new_catalog, all_slugs, counts, total


def verify_names() -> None:
    char_map = json.loads(CHAR_MAP.read_text(encoding="utf-8"))
    v2 = ROOT / "Stage 2 V2"
    for name in CHARACTERS:
        if name not in char_map:
            raise SystemExit(f"{name} missing from char-map.json")
        folder = v2 / name
        if not folder.is_dir():
            raise SystemExit(f"Missing folder: {folder}")
        if not any(folder.glob("*.png")):
            raise SystemExit(f"No PNGs in {folder}")


def main() -> int:
    print(f"Stage 2 V2 safe deploy — {BATCH_TAG}")
    print("Characters:", ", ".join(CHARACTERS))
    verify_names()

    print("\n[1/2] Copy + sync config + render GIFs…")
    cfg = nft_load_json(CONFIG_PATH)
    stage2_root = stage_char_dir(cfg, 2)
    skip_copy = all(
        (stage2_root / c).is_dir() and any((stage2_root / c).glob("*.png"))
        for c in CHARACTERS
    )
    if skip_copy:
        print("[skip] Stage_2 folders already present")

    stage_cfg = json.loads((COLLECTION / "stage_config.json").read_text(encoding="utf-8"))
    char_map_s2 = stage_cfg.get("stages", {}).get("2", {}).get("characterMap", {})
    skip_sync = all(c in char_map_s2 for c in CHARACTERS)
    if skip_sync:
        print("[skip] stage_config already has batch characters")

    new_catalog, all_slugs, counts, total = render_batch(
        skip_copy=skip_copy, skip_sync=skip_sync
    )

    print("\n[2/2] Merge catalog (additive)…")
    merged = merge_catalog(new_catalog)
    write_ftp_list(all_slugs)
    calldata = merge_calldata(CHARACTERS)
    write_checklist(counts, total, len(merged))
    bump_build_tag()

    print(f"\n[OK] {total} variants · {len(CHARACTERS)} chars · catalog {len(merged)}")
    print(f"Deploy: {DEPLOY / 'stage2'}")
    print(f"Calldata: {calldata}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
