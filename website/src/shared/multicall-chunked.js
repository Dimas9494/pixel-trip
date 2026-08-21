/** Tunables for wallet ownerOf scans (4444 tokens). */
export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 8;

/**
 * Multicall in ordered chunks; runs up to `parallel` chunks concurrently.
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

  const out = [];
  for (let b = 0; b < slices.length; b += parallel) {
    const batch = slices.slice(b, b + parallel);
    const results = await Promise.all(
      batch.map((contractsChunk) =>
        client.multicall({ contracts: contractsChunk, allowFailure: true }),
      ),
    );
    for (const res of results) out.push(...res);
  }
  return out;
}

/**
 * Find owned token IDs by scanning ownerOf(1..maxId).
 * Skips the full scan when balanceOf is zero.
 */
export async function scanOwnedTokenIds(
  client,
  { owner, maxId, collectionAddress, collectionAbi },
) {
  let balance = 0n;
  try {
    balance = await client.readContract({
      address: collectionAddress,
      abi: collectionAbi,
      functionName: "balanceOf",
      args: [owner],
    });
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
