import { lookupOwnedFromMap } from "./token-owners.js";

/**
 * Multicall helper — used for evolve reads, not wallet scan.
 */
export const MULTICALL_CHUNK = 256;
export const MULTICALL_PARALLEL = 4;
const MULTICALL_TIMEOUT_MS = 30_000;

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

/**
 * Wallet token IDs — instant lookup from token-owners.json (no 4444 RPC in browser).
 */
export async function scanOwnedTokenIds(_client, { owner, maxId }) {
  const ids = await lookupOwnedFromMap(owner);
  const filtered = ids.filter((id) => id >= 1 && id <= maxId);
  console.log(`[scan] owner map: ${filtered.length} token(s)`);
  return filtered;
}
