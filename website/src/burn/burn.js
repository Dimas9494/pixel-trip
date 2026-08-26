import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
} from "viem";
import { mainnet } from "viem/chains";
import {
  STAGE1_ADDRESS,
  EVOLVE_ADDRESS,
  STAGE1_ABI,
  EVOLVE_ABI,
  BURN_PROGRAM_VERSION,
  DIRECT_TO_S3_CHARS,
  CHAR_ID_TO_NAME,
  CHAR_NAME_TO_ID,
  SCAN_MAX_ID,
  RECEIPT_RPC_URL,
  WALLET_DAPP_ENABLED,
  IMAGE_STAGE1,
  IMAGE_STAGE2,
  IMAGE_STAGE3,
  UPDATE_METADATA_URL,
  SYNC_EVOLVE_URL,
  ASSIGNMENTS_URL,
  STAGE3_ASSIGNMENTS_URL,
} from "./config.js";
import { loadBurnProgram, getStage2Variants, getBurnableChars } from "./burn-program.js";
import { enrichTripToken } from "../shared/token-images.js";
import { multicallChunked, scanOwnedTokenIds } from "../shared/multicall-chunked.js";
import { patchOwnerInCache, invalidateOwnerMapCache } from "../shared/token-owners.js";
import { fetchWithTimeout } from "../shared/fetch-timeout.js";
import {
  matchesTokenGridFilters,
  mountTokenGridFilters,
  formatFilterCount,
} from "../shared/token-grid-filters.js";
import VARIANT_MAP from "./variant-map.json";
import STAGE3_MAP from "./stage3-variants.json";
import LOCAL_ASSIGNMENTS from "./token-assignments.json";
import LOCAL_STAGE3_ASSIGNMENTS from "./stage3-assignments.json";
import { fetchEvolutionHistory, openEvolutionModal } from "./evolution.js";

/** tokenId → { slug, bg, frame } — Stage 2 assignments */
let TOKEN_ASSIGNMENTS = {};
/** tokenId → { slug, bg, frame } — Stage 3 assignments (independent of S2 name) */
let STAGE3_ASSIGNMENTS = {};

/** tokenId → { image, slug, bg, frame, stage } — from server metadata (matches OpenSea) */
const METADATA_CACHE = {};

/** @deprecated use BURN_PROGRAM_VERSION from config.js */
const LAB_BUILD = BURN_PROGRAM_VERSION;

function collectUsedSlugs(character, excludeTokenId = null) {
  const variants = getStage2Variants()[character] || [];
  const slugSet  = new Set(variants.map(v => v.slug));
  const used     = new Set();
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

  const used      = collectUsedSlugs(character, excludeTokenId);
  const preferred = VARIANT_MAP[key] || variants[Number(tokenId) % variants.length];

  if (preferred && !used.has(preferred.slug)) return preferred;
  return variants.find(v => !used.has(v.slug)) || preferred || variants[0];
}

