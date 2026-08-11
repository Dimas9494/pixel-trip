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
  STAGE1_ABI,
  RECEIPT_RPC_URL,
  VOTE_API_URL,
  VOTE_BUILD,
  VOTE_PAGE_ENABLED,
  CHARACTER_IMAGES,
  computeVoteEligible,
  voteWeight,
  voteWeightLabel,
  formatCharacter,
  isVoteLocked,
  formatNextVote,
} from "./config.js";
import { loadBurnProgram, getBurnableChars } from "../burn/burn-program.js";
import { localVoteGet, localVotePost, leaderboardFromVoteResponse } from "./vote-store.js";

const els = {
  connect:     document.getElementById("vote-connect"),
  network:     document.getElementById("vote-network"),
  message:     document.getElementById("vote-message"),
  stats:       document.getElementById("vote-stats"),
  holder:      document.getElementById("vote-holder"),
  search:      document.getElementById("vote-search"),
  grid:        document.getElementById("vote-grid"),
  submit:      document.getElementById("vote-submit"),
  selected:    document.getElementById("vote-selected"),
  leaderboard: document.getElementById("vote-leaderboard"),
  banner:      document.getElementById("vote-local-banner"),
};

let walletClient = null;
let readClient = null;
let account = null;
let balance = 0;
let selectedCharacter = null;
let myVote = null;
let canVote = true;
let nextVoteAt = null;
let voteLocked = false;
let leaderboard = [];
/** Characters still awaiting Stage 2 (recomputed after live catalog load). */
let voteEligible = computeVoteEligible(getBurnableChars());
const voteEligibleSet = () => new Set(voteEligible);

/** Remote vote-api unavailable — persist in localStorage for testing. */
let useLocalStore = false;

function filterLeaderboard(rows) {
  const burnable = getBurnableChars();
  return rows.filter((row) => row.character && !burnable.has(row.character));
}

function setMessage(text, type = "info") {
  if (!els.message) return;
  els.message.textContent = text;
  els.message.dataset.type = type;
}

function showLocalBanner(on) {
  if (!els.banner) return;
  els.banner.hidden = !on;
}

function shortAddress(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function getProvider() {
  return window.ethereum || window.okxwallet || null;
}

async function ensureMainnet() {
  const chainId = await walletClient.request({ method: "eth_chainId" });
  if (chainId !== "0x1") {
    await walletClient.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }],
    });
  }
}

