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
const PARALLEL = 3;
const RPC_URLS = [
  process.env.MAINNET_RPC_URL,
  "https://ethereum.publicnode.com",
  "https://rpc.mevblocker.io",
  "https://eth.drpc.org",
].filter(Boolean);

const abi = [{
  type: "function",
  name: "ownerOf",
  stateMutability: "view",
  inputs: [{ name: "tokenId", type: "uint256" }],
  outputs: [{ type: "address" }],
}];

function makeClient(rpcUrl) {
  return createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
}

const clients = RPC_URLS.map(makeClient);
const client = clients[0];
const owners = {};
const t0 = Date.now();

async function retryOwnerOf(failedIds) {
  for (let i = 0; i < failedIds.length; i += RETRY_BATCH) {
    const batch = failedIds.slice(i, i + RETRY_BATCH);
    await Promise.all(
      batch.map(async (id) => {
        for (const c of clients) {
          try {
            const owner = await c.readContract({
              address: STAGE1,
              abi,
              functionName: "ownerOf",
              args: [BigInt(id)],
            });
            if (owner) {
              owners[String(id)] = owner.toLowerCase();
              return;
            }
          } catch {
            // try next RPC
          }
        }
      }),
    );
  }
}

async function scanChunk(start, end) {
  const contracts = [];
  for (let id = start; id <= end; id++) {
    contracts.push({
      address: STAGE1,
      abi,
      functionName: "ownerOf",
      args: [BigInt(id)],
    });
  }
  const failedIds = [];
  for (const c of clients) {
    try {
      const results = await c.multicall({ contracts, allowFailure: true });
      for (let i = 0; i < results.length; i++) {
        const id = start + i;
        const r = results[i];
        if (r?.status === "success" && r.result) {
          owners[String(id)] = r.result.toLowerCase();
        } else if (!owners[String(id)]) {
          failedIds.push(id);
        }
      }
      break;
    } catch {
      // try next RPC
    }
  }
  const stillFailed = [...new Set(failedIds.filter((id) => !owners[String(id)]))];
  if (stillFailed.length) await retryOwnerOf(stillFailed);
}

const ranges = [];
for (let start = 1; start <= MAX_ID; start += CHUNK) {
  ranges.push({ start, end: Math.min(start + CHUNK - 1, MAX_ID) });
}

for (let i = 0; i < ranges.length; i += PARALLEL) {
  await Promise.all(ranges.slice(i, i + PARALLEL).map(({ start, end }) => scanChunk(start, end)));
  const done = Math.min(ranges[i + PARALLEL - 1]?.end ?? ranges[i].end, MAX_ID);
  process.stdout.write(`\r${done}/${MAX_ID} (${Math.round((done / MAX_ID) * 100)}%)`);
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
