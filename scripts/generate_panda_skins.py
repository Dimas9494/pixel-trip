#!/usr/bin/env python3
"""Generate 30 vector NFT skins of the base panda (pose & form locked to reference)."""

from __future__ import annotations

import json
from pathlib import Path

import cairosvg

ROOT = Path(__file__).resolve().parents[1]
OUT_SVG = ROOT / "Characters" / "Panda_Vector_Skins"
OUT_PNG = ROOT / "Characters"
SIZE = 1024

# Geometry derived from the reference bust (1024²): wide soft head, low body.


def head_path() -> str:
    # Soft rounded rectangle, wider than tall, with fur tufts.
    return (
        "M300,320 "
        "C305,285 325,260 355,245 "
        "L375,235 395,242 420,232 445,240 470,228 495,236 "
        "L520,226 545,236 570,228 595,240 620,232 645,242 "
        "L670,235 690,248 "
        "C720,265 740,295 745,335 "
        "C755,390 760,450 755,510 "
        "C750,565 735,610 705,640 "
        "L685,655 660,648 635,660 610,650 585,662 "
        "L560,652 535,664 510,654 485,664 460,652 "
        "L435,662 410,650 385,660 360,648 340,655 "
        "C310,630 290,585 282,530 "
        "C274,470 278,400 300,320 Z"
    )


def ear_left() -> str:
    return (
        "M290,300 "
        "C270,250 285,205 335,195 "
        "C375,188 410,210 420,250 "
        "C425,275 410,300 380,310 "
        "C350,320 315,318 290,300 Z"
    )


def ear_right() -> str:
    return (
        "M734,300 "
        "C754,250 739,205 689,195 "
        "C649,188 614,210 604,250 "
        "C599,275 614,300 644,310 "
        "C674,320 709,318 734,300 Z"
    )


def body_path() -> str:
    return (
        "M175,780 "
        "C195,690 260,640 340,620 "
        "C400,608 460,602 512,602 "
        "C564,602 624,608 684,620 "
        "C764,640 829,690 849,780 "
        "C865,860 870,940 872,1024 "
        "L152,1024 "
        "C154,940 160,860 175,780 Z"
    )


def belly_path() -> str:
    return (
        "M355,655 "
        "C410,625 470,612 512,612 "
        "C554,612 614,625 669,655 "
        "C710,680 735,730 745,800 "
        "C752,870 750,960 748,1024 "
        "L276,1024 "
        "C274,960 272,870 279,800 "
        "C289,730 314,680 355,655 Z"
    )


def patch_left() -> str:
    # Teardrop / bean patch, angled inward-down.
    return (
        "M355,355 "
        "C330,330 335,285 370,265 "
        "C405,245 450,255 470,290 "
        "C490,325 480,375 450,405 "
        "C420,435 375,430 355,400 "
        "C340,380 345,365 355,355 Z"
    )


def patch_right() -> str:
    return (
        "M669,355 "
        "C694,330 689,285 654,265 "
        "C619,245 574,255 554,290 "
        "C534,325 544,375 574,405 "
        "C604,435 649,430 669,400 "
        "C684,380 679,365 669,355 Z"
    )