function isValidCatalogSlug(slug) {
  if (!slug) return false;
  for (const list of Object.values(getStage2Variants())) {
    if (list.some(v => v.slug === slug)) return true;
  }
  return false;
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

function getStage3Pool(character) {
  return STAGE3_MAP.poolByChar?.[character] ?? [];
}

function collectUsedStage3Slugs(character, excludeTokenId = null) {
  const pool = getStage3Pool(character);
  const slugSet = new Set(pool.map(e => e.slug));
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
    const hit = pool.find(e => e.slug === STAGE3_ASSIGNMENTS[key].slug);
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

function getStage3ForCharacter(character) {
  if (isDirectToS3Char(character)) {
    return STAGE3_MAP.defaultByChar?.[character] ?? getStage3Pool(character)[0] ?? null;
  }
  const pool = getStage3Pool(character);
  return pool.length ? pool[0] : null;
}

function getStage3Variant(tokenId, character, stage = 0) {
  if (stage === 0 && isDirectToS3Char(character)) {
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

function targetStageLabel(character, currentStage) {
  if (currentStage === 2) return "Stage 3";
  if (currentStage === 0 && isDirectToS3Char(character)) return "Stage 3";
  return "Stage 2";
}

function evolvePreviewVariant(tokenId, character, stage) {
  if (stage === 0 && isDirectToS3Char(character)) {
    return getStage3ForCharacter(character);
  }
  if (stage === 0) {
    return resolveStage2Variant(tokenId, character, tokenId);
  }
  return getStage3Variant(tokenId, character, stage);
}

function canEvolveToStage3(tokenId, character, stage) {
  if (stage !== 2) return false;
  if (!getBurnableChars().has(character) && !isDirectToS3Char(character)) return false;
  return !!resolveStage3Variant(tokenId, character, tokenId);
}

function characterFromMetadata(tokenId) {
  const cached = METADATA_CACHE[String(tokenId)];
  if (cached?.characterName && CHAR_NAME_TO_ID[cached.characterName] != null) {
    return cached.characterName;
  }
  return null;
}

function isValidCharId(charId) {
  return Number.isInteger(charId) && charId >= 0;
}

function resolveCharacterName(tokenId, charId, fallback = null) {
  if (isValidCharId(charId) && CHAR_ID_TO_NAME[charId]) return CHAR_ID_TO_NAME[charId];
  return characterFromMetadata(tokenId) || fallback;
}

/** charId → 0 Blocked, 1 Normal, 2 DirectToS3 (from EvolvePixelTrip.characterPath) */
const CHAR_PATH_CACHE = new Map();

async function loadCharacterPaths(charIds) {
  const unique = [...new Set(charIds.filter(isValidCharId))];
  const missing = unique.filter((id) => !CHAR_PATH_CACHE.has(id));
  if (!missing.length) return;

  const contracts = missing.map((charId) => ({
    address: EVOLVE_ADDRESS,
    abi:     EVOLVE_ABI,
    functionName: "characterPath",
    args:    [charId],
  }));

  const results = await multicallChunked(readClient || publicClient, contracts);
  missing.forEach((charId, i) => {
    const r = results[i];
    if (r?.status === "success") {
      CHAR_PATH_CACHE.set(charId, Number(r.result));
    }
  });
}

function charPathBlocked(charId) {
  if (!isValidCharId(charId)) return true;
  if (!CHAR_PATH_CACHE.has(charId)) return false;
  return CHAR_PATH_CACHE.get(charId) === 0;
}

function charPathLabel(charId) {
  const path = CHAR_PATH_CACHE.get(charId);
  if (path === 1) return "Normal";
  if (path === 2) return "DirectToS3";
  if (path === 0) return "Blocked";
  return "unknown";
}

function finalizeToken(stub) {
  const character = resolveCharacterName(stub.tokenId, stub.charId, stub.character);
  const flags = tokenLabFlags(stub.tokenId, character, stub.stage, stub.charId);
  return {
    ...stub,
    character,
    canEvolve: flags.canEvolve,
    viewReason: flags.viewReason,
    name: `#${stub.tokenId}${character ? ` ${character}` : ""}`,
    image: getTokenImage(stub.tokenId, character, stub.stage),
  };
}

function tokenLabFlags(tokenId, character, stage, charId = 0) {
  const burnable = getBurnableChars().has(character) || isDirectToS3Char(character);
  if (!burnable) {
    return { canEvolve: false, viewReason: "not_burnable" };
  }
  if (stage === 3) {
    return { canEvolve: false, viewReason: "maxed" };
  }
  if (stage === 0) {
    if (isValidCharId(charId) && charPathBlocked(charId)) {
      return { canEvolve: false, viewReason: "contract_blocked" };
    }
    if (isDirectToS3Char(character) && !resolveStage3Variant(tokenId, character, tokenId)) {
      return { canEvolve: false, viewReason: "no_s3" };
    }
    return { canEvolve: true, viewReason: null };
  }
  if (stage === 2) {
    if (canEvolveToStage3(tokenId, character, stage)) {
      return { canEvolve: true, viewReason: null };
    }
    return { canEvolve: false, viewReason: "no_s3" };
  }
  return { canEvolve: false, viewReason: "unknown_stage" };
}

function bustUrl(url, slug) {
  if (!url || !slug) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(slug)}`;
}

/** Never use legacy Test/ paths — old test mint GIFs do not match main metadata. */
function normalizeStage1Image(url, tokenId) {
  const fallback = `${IMAGE_STAGE1}/${tokenId}.gif`;
  if (!url) return fallback;
  const normalized = url.replace("/Test/images/", "/images/");
  return normalized.includes("/images/") ? normalized : fallback;
}

function stage1ImageUrl(tokenId) {
  const key = String(tokenId);
  const cached = METADATA_CACHE[key];
  const base = normalizeStage1Image(cached?.image, tokenId);
  const bust = cached?.dna || cached?.edition || "main";
  return bustUrl(base, bust);
}

function stageImageUrls(tokenId, character, stage) {
  const key = String(tokenId);
  const cached = METADATA_CACHE[key];
  const s1 = stage1ImageUrl(tokenId);

  // Prefer server metadata (OpenSea source of truth) over formula guesses.
  if (stage >= 2 && cached?.slug) {
    const variant = {
      slug:  cached.slug,
      bg:    cached.bg || "Unknown",
      frame: cached.frame || "Unknown",
    };
    const metaImg = cached.image ? bustUrl(cached.image, cached.slug) : null;

    if (stage === 3 && cached.stage >= 3) {
      const primary = metaImg || `${IMAGE_STAGE3}/${cached.slug}.gif?v=${encodeURIComponent(cached.slug)}`;
      return { primary, fallback: s1, variant };
    }
    if (stage === 2 && cached.stage === 2 && metaImg) {
      return { primary: metaImg, fallback: s1, variant };
    }
  }

  const s2v = character ? getStage2Variant(tokenId, character, stage) : null;
  const bust = s2v?.slug ? `?v=${encodeURIComponent(s2v.slug)}` : "";
  const s2  = s2v ? `${IMAGE_STAGE2}/${s2v.slug}.gif${bust}` : s1;
  const s3v = character ? getStage3Variant(tokenId, character, stage) : null;
  const s3b = s3v?.slug ? `?v=${encodeURIComponent(s3v.slug)}` : bust;
  const s3  = s3v ? `${IMAGE_STAGE3}/${s3v.slug}.gif${s3b}` : s2;
  if (stage === 3) return { primary: s3, fallback: s2, variant: s3v || s2v };
  if (stage === 2) return { primary: s2, fallback: s1, variant: s2v };
  return { primary: s1, fallback: s1, variant: null };
}

function getTokenImage(tokenId, character, stage) {
  return stageImageUrls(tokenId, character, stage).primary;
}

async function loadAssignments() {
  TOKEN_ASSIGNMENTS = { ...LOCAL_ASSIGNMENTS };
  STAGE3_ASSIGNMENTS = { ...LOCAL_STAGE3_ASSIGNMENTS };
  try {
    const res = await fetchWithTimeout(`${ASSIGNMENTS_URL}&t=${Date.now()}`);
    if (res.ok) {
      const remote = await res.json();
      TOKEN_ASSIGNMENTS = { ...TOKEN_ASSIGNMENTS, ...remote };
      console.log(`[assignments] loaded ${Object.keys(TOKEN_ASSIGNMENTS).length} entries`);
    } else {
      console.warn("[assignments] server returned", res.status, "— using local fallback");
    }
  } catch (err) {
    console.warn("[assignments] load failed:", err.message);
  }
  try {
    const res = await fetchWithTimeout(`${STAGE3_ASSIGNMENTS_URL}&t=${Date.now()}`);
    if (res.ok) {
      const remote = await res.json();
      STAGE3_ASSIGNMENTS = { ...STAGE3_ASSIGNMENTS, ...remote };
      console.log(`[stage3] loaded ${Object.keys(STAGE3_ASSIGNMENTS).length} entries`);
    }
  } catch (err) {
    console.warn("[stage3 assignments] load failed:", err.message);
  }
}

function applyAssignment(tokenId, assignment) {
  if (assignment?.slug && isValidCatalogSlug(assignment.slug)) {
    TOKEN_ASSIGNMENTS[String(tokenId)] = assignment;
  }
}

function applyStage3Assignment(tokenId, assignment) {
  if (assignment?.slug) {
    STAGE3_ASSIGNMENTS[String(tokenId)] = assignment;
  }
}

function formatSyncError(message) {
  if (/^load failed$/i.test(message) || /failed to fetch/i.test(message)) {
    return "Network error — try desktop Chrome (not Telegram browser)";
  }
  if (/timed out|timeout|504|gateway/i.test(message)) {
    return "Metadata server slow — wait 30s and click Sync again (or use desktop Chrome)";
  }
  return message;
}

function applySyncResponse(tokenId, data) {
  const key = String(tokenId);
  const stage = data.stage ?? 0;
  const slug = data.variant || data.assignment?.slug;
  if (!slug) return;

  const bg = data.assignment?.bg || "Unknown";
  const frame = data.assignment?.frame || "Unknown";
  const image = data.image || (stage >= 3
    ? `${IMAGE_STAGE3}/${slug}.gif`
    : `${IMAGE_STAGE2}/${slug}.gif`);

  if (stage >= 3) {
    applyStage3Assignment(tokenId, { slug, bg, frame });
    METADATA_CACHE[key] = {
      ...(METADATA_CACHE[key] || {}),
      slug,
      bg,
      frame,
      stage: 3,
      image,
      characterName: slug,
    };
    return;
  }

  if (stage === 2 && isValidCatalogSlug(slug)) {
    applyAssignment(tokenId, { slug, bg, frame });
    METADATA_CACHE[key] = {
      ...(METADATA_CACHE[key] || {}),
      slug,
      bg,
      frame,
      stage: 2,
      image,
      characterName: slug,
    };
  }
}

function parseMetaVariant(meta, tokenId) {
  if (!meta?.attributes) return null;
  let slug = null, bg = null, frame = null, stage = 0, characterName = null;
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
    if (stage >= 3) {
      return { slug, bg: bg || "Unknown", frame: frame || "Unknown", stage, characterName };
    }
    if (isValidCatalogSlug(slug)) {
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
    const variant = parseMetaVariant(meta, tokenId);
    const entry = {
      image:   normalizeStage1Image(meta.image || meta.animation_url || null, tokenId),
      dna:     meta.dna || null,
      edition: meta.edition ?? null,
      slug:    variant?.slug || null,
      bg:      variant?.bg,
      frame:   variant?.frame,
      stage:   variant?.stage ?? 0,
      characterName: variant?.characterName || null,
    };
    if (variant) {
      if (variant.stage >= 3) applyStage3Assignment(tokenId, variant);
      else applyAssignment(tokenId, variant);
    }
    METADATA_CACHE[key] = entry;
    return entry;
  };

  try {
    const res = await fetch(`${UPDATE_METADATA_URL}?metadata=${tokenId}&t=${Date.now()}`, { cache: "no-store" });
    const hit = await parseResponse(res);
    if (hit) return hit;
  } catch (err) {
    console.warn(`[metadata] #${tokenId} proxy load failed:`, err.message);
  }

  try {
    const res = await fetch(`${IMAGE_STAGE1.replace("/images", "/metadata")}/${tokenId}?t=${Date.now()}`, {
      cache: "no-store",
    });
    return await parseResponse(res);
  } catch (err) {
    console.warn(`[metadata] #${tokenId} direct load failed:`, err.message);
    return null;
  }
}

async function loadMetadataForTokens(tokenIds) {
  const unique = [...new Set(tokenIds.map(Number).filter(Boolean))];
  await Promise.all(unique.map(id => fetchTokenMetadata(id)));
}

function refreshTokenImages() {
  tokens = tokens.map(finalizeToken);
}

function buildEvolvedMetadata(tokenId, charName, newStage) {
  if (newStage === 2) {
    const variant  = getStage2Variant(tokenId, charName, 2) || { slug: charName, bg: "Unknown", frame: "Unknown" };
    return {
      name:          `PIXEL TRIP — ${variant.slug.replace(/_/g, " ")} #${tokenId}`,
      description:   "PIXEL TRIP — 4444 animated pixel portraits on a three-layer journey.",
      image:         `${IMAGE_STAGE2}/${variant.slug}.gif`,
      animation_url: `${IMAGE_STAGE2}/${variant.slug}.gif`,
      external_url:  "https://pixeltripnft.website",
      attributes: [
        { trait_type: "Background", value: variant.bg },
        { trait_type: "Character",  value: variant.slug },
        { trait_type: "Frame",      value: variant.frame },
        { trait_type: "Stage",      value: "2" },
      ],
    };
  }
  if (newStage === 3) {
    const variant = getStage3Variant(tokenId, charName, 3) || { slug: charName, bg: "Unknown", frame: "Unknown" };
    return {
      name:          `PIXEL TRIP — ${variant.slug.replace(/_/g, " ")} #${tokenId}`,
      description:   "PIXEL TRIP — A fully ascended tripper. Reached Stage 3 through the burn-to-evolve journey.",
      image:         `${IMAGE_STAGE3}/${variant.slug}.gif`,
      animation_url: `${IMAGE_STAGE3}/${variant.slug}.gif`,
      external_url:  "https://pixeltripnft.website",
      attributes: [
        { trait_type: "Background", value: variant.bg },
        { trait_type: "Character",  value: variant.slug },
        { trait_type: "Frame",      value: variant.frame },
        { trait_type: "Stage",      value: "3" },
      ],
    };
  }
  return null;
}

async function pollServerMetadataStage(tokenId, minStage, { timeoutMs = 60_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await fetchTokenMetadata(tokenId);
    const stage = serverMetaStage(tokenId);
    if (stage >= minStage) {
      const cached = METADATA_CACHE[String(tokenId)] || {};
      return {
        ok: true,
        data: {
          stage,
          variant: cached.slug,
          image: cached.image,
          assignment: cached.slug ? { slug: cached.slug, bg: cached.bg, frame: cached.frame } : undefined,
        },
      };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false };
}

async function triggerServerReconcile(tokenId = null, burnTokenId = null) {
  if (!tokenId) return null;
  try {
    const params = new URLSearchParams({ reconcile: "1" });
    params.set("tokenId", String(tokenId));
    if (burnTokenId) params.set("burnTokenId", String(burnTokenId));
    const res = await fetchWithTimeout(`${SYNC_EVOLVE_URL}?${params}`, {}, 120_000);
    const data = await res.json().catch(() => ({}));
    const fixed = [...(data.reconciled ?? []), ...(data.synced ?? [])];
    if (fixed.length) {
      console.log(`[metadata] server reconciled ${fixed.length} token(s)`, fixed);
      const ids = fixed.map((row) => Number(row.tokenId)).filter(Boolean);
      if (ids.length) {
        await loadMetadataForTokens(ids);
        refreshTokenImages();
        renderGrid();
      }
    }
    return data;
  } catch (err) {
    console.warn("[metadata] server reconcile skipped:", err.message);
    return null;
  }
}

function scheduleMetadataRetry(tokenId, burnTokenId = null, { attempts = 4 } = {}) {
  const delays = [3000, 8000, 20000, 45000];
  delays.slice(0, attempts).forEach((delay, index) => {
    setTimeout(async () => {
      const r = await syncMetadataToServer(tokenId, burnTokenId, { retries: 2, minStage: 2 });
      if (r.ok) {
        applyEvolveResult(tokenId, burnTokenId, Number(r.data?.stage ?? 2));
        refreshTokenImages();
        renderGrid();
        setMessage(
          `Metadata synced for #${tokenId} (${r.data?.variant || "?"}). Refresh OpenSea in a few minutes.`,
          "success",
        );
        return;
      }
      if (index === attempts - 1) {
        void triggerServerReconcile(tokenId, burnTokenId);
      }
    }, delay);
  });
}

async function syncMetadataToServer(tokenId, burnTokenId = null, { retries = 3, minStage = 2 } = {}) {
  let lastError = "Sync failed";
  const isSlowError = (msg) => /timed out|timeout|504|gateway|load failed/i.test(msg || "");

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(
        UPDATE_METADATA_URL,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ tokenId, sync: true, burnTokenId: burnTokenId || undefined }),
        },
        90_000,
      );
      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        if (text.includes("Internal Server Error")) {
          lastError = "HTTP 500 — fix public_html/.htaccess (remove LocationMatch)";
        } else {
          lastError = `HTTP ${res.status}`;
        }
        if (res.status === 504 || isSlowError(lastError)) {
          const polled = await pollServerMetadataStage(tokenId, minStage, { timeoutMs: 20_000, intervalMs: 2_000 });
          if (polled.ok) {
            applySyncResponse(tokenId, polled.data);
            console.log(`[metadata] #${tokenId} updated on server (detected after HTTP ${res.status})`);
            return polled;
          }
        }
        continue;
      }
      if (data.ok) {
        applySyncResponse(tokenId, data);
        console.log(`[metadata] Synced metadata/${tokenId} → Stage ${data.stage} (${data.variant})`);
        return { ok: true, data };
      }
      lastError = data.error || `HTTP ${res.status}`;
    } catch (err) {
      lastError = formatSyncError(err.message);
      if (isSlowError(err.message)) {
        const polled = await pollServerMetadataStage(tokenId, minStage, { timeoutMs: 20_000, intervalMs: 2_000 });
        if (polled.ok) {
          applySyncResponse(tokenId, polled.data);
          console.log(`[metadata] #${tokenId} updated on server (detected after timeout)`);
          return polled;
        }
      }
    }
    if (attempt < retries) {
      console.warn(`[metadata] #${tokenId} sync attempt ${attempt} failed, retrying…`, lastError);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }

  console.warn(`[metadata] #${tokenId} POST failed, trying server reconcile…`);
  await triggerServerReconcile(tokenId, burnTokenId);
  const polled = await pollServerMetadataStage(tokenId, minStage, { timeoutMs: 90_000, intervalMs: 4_000 });
  if (polled.ok) {
    applySyncResponse(tokenId, polled.data);
    console.log(`[metadata] #${tokenId} synced via server reconcile`);
    return polled;
  }

  return { ok: false, error: lastError };
}

