/**
 * Local vote store for dev / when vote-api.php is not deployed yet.
 * Same shape as vote-api.php responses.
 */
import { getBurnableChars } from "../burn/burn-program.js";
import { VOTE_COOLDOWN_MS, voteWeight } from "./config.js";

function isReleased(char) {
  return getBurnableChars().has(char);
}

const STORAGE_KEY = "pixel-trip-votes-v1";

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(votes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(votes));
}

function voteTimestamp(row) {
  if (!row?.updated) return 0;
  const ts = Date.parse(row.updated);
  return Number.isFinite(ts) ? ts : 0;
}

function isVoteActive(row) {
  const ts = voteTimestamp(row);
  return ts > 0 && Date.now() - ts < VOTE_COOLDOWN_MS;
}

function voteStatus(row) {
  if (!row || !isVoteActive(row)) {
    return { active: false, canVote: true, nextVoteAt: null };
  }
  if (isReleased(row.character)) {
    return { active: false, canVote: true, nextVoteAt: null, released: true };
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
    if (isReleased(char)) continue;
    const weight = Number(row.weight) || 0;
    if (!char || weight <= 0) continue;
    voterCount++;
    totals[char] = (totals[char] || 0) + weight;
  }
  const leaderboard = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([character, points]) => ({ character, points }));
  return { leaderboard, voterCount };
}

export function localVoteGet(params) {
  const action = params.action;
  const votes = loadAll();

  if (action === "health") {
    return { ok: true, storage: "local", mode: "dev" };
  }
  if (action === "leaderboard") {
    return { ok: true, ...buildLeaderboard(votes) };
  }
  if (action === "mine") {
    const address = (params.address || "").toLowerCase();
    let mine = votes[address] || null;
    if (mine && !isVoteActive(mine)) mine = null;
    if (mine && isReleased(mine.character)) mine = null;
    return { ok: true, vote: mine, ...voteStatus(votes[address] || null) };
  }
  throw new Error(`Unknown action: ${action}`);
}

export function localVotePost(body, balance) {
  const address = (body.address || "").toLowerCase();
  const character = body.character;
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    throw new Error("Invalid address");
  }
  if (!/^[A-Za-z_]+$/.test(character)) {
    throw new Error("Invalid character");
  }

  const weight = voteWeight(balance);
  if (weight <= 0) {
    throw new Error("Wallet must hold at least 1 PIXEL TRIP NFT to vote");
  }

  const votes = loadAll();
  const existing = votes[address];
  const status = voteStatus(existing);
  if (!status.canVote) {
    throw new Error("You already voted this week. Votes cannot be changed or cancelled.");
  }

  const updated = new Date().toISOString();
  votes[address] = { character, weight, balance, updated };
  saveAll(votes);

  const vote = votes[address];
  return {
    ok: true,
    address,
    character,
    weight,
    balance,
    vote,
    canVote: false,
    nextVoteAt: new Date(voteTimestamp(vote) + VOTE_COOLDOWN_MS).toISOString(),
    leaderboard: buildLeaderboard(votes).leaderboard,
    mode: "local",
  };
}

export function mergeLeaderboard(current, character, weight, serverBoard) {
  if (Array.isArray(serverBoard) && serverBoard.length) {
    return serverBoard;
  }
  if (!character || !weight) {
    return current;
  }
  const next = [...current];
  const row = next.find((r) => r.character === character);
  if (row) {
    row.points += weight;
  } else {
    next.push({ character, points: weight });
  }
  next.sort((a, b) => b.points - a.points);
  return next;
}

/** Apply POST response or merge a single vote into the current board. */
export function leaderboardFromVoteResponse(current, data) {
  const character = data?.character || data?.vote?.character;
  const weight = data?.weight ?? data?.vote?.weight;
  if (Array.isArray(data?.leaderboard)) {
    return mergeLeaderboard(current, character, weight, data.leaderboard);
  }
  return mergeLeaderboard(current, character, weight, null);
}
