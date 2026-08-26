/**
 * Diagnose wallet scan gap for a given address.
 * Usage: node collection/scripts/diagnose_wallet_scan.mjs 0xF6E6...
 */
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbiItem } from "viem";
import { mainnet } from "viem/chains";

const STAGE1 = "0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9";
const FROM_BLOCK = 25613313n;
const RPC = process.env.MAINNET_RPC_URL || "https://rpc.mevblocker.io";
const MAP_PATH = new URL("../../website/public/data/token-owners.json", import.meta.url);
const transfer = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

const addr = (process.argv[2] || "").toLowerCase();
if (!/^0x[a-f0-9]{40}$/.test(addr)) {
  console.error("Usage: node diagnose_wallet_scan.mjs 0x...");
  process.exit(1);
}

const abi = [
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "ownerOf", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }], stateMutability: "view" },
];

const client = createPublicClient({ chain: mainnet, transport: http(RPC) });

async function getLogsChunked(fromBlock, toBlock, chunkSize = 10_000n) {
  const ids = new Set();
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    const [toLogs, fromLogs] = await Promise.all([
      client.getLogs({ address: STAGE1, event: transfer, args: { to: addr }, fromBlock: start, toBlock: end }),
      client.getLogs({ address: STAGE1, event: transfer, args: { from: addr }, fromBlock: start, toBlock: end }),
    ]);
    for (const log of [...toLogs, ...fromLogs]) {
      if (log.args?.tokenId != null) ids.add(Number(log.args.tokenId));
    }
  }
  return [...ids].sort((a, b) => a - b);
}

async function verifyIds(ids) {
  const owned = [];
  const failed = [];
  for (let i = 0; i < ids.length; i += 96) {
    const batch = ids.slice(i, i + 96);
    const contracts = batch.map((id) => ({
      address: STAGE1,
      abi,
      functionName: "ownerOf",
      args: [BigInt(id)],
    }));
    const results = await client.multicall({ contracts, allowFailure: true });
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r?.status === "success" && r.result.toLowerCase() === addr) owned.push(batch[j]);
      else if (!r || r.status !== "success") failed.push(batch[j]);
    }
  }
  return { owned: owned.sort((a, b) => a - b), failed };
}

const map = JSON.parse(readFileSync(MAP_PATH, "utf8"));
const mapCandidates = Object.entries(map.owners)
  .filter(([, o]) => o === addr)
  .map(([id]) => Number(id))
  .sort((a, b) => a - b);

const balance = Number(await client.readContract({
  address: STAGE1,
  abi,
  functionName: "balanceOf",
  args: [addr],
}));

console.log("Wallet:", addr);
console.log("balanceOf:", balance);
console.log("token-owners map:", mapCandidates.length, `(updated ${map.updatedAt})`);

const mapVerified = await verifyIds(mapCandidates);
console.log("map verified:", mapVerified.owned.length);
console.log("ownerOf multicall failures:", mapVerified.failed.length);

const latest = await client.getBlockNumber();
console.log("scanning transfer logs…");
const logCandidates = await getLogsChunked(FROM_BLOCK, latest);
const logVerified = await verifyIds(logCandidates);
console.log("log candidates:", logCandidates.length);
console.log("log verified owned:", logVerified.owned.length);

const mapSet = new Set(mapVerified.owned);
const missing = logVerified.owned.filter((id) => !mapSet.has(id));
console.log("\nIn logs but not in map (" + missing.length + "):", missing.join(", ") || "none");

if (logVerified.owned.length !== balance) {
  console.log("\nWARN: log verified", logVerified.owned.length, "!= balanceOf", balance);
}
