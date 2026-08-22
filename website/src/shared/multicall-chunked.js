import { parseAbiItem } from "viem";
import { lookupOwnedFromMap, loadTokenOwners } from "./token-owners.js";
import { COLLECTION_DEPLOY_BLOCK } from "../burn/config.js";

export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 4;
const MULTICALL_TIMEOUT_MS = 30_000;
const LOG_CHUNK = 80_000n;
const RECENT_BLOCKS = 800_000n;
const LOG_PARALLEL = 6;
const LOG_SCAN_TIMEOUT_MS = 45_000;
const WALLET_API_TIMEOUT_MS = 8_000;
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

  async function run(parallelism) {
    const out = [];
    for (let b = 0; b < slices.length; b += parallelism) {
      const batch = slices.slice(b, b + parallelism);
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
    }
    return out;
  }

  try {
    return await run(parallel);
  } catch (err) {
    console.warn("[multicall] retry sequential:", err.message);
    return run(1);
  }
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
      10_000,
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

function collectTokenIds(logs) {
  const ids = new Set();
  for (const log of logs) {
    const id = log.args?.tokenId;
    if (id != null) ids.add(Number(id));
  }
  return [...ids];
}

async function getLogsForRange(client, filter, fromBlock, toBlock) {
  const ranges = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n > toBlock ? toBlock : start + LOG_CHUNK - 1n;
    ranges.push([start, end]);
  }

  const logs = [];
  for (let i = 0; i < ranges.length; i += LOG_PARALLEL) {
    const batch = ranges.slice(i, i + LOG_PARALLEL);
    const parts = await Promise.all(
      batch.map(([from, to]) =>
        client.getLogs({ ...filter, fromBlock: from, toBlock: to }),
      ),
    );
    for (const part of parts) logs.push(...part);
  }
  return logs;
}

async function discoverViaTransferLogs(client, owner, collectionAddress, { recentOnly = false } = {}) {
  const latest = await client.getBlockNumber();
  const fromBlock = recentOnly
    ? (latest > RECENT_BLOCKS ? latest - RECENT_BLOCKS : COLLECTION_DEPLOY_BLOCK)
    : COLLECTION_DEPLOY_BLOCK;

  const [received, sent] = await Promise.all([
    getLogsForRange(
      client,
      { address: collectionAddress, event: TRANSFER_EVENT, args: { to: owner } },
      fromBlock,
      latest,
    ),
    getLogsForRange(
      client,
      { address: collectionAddress, event: TRANSFER_EVENT, args: { from: owner } },
      fromBlock,
      latest,
    ),
  ]);

  return collectTokenIds([...received, ...sent]);
}

async function scanViaLogs(client, owner, collectionAddress, collectionAbi, { recentOnly = false } = {}) {
  const scope = recentOnly ? "recent" : "full";
  console.log(`[scan] transfer logs (${scope})…`);
  const candidates = await withTimeout(
    discoverViaTransferLogs(client, owner, collectionAddress, { recentOnly }),
    LOG_SCAN_TIMEOUT_MS,
    `transfer logs ${scope}`,
  );
  const verified = await verifyOwnersOnChain(
    client,
    owner,
    candidates,
    collectionAddress,
    collectionAbi,
  );
  console.log(`[scan] logs ${scope}: ${verified.length} verified`);
  return verified;
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
  target,
  { recentOnly = true, timeoutMs = WALLET_API_TIMEOUT_MS } = {},
) {
  const apiIds = await discoverViaWalletApi(owner, { recentOnly, timeoutMs });
  if (!apiIds.length) return verified;

  const merged = mergeUniqueIds(verified, apiIds);
  const result = await verifyOwnersOnChain(client, owner, merged, collectionAddress, collectionAbi);
  console.log(`[scan] wallet API + verify: ${result.length}/${target ?? "?"} token(s)`);
  return result;
}

async function supplementOwnedIds(
  client,
  owner,
  collectionAddress,
  collectionAbi,
  verified,
  target,
  { allowBrowserLogs = false, recentOnly = true } = {},
) {
  let merged = await supplementViaWalletApi(
    client,
    owner,
    collectionAddress,
    collectionAbi,
    verified,
    target,
    { recentOnly, timeoutMs: allowBrowserLogs ? 15_000 : WALLET_API_TIMEOUT_MS },
  );

  if (!allowBrowserLogs || target == null || merged.length >= target) {
    return merged;
  }

  try {
    const fromLogs = await scanViaLogs(client, owner, collectionAddress, collectionAbi, {
      recentOnly,
    });
    merged = mergeUniqueIds(merged, fromLogs);
    merged = await verifyOwnersOnChain(client, owner, merged, collectionAddress, collectionAbi);
    if (merged.length >= target || recentOnly) {
      return merged;
    }
  } catch (err) {
    console.warn("[scan] log supplement failed:", err.message);
    if (merged.length) return merged;
  }

  if (!recentOnly) return merged;

  try {
    const fullLogs = await scanViaLogs(client, owner, collectionAddress, collectionAbi, {
      recentOnly: false,
    });
    merged = mergeUniqueIds(merged, fullLogs);
    merged = await verifyOwnersOnChain(client, owner, merged, collectionAddress, collectionAbi);
  } catch (err) {
    console.warn("[scan] full log supplement failed:", err.message);
  }

  return merged;
}

/**
 * Wallet scan — static owner map (fast), wallet API supplement, browser logs only on forceRefresh.
 */
export async function scanOwnedTokenIds(
  client,
  { owner, maxId, collectionAddress, collectionAbi, forceRefresh = false, onSupplement = null },
) {
  const balance = await readWalletBalance(client, owner, collectionAddress, collectionAbi);
  if (balance === 0n) return { tokenIds: [], balance: 0 };

  const target = balance != null ? Number(balance) : null;

  let candidates = [];
  try {
    if (forceRefresh) await loadTokenOwners(true);
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

  const complete = target != null ? verified.length >= target : verified.length > 0;

  if (complete) {
    console.log(`[scan] map verified ${verified.length} token(s)`);
    return { tokenIds: filterMax(verified, maxId), balance: target };
  }

  const partial = filterMax(verified, maxId);
  const supplementOpts = {
    allowBrowserLogs: forceRefresh,
    recentOnly: !forceRefresh,
  };

  if (!forceRefresh) {
    if (partial.length > 0) {
      console.log(`[scan] fast ${partial.length}/${target ?? "?"} — background wallet API`);
      void supplementOwnedIds(
        client,
        owner,
        collectionAddress,
        collectionAbi,
        verified,
        target,
        supplementOpts,
      ).then((extra) => {
        const full = filterMax(extra, maxId);
        if (full.length > partial.length && onSupplement) {
          onSupplement(full);
        }
      });
      return { tokenIds: partial, balance: target, partial: true };
    }

    console.log(`[scan] map empty — wallet API only (${WALLET_API_TIMEOUT_MS}ms max)`);
    verified = await supplementOwnedIds(
      client,
      owner,
      collectionAddress,
      collectionAbi,
      verified,
      target,
      supplementOpts,
    );
    return { tokenIds: filterMax(verified, maxId), balance: target };
  }

  console.log(`[scan] full refresh ${partial.length}/${target ?? "?"}…`);
  verified = await supplementOwnedIds(
    client,
    owner,
    collectionAddress,
    collectionAbi,
    verified,
    target,
    supplementOpts,
  );
  return { tokenIds: filterMax(verified, maxId), balance: target };
}
