import { parseAbiItem } from "viem";
import { lookupOwnedFromMap, loadTokenOwners } from "./token-owners.js";

export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 4;
const MULTICALL_TIMEOUT_MS = 12_000;
const OWNER_VERIFY_CHUNK = 96;
const OWNER_VERIFY_TIMEOUT_MS = 25_000;
const SCAN_HARD_TIMEOUT_MS = 30_000;
const WALLET_API_TIMEOUT_MS = 18_000;
const CLIENT_LOG_BLOCK_RANGE = 10_000n;

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
    for (let i = 0; i < retryIds.length; i += 12) {
      const batch = retryIds.slice(i, i + 12);
      const batchContracts = batch.map((id) => ({
        address: collectionAddress,
        abi: collectionAbi,
        functionName: "ownerOf",
        args: [BigInt(id)],
      }));
      try {
        const retryResults = await multicallChunked(client, batchContracts, {
          chunk: 12,
          parallel: 1,
          timeoutMs: 12_000,
          stopOnFailure: false,
        });
        owned = mergeUniqueIds(owned, collectOwnedTokenIds(batch, retryResults, addr));
      } catch (err) {
        console.warn("[scan] ownerOf retry failed:", err.message);
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

async function discoverViaWalletApi(owner, { recentOnly = true, timeoutMs = WALLET_API_TIMEOUT_MS } = {}) {
  try {
    const url =
      `/api/wallet-tokens?address=${encodeURIComponent(owner)}&recent=${recentOnly ? "1" : "0"}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn("[scan] wallet API HTTP", res.status, err.error || "");
      return [];
    }
    const data = await res.json();
    const ids = data?.tokenIds;
    return Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch (err) {
    console.warn("[scan] wallet API:", err.message);
    return [];
  }
}

/** Transfer logs via the connected wallet RPC (Infura/MetaMask often works when Netlify RPC fails). */
async function discoverViaClientLogs(client, owner, collectionAddress, { maxBlocks = CLIENT_LOG_BLOCK_RANGE } = {}) {
  if (!client?.getLogs) return [];
  try {
    const latest = await withTimeout(client.getBlockNumber(), 8_000, "getBlockNumber");
    const fromBlock = latest > maxBlocks ? latest - maxBlocks : 0n;
    const addr = owner;

    const [toLogs, fromLogs] = await withTimeout(
      Promise.all([
        client.getLogs({
          address: collectionAddress,
          event: TRANSFER_EVENT,
          args: { to: addr },
          fromBlock,
          toBlock: latest,
        }),
        client.getLogs({
          address: collectionAddress,
          event: TRANSFER_EVENT,
          args: { from: addr },
          fromBlock,
          toBlock: latest,
        }),
      ]),
      12_000,
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

async function discoverTransferCandidates(client, owner, collectionAddress, logClient, { recentOnly = true, timeoutMs } = {}) {
  let apiIds = await discoverViaWalletApi(owner, { recentOnly, timeoutMs });
  if (apiIds.length) return apiIds;

  if (!recentOnly) {
    apiIds = await discoverViaWalletApi(owner, { recentOnly: true, timeoutMs });
    if (apiIds.length) return apiIds;
  }

  return discoverViaClientLogs(logClient || client, owner, collectionAddress);
}

async function supplementViaWalletApi(
  client,
  owner,
  collectionAddress,
  collectionAbi,
  verified,
  logClient,
  { recentOnly = true, timeoutMs = WALLET_API_TIMEOUT_MS } = {},
) {
  let apiIds = await discoverTransferCandidates(client, owner, collectionAddress, logClient, { recentOnly, timeoutMs });
  if (!apiIds.length && recentOnly) {
    apiIds = await discoverTransferCandidates(client, owner, collectionAddress, logClient, { recentOnly: false, timeoutMs });
  }
  if (!apiIds.length) return verified;

  const merged = mergeUniqueIds(verified, apiIds);
  return verifyOwnersOnChain(client, owner, merged, collectionAddress, collectionAbi);
}

function scheduleBackgroundSupplement(
  client,
  owner,
  collectionAddress,
  collectionAbi,
  currentIds,
  maxId,
  onSupplement,
  logClient,
) {
  if (!onSupplement) return;

  void supplementViaWalletApi(
    client, owner, collectionAddress, collectionAbi, currentIds, logClient,
    { recentOnly: true, timeoutMs: WALLET_API_TIMEOUT_MS },
  ).then((extra) => {
    const full = filterMax(extra, maxId);
    if (full.length > currentIds.length || !sameIdSet(full, currentIds)) {
      onSupplement(full);
    }
  });
}

async function scanOwnedTokenIdsInner(
  client,
  { owner, maxId, collectionAddress, collectionAbi, refreshMap = false, onSupplement = null, logClient = null },
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

  let mapIds = filterMax(verified, maxId);
  let countMismatch = target != null && mapIds.length !== target;

  if (countMismatch && candidates.length) {
    const verifiedSet = new Set(mapIds);
    const mapRetries = candidates.filter((id) => !verifiedSet.has(id) && id <= maxId);
    if (mapRetries.length) {
      const extra = await verifyOwnersOnChain(
        client,
        owner,
        mapRetries,
        collectionAddress,
        collectionAbi,
      );
      verified = mergeUniqueIds(verified, extra);
      mapIds = filterMax(verified, maxId);
      countMismatch = target != null && mapIds.length !== target;
    }
  }

  if (mapIds.length === 0 || countMismatch) {
    console.log(
      `[scan] map ${mapIds.length}/${target ?? "?"} — wallet API + client logs`,
    );
    verified = await supplementViaWalletApi(
      client, owner, collectionAddress, collectionAbi, verified, logClient,
      { recentOnly: true, timeoutMs: WALLET_API_TIMEOUT_MS },
    );
    const full = filterMax(verified, maxId);
    if (countMismatch && full.length < target) {
      verified = await supplementViaWalletApi(
        client, owner, collectionAddress, collectionAbi, verified, logClient,
        { recentOnly: false, timeoutMs: WALLET_API_TIMEOUT_MS },
      );
    }
    return { tokenIds: filterMax(verified, maxId), balance: target };
  }

  console.log(`[scan] map verified ${mapIds.length} token(s) — checking recent purchases`);
  scheduleBackgroundSupplement(
    client, owner, collectionAddress, collectionAbi, mapIds, maxId, onSupplement, logClient,
  );
  return { tokenIds: mapIds, balance: target };
}

/**
 * Fast wallet scan — owner index + wallet API + client Transfer logs fallback.
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
      fallback = filterMax(await lookupOwnedFromMap(owner), maxId);
    } catch {
      fallback = [];
    }
    void supplementViaWalletApi(
      client, owner, collectionAddress, collectionAbi, fallback, logClient,
      { recentOnly: true, timeoutMs: WALLET_API_TIMEOUT_MS },
    ).then((extra) => {
      const full = filterMax(extra, maxId);
      if (onSupplement && (full.length > fallback.length || !sameIdSet(full, fallback))) {
        onSupplement(full);
      }
    });
    return { tokenIds: fallback, balance: null, timedOut: true };
  }
}
