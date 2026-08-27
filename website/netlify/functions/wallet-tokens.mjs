/**
 * Netlify Function: wallet-tokens
 * GET /.netlify/functions/wallet-tokens?address=0x...
 *
 * Fast wallet lookup via Transfer logs + ownerOf verify (no 4444-scan).
 */

const STAGE1 = "0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9";
const FROM_BLOCK = 25_613_313;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const OWNER_OF_SEL = "6352211e";

/** Free RPCs that still allow recent eth_getLogs (publicnode needs archive token). */
const RPC_URLS = [
  process.env.MAINNET_RPC_URL,
  "https://rpc.mevblocker.io",
  "https://1rpc.io/eth",
  "https://eth.drpc.org",
].filter(Boolean);

/** ~1.4 days on mevblocker free tier; enough for new OpenSea buys. */
const RECENT_BLOCK_RANGE = 10_000;
const MEVBLOCKER_MAX_RANGE = 10_000;
const ONERPC_MAX_RANGE = 50;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=15",
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

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "RPC error");
  return data.result;
}

async function rpcCallWithFallback(method, params) {
  let lastErr = "RPC unavailable";
  for (const url of RPC_URLS) {
    try {
      return await rpcCall(url, method, params);
    } catch (err) {
      lastErr = err.message || lastErr;
    }
  }
  throw new Error(lastErr);
}

async function readBalance(address) {
  const data = "0x70a08231" + address.slice(2).padStart(64, "0");
  const hex = await rpcCallWithFallback("eth_call", [{ to: STAGE1, data }, "latest"]);
  if (!hex || hex === "0x") return 0;
  return Number(BigInt(hex));
}

function parseTokenId(log) {
  const topic = log.topics?.[3];
  if (!topic) return null;
  const id = Number(BigInt(topic));
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function getLogsRange(rpcUrl, fromBlock, toBlock, topics) {
  const params = [{
    address: STAGE1,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    topics,
  }];
  const result = await rpcCall(rpcUrl, "eth_getLogs", params);
  return Array.isArray(result) ? result : [];
}

async function getLogsWithFallback(fromBlock, toBlock, topics) {
  const span = toBlock - fromBlock + 1;
  let lastErr = "getLogs failed";

  for (const rpcUrl of RPC_URLS) {
    try {
      if (rpcUrl.includes("1rpc.io") && span > ONERPC_MAX_RANGE) {
        const logs = [];
        for (let start = fromBlock; start <= toBlock; start += ONERPC_MAX_RANGE) {
          const end = Math.min(start + ONERPC_MAX_RANGE - 1, toBlock);
          logs.push(...await getLogsRange(rpcUrl, start, end, topics));
        }
        return logs;
      }

      if (span > MEVBLOCKER_MAX_RANGE) {
        const logs = [];
        for (let start = fromBlock; start <= toBlock; start += MEVBLOCKER_MAX_RANGE) {
          const end = Math.min(start + MEVBLOCKER_MAX_RANGE - 1, toBlock);
          logs.push(...await getLogsRange(rpcUrl, start, end, topics));
        }
        return logs;
      }

      return await getLogsRange(rpcUrl, fromBlock, toBlock, topics);
    } catch (err) {
      lastErr = err.message || lastErr;
    }
  }

  throw new Error(lastErr);
}

function encodeOwnerOf(tokenId) {
  return `0x${OWNER_OF_SEL}${BigInt(tokenId).toString(16).padStart(64, "0")}`;
}

async function verifyOwners(address, tokenIds) {
  const owned = new Set();
  const failed = [];

  async function checkOne(tokenId) {
    try {
      const hex = await rpcCallWithFallback("eth_call", [{ to: STAGE1, data: encodeOwnerOf(tokenId) }, "latest"]);
      if (!hex || hex.length < 42) return false;
      const owner = `0x${hex.slice(-40)}`.toLowerCase();
      if (owner === address) {
        owned.add(tokenId);
        return true;
      }
    } catch {
      // retry pass
    }
    return false;
  }

  const batchSize = 24;
  for (let i = 0; i < tokenIds.length; i += batchSize) {
    const batch = tokenIds.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (tokenId) => {
        if (!(await checkOne(tokenId))) failed.push(tokenId);
      }),
    );
  }

  if (failed.length) {
    for (const tokenId of failed) {
      await checkOne(tokenId);
    }
  }

  return [...owned].sort((a, b) => a - b);
}

async function findOwnedTokenIds(address, { recentOnly = false } = {}) {
  const balance = await readBalance(address);
  if (balance <= 0) return { tokenIds: [], source: "balance" };

  const latest = parseInt(await rpcCallWithFallback("eth_blockNumber", []), 16);
  const fromBlock = recentOnly
    ? Math.max(FROM_BLOCK, latest - RECENT_BLOCK_RANGE)
    : FROM_BLOCK;

  const pad = padTopicAddress(address);

  const [toLogs, fromLogs] = await Promise.all([
    getLogsWithFallback(fromBlock, latest, [TRANSFER_TOPIC, null, pad]),
    getLogsWithFallback(fromBlock, latest, [TRANSFER_TOPIC, pad, null]),
  ]);

  const candidates = new Set();
  for (const log of [...toLogs, ...fromLogs]) {
    const id = parseTokenId(log);
    if (id) candidates.add(id);
  }

  if (!candidates.size) {
    return { tokenIds: [], source: recentOnly ? "recent-empty" : "logs-empty", balance };
  }

  let tokenIds = await verifyOwners(address, [...candidates]);
  if (tokenIds.length < balance) {
    const have = new Set(tokenIds);
    const retry = [...candidates].filter((id) => !have.has(id));
    if (retry.length) {
      const extra = await verifyOwners(address, retry);
      tokenIds = [...new Set([...tokenIds, ...extra])].sort((a, b) => a - b);
    }
  }
  return {
    tokenIds,
    source: recentOnly ? "recent" : "logs",
    balance,
    candidates: candidates.size,
    verified: true,
  };
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
    const recentOnly = url.searchParams.get("recent") !== "0";
    const result = await findOwnedTokenIds(address, { recentOnly });
    return json(200, {
      ok: true,
      address,
      tokenIds: result.tokenIds,
      count: result.tokenIds.length,
      balance: result.balance ?? result.tokenIds.length,
      source: result.source,
      recent: recentOnly,
      verified: result.verified !== false,
    });
  } catch (err) {
    console.error("[wallet-tokens]", err);
    return json(502, { error: err.message || "Lookup failed" });
  }
};
