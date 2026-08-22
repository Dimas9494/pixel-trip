import { fetchWithTimeout } from "./fetch-timeout.js";

const OWNER_MAP_URL = "/data/token-owners.json";
const OWNER_MAP_TTL_MS = 5 * 60 * 1000;

/** @type {{ owners: Record<string, string>, loadedAt: number } | null} */
let cache = null;
/** @type {Map<string, number[]> | null} */
let walletIndex = null;
let loadPromise = null;

function buildWalletIndex(owners) {
  const index = new Map();
  for (const [id, owner] of Object.entries(owners)) {
    const addr = owner.toLowerCase();
    if (!index.has(addr)) index.set(addr, []);
    index.get(addr).push(Number(id));
  }
  for (const ids of index.values()) ids.sort((a, b) => a - b);
  return index;
}

export async function loadTokenOwners(force = false) {
  if (!force && cache && Date.now() - cache.loadedAt < OWNER_MAP_TTL_MS) {
    return cache.owners;
  }
  if (loadPromise && !force) return loadPromise;

  loadPromise = (async () => {
    const res = await fetchWithTimeout(`${OWNER_MAP_URL}?t=${Date.now()}`, { cache: "no-store" }, 5_000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const owners = data?.owners;
    if (!owners || typeof owners !== "object") throw new Error("Invalid owner map");
    cache = { owners, loadedAt: Date.now() };
    walletIndex = buildWalletIndex(owners);
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
  await loadTokenOwners();
  return walletIndex?.get(wallet.toLowerCase()) ?? [];
}

export function invalidateOwnerMapCache() {
  cache = null;
  walletIndex = null;
}

/** Drop stale map entry after burn / transfer. */
export function patchOwnerInCache(tokenId, owner) {
  if (!cache?.owners) return;
  const key = String(tokenId);
  const prev = cache.owners[key]?.toLowerCase();
  if (owner) cache.owners[key] = owner.toLowerCase();
  else delete cache.owners[key];

  if (walletIndex) {
    if (prev) {
      const list = walletIndex.get(prev);
      if (list) {
        const next = list.filter((id) => id !== Number(tokenId));
        if (next.length) walletIndex.set(prev, next);
        else walletIndex.delete(prev);
      }
    }
    if (owner) {
      const addr = owner.toLowerCase();
      const list = walletIndex.get(addr) ?? [];
      if (!list.includes(Number(tokenId))) {
        list.push(Number(tokenId));
        list.sort((a, b) => a - b);
        walletIndex.set(addr, list);
      }
    }
  }
}