async function autoUpdateMetadata(tokenId, charName, newStage, txHash) {
  if (!charName) {
    console.warn("[metadata] charName is empty — cannot update");
    return { ok: false, error: "Character name missing" };
  }
  try {
    const res = await fetch(UPDATE_METADATA_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tokenId, charName, newStage, txHash }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      applySyncResponse(tokenId, data);
      console.log(`[metadata] Updated metadata/${tokenId} → Stage ${newStage}`);
      return { ok: true, data };
    }
    const errMsg = data.error || `HTTP ${res.status}`;
    console.warn("[metadata] Server returned error:", errMsg);
    return { ok: false, error: errMsg };
  } catch (err) {
    console.warn("[metadata] Auto-update failed:", err.message);
    return { ok: false, error: err.message };
  }
}

async function syncAllEvolvedTokens() {
  const stale = tokens.filter(needsMetadataSync);
  if (!stale.length) {
    setMessage("All evolved tokens are already synced on the metadata server.", "success");
    return;
  }

  if (els.sync) els.sync.disabled = true;
  setMessage(`Syncing ${stale.length} token(s) with outdated metadata…`, "pending");
  const failed = [];
  const syncedIds = [];

  try {
    for (let i = 0; i < stale.length; i++) {
      const t = stale[i];
      if (i > 0) await new Promise((r) => setTimeout(r, 300));
      setMessage(`Syncing ${i + 1}/${stale.length} (#${t.tokenId})…`, "pending");
      const r = await syncMetadataToServer(t.tokenId, null, { retries: 2, minStage: t.stage });
      if (!r.ok) failed.push(`#${t.tokenId}: ${formatSyncError(r.error)}`);
      else syncedIds.push(t.tokenId);
    }
  } finally {
    if (els.sync) els.sync.disabled = false;
  }

  if (syncedIds.length) {
    await loadMetadataForTokens(syncedIds);
    refreshTokenImages();
    renderGrid();
  }

  if (!failed.length) {
    setMessage(`Metadata synced for ${stale.length} token(s). Refresh OpenSea in a few minutes.`, "success");
  } else if (syncedIds.length) {
    setMessage(
      `Synced ${syncedIds.length}/${stale.length}. Failed: ${failed.slice(0, 5).join("; ")}` +
      `${failed.length > 5 ? ` (+${failed.length - 5} more)` : ""}`,
      "error",
    );
  } else {
    setMessage(`Sync failed: ${failed.slice(0, 5).join("; ")}. Try desktop Chrome.`, "error");
  }
}