SKINS: list[dict] = [
    {"id": "01", "slug": "Panda_Classic", "name": "Classic", "bg": "#C9C9C9",
     "face": "#FFFFFF", "face_shade": "#C5CFD8", "dark": "#1A1A1A", "dark_hi": "#3D3D3D",
     "belly": "#FFFFFF", "eye": "#111111", "nose": "#111111", "line": "#111111",
     "accent": None, "accessory": None},
    {"id": "02", "slug": "Panda_Golden", "name": "Golden", "bg": "#1A1408",
     "face": "#FFF4C8", "face_shade": "#E8C878", "dark": "#8B6914", "dark_hi": "#C9A227",
     "belly": "#FFF8DC", "eye": "#3D2B00", "nose": "#5C4300", "line": "#3D2B00",
     "accent": "#FFD700", "accessory": "crown"},
    {"id": "03", "slug": "Panda_Cyber_Neon", "name": "Cyber Neon", "bg": "#050510",
     "face": "#0A1A2A", "face_shade": "#143048", "dark": "#00E8F0", "dark_hi": "#7AFFFF",
     "belly": "#0E2438", "eye": "#FF00AA", "nose": "#00E8F0", "line": "#00E8F0",
     "accent": "#FF00AA", "accessory": "visor"},
    {"id": "04", "slug": "Panda_Ice_Frost", "name": "Ice Frost", "bg": "#C8E4F8",
     "face": "#F4FBFF", "face_shade": "#B8D8F0", "dark": "#4A7AA8", "dark_hi": "#7AA8C8",
     "belly": "#EEF7FF", "eye": "#1A3A58", "nose": "#2A5080", "line": "#2A5080",
     "accent": "#A8D8FF", "accessory": "snowflake"},
    {"id": "05", "slug": "Panda_Fire_Ember", "name": "Fire Ember", "bg": "#2A0A00",
     "face": "#FFE0A0", "face_shade": "#F0A050", "dark": "#C42800", "dark_hi": "#FF6A20",
     "belly": "#FFE8B8", "eye": "#4A1000", "nose": "#8B2000", "line": "#5A1800",
     "accent": "#FFAA00", "accessory": "flame"},
    {"id": "06", "slug": "Panda_Toxic_Zombie", "name": "Toxic Zombie", "bg": "#1A2410",
     "face": "#C8E090", "face_shade": "#88A858", "dark": "#3A5820", "dark_hi": "#6A8A40",
     "belly": "#D8F0A8", "eye": "#A0FF20", "nose": "#2A4010", "line": "#1A3008",
     "accent": "#80FF00", "accessory": "scar"},
    {"id": "07", "slug": "Panda_Sakura_Pink", "name": "Sakura Pink", "bg": "#FFE8F0",
     "face": "#FFF5F8", "face_shade": "#F5C0D0", "dark": "#E06090", "dark_hi": "#F098B8",
     "belly": "#FFE8F0", "eye": "#802040", "nose": "#C04070", "line": "#A03058",
     "accent": "#FFB0C8", "accessory": "flower"},
    {"id": "08", "slug": "Panda_Royal_Purple", "name": "Royal Purple", "bg": "#1A0A28",
     "face": "#F0E0FF", "face_shade": "#C8A0E0", "dark": "#5A2080", "dark_hi": "#8A48B0",
     "belly": "#F8F0FF", "eye": "#2A0840", "nose": "#401060", "line": "#301050",
     "accent": "#C080FF", "accessory": "jewel"},
    {"id": "09", "slug": "Panda_Camo_Ops", "name": "Camo Ops", "bg": "#3A4030",
     "face": "#C8C8A8", "face_shade": "#909070", "dark": "#3A4A28", "dark_hi": "#5A6A40",
     "belly": "#B8B898", "eye": "#1A2010", "nose": "#2A3018", "line": "#1A2010",
     "accent": "#6A8050", "accessory": "bandana"},
    {"id": "10", "slug": "Panda_Chrome_Holo", "name": "Chrome Holo", "bg": "#101018",
     "face": "#E8EEF8", "face_shade": "#A8B8D0", "dark": "#687898", "dark_hi": "#A0B0C8",
     "belly": "#F0F4FA", "eye": "#203040", "nose": "#405060", "line": "#304050",
     "accent": "#80FFE0", "accessory": "glasses"},
    {"id": "11", "slug": "Panda_Vampire_Noir", "name": "Vampire Noir", "bg": "#120808",
     "face": "#F5E8E8", "face_shade": "#D0A8A8", "dark": "#2A0808", "dark_hi": "#5A1818",
     "belly": "#FAF0F0", "eye": "#8B0000", "nose": "#400808", "line": "#200404",
     "accent": "#C00020", "accessory": "fangs"},
    {"id": "12", "slug": "Panda_Ocean_Aqua", "name": "Ocean Aqua", "bg": "#083040",
     "face": "#D8F8F8", "face_shade": "#70C0C8", "dark": "#106878", "dark_hi": "#30A0B0",
     "belly": "#E8FFFF", "eye": "#043040", "nose": "#085060", "line": "#064850",
     "accent": "#40E0E0", "accessory": "bubbles"},
    {"id": "13", "slug": "Panda_Sunset_Glow", "name": "Sunset Glow", "bg": "#402018",
     "face": "#FFE8D0", "face_shade": "#F0A878", "dark": "#D06030", "dark_hi": "#F09050",
     "belly": "#FFF0E0", "eye": "#502010", "nose": "#803020", "line": "#602018",
     "accent": "#FF8050", "accessory": "sunglasses"},
    {"id": "14", "slug": "Panda_Forest_Moss", "name": "Forest Moss", "bg": "#1A2818",
     "face": "#E8F0D8", "face_shade": "#A0B880", "dark": "#2A4820", "dark_hi": "#4A7040",
     "belly": "#F0F8E8", "eye": "#102008", "nose": "#203818", "line": "#183010",
     "accent": "#70A050", "accessory": "leaf"},
    {"id": "15", "slug": "Panda_Cotton_Candy", "name": "Cotton Candy", "bg": "#E8D8FF",
     "face": "#FFF8FF", "face_shade": "#E0C0F0", "dark": "#90B0FF", "dark_hi": "#C0D0FF",
     "belly": "#FFF0F8", "eye": "#504080", "nose": "#8060B0", "line": "#6850A0",
     "accent": "#FF90C0", "accessory": "bow"},
    {"id": "16", "slug": "Panda_Steampunk", "name": "Steampunk", "bg": "#2A2010",
     "face": "#E8D8B8", "face_shade": "#B89868", "dark": "#6A4820", "dark_hi": "#A07840",
     "belly": "#F0E4C8", "eye": "#302010", "nose": "#503820", "line": "#403018",
     "accent": "#C09040", "accessory": "goggles"},
    {"id": "17", "slug": "Panda_Galaxy", "name": "Galaxy", "bg": "#080818",
     "face": "#1A1040", "face_shade": "#302068", "dark": "#6A40C0", "dark_hi": "#A070FF",
     "belly": "#241850", "eye": "#FFE080", "nose": "#C0A0FF", "line": "#8060E0",
     "accent": "#FF80E0", "accessory": "stars"},
    {"id": "18", "slug": "Panda_Invert", "name": "Invert", "bg": "#222222",
     "face": "#1A1A1A", "face_shade": "#333333", "dark": "#F0F0F0", "dark_hi": "#FFFFFF",
     "belly": "#111111", "eye": "#FFFFFF", "nose": "#E0E0E0", "line": "#FFFFFF",
     "accent": None, "accessory": None},
    {"id": "19", "slug": "Panda_Mint_Pastel", "name": "Mint Pastel", "bg": "#D8F0E8",
     "face": "#F4FFF8", "face_shade": "#A8D8C8", "dark": "#50A088", "dark_hi": "#80C8B0",
     "belly": "#ECFFF4", "eye": "#204838", "nose": "#387860", "line": "#286850",
     "accent": "#70D0B0", "accessory": None},
    {"id": "20", "slug": "Panda_Lava_Magma", "name": "Lava Magma", "bg": "#1A0800",
     "face": "#3A2010", "face_shade": "#5A3018", "dark": "#FF4000", "dark_hi": "#FF9040",
     "belly": "#4A2818", "eye": "#FFEE80", "nose": "#FF6020", "line": "#FF5010",
     "accent": "#FFAA00", "accessory": "cracks"},
    {"id": "21", "slug": "Panda_Shadow", "name": "Shadow", "bg": "#0A0A0A",
     "face": "#2A2A2A", "face_shade": "#1A1A1A", "dark": "#050505", "dark_hi": "#3A3A3A",
     "belly": "#222222", "eye": "#88FFAA", "nose": "#111111", "line": "#444444",
     "accent": "#66EE88", "accessory": None},
    {"id": "22", "slug": "Panda_Rainbow", "name": "Rainbow", "bg": "#101018",
     "face": "#FFFFFF", "face_shade": "#E0E0F0", "dark": "#FF4080", "dark_hi": "#FF80B0",
     "belly": "#FFF8FF", "eye": "#203060", "nose": "#404080", "line": "#303060",
     "accent": "#40C0FF", "accessory": "rainbow",
     "ear_colors": ("#FF4040", "#FFB040"), "patch_colors": ("#40C040", "#4080FF")},
    {"id": "23", "slug": "Panda_Retro_80s", "name": "Retro 80s", "bg": "#180828",
     "face": "#FFE0F0", "face_shade": "#E090C0", "dark": "#FF2080", "dark_hi": "#FF60B0",
     "belly": "#FFF0F8", "eye": "#200840", "nose": "#8010A0", "line": "#601080",
     "accent": "#40F0FF", "accessory": "headphones"},
    {"id": "24", "slug": "Panda_Angelic", "name": "Angelic", "bg": "#F8F4E8",
     "face": "#FFFFFF", "face_shade": "#E8E0C8", "dark": "#D0C090", "dark_hi": "#F0E8C0",
     "belly": "#FFFCF0", "eye": "#806020", "nose": "#A08040", "line": "#908040",
     "accent": "#FFE080", "accessory": "halo"},
    {"id": "25", "slug": "Panda_Demon", "name": "Demon", "bg": "#180000",
     "face": "#2A0808", "face_shade": "#401010", "dark": "#8B0000", "dark_hi": "#C02020",
     "belly": "#1A0404", "eye": "#FF2200", "nose": "#600000", "line": "#FF3030",
     "accent": "#FF4400", "accessory": "horns"},
    {"id": "26", "slug": "Panda_Robot", "name": "Robot", "bg": "#1A1E24",
     "face": "#C0C8D0", "face_shade": "#889098", "dark": "#405060", "dark_hi": "#708090",
     "belly": "#D0D8E0", "eye": "#00FF88", "nose": "#506070", "line": "#304050",
     "accent": "#00D0FF", "accessory": "antenna"},
    {"id": "27", "slug": "Panda_Glitch_RGB", "name": "Glitch RGB", "bg": "#0A0A0A",
     "face": "#FFFFFF", "face_shade": "#D0D0D0", "dark": "#111111", "dark_hi": "#333333",
     "belly": "#F8F8F8", "eye": "#111111", "nose": "#111111", "line": "#111111",
     "accent": "#FF0040", "accessory": "glitch"},
    {"id": "28", "slug": "Panda_Bamboo_Sage", "name": "Bamboo Sage", "bg": "#E8F0D8",
     "face": "#FFFFF8", "face_shade": "#D0D8B8", "dark": "#2A2A2A", "dark_hi": "#4A4A4A",
     "belly": "#F8FFF0", "eye": "#111111", "nose": "#222222", "line": "#1A1A1A",
     "accent": "#6A9040", "accessory": "bamboo"},
    {"id": "29", "slug": "Panda_Candy_Pop", "name": "Candy Pop", "bg": "#FFF0F8",
     "face": "#FFFFFF", "face_shade": "#FFD0E0", "dark": "#FF60A0", "dark_hi": "#FFA0C8",
     "belly": "#FFF8FC", "eye": "#802050", "nose": "#E04080", "line": "#C03070",
     "accent": "#60E0FF", "accessory": "lollipop"},
    {"id": "30", "slug": "Panda_Sapphire", "name": "Sapphire", "bg": "#081028",
     "face": "#E8F0FF", "face_shade": "#90B0E0", "dark": "#1040A0", "dark_hi": "#4080E0",
     "belly": "#F0F6FF", "eye": "#081848", "nose": "#183878", "line": "#102868",
     "accent": "#60A0FF", "accessory": "tiara"},
]


