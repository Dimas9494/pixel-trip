#!/usr/bin/env python3
"""30 vector NFT skins traced from the reference panda (pose and form locked)."""

from __future__ import annotations

import json
from pathlib import Path

import cairosvg
import cv2
import numpy as np
from potrace import Bitmap

ROOT = Path(__file__).resolve().parents[1]
OUT_SVG = ROOT / "Characters" / "Panda_Vector_Skins"
OUT_PNG = ROOT / "Characters"
REF = OUT_SVG / "reference_original.jpg"
SIZE = 1024

SKINS: list[dict] = [
    {"id": "01", "slug": "Panda_Classic", "name": "Classic", "bg": "#C8C8C8",
     "face": "#FFFFFF", "belly": "#FFFFFF", "dark": "#1C1C1C", "line": "#111111",
     "eye": "#111111", "accent": "#FFFFFF", "accessory": None},
    {"id": "02", "slug": "Panda_Golden", "name": "Golden", "bg": "#1A1408",
     "face": "#FFF4C8", "belly": "#FFF8DC", "dark": "#8A6410", "line": "#3A2800",
     "eye": "#3A2800", "accent": "#FFD24A", "accessory": "crown"},
    {"id": "03", "slug": "Panda_Cyber_Neon", "name": "Cyber Neon", "bg": "#070712",
     "face": "#102033", "belly": "#0C1A2A", "dark": "#14F1FF", "line": "#E8FCFF",
     "eye": "#FF2AA6", "accent": "#FF2AA6", "accessory": "visor"},
    {"id": "04", "slug": "Panda_Ice_Frost", "name": "Ice Frost", "bg": "#D5ECFA",
     "face": "#F7FCFF", "belly": "#EEF7FF", "dark": "#3E74A8", "line": "#1C3E60",
     "eye": "#16324C", "accent": "#B9E4FF", "accessory": "snowflake"},
    {"id": "05", "slug": "Panda_Fire_Ember", "name": "Fire Ember", "bg": "#2A0C00",
     "face": "#FFE3AE", "belly": "#FFF0C8", "dark": "#C42A00", "line": "#4A1200",
     "eye": "#3A1000", "accent": "#FF9A1A", "accessory": "flame"},
    {"id": "06", "slug": "Panda_Toxic_Zombie", "name": "Toxic Zombie", "bg": "#141C0E",
     "face": "#D2E89A", "belly": "#E4F4B4", "dark": "#35541E", "line": "#142408",
     "eye": "#B6FF2A", "accent": "#9BFF22", "accessory": "scar"},
    {"id": "07", "slug": "Panda_Sakura_Pink", "name": "Sakura Pink", "bg": "#FFE6F0",
     "face": "#FFF7FA", "belly": "#FFEAF2", "dark": "#E15B90", "line": "#8E2450",
     "eye": "#6E1838", "accent": "#FFB3CC", "accessory": "flower"},
    {"id": "08", "slug": "Panda_Royal_Purple", "name": "Royal Purple", "bg": "#160820",
     "face": "#F3E6FF", "belly": "#F8F0FF", "dark": "#5C2284", "line": "#2A0844",
     "eye": "#24063C", "accent": "#C58BFF", "accessory": "jewel"},
    {"id": "09", "slug": "Panda_Camo_Ops", "name": "Camo Ops", "bg": "#3C4032",
     "face": "#D0CDB0", "belly": "#C2BEA0", "dark": "#3C4A28", "line": "#1A2010",
     "eye": "#141C0C", "accent": "#6E8450", "accessory": "bandana"},
    {"id": "10", "slug": "Panda_Chrome_Holo", "name": "Chrome Holo", "bg": "#12141C",
     "face": "#EEF3FA", "belly": "#F4F7FC", "dark": "#6E7E98", "line": "#2C3848",
     "eye": "#1C2834", "accent": "#8CFFE4", "accessory": "glasses"},
    {"id": "11", "slug": "Panda_Vampire_Noir", "name": "Vampire Noir", "bg": "#140808",
     "face": "#F6EAEA", "belly": "#FBF2F2", "dark": "#2A0A0A", "line": "#140404",
     "eye": "#9A0000", "accent": "#C40022", "accessory": "fangs"},
    {"id": "12", "slug": "Panda_Ocean_Aqua", "name": "Ocean Aqua", "bg": "#083040",
     "face": "#E2FBFB", "belly": "#F0FFFF", "dark": "#0E6878", "line": "#043038",
     "eye": "#042838", "accent": "#3FE0E0", "accessory": "bubbles"},
    {"id": "13", "slug": "Panda_Sunset_Glow", "name": "Sunset Glow", "bg": "#402018",
     "face": "#FFE8D0", "belly": "#FFF1E2", "dark": "#D06030", "line": "#4A1C10",
     "eye": "#401808", "accent": "#FF8A4A", "accessory": "sunglasses"},
    {"id": "14", "slug": "Panda_Forest_Moss", "name": "Forest Moss", "bg": "#1A2818",
     "face": "#EAF3DC", "belly": "#F3FAEA", "dark": "#2C4A22", "line": "#142810",
     "eye": "#102008", "accent": "#6EA050", "accessory": "leaf"},
    {"id": "15", "slug": "Panda_Cotton_Candy", "name": "Cotton Candy", "bg": "#E6D6FF",
     "face": "#FFF8FF", "belly": "#FFF0F8", "dark": "#8EAEFF", "line": "#4C3C84",
     "eye": "#3C3068", "accent": "#FF8EC4", "accessory": "bow"},
    {"id": "16", "slug": "Panda_Steampunk", "name": "Steampunk", "bg": "#2A2010",
     "face": "#EAD8B6", "belly": "#F3E6CC", "dark": "#6A4820", "line": "#342414",
     "eye": "#241808", "accent": "#C4963C", "accessory": "goggles"},
    {"id": "17", "slug": "Panda_Galaxy", "name": "Galaxy", "bg": "#070714",
     "face": "#1A1040", "belly": "#221650", "dark": "#7044C8", "line": "#C8B0FF",
     "eye": "#FFE080", "accent": "#FF80E0", "accessory": "stars"},
    {"id": "18", "slug": "Panda_Invert", "name": "Invert", "bg": "#1A1A1A",
     "face": "#161616", "belly": "#101010", "dark": "#F2F2F2", "line": "#FFFFFF",
     "eye": "#FFFFFF", "accent": "#FFFFFF", "accessory": None},
    {"id": "19", "slug": "Panda_Mint_Pastel", "name": "Mint Pastel", "bg": "#D7F1E8",
     "face": "#F6FFFA", "belly": "#EEFFF6", "dark": "#4A9E86", "line": "#1C4838",
     "eye": "#184034", "accent": "#74D4B4", "accessory": None},
    {"id": "20", "slug": "Panda_Lava_Magma", "name": "Lava Magma", "bg": "#140600",
     "face": "#3A2010", "belly": "#4A2814", "dark": "#FF3C00", "line": "#FFB060",
     "eye": "#FFE680", "accent": "#FFAA00", "accessory": "cracks"},
    {"id": "21", "slug": "Panda_Shadow", "name": "Shadow", "bg": "#080808",
     "face": "#242424", "belly": "#1A1A1A", "dark": "#050505", "line": "#3A3A3A",
     "eye": "#8CFFAA", "accent": "#66EE88", "accessory": None},
    {"id": "22", "slug": "Panda_Rainbow", "name": "Rainbow", "bg": "#101018",
     "face": "#FFFFFF", "belly": "#FFF8FF", "dark": "#FF4080", "line": "#241848",
     "eye": "#203060", "accent": "#40C0FF", "accessory": "rainbow",
     "patch_l": "#3CC43C", "patch_r": "#3C78FF", "ear_l": "#FF4040", "ear_r": "#FFB040"},
    {"id": "23", "slug": "Panda_Retro_80s", "name": "Retro 80s", "bg": "#160826",
     "face": "#FFE4F2", "belly": "#FFF0F8", "dark": "#FF2088", "line": "#401060",
     "eye": "#180828", "accent": "#3DF0FF", "accessory": "headphones"},
    {"id": "24", "slug": "Panda_Angelic", "name": "Angelic", "bg": "#F7F3E6",
     "face": "#FFFFFF", "belly": "#FFFCF2", "dark": "#D2C28E", "line": "#6E5A28",
     "eye": "#6A5018", "accent": "#FFE080", "accessory": "halo"},
    {"id": "25", "slug": "Panda_Demon", "name": "Demon", "bg": "#140000",
     "face": "#2C0808", "belly": "#1A0404", "dark": "#9A1010", "line": "#FF3A3A",
     "eye": "#FF2A10", "accent": "#FF4400", "accessory": "horns"},
    {"id": "26", "slug": "Panda_Robot", "name": "Robot", "bg": "#1A1E24",
     "face": "#C4CCD4", "belly": "#D4DCE4", "dark": "#445868", "line": "#243040",
     "eye": "#00FF88", "accent": "#00D0FF", "accessory": "antenna"},
    {"id": "27", "slug": "Panda_Glitch_RGB", "name": "Glitch RGB", "bg": "#0A0A0A",
     "face": "#FFFFFF", "belly": "#F7F7F7", "dark": "#111111", "line": "#111111",
     "eye": "#111111", "accent": "#FF0044", "accessory": "glitch"},
    {"id": "28", "slug": "Panda_Bamboo_Sage", "name": "Bamboo Sage", "bg": "#E7F0D6",
     "face": "#FFFFFF", "belly": "#F7FFF0", "dark": "#222222", "line": "#141414",
     "eye": "#111111", "accent": "#6A9040", "accessory": "bamboo"},
    {"id": "29", "slug": "Panda_Candy_Pop", "name": "Candy Pop", "bg": "#FFF0F8",
     "face": "#FFFFFF", "belly": "#FFF7FC", "dark": "#FF5A9C", "line": "#A02058",
     "eye": "#701840", "accent": "#5AD8FF", "accessory": "lollipop"},
    {"id": "30", "slug": "Panda_Sapphire", "name": "Sapphire", "bg": "#081028",
     "face": "#EAF1FF", "belly": "#F3F7FF", "dark": "#123E9C", "line": "#0A2060",
     "eye": "#071640", "accent": "#5A9CFF", "accessory": "tiara"},
]


