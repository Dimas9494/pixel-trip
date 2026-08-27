import { parseAbiItem } from "viem";
import { lookupOwnedFromMap, loadTokenOwners } from "./token-owners.js";

export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 4;
const MULTICALL_TIMEOUT_MS = 12_000;
const OWNER_VERIFY_CHUNK = 64;
const OWNER_VERIFY_TIMEOUT_MS = 60_000;
const SCAN_HARD_TIMEOUT_MS = 120_000;
const WALLET_API_TIMEOUT_MS = 45_000;
const WALLET_API_RECENT_TIMEOUT_MS = 12_000;
const LOG_CHUNK_BLOCKS = 10_000n;
const LOG_CHUNK_RETRIES = 3;
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

async function readOwnerOf(client, collectionAddress, collectionAbi, tokenId, ownerLower) {
  try {
    const result = await withTimeout(
      client.readContract({
        address: collectionAddress,
        abi: collectionAbi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      }),
      10_000,
      `ownerOf(${tokenId})`,
    );
    return result?.toLowerCase() === ownerLower ? tokenId : null;
  } catch {
    return null;
  }
}

async function verifyOwnersOnChain(client, owner, tokenIds, collectionAddress, collectionAbi, onProgress) {
  if (!tokenIds.length) return [];

  const addr = owner.toLowerCase();
  const unique = [...new Set(tokenIds)].sort((a, b) => a - b);
  const contracts = unique.map((id) => ({
    address: collectionAddress,
    abi: collectionAbi,
    functionName: "ownerOf",
    args: [BigInt(id)],
  }));

  let results = await multicallChunked(client, contracts, {
    chunk: OWNER_VERIFY_CHUNK,
    parallel: 3,
    timeoutMs: OWNER_VERIFY_TIMEOUT_MS,
    stopOnFailure: false,
  });

  let owned = collectOwnedTokenIds(unique, results, addr);
  const ownedSet = new Set(owned);

  const retryIds = unique.filter((id, i) => {
    if (ownedSet.has(id)) return false;
    const r = results[i];
    return !r || r.status !== "success";
  });

  if (retryIds.length) {
    console.log(`[scan] retry ownerOf for ${retryIds.length} token(s)`);
    onProgress?.({ phase: "verify-retry", done: owned.length, total: unique.length });
    for (let i = 0; i < retryIds.length; i += 16) {
      const batch = retryIds.slice(i, i + 16);
      const found = await Promise.all(
        batch.map((id) => readOwnerOf(client, collectionAddress, collectionAbi, id, addr)),
      );
      for (const id of found) {
        if (id != null) ownedSet.add(id);
      }
    }
    owned = [...ownedSet].sort((a, b) => a - b);
  }

  return owned;
}

function filterMax(verified, maxId) {
  return verified.filter((id) => id >= 1 && id <= maxId);
}

function mergeUniqueIds(...lists) {
  return [...new Set(lists.flat())].sort((a, b) => a - b);
}

async function fetchWalletTokensFromApi(
  owner,
  { recent = false, timeoutMs = recent ? WALLET_API_RECENT_TIMEOUT_MS : WALLET_API_TIMEOUT_MS } = {},
) {
  const url = `/api/wallet-tokens?address=${encodeURIComponent(owner)}&recent=${recent ? "1" : "0"}`;
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
    verified: data.verified !== false,
  };
}

async function fetchLogChunk(client, owner, collectionAddress, start, end) {
  const [toLogs, fromLogs] = await Promise.all([
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
  ]);
  const ids = new Set();
  for (const log of [...toLogs, ...fromLogs]) {
    if (log.args?.tokenId != null) ids.add(Number(log.args.tokenId));
  }
  return ids;
}

/** Full Transfer history via RPC with chunk retry. */
async function discoverViaClientLogsFull(client, owner, collectionAddress, onProgress) {
  if (!client?.getLogs) return [];

  const latest = await withTimeout(client.getBlockNumber(), 12_000, "getBlockNumber");
  const fromBlock = COLLECTION_DEPLOY_BLOCK;
  const ids = new Set();
  const ranges = [];

  for (let start = fromBlock; start <= latest; start += LOG_CHUNK_BLOCKS) {
    const end = start + LOG_CHUNK_BLOCKS - 1n > latest ? latest : start + LOG_CHUNK_BLOCKS - 1n;
    ranges.push({ start, end });
  }

  const failed = [];

  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i];
    let ok = false;
    for (let attempt = 0; attempt < LOG_CHUNK_RETRIES && !ok; attempt++) {
      try {
        const chunkIds = await withTimeout(
          fetchLogChunk(client, owner, collectionAddress, start, end),
          25_000,
          "getLogs chunk",
        );
        for (const id of chunkIds) ids.add(id);
        ok = true;
      } catch (err) {
        console.warn(`[scan] logs ${start}-${end} attempt ${attempt + 1}:`, err.message);
        if (attempt < LOG_CHUNK_RETRIES - 1) await sleep(500 * (attempt + 1));
      }
    }
    if (!ok) failed.push({ start, end });
    onProgress?.({ phase: "logs", done: i + 1, total: ranges.length, candidates: ids.size });
  }

  for (const { start, end } of failed) {
    try {
      const chunkIds = await withTimeout(
        fetchLogChunk(client, owner, collectionAddress, start, end),
        30_000,
        "getLogs retry",
      );
      for (const id of chunkIds) ids.add(id);
    } catch (err) {
      console.warn(`[scan] logs retry failed ${start}-${end}:`, err.message);
    }
  }

  return [...ids];
}