def accessory_svg(kind: str | None, s: dict) -> str:
    if not kind:
        return ""
    a = s.get("accent") or s["dark_hi"]
    line = s["line"]

    if kind == "crown":
        return f"""
  <g id="acc-crown">
    <path d="M350,230 L385,155 L430,210 L512,130 L594,210 L639,155 L674,230 Z"
          fill="{a}" stroke="{line}" stroke-width="8" stroke-linejoin="round"/>
    <circle cx="430" cy="185" r="11" fill="#FF4040"/>
    <circle cx="512" cy="155" r="13" fill="#40A0FF"/>
    <circle cx="594" cy="185" r="11" fill="#40FF80"/>
  </g>"""
    if kind == "visor":
        return f"""
  <g id="acc-visor">
    <rect x="340" y="315" width="344" height="78" rx="20"
          fill="{a}" fill-opacity="0.45" stroke="{s['dark']}" stroke-width="7"/>
    <line x1="512" y1="315" x2="512" y2="393" stroke="{s['dark']}" stroke-width="4" opacity="0.45"/>
  </g>"""
    if kind == "snowflake":
        return f"""
  <g id="acc-snow" stroke="{a}" stroke-width="5" stroke-linecap="round">
    <line x1="780" y1="240" x2="840" y2="300"/><line x1="840" y1="240" x2="780" y2="300"/>
    <line x1="810" y1="230" x2="810" y2="310"/><line x1="770" y1="270" x2="850" y2="270"/>
    <line x1="170" y1="320" x2="230" y2="380"/><line x1="230" y1="320" x2="170" y2="380"/>
  </g>"""
    if kind == "flame":
        return f"""
  <g id="acc-flame">
    <path d="M190,290 C165,240 195,180 235,170 C255,205 245,245 270,270 C245,255 215,280 190,290 Z"
          fill="{a}" stroke="{line}" stroke-width="5"/>
    <path d="M830,300 C855,250 825,190 785,180 C765,215 775,255 750,280 C775,265 805,290 830,300 Z"
          fill="{s['dark']}" stroke="{line}" stroke-width="5"/>
  </g>"""
    if kind == "scar":
        return f"""
  <g id="acc-scar" stroke="{a}" stroke-width="5" stroke-linecap="round">
    <line x1="560" y1="290" x2="630" y2="360"/>
    <line x1="572" y1="286" x2="566" y2="302"/>
    <line x1="598" y1="314" x2="592" y2="330"/>
    <line x1="624" y1="342" x2="618" y2="358"/>
  </g>"""
    if kind == "flower":
        return f"""
  <g id="acc-flower" transform="translate(640,200)">
    <circle cx="0" cy="-20" r="15" fill="{a}"/>
    <circle cx="18" cy="-6" r="15" fill="{a}"/>
    <circle cx="12" cy="16" r="15" fill="{a}"/>
    <circle cx="-12" cy="16" r="15" fill="{a}"/>
    <circle cx="-18" cy="-6" r="15" fill="{a}"/>
    <circle cx="0" cy="0" r="11" fill="#FFE060"/>
  </g>"""
    if kind == "jewel":
        return f"""
  <g id="acc-jewel">
    <path d="M512,275 L545,318 L512,360 L479,318 Z" fill="{a}" stroke="{line}" stroke-width="5"/>
  </g>"""
    if kind == "bandana":
        return f"""
  <g id="acc-bandana">
    <path d="M285,275 C370,225 450,215 512,215 C574,215 654,225 739,275
             L720,320 C640,275 570,262 512,262 C454,262 384,275 304,320 Z"
          fill="{a}" stroke="{line}" stroke-width="6"/>
    <path d="M710,280 L780,330 L745,365 L695,320 Z" fill="{s['dark']}" stroke="{line}" stroke-width="5"/>
  </g>"""
    if kind == "glasses":
        return f"""
  <g id="acc-glasses" fill="none" stroke="{a}" stroke-width="9">
    <circle cx="410" cy="340" r="52"/>
    <circle cx="614" cy="340" r="52"/>
    <line x1="462" y1="340" x2="562" y2="340"/>
    <line x1="358" y1="330" x2="310" y2="318"/>
    <line x1="666" y1="330" x2="714" y2="318"/>
  </g>"""
    if kind == "fangs":
        return f"""
  <g id="acc-fangs">
    <path d="M468,470 L476,508 L486,470 Z" fill="{s['face']}" stroke="{line}" stroke-width="3"/>
    <path d="M538,470 L548,508 L558,470 Z" fill="{s['face']}" stroke="{line}" stroke-width="3"/>
  </g>"""
    if kind == "bubbles":
        return f"""
  <g id="acc-bubbles" fill="none" stroke="{a}" stroke-width="5">
    <circle cx="185" cy="430" r="20"/><circle cx="155" cy="500" r="11"/>
    <circle cx="840" cy="390" r="16"/><circle cx="870" cy="460" r="24"/>
  </g>"""
    if kind == "sunglasses":
        return f"""
  <g id="acc-sunglasses">
    <path d="M340,320 L475,320 L475,375 Q410,400 340,375 Z" fill="{s['dark']}" stroke="{line}" stroke-width="6"/>
    <path d="M549,320 L684,320 L684,375 Q619,400 549,375 Z" fill="{s['dark']}" stroke="{line}" stroke-width="6"/>
    <line x1="475" y1="345" x2="549" y2="345" stroke="{line}" stroke-width="7"/>
  </g>"""
    if kind == "leaf":
        return f"""
  <g id="acc-leaf">
    <path d="M165,380 C145,310 195,260 255,285 C240,330 210,365 165,380 Z"
          fill="{a}" stroke="{line}" stroke-width="5"/>
  </g>"""
    if kind == "bow":
        return f"""
  <g id="acc-bow">
    <path d="M455,235 C410,200 385,245 420,270 C445,255 455,245 455,235 Z" fill="{a}" stroke="{line}" stroke-width="5"/>
    <path d="M569,235 C614,200 639,245 604,270 C579,255 569,245 569,235 Z" fill="{a}" stroke="{line}" stroke-width="5"/>
    <circle cx="512" cy="248" r="15" fill="{s['dark']}" stroke="{line}" stroke-width="4"/>
  </g>"""
    if kind == "goggles":
        return f"""
  <g id="acc-goggles">
    <circle cx="410" cy="340" r="56" fill="{a}" fill-opacity="0.3" stroke="{a}" stroke-width="11"/>
    <circle cx="614" cy="340" r="56" fill="{a}" fill-opacity="0.3" stroke="{a}" stroke-width="11"/>
    <rect x="466" y="330" width="92" height="20" rx="4" fill="{a}"/>
  </g>"""
    if kind == "stars":
        return f"""
  <g id="acc-stars" fill="{a}">
    <path d="M170,250 l7,20 20,0 -16,13 7,20 -18,-13 -18,13 7,-20 -16,-13 20,0 z"/>
    <path d="M830,310 l6,16 16,0 -13,10 6,16 -15,-10 -15,10 6,-16 -13,-10 16,0 z"/>
    <path d="M760,190 l5,14 14,0 -11,9 5,14 -13,-9 -13,9 5,-14 -11,-9 14,0 z"/>
  </g>"""
    if kind == "rainbow":
        return f"""
  <g id="acc-rainbow" fill="none" stroke-width="11" stroke-linecap="round">
    <path d="M300,250 C380,175 450,155 512,155 C574,155 644,175 724,250" stroke="#FF4040"/>
    <path d="M312,268 C386,200 450,180 512,180 C574,180 638,200 712,268" stroke="#FFB040"/>
    <path d="M324,286 C392,225 450,205 512,205 C574,205 632,225 700,286" stroke="#40C040"/>
    <path d="M336,304 C398,250 450,230 512,230 C574,230 626,250 688,304" stroke="#4080FF"/>
    <path d="M348,322 C404,275 450,255 512,255 C574,255 620,275 676,322" stroke="#9040FF"/>
  </g>"""
    if kind == "headphones":
        return f"""
  <g id="acc-headphones">
    <path d="M285,340 C285,210 410,155 512,155 C614,155 739,210 739,340"
          fill="none" stroke="{a}" stroke-width="20" stroke-linecap="round"/>
    <rect x="230" y="315" width="78" height="120" rx="24" fill="{s['dark']}" stroke="{line}" stroke-width="6"/>
    <rect x="716" y="315" width="78" height="120" rx="24" fill="{s['dark']}" stroke="{line}" stroke-width="6"/>
  </g>"""
    if kind == "halo":
        return f"""
  <g id="acc-halo">
    <ellipse cx="512" cy="165" rx="130" ry="30" fill="none" stroke="{a}" stroke-width="15"/>
    <ellipse cx="512" cy="165" rx="130" ry="30" fill="none" stroke="#FFFFFF" stroke-width="5" opacity="0.7"/>
  </g>"""
    if kind == "horns":
        return f"""
  <g id="acc-horns">
    <path d="M330,250 C285,170 260,120 300,95 C335,145 360,195 375,245 Z"
          fill="{s['dark']}" stroke="{line}" stroke-width="6"/>
    <path d="M694,250 C739,170 764,120 724,95 C689,145 664,195 649,245 Z"
          fill="{s['dark']}" stroke="{line}" stroke-width="6"/>
  </g>"""
    if kind == "antenna":
        return f"""
  <g id="acc-antenna">
    <line x1="512" y1="235" x2="512" y2="130" stroke="{a}" stroke-width="9" stroke-linecap="round"/>
    <circle cx="512" cy="115" r="18" fill="{s.get('eye', a)}" stroke="{line}" stroke-width="5"/>
  </g>"""
    if kind == "glitch":
        return ""  # handled as underlay in render_skin
    if kind == "bamboo":
        return f"""
  <g id="acc-bamboo">
    <rect x="145" y="300" width="32" height="300" rx="9" fill="{a}" stroke="{line}" stroke-width="5"/>
    <line x1="145" y1="385" x2="177" y2="385" stroke="{line}" stroke-width="4"/>
    <line x1="145" y1="470" x2="177" y2="470" stroke="{line}" stroke-width="4"/>
    <path d="M177,345 C230,320 255,295 270,255" fill="none" stroke="{a}" stroke-width="9" stroke-linecap="round"/>
  </g>"""
    if kind == "lollipop":
        return f"""
  <g id="acc-lollipop">
    <circle cx="845" cy="440" r="52" fill="{a}" stroke="{line}" stroke-width="6"/>
    <circle cx="845" cy="440" r="30" fill="{s['dark']}" opacity="0.35"/>
    <line x1="845" y1="492" x2="845" y2="620" stroke="#E8D0A0" stroke-width="11" stroke-linecap="round"/>
  </g>"""
    if kind == "tiara":
        return f"""
  <g id="acc-tiara">
    <path d="M365,245 C430,190 475,175 512,175 C549,175 594,190 659,245"
          fill="none" stroke="{a}" stroke-width="13" stroke-linecap="round"/>
    <circle cx="512" cy="162" r="15" fill="#E0F0FF" stroke="{line}" stroke-width="4"/>
    <circle cx="445" cy="188" r="10" fill="#A0C8FF" stroke="{line}" stroke-width="3"/>
    <circle cx="579" cy="188" r="10" fill="#A0C8FF" stroke="{line}" stroke-width="3"/>
  </g>"""
    if kind == "cracks":
        return f"""
  <g id="acc-cracks" stroke="{a}" stroke-width="5" fill="none" stroke-linecap="round">
    <path d="M295,390 L340,425 L318,470 L365,515"/>
    <path d="M720,370 L685,415 L710,460"/>
    <path d="M470,575 L495,620 L480,670"/>
  </g>"""
    return ""


