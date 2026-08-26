import { parseAbiItem } from "viem";
import { lookupOwnedFromMap, loadTokenOwners } from "./token-owners.js";

export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 4;
const MULTICALL_TIMEOUT_MS = 12_000;
const OWNER_VERIFY_CHUNK = 96;
const OWNER_VERIFY_TIMEOUT_MS = 45_000;
const SCAN_HARD_TIMEOUT_MS = 180_000;
const WALLET_API_TIMEOUT_MS = 45_000;
const LOG_CHUNK_BLOCKS = 10_000n;
/** PIXEL TRIP deploy block — full Transfer history starts here. */
const COLLECTION_DEPLOY_BLOCK = 25_613_313n;

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

async function verifyOwnersOnChain(client, owner, tokenIds, collectionAddress, collectionAbi, onProgress) {
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
    onProgress?.({ phase: "verify-retry", done: owned.length, total: tokenIds.length });
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

async function fetchWalletTokensFromApi(owner, { timeoutMs = WALLET_API_TIMEOUT_MS } = {}) {
  const url = `/api/wallet-tokens?address=${encodeURIComponent(owner)}&recent=0`;
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
  };
}

/** Full Transfer history via RPC (chunked getLogs — reliable, no Netlify timeout). */
async function discoverViaClientLogsFull(client, owner, collectionAddress, onProgress) {
  if (!client?.getLogs) return [];

  const latest = await withTimeout(client.getBlockNumber(), 12_000, "getBlockNumber");
  const fromBlock = COLLECTION_DEPLOY_BLOCK;
  const ids = new Set();
  const totalChunks = Math.max(1, Math.ceil(Number(latest - fromBlock + 1n) / Number(LOG_CHUNK_BLOCKS)));
  let done = 0;

  for (let start = fromBlock; start <= latest; start += LOG_CHUNK_BLOCKS) {
    const end = start + LOG_CHUNK_BLOCKS - 1n > latest ? latest : start + LOG_CHUNK_BLOCKS - 1n;
    try {
      const [toLogs, fromLogs] = await withTimeout(
        Promise.all([
          client.getLogs({
            address: collectionAddress,
            event: TRANSFER_EVENT,
            args: { to: owner },
            fromBlock: start,
            toBlock: end,
          }),
          client.getLogs({
            address: collectionAddress,
            event: TRANSFER_EVENT,
            args: { from: owner },
            fromBlock: start,
            toBlock: end,
          }),
        ]),
        20_000,
        "getLogs chunk",
      );
      for (const log of [...toLogs, ...fromLogs]) {
        if (log.args?.tokenId != null) ids.add(Number(log.args.tokenId));
      }
    } catch (err) {
      console.warn(`[scan] logs chunk ${start}-${end}:`, err.message);
    }
    done += 1;
    onProgress?.({ phase: "logs", done, total: totalChunks, candidates: ids.size });
  }

  return [...ids];
}

async function mergeMapFallback(
  client,
  owner,
  maxId,
  collectionAddress,
  collectionAbi,
  tokenIds,
  refreshMap,
  onProgress,
) {
  try {
    if (refreshMap) await loadTokenOwners(true);
    const mapCandidates = await lookupOwnedFromMap(owner);
    const known = new Set(tokenIds);
    const novel = mapCandidates.filter((id) => !known.has(id) && id <= maxId);
    if (!novel.length) return tokenIds;
    onProgress?.({ phase: "map", count: novel.length });
    const extra = await verifyOwnersOnChain(
      client, owner, novel, collectionAddress, collectionAbi, onProgress,
    );
    return filterMax(mergeUniqueIds(tokenIds, extra), maxId);
  } catch (err) {
    console.warn("[scan] map fallback:", err.message);
    return tokenIds;
  }
}

function mergeApiTokens(tokenIds, apiIds, maxId) {
  if (!apiIds?.length) return tokenIds;
  return filterMax(mergeUniqueIds(tokenIds, apiIds), maxId);
}

