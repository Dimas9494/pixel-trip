/**
 * Netlify Function: votes
 * GET  /.netlify/functions/votes?action=leaderboard|mine|eligible|health
 * POST /.netlify/functions/votes  { address, character }
 *
 * Proxies to vote-api.php when VOTE_API_URL is set, else uses Netlify Blobs.
 */

import STAGE2_VARIANTS from "../../src/burn/stage2-variants.json" with { type: "json" };

const BURNABLE_CHARS = new Set(Object.keys(STAGE2_VARIANTS));

const VOTE_API_URL = (process.env.VOTE_API_URL || "").replace(/\/$/, "");
const STAGE1 = "0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9";
const VOTE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
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

function voteWeight(balance) {
  if (balance <= 0) return 0;
  if (balance <= 10) return 1;
  if (balance <= 15) return 2;
  return 3;
}

function normalizeAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address || "") ? address.toLowerCase() : null;
}

function normalizeCharacter(character) {
  return /^[A-Za-z_]+$/.test(character || "") ? character : null;
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
    return getStore("pixel-trip-votes");
  } catch {
    return null;
  }
}

async function loadVotes(store) {
  if (!store) return {};
  const raw = await store.get("votes", { type: "text" });
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveVotes(store, votes) {
  if (!store) throw new Error("Vote storage unavailable");
  await store.set("votes", JSON.stringify(votes));
}

function voteTimestamp(row) {
  if (!row?.updated) return 0;
  const ts = Date.parse(row.updated);
  return Number.isFinite(ts) ? ts : 0;
}

function isVoteStale(row) {
  return Boolean(row?.character && BURNABLE_CHARS.has(row.character));
}

function isVoteActive(row) {
  if (isVoteStale(row)) return false;
  const ts = voteTimestamp(row);
  return ts > 0 && Date.now() - ts < VOTE_COOLDOWN_MS;
}

function voteStatus(row) {
  if (!row || !isVoteActive(row)) {
    return { active: false, canVote: true, nextVoteAt: null };
  }
  const ts = voteTimestamp(row);
  return {
    active: true,
    canVote: false,
    nextVoteAt: new Date(ts + VOTE_COOLDOWN_MS).toISOString(),
  };
}

function buildLeaderboard(votes) {
  const totals = {};
  let voterCount = 0;
  for (const row of Object.values(votes)) {
    if (!isVoteActive(row)) continue;
    const char = row.character;
    const weight = Number(row.weight) || 0;
    if (!char || weight <= 0) continue;
    if (BURNABLE_CHARS.has(char)) continue;
    voterCount++;
    totals[char] = (totals[char] || 0) + weight;
  }
  const leaderboard = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([character, points]) => ({ character, points }));
  return { leaderboard, voterCount };
}

/** Minimal eligible list baked for Netlify-only preview (full list from vote-api.php on FTP). */
const NETLIFY_ELIGIBLE_FALLBACK = [];

async function proxyToPhp(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  return new Response(text, { status: res.status, headers: cors });
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";

  if (VOTE_API_URL) {
    const target = action
      ? `${VOTE_API_URL}?${url.searchParams.toString()}`
      : VOTE_API_URL;
    if (req.method === "GET") {
      return proxyToPhp(target, { method: "GET" });
    }
    const body = await req.text();
    return proxyToPhp(VOTE_API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  }

  const store = await getBlobStore();

  if (req.method === "GET") {
    if (action === "health") {
      return json(200, {
        ok: true,
        storage: store ? "blobs" : "none",
        weightTiers: { "1-10": 1, "11-15": 2, "16+": 3 },
        cooldownDays: 7,
      });
    }
    if (action === "eligible") {
      return json(200, { characters: NETLIFY_ELIGIBLE_FALLBACK, note: "Set VOTE_API_URL or upload vote-api.php for full list" });
    }
    const votes = await loadVotes(store);
    if (action === "leaderboard") {
      return json(200, { ok: true, ...buildLeaderboard(votes) });
    }
    if (action === "mine") {
      const address = normalizeAddress(url.searchParams.get("address"));
      if (!address) return json(400, { error: "Invalid address" });
      let mine = votes[address] || null;
      if (mine && (isVoteStale(mine) || !isVoteActive(mine))) mine = null;
      return json(200, { ok: true, vote: mine, ...voteStatus(mine) });
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
  const character = normalizeCharacter(body.character);
  if (!address || !character) {
    return json(400, { error: "address and character required" });
  }

  const balance = await readBalance(address);
  const weight = voteWeight(balance);
  if (weight <= 0) {
    return json(403, { error: "Wallet must hold at least 1 PIXEL TRIP NFT", balance });
  }

  if (!store) {
    return json(503, { error: "Vote storage not configured. Upload vote-api.php or enable Netlify Blobs." });
  }

  const votes = await loadVotes(store);
  const existing = votes[address];
  const status = voteStatus(existing);
  if (!status.canVote) {
    return json(429, {
      error: "You already voted this week. Votes cannot be changed or cancelled.",
      nextVoteAt: status.nextVoteAt,
      vote: existing,
    });
  }

  const updated = new Date().toISOString();
  votes[address] = { character, weight, balance, updated };
  await saveVotes(store, votes);

  const vote = votes[address];
  return json(200, {
    ok: true,
    address,
    character,
    weight,
    balance,
    vote,
    canVote: false,
    nextVoteAt: new Date(voteTimestamp(vote) + VOTE_COOLDOWN_MS).toISOString(),
    leaderboard: buildLeaderboard(votes).leaderboard,
  });
};
