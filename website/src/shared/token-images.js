/**
 * Shared token image URLs + metadata (Trip Card, previews).
 */
import {
  IMAGE_STAGE1,
  IMAGE_STAGE2,
  IMAGE_STAGE3,
  UPDATE_METADATA_URL,
  ASSIGNMENTS_URL,
  STAGE3_ASSIGNMENTS_URL,
  DIRECT_TO_S3_CHARS,
} from "../burn/config.js";
import { loadBurnProgram, getStage2Variants, getBurnableChars } from "../burn/burn-program.js";
import VARIANT_MAP from "../burn/variant-map.json";
import STAGE3_MAP from "../burn/stage3-variants.json";
import LOCAL_ASSIGNMENTS from "../burn/token-assignments.json";
import LOCAL_STAGE3_ASSIGNMENTS from "../burn/stage3-assignments.json";

let TOKEN_ASSIGNMENTS = {};
let STAGE3_ASSIGNMENTS = {};
const METADATA_CACHE = {};
let catalogReady = false;

function bustUrl(url, slug) {
  if (!url || !slug) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(slug)}`;
}

function normalizeStage1Image(url, tokenId) {
  const fallback = `${IMAGE_STAGE1}/${tokenId}.gif`;
  if (!url) return fallback;
  const normalized = url.replace("/Test/images/", "/images/");
  return normalized.includes("/images/") ? normalized : fallback;
}

function isValidCatalogSlug(slug) {
  if (!slug) return false;
  for (const list of Object.values(getStage2Variants())) {
    if (list.some((v) => v.slug === slug)) return true;
  }
  return false;
}

function collectUsedSlugs(character, excludeTokenId = null) {
  const variants = getStage2Variants()[character] || [];
  const slugSet = new Set(variants.map((v) => v.slug));
  const used = new Set();
  for (const [tid, v] of Object.entries(TOKEN_ASSIGNMENTS)) {
    if (excludeTokenId != null && Number(tid) === excludeTokenId) continue;
    if (slugSet.has(v.slug)) used.add(v.slug);
  }
  return used;
}

function resolveStage2Variant(tokenId, character, excludeTokenId = null) {
  const key = String(tokenId);
  if (TOKEN_ASSIGNMENTS[key]) return TOKEN_ASSIGNMENTS[key];

  const variants = getStage2Variants()[character] || [];
  if (!variants.length) return null;

  const used = collectUsedSlugs(character, excludeTokenId);
  const preferred = VARIANT_MAP[key] || variants[Number(tokenId) % variants.length];
  if (preferred && !used.has(preferred.slug)) return preferred;
  return variants.find((v) => !used.has(v.slug)) || preferred || variants[0];
}

function getStage3Pool(character) {
  return STAGE3_MAP.poolByChar?.[character] ?? [];
}

function collectUsedStage3Slugs(character, excludeTokenId = null) {
  const pool = getStage3Pool(character);
  const slugSet = new Set(pool.map((e) => e.slug));
  const used = new Set();
  for (const [tid, v] of Object.entries(STAGE3_ASSIGNMENTS)) {
    if (excludeTokenId != null && Number(tid) === excludeTokenId) continue;
    if (slugSet.has(v.slug)) used.add(v.slug);
  }
  return used;
}

function resolveStage3Variant(tokenId, character, excludeTokenId = null) {
  const pool = getStage3Pool(character);
  if (!pool.length) {
    return STAGE3_MAP.defaultByChar?.[character] ?? null;
  }

  const key = String(tokenId);
  if (STAGE3_ASSIGNMENTS[key]) {
    const hit = pool.find((e) => e.slug === STAGE3_ASSIGNMENTS[key].slug);
    if (hit) return hit;
    delete STAGE3_ASSIGNMENTS[key];
  }

  const used = collectUsedStage3Slugs(character, excludeTokenId ?? tokenId);
  const preferred = pool[Number(tokenId) % pool.length];
  if (!used.has(preferred.slug)) return preferred;

  for (const entry of pool) {
    if (!used.has(entry.slug)) return entry;
  }
  return null;
}

function getStage2Variant(tokenId, character, stage = 0) {
  const key = String(tokenId);
  const cached = METADATA_CACHE[key];
  if (stage >= 2 && cached?.slug && isValidCatalogSlug(cached.slug)) {
    return { slug: cached.slug, bg: cached.bg || "Unknown", frame: cached.frame || "Unknown" };
  }

  if (TOKEN_ASSIGNMENTS[key]) {
    if (isValidCatalogSlug(TOKEN_ASSIGNMENTS[key].slug)) {
      return TOKEN_ASSIGNMENTS[key];
    }
    delete TOKEN_ASSIGNMENTS[key];
  }

  if (stage >= 2) {
    if (VARIANT_MAP[key]?.slug && isValidCatalogSlug(VARIANT_MAP[key].slug)) {
      return VARIANT_MAP[key];
    }
    const variants = getStage2Variants()[character] || [];
    return variants[Number(tokenId) % variants.length] || null;
  }

  return resolveStage2Variant(tokenId, character);
}

function getStage3Variant(tokenId, character, stage = 0) {
  if (stage === 0 && DIRECT_TO_S3_CHARS.has(character)) {
    return resolveStage3Variant(tokenId, character, tokenId);
  }
  if (stage >= 2) {
    return resolveStage3Variant(tokenId, character, tokenId);
  }
  return null;
}

function isDirectToS3Char(character) {
  return DIRECT_TO_S3_CHARS.has(character);
}

function canEvolveToStage3(tokenId, character, stage) {
  if (stage !== 2) return false;
  if (!getBurnableChars().has(character) && !isDirectToS3Char(character)) return false;
  return !!resolveStage3Variant(tokenId, character, tokenId);
}

export function tokenBurnFlags(tokenId, character, stage) {
  const burnable = getBurnableChars().has(character) || isDirectToS3Char(character);
  if (!burnable) {
    return { canEvolve: false, viewReason: "not_burnable", inProgram: false };
  }
  if (stage === 3) {
    return { canEvolve: false, viewReason: "maxed", inProgram: true };
  }
  if (stage === 0) {
    if (isDirectToS3Char(character) && !resolveStage3Variant(tokenId, character, tokenId)) {
      return { canEvolve: false, viewReason: "no_s3", inProgram: true };
    }
    return { canEvolve: true, viewReason: null, inProgram: true };
  }
  if (stage === 2) {
    if (canEvolveToStage3(tokenId, character, stage)) {
      return { canEvolve: true, viewReason: null, inProgram: true };
    }
    return { canEvolve: false, viewReason: "no_s3", inProgram: true };
  }
  return { canEvolve: false, viewReason: "unknown_stage", inProgram: true };
}

export function stageImageUrls(tokenId, character, stage) {
  const key = String(tokenId);
  const cached = METADATA_CACHE[key];
  const s1 = normalizeStage1Image(cached?.image, tokenId);
  const s1Bust = bustUrl(s1, cached?.dna || cached?.edition || "main");

  if (stage >= 2 && cached?.slug) {
    const variant = {
      slug: cached.slug,
      bg: cached.bg || "Unknown",
      frame: cached.frame || "Unknown",
    };
    const metaImg = cached.image ? bustUrl(cached.image, cached.slug) : null;

    if (stage === 3 && cached.stage >= 3) {
      const primary = metaImg || `${IMAGE_STAGE3}/${cached.slug}.gif?v=${encodeURIComponent(cached.slug)}`;
      return { primary, fallback: s1Bust, variant };
    }
    if (stage === 2 && cached.stage === 2) {
      const primary = metaImg || `${IMAGE_STAGE2}/${cached.slug}.gif?v=${encodeURIComponent(cached.slug)}`;
      return { primary, fallback: s1Bust, variant };
    }
  }

  const s2v = character ? getStage2Variant(tokenId, character, stage) : null;
  const bust = s2v?.slug ? `?v=${encodeURIComponent(s2v.slug)}` : "";
  const s2 = s2v ? `${IMAGE_STAGE2}/${s2v.slug}.gif${bust}` : s1Bust;
  const s3v = character ? getStage3Variant(tokenId, character, stage) : null;
  const s3b = s3v?.slug ? `?v=${encodeURIComponent(s3v.slug)}` : bust;
  const s3 = s3v ? `${IMAGE_STAGE3}/${s3v.slug}.gif${s3b}` : s2;
  if (stage === 3) return { primary: s3, fallback: s2, variant: s3v || s2v };
  if (stage === 2) return { primary: s2, fallback: s1Bust, variant: s2v };
  return { primary: s1Bust, fallback: s1Bust, variant: null };
}

export function stageImageUrl(tokenId, character, stage) {
  return stageImageUrls(tokenId, character, stage).primary;
}

function parseMetaVariant(meta) {
  if (!meta?.attributes) return null;
  let slug = null;
  let bg = null;
  let frame = null;
  let stage = 0;
  let characterName = null;
  for (const a of meta.attributes) {
    if (a.trait_type === "Character") {
      slug = a.value;
      characterName = a.value;
    }
    if (a.trait_type === "Background") bg = a.value;
    if (a.trait_type === "Frame") frame = a.value;
    if (a.trait_type === "Stage") stage = Number(a.value);
  }
  if (stage >= 2 && slug) {
    if (stage >= 3 || isValidCatalogSlug(slug)) {
      return { slug, bg: bg || "Unknown", frame: frame || "Unknown", stage, characterName };
    }
  }
  return characterName ? { slug: null, bg: null, frame: null, stage: 0, characterName } : null;
}

async function fetchTokenMetadata(tokenId) {
  const key = String(tokenId);
  const parseResponse = async (res) => {
    if (!res.ok) return null;
    const meta = await res.json();
    const variant = parseMetaVariant(meta);
    const entry = {
      image: normalizeStage1Image(meta.image || meta.animation_url || null, tokenId),
      dna: meta.dna || null,
      edition: meta.edition ?? null,
      slug: variant?.slug || null,
      bg: variant?.bg,
      frame: variant?.frame,
      stage: variant?.stage ?? 0,
      characterName: variant?.characterName || null,
    };
    METADATA_CACHE[key] = entry;
    return entry;
  };

  try {
    const res = await fetch(`${UPDATE_METADATA_URL}?metadata=${tokenId}&t=${Date.now()}`, {
      cache: "no-store",
    });
    const hit = await parseResponse(res);
    if (hit) return hit;
  } catch (err) {
    console.warn(`[token-images] #${tokenId} proxy failed:`, err.message);
  }

  try {
    const res = await fetch(`${IMAGE_STAGE1.replace("/images", "/metadata")}/${tokenId}?t=${Date.now()}`, {
      cache: "no-store",
    });
    return await parseResponse(res);
  } catch (err) {
    console.warn(`[token-images] #${tokenId} direct failed:`, err.message);
    return null;
  }
}

