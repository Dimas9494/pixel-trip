import { parseAbiItem } from "viem";
import { fetchWithTimeout } from "./fetch-timeout.js";
import { lookupOwnedFromMap, loadTokenOwners } from "./token-owners.js";
import { COLLECTION_DEPLOY_BLOCK } from "../burn/config.js";

export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 4;
const MULTICALL_TIMEOUT_MS = 30_000;
const LOG_CHUNK = 80_000n;
const RECENT_BLOCKS = 800_000n;
const LOG_PARALLEL = 6;
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

/** Live wallet discovery via Transfer logs (accurate after buys/burns). */
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

async function scanViaLogs(client, owner, collectionAddress, collectionAbi, target, { recentOnly = false } = {}) {
  const scope = recentOnly ? "recent" : "full";
  console.log(`[scan] transfer logs (${scope})…`);
  const candidates = await discoverViaTransferLogs(client, owner, collectionAddress, { recentOnly });
  const verified = await verifyOwnersOnChain(
    client,
    owner,
    candidates,
    collectionAddress,
    collectionAbi,
  );
  console.log(`[scan] logs ${scope}: ${verified.length} verified${target ? ` / balance ${target}` : ""}`);
  return verified;
}

function filterMax(verified, maxId) {
  return verified.filter((id) => id >= 1 && id <= maxId);
}

/**
 * Accurate wallet tokens — on-chain balance + Transfer logs + ownerOf verify.
 */
export async function scanOwnedTokenIds(
  client,
  { owner, maxId, collectionAddress, collectionAbi, forceRefresh = false },
) {
  const balance = await readWalletBalance(client, owner, collectionAddress, collectionAbi);
  if (balance === 0n) return [];

  const target = balance != null ? Number(balance) : null;

  if (forceRefresh) {
    let verified = await scanViaLogs(client, owner, collectionAddress, collectionAbi, target, {
      recentOnly: true,
    });
    if (target == null || verified.length >= target) {
      return filterMax(verified, maxId);
    }
    verified = await scanViaLogs(client, owner, collectionAddress, collectionAbi, target, {
      recentOnly: false,
    });
    return filterMax(verified, maxId);
  }

  let candidates = [];
  try {
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

  if (target != null && verified.length === target) {
    console.log(`[scan] map verified ${verified.length} token(s)`);
    return filterMax(verified, maxId);
  }

  console.warn(
    `[scan] map ${verified.length}${target != null ? ` vs balance ${target}` : ""} — live transfer scan…`,
  );

  verified = await scanViaLogs(client, owner, collectionAddress, collectionAbi, target, {
    recentOnly: true,
  });
  if (target == null || verified.length >= target) {
    return filterMax(verified, maxId);
  }

  verified = await scanViaLogs(client, owner, collectionAddress, collectionAbi, target, {
    recentOnly: false,
  });
  return filterMax(verified, maxId);
}
