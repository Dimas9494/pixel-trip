import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { parseGIF, decompressFrames } from "gifuct-js";
import {
  CARD_W,
  CARD_H,
  GIF_W,
  GIF_H,
  drawCardScene,
  stageImageUrl,
} from "./trip-card-render.js";

/** Only subsample extremely long GIFs */
const MAX_GIF_FRAMES = 150;
const GIF_PROXY = "/api/gif-proxy";

async function fetchGifBuffer(url) {
  const proxyUrl = `${GIF_PROXY}?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`GIF fetch ${res.status}`);
  return res.arrayBuffer();
}

/**
 * gifuct-js delay is already in ms.
 * Browsers clamp delays under 20ms to ~100ms (GIF spec / HTML).
 */
function browserDelayMs(ms) {
  if (!ms || ms <= 0) return 100;
  if (ms < 20) return 100;
  return ms;
}

/**
 * Composite partial patches into full canvases (matches browser GIF playback).
 */
function compositeFrames(gif, rawFrames) {
  const w = gif.lsd.width;
  const h = gif.lsd.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  return rawFrames.map((frame) => {
    if (frame.disposalType === 2) {
      ctx.clearRect(0, 0, w, h);
    }

    const patchCanvas = document.createElement("canvas");
    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    const pctx = patchCanvas.getContext("2d");
    const imageData = pctx.createImageData(frame.dims.width, frame.dims.height);
    imageData.data.set(frame.patch);
    pctx.putImageData(imageData, 0, 0);
    ctx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

    const snap = document.createElement("canvas");
    snap.width = w;
    snap.height = h;
    snap.getContext("2d").drawImage(canvas, 0, 0);

    return {
      canvas: snap,
      delay: browserDelayMs(frame.delay),
    };
  });
}

/** Parse animated GIF into composited full-frame canvases. */
export async function loadGifFrames(url) {
  const buffer = await fetchGifBuffer(url);
  const gif = parseGIF(buffer);
  const raw = decompressFrames(gif, true);
  if (!raw.length) throw new Error("Empty GIF");
  return compositeFrames(gif, raw);
}

/** Reduce frames only for very long GIFs; preserve total duration. */
function subsampleFrames(frames, maxFrames) {
  if (frames.length <= maxFrames) return frames;

  const out = [];
  const n = frames.length;
  for (let i = 0; i < maxFrames; i++) {
    const start = Math.floor((i * n) / maxFrames);
    const end = Math.floor(((i + 1) * n) / maxFrames);
    let totalDelay = 0;
    for (let j = start; j < end; j++) totalDelay += frames[j].delay;
    out.push({
      canvas: frames[start].canvas,
      delay: browserDelayMs(totalDelay),
    });
  }
  return out;
}

async function resolveGifFrames(data) {
  const urls = [
    stageImageUrl(data.tokenId, data.character, data.stage),
    `https://pixeltripnft.website/images/${data.tokenId}.gif`,
  ];
  for (const url of urls) {
    try {
      const frames = await loadGifFrames(url);
      if (frames.length >= 1) return { frames, url };
    } catch (err) {
      console.warn("[trip-card] GIF load failed:", url, err.message);
    }
  }
  throw new Error("Could not load animated GIF — try another tripper or PNG export.");
}

/**
 * Render card as animated GIF — NFT animates inside the frame.
 * @param {function(number, number): void} [onProgress] (current, total)
 */
export async function renderAnimatedCardGif(themeId, data, onProgress) {
  const { frames: source } = await resolveGifFrames(data);
  const frames = subsampleFrames(source, MAX_GIF_FRAMES);

  const full = document.createElement("canvas");
  full.width = CARD_W;
  full.height = CARD_H;
  const fctx = full.getContext("2d");

  const scaled = document.createElement("canvas");
  scaled.width = GIF_W;
  scaled.height = GIF_H;
  const sctx = scaled.getContext("2d");
  sctx.imageSmoothingEnabled = false;

  const gif = GIFEncoder();
  let sharedPalette = null;

  for (let i = 0; i < frames.length; i++) {
    onProgress?.(i + 1, frames.length);
    fctx.clearRect(0, 0, CARD_W, CARD_H);
    drawCardScene(fctx, CARD_W, CARD_H, themeId, data, frames[i].canvas);
    sctx.clearRect(0, 0, GIF_W, GIF_H);
    sctx.drawImage(full, 0, 0, GIF_W, GIF_H);

    const { data: rgba } = sctx.getImageData(0, 0, GIF_W, GIF_H);
    if (!sharedPalette) {
      sharedPalette = quantize(rgba, 256);
    }
    const index = applyPalette(rgba, sharedPalette);
    gif.writeFrame(index, GIF_W, GIF_H, {
      palette: sharedPalette,
      delay: frames[i].delay,
    });

    if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  gif.finish();
  return gif.bytes();
}

export function downloadGifBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "image/gif" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