function serverMetaStage(tokenId) {
  return METADATA_CACHE[String(tokenId)]?.stage ?? 0;
}

function needsMetadataSync(stub) {
  if (stub.stage < 2) return false;
  return serverMetaStage(stub.tokenId) < stub.stage;
}

/** After wallet connect — fix tokens evolved on-chain but still Stage 1 on server. */
async function autoSyncStaleMetadata(stubs) {
  const stale = stubs.filter(needsMetadataSync);
  if (!stale.length) return { synced: 0, failed: [] };

  console.log(`[metadata] background sync ${stale.length} stale token(s):`, stale.map(t => t.tokenId));
  const failed = [];
  let synced = 0;
  for (const t of stale.slice(0, 10)) {
    const r = await syncMetadataToServer(t.tokenId, null, { retries: 2, minStage: t.stage });
    if (!r.ok) failed.push(`#${t.tokenId}: ${formatSyncError(r.error)}`);
    else synced++;
  }
  if (synced) {
    await loadMetadataForTokens(stale.slice(0, 10).map(t => t.tokenId));
  }
  return { synced, failed };
}

function showMetadataDownload(tokenId, charName, newStage) {
  const meta = buildEvolvedMetadata(tokenId, charName, newStage);
  if (!meta) return;

  const json = JSON.stringify(meta, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);

  // Remove old download banner if exists
  document.getElementById("burn-meta-download")?.remove();

  const banner = document.createElement("div");
  banner.id = "burn-meta-download";
  banner.style.cssText = "margin-top:12px;padding:14px;background:#111;border:1px solid #00ff88;border-radius:6px;font-size:0.85rem;line-height:1.6;color:#ccc;";
  banner.innerHTML = `
    <strong style="color:#00ff88">Token #${tokenId} evolved to ${newStage === 2 ? "Stage 2" : "Stage 3"}!</strong><br>
    Скачай JSON и загрузи на сервер через WinSCP:<br>
    <code style="color:#00e5ff">pixeltripnft.website/metadata/${tokenId}</code>
    <br><br>
    <a href="${url}" download="${tokenId}"
       style="display:inline-block;padding:8px 18px;background:#00ff88;color:#000;font-weight:700;border-radius:4px;text-decoration:none;margin-right:8px;">
      Скачать metadata/${tokenId}
    </a>
    <button onclick="navigator.clipboard.writeText(${JSON.stringify(json)}).then(()=>this.textContent='Скопировано!')"
      style="padding:8px 18px;background:#222;color:#00e5ff;border:1px solid #00e5ff;border-radius:4px;cursor:pointer;">
      Копировать JSON
    </button>
  `;
  els.root.appendChild(banner);
}