def _blush(s: dict, accent: str | None) -> str:
    if not accent or s["slug"] not in {
        "Panda_Sakura_Pink", "Panda_Cotton_Candy", "Panda_Candy_Pop", "Panda_Angelic",
    }:
        return ""
    return (
        f'<ellipse cx="345" cy="430" rx="26" ry="14" fill="{accent}" opacity="0.35"/>\n'
        f'  <ellipse cx="679" cy="430" rx="26" ry="14" fill="{accent}" opacity="0.35"/>'
    )


def render_skin(s: dict) -> str:
    ear_l = s.get("ear_colors", (s["dark"], s["dark"]))[0]
    ear_r = s.get("ear_colors", (s["dark"], s["dark"]))[1]
    patch_l = s.get("patch_colors", (s["dark"], s["dark"]))[0]
    patch_r = s.get("patch_colors", (s["dark"], s["dark"]))[1]
    hi, face, shade = s["dark_hi"], s["face"], s["face_shade"]
    belly_c, eye, nose, line, dark = s["belly"], s["eye"], s["nose"], s["line"], s["dark"]
    accent = s.get("accent")

    glitch = ""
    if s.get("accessory") == "glitch":
        glitch = f"""
  <g opacity="0.32" transform="translate(-14,5)"><path d="{head_path()}" fill="#FF0040"/></g>
  <g opacity="0.32" transform="translate(14,-5)"><path d="{head_path()}" fill="#00FFFF"/></g>"""

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <title>PIXEL TRIP — {s["slug"]} ({s["name"]})</title>
  <desc>Vector NFT skin. Pose and base form locked to original panda character.</desc>
  <rect width="100%" height="100%" fill="{s["bg"]}"/>
{glitch}
  <!-- Body -->
  <path d="{body_path()}" fill="{dark}" stroke="{line}" stroke-width="11" stroke-linejoin="round"/>
  <path d="M250,760 C320,700 400,670 480,660" fill="none" stroke="{hi}" stroke-width="16" stroke-linecap="round" opacity="0.4"/>
  <path d="M774,760 C704,700 624,670 544,660" fill="none" stroke="{hi}" stroke-width="14" stroke-linecap="round" opacity="0.3"/>

  <!-- Belly -->
  <path d="{belly_path()}" fill="{belly_c}" stroke="{line}" stroke-width="9" stroke-linejoin="round"/>
  <path d="M370,720 C440,690 520,682 600,700" fill="none" stroke="{shade}" stroke-width="20" stroke-linecap="round" opacity="0.5"/>

  <!-- Ears (behind head edge slightly overlapping) -->
  <path d="{ear_left()}" fill="{ear_l}" stroke="{line}" stroke-width="9"/>
  <path d="M330,230 C345,215 370,212 390,225" fill="none" stroke="{hi}" stroke-width="9" stroke-linecap="round" opacity="0.45"/>
  <path d="{ear_right()}" fill="{ear_r}" stroke="{line}" stroke-width="9"/>
  <path d="M694,230 C679,215 654,212 634,225" fill="none" stroke="{hi}" stroke-width="9" stroke-linecap="round" opacity="0.45"/>

  <!-- Head -->
  <path d="{head_path()}" fill="{face}" stroke="{line}" stroke-width="11" stroke-linejoin="round"/>
  <path d="M320,430 C335,540 390,610 480,640" fill="none" stroke="{shade}" stroke-width="34" stroke-linecap="round" opacity="0.5"/>
  <path d="M700,420 C685,535 640,605 555,635" fill="none" stroke="{shade}" stroke-width="26" stroke-linecap="round" opacity="0.35"/>

  <!-- Eye patches -->
  <path d="{patch_left()}" fill="{patch_l}" stroke="{line}" stroke-width="6"/>
  <path d="{patch_right()}" fill="{patch_r}" stroke="{line}" stroke-width="6"/>
  <path d="M380,295 C400,282 425,288 440,305" fill="none" stroke="{hi}" stroke-width="8" stroke-linecap="round" opacity="0.4"/>
  <path d="M644,295 C624,282 599,288 584,305" fill="none" stroke="{hi}" stroke-width="8" stroke-linecap="round" opacity="0.4"/>

  <!-- Eyes -->
  <circle cx="410" cy="335" r="38" fill="{eye}"/>
  <circle cx="614" cy="335" r="38" fill="{eye}"/>
  <circle cx="396" cy="318" r="12" fill="#FFFFFF" opacity="0.95"/>
  <circle cx="600" cy="318" r="12" fill="#FFFFFF" opacity="0.95"/>
  <circle cx="420" cy="345" r="6" fill="#FFFFFF" opacity="0.85"/>
  <circle cx="624" cy="345" r="6" fill="#FFFFFF" opacity="0.85"/>

  <!-- Nose -->
  <path d="M492,415 L532,415 L512,445 Z" fill="{nose}" stroke="{line}" stroke-width="4" stroke-linejoin="round"/>

  <!-- W-smile + chin dimple -->
  <path d="M448,468 C470,495 495,508 512,508 C529,508 554,495 576,468"
        fill="none" stroke="{line}" stroke-width="9" stroke-linecap="round"/>
  <path d="M485,508 Q512,530 539,508" fill="none" stroke="{line}" stroke-width="7" stroke-linecap="round"/>
  <path d="M512,545 Q498,562 512,575 Q526,562 512,545" fill="none" stroke="{line}" stroke-width="6" opacity="0.75"/>

{accessory_svg(s.get("accessory"), s)}
  {_blush(s, accent)}
</svg>
'''


def main() -> None:
    OUT_SVG.mkdir(parents=True, exist_ok=True)
    manifest = []
    for s in SKINS:
        svg = render_skin(s)
        svg_path = OUT_SVG / f"{s['slug']}.svg"
        png_path = OUT_PNG / f"{s['slug']}.png"
        svg_path.write_text(svg, encoding="utf-8")
        cairosvg.svg2png(
            bytestring=svg.encode("utf-8"),
            write_to=str(png_path),
            output_width=SIZE,
            output_height=SIZE,
        )
        manifest.append(
            {
                "id": s["id"],
                "slug": s["slug"],
                "name": s["name"],
                "svg": str(svg_path.relative_to(ROOT)),
                "png": str(png_path.relative_to(ROOT)),
                "accessory": s.get("accessory"),
            }
        )
        print(f"OK {s['id']} {s['slug']}")
    (OUT_SVG / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(manifest)} skins → {OUT_SVG}")


if __name__ == "__main__":
    main()
