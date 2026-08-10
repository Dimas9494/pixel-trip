import {
  IMAGE_STAGE1,
  IMAGE_STAGE2,
  IMAGE_STAGE3,
} from "../burn/config.js";

export const CARD_W = 900;
export const CARD_H = 1200;
export const GIF_W = 450;
export const GIF_H = 600;

const STAGE_LABEL = { 0: "Genesis", 2: "Awakened", 3: "Ascended" };

export function stageImageUrl(tokenId, character, stage) {
  if (stage === 3) return `${IMAGE_STAGE3}/Full_${character}.gif`;
  if (stage === 2) return `${IMAGE_STAGE2}/${character}.gif`;
  return `${IMAGE_STAGE1}/${tokenId}.gif`;
}

export function shortAddress(addr) {
  if (!addr || addr.startsWith("Demo")) return addr || "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function sanitizeName(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

export function holderLabel(data) {
  const name = sanitizeName(data.holderName);
  if (name) return name;
  return shortAddress(data.wallet);
}

export function holderSubline(data) {
  const name = sanitizeName(data.holderName);
  if (name) return shortAddress(data.wallet);
  return "";
}

function drawStatBox(ctx, bx, by, bw, bh, label, val, _palette, ringColor) {
  ctx.fillStyle = "rgba(7, 8, 15, 0.92)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(bx, by, bw, bh);

  const cx = bx + bw / 2;
  const cy = by + bh / 2;

  ctx.textAlign = "center";
  ctx.fillStyle = "#e8ecff";
  ctx.font = '24px "VT323", monospace';
  ctx.textBaseline = "top";
  ctx.fillText(label, cx, by + 12);

  const valStr = String(val);
  const valSize = fitVt323(ctx, valStr, bw - 20, 44, 30);
  ctx.fillStyle = ringColor;
  ctx.font = `${valSize}px "VT323", monospace`;
  ctx.textBaseline = "middle";
  ctx.fillText(valStr, cx, cy + 8);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawTagDeckPanel(ctx, x, y, w, h, data, palette) {
  drawRainbowStroke(ctx, x, y, w, h);
  ctx.fillStyle = "rgba(15, 19, 36, 0.92)";
  ctx.fillRect(x + 4, y + 4, w - 8, h - 8);

  ctx.fillStyle = "#39ff14";
  ctx.font = 'bold 16px "Press Start 2P", monospace';
  ctx.fillText("MY TRIP DECK", x + 24, y + 40);

  const stats = data.stats || {};
  const items = [
    ["TRIPPERS", stats.owned ?? "—"],
    ["STAGE 1", stats.s1 ?? "—"],
    ["STAGE 2", stats.s2 ?? "—"],
    ["STAGE 3", stats.s3 ?? "—"],
    ["BURNED", stats.burned ?? "—"],
    ["PAIRS", stats.pairs ?? "—"],
  ];
  const ringColors = ["#ff2bd6", "#7b5cff", "#39ff14", "#ffe14a", "#ff2bd6", "#7b5cff"];

  const cols = 3;
  const gap = 16;
  const gridTop = y + 58;
  const rankH = 72;
  const gridH = h - (gridTop - y) - rankH - 16;
  const cellW = (w - 48 - gap * (cols - 1)) / cols;
  const cellH = (gridH - gap) / 2;

  items.forEach(([label, val], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const bx = x + 24 + col * (cellW + gap);
    const by = gridTop + row * (cellH + gap);
    drawStatBox(ctx, bx, by, cellW, cellH, label, val, palette, ringColors[i]);
  });

  const rankY = y + h - rankH - 12;
  ctx.fillStyle = "rgba(7, 8, 15, 0.85)";
  ctx.fillRect(x + 24, rankY, w - 48, rankH - 8);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 24, rankY, w - 48, rankH - 8);

  if (data.nextRank && data.score < data.nextRank.min) {
    const need = data.nextRank.min - data.score;
    ctx.fillStyle = "#e8ecff";
    ctx.font = '30px "VT323", monospace';
    ctx.fillText(`${need} pts → ${data.nextRank.title}`, x + 40, rankY + 32);
    const barX = x + 40;
    const barW = w - 80;
    const barY = rankY + 44;
    ctx.fillStyle = "rgba(123, 92, 255, 0.35)";
    ctx.fillRect(barX, barY, barW, 14);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(barX, barY, barW * (data.progress ?? 0), 14);
  } else {
    ctx.fillStyle = "#ffe14a";
    ctx.font = 'bold 14px "Press Start 2P", monospace';
    ctx.textAlign = "center";
    ctx.fillText("★ MAX RANK · TRIP MASTER ★", x + w / 2, rankY + 38);
    ctx.textAlign = "left";
  }
}

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image failed: ${url}`));
    img.src = url;
  });
}

function drawScanlines(ctx, w, h, alpha = 0.12) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#000";
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2);
  ctx.restore();
}

function drawTripSky(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H * 0.32, 0, W / 2, H * 0.55, W * 0.85);
  g.addColorStop(0, "#3d1878");
  g.addColorStop(0.45, "#15082e");
  g.addColorStop(1, "#07080f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawPixelStars(ctx, W, H, count = 90) {
  for (let i = 0; i < count; i++) {
    const x = (i * 7919 + 13) % W;
    const y = (i * 6271 + 7) % H;
    const sz = i % 11 === 0 ? 3 : 2;
    if (i % 7 === 0) ctx.fillStyle = "#ffe14a";
    else if (i % 5 === 0) ctx.fillStyle = "#ff2bd6";
    else if (i % 3 === 0) ctx.fillStyle = "#39ff14";
    else ctx.fillStyle = "#6a7399";
    ctx.fillRect(x, y, sz, sz);
  }
}

function drawWarpGrid(ctx, W, H, alpha = 0.18) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#7b5cff";
  ctx.lineWidth = 1;
  const horizon = H * 0.68;
  for (let i = -10; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 36, horizon);
    ctx.lineTo(W / 2 + i * 130, H);
    ctx.stroke();
  }
  for (let y = horizon; y < H; y += 22) {
    const t = (y - horizon) / (H - horizon);
    ctx.beginPath();
    ctx.moveTo(W / 2 - W * t * 0.95, y);
    ctx.lineTo(W / 2 + W * t * 0.95, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawChromaticBorder(ctx, x, y, w, h, offset = 3) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 43, 214, 0.85)";
  ctx.strokeRect(x - offset, y, w, h);
  ctx.strokeStyle = "rgba(57, 255, 20, 0.85)";
  ctx.strokeRect(x + offset, y, w, h);
  ctx.strokeStyle = "rgba(123, 92, 255, 0.7)";
  ctx.strokeRect(x, y - offset, w, h);
}

function drawRainbowStroke(ctx, x, y, w, h) {
  const colors = ["#ff2bd6", "#7b5cff", "#39ff14", "#ffe14a"];
  colors.forEach((c, i) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9 - i * 0.15;
    ctx.strokeRect(x + i * 3, y + i * 3, w - i * 6, h - i * 6);
  });
  ctx.globalAlpha = 1;
}

function drawPortalRings(ctx, cx, cy, maxR, rings = 10) {
  for (let i = rings; i >= 1; i--) {
    const r = (maxR / rings) * i;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const t = i / rings;
    ctx.strokeStyle = `rgba(184, 164, 255, ${0.02 + t * 0.045})`;
    ctx.lineWidth = i % 4 === 0 ? 2 : 1;
    ctx.stroke();
  }
  [0.42, 0.62, 0.82].forEach((frac, idx) => {
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * frac, 0, Math.PI * 2);
    ctx.strokeStyle = ["rgba(255, 225, 74, 0.22)", "rgba(184, 164, 255, 0.28)", "rgba(255, 43, 214, 0.18)"][idx];
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function drawTcgOuterFrame(ctx, x, y, w, h, variant) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#050508";
  ctx.fillRect(x, y, w, h);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  if (variant === "holo") {
    const border = ctx.createLinearGradient(x, y, x + w, y + h);
    border.addColorStop(0, "#e8ecff");
    border.addColorStop(0.22, "#7b5cff");
    border.addColorStop(0.5, "#ff2bd6");
    border.addColorStop(0.78, "#5eead4");
    border.addColorStop(1, "#ffe14a");
    ctx.strokeStyle = border;
    ctx.lineWidth = 11;
    ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
    ctx.strokeStyle = "#252040";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 18, y + 18, w - 36, h - 36);
    ctx.fillStyle = "#12121e";
  } else {
    const gold = ctx.createLinearGradient(x, y, x + w, y + h);
    gold.addColorStop(0, "#6b5212");
    gold.addColorStop(0.28, "#ffe14a");
    gold.addColorStop(0.5, "#fff8dc");
    gold.addColorStop(0.72, "#ffe14a");
    gold.addColorStop(1, "#4a3810");
    ctx.strokeStyle = gold;
    ctx.lineWidth = 12;
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    ctx.strokeStyle = "#140f22";
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 22, y + 22, w - 44, h - 44);
    ctx.fillStyle = "#0a0812";
  }
  ctx.fillRect(x + 22, y + 22, w - 44, h - 44);
  ctx.restore();
}

function drawIdBadge(ctx, cx, cy, r, tokenId, variant) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  if (variant === "holo") {
    g.addColorStop(0, "#4a3588");
    g.addColorStop(1, "#1a1238");
  } else {
    g.addColorStop(0, "#6b5212");
    g.addColorStop(1, "#2a1a08");
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = variant === "holo" ? "#b8a4ff" : "#ffe14a";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  const idStr = `#${tokenId}`;
  const idSize = fitVt323(ctx, idStr, r * 1.6, 22, 14);
  ctx.font = `${idSize}px "VT323", monospace`;
  ctx.fillText(idStr, cx, cy + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawScoreOrb(ctx, cx, cy, r, score, accent) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.05, cx, cy, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.42, accent);
  g.addColorStop(1, "#07080f");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#07080f";
  const sz = fitPressText(ctx, String(score), r * 1.65, 16);
  ctx.font = `bold ${sz}px "Press Start 2P", monospace`;
  ctx.fillText(String(score), cx, cy + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawArtContained(ctx, art, x, y, w, h, pad) {
  const ix = x + pad;
  const iy = y + pad;
  const iw = w - pad * 2;
  const ih = h - pad * 2;
  ctx.fillStyle = "#07080f";
  ctx.fillRect(ix, iy, iw, ih);
  if (!art || !art.width || !art.height) return;
  const scale = Math.min(iw / art.width, ih / art.height);
  const dw = art.width * scale;
  const dh = art.height * scale;
  const dx = ix + (iw - dw) / 2;
  const dy = iy + (ih - dh) / 2;
  ctx.drawImage(art, dx, dy, dw, dh);
}

function drawTcgArtSlot(ctx, x, y, w, h, art, variant) {
  ctx.fillStyle = "#07080f";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = variant === "holo" ? "rgba(123, 92, 255, 0.55)" : "rgba(255, 225, 74, 0.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  drawArtContained(ctx, art, x, y, w, h, 14);
}

function drawTcgDeckStrip(ctx, ix, y, iw, deckH, stats, variant, palette) {
  ctx.fillStyle = variant === "holo" ? "#0e0e1a" : "#1a0a12";
  ctx.fillRect(ix, y, iw, deckH);
  ctx.strokeStyle = variant === "holo" ? "rgba(184, 164, 255, 0.3)" : "rgba(255, 225, 74, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(ix, y, iw, deckH);

  const items = [
    [stats.owned ?? "—", "TRIPPERS", "#ff2bd6"],
    [stats.burned ?? "—", "BURNED", "#39ff14"],
    [stats.pairs ?? "—", "PAIRS", "#ffe14a"],
  ];
  const colW = iw / 3;
  const valY = y + deckH * 0.36;
  const lblY = y + deckH * 0.74;
  items.forEach(([val, lbl, color], i) => {
    const cx = ix + colW * i + colW / 2;
    if (i > 0) {
      ctx.strokeStyle = variant === "holo" ? "rgba(184, 164, 255, 0.2)" : "rgba(255, 225, 74, 0.2)";
      ctx.beginPath();
      ctx.moveTo(ix + colW * i, y + 8);
      ctx.lineTo(ix + colW * i, y + deckH - 8);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    const valSize = fitPressText(ctx, String(val), colW - 16, 15);
    ctx.font = `bold ${valSize}px "Press Start 2P", monospace`;
    ctx.textBaseline = "middle";
    ctx.fillText(String(val), cx, valY);
    drawPremiumLabel(ctx, lbl, cx, lblY, {
      fill: color,
      shadow: "rgba(7, 8, 15, 0.35)",
      size: 20,
      tracking: 1,
      maxW: colW - 16,
      minSize: 16,
    });
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawTcgMidLabel(ctx, ix, y, iw, midH, variant) {
  const fill = variant === "holo" ? "#b8a4ff" : "#ffe14a";
  drawPremiumLabel(ctx, "TRIP ID", ix + iw / 2, y + midH / 2, {
    fill,
    shadow: "rgba(7, 8, 15, 0.45)",
    size: 30,
    tracking: 6,
    maxW: iw - 24,
    minSize: 22,
  });
}

function drawPrismKicker(ctx, x, y, w, h) {
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, "#7b5cff");
  grad.addColorStop(0.5, "#ff2bd6");
  grad.addColorStop(1, "#5eead4");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  drawPremiumLabel(ctx, "PRISM PASS", x + w / 2, y + h / 2, {
    fill: "#ffffff",
    shadow: "rgba(7, 8, 15, 0.65)",
    size: 32,
    tracking: 6,
    maxW: w - 24,
    minSize: 24,
  });
}

function drawSovereignBanner(ctx, x, y, w, h) {
  const gold = ctx.createLinearGradient(x, y, x, y + h);
  gold.addColorStop(0, "#ffe14a");
  gold.addColorStop(0.5, "#fff8dc");
  gold.addColorStop(1, "#b8922a");
  ctx.fillStyle = gold;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#4a3810";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  drawPremiumLabel(ctx, "◆  SOVEREIGN SEAL  ◆", x + w / 2, y + h / 2, {
    fill: "#2a1020",
    shadow: "rgba(255, 248, 220, 0.55)",
    size: 30,
    tracking: 4,
    maxW: w - 20,
    minSize: 22,
  });
}

function drawSovereignOuterFrame(ctx, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = "rgba(255, 225, 74, 0.28)";
  ctx.shadowBlur = 28;
  ctx.fillStyle = "#050508";
  ctx.fillRect(x, y, w, h);
  ctx.shadowBlur = 0;
  const gold = ctx.createLinearGradient(x, y, x + w, y + h);
  gold.addColorStop(0, "#8a6914");
  gold.addColorStop(0.5, "#ffe14a");
  gold.addColorStop(1, "#4a3810");
  ctx.strokeStyle = gold;
  ctx.lineWidth = 14;
  ctx.strokeRect(x + 7, y + 7, w - 14, h - 14);
  const inner = ctx.createRadialGradient(x + w / 2, y + h * 0.32, 0, x + w / 2, y + h / 2, w * 0.75);
  inner.addColorStop(0, "#1f0a30");
  inner.addColorStop(0.55, "#0c0618");
  inner.addColorStop(1, "#07080f");
  ctx.fillStyle = inner;
  ctx.fillRect(x + 24, y + 24, w - 48, h - 48);
  ctx.strokeStyle = "rgba(255, 43, 214, 0.22)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 28, y + 28, w - 56, h - 56);
  ctx.restore();
}

function drawGoldArtFrame(ctx, x, y, w, h, art) {
  const gold = ctx.createLinearGradient(x, y, x + w, y + h);
  gold.addColorStop(0, "#6b5212");
  gold.addColorStop(0.3, "#ffe14a");
  gold.addColorStop(0.5, "#fff8dc");
  gold.addColorStop(0.7, "#ffe14a");
  gold.addColorStop(1, "#4a3810");
  ctx.strokeStyle = gold;
  ctx.lineWidth = 6;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#140a18";
  ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  ctx.strokeStyle = "rgba(255, 43, 214, 0.32)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);
  drawArtContained(ctx, art, x, y, w, h, 20);
  const L = 18;
  ctx.strokeStyle = "#ffe14a";
  ctx.lineWidth = 3;
  [[x + 8, y + 8, 1, 1], [x + w - 8, y + 8, -1, 1], [x + 8, y + h - 8, 1, -1], [x + w - 8, y + h - 8, -1, -1]].forEach(
    ([cx, cy, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx * L, cy);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, cy + dy * L);
      ctx.stroke();
    },
  );
}

function drawScoreHex(ctx, cx, cy, r, score) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = cx + r * Math.cos(a);
    const py = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, "#fff8dc");
  g.addColorStop(0.45, "#ffe14a");
  g.addColorStop(1, "#6b5212");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#fff8dc";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1a1020";
  const sz = fitPressText(ctx, String(score), r * 1.5, 14);
  ctx.font = `bold ${sz}px "Press Start 2P", monospace`;
  ctx.fillText(String(score), cx, cy + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawSovereignCard(ctx, W, H, data, art, palette, label, charName, stage) {
  ctx.fillStyle = "#07080f";
  ctx.fillRect(0, 0, W, H);
  drawPixelStars(ctx, W, H, 100);

  const M = 28;
  const fx = M;
  const fy = M;
  const fw = W - M * 2;
  const fh = H - M * 2;
  drawSovereignOuterFrame(ctx, fx, fy, fw, fh);

  const pad = 22;
  const ix = fx + pad;
  const iw = fw - pad * 2;
  let y = fy + pad;

  const bannerH = 40;
  drawSovereignBanner(ctx, ix, y, iw, bannerH);
  y += bannerH + 8;

  const nameH = 40;
  drawPremiumLabel(ctx, charName.toUpperCase(), ix + iw / 2, y + nameH / 2, {
    fill: "#ffe14a",
    shadow: "rgba(42, 16, 32, 0.75)",
    size: 42,
    tracking: 3,
    maxW: iw - 24,
    minSize: 28,
  });
  y += nameH + 8;

  const midH = 48;
  const deckH = 62;
  const footH = 132;
  const gap = 10;
  const artH = fh - pad * 2 - bannerH - nameH - midH - deckH - footH - gap * 5 - 8;

  drawGoldArtFrame(ctx, ix, y, iw, artH, art);
  drawIdBadge(ctx, ix + iw - 36, y + 36, 30, data.tokenId, "legend");

  y += artH + gap;
  ctx.fillStyle = "#2a1020";
  ctx.fillRect(ix, y, iw, midH);
  ctx.strokeStyle = "rgba(255, 225, 74, 0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(ix, y, iw, midH);
  drawTcgMidLabel(ctx, ix, y, iw, midH, "legend");

  y += midH + gap;
  drawTcgDeckStrip(ctx, ix, y, iw, deckH, data.stats || {}, "legend", palette);

  y += deckH + gap;
  ctx.fillStyle = "#120818";
  ctx.fillRect(ix, y, iw, footH);
  ctx.strokeStyle = "rgba(255, 225, 74, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(ix, y, iw, footH);
  drawPremiumLabel(ctx, "HOLDER", ix + 20, y + 28, {
    fill: "#8b93b8",
    shadow: null,
    size: 22,
    align: "left",
    tracking: 4,
  });
  drawPremiumLabel(ctx, label.toUpperCase(), ix + 20, y + 62, {
    fill: "#ffe14a",
    shadow: "rgba(42, 16, 32, 0.6)",
    size: 38,
    align: "left",
    tracking: 2,
    maxW: iw - 130,
    minSize: 24,
  });
  if (data.nextRank && data.score < data.nextRank.min) {
    const need = data.nextRank.min - data.score;
    drawPremiumLabel(ctx, `${need} pts → ${data.nextRank.title}`, ix + 20, y + 100, {
      fill: "#ff2bd6",
      shadow: null,
      size: 24,
      align: "left",
      tracking: 1,
      maxW: iw - 130,
      minSize: 20,
    });
  } else {
    drawPremiumLabel(ctx, "★ TRIP MASTER ★", ix + 20, y + 100, {
      fill: "#ff2bd6",
      shadow: "rgba(7, 8, 15, 0.35)",
      size: 26,
      align: "left",
      tracking: 2,
    });
  }
  drawScoreHex(ctx, ix + iw - 62, y + footH / 2 + 2, 52, data.score);
}

function drawTcgCard(ctx, W, H, variant, data, art, palette, label, charName, stage) {
  ctx.fillStyle = "#07080f";
  ctx.fillRect(0, 0, W, H);
  if (variant === "legend") drawPixelStars(ctx, W, H, 70);

  const M = 32;
  const fx = M;
  const fy = M;
  const fw = W - M * 2;
  const fh = H - M * 2;
  drawTcgOuterFrame(ctx, fx, fy, fw, fh, variant);

  const pad = 26;
  const ix = fx + pad;
  const iw = fw - pad * 2;
  const kickerH = variant === "holo" ? 28 : 0;
  const headH = 72;
  const midH = 52;
  const deckH = 62;
  const footH = 148;
  const gap = 12;
  const artH = fh - pad * 2 - kickerH - headH - midH - deckH - footH - gap * (variant === "holo" ? 5 : 4);

  let y = fy + pad;
  if (variant === "holo") {
    drawPrismKicker(ctx, ix, y, iw, kickerH);
    y += kickerH + gap;
  }
  const headBg = variant === "holo" ? "#1a1238" : "#1a1408";
  const headBorder = variant === "holo" ? "rgba(184, 164, 255, 0.45)" : "rgba(255, 225, 74, 0.45)";

  ctx.fillStyle = headBg;
  ctx.fillRect(ix, y, iw, headH);
  ctx.strokeStyle = headBorder;
  ctx.lineWidth = 2;
  ctx.strokeRect(ix, y, iw, headH);
  drawPremiumLabel(ctx, charName.toUpperCase(), ix + 16, y + headH / 2, {
    fill: variant === "holo" ? "#e8ecff" : "#ffe14a",
    shadow: "rgba(7, 8, 15, 0.55)",
    size: 38,
    align: "left",
    tracking: 2,
    maxW: iw - 110,
    minSize: 26,
  });
  drawIdBadge(ctx, ix + iw - 44, y + headH / 2, 34, data.tokenId, variant);

  y += headH + gap;
  drawTcgArtSlot(ctx, ix, y, iw, artH, art, variant);

  y += artH + gap;
  ctx.fillStyle = variant === "holo" ? "#151528" : "#141008";
  ctx.fillRect(ix, y, iw, midH);
  ctx.strokeStyle = headBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(ix, y, iw, midH);
  drawTcgMidLabel(ctx, ix, y, iw, midH, variant);

  y += midH + gap;
  drawTcgDeckStrip(ctx, ix, y, iw, deckH, data.stats || {}, variant, palette);

  y += deckH + gap;
  ctx.fillStyle = variant === "holo" ? "#10101c" : "#0c0a08";
  ctx.fillRect(ix, y, iw, footH);
  ctx.strokeStyle = headBorder;
  ctx.lineWidth = 2;
  ctx.strokeRect(ix, y, iw, footH);
  drawPremiumLabel(ctx, "HOLDER", ix + 20, y + 30, {
    fill: "#8b93b8",
    shadow: null,
    size: 22,
    align: "left",
    tracking: 4,
  });
  drawPremiumLabel(ctx, label.toUpperCase(), ix + 20, y + 66, {
    fill: "#e8ecff",
    shadow: "rgba(7, 8, 15, 0.55)",
    size: 38,
    align: "left",
    tracking: 2,
    maxW: iw - 140,
    minSize: 24,
  });
  if (data.nextRank && data.score < data.nextRank.min) {
    const need = data.nextRank.min - data.score;
    drawPremiumLabel(ctx, `${need} pts → ${data.nextRank.title}`, ix + 20, y + 108, {
      fill: "#b8a4ff",
      shadow: null,
      size: 24,
      align: "left",
      tracking: 1,
      maxW: iw - 140,
      minSize: 20,
    });
  } else {
    drawPremiumLabel(ctx, "★ TRIP MASTER ★", ix + 20, y + 108, {
      fill: "#ffe14a",
      shadow: "rgba(7, 8, 15, 0.35)",
      size: 26,
      align: "left",
      tracking: 2,
    });
  }
  drawScoreOrb(ctx, ix + iw - 64, y + footH / 2 + 4, 56, data.score, variant === "holo" ? palette.accent : "#ffe14a");
}

function drawGlitchText(ctx, text, x, y, color, font) {
  ctx.font = font;
  ctx.fillStyle = "rgba(255, 43, 214, 0.75)";
  ctx.fillText(text, x - 2, y);
  ctx.fillStyle = "rgba(57, 255, 20, 0.65)";
  ctx.fillText(text, x + 2, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawAcidArtFrame(ctx, x, y, w, h, art) {
  drawRainbowStroke(ctx, x - 8, y - 8, w + 16, h + 16);
  ctx.fillStyle = "#07080f";
  ctx.fillRect(x, y, w, h);
  const glow = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.65);
  glow.addColorStop(0, "rgba(255, 43, 214, 0.18)");
  glow.addColorStop(0.5, "rgba(123, 92, 255, 0.12)");
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);
  if (art) {
    const inset = 14;
    ctx.drawImage(art, x + inset, y + inset, w - inset * 2, h - inset * 2);
  }
  drawChromaticBorder(ctx, x, y, w, h, 3);
}

function drawPixelBorder(ctx, x, y, w, h, color, inset = 8) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 2;
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
}

function drawFooterPanel(ctx, x, y, w, h) {
  ctx.fillStyle = "rgba(7, 8, 15, 0.92)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(123, 92, 255, 0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

function fitPressText(ctx, text, maxW, startSize) {
  let size = startSize;
  ctx.font = `bold ${size}px "Press Start 2P", monospace`;
  while (size > 10 && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = `bold ${size}px "Press Start 2P", monospace`;
  }
  return size;
}

function fitVt323(ctx, text, maxW, startSize, minSize = 26) {
  let size = startSize;
  ctx.font = `${size}px "VT323", monospace`;
  while (size > minSize && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = `${size}px "VT323", monospace`;
  }
  return size;
}

function drawPremiumLabel(ctx, text, x, y, opts = {}) {
  const {
    fill = "#ffffff",
    shadow = "rgba(7, 8, 15, 0.55)",
    size = 28,
    align = "center",
    baseline = "middle",
    tracking = 3,
    maxW = 0,
    minSize = 22,
  } = opts;
  const fontSize = maxW ? fitVt323(ctx, text, maxW, size, minSize) : size;
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.font = `${fontSize}px "VT323", monospace`;
  if (tracking && "letterSpacing" in ctx) ctx.letterSpacing = `${tracking}px`;
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillText(text, x + (align === "center" ? 1 : 0), y + 2);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.restore();
}

function drawShadowText(ctx, text, x, y, fill, shadow = "rgba(7, 8, 15, 0.55)") {
  ctx.fillStyle = shadow;
  ctx.fillText(text, x + 2, y + 2);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Draw full card; `art` is a frame canvas/image for the NFT slot (animated GIF export). */
export function drawCardScene(ctx, W, H, themeId, data, art) {
  const rankColors = {
    ascended: { accent: "#ffe14a" },
    legend: { accent: "#ff2bd6" },
    traveler: { accent: "#b8a4ff" },
    wanderer: { accent: "#39ff14" },
  };
  const palette = rankColors[data.rankId] || rankColors.wanderer;
  const label = holderLabel(data);
  const charName = data.character.replace(/_/g, " ");
  const stage = STAGE_LABEL[data.stage] || `Stage ${data.stage}`;

  if (themeId === "neon") {
    const footerH = 240;
    const pad = 48;
    const frameY = 130;
    const footerGap = 28;
    const artGlow = 16;
    const footY = H - footerH - pad;
    const frameW = W - pad * 2;
    const frameH = footY - frameY - footerGap - artGlow;

    drawTripSky(ctx, W, H);
    drawPixelStars(ctx, W, H);
    drawWarpGrid(ctx, W, H, 0.14);
    drawRainbowStroke(ctx, 16, 16, W - 32, H - 32);

    drawGlitchText(ctx, "PIXEL TRIP", pad, 74, palette.accent, 'bold 24px "Press Start 2P", monospace');
    ctx.font = '20px "VT323", monospace';
    ctx.fillStyle = "#ff2bd6";
    ctx.fillText("▶ ACID CABINET ◀", pad, 104);

    drawAcidArtFrame(ctx, pad, frameY, frameW, frameH, art);
    drawScanlines(ctx, W, H, 0.1);

    drawFooterPanel(ctx, pad, footY, W - pad * 2, footerH);

    const leftX = pad + 24;
    const rightX = W - pad - 24;
    ctx.fillStyle = "#e8ecff";
    ctx.font = '40px "VT323", monospace';
    ctx.fillText(label, leftX, footY + 48);
    ctx.fillStyle = "#c8cce8";
    ctx.font = '28px "VT323", monospace';
    ctx.fillText(`#${data.tokenId} · ${charName}`, leftX, footY + 88);
    ctx.fillStyle = "#39ff14";
    ctx.font = '26px "VT323", monospace';
    ctx.fillText(`◆ ${stage}`, leftX, footY + 122);

    ctx.textAlign = "right";
    ctx.fillStyle = palette.accent;
    ctx.font = 'bold 16px "Press Start 2P", monospace';
    ctx.fillText(data.rankTitle.toUpperCase(), rightX, footY + 48);
    const scoreStr = String(data.score);
    const scoreSize = fitPressText(ctx, scoreStr, 280, 40);
    ctx.font = `bold ${scoreSize}px "Press Start 2P", monospace`;
    ctx.shadowColor = palette.accent;
    ctx.shadowBlur = 16;
    ctx.fillText(scoreStr, rightX, footY + 108);
    ctx.shadowBlur = 0;
    ctx.font = '22px "VT323", monospace';
    ctx.fillStyle = "#8b93b8";
    ctx.fillText("TRIP SCORE", rightX, footY + 148);
    ctx.textAlign = "left";
  } else if (themeId === "tag") {
    drawTripSky(ctx, W, H);
    drawPixelStars(ctx, W, H, 50);

    const headGrad = ctx.createLinearGradient(0, 0, W, 0);
    headGrad.addColorStop(0, "#ff2bd6");
    headGrad.addColorStop(0.35, "#7b5cff");
    headGrad.addColorStop(0.65, "#39ff14");
    headGrad.addColorStop(1, "#ffe14a");
    const headH = 112;
    ctx.fillStyle = headGrad;
    ctx.fillRect(0, 0, W, headH);

    const nameStr = label.toUpperCase();
    const idStr = `#${data.tokenId}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const nameSize = fitVt323(ctx, nameStr, W - 64, 52);
    ctx.font = `${nameSize}px "VT323", monospace`;
    drawShadowText(ctx, nameStr, W / 2, 40, "#ffffff");
    const idSize = fitVt323(ctx, idStr, W - 64, 38);
    ctx.font = `${idSize}px "VT323", monospace`;
    drawShadowText(ctx, idStr, W / 2, 78, "#ffe14a");
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    const artX = 48;
    const artY = 132;
    const artS = 360;
    drawAcidArtFrame(ctx, artX, artY, artS, artS, art);

    const infoX = artX + artS + 40;
    const infoW = W - infoX - 48;
    ctx.fillStyle = "#e8ecff";
    ctx.font = '30px "VT323", monospace';
    ctx.fillText(`#${data.tokenId}`, infoX, artY + 40);
    ctx.fillText(charName, infoX, artY + 82);
    ctx.fillStyle = "#39ff14";
    ctx.fillText(`◆ ${stage}`, infoX, artY + 124);
    ctx.fillStyle = palette.accent;
    ctx.font = 'bold 16px "Press Start 2P", monospace';
    ctx.fillText(data.rankTitle.toUpperCase(), infoX, artY + 180);
    const scoreStr = String(data.score);
    const scoreSize = fitPressText(ctx, scoreStr, infoW, 32);
    ctx.font = `bold ${scoreSize}px "Press Start 2P", monospace`;
    ctx.fillStyle = "#ffe14a";
    ctx.fillText(scoreStr, infoX, artY + 240);
    ctx.font = '22px "VT323", monospace';
    ctx.fillStyle = "#8b93b8";
    ctx.fillText("TRIP SCORE", infoX, artY + 276);

    const deckY = artY + artS + 36;
    const deckH = H - deckY - 48;
    drawTagDeckPanel(ctx, 48, deckY, W - 96, deckH, data, palette);
    drawWarpGrid(ctx, W, H, 0.06);
  } else if (themeId === "holo") {
    drawTcgCard(ctx, W, H, "holo", data, art, palette, label, charName, stage);
  } else if (themeId === "legend") {
    drawSovereignCard(ctx, W, H, data, art, palette, label, charName, stage);
  }
}

export async function loadArtImage(data) {
  const primary = stageImageUrl(data.tokenId, data.character, data.stage);
  try {
    return await loadImage(primary);
  } catch {
    try {
      return await loadImage(`${IMAGE_STAGE1}/${data.tokenId}.gif`);
    } catch {
      return null;
    }
  }
}

export async function renderCardCanvas(themeId, data) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const art = await loadArtImage(data);
  drawCardScene(canvas.getContext("2d"), CARD_W, CARD_H, themeId, data, art);
  return canvas;
}

export function downloadCanvasPng(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
}