const els = {
  root:    document.getElementById("burn-dapp"),
  network: document.getElementById("burn-network"),
  connect: document.getElementById("burn-connect"),
  stats:   document.getElementById("burn-stats"),
  filters: document.getElementById("burn-token-filters"),
  count:   document.getElementById("burn-token-count"),
  grid:    document.getElementById("burn-token-grid"),
  evolve:  document.getElementById("burn-evolve"),
  sync:    document.getElementById("burn-sync"),
  message: document.getElementById("burn-message"),
};

let gridFilters = { getState: () => ({ stageFilter: "all", burnFilter: "all", search: "" }) };

let walletClient = null;
let publicClient = null;
let readClient   = null;
let receiptClient = null;
let account      = null;
let tokens         = [];   // { tokenId, name, image, character, stage, canEvolve, viewReason }
let lastOwnedCount = 0;
let keepToken    = null; // first selected — will be upgraded
let burnToken    = null; // second selected — will be destroyed
let isApproved   = false;
let loadGeneration = 0;

// ── UI helpers ────────────────────────────────────────────────────────────────

function setMessage(text, type = "info") {
  if (!els.message) return;
  els.message.textContent = text;
  els.message.dataset.type = type;
}

function shortAddress(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function updateEvolveButton() {
  if (!els.evolve) return;
  if (!keepToken || !burnToken) {
    els.evolve.textContent = "Evolve (select 2 same-character tokens)";
    els.evolve.disabled = true;
    return;
  }
  els.evolve.disabled = false;
  const action = isApproved ? "Evolve" : "Approve + Evolve";
  els.evolve.textContent = `${action}: keep #${keepToken.tokenId}, burn #${burnToken.tokenId}`;
}

// ── Network ───────────────────────────────────────────────────────────────────

async function ensureMainnet() {
  const chainId = await walletClient.request({ method: "eth_chainId" });
  if (chainId !== "0x1") {
    await walletClient.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }],
    });
  }
}

// ── Token discovery ───────────────────────────────────────────────────────────

let lastWalletBalance = null;

async function getOwnedIds({ refreshMap = false, onSupplement = null } = {}) {
  setMessage("Loading tokens…", "info");

  const MAX_ID = SCAN_MAX_ID;
  const client = readClient || publicClient;
  let owned = [];
  lastWalletBalance = null;

  try {
    const scan = await scanOwnedTokenIds(client, {
      owner: account,
      maxId: MAX_ID,
      collectionAddress: STAGE1_ADDRESS,
      collectionAbi: STAGE1_ABI,
      forceRefresh: refreshMap,
      logClient: publicClient,
      onSupplement,
    });
    owned = scan.tokenIds;
    lastWalletBalance = scan.balance;
    if (scan.timedOut && owned.length) {
      setMessage(`Loaded ${owned.length} token(s) (scan timed out — catching up in background).`, "info");
    } else if (scan.partial && scan.balance != null && owned.length) {
      setMessage(`Loaded ${owned.length} of ${scan.balance} token(s) — finding the rest…`, "info");
    } else if (scan.partial && owned.length) {
      setMessage(`Found ${owned.length} token(s). Checking for new purchases…`, "info");
    }
  } catch (err) {
    console.warn("[scan] failed:", err.message);
  }

  console.log(`[scan] Owned token IDs (${owned.length})`);
  return owned;
}

async function loadTokens({ refreshMap = false, ownedIdsOverride = null } = {}) {
  const gen = ++loadGeneration;
  setMessage("Loading your trippers…", "info");

  let ownedIds = ownedIdsOverride;
  if (!ownedIds) {
    ownedIds = await getOwnedIds({
      refreshMap,
      onSupplement: (ids) => {
        if (gen !== loadGeneration) return;
        console.log(`[scan] background supplement → ${ids.length} token(s)`);
        void loadTokens({ ownedIdsOverride: ids });
      },
    });
    if (gen !== loadGeneration) {
      console.log("[token] stale wallet load ignored");
      return;
    }
  }
  lastOwnedCount = ownedIds.length;

  // One multicall for all evolve contract reads
  const contracts = ownedIds.flatMap((id) => [
    { address: EVOLVE_ADDRESS, abi: EVOLVE_ABI, functionName: "stage1Character", args: [BigInt(id)] },
    { address: EVOLVE_ADDRESS, abi: EVOLVE_ABI, functionName: "evolvedStage",   args: [BigInt(id)] },
  ]);

  let mcResults = [];
  try {
    mcResults = await multicallChunked(readClient || publicClient, contracts);
  } catch (err) {
    console.warn("[token] evolve multicall failed:", err.message);
  }

  const stubs = [];
  for (let i = 0; i < ownedIds.length; i++) {
    const id = ownedIds[i];
    try {
      const charR  = mcResults[i * 2];
      const stageR = mcResults[i * 2 + 1];
      const charId = charR?.status === "success" ? Number(charR.result) : 0;
      const stage  = stageR?.status === "success" ? Number(stageR.result) : 0;

      const character    = CHAR_ID_TO_NAME[charId] || null;
      const currentStage = stage;
      stubs.push({
        tokenId:    id,
        character:  character || `Unknown #${charId}`,
        charId,
        stage:      currentStage,
        canEvolve:  false,
        viewReason: null,
        name:       `#${id}${character ? ` ${character}` : ""}`,
      });
    } catch (e) {
      console.warn(`[token] #${id} read failed:`, e.message);
    }
  }

  const stage1CharIds = stubs.filter((t) => t.stage === 0 && isValidCharId(t.charId)).map((t) => t.charId);
  try {
    await loadCharacterPaths(stage1CharIds);
  } catch (err) {
    console.warn("[token] characterPath multicall failed:", err.message);
  }

  for (const stub of stubs) {
    const character = CHAR_ID_TO_NAME[stub.charId] || stub.character;
    const flags = tokenLabFlags(stub.tokenId, character, stub.stage, stub.charId);
    stub.character = character;
    stub.canEvolve = flags.canEvolve;
    stub.viewReason = flags.viewReason;

    if (!CHAR_ID_TO_NAME[stub.charId]) {
      console.warn(`[token] #${stub.tokenId} unknown charId=${stub.charId} — shown as view-only`);
    } else if (flags.viewReason === "not_burnable") {
      console.log(`[token] #${stub.tokenId} ${character} — not in burn program (view only)`);
    } else if (flags.viewReason === "contract_blocked") {
      console.warn(`[token] #${stub.tokenId} ${character} — characterPath=Blocked on evolve contract`);
    }
  }

  const evolvedIds = stubs.filter(t => t.stage >= 2).map(t => t.tokenId);
  const stage1Ids  = stubs.filter(t => t.stage === 0).map(t => t.tokenId);
  if (stage1Ids.length) await loadMetadataForTokens(stage1Ids);
  if (evolvedIds.length) await loadMetadataForTokens(evolvedIds);

  tokens = stubs.map(finalizeToken);
  keepToken  = null;
  burnToken  = null;
  isApproved = await refreshApprovalStatus();
  renderGrid();
  updateStats();
  updateEvolveButton();

  void autoSyncStaleMetadata(stubs).then((autoSync) => {
    if (gen !== loadGeneration) return;
    if (!autoSync.synced && !autoSync.failed.length) return;
    refreshTokenImages();
    renderGrid();
    if (autoSync.synced) {
      setMessage(
        `Background: synced metadata for ${autoSync.synced} token(s). Use Sync button for OpenSea.`,
        "success",
      );
    }
  });
  if (gen !== loadGeneration) {
    console.log("[token] stale wallet load ignored (after render)");
    return;
  }

  if (!tokens.length) {
    if (!ownedIds.length) {
      setMessage(
        "No tokens found in this wallet on Ethereum Mainnet. " +
        "If you just bought on OpenSea, click Connect Wallet again to refresh.",
        "error",
      );
    } else {
      setMessage(
        `${ownedIds.length} token(s) in wallet, but none are burnable trippers ` +
        `(Ape_Beard, Beanie_Cyclops, Diva, Alpine_Hunter at Stage 1–3). ` +
        `Check console for details.`,
        "info"
      );
    }
  } else {
    const evolvable = tokens.filter(t => t.canEvolve).length;
    const viewOnly  = tokens.length - evolvable;
    let msg =
      `${lastOwnedCount} in wallet · ${tokens.length} shown` +
      (viewOnly ? ` · ${evolvable} evolvable, ${viewOnly} view-only` : "") +
      `. Select 2 of the same burnable character — first selected will be upgraded.` +
      (lastWalletBalance != null && lastOwnedCount < lastWalletBalance
        ? ` Found ${lastOwnedCount}/${lastWalletBalance} — new purchases may appear in a few seconds.`
        : "");
    setMessage(msg, "info");
  }
}

