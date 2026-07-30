#!/usr/bin/env python3
"""Add Legendary / 1_of_1 traits to all 1/1 metadata files (OpenSea rarity)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OO_FILE = ROOT / "build" / "one_of_one_editions.json"
META_DIR = ROOT / "build" / "metadata"

LEGENDARY_TRAITS = [
    {"trait_type": "Edition", "value": "1_of_1"},
    {"trait_type": "Tier", "value": "Legendary"},
]


def has_trait(attrs: list, trait_type: str) -> bool:
    return any(a.get("trait_type") == trait_type for a in attrs)


def patch_file(token_id: str) -> bool:
    path = META_DIR / token_id
    if not path.is_file():
        print(f"  skip #{token_id} — metadata missing")
        return False
    data = json.loads(path.read_text(encoding="utf-8"))
    attrs = data.setdefault("attributes", [])
    changed = False
    for trait in LEGENDARY_TRAITS:
        if not has_trait(attrs, trait["trait_type"]):
            attrs.append(dict(trait))
            changed = True
    if changed:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed


def main() -> None:
    oo = json.loads(OO_FILE.read_text(encoding="utf-8"))
    patched = 0
    for token_id in sorted(oo, key=int):
        if patch_file(token_id):
            print(f"  patched #{token_id} ({oo[token_id]})")
            patched += 1
        else:
            print(f"  ok #{token_id} ({oo[token_id]})")
    print(f"\nDone — {patched} file(s) updated, {len(oo)} total 1/1s")
    print("Upload metadata/{id} to pixeltripnft.website/metadata/ then Refresh on OpenSea.")


if __name__ == "__main__":
    main()
