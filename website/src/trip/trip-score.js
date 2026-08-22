import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
} from "viem";
import { mainnet } from "viem/chains";
import {
  STAGE1_ADDRESS,
  EVOLVE_ADDRESS,
  STAGE1_ABI,
  EVOLVE_ABI,
  CHAR_ID_TO_NAME,
  SCAN_MAX_ID,
  RECEIPT_RPC_URL,
} from "../burn/config.js";
import { loadBurnProgram, getBurnableChars } from "../burn/burn-program.js";
import { initTripCard } from "./trip-card.js";
import {
  loadProfile,
  saveProfile,
  resolveHolderName,
  formatWalletLabel,
} from "./trip-profile.js";
import { initTripLeaderboard, submitTripScore } from "./trip-leaderboard.js";
import { multicallChunked, scanOwnedTokenIds } from "../shared/multicall-chunked.js";

const RANKS = [
  { id: "wanderer",  title: "Wanderer",  min: 0,   tagline: "First steps on the pixel road." },
  { id: "traveler",  title: "Traveler",  min: 100, tagline: "A growing trip — evolution within reach." },
  { id: "ascended",  title: "Ascended",  min: 280, tagline: "Multiple awakenings. The chain remembers." },
  { id: "legend",    title: "Legend",    min: 550, tagline: "Elite collector. Full trip mastery." },
];

const SCORE = {
  stage1: 15,
  stage2: 50,
  stage3: 130,
  uniqueChar: 8,
  uniqueCap: 64,
  evolvePair: 35,
  ascendedBonus: 25,
};

const DEMO = {
  address: "Demo · preview",
  tokens: [
    { tokenId: 732, character: "Camo_Soldier", stage: 0 },
    { tokenId: 515, character: "Hungry_Flytrap", stage: 3 },
    { tokenId: 1733, character: "Triple_Eye_Freak", stage: 2 },
    { tokenId: 88, character: "Camo_Soldier", stage: 0 },
    { tokenId: 607, character: "Clown_Hunter", stage: 3 },
    { tokenId: 1204, character: "Oracle", stage: 0 },
  ],
};

const els = {
  connect: document.getElementById("connect"),
  msg: document.getElementById("msg"),
  rankBadge: document.getElementById("rank-badge"),
  rankTitle: document.getElementById("rank-title"),
  rankTagline: document.getElementById("rank-tagline"),
  ringFill: document.getElementById("ring-fill"),
  scoreTotal: document.getElementById("score-total"),
  walletLabel: document.getElementById("wallet-label"),
  breakdown: document.getElementById("breakdown"),
  ladder: document.getElementById("ladder"),
  statOwned: document.getElementById("stat-owned"),
  statS1: document.getElementById("stat-s1"),
  statS2: document.getElementById("stat-s2"),
  statS3: document.getElementById("stat-s3"),
  statChars: document.getElementById("stat-chars"),
  statPairs: document.getElementById("stat-pairs"),
  tabScore: document.getElementById("trip-tab-score"),
  tabLeaderboard: document.getElementById("trip-tab-leaderboard"),
  scorePanel: document.getElementById("trip-score-panel"),
  leaderboardPanel: document.getElementById("trip-leaderboard-panel"),
  leaderboardList: document.getElementById("trip-leaderboard"),
  leaderboardStatus: document.getElementById("trip-leaderboard-status"),
};

let account = null;
let publicClient = null;
let readClient = null;
let walletTokens = DEMO.tokens;
let lastResult = null;
let tripCardUi = null;
let leaderboardUi = null;
let activeTab = "score";