function applyEvolveResult(keepId, burnId, newStage) {
  tokens = tokens
    .filter(t => t.tokenId !== burnId)
    .map(t => {
      if (t.tokenId !== keepId) return t;
      return finalizeToken({ ...t, stage: newStage });
    });
  keepToken = null;
  burnToken = null;
  renderGrid();
  updateStats();
  updateEvolveButton();
}

const STAGE_LABEL = { 0: "Stage 1", 2: "Stage 2", 3: "Stage 3 ✓" };
const STAGE_COLOR = { 0: "#00e5ff", 2: "#ff2bd6", 3: "#ffd700" };

async function showTokenEvolution(token) {
  const urls = stageImageUrls(token.tokenId, token.character, token.stage);
  setMessage(`Loading evolution history for #${token.tokenId}…`, "info");
  const history = await fetchEvolutionHistory(token.tokenId);
  openEvolutionModal({
    tokenId: token.tokenId,
    currentStage: token.stage || 3,
    currentImage: urls.primary,
    history,
  });
  const stages = history?.self?.length ?? 0;
  if (stages) {
    setMessage(`#${token.tokenId} — ${stages + 1} evolution stage(s). Click thumbnails to switch.`, "success");
  } else {
    setMessage(`#${token.tokenId} — no evolution history on server yet. History is recorded on the next evolve sync.`, "info");
  }
}

function renderGrid() {
  if (!els.grid) return;
  if (!tokens.length) {
    if (els.count) els.count.hidden = true;
    els.grid.innerHTML = `<p class="burn-empty">No evolveable trippers in this wallet.</p>`;
    return;
  }

  const filterState = gridFilters.getState();
  const visible = tokens.filter((token) =>
    matchesTokenGridFilters(enrichTripToken(token), filterState),
  );

  if (els.count) {
    els.count.hidden = false;
    els.count.textContent = formatFilterCount(visible.length, tokens.length);
  }

  if (!visible.length) {
    els.grid.innerHTML = `<p class="burn-empty">No trippers match filters.</p>`;
    return;
  }

  els.grid.innerHTML = "";
  for (const token of visible) {
    const card = document.createElement("button");
    card.type  = "button";
    card.className = "burn-token";

    const isKeep = keepToken?.tokenId === token.tokenId;
    const isBurn = burnToken?.tokenId === token.tokenId;
    if (isKeep) card.classList.add("is-keep");
    if (isBurn) card.classList.add("is-burn");
    if (!token.canEvolve) card.classList.add("is-locked");

    const stageColor = STAGE_COLOR[token.stage] ?? "#fff";
    const roleLabel  = isKeep ? "⬆ KEEP" : isBurn ? "🔥 BURN" : "";
    const directNote = token.stage === 0 && isDirectToS3Char(token.character) ? " · S1→S3" : "";
    const lockedNote = !token.canEvolve
      ? token.viewReason === "not_burnable" ? " · not in program"
        : token.viewReason === "contract_blocked" ? " · enable on-chain"
        : token.viewReason === "maxed"      ? ""
        : token.viewReason === "no_s3"      ? " · no S3 art"
        : token.viewReason === "unknown_stage" ? " · wrong stage"
        : " · locked"
      : "";

    const urls = stageImageUrls(token.tokenId, token.character, token.stage);
    const variantLabel = urls.variant?.slug?.replace(/_/g, " ") ?? "";

    card.innerHTML = `
      ${urls.primary
        ? `<img src="${urls.primary}" data-fallback="${urls.fallback}" alt="${token.name}" width="72" height="72" />`
        : `<div class="burn-token-placeholder">✦</div>`
      }
      <span class="burn-token-id">#${token.tokenId}</span>
      <span class="burn-token-meta">${variantLabel || token.character || token.name}</span>
      <span class="burn-token-level" style="color:${stageColor}">${STAGE_LABEL[token.stage] ?? `Stage ${token.stage}`}${directNote}${lockedNote}</span>
      ${roleLabel ? `<span class="burn-token-role">${roleLabel}</span>` : ""}
    `;

    const img = card.querySelector("img");
    if (img) {
      img.addEventListener("error", () => {
        const fb = img.dataset.fallback;
        if (fb && img.src !== fb) img.src = fb;
      }, { once: true });
    }

    card.addEventListener("click", () => toggleSelect(token));
    els.grid.appendChild(card);
  }
}