def _clean(mask: np.ndarray, min_area: int) -> np.ndarray:
    n, lab, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    out = np.zeros(mask.shape, np.uint8)
    for i in range(1, n):
        if int(stats[i, cv2.CC_STAT_AREA]) >= min_area:
            out[lab == i] = 255
    return out


def _path_from_mask(mask: np.ndarray, epsilon: float = 1.0, min_area: int = 8) -> str:
    """Smooth cubic trace. Bitmap() inverts its input, so the mask is flipped first."""
    bm = Bitmap(np.ascontiguousarray(~(mask > 0)))
    # turdsize drops JPEG specks; alphamax keeps the fur corners.
    curves = bm.trace(turdsize=max(min_area, 4), alphamax=1.0, opttolerance=0.15)
    parts: list[str] = []
    for curve in curves:
        start = curve.start_point
        if start is None:
            continue
        segs = [f"M {start.x:.2f},{start.y:.2f}"]
        for seg in curve:
            if seg.is_corner:
                segs.append(
                    f"L {seg.c.x:.2f},{seg.c.y:.2f} L {seg.end_point.x:.2f},{seg.end_point.y:.2f}"
                )
            else:
                segs.append(
                    f"C {seg.c1.x:.2f},{seg.c1.y:.2f} {seg.c2.x:.2f},{seg.c2.y:.2f} "
                    f"{seg.end_point.x:.2f},{seg.end_point.y:.2f}"
                )
        segs.append("Z")
        parts.append(" ".join(segs))
    return " ".join(parts)


