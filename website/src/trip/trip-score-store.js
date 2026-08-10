/**
 * Local Trip Score leaderboard for dev when Netlify function is unavailable.
 */
const STORAGE_KEY = "pixel-trip-scores-v1";

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(scores) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
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

export function localTripScoresGet(params) {
  const sort = params.sort || "score";
  const scores = loadAll();
  if (params.action === "health") {
    return { ok: true, storage: "local", mode: "dev", holderCount: Object.keys(scores).length };
  }
  if (params.action === "leaderboard") {
    return { ok: true, sort, leaderboard: sortRows(scores, sort), holderCount: Object.keys(scores).length };
  }
  throw new Error(`Unknown action: ${params.action}`);
}

export function localTripScoresPost(body) {
  const address = (body.address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    throw new Error("Invalid address");
  }
  const score = Number(body.score);
  if (!Number.isFinite(score) || score < 0) {
    throw new Error("Invalid score");
  }
  const stats = body.stats || {};
  const scores = loadAll();
  scores[address] = {
    holderName: String(body.holderName || "").trim().slice(0, 24),
    score,
    stats: {
      owned: Number(stats.owned) || 0,
      burned: Number(stats.burned) || 0,
      s1: Number(stats.s1) || 0,
      s2: Number(stats.s2) || 0,
      s3: Number(stats.s3) || 0,
      pairs: Number(stats.pairs) || 0,
    },
    rankId: body.rankId || "",
    rankTitle: body.rankTitle || "",
    updatedAt: new Date().toISOString(),
  };
  saveAll(scores);
  return {
    ok: true,
    address,
    entry: scores[address],
    leaderboard: sortRows(scores, "score"),
    mode: "local",
  };
}
