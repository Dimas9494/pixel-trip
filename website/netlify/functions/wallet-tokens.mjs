/**
 * Netlify Function: wallet-tokens
 * GET /.netlify/functions/wallet-tokens?address=0x...
 *
 * Fast wallet lookup via Transfer logs + ownerOf verify (no 4444-scan).
 */

const STAGE1 = "0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9";
const FROM_BLOCK = 25_613_313;
const LOG_CHUNK = 120_000;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const OWNER_OF_SEL = "6352211e";
const RPC_URL = process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=30",
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function normalizeAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address || "") ? address.toLowerCase() : null;
}

function padTopicAddress(address) {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "RPC error");
  return data.result;
}

async function readBalance(address) {
  const data = "0x70a08231" + address.slice(2).padStart(64, "0");
  const hex = await rpcCall("eth_call", [{ to: STAGE1, data }, "latest"]);
  if (!hex || hex === "0x") return 0;
  return Number(BigInt(hex));
}

function parseTokenId(log) {
  const topic = log.topics?.[3];
  if (!topic) return null;
  const id = Number(BigInt(topic));
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function getLogsRange(fromBlock, toBlock, topics) {
  const params = [{
    address: STAGE1,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    topics,
  }];
  const result = await rpcCall("eth_getLogs", params);
  return Array.isArray(result) ? result : [];
}

async function getLogsChunked(fromBlock, toBlock, topics) {
  const ranges = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK) {
    ranges.push([start, Math.min(start + LOG_CHUNK - 1, toBlock)]);
  }

  const batches = [];
  for (let i = 0; i < ranges.length; i += 6) {
    batches.push(ranges.slice(i, i + 6));
  }

  const logs = [];
  for (const batch of batches) {
    const parts = await Promise.all(
      batch.map(([start, end]) => getLogsRange(start, end, topics)),
    );
    for (const part of parts) logs.push(...part);
  }
  return logs;
}

function encodeOwnerOf(tokenId) {
  return `0x${OWNER_OF_SEL}${BigInt(tokenId).toString(16).padStart(64, "0")}`;
}

async function verifyOwners(address, tokenIds) {
  const owned = [];
  const batchSize = 24;
  for (let i = 0; i < tokenIds.length; i += batchSize) {
    const batch = tokenIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (tokenId) => {
        try {
          const hex = await rpcCall("eth_call", [{ to: STAGE1, data: encodeOwnerOf(tokenId) }, "latest"]);
          if (!hex || hex.length < 42) return null;
          const owner = `0x${hex.slice(-40)}`.toLowerCase();
          return owner === address ? tokenId : null;
        } catch {
          return null;
        }
      }),
    );
    for (const id of results) {
      if (id != null) owned.push(id);
    }
  }
  owned.sort((a, b) => a - b);
  return owned;
}

async function findOwnedTokenIds(address) {
  const balance = await readBalance(address);
  if (balance <= 0) return { tokenIds: [], source: "balance" };

  const latest = parseInt(await rpcCall("eth_blockNumber"), 16);
  const pad = padTopicAddress(address);

  const [toLogs, fromLogs] = await Promise.all([
    getLogsChunked(FROM_BLOCK, latest, [TRANSFER_TOPIC, null, pad]),
    getLogsChunked(FROM_BLOCK, latest, [TRANSFER_TOPIC, pad, null]),
  ]);

  const candidates = new Set();
  for (const log of [...toLogs, ...fromLogs]) {
    const id = parseTokenId(log);
    if (id) candidates.add(id);
  }

  if (!candidates.size) {
    return { tokenIds: [], source: "logs-empty" };
  }

  const tokenIds = await verifyOwners(address, [...candidates]);
  return { tokenIds, source: "logs", balance, candidates: candidates.size };
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "GET") {
    return json(405, { error: "GET only" });
  }

  const url = new URL(req.url);
  const address = normalizeAddress(url.searchParams.get("address"));
  if (!address) {
    return json(400, { error: "Missing or invalid ?address=0x..." });
  }

  try {
    const result = await findOwnedTokenIds(address);
    return json(200, {
      ok: true,
      address,
      tokenIds: result.tokenIds,
      count: result.tokenIds.length,
      source: result.source,
    });
  } catch (err) {
    console.error("[wallet-tokens]", err);
    return json(502, { error: err.message || "Lookup failed" });
  }
};