def _component_masks(mask: np.ndarray, min_area: int) -> list[tuple[int, np.ndarray, tuple]]:
    n, lab, stats, cents = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    found = []
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        m = np.zeros(mask.shape, np.uint8)
        m[lab == i] = 255
        found.append((area, m, (float(cents[i][0]), float(cents[i][1]))))
    found.sort(key=lambda t: t[0], reverse=True)
    return found


def trace_reference(path: Path) -> dict:
    im = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if im is None:
        raise SystemExit(f"missing reference: {path}")
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    h, w = g.shape
    flood_mask = np.zeros((h + 2, w + 2), np.uint8)
    work = im.copy()
    cv2.floodFill(
        work, flood_mask, (4, 4), (0, 255, 0),
        (14, 14, 14), (14, 14, 14),
        cv2.FLOODFILL_FIXED_RANGE | 4,
    )
    bg = (work[:, :, 1] == 255) & (work[:, :, 0] == 0)
    grayish = (
        (np.abs(im[:, :, 0].astype(np.int16) - im[:, :, 1].astype(np.int16)) < 12)
        & (np.abs(im[:, :, 1].astype(np.int16) - im[:, :, 2].astype(np.int16)) < 12)
        & (g > 168)
        & (g < 228)
    )
    bg = bg | grayish
    char = ~bg
    dark = _clean((char & (g < 108)).astype(np.uint8) * 255, 28)
    white = _clean((char & (g >= 108) & (dark == 0)).astype(np.uint8) * 255, 40)

    white_parts = _component_masks(white, 36)
    face_m = belly_m = None
    sclera = []
    highlights = []
    for area, m, c in white_parts:
        if area > 20000 and c[1] < 700:
            face_m = m
        elif area > 20000:
            belly_m = m
        elif 350 <= area <= 4000 and 360 <= c[1] <= 560:
            sclera.append((area, m, c))
        elif area <= 350:
            highlights.append((area, m, c))
    if face_m is None or belly_m is None:
        raise SystemExit("failed to split face/belly from the reference")

    # Pupils sit in the middle of each eye-white. Circle is fitted to that white shape.
    pupils = []
    for area, m, c in sclera:
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not cnts:
            continue
        (px, py), pr = cv2.minEnclosingCircle(max(cnts, key=cv2.contourArea))
        pupils.append({"cx": float(px), "cy": float(py), "r": float(pr) * 0.58, "sclera": c})

    # Highlights near pupils.
    hilite = []
    for area, m, c in highlights:
        for p in pupils:
            if (c[0] - p["cx"]) ** 2 + (c[1] - p["cy"]) ** 2 < (p["r"] + 18) ** 2:
                cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                if not cnts:
                    continue
                (hx, hy), hr = cv2.minEnclosingCircle(cnts[0])
                hilite.append({"cx": float(hx), "cy": float(hy), "r": float(hr)})

    ys, xs = np.where(dark > 0)
    top = int(ys.min())
    face_ys, face_xs = np.where(face_m > 0)
    cx = float(np.median(face_xs))
    # Ears: dark mass above the brow line, split left/right.
    brow = int(np.percentile(face_ys, 18))
    ear_band = (dark > 0) & (np.arange(h)[:, None] < brow + 10)
    def _centroid(sel):
        yy, xx = np.where(sel)
        if len(xx) == 0:
            return None
        return (float(xx.mean()), float(yy.mean()))
    ear_l = _centroid(ear_band & (np.arange(w)[None, :] < cx))
    ear_r = _centroid(ear_band & (np.arange(w)[None, :] >= cx))

    landmarks = {
        "cx": cx,
        "top": float(top),
        "head_bottom": float(face_ys.max()),
        "face_left": float(face_xs.min()),
        "face_right": float(face_xs.max()),
        "ear_l": ear_l,
        "ear_r": ear_r,
        "eyes": pupils,
        "nose": (cx, float(np.median(face_ys)) + 20),
    }

    paths = {
        "face": _path_from_mask(face_m, 1.45, 20),
        "belly": _path_from_mask(belly_m, 1.45, 20),
        "dark": _path_from_mask(dark, 1.25, 10),
        "sclera": " ".join(_path_from_mask(m, 0.85, 8) for _, m, _ in sclera),
    }
    return {"paths": paths, "pupils": pupils, "highlights": hilite, "landmarks": landmarks}


