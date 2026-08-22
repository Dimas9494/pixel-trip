import { lookupOwnedFromMap, loadTokenOwners } from "./token-owners.js";

export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 4;
const MULTICALL_TIMEOUT_MS = 12_000;
const SCAN_HARD_TIMEOUT_MS = 12_000;
const WALLET_API_TIMEOUT_MS = 6_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms);
    }),
  ]);
}

export async function multicallChunked(
  client,
  contracts,
  { chunk = MULTICALL_CHUNK, parallel = MULTICALL_PARALLEL } = {},
) {
  if (!contracts.length) return [];

  const slices = [];
  for (let i = 0; i < contracts.length; i += chunk) {
    slices.push(contracts.slice(i, i + chunk));
  }

  const out = [];
  for (let b = 0; b < slices.length; b += parallel) {
    const batch = slices.slice(b, b + parallel);
    try {
      const results = await withTimeout(
        Promise.all(
          batch.map((contractsChunk) =>
            client.multicall({ contracts: contractsChunk, allowFailure: true }),
          ),
        ),
        MULTICALL_TIMEOUT_MS,
        "multicall batch",
      );
      for (const res of results) out.push(...res);
    } catch (err) {
      console.warn("[multicall] batch failed:", err.message);
      break;
    }
  }
  return out;
}

async function readWalletBalance(client, owner, collectionAddress, collectionAbi) {
  try {
    return await withTimeout(
      client.readContract({
        address: collectionAddress,
        abi: collectionAbi,
        functionName: "balanceOf",
        args: [owner],
      }),
      5_000,
      "balanceOf",
    );
  } catch (err) {
    console.warn("[scan] balanceOf failed:", err.message);
    return null;
  }
}

async function verifyOwnersOnChain(client, owner, tokenIds, collectionAddress, collectionAbi) {
  if (!tokenIds.length) return [];

  const contracts = tokenIds.map((id) => ({
    address: collectionAddress,
    abi: collectionAbi,
    functionName: "ownerOf",
    args: [BigInt(id)],
  }));

  const results = await multicallChunked(client, contracts);
  const addr = owner.toLowerCase();
  const owned = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r?.status === "success" && r.result?.toLowerCase() === addr) {
      owned.push(tokenIds[i]);
    }
  }

  owned.sort((a, b) => a - b);
  return owned;
}

function filterMax(verified, maxId) {
  return verified.filter((id) => id >= 1 && id <= maxId);
}

function mergeUniqueIds(...lists) {
  return [...new Set(lists.flat())].sort((a, b) => a - b);
}

async function discoverViaWalletApi(owner, { recentOnly = true, timeoutMs = WALLET_API_TIMEOUT_MS } = {}) {
  try {
    const url =
      `/api/wallet-tokens?address=${encodeURIComponent(owner)}&recent=${recentOnly ? "1" : "0"}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const data = await res.json();
    const ids = data?.tokenIds;
    return Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch (err) {
    console.warn("[scan] wallet API:", err.message);
    return [];
  }
}

async function supplementViaWalletApi(
  client,
  owner,
  collectionAddress,
  collectionAbi,
  verified,
  { recentOnly = true, timeoutMs = WALLET_API_TIMEOUT_MS } = {},
) {
  const apiIds = await discoverViaWalletApi(owner, { recentOnly, timeoutMs });
  if (!apiIds.length) return verified;

  const merged = mergeUniqueIds(verified, apiIds);
  return verifyOwnersOnChain(client, owner, merged, collectionAddress, collectionAbi);
}

async function scanOwnedTokenIdsInner(
  client,
  { owner, maxId, collectionAddress, collectionAbi, refreshMap = false, onSupplement = null },
) {
  const balance = await readWalletBalance(client, owner, collectionAddress, collectionAbi);
  if (balance === 0n) return { tokenIds: [], balance: 0 };

  const target = balance != null ? Number(balance) : null;

  let candidates = [];
  try {
    if (refreshMap) await loadTokenOwners(true);
    candidates = await lookupOwnedFromMap(owner);
  } catch (err) {
    console.warn("[scan] owner map:", err.message);
  }

  let verified = await verifyOwnersOnChain(
    client,
    owner,
    candidates,
    collectionAddress,
    collectionAbi,
  );

  if (target != null && verified.length >= target) {
    console.log(`[scan] map verified ${verified.length} token(s)`);
    return { tokenIds: filterMax(verified, maxId), balance: target };
  }
  if (target == null && verified.length > 0) {
    return { tokenIds: filterMax(verified, maxId), balance: target };
  }

  const partial = filterMax(verified, maxId);

  if (partial.length > 0) {
    console.log(`[scan] map ${partial.length}/${target ?? "?"} — showing now, API in background`);
    void supplementViaWalletApi(
      client, owner, collectionAddress, collectionAbi, verified,
      { recentOnly: true, timeoutMs: WALLET_API_TIMEOUT_MS },
    ).then((extra) => {
      const full = filterMax(extra, maxId);
      if (full.length > partial.length && onSupplement) onSupplement(full);
    });
    return { tokenIds: partial, balance: target, partial: true };
  }

  console.log(`[scan] map miss — wallet API (${WALLET_API_TIMEOUT_MS}ms)`);
  verified = await supplementViaWalletApi(
    client, owner, collectionAddress, collectionAbi, verified,
    { recentOnly: true, timeoutMs: WALLET_API_TIMEOUT_MS },
  );
  return { tokenIds: filterMax(verified, maxId), balance: target };
}

/**
 * Fast wallet scan — owner index + optional wallet API. Hard 12s cap.
 */
export async function scanOwnedTokenIds(
  client,
  { owner, maxId, collectionAddress, collectionAbi, forceRefresh = false, onSupplement = null },
) {
  try {
    return await withTimeout(
      scanOwnedTokenIdsInner(client, {
        owner,
        maxId,
        collectionAddress,
        collectionAbi,
        refreshMap: forceRefresh,
        onSupplement,
      }),
      SCAN_HARD_TIMEOUT_MS,
      "wallet scan",
    );
  } catch (err) {
    console.warn("[scan] hard timeout:", err.message);
    let fallback = [];
    try {
      fallback = filterMax(await lookupOwnedFromMap(owner), maxId);
    } catch {
      fallback = [];
    }
    return { tokenIds: fallback, balance: null, timedOut: true };
  }
}
