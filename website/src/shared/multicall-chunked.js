import { parseAbiItem } from "viem";
import { lookupOwnedFromMap, loadTokenOwners } from "./token-owners.js";

export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 4;
const MULTICALL_TIMEOUT_MS = 12_000;
const OWNER_VERIFY_CHUNK = 96;
const OWNER_VERIFY_TIMEOUT_MS = 30_000;
const SCAN_HARD_TIMEOUT_MS = 120_000;
const WALLET_API_FULL_TIMEOUT_MS = 90_000;
const CLIENT_LOG_BLOCK_RANGE = 10_000n;
const WALLET_API_ATTEMPTS = 3;

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms);
    }),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameIdSet(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export async function multicallChunked(
  client,
  contracts,
  {
    chunk = MULTICALL_CHUNK,
    parallel = MULTICALL_PARALLEL,
    timeoutMs = MULTICALL_TIMEOUT_MS,
    stopOnFailure = true,
  } = {},
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
        timeoutMs,
        "multicall batch",
      );
      for (const res of results) out.push(...res);
    } catch (err) {
      console.warn("[multicall] batch failed:", err.message);
      if (stopOnFailure) break;
    }
  }
  return out;
}

function collectOwnedTokenIds(tokenIds, results, ownerLower) {
  const owned = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r?.status === "success" && r.result?.toLowerCase() === ownerLower) {
      owned.push(tokenIds[i]);
    }
  }
  return owned;
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
      8_000,
      "balanceOf",
    );
  } catch (err) {
    console.warn("[scan] balanceOf failed:", err.message);
    return null;
  }
}