def accessory_svg(kind: str | None, s: dict, lm: dict) -> str:
    if not kind:
        return ""
    a = s["accent"]
    line = s["line"]
    dark = s["dark"]
    cx = lm["cx"]
    top = lm["top"]
    el, er = lm["ear_l"], lm["ear_r"]
    eyes = lm["eyes"]
    # sort eyes left to right
    eyes = sorted(eyes, key=lambda p: p["cx"])
    if len(eyes) >= 2:
        ey = (eyes[0]["cy"] + eyes[1]["cy"]) / 2
        ex1, ex2 = eyes[0]["cx"], eyes[1]["cx"]
    else:
        ey, ex1, ex2 = 450.0, cx - 90, cx + 90

    if kind == "crown":
        yb = top + 18
        return f"""
  <path d="M{cx-150},{yb} L{cx-110},{yb-78} L{cx-60},{yb-28} L{cx},{yb-98} L{cx+60},{yb-28} L{cx+110},{yb-78} L{cx+150},{yb} Z"
        fill="{a}" stroke="{line}" stroke-width="7" stroke-linejoin="round"/>
  <circle cx="{cx-60}" cy="{yb-22}" r="9" fill="#FF4040"/>
  <circle cx="{cx}" cy="{yb-70}" r="11" fill="#3AA0FF"/>
  <circle cx="{cx+60}" cy="{yb-22}" r="9" fill="#3AD070"/>"""

    if kind == "visor":
        return f"""
  <rect x="{ex1-55}" y="{ey-28}" width="{ex2-ex1+110}" height="62" rx="16"
        fill="{a}" fill-opacity="0.45" stroke="{dark}" stroke-width="6"/>"""

    if kind == "snowflake":
        return f"""
  <g stroke="{a}" stroke-width="5" stroke-linecap="round" fill="none">
    <g transform="translate({er[0]+70},{er[1]-20})">
      <line x1="-28" y1="0" x2="28" y2="0"/><line x1="0" y1="-28" x2="0" y2="28"/>
      <line x1="-20" y1="-20" x2="20" y2="20"/><line x1="20" y1="-20" x2="-20" y2="20"/>
    </g>
    <g transform="translate({el[0]-70},{el[1]+30})">
      <line x1="-18" y1="0" x2="18" y2="0"/><line x1="0" y1="-18" x2="0" y2="18"/>
    </g>
  </g>"""

    if kind == "flame":
        return f"""
  <path d="M{el[0]-20},{el[1]} C{el[0]-50},{el[1]-50} {el[0]-20},{el[1]-110} {el[0]+10},{el[1]-120}
           C{el[0]+20},{el[1]-80} {el[0]+10},{el[1]-40} {el[0]+30},{el[1]-10} C{el[0]+5},{el[1]-20} {el[0]-5},{el[1]-5} {el[0]-20},{el[1]} Z"
        fill="{a}" stroke="{line}" stroke-width="5"/>
  <path d="M{er[0]+20},{er[1]} C{er[0]+50},{er[1]-50} {er[0]+20},{er[1]-110} {er[0]-10},{er[1]-120}
           C{er[0]-20},{er[1]-80} {er[0]-10},{er[1]-40} {er[0]-30},{er[1]-10} C{er[0]-5},{er[1]-20} {er[0]+5},{er[1]-5} {er[0]+20},{er[1]} Z"
        fill="{dark}" stroke="{line}" stroke-width="5"/>"""

    if kind == "scar":
        x, y = ex2 + 36, ey - 40
        return f"""
  <g stroke="{a}" stroke-width="5" stroke-linecap="round" fill="none">
    <line x1="{x}" y1="{y}" x2="{x+58}" y2="{y+64}"/>
    <line x1="{x+8}" y1="{y-2}" x2="{x+2}" y2="{y+12}"/>
    <line x1="{x+30}" y1="{y+24}" x2="{x+24}" y2="{y+38}"/>
    <line x1="{x+50}" y1="{y+48}" x2="{x+44}" y2="{y+62}"/>
  </g>"""

    if kind == "flower":
        fx, fy = er[0] - 10, top + 8
        return f"""
  <g transform="translate({fx},{fy})">
    <circle cx="0" cy="-16" r="13" fill="{a}"/>
    <circle cx="15" cy="-5" r="13" fill="{a}"/>
    <circle cx="9" cy="13" r="13" fill="{a}"/>
    <circle cx="-9" cy="13" r="13" fill="{a}"/>
    <circle cx="-15" cy="-5" r="13" fill="{a}"/>
    <circle cx="0" cy="0" r="9" fill="#FFE15A"/>
  </g>"""

    if kind == "jewel":
        jy = ey - 78
        return f"""
  <path d="M{cx},{jy-22} L{cx+22},{jy+8} L{cx},{jy+36} L{cx-22},{jy+8} Z" fill="{a}" stroke="{line}" stroke-width="4"/>"""

    if kind == "bandana":
        y = top + 55
        return f"""
  <path d="M{el[0]-10},{y+20} C{cx-80},{y-30} {cx},{y-40} {cx},{y-40} C{cx},{y-40} {cx+80},{y-30} {er[0]+10},{y+20}
           L{er[0]-10},{y+55} C{cx+70},{y+10} {cx},{y} {cx},{y} C{cx},{y} {cx-70},{y+10} {el[0]+10},{y+55} Z"
        fill="{a}" stroke="{line}" stroke-width="6"/>
  <path d="M{er[0]+8},{y+24} L{er[0]+70},{y+70} L{er[0]+30},{y+100} L{er[0]-8},{y+58} Z" fill="{dark}" stroke="{line}" stroke-width="5"/>"""

    if kind == "glasses":
        return f"""
  <g fill="none" stroke="{a}" stroke-width="8">
    <circle cx="{ex1}" cy="{ey}" r="{eyes[0]['r']+16}"/>
    <circle cx="{ex2}" cy="{ey}" r="{eyes[-1]['r']+16}"/>
    <line x1="{ex1+eyes[0]['r']+12}" y1="{ey}" x2="{ex2-eyes[1]['r']-12}" y2="{ey}"/>
  </g>"""

    if kind == "fangs":
        my = lm["head_bottom"] - 150
        return f"""
  <path d="M{cx-28},{my} L{cx-18},{my+32} L{cx-8},{my} Z" fill="{s['face']}" stroke="{line}" stroke-width="3"/>
  <path d="M{cx+8},{my} L{cx+18},{my+32} L{cx+28},{my} Z" fill="{s['face']}" stroke="{line}" stroke-width="3"/>"""

    if kind == "bubbles":
        return f"""
  <g fill="none" stroke="{a}" stroke-width="4">
    <circle cx="{el[0]-50}" cy="{ey+20}" r="16"/>
    <circle cx="{el[0]-78}" cy="{ey+70}" r="9"/>
    <circle cx="{er[0]+60}" cy="{ey-10}" r="12"/>
    <circle cx="{er[0]+90}" cy="{ey+50}" r="20"/>
  </g>"""

    if kind == "sunglasses":
        rw = (ex2 - ex1) * 0.42
        return f"""
  <path d="M{ex1-rw},{ey-18} L{ex1+rw},{ey-18} L{ex1+rw},{ey+22} Q{ex1},{ey+40} {ex1-rw},{ey+22} Z" fill="{dark}" stroke="{line}" stroke-width="5"/>
  <path d="M{ex2-rw},{ey-18} L{ex2+rw},{ey-18} L{ex2+rw},{ey+22} Q{ex2},{ey+40} {ex2-rw},{ey+22} Z" fill="{dark}" stroke="{line}" stroke-width="5"/>
  <line x1="{ex1+rw}" y1="{ey}" x2="{ex2-rw}" y2="{ey}" stroke="{line}" stroke-width="6"/>"""

    if kind == "leaf":
        return f"""
  <path d="M{el[0]-30},{ey} C{el[0]-70},{ey-70} {el[0]-10},{ey-120} {el[0]+30},{ey-100} C{el[0]+10},{ey-60} {el[0]-5},{ey-20} {el[0]-30},{ey} Z"
        fill="{a}" stroke="{line}" stroke-width="5"/>"""

    if kind == "bow":
        y = top + 36
        return f"""
  <path d="M{cx-20},{y} C{cx-70},{y-40} {cx-90},{y+10} {cx-40},{y+28} C{cx-28},{y+16} {cx-20},{y+8} {cx-20},{y} Z" fill="{a}" stroke="{line}" stroke-width="4"/>
  <path d="M{cx+20},{y} C{cx+70},{y-40} {cx+90},{y+10} {cx+40},{y+28} C{cx+28},{y+16} {cx+20},{y+8} {cx+20},{y} Z" fill="{a}" stroke="{line}" stroke-width="4"/>
  <circle cx="{cx}" cy="{y+12}" r="12" fill="{dark}" stroke="{line}" stroke-width="3"/>"""

    if kind == "goggles":
        return f"""
  <circle cx="{ex1}" cy="{ey}" r="{eyes[0]['r']+18}" fill="{a}" fill-opacity="0.28" stroke="{a}" stroke-width="10"/>
    <circle cx="{ex2}" cy="{ey}" r="{eyes[-1]['r']+18}" fill="{a}" fill-opacity="0.28" stroke="{a}" stroke-width="10"/>
  <rect x="{(ex1+ex2)/2-40}" y="{ey-8}" width="80" height="16" rx="4" fill="{a}"/>"""

    if kind == "stars":
        def star(x, y, r):
            return f'<path d="M{x},{y-r} L{x+r*0.25},{y-r*0.3} L{x+r},{y-r*0.25} L{x+r*0.4},{y+r*0.15} L{x+r*0.6},{y+r} L{x},{y+r*0.45} L{x-r*0.6},{y+r} L{x-r*0.4},{y+r*0.15} L{x-r},{y-r*0.25} L{x-r*0.25},{y-r*0.3} Z" fill="{a}"/>'
        return star(el[0] - 55, el[1] - 10, 16) + star(er[0] + 60, er[1] + 20, 12) + star(er[0] + 20, top - 6, 10)

    if kind == "rainbow":
        y = top + 70
        bands = ["#FF4040", "#FFB040", "#40C040", "#4080FF", "#9040FF"]
        out = []
        for i, col in enumerate(bands):
            rr = 210 - i * 16
            out.append(
                f'<path d="M{cx-rr},{y} A{rr},{rr} 0 0 1 {cx+rr},{y}" fill="none" stroke="{col}" stroke-width="10" stroke-linecap="round"/>'
            )
        return "\n".join(out)

    if kind == "headphones":
        return f"""
  <path d="M{el[0]},{el[1]+20} C{el[0]},{top-30} {cx},{top-55} {cx},{top-55} C{cx},{top-55} {er[0]},{top-30} {er[0]},{er[1]+20}"
        fill="none" stroke="{a}" stroke-width="16" stroke-linecap="round"/>
  <rect x="{el[0]-46}" y="{el[1]+6}" width="70" height="100" rx="20" fill="{dark}" stroke="{line}" stroke-width="5"/>
  <rect x="{er[0]-24}" y="{er[1]+6}" width="70" height="100" rx="20" fill="{dark}" stroke="{line}" stroke-width="5"/>"""

    if kind == "halo":
        return f"""
  <ellipse cx="{cx}" cy="{top-8}" rx="128" ry="28" fill="none" stroke="{a}" stroke-width="14"/>
  <ellipse cx="{cx}" cy="{top-8}" rx="128" ry="28" fill="none" stroke="#FFFFFF" stroke-width="4" opacity="0.75"/>"""

    if kind == "horns":
        return f"""
  <path d="M{el[0]+10},{el[1]-10} C{el[0]-20},{el[1]-80} {el[0]-10},{el[1]-150} {el[0]+36},{el[1]-160}
           C{el[0]+20},{el[1]-110} {el[0]+30},{el[1]-50} {el[0]+40},{el[1]+10} Z" fill="{dark}" stroke="{line}" stroke-width="5"/>
  <path d="M{er[0]-10},{er[1]-10} C{er[0]+20},{er[1]-80} {er[0]+10},{er[1]-150} {er[0]-36},{er[1]-160}
           C{er[0]-20},{er[1]-110} {er[0]-30},{er[1]-50} {er[0]-40},{er[1]+10} Z" fill="{dark}" stroke="{line}" stroke-width="5"/>"""

    if kind == "antenna":
        return f"""
  <line x1="{cx}" y1="{top+24}" x2="{cx}" y2="{top-70}" stroke="{a}" stroke-width="8" stroke-linecap="round"/>
  <circle cx="{cx}" cy="{top-82}" r="16" fill="{s['eye']}" stroke="{line}" stroke-width="4"/>"""

    if kind == "bamboo":
        x = lm["face_left"] - 36
        return f"""
  <rect x="{x}" y="{top+80}" width="30" height="280" rx="8" fill="{a}" stroke="{line}" stroke-width="5"/>
  <line x1="{x}" y1="{top+160}" x2="{x+30}" y2="{top+160}" stroke="{line}" stroke-width="4"/>
  <line x1="{x}" y1="{top+240}" x2="{x+30}" y2="{top+240}" stroke="{line}" stroke-width="4"/>
  <path d="M{x+30},{top+120} C{x+70},{top+100} {x+90},{top+70} {x+110},{top+40}" fill="none" stroke="{a}" stroke-width="8" stroke-linecap="round"/>"""

    if kind == "lollipop":
        x = lm["face_right"] + 48
        y = ey + 10
        return f"""
  <circle cx="{x}" cy="{y}" r="46" fill="{a}" stroke="{line}" stroke-width="6"/>
  <circle cx="{x}" cy="{y}" r="26" fill="{dark}" opacity="0.35"/>
  <line x1="{x}" y1="{y+46}" x2="{x}" y2="{y+150}" stroke="#E6C890" stroke-width="10" stroke-linecap="round"/>"""

    if kind == "tiara":
        y = top + 48
        return f"""
  <path d="M{cx-130},{y} C{cx-70},{y-55} {cx-30},{y-68} {cx},{y-68} C{cx+30},{y-68} {cx+70},{y-55} {cx+130},{y}"
        fill="none" stroke="{a}" stroke-width="12" stroke-linecap="round"/>
  <circle cx="{cx}" cy="{y-78}" r="13" fill="#E7F3FF" stroke="{line}" stroke-width="3"/>
  <circle cx="{cx-58}" cy="{y-40}" r="8" fill="#A9CEFF" stroke="{line}" stroke-width="3"/>
  <circle cx="{cx+58}" cy="{y-40}" r="8" fill="#A9CEFF" stroke="{line}" stroke-width="3"/>"""

    if kind == "cracks":
        return f"""
  <g stroke="{a}" stroke-width="5" fill="none" stroke-linecap="round">
    <path d="M{lm['face_left']+30},{ey} L{lm['face_left']+70},{ey+40} L{lm['face_left']+48},{ey+90}"/>
    <path d="M{lm['face_right']-20},{ey-10} L{lm['face_right']-60},{ey+36} L{lm['face_right']-30},{ey+80}"/>
    <path d="M{cx-20},{lm['head_bottom']-40} L{cx+10},{lm['head_bottom']+20} L{cx-8},{lm['head_bottom']+70}"/>
  </g>"""

    if kind == "glitch":
        return ""
    return ""


