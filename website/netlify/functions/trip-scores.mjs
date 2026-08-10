/**
 * Netlify Function: trip-scores
 * GET  /.netlify/functions/trip-scores?action=leaderboard&sort=score|owned|burned
 * POST /.netlify/functions/trip-scores  { address, holderName?, score, rankId, rankTitle, stats }
 */

const STAGE1 = "0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9";
const RPC_URL = process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function normalizeAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address || "") ? address.toLowerCase() : null;
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .slice(0, 24)
    .replace(/[<>"']/g, "");
}

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const data = await res.json();
  return data.result;
}

async function readBalance(address) {
  const data = "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0");
  const hex = await rpcCall("eth_call", [{ to: STAGE1, data }, "latest"]);
  if (!hex || hex === "0x") return 0;
  return Number(BigInt(hex));
}

async function getBlobStore() {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore("pixel-trip-scores");
  } catch {
    return null;
  }
}

async function loadScores(store) {
  if (!store) return {};
  const raw = await store.get("scores", { type: "text" });
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveScores(store, scores) {
  if (!store) throw new Error("Score storage unavailable");
  await store.set("scores", JSON.stringify(scores));
}

function sortRows(scores, sort) {
  const key = sort === "owned" || sort === "burned" ? sort : "score";
  return Object.entries(scores)
    .map(([address, row]) => ({
      address,
      holderName: row.holderName || "",
      score: Number(row.score) || 0,
      owned: Number(row.stats?.owned ?? row.owned) || 0,
      burned: Number(row.stats?.burned ?? row.burned) || 0,
      rankId: row.rankId || "",
      rankTitle: row.rankTitle || "",
      updatedAt: row.updatedAt || "",
    }))
    .sort((a, b) => b[key] - a[key] || b.score - a.score || a.address.localeCompare(b.address));
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const store = await getBlobStore();
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const sort = url.searchParams.get("sort") || "score";

  if (req.method === "GET") {
    if (action === "health") {
      const scores = await loadScores(store);
      return json(200, {
        ok: true,
        storage: store ? "blobs" : "none",
        holderCount: Object.keys(scores).length,
      });
    }
    if (action === "leaderboard") {
      const scores = await loadScores(store);
      const leaderboard = sortRows(scores, sort);
      return json(200, { ok: true, sort, leaderboard, holderCount: leaderboard.length });
    }
    return json(400, { error: "Unknown action" });
  }

  if (req.method !== "POST") {
    return json(405, { error: "GET or POST only" });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const address = normalizeAddress(body.address);
  const score = Number(body.score);
  if (!address) return json(400, { error: "Invalid address" });
  if (!Number.isFinite(score) || score < 0) return json(400, { error: "Invalid score" });

  const balance = await readBalance(address);
  if (balance <= 0) {
    return json(403, { error: "Wallet must hold at least 1 PIXEL TRIP NFT", balance });
  }

  if (!store) {
    return json(503, { error: "Score storage not configured. Enable Netlify Blobs." });
  }

  const stats = body.stats || {};
  const scores = await loadScores(store);
  scores[address] = {
    holderName: normalizeName(body.holderName),
    score,
    stats: {
      owned: Number(stats.owned) || 0,
      burned: Number(stats.burned) || 0,
      s1: Number(stats.s1) || 0,
      s2: Number(stats.s2) || 0,
      s3: Number(stats.s3) || 0,
      pairs: Number(stats.pairs) || 0,
    },
    rankId: String(body.rankId || ""),
    rankTitle: String(body.rankTitle || ""),
    updatedAt: new Date().toISOString(),
  };
  await saveScores(store, scores);

  return json(200, {
    ok: true,
    address,
    entry: scores[address],
    leaderboard: sortRows(scores, "score"),
  });
};
