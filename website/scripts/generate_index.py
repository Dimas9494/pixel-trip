# -*- coding: utf-8 -*-
"""Build collection.json for the Pixel Trip website from NFT metadata."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COLLECTION = ROOT.parent / "collection"
CONFIG_PATH = COLLECTION / "config.json"
METADATA_DIR = COLLECTION / "build" / "metadata"
OUT_PATH = ROOT / "public" / "data" / "collection.json"


def main() -> None:
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    edition_size = cfg["editionSize"]
    one_of_ones = set(cfg.get("oneOfOneCharacters", []))

    items = []
    trait_values: dict[str, set[str]] = {
        "Background": set(),
        "Character": set(),
        "Frame": set(),
    }

    for edition in range(1, edition_size + 1):
        meta_path = METADATA_DIR / str(edition)
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        attrs = {a["trait_type"]: a["value"] for a in meta.get("attributes", [])}
        for key in trait_values:
            if key in attrs:
                trait_values[key].add(attrs[key])

        character = attrs.get("Character", "")
        items.append(
            {
                "edition": edition,
                "name": meta.get("name", f"PIXEL TRIP #{edition}"),
                "dna": meta.get("dna", ""),
                "background": attrs.get("Background", ""),
                "character": character,
                "frame": attrs.get("Frame", ""),
                "isOneOfOne": character in one_of_ones,
            }
        )

    payload = {
        "name": cfg.get("namePrefix", "PIXEL TRIP"),
        "description": cfg.get("description", ""),
        "editionSize": edition_size,
        "oneOfOnes": cfg.get("oneOfOneCharacters", []),
        "stats": {
            "backgrounds": 154,
            "characters": 291,
            "frames": 200,
        },
        "traits": {
            key: sorted(values) for key, values in trait_values.items()
        },
        "items": items,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(items)} items -> {OUT_PATH}")


if __name__ == "__main__":
    main()