function toggleSelect(token) {
  if (!token.canEvolve) {
    if (token.stage >= 2 || token.viewReason === "maxed") {
      void showTokenEvolution(token);
      return;
    }
    const msg = {
      not_burnable: `#${token.tokenId} (${token.character}) — not in the burn program.`,
      contract_blocked: `#${token.tokenId} (${token.character}) — evolve contract has characterPath=Blocked. Owner must run setCharacterPaths in Remix.`,
      no_s3:        `#${token.tokenId} — Stage 3 art not uploaded yet for ${token.character}.`,
      maxed:        `#${token.tokenId} is fully evolved (Stage 3).`,
      unknown_stage:`#${token.tokenId} — cannot evolve from current stage.`,
    };
    setMessage(msg[token.viewReason] || `#${token.tokenId} — view only.`, "info");
    return;
  }

  if (keepToken?.tokenId === token.tokenId) {
    // Deselect keep → also clear burn
    keepToken = null;
    burnToken = null;
  } else if (burnToken?.tokenId === token.tokenId) {
    // Deselect burn
    burnToken = null;
  } else if (!keepToken) {
    keepToken = token;
  } else if (!burnToken) {
    burnToken = token;
  } else {
    // Both slots full — replace burn with new pick
    burnToken = token;
  }

  renderGrid();
  updateStats();

  if (keepToken && burnToken) {
    const err = validateSelection();
    if (err) {
      setMessage(err, "error");
      els.evolve.disabled = true;
      return;
    }
    const nextStage = targetStageLabel(keepToken.character, keepToken.stage);
    const preview   = evolvePreviewVariant(keepToken.tokenId, keepToken.character, keepToken.stage);
    setMessage(
      `Ready! #${keepToken.tokenId} → ${nextStage}` +
      (preview ? ` (${preview.slug.replace(/_/g, " ")})` : "") +
      `. #${burnToken.tokenId} will be destroyed.` +
      (isApproved ? "" : " — wallet will ask for one-time approve, then evolve")
    );
    updateEvolveButton();
  } else if (keepToken) {
    setMessage(`#${keepToken.tokenId} selected as KEEP. Now pick the token to BURN.`, "info");
    updateEvolveButton();
  } else {
    setMessage("Select the token you want to UPGRADE first.", "info");
    updateEvolveButton();
  }
}

function validateSelection() {
  if (!keepToken || !burnToken) return "Select 2 trippers.";
  if (keepToken.stage !== burnToken.stage)
    return `Stage mismatch: keep is Stage ${keepToken.stage === 0 ? 1 : keepToken.stage}, burn is Stage ${burnToken.stage === 0 ? 1 : burnToken.stage}.`;
  if (keepToken.character && burnToken.character && keepToken.character !== burnToken.character)
    return `Character mismatch: "${keepToken.character}" vs "${burnToken.character}". Both must be the same character.`;
  if (keepToken.stage === 0 && isValidCharId(keepToken.charId) && charPathBlocked(keepToken.charId)) {
    return `${keepToken.character} is not enabled on the evolve contract yet (characterPath=Blocked). ` +
      `The contract owner must call setCharacterPaths for charId ${keepToken.charId} via Remix.`;
  }
  if (keepToken.stage === 0 && isDirectToS3Char(keepToken.character) && !resolveStage3Variant(keepToken.tokenId, keepToken.character, keepToken.tokenId)) {
    return `No Stage 3 art uploaded for ${keepToken.character}.`;
  }
  if (keepToken.stage === 2 && !canEvolveToStage3(keepToken.tokenId, keepToken.character, 2)) {
    return `All Stage 3 variants for ${keepToken.character} are already taken, or no art in pool.`;
  }
  return null;
}

function updateStats() {
  if (!els.stats) return;
  const s1 = tokens.filter(t => t.stage === 0).length;
  const s2 = tokens.filter(t => t.stage === 2).length;
  const s3 = tokens.filter(t => t.stage === 3).length;
  const evolvable = tokens.filter(t => t.canEvolve).length;
  const viewOnly  = tokens.length - evolvable;
  els.stats.textContent = [
    tokens.length ? `${tokens.length} in wallet` : null,
    tokens.length ? `${evolvable} evolvable${viewOnly ? `, ${viewOnly} view-only` : ""}` : null,
    s1 ? `${s1} Stage 1` : null,
    s2 ? `${s2} Stage 2` : null,
    s3 ? `${s3} Stage 3` : null,
    keepToken ? `keep: #${keepToken.tokenId}` : null,
    burnToken ? `burn: #${burnToken.tokenId}` : null,
    isApproved ? "approved ✓" : null,
    `build ${LAB_BUILD}`,
  ].filter(Boolean).join(" · ");
}

// ── Connect wallet ────────────────────────────────────────────────────────────

function getProvider() {
  return window.ethereum || window.okxwallet || null;
}

let connectInFlight = null;

async function connectWallet({ silent = false, force = false } = {}) {
  if (connectInFlight) {
    if (!force) return connectInFlight;
    loadGeneration++;
    await connectInFlight.catch(() => {});
  }

  connectInFlight = connectWalletInner({ silent, force }).finally(() => {
    connectInFlight = null;
  });
  return connectInFlight;
}

async function connectWalletInner({ silent = false, force = false } = {}) {
  const provider = getProvider();
  if (!provider) {
    if (!silent) setMessage("No Web3 wallet found. Install OKX Wallet, MetaMask or any EVM wallet.", "error");
    return;
  }
  if (!EVOLVE_ADDRESS) {
    if (!silent) setMessage("Deploy EvolvePixelTrip v2 via Remix, then update EVOLVE_ADDRESS in config.js.", "error");
    return;
  }

  try {
    if (!silent) setMessage("Connecting wallet…", "info");
    const probeClient = createWalletClient({ chain: mainnet, transport: custom(provider) });
    if (silent) {
      const accounts = await provider.request({ method: "eth_accounts" });
      if (!accounts?.length) return;
      account = getAddress(accounts[0]);
    } else {
      const [address] = await probeClient.requestAddresses();
      account = getAddress(address);
    }

    publicClient  = createPublicClient({ chain: mainnet, transport: custom(provider) });
    readClient    = createPublicClient({ chain: mainnet, transport: http(RECEIPT_RPC_URL) });
    walletClient  = createWalletClient({
      account,
      chain: mainnet,
      transport: custom(provider),
    });
    receiptClient = createPublicClient({ chain: mainnet, transport: http(RECEIPT_RPC_URL) });
    await ensureMainnet();

    els.connect.textContent = shortAddress(account);
    els.network.textContent = "Ethereum Mainnet";

    setMessage("Loading burn catalog…", "info");
    await Promise.allSettled([
      loadBurnProgram(),
      loadAssignments(),
    ]);
    await loadTokens({ refreshMap: force });
  } catch (err) {
    console.error(err);
    setMessage(err.shortMessage || err.message || "Connection failed.", "error");
  }
}

// ── Evolve ────────────────────────────────────────────────────────────────────

async function refreshApprovalStatus() {
  if (!account || !(readClient || publicClient)) return false;
  try {
    isApproved = await (readClient || publicClient).readContract({
      address: STAGE1_ADDRESS,
      abi:     STAGE1_ABI,
      functionName: "isApprovedForAll",
      args:    [account, EVOLVE_ADDRESS],
    });
  } catch (err) {
    console.warn("[approve] status check failed:", err.message);
  }
  return isApproved;
}

