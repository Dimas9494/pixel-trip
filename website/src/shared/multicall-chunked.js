import { fetchWithTimeout } from "./fetch-timeout.js";
import { lookupOwnedFromMap, loadTokenOwners } from "./token-owners.js";

export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 4;
const MULTICALL_TIMEOUT_MS = 30_000;
const INDEXER_URL = "/.netlify/functions/wallet-tokens";
const INDEXER_TIMEOUT_MS = 25_000;

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

async function fetchIndexerIds(owner, { recent = false } = {}) {
  const qs = recent ? "&recent=1" : "";
  const res = await fetchWithTimeout(
    `${INDEXER_URL}?address=${encodeURIComponent(owner)}${qs}`,
    { cache: "no-store" },
    INDEXER_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.tokenIds)) throw new Error("Bad indexer response");
  return data.tokenIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

function mergeUnique(...lists) {
  return [...new Set(lists.flat())].sort((a, b) => a - b);
}

/**
 * Accurate wallet tokens: map hint → on-chain verify → indexer if balance mismatch.
 */
export async function scanOwnedTokenIds(
  client,
  { owner, maxId, collectionAddress, collectionAbi, forceRefresh = false },
) {
  const balance = await readWalletBalance(client, owner, collectionAddress, collectionAbi);
  if (balance === 0n) return [];

  const target = Number(balance);

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

  if (verified.length === target) {
    console.log(`[scan] verified ${verified.length} token(s) on-chain`);
    return verified.filter((id) => id >= 1 && id <= maxId);
  }

  console.warn(
    `[scan] map/verify ${verified.length} vs balance ${target} — fetching live transfers…`,
  );

  try {
    const recentIds = await fetchIndexerIds(owner, { recent: true });
    const merged = mergeUnique(verified, recentIds);
    verified = await verifyOwnersOnChain(
      client,
      owner,
      merged,
      collectionAddress,
      collectionAbi,
    );
    if (verified.length === target) {
      console.log(`[scan] recent indexer + verify: ${verified.length} token(s)`);
      return verified.filter((id) => id >= 1 && id <= maxId);
    }
  } catch (err) {
    console.warn("[scan] recent indexer:", err.message);
  }

  try {
    const liveIds = await fetchIndexerIds(owner);
    verified = await verifyOwnersOnChain(
      client,
      owner,
      liveIds,
      collectionAddress,
      collectionAbi,
    );
    console.log(`[scan] full indexer + verify: ${verified.length} token(s)`);
    return verified.filter((id) => id >= 1 && id <= maxId);
  } catch (err) {
    console.warn("[scan] full indexer failed:", err.message);
  }

  console.log(`[scan] fallback verify only: ${verified.length} token(s)`);
  return verified.filter((id) => id >= 1 && id <= maxId);
}
