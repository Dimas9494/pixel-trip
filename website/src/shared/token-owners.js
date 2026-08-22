import { fetchWithTimeout } from "./fetch-timeout.js";

const OWNER_MAP_URL = "/data/token-owners.json";
const OWNER_MAP_TTL_MS = 5 * 60 * 1000;

/** @type {{ owners: Record<string, string>, loadedAt: number } | null} */
let cache = null;
let loadPromise = null;

export async function loadTokenOwners(force = false) {
  if (!force && cache && Date.now() - cache.loadedAt < OWNER_MAP_TTL_MS) {
    return cache.owners;
  }
  if (loadPromise && !force) return loadPromise;

  loadPromise = (async () => {
    const res = await fetchWithTimeout(`${OWNER_MAP_URL}?t=${Date.now()}`, { cache: "no-store" }, 8_000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const owners = data?.owners;
    if (!owners || typeof owners !== "object") throw new Error("Invalid owner map");
    cache = { owners, loadedAt: Date.now() };
    console.log(`[owners] loaded ${Object.keys(owners).length} tokens (updated ${data.updatedAt || "?"})`);
    return owners;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

/** Instant wallet lookup from pre-built owner map. */
export async function lookupOwnedFromMap(wallet) {
  const owners = await loadTokenOwners();
  const addr = wallet.toLowerCase();
  const ids = [];
  for (const [id, owner] of Object.entries(owners)) {
    if (owner === addr) ids.push(Number(id));
  }
  ids.sort((a, b) => a - b);
  return ids;
}

export function invalidateOwnerMapCache() {
  cache = null;
}

/** Drop stale map entry after burn / transfer. */
export function patchOwnerInCache(tokenId, owner) {
  if (!cache?.owners) return;
  const key = String(tokenId);
  if (owner) cache.owners[key] = owner.toLowerCase();
  else delete cache.owners[key];
}
