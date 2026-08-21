/** Tunables for wallet ownerOf scans (4444 tokens). */
export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 4;
const MULTICALL_TIMEOUT_MS = 45_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms);
    }),
  ]);
}

/**
 * Multicall in ordered chunks; runs up to `parallel` chunks concurrently.
 * Falls back to smaller sequential batches if the RPC rejects parallel load.
 * @param {import('viem').PublicClient} client
 * @param {import('viem').MulticallContracts} contracts
 */
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
    console.warn("[multicall] fast path failed, retrying sequential:", err.message);
    return run(1);
  }
}

/**
 * Find owned token IDs by scanning ownerOf(1..maxId).
 * Skips the full scan when balanceOf succeeds and returns zero.
 */
export async function scanOwnedTokenIds(
  client,
  { owner, maxId, collectionAddress, collectionAbi },
) {
  let balance = null;
  try {
    balance = await withTimeout(
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
    console.warn("[scan] balanceOf failed, falling back to full scan:", err.message);
  }

  if (balance === 0n) return [];

  const contracts = Array.from({ length: maxId }, (_, i) => ({
    address: collectionAddress,
    abi: collectionAbi,
    functionName: "ownerOf",
    args: [BigInt(i + 1)],
  }));

  const results = await multicallChunked(client, contracts);
  const addr = owner.toLowerCase();
  const owned = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r?.status === "success" && r.result?.toLowerCase() === addr) {
      owned.push(i + 1);
    }
  }
  return owned;
}