def _blush(s: dict) -> str:
    if s["slug"] not in {"Panda_Sakura_Pink", "Panda_Cotton_Candy", "Panda_Candy_Pop", "Panda_Angelic"}:
        return ""
    return ""  # placed in render once landmarks exist


def render_skin(s: dict, traced: dict) -> str:
    p = traced["paths"]
    lm = traced["landmarks"]
    pupils = sorted(traced["pupils"], key=lambda q: q["cx"])
    face, belly, dark = s["face"], s["belly"], s["dark"]
    glitch = ""
    if s["accessory"] == "glitch":
        glitch = f"""
  <g opacity="0.45" transform="translate(-10,3)"><path d="{p['dark']}" fill="#FF0040" fill-rule="evenodd"/></g>
  <g opacity="0.45" transform="translate(10,-3)"><path d="{p['dark']}" fill="#00FFFF" fill-rule="evenodd"/></g>"""

    # Split eye patches only for rainbow: recolor by covering each patch bbox with a tinted copy is hard.
    # Pupils carry the eye color; patches stay on the dark path except rainbow, where we overlay patch hues.
    rainbow_patches = ""
    if s["slug"] == "Panda_Rainbow" and len(pupils) >= 2:
        # soft color discs behind each eye, clipped visually by sitting under dark? skip — ears handled below
        rainbow_patches = ""

    pupil_svg = [
        f'<circle cx="{q["cx"]:.1f}" cy="{q["cy"]:.1f}" r="{q["r"]:.1f}" fill="{s["eye"]}"/>'
        for q in pupils
    ]
    hilite_svg = [
        f'<circle cx="{h["cx"]:.1f}" cy="{h["cy"]:.1f}" r="{max(h["r"], 3):.1f}" fill="#FFFFFF"/>'
        for h in traced["highlights"]
    ]

    blush = ""
    if s["slug"] in {"Panda_Sakura_Pink", "Panda_Cotton_Candy", "Panda_Candy_Pop", "Panda_Angelic"} and len(pupils) >= 2:
        blush = (
            f'<ellipse cx="{pupils[0]["cx"]-30:.0f}" cy="{pupils[0]["cy"]+70:.0f}" rx="24" ry="13" fill="{s["accent"]}" opacity="0.35"/>'
            f'<ellipse cx="{pupils[1]["cx"]+30:.0f}" cy="{pupils[1]["cy"]+70:.0f}" rx="24" ry="13" fill="{s["accent"]}" opacity="0.35"/>'
        )

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <title>PIXEL TRIP — {s["slug"]} ({s["name"]})</title>
  <desc>Vector skin traced from the reference panda. Pose and base form are unchanged.</desc>
  <rect width="100%" height="100%" fill="{s["bg"]}"/>
  {glitch}
  <path d="{p["face"]}" fill="{face}" fill-rule="evenodd"/>
  <path d="{p["belly"]}" fill="{belly}" fill-rule="evenodd"/>
  <path d="{p["dark"]}" fill="{dark}" fill-rule="evenodd"/>
  {''.join(pupil_svg)}
  <path d="{p["sclera"]}" fill="#FFFFFF" fill-rule="evenodd"/>
  {''.join(hilite_svg)}
  {blush}
  {accessory_svg(s.get("accessory"), s, lm)}
  {rainbow_patches}
</svg>
'''


def main() -> None:
    OUT_SVG.mkdir(parents=True, exist_ok=True)
    traced = trace_reference(REF)
    lm = traced["landmarks"]
    print("landmarks", json.dumps({k: lm[k] for k in lm if k != "eyes"}))
    print("pupils", traced["pupils"])
    print("highlights", len(traced["highlights"]))
    manifest = []
    for s in SKINS:
        svg = render_skin(s, traced)
        svg_path = OUT_SVG / f"{s['slug']}.svg"
        png_path = OUT_PNG / f"{s['slug']}.png"
        svg_path.write_text(svg, encoding="utf-8")
        cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=str(png_path), output_width=SIZE, output_height=SIZE)
        manifest.append({
            "id": s["id"], "slug": s["slug"], "name": s["name"],
            "svg": str(svg_path.relative_to(ROOT)),
            "png": str(png_path.relative_to(ROOT)),
            "accessory": s.get("accessory"),
        })
        print(f"OK {s['id']} {s['slug']}")
    (OUT_SVG / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(manifest)} skins")


if __name__ == "__main__":
    main()
