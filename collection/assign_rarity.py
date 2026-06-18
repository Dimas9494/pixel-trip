# -*- coding: utf-8 -*-
"""
Распределение редкости для Background / Characters / Frames (сканирует папки).

Схема:
  1. Сканирует папки Background / Characters / Frames
  2. Считает score по ключевым словам (выше = реже)
  3. Сортирует и назначает tier по квотам из config.json
  4. Пишет JSON + читаемые таблицы для проверки

  python assign_rarity.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"

TIER_ORDER = ["Epic", "Rare", "Uncommon", "Common"]
DISPLAY_TIERS = ["Unique"] + TIER_ORDER

# --- race rules (Character only) ---
RACE_RULES: list[tuple[str, list[str]]] = [
    ("mythic", [
        "halo_angel", "grim_reaper", "crimson_samurai", "pharaoh", "war_bonnet",
        "feather_chief", "emerald_queen", "rainbow_prince", "gold_warrior",
        "diamond_suit", "gilded", "tricorn",
    ]),
    ("ironborn", [
        "cyborg", "bot", "robot", "monitor", "circuit", "wire", "gear", "blank",
        "tri_cross", "cyber", "visor", "chrome", "steel", "mech", "franken",
        "brain_bot", "teal_bot", "gilded_bot", "split_cyborg",
    ]),
    ("voidkin", [
        "alien", "tentacle", "space", "chimp", "moon", "star", "nebula",
        "trilobe", "mindflayer", "imp", "laser", "quantum", "glow",
        "violet_blob", "star_slime", "mint_eyes",
    ]),
    ("ashborn", [
        "skull", "zombie", "vampire", "reaper", "grim", "ghost", "wraith",
        "undead", "pale", "wire_skull", "flame_skull", "gilded_skull",
        "antler_skull", "crown_skull", "glow_skull", "blue_dread_skull",
    ]),
    ("hellspawn", [
        "devil", "demon", "oni", "suit_devil", "winged_demon", "red_spirit",
        "horned", "fang", "hell",
    ]),
    ("wildkin", [
        "cat", "fox", "dog", "doge", "hound", "ape", "monkey", "bear",
        "owl", "lizard", "mantis", "pug", "bulldog", "chimp", "yeti",
        "merman", "satyr", "dryad", "gargoyle", "goblin", "troll",
        "bog", "fish", "neko", "jester_cat",
    ]),
    ("verdant", [
        "moss", "leaf", "bark", "cactus", "flower", "elf", "dryad",
        "lichen", "roots", "sacred_flower",
    ]),
    ("corsair", [
        "pirate", "bandana", "rebel", "rogue", "jester", "mime", "ninja",
        "assassin", "detective", "pipe", "stripe_pirate", "shadow_ninja",
        "hood_assassin", "motley", "lucha",
    ]),
    ("runeborn", [
        "golem", "puppet", "gargoyle", "stone", "wooden",
        "steel_robot", "mask", "tiki", "oni_mask", "lucha_mask",
        "cat_mask", "stripe_mask", "split_mask",
    ]),
    ("primal", [
        "ogre", "troll", "goblin", "cyclops", "orc", "yeti",
        "bucktooth", "grumpy", "mint_troll", "blue_ogre", "pink_nose",
        "grumpy_cyclops", "beanie_cyclops", "blue_cyclops",
    ]),
    ("eldritch", [
        "glitch", "monitor", "shocked", "mind", "blob", "slime", "paint",
        "anaglyph", "circuit", "smiley_monitor", "cyan_grey", "cyan_paint",
        "paper_bag", "shroom", "tentacle",
    ]),
    ("highborn", [
        "sage", "oracle", "nerd", "glasses", "monocle", "soldier", "diver",
        "astronaut", "grandma", "elder", "fedora", "camo", "filter",
        "trucker", "gnome", "dwarf", "miner", "bubble_dj",
        "round_glasses", "square_glasses", "orange_nerd", "babushka",
    ]),
]

MANUAL_RACES: dict[str, str] = {
    "Bandana_Rebel": "corsair",
    "Neon_Visor": "ironborn",
    "Beanie_Sage": "highborn",
    "Paper_Fan": "highborn",
    "Brass_Diver": "highborn",
    "Red_Nose": "corsair",
    "Cyan_Smile": "highborn",
    "Suit_Devil": "hellspawn",
    "Horn_Glasses": "highborn",
    "Roaring_Sage": "highborn",
    "Straw_Patch": "highborn",
    "Cyan_Oracle": "highborn",
    "Copper_Goggles": "ironborn",
    "Pink_Bellow": "wildkin",
    "Teal_Shades": "highborn",
    "Orange_Hound": "wildkin",
    "Bitcoin_Ninja": "corsair",
    "Sleepy_Moon": "voidkin",
    "Purple_Prince": "highborn",
    "Alpine_Hunter": "highborn",
    "Painted_Mime": "corsair",
    "Purple_Diva": "highborn",
    "Laughing_Beanie": "highborn",
    "Crying_Bling": "highborn",
    "Prism_Shades": "eldritch",
    "Fur_Parka": "highborn",
    "Cigar_Bandana": "corsair",
    "Dollar_Hood": "corsair",
    "Beret_Pug": "wildkin",
}

# --- rarity score boosts (higher = rarer tier) ---
SCORE_RULES: dict[str, list[tuple[int, list[str]]]] = {
    "background": [
        (900, ["one_of_one", "genesis_block", "white_hole", "quantum_superposition"]),
        (800, ["supernova", "paradox", "eclipse_corona", "black_hole"]),
        (700, ["diamond", "golden_ratio", "golden_spiral", "celestial", "nebula"]),
        (600, ["glitch", "datamosh", "entropy", "kraken", "witch_hex"]),
        (500, ["meteor", "pulsar", "lunar", "magma", "blizzard", "eclipse"]),
        (400, ["dungeon", "torch", "frost", "lava", "tsunami", "supernova"]),
        (300, ["chrome", "steampunk", "holographic", "baroque", "chainmail"]),
        (200, ["bamboo", "embroidery", "marble", "stained", "constellation"]),
        (100, ["rain", "camera", "continue", "game_over", "auction"]),
    ],
    "character": [
        (950, ["halo_angel", "grim_reaper", "diamond_suit", "emerald_queen"]),
        (850, ["crimson_samurai", "tentacle_alien", "teal_mindflayer", "brain_zombie"]),
        (750, ["cyber_bear", "flame_skull", "winged_demon", "gold_warrior"]),
        (650, ["grim", "vampire", "reaper", "pharaoh", "samurai", "angel"]),
        (550, ["cyborg", "alien", "demon", "oni", "yeti", "mindflayer"]),
        (450, ["skull", "zombie", "ghost", "monitor", "glitch", "robot"]),
        (350, ["pirate", "ninja", "viking", "assassin", "samurai", "chief"]),
        (250, ["cat", "fox", "dog", "ape", "monkey", "owl", "hound"]),
        (150, ["sage", "glasses", "beanie", "soldier", "diver", "hood"]),
    ],
    "frame": [
        (900, ["one_of_one", "genesis", "white_hole", "quantum"]),
        (800, ["supernova", "paradox", "eclipse_corona", "doppelganger"]),
        (700, ["diamond", "golden", "celestial", "holographic", "chrome_dip"]),
        (600, ["glitch", "datamosh", "entropy", "witch", "blood_drip"]),
        (500, ["chainmail", "baroque", "laurel", "scale_armor", "royal"]),
        (400, ["neon", "laser", "pulsar", "meteor", "eclipse"]),
        (300, ["embroidery", "henna", "marble", "stained", "mosaic"]),
        (200, ["bamboo", "frost", "torch", "dungeon", "roots"]),
        (100, ["continue", "game_over", "auction", "camera", "rain"]),
    ],
}

MANUAL_TIER: dict[str, str] = {
    # Background
    "One_Of_One_Aura": "Mythic",
    "Genesis_Block": "Mythic",
    "White_Hole": "Legendary",
    "Quantum_Superposition": "Legendary",
    "Supernova_Remnant": "Legendary",
    "Supernova_Shock": "Legendary",
    # Character
    "Halo_Angel": "Mythic",
    "Grim_Reaper": "Mythic",
    "Diamond_Suit": "Legendary",
    "Emerald_Queen": "Legendary",
    "Crimson_Samurai": "Legendary",
    # Frame
}


def load_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def resolve_folder(cfg: Path, fallbacks: list[str]) -> Path:
    if cfg.exists():
        return cfg
    root = ROOT.parent
    for name in fallbacks:
        p = root / name
        if p.exists():
            return p
    return cfg


def list_assets(folder: Path, extensions: tuple[str, ...]) -> list[str]:
    if not folder.exists():
        return []
    names: list[str] = []
    for p in sorted(folder.iterdir()):
        if p.is_file() and p.suffix.lower() in extensions:
            names.append(p.stem)
    return names


def rarity_score(name: str, kind: str) -> int:
    if name in MANUAL_TIER:
        tier = MANUAL_TIER[name]
        if tier in TIER_ORDER:
            return 1000 - TIER_ORDER.index(tier) * 50
        return 950
    n = name.lower()
    score = 0
    for pts, keywords in SCORE_RULES.get(kind, []):
        if any(k in n for k in keywords):
            score = max(score, pts)
    # hash tiebreaker for stable sort among equals
    score += (hash(name) % 17)
    return score


def tier_quotas(total: int, quotas: dict[str, float]) -> dict[str, int]:
    """Assign integer counts per tier; Common gets remainder."""
    counts: dict[str, int] = {}
    assigned = 0
    for tier in TIER_ORDER:
        if tier == "Common":
            continue
        pct = quotas.get(tier, 0)
        n = max(1, round(total * pct)) if pct > 0 else 0
        counts[tier] = n
        assigned += n
    counts["Common"] = max(0, total - assigned)
    # fix over-assignment from rounding
    while sum(counts.values()) > total:
        for tier in reversed(TIER_ORDER):
            if tier != "Common" and counts[tier] > 1:
                counts[tier] -= 1
                if sum(counts.values()) <= total:
                    break
    while sum(counts.values()) < total:
        counts["Common"] += 1
    return counts


def assign_tiers(names: list[str], kind: str, quotas: dict[str, float]) -> dict[str, dict]:
    scored = sorted(names, key=lambda n: (rarity_score(n, kind), n), reverse=True)
    counts = tier_quotas(len(scored), quotas)
    result: dict[str, dict] = {}
    idx = 0
    for tier in TIER_ORDER:
        for _ in range(counts[tier]):
            if idx >= len(scored):
                break
            name = scored[idx]
            result[name] = {"value": name, "tier": tier, "score": rarity_score(name, kind)}
            idx += 1
    # safety: any leftover → Common
    while idx < len(scored):
        name = scored[idx]
        result[name] = {"value": name, "tier": "Common", "score": rarity_score(name, kind)}
        idx += 1
    return result


def assign_race(name: str) -> str:
    if name in MANUAL_RACES:
        return MANUAL_RACES[name]
    n = name.lower()
    for race_id, keywords in RACE_RULES:
        if any(k in n for k in keywords):
            return race_id
    return "highborn"


def apply_weights(trait_map: dict[str, dict], cfg: dict) -> None:
    tiers = cfg["rarityTiers"]
    for data in trait_map.values():
        if data.get("one_of_one"):
            continue
        tier = data["tier"]
        data["weight"] = tiers[tier]["weight"]


def write_table(path: Path, trait_map: dict[str, dict], extra_cols: list[str] | None = None) -> None:
    extra_cols = extra_cols or []
    tiers = ["Unique"] + TIER_ORDER
    by_tier: dict[str, list[tuple[str, dict]]] = {t: [] for t in tiers}
    for name, data in trait_map.items():
    by_tier[data.get("tier", "Common")].append((name, data))

    lines = [
        f"{'Tier':<12} {'Weight':<8} {'Score':<6} {'Name'}"
        + (" " + " ".join(extra_cols) if extra_cols else ""),
    ]
    for tier in tiers:
        items = sorted(by_tier.get(tier, []), key=lambda x: (-x[1].get("score", 0), x[0]))
        for name, data in items:
            row = f"{tier:<12} {data.get('weight', 0):<8} {data.get('score', 0):<6} {name}"
            for col in extra_cols:
                row += f"  {data.get(col, '')}"
            lines.append(row)
        lines.append(f"  --- {tier}: {len(items)} ---")
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def tier_summary(trait_map: dict[str, dict]) -> dict[str, int]:
    summary: dict[str, int] = {t: 0 for t in DISPLAY_TIERS}
    for data in trait_map.values():
        tier = data.get("tier", "Common")
        summary[tier] = summary.get(tier, 0) + 1
    return summary


def assign_character_traits(
    characters: list[str],
    quotas: dict[str, float],
    cfg: dict,
) -> dict[str, dict]:
    one_of_one: list[str] = cfg.get("oneOfOneCharacters", [])
    oo_set = set(one_of_one)
    regular = [c for c in characters if c not in oo_set]

    result = assign_tiers(regular, "character", quotas)
    apply_weights(result, cfg)

    for name in one_of_one:
        if name not in characters:
            print(f"[WARN] 1/1 character not found: {name}", flush=True)
            continue
        result[name] = {
            "value": name,
            "tier": "Unique",
            "weight": 0,
            "one_of_one": True,
            "score": 9999,
        }
    return result


def main() -> None:
    cfg = load_config()
    traits_dir = (ROOT / cfg["paths"]["traits"]).resolve()
    traits_dir.mkdir(parents=True, exist_ok=True)

    char_dir = resolve_folder((ROOT / cfg["paths"]["characters"]).resolve(), ["Characters"])
    bg_dir = resolve_folder((ROOT / cfg["paths"]["backgrounds"]).resolve(), ["Background", "Backgrounds"])
    frame_dir = resolve_folder((ROOT / cfg["paths"]["frames"]).resolve(), ["Frames"])

    characters = list_assets(char_dir, (".png",))
    backgrounds = list_assets(bg_dir, (".gif", ".png", ".webp"))
    frames = list_assets(frame_dir, (".gif", ".png", ".webp"))

    quotas = cfg.get("tierQuotas", {
        "Epic": 0.05, "Rare": 0.12, "Uncommon": 0.28, "Common": 0.55,
    })

    bg_traits = assign_tiers(backgrounds, "background", quotas)
    char_traits = assign_character_traits(characters, quotas, cfg)
    frame_traits = assign_tiers(frames, "frame", quotas)

    apply_weights(bg_traits, cfg)
    apply_weights(char_traits, cfg)
    apply_weights(frame_traits, cfg)

    for name, data in char_traits.items():
        data["race"] = assign_race(name)

    # JSON outputs
    (traits_dir / "background_traits.json").write_text(
        json.dumps(bg_traits, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (traits_dir / "character_traits.json").write_text(
        json.dumps(char_traits, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (traits_dir / "frame_traits.json").write_text(
        json.dumps(frame_traits, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    race_map = {n: d["race"] for n, d in char_traits.items()}
    (traits_dir / "character_races.json").write_text(
        json.dumps(race_map, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Human-readable tables
    write_table(traits_dir / "rarity_background.txt", bg_traits)
    write_table(traits_dir / "rarity_character.txt", char_traits, ["race"])
    write_table(traits_dir / "rarity_frame.txt", frame_traits)

    summary = {
        "folders": {
            "background": str(bg_dir),
            "characters": str(char_dir),
            "frames": str(frame_dir),
        },
        "counts": {
            "background": len(backgrounds),
            "character": len(characters),
            "frame": len(frames),
        },
        "oneOfOneCharacters": cfg.get("oneOfOneCharacters", []),
        "tierQuotas": quotas,
        "distribution": {
            "background": tier_summary(bg_traits),
            "character": tier_summary(char_traits),
            "frame": tier_summary(frame_traits),
        },
        "weights": cfg["rarityTiers"],
    }
    (traits_dir / "rarity_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("=== Rarity assigned ===")
    print(f"Background: {len(backgrounds)}  ({bg_dir})")
    print(f"Character:  {len(characters)}  ({char_dir})")
    print(f"Frame:      {len(frames)}  ({frame_dir})")
    print()
    for kind, traits in [("Background", bg_traits), ("Character", char_traits), ("Frame", frame_traits)]:
        dist = tier_summary(traits)
        print(f"{kind}:")
        for tier in DISPLAY_TIERS:
            print(f"  {tier}: {dist.get(tier, 0)}")
    print()
    print(f"Tables: {traits_dir}")
    print("  rarity_background.txt")
    print("  rarity_character.txt")
    print("  rarity_frame.txt")
    print("  rarity_summary.json")


if __name__ == "__main__":
    main()