async function ensureEvolveApproval() {
  await refreshApprovalStatus();
  if (isApproved) return;

  setMessage("Step 1/2 — Confirm APPROVE in your wallet…", "pending");
  const approveHash = await walletClient.writeContract({
    account,
    chain: mainnet,
    address: getAddress(STAGE1_ADDRESS),
    abi:     STAGE1_ABI,
    functionName: "setApprovalForAll",
    args:    [getAddress(EVOLVE_ADDRESS), true],
  });
  setMessage("Approval sent. Waiting for confirmation…", "pending");
  await waitForReceipt(approveHash);
  await refreshApprovalStatus();
  if (!isApproved) {
    throw new Error("Approval transaction confirmed but evolve contract is still not approved. Reload and try again.");
  }
  updateStats();
}

async function waitForReceipt(hash) {
  const receipt = await receiptClient.waitForTransactionReceipt({
    hash,
    pollingInterval: 2_000,
    timeout:         90_000,
  });
  if (receipt.status === "reverted") {
    throw new Error("Transaction reverted on-chain. Open Etherscan for the revert reason.");
  }
  return receipt;
}

function formatEvolveRevert(err) {
  const msg = err?.shortMessage || err?.message || String(err);
  if (/cannot evolve \(1-of-1\)/i.test(msg)) {
    return `${keepToken.character} is blocked on-chain (characterPath=0). ` +
      `Owner must call setCharacterPaths for charId ${keepToken.charId} — see calldata-character-paths-burnable.json.`;
  }
  if (/already evolved/i.test(msg)) {
    return "One of these tokens is already evolved on-chain. Reload the page to refresh wallet state.";
  }
  if (/character mismatch/i.test(msg)) {
    return "Character mismatch on-chain — reload the page and re-select two tokens of the same character.";
  }
  if (/approve this contract/i.test(msg)) {
    return null;
  }
  return msg;
}

function isApprovalSimError(err) {
  const msg = err?.shortMessage || err?.message || String(err);
  return /approve this contract/i.test(msg);
}

async function preflightEvolve() {
  const funcName = keepToken.stage === 0 ? "evolveFromStage1" : "evolveFromStage2";
  const client = readClient || publicClient;

  if (keepToken.stage === 0) {
    await loadCharacterPaths([keepToken.charId, burnToken.charId]);
    if (charPathBlocked(keepToken.charId)) {
      return `${keepToken.character} cannot evolve — on-chain path is ${charPathLabel(keepToken.charId)}. ` +
        `Owner must run setCharacterPaths (charId ${keepToken.charId}) in Remix.`;
    }
  }

  if (!isApproved) return null;

  try {
    await client.simulateContract({
      account,
      address: getAddress(EVOLVE_ADDRESS),
      abi:     EVOLVE_ABI,
      functionName: funcName,
      args:    [BigInt(keepToken.tokenId), BigInt(burnToken.tokenId)],
    });
  } catch (err) {
    if (isApprovalSimError(err)) return null;
    return formatEvolveRevert(err);
  }
  return null;
}

async function evolveTokens() {
  const err = validateSelection();
  if (err) { setMessage(err, "error"); return; }

  els.evolve.disabled = true;

  try {
    await ensureEvolveApproval();

    const preflightErr = await preflightEvolve();
    if (preflightErr) {
      setMessage(preflightErr, "error");
      els.evolve.disabled = false;
      updateEvolveButton();
      return;
    }

    const funcName = keepToken.stage === 0 ? "evolveFromStage1" : "evolveFromStage2";

    setMessage("Confirm EVOLVE in your wallet…", "pending");
    const hash = await walletClient.writeContract({
      account,
      chain: mainnet,
      address: getAddress(EVOLVE_ADDRESS),
      abi:     EVOLVE_ABI,
      functionName: funcName,
      args:    [BigInt(keepToken.tokenId), BigInt(burnToken.tokenId)],
    });
    setMessage(`Evolve tx sent. Waiting for confirmation…`, "pending");

    try {
      await waitForReceipt(hash);
    } catch (receiptErr) {
      setMessage(receiptErr.message || "Transaction failed on-chain.", "error");
      els.evolve.disabled = false;
      updateEvolveButton();
      return;
    }

    const keepId   = keepToken.tokenId;
    const burnId   = burnToken.tokenId;
    const charName = keepToken.character;
    const newStage = Number(await (readClient || publicClient).readContract({
      address: EVOLVE_ADDRESS,
      abi:     EVOLVE_ABI,
      functionName: "evolvedStage",
      args:    [BigInt(keepId)],
    }));
    const stageLabel = newStage === 3 ? "Stage 3" : "Stage 2";

    applyEvolveResult(keepId, burnId, newStage);
    patchOwnerInCache(burnId, null);
    if (account) patchOwnerInCache(keepId, account.toLowerCase());
    setMessage(`Evolved! #${keepId} → ${stageLabel}. Updating metadata…`, "success");

    const updated = await syncMetadataToServer(keepId, burnId, { retries: 5, minStage: newStage });
    if (updated.ok) {
      if (burnId) delete TOKEN_ASSIGNMENTS[String(burnId)];
      applyEvolveResult(keepId, burnId, newStage);
      patchOwnerInCache(burnId, null);
      setMessage(
        `Done! #${keepId} → ${stageLabel} (${updated.data?.variant || "?"}). Refresh OpenSea in a few minutes.`,
        "success"
      );
      void loadTokens({ refreshMap: true });
    } else {
      setMessage(`Evolved on-chain! Metadata sync failed: ${formatSyncError(updated.error)}`, "error");
      showMetadataDownload(keepId, charName, newStage);
      void triggerServerReconcile(keepId, burnId);
      scheduleMetadataRetry(keepId, burnId);
    }

    els.evolve.disabled = false;
    updateEvolveButton();
  } catch (err) {
    console.error("[evolve]", err);
    setMessage(formatEvolveRevert(err), "error");
    els.evolve.disabled = false;
    updateEvolveButton();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function initBurnDapp() {
  console.log("[burn] initBurnDapp called, root:", els.root, "EVOLVE_ADDRESS:", EVOLVE_ADDRESS);
  if (!els.root) return;

  if (!WALLET_DAPP_ENABLED) {
    els.root.classList.add("is-preview");
    if (els.connect) els.connect.disabled = true;
    if (els.evolve) els.evolve.disabled = true;
    if (els.sync) els.sync.disabled = true;
    return;
  }

  if (!EVOLVE_ADDRESS) {
    setMessage("Deploy EvolvePixelTrip v2 via Remix and update EVOLVE_ADDRESS in config.js", "error");
    if (els.connect) els.connect.disabled = true;
    return;
  }
  els.connect.addEventListener("click", () => {
    invalidateOwnerMapCache();
    void connectWallet({ force: true });
  });
  els.evolve.addEventListener("click", evolveTokens);
  els.sync?.addEventListener("click", syncAllEvolvedTokens);
  gridFilters = mountTokenGridFilters(els.filters, { onChange: renderGrid });
  if (els.stats) els.stats.textContent = `build ${LAB_BUILD}`;
  void loadBurnProgram();
  void connectWallet({ silent: true });
}

initBurnDapp();