async function loadMapCandidates(owner, refreshMap) {
  try {
    if (refreshMap) await loadTokenOwners(true);
    return await lookupOwnedFromMap(owner);
  } catch (err) {
    console.warn("[scan] owner map:", err.message);
    return [];
  }
}

function mergeApiTokens(verified, apiResults, maxId) {
  let out = verified;
  for (const api of apiResults) {
    if (api?.tokenIds?.length) {
      out = filterMax(mergeUniqueIds(out, api.tokenIds), maxId);
    }
  }
  return out;
}

/** Union candidates from owner map, API, and logs (parallel). No browser 4444-scan. */
async function resolveOwnedTokenIds(
  client,
  owner,
  maxId,
  collectionAddress,
  collectionAbi,
  target,
  { refreshMap = false, logsClient = null, onProgress = null } = {},
) {
  onProgress?.({ phase: "start", target });

  const mapCandidates = await loadMapCandidates(owner, refreshMap);
  if (mapCandidates.length) {
    onProgress?.({ phase: "verify", done: 0, total: mapCandidates.length });
    let mapVerified = filterMax(
      await verifyOwnersOnChain(
        client, owner, mapCandidates, collectionAddress, collectionAbi, onProgress,
      ),
      maxId,
    );
    if (target != null && mapVerified.length >= target) {
      console.log(`[scan] owner map fast path → ${mapVerified.length}/${target}`);
      return mapVerified;
    }
  }

  const apiRecentPromise = fetchWalletTokensFromApi(owner, { recent: true }).catch((err) => {
    console.warn("[scan] wallet API recent:", err.message);
    return null;
  });
  const apiFullPromise = fetchWalletTokensFromApi(owner, { recent: false }).catch((err) => {
    console.warn("[scan] wallet API full:", err.message);
    return null;
  });
  const logsPromise = logsClient?.getLogs
    ? discoverViaClientLogsFull(logsClient, owner, collectionAddress, onProgress)
    : Promise.resolve([]);

  const [apiRecent, apiFull, logCandidates] = await Promise.all([
    apiRecentPromise,
    apiFullPromise,
    logsPromise,
  ]);

  const candidateSet = new Set([
    ...logCandidates,
    ...(mapCandidates || []),
    ...(apiRecent?.tokenIds || []),
    ...(apiFull?.tokenIds || []),
  ]);

  onProgress?.({ phase: "verify", done: 0, total: candidateSet.size });
  let verified = filterMax(
    await verifyOwnersOnChain(
      client, owner, [...candidateSet], collectionAddress, collectionAbi, onProgress,
    ),
    maxId,
  );
  verified = mergeApiTokens(verified, [apiRecent, apiFull], maxId);
  console.log(`[scan] parallel sources → ${verified.length}/${target ?? "?"}`);

  if (target != null && verified.length >= target) {
    return verified;
  }

  if (target != null && verified.length < target) {
    console.warn(`[scan] gap fill ${verified.length}/${target}`);
    try {
      const apiRetry = await fetchWalletTokensFromApi(owner, {
        recent: false,
        timeoutMs: WALLET_API_TIMEOUT_MS,
      });
      verified = mergeApiTokens(verified, [apiRetry], maxId);
    } catch (err) {
      console.warn("[scan] API gap fill:", err.message);
    }

    await loadTokenOwners(true);
    const freshMap = await lookupOwnedFromMap(owner);
    const missing = freshMap.filter((id) => !verified.includes(id) && id <= maxId);
    if (missing.length) {
      const extra = await verifyOwnersOnChain(
        client, owner, missing, collectionAddress, collectionAbi, onProgress,
      );
      verified = filterMax(mergeUniqueIds(verified, extra), maxId);
    }
  }

  return verified;
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

  const logsClient = client?.getLogs ? client : logClient;
  const tokenIds = await resolveOwnedTokenIds(
    client,
    owner,
    maxId,
    collectionAddress,
    collectionAbi,
    target,
    { refreshMap, logsClient, onProgress },
  );

  const partial = target != null && tokenIds.length < target;
  if (partial) {
    console.warn(`[scan] incomplete ${tokenIds.length}/${target}`);
    if (onSupplement) {
      void (async () => {
        await sleep(1500);
        await loadTokenOwners(true);
        const mapIds = await lookupOwnedFromMap(owner);
        const api = await fetchWalletTokensFromApi(owner, {
          recent: false,
          timeoutMs: WALLET_API_TIMEOUT_MS,
        }).catch(() => null);
        const merged = filterMax(
          mergeUniqueIds(tokenIds, mapIds, api?.tokenIds || []),
          maxId,
        );
        const novel = merged.filter((id) => !tokenIds.includes(id));
        const extra = novel.length
          ? await verifyOwnersOnChain(
            client, owner, novel, collectionAddress, collectionAbi, null,
          )
          : [];
        const full = filterMax(mergeUniqueIds(tokenIds, extra, api?.tokenIds || []), maxId);
        if (full.length > tokenIds.length) onSupplement(full);
      })();
    }
  }

  console.log(`[scan] final ${tokenIds.length}/${target ?? "?"}`);
  return { tokenIds, balance: target, partial };
}

/**
 * Wallet scan — union of Transfer logs, owner map, and wallet API; verified against balanceOf.
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
      const target = Number(
        await readWalletBalance(client, owner, collectionAddress, collectionAbi),
      );
      fallback = await resolveOwnedTokenIds(
        client, owner, maxId, collectionAddress, collectionAbi, target,
        { refreshMap: true, logsClient: logClient || client, onProgress: null },
      );
    } catch {
      fallback = [];
    }
    return { tokenIds: fallback, balance: null, timedOut: true, partial: true };
  }
}
