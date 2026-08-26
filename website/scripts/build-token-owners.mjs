/**
 * One-off / periodic: scan ownerOf(1..4444) and write token-owners.json
 * Usage: node scripts/build-token-owners.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public/data/token-owners.json");
const STAGE1 = "0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9";
const MAX_ID = 4444;
const CHUNK = 64;
const RETRY_BATCH = 16;
const RPC = process.env.MAINNET_RPC_URL || "https://rpc.mevblocker.io";

const abi = [{
  type: "function",
  name: "ownerOf",
  stateMutability: "view",
  inputs: [{ name: "tokenId", type: "uint256" }],
  outputs: [{ type: "address" }],
}];

const client = createPublicClient({ chain: mainnet, transport: http(RPC) });
const owners = {};
const t0 = Date.now();

async function retryOwnerOf(failedIds) {
  for (let i = 0; i < failedIds.length; i += RETRY_BATCH) {
    const batch = failedIds.slice(i, i + RETRY_BATCH);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const owner = await client.readContract({
            address: STAGE1,
            abi,
            functionName: "ownerOf",
            args: [BigInt(id)],
          });
          if (owner) owners[String(id)] = owner.toLowerCase();
        } catch {
          // unminted or burned
        }
      }),
    );
  }
}

for (let start = 1; start <= MAX_ID; start += CHUNK) {
  const end = Math.min(start + CHUNK - 1, MAX_ID);
  const contracts = [];
  for (let id = start; id <= end; id++) {
    contracts.push({
      address: STAGE1,
      abi,
      functionName: "ownerOf",
      args: [BigInt(id)],
    });
  }
  const results = await client.multicall({ contracts, allowFailure: true });
  const failedIds = [];
  for (let i = 0; i < results.length; i++) {
    const id = start + i;
    const r = results[i];
    if (r?.status === "success" && r.result) {
      owners[String(id)] = r.result.toLowerCase();
    } else {
      failedIds.push(id);
    }
  }
  if (failedIds.length) await retryOwnerOf(failedIds);
  process.stdout.write(`\r${end}/${MAX_ID} (${Math.round((end / MAX_ID) * 100)}%)`);
}

mkdirSync(path.dirname(OUT), { recursive: true });
const payload = {
  updatedAt: new Date().toISOString(),
  collection: STAGE1,
  maxId: MAX_ID,
  owners,
};
writeFileSync(OUT, JSON.stringify(payload));
console.log(`\nWrote ${Object.keys(owners).length} owners → ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