async function scanOwnedTokenIdsInner(
  client,
  {
    owner,
    maxId,
    collectionAddress,
    collectionAbi,
    refreshMap = false,
    onSupplement = null,
    logClient = null,
    onProgress = null,
  },
) {
  const balanceRaw = await readWalletBalance(client, owner, collectionAddress, collectionAbi);
  const target = balanceRaw != null ? Number(balanceRaw) : null;
  if (target === 0) return { tokenIds: [], balance: 0 };

  onProgress?.({ phase: "start", target });

  const logsClient = client?.getLogs ? client : logClient;
  const apiPromise = fetchWalletTokensFromApi(owner).catch((err) => {
    console.warn("[scan] wallet API:", err.message);
    return null;
  });

  let tokenIds = [];

  // Primary: full client-side Transfer logs (mevblocker / wallet RPC).
  if (logsClient) {
    const candidates = await discoverViaClientLogsFull(
      logsClient, owner, collectionAddress, onProgress,
    );
    onProgress?.({ phase: "verify", done: 0, total: candidates.length });
    tokenIds = filterMax(
      await verifyOwnersOnChain(
        client, owner, candidates, collectionAddress, collectionAbi, onProgress,
      ),
      maxId,
    );
    console.log(`[scan] client logs verified ${tokenIds.length}/${target ?? "?"}`);
    if (target != null && tokenIds.length >= target) {
      return { tokenIds, balance: target };
    }
  }

  // Merge Netlify API (when it returns extra IDs the log scan missed).
  const api = await apiPromise;
  if (api?.tokenIds?.length) {
    tokenIds = mergeApiTokens(tokenIds, api.tokenIds, maxId);
    console.log(`[scan] after API merge ${tokenIds.length}/${target ?? "?"}`);
    if (target != null && tokenIds.length >= target) {
      return { tokenIds, balance: target };
    }
  }

  // Owner map fallback.
  tokenIds = await mergeMapFallback(
    client, owner, maxId, collectionAddress, collectionAbi, tokenIds, refreshMap, onProgress,
  );
  if (target != null && tokenIds.length >= target) {
    return { tokenIds, balance: target };
  }

  const partial = target != null && tokenIds.length < target;
  if (partial) {
    console.warn(`[scan] incomplete ${tokenIds.length}/${target}`);
    if (onSupplement) {
      void (async () => {
        await sleep(3000);
        try {
          const apiRetry = await fetchWalletTokensFromApi(owner, { timeoutMs: 60_000 });
          const full = mergeApiTokens(tokenIds, apiRetry.tokenIds, maxId);
          if (full.length > tokenIds.length) onSupplement(full);
        } catch (err) {
          console.warn("[scan] background API retry:", err.message);
        }
      })();
    }
  }

  return { tokenIds, balance: target, partial };
}

/**
 * Wallet scan — full Transfer-log lookup in browser via RPC, then API/map fallbacks.
 */
export async function scanOwnedTokenIds(
  client,
  {
    owner,
    maxId,
    collectionAddress,
    collectionAbi,
    forceRefresh = false,
    onSupplement = null,
    logClient = null,
    onProgress = null,
  },
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
        onProgress,
      }),
      SCAN_HARD_TIMEOUT_MS,
      "wallet scan",
    );
  } catch (err) {
    console.warn("[scan] hard timeout:", err.message);
    let fallback = [];
    try {
      const logsClient = client?.getLogs ? client : logClient;
      if (logsClient) {
        const candidates = await discoverViaClientLogsFull(logsClient, owner, collectionAddress, null);
        fallback = filterMax(
          await verifyOwnersOnChain(client, owner, candidates, collectionAddress, collectionAbi, null),
          maxId,
        );
      }
    } catch {
      fallback = [];
    }
    return { tokenIds: fallback, balance: null, timedOut: true, partial: true };
  }
}