export async function loadMetadataForTokens(tokenIds) {
  const unique = [...new Set(tokenIds.map(Number).filter(Boolean))];
  await Promise.all(unique.map((id) => fetchTokenMetadata(id)));
}

async function loadAssignments() {
  TOKEN_ASSIGNMENTS = { ...LOCAL_ASSIGNMENTS };
  STAGE3_ASSIGNMENTS = { ...LOCAL_STAGE3_ASSIGNMENTS };
  try {
    const res = await fetch(`${ASSIGNMENTS_URL}&t=${Date.now()}`);
    if (res.ok) {
      TOKEN_ASSIGNMENTS = { ...TOKEN_ASSIGNMENTS, ...(await res.json()) };
    }
  } catch {
    /* local fallback */
  }
  try {
    const res = await fetch(`${STAGE3_ASSIGNMENTS_URL}&t=${Date.now()}`);
    if (res.ok) {
      STAGE3_ASSIGNMENTS = { ...STAGE3_ASSIGNMENTS, ...(await res.json()) };
    }
  } catch {
    /* local fallback */
  }
}

export async function initTokenImageCatalog() {
  if (catalogReady) return;
  await loadBurnProgram();
  await loadAssignments();
  catalogReady = true;
}

export function enrichTripToken(token) {
  const character = token.character?.replace(/ /g, "_") || token.character;
  const flags = tokenBurnFlags(token.tokenId, character, token.stage);
  const urls = stageImageUrls(token.tokenId, character, token.stage);
  return {
    ...token,
    character,
    canEvolve: flags.canEvolve,
    viewReason: flags.viewReason,
    inProgram: flags.inProgram,
    imageUrl: urls.primary,
    imageFallback: urls.fallback,
    variantSlug: urls.variant?.slug || null,
    displayName: urls.variant?.slug?.replace(/_/g, " ") || character.replace(/_/g, " "),
  };
}

export function variantLabel(token) {
  return token.variantSlug?.replace(/_/g, " ") || token.displayName || token.character.replace(/_/g, " ");
}

export const STAGE_LABELS = { 0: "Genesis", 2: "Awakened", 3: "Ascended" };

export function burnStatusLabel(token) {
  if (!token.inProgram) return "Not burnable";
  if (token.canEvolve) return "Burn ready";
  if (token.viewReason === "maxed") return "Ascended";
  if (token.viewReason === "no_s3") return "No S3 pool";
  return "View only";
}