async function remoteGet(params) {
  const url = `${VOTE_API_URL}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function remotePost(body) {
  const res = await fetch(VOTE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiGet(params) {
  if (useLocalStore) return localVoteGet(params);
  try {
    return await remoteGet(params);
  } catch (err) {
    console.warn("[vote] remote GET failed:", err.message);
    useLocalStore = true;
    showLocalBanner(true);
    return localVoteGet(params);
  }
}

async function apiPost(body) {
  if (useLocalStore) {
    return localVotePost(body, balance);
  }
  try {
    return await remotePost(body);
  } catch (err) {
    if (err.message.includes("404") || err.message.includes("503")) {
      console.warn("[vote] remote POST unavailable, using local store");
      useLocalStore = true;
      showLocalBanner(true);
      return localVotePost(body, balance);
    }
    throw err;
  }
}

async function probeApi() {
  try {
    const data = await remoteGet({ action: "health" });
    if (data.storage === "none" || data.mode === "local") {
      useLocalStore = true;
      showLocalBanner(true);
    } else {
      useLocalStore = false;
      showLocalBanner(false);
    }
  } catch {
    useLocalStore = true;
    showLocalBanner(true);
  }
}

function applyLeaderboard(data) {
  leaderboard = filterLeaderboard(leaderboardFromVoteResponse(leaderboard, data));
  renderLeaderboard();
  updateStats();
}

async function readHolderBalance() {
  return readClient.readContract({
    address: STAGE1_ADDRESS,
    abi: STAGE1_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

function isReleasedVote(vote) {
  return !!(vote?.character && getBurnableChars().has(vote.character));
}

function reconcileReleasedVote() {
  if (!myVote?.character || !isReleasedVote(myVote)) return false;
  myVote = null;
  canVote = true;
  nextVoteAt = null;
  voteLocked = false;
  selectedCharacter = null;
  return true;
}

function syncVoteStateFromApi(data) {
  if (data.released || (data.vote?.character && getBurnableChars().has(data.vote.character))) {
    myVote = null;
    canVote = true;
    nextVoteAt = null;
    voteLocked = false;
    return;
  }
  myVote = data.vote || null;
  canVote = data.canVote !== false;
  nextVoteAt = data.nextVoteAt || null;
  voteLocked = myVote ? isVoteLocked(myVote, getBurnableChars()) : false;
  if (reconcileReleasedVote()) return;
  if (voteLocked && myVote?.character) {
    selectedCharacter = myVote.character;
  }
}

function updateHolderPanel() {
  if (!els.holder) return;
  if (!account) {
    els.holder.hidden = true;
    return;
  }
  els.holder.hidden = false;
  const weight = voteWeight(balance);
  let lockLine = "";
  if (voteLocked && myVote) {
    lockLine = `<p class="vote-note">You voted for <strong>${formatCharacter(myVote.character)}</strong> this week (${myVote.weight} pt). Votes are final until ${formatNextVote(myVote) || nextVoteAt || "next week"}.</p>`;
  } else if (canVote && weight > 0) {
    lockLine = `<p class="vote-note vote-note-ok">You can cast one vote this week. It cannot be changed or cancelled.</p>`;
  }
  els.holder.innerHTML = `
    <p><strong>${shortAddress(account)}</strong></p>
    <p>You hold <strong>${balance}</strong> PIXEL TRIP NFT${balance === 1 ? "" : "s"}.</p>
    <p>Your vote weight: <strong>${voteWeightLabel(balance)}</strong></p>
    ${lockLine}
    ${weight <= 0 ? `<p class="vote-note">You need at least 1 NFT in this wallet to vote.</p>` : ""}
  `;
}

function updateSelectedLabel() {
  if (!els.selected) return;
  if (voteLocked && myVote?.character) {
    els.selected.textContent = formatCharacter(myVote.character);
    return;
  }
  if (!selectedCharacter) {
    els.selected.textContent = "Pick a character below";
    return;
  }
  els.selected.textContent = formatCharacter(selectedCharacter);
}

function updateSubmitButton() {
  if (!els.submit) return;
  const weight = voteWeight(balance);
  const ready = account && weight > 0 && selectedCharacter && canVote && !voteLocked;
  els.submit.disabled = !ready;
  els.submit.hidden = voteLocked;
  els.submit.textContent = "Submit vote (final)";
}

function renderLeaderboard() {
  if (!els.leaderboard) return;
  const rows = filterLeaderboard(leaderboard);
  if (!rows.length) {
    els.leaderboard.innerHTML = `<li class="vote-leader-empty">No votes this week yet.</li>`;
    return;
  }
  els.leaderboard.innerHTML = rows.slice(0, 20).map((row, i) => {
    const img = CHARACTER_IMAGES[row.character];
    return `
    <li class="vote-leader-row${selectedCharacter === row.character ? " is-selected" : ""}">
      <span class="vote-leader-rank">#${i + 1}</span>
      ${img ? `<img class="vote-leader-thumb" src="${img}" alt="" width="32" height="32" loading="lazy" />` : ""}
      <span class="vote-leader-name">${formatCharacter(row.character)}</span>
      <span class="vote-leader-points">${row.points} pt</span>
    </li>`;
  }).join("");
}

function renderGrid(filter = "") {
  if (!els.grid) return;
  const q = filter.trim().toLowerCase();
  const list = voteEligible.filter((name) => {
    if (!q) return true;
    return name.toLowerCase().includes(q) || formatCharacter(name).toLowerCase().includes(q);
  });

  const locked = voteLocked;

  els.grid.innerHTML = list.map((name) => {
    const selected = selectedCharacter === name;
    const mine = voteLocked && myVote?.character === name;
    const img = CHARACTER_IMAGES[name];
    return `
      <button type="button" class="vote-char${selected ? " is-selected" : ""}${mine ? " is-mine" : ""}${locked ? " is-locked" : ""}" data-char="${name}" ${locked ? "disabled" : ""}>
        ${img ? `<img src="${img}" alt="" width="72" height="72" loading="lazy" />` : ""}
        <span class="vote-char-name">${formatCharacter(name)}</span>
        ${mine ? `<span class="vote-char-tag">Your vote</span>` : ""}
      </button>
    `;
  }).join("");

  if (!list.length) {
    els.grid.innerHTML = `<p class="vote-empty">No characters match “${filter}”.</p>`;
  }

  if (els.search) els.search.disabled = locked;
}

async function loadLeaderboard({ replaceEmpty = true } = {}) {
  try {
    const data = await apiGet({ action: "leaderboard" });
    const remote = filterLeaderboard(data.leaderboard || []);
    if (remote.length) {
      leaderboard = remote;
    } else if (replaceEmpty && !leaderboard.length) {
      leaderboard = remote;
    } else if (useLocalStore) {
      const local = localVoteGet({ action: "leaderboard" });
      if (local.leaderboard?.length) {
        leaderboard = filterLeaderboard(local.leaderboard);
      }
    }
    renderLeaderboard();
    updateStats();
  } catch (err) {
    console.warn("[vote] leaderboard:", err.message);
    if (useLocalStore) {
      try {
        const local = localVoteGet({ action: "leaderboard" });
        if (local.leaderboard?.length) {
          leaderboard = filterLeaderboard(local.leaderboard);
          renderLeaderboard();
          updateStats();
        }
      } catch {
        /* ignore */
      }
    }
  }
}

async function loadMyVote() {
  if (!account) {
    myVote = null;
    canVote = true;
    voteLocked = false;
    return;
  }
  try {
    const data = await apiGet({ action: "mine", address: account });
    syncVoteStateFromApi(data);
  } catch (err) {
    console.warn("[vote] mine:", err.message);
    myVote = null;
    canVote = true;
    voteLocked = false;
  }
}

function updateStats() {
  if (!els.stats) return;
  els.stats.textContent = [
    `${voteEligible.length} awaiting Stage 2`,
    filterLeaderboard(leaderboard).length ? `${filterLeaderboard(leaderboard).length} on leaderboard` : null,
    useLocalStore ? "local test store" : null,
    `weekly · build ${VOTE_BUILD}`,
  ].filter(Boolean).join(" · ");
}

async function connectWallet() {
  const provider = getProvider();
  if (!provider) {
    setMessage("No Web3 wallet found. Install MetaMask, OKX Wallet or any EVM wallet.", "error");
    return;
  }

  try {
    setMessage("Connecting wallet…", "pending");
    const probe = createWalletClient({ chain: mainnet, transport: custom(provider) });
    const [address] = await probe.requestAddresses();
    account = getAddress(address);

    readClient = createPublicClient({ chain: mainnet, transport: http(RECEIPT_RPC_URL) });
    walletClient = createWalletClient({ account, chain: mainnet, transport: custom(provider) });
    await ensureMainnet();

    els.connect.textContent = shortAddress(account);
    els.network.textContent = "Ethereum Mainnet";

    balance = Number(await readHolderBalance());
    await loadMyVote();
    reconcileReleasedVote();
    updateHolderPanel();
    updateSelectedLabel();
    updateSubmitButton();
    renderGrid(els.search?.value || "");
    renderLeaderboard();

    if (balance <= 0) {
      setMessage("This wallet holds no PIXEL TRIP NFTs — voting requires at least 1.", "error");
    } else if (voteLocked) {
      setMessage(`You already voted this week for ${formatCharacter(myVote.character)}. Next vote after ${formatNextVote(myVote) || "7 days"}.`, "info");
    } else {
      setMessage(`Connected. Your vote counts as ${voteWeightLabel(balance)}. One vote per week — final, no cancel.`, "success");
    }
  } catch (err) {
    console.error(err);
    setMessage(err.shortMessage || err.message || "Connection failed.", "error");
  }
}

async function submitVote() {
  if (!account || !selectedCharacter || voteLocked || !canVote) return;
  if (voteWeight(balance) <= 0) {
    setMessage("You need at least 1 PIXEL TRIP NFT to vote.", "error");
    return;
  }

  if (!window.confirm(`Vote for ${formatCharacter(selectedCharacter)}? This cannot be changed or cancelled until next week.`)) {
    return;
  }

  els.submit.disabled = true;
  setMessage(`Submitting vote for ${formatCharacter(selectedCharacter)}…`, "pending");

  try {
    const data = await apiPost({ address: account, character: selectedCharacter });
    syncVoteStateFromApi({
      vote: data.vote || {
        character: data.character,
        weight: data.weight,
        balance: data.balance,
        updated: new Date().toISOString(),
      },
      canVote: false,
      nextVoteAt: data.nextVoteAt,
    });
    applyLeaderboard(data);
    updateHolderPanel();
    renderGrid(els.search?.value || "");
    updateSubmitButton();
    const modeNote = useLocalStore ? " (saved locally for testing)" : "";
    setMessage(`Vote locked — ${formatCharacter(selectedCharacter)} (+${data.weight} points)${modeNote}.`, "success");
    void loadLeaderboard({ replaceEmpty: false });
  } catch (err) {
    setMessage(err.message || "Vote failed.", "error");
    updateSubmitButton();
  }
}

function bindEvents() {
  els.connect?.addEventListener("click", connectWallet);
  els.submit?.addEventListener("click", submitVote);
  els.search?.addEventListener("input", (e) => renderGrid(e.target.value));
  els.grid?.addEventListener("click", (e) => {
    if (voteLocked) return;
    const btn = e.target.closest("[data-char]");
    if (!btn || btn.disabled) return;
    selectedCharacter = btn.dataset.char;
    updateSelectedLabel();
    updateSubmitButton();
    renderGrid(els.search?.value || "");
    renderLeaderboard();
  });
}

async function init() {
  if (!VOTE_PAGE_ENABLED) {
    setMessage("Voting is temporarily disabled.", "error");
    return;
  }

  await loadBurnProgram();
  voteEligible = computeVoteEligible(getBurnableChars());
  leaderboard = filterLeaderboard(leaderboard);

  bindEvents();
  await probeApi();
  updateSelectedLabel();
  updateSubmitButton();
  renderGrid();
  updateStats();
  await loadLeaderboard();

  setMessage(
    useLocalStore
      ? "Test mode — vote-api not reachable; votes save in this browser only."
      : "Preview — connect wallet to vote. One vote per week; 1/1 characters excluded.",
    "info",
  );
}

init();