async function verifyOwnersOnChain(client, owner, tokenIds, collectionAddress, collectionAbi) {
  if (!tokenIds.length) return [];

  const addr = owner.toLowerCase();
  const contracts = tokenIds.map((id) => ({
    address: collectionAddress,
    abi: collectionAbi,
    functionName: "ownerOf",
    args: [BigInt(id)],
  }));

  let results = await multicallChunked(client, contracts, {
    chunk: OWNER_VERIFY_CHUNK,
    parallel: 2,
    timeoutMs: OWNER_VERIFY_TIMEOUT_MS,
    stopOnFailure: false,
  });

  let owned = collectOwnedTokenIds(tokenIds, results, addr);
  const ownedSet = new Set(owned);

  const retryIds = tokenIds.filter((id, i) => {
    if (ownedSet.has(id)) return false;
    const r = results[i];
    return !r || r.status !== "success";
  });

  if (retryIds.length) {
    console.log(`[scan] retry ownerOf for ${retryIds.length} token(s)`);
    for (let i = 0; i < retryIds.length; i += 8) {
      const batch = retryIds.slice(i, i + 8);
      for (const id of batch) {
        try {
          const result = await withTimeout(
            client.readContract({
              address: collectionAddress,
              abi: collectionAbi,
              functionName: "ownerOf",
              args: [BigInt(id)],
            }),
            8_000,
            `ownerOf(${id})`,
          );
          if (result?.toLowerCase() === addr) {
            owned = mergeUniqueIds(owned, [id]);
          }
        } catch (err) {
          console.warn(`[scan] ownerOf #${id}:`, err.message);
        }
      }
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

/** Full wallet scan via Netlify function (Transfer logs + server-side ownerOf verify). */
async function fetchWalletTokensFromApi(owner, { recentOnly = false, timeoutMs = WALLET_API_FULL_TIMEOUT_MS } = {}) {
  const url =
    `/api/wallet-tokens?address=${encodeURIComponent(owner)}&recent=${recentOnly ? "1" : "0"}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `wallet API HTTP ${res.status}`);
  }
  const data = await res.json();
  const tokenIds = Array.isArray(data?.tokenIds)
    ? data.tokenIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  return {
    tokenIds,
    balance: typeof data.balance === "number" ? data.balance : null,
    count: typeof data.count === "number" ? data.count : tokenIds.length,
    source: data.source || "api",
  };
}

/** Transfer logs via the connected wallet RPC (fallback when Netlify API fails). */
async function discoverViaClientLogs(client, owner, collectionAddress, { maxBlocks = CLIENT_LOG_BLOCK_RANGE } = {}) {
  if (!client?.getLogs) return [];
  try {
    const latest = await withTimeout(client.getBlockNumber(), 8_000, "getBlockNumber");
    const fromBlock = latest > maxBlocks ? latest - maxBlocks : 0n;

    const [toLogs, fromLogs] = await withTimeout(
      Promise.all([
        client.getLogs({
          address: collectionAddress,
          event: TRANSFER_EVENT,
          args: { to: owner },
          fromBlock,
          toBlock: latest,
        }),
        client.getLogs({
          address: collectionAddress,
          event: TRANSFER_EVENT,
          args: { from: owner },
          fromBlock,
          toBlock: latest,
        }),
      ]),
      15_000,
      "client getLogs",
    );

    const ids = new Set();
    for (const log of [...toLogs, ...fromLogs]) {
      if (log.args?.tokenId != null) ids.add(Number(log.args.tokenId));
    }
    return [...ids];
  } catch (err) {
    console.warn("[scan] client logs:", err.message);
    return [];
  }
}

async function mergeMapFallback(
  client,
  owner,
  maxId,
  collectionAddress,
  collectionAbi,
  tokenIds,
  refreshMap,
) {
  try {
    if (refreshMap) await loadTokenOwners(true);
    const mapCandidates = await lookupOwnedFromMap(owner);
    const known = new Set(tokenIds);
    const novel = mapCandidates.filter((id) => !known.has(id) && id <= maxId);
    if (!novel.length) return tokenIds;
    const extra = await verifyOwnersOnChain(client, owner, novel, collectionAddress, collectionAbi);
    return filterMax(mergeUniqueIds(tokenIds, extra), maxId);
  } catch (err) {
    console.warn("[scan] map fallback:", err.message);
    return tokenIds;
  }
}

function scheduleBackgroundCatchUp(
  client,
  owner,
  collectionAddress,
  collectionAbi,
  currentIds,
  maxId,
  targetBalance,
  onSupplement,
) {
  if (!onSupplement) return;
  if (targetBalance != null && currentIds.length >= targetBalance) return;

  void (async () => {
    let best = currentIds;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const api = await fetchWalletTokensFromApi(owner, { recentOnly: false });
        const full = filterMax(api.tokenIds, maxId);
        if (full.length > best.length) best = full;
        if (targetBalance != null && best.length >= targetBalance) break;
      } catch (err) {
        console.warn("[scan] background catch-up:", err.message);
      }
      if (attempt === 0) await sleep(2000);
    }
    if (best.length > currentIds.length) {
      onSupplement(best);
    }
  })();
}

async function scanOwnedTokenIdsInner(
  client,
  { owner, maxId, collectionAddress, collectionAbi, refreshMap = false, onSupplement = null, logClient = null },
) {
  const balanceRaw = await readWalletBalance(client, owner, collectionAddress, collectionAbi);
  const target = balanceRaw != null ? Number(balanceRaw) : null;
  if (target === 0) return { tokenIds: [], balance: 0 };

  let tokenIds = [];

  // Primary path: full wallet API — blocks until balanceOf match or retries exhausted.
  for (let attempt = 0; attempt < WALLET_API_ATTEMPTS; attempt++) {
    try {
      const api = await fetchWalletTokensFromApi(owner, { recentOnly: false });
      tokenIds = filterMax(api.tokenIds, maxId);
      const goal = target ?? api.balance ?? tokenIds.length;
      console.log(`[scan] wallet API ${tokenIds.length}/${goal} (attempt ${attempt + 1}, ${api.source})`);
      if (target != null && tokenIds.length >= target) {
        return { tokenIds, balance: target };
      }
      if (target == null && tokenIds.length > 0) {
        return { tokenIds, balance: tokenIds.length };
      }
    } catch (err) {
      console.warn(`[scan] wallet API attempt ${attempt + 1}:`, err.message);
    }
    if (attempt < WALLET_API_ATTEMPTS - 1) await sleep(2000);
  }

  // Fallback: owner map (only adds tokens missing from API result).
  tokenIds = await mergeMapFallback(
    client, owner, maxId, collectionAddress, collectionAbi, tokenIds, refreshMap,
  );
  if (target != null && tokenIds.length >= target) {
    console.log(`[scan] map fallback complete ${tokenIds.length}/${target}`);
    return { tokenIds, balance: target };
  }

  // Fallback: wallet RPC Transfer logs (recent window).
  if (target != null && tokenIds.length < target) {
    const logIds = await discoverViaClientLogs(logClient || client, owner, collectionAddress);
    const known = new Set(tokenIds);
    const novel = logIds.filter((id) => !known.has(id) && id <= maxId);
    if (novel.length) {
      const extra = await verifyOwnersOnChain(client, owner, novel, collectionAddress, collectionAbi);
      tokenIds = filterMax(mergeUniqueIds(tokenIds, extra), maxId);
    }
  }

  const partial = target != null && tokenIds.length < target;
  if (partial) {
    console.warn(`[scan] incomplete ${tokenIds.length}/${target}`);
    scheduleBackgroundCatchUp(
      client, owner, collectionAddress, collectionAbi, tokenIds, maxId, target, onSupplement,
    );
  }

  return { tokenIds, balance: target, partial };
}

/**
 * Wallet scan — full Transfer-log lookup via Netlify API, then map/RPC fallbacks.
 * Waits for complete scan before returning when balanceOf is known.
 */
export async function scanOwnedTokenIds(
  client,
  { owner, maxId, collectionAddress, collectionAbi, forceRefresh = false, onSupplement = null, logClient = null },
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
        logClient,
      }),
      SCAN_HARD_TIMEOUT_MS,
      "wallet scan",
    );
  } catch (err) {
    console.warn("[scan] hard timeout:", err.message);
    let fallback = [];
    try {
      const api = await fetchWalletTokensFromApi(owner, { recentOnly: false, timeoutMs: 45_000 });
      fallback = filterMax(api.tokenIds, maxId);
    } catch {
      try {
        fallback = filterMax(
          await mergeMapFallback(client, owner, maxId, collectionAddress, collectionAbi, [], forceRefresh),
          maxId,
        );
      } catch {
        fallback = [];
      }
    }
    scheduleBackgroundCatchUp(
      client, owner, collectionAddress, collectionAbi, fallback, maxId, null, onSupplement,
    );
    return { tokenIds: fallback, balance: null, timedOut: true, partial: true };
  }
}