function shortAddress(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function countEvolvePairs(tokens) {
  const burnable = getBurnableChars();
  const byKey = new Map();
  for (const t of tokens) {
    if (t.stage !== 0 && t.stage !== 2) continue;
    if (t.stage === 0 && !burnable.has(t.character)) continue;
    const key = `${t.stage}:${t.character}`;
    byKey.set(key, (byKey.get(key) || 0) + 1);
  }
  let pairs = 0;
  for (const n of byKey.values()) pairs += Math.floor(n / 2);
  return pairs;
}

export function computeTripScore(tokens) {
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  const chars = new Set();

  for (const t of tokens) {
    chars.add(t.character);
    if (t.stage === 0) s1++;
    else if (t.stage === 2) s2++;
    else if (t.stage === 3) s3++;
  }

  const stagePts =
    s1 * SCORE.stage1 + s2 * SCORE.stage2 + s3 * SCORE.stage3;
  const uniquePts = Math.min(chars.size * SCORE.uniqueChar, SCORE.uniqueCap);
  const pairs = countEvolvePairs(tokens);
  const pairPts = pairs * SCORE.evolvePair;
  const ascendedPts = s3 * SCORE.ascendedBonus;

  const total = stagePts + uniquePts + pairPts + ascendedPts;

  const breakdown = [
    { label: "Stage 1 trippers", pts: s1 * SCORE.stage1, detail: `${s1} × ${SCORE.stage1}` },
    { label: "Stage 2 awakened", pts: s2 * SCORE.stage2, detail: `${s2} × ${SCORE.stage2}` },
    { label: "Stage 3 ascended", pts: s3 * SCORE.stage3, detail: `${s3} × ${SCORE.stage3}` },
    { label: "Character diversity", pts: uniquePts, detail: `${chars.size} unique (cap ${SCORE.uniqueCap})` },
    { label: "Ready evolve pairs", pts: pairPts, detail: `${pairs} pair${pairs === 1 ? "" : "s"}` },
    { label: "Ascended mastery", pts: ascendedPts, detail: `${s3} × ${SCORE.ascendedBonus}` },
  ].filter((row) => row.pts > 0);

  const rank = [...RANKS].reverse().find((r) => total >= r.min) || RANKS[0];
  const next = RANKS[RANKS.indexOf(rank) + 1] || null;
  const progress = next
    ? (total - rank.min) / (next.min - rank.min)
    : 1;

  return {
    total,
    rank,
    next,
    progress: Math.min(1, Math.max(0, progress)),
    stats: { owned: tokens.length, s1, s2, s3, chars: chars.size, pairs, burned: s2 + 2 * s3 },
    breakdown,
  };
}

function renderLadder(activeId) {
  els.ladder.innerHTML = RANKS.map(
    (r) =>
      `<li class="trip-ladder-item${r.id === activeId ? " is-active" : ""}">
        <span class="trip-ladder-rank">${r.title}</span>
        <span class="trip-ladder-min">${r.min}+ pts</span>
      </li>`,
  ).join("");
}

function renderResult(result, walletText) {
  const { total, rank, next, progress, stats, breakdown } = result;

  els.rankBadge.textContent = rank.title.slice(0, 1);
  els.rankBadge.dataset.rank = rank.id;
  els.rankTitle.textContent = rank.title;
  els.rankTagline.textContent = next
    ? `${rank.tagline} · ${next.min - total} pts to ${next.title}`
    : rank.tagline;
  els.scoreTotal.textContent = String(total);
  els.walletLabel.textContent = walletText;

  const circumference = 2 * Math.PI * 52;
  els.ringFill.style.strokeDasharray = `${circumference}`;
  els.ringFill.style.strokeDashoffset = `${circumference * (1 - progress)}`;

  els.statOwned.textContent = stats.owned;
  els.statS1.textContent = stats.s1;
  els.statS2.textContent = stats.s2;
  els.statS3.textContent = stats.s3;
  els.statChars.textContent = stats.chars;
  els.statPairs.textContent = stats.pairs;

  els.breakdown.innerHTML = breakdown
    .map(
      (row) =>
        `<li><span class="trip-bd-label">${row.label}<small>${row.detail}</small></span><span class="trip-bd-pts">+${row.pts}</span></li>`,
    )
    .join("");

  renderLadder(rank.id);
  lastResult = result;
  tripCardUi?.refresh();
  leaderboardUi?.refresh();
}

function walletDisplayText(wallet) {
  if (!wallet?.startsWith("0x")) return DEMO.address;
  return formatWalletLabel(wallet, resolveHolderName(wallet), shortAddress);
}

async function applyWalletSession(address) {
  account = getAddress(address);
  const provider = window.ethereum || window.okxwallet;
  publicClient = createPublicClient({ chain: mainnet, transport: custom(provider) });
  readClient = createPublicClient({ chain: mainnet, transport: http(RECEIPT_RPC_URL) });

  saveProfile({ wallet: account, holderName: resolveHolderName(account) });
  els.connect.textContent = shortAddress(account);

  await loadBurnProgram();
  setMessage("Loading Trip Score…");
  const tokens = await fetchWalletTokens(account);
  walletTokens = tokens;
  const result = computeTripScore(tokens);
  renderResult(result, walletDisplayText(account));
  await submitTripScore({ wallet: account, result, holderName: resolveHolderName(account) });
  setMessage(
    tokens.length
      ? `${tokens.length} trippers · ${result.rank.title} · ${result.total} pts`
      : "No PIXEL TRIP tokens in this wallet.",
    tokens.length ? "success" : "info",
  );
}

async function fetchWalletTokens(address) {
  const client = readClient || publicClient;
  const maxId = SCAN_MAX_ID;

  setMessage(`Scanning 1…${maxId} for your trippers…`);
  const scan = await scanOwnedTokenIds(client, {
    owner: address,
    maxId,
    collectionAddress: STAGE1_ADDRESS,
    collectionAbi: STAGE1_ABI,
  });
  const owned = scan.tokenIds;

  if (!owned.length) return [];

  const evolveCalls = owned.flatMap((id) => [
    { address: EVOLVE_ADDRESS, abi: EVOLVE_ABI, functionName: "stage1Character", args: [BigInt(id)] },
    { address: EVOLVE_ADDRESS, abi: EVOLVE_ABI, functionName: "evolvedStage", args: [BigInt(id)] },
  ]);
  const evo = await multicallChunked(client, evolveCalls);

  return owned.map((tokenId, i) => {
    const charR = evo[i * 2];
    const stageR = evo[i * 2 + 1];
    const charId = charR?.status === "success" ? Number(charR.result) : 0;
    const stage = stageR?.status === "success" ? Number(stageR.result) : 0;
    return {
      tokenId,
      charId,
      character: CHAR_ID_TO_NAME[charId] || `Unknown #${charId}`,
      stage,
    };
  });
}

function setMessage(text, kind = "info") {
  els.msg.textContent = text;
  els.msg.dataset.kind = kind;
}

function showDemo() {
  walletTokens = DEMO.tokens;
  account = null;
  const result = computeTripScore(DEMO.tokens);
  renderResult(result, DEMO.address);
  setMessage("Demo profile — connect wallet for your real Trip Score.");
}

async function connectWallet() {
  const provider = window.ethereum || window.okxwallet;
  if (!provider) {
    setMessage("No Web3 wallet found.", "error");
    return;
  }

  try {
    const walletClient = createWalletClient({ chain: mainnet, transport: custom(provider) });
    const [address] = await walletClient.requestAddresses();
    await applyWalletSession(address);
  } catch (err) {
    console.error(err);
    setMessage(err.shortMessage || err.message || "Connection failed.", "error");
  }
}

async function tryAutoConnect() {
  const provider = window.ethereum || window.okxwallet;
  if (!provider) return;
  try {
    const accounts = await provider.request({ method: "eth_accounts" });
    if (accounts?.[0]) {
      await applyWalletSession(accounts[0]);
      return;
    }
    const saved = loadProfile()?.wallet;
    if (saved) {
      els.connect.textContent = shortAddress(saved);
      setMessage("Wallet remembered — click Connect to restore your Trip Score.");
    }
  } catch {
    /* silent */
  }
}

function setActiveTab(tab) {
  activeTab = tab;
  const isScore = tab === "score";
  els.tabScore?.classList.toggle("is-active", isScore);
  els.tabLeaderboard?.classList.toggle("is-active", !isScore);
  els.tabScore?.setAttribute("aria-selected", String(isScore));
  els.tabLeaderboard?.setAttribute("aria-selected", String(!isScore));
  els.scorePanel?.toggleAttribute("hidden", !isScore);
  els.leaderboardPanel?.toggleAttribute("hidden", isScore);
  if (!isScore) leaderboardUi?.refresh();
}

function initTabs() {
  els.tabScore?.addEventListener("click", () => setActiveTab("score"));
  els.tabLeaderboard?.addEventListener("click", () => setActiveTab("leaderboard"));
  setActiveTab("score");
}

function init() {
  renderLadder("");
  initTabs();
  leaderboardUi = initTripLeaderboard(
    {
      list: els.leaderboardList,
      status: els.leaderboardStatus,
      sortButtons: document.querySelectorAll(".trip-sort-btn"),
    },
    { getAccount: () => account },
  );
  tripCardUi = initTripCard(document.getElementById("trip-card-root"), () => ({
    tokens: walletTokens,
    result: lastResult || computeTripScore(walletTokens),
    wallet: account || DEMO.address,
    isDemo: !account,
    onProfileChange: (name) => {
      if (!account) return;
      saveProfile({ wallet: account, holderName: name });
      renderResult(lastResult || computeTripScore(walletTokens), walletDisplayText(account));
      void submitTripScore({
        wallet: account,
        result: lastResult || computeTripScore(walletTokens),
        holderName: name,
      });
    },
  }));
  showDemo();
  els.connect.addEventListener("click", connectWallet);
  void tryAutoConnect();
}

init();
