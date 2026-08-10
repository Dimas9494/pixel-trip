import { localTripScoresGet, localTripScoresPost } from "./trip-score-store.js";
import { resolveHolderName } from "./trip-profile.js";

export const TRIP_SCORES_API =
  import.meta.env.VITE_TRIP_SCORES_API_URL || "/.netlify/functions/trip-scores";

const SORT_LABELS = {
  score: "Trip Score",
  owned: "Trippers",
  burned: "Burns",
};

let useLocalStore = false;
let currentSort = "score";
let rows = [];
let getAccount = () => null;

function shortAddress(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function displayName(row) {
  return row.holderName?.trim() || shortAddress(row.address);
}

async function remoteGet(params) {
  const url = `${TRIP_SCORES_API}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function remotePost(body) {
  const res = await fetch(TRIP_SCORES_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiGet(params) {
  if (useLocalStore) return localTripScoresGet(params);
  try {
    return await remoteGet(params);
  } catch (err) {
    console.warn("[trip-scores] remote GET failed:", err.message);
    useLocalStore = true;
    return localTripScoresGet(params);
  }
}

async function apiPost(body) {
  if (useLocalStore) return localTripScoresPost(body);
  try {
    return await remotePost(body);
  } catch (err) {
    console.warn("[trip-scores] remote POST failed:", err.message);
    useLocalStore = true;
    return localTripScoresPost(body);
  }
}

function metricValue(row, sort) {
  if (sort === "owned") return row.owned;
  if (sort === "burned") return row.burned;
  return row.score;
}

function metricSuffix(sort) {
  if (sort === "owned") return "";
  if (sort === "burned") return "";
  return " pts";
}

function renderList(listEl, statusEl) {
  if (!listEl) return;
  if (!rows.length) {
    listEl.innerHTML = `<li class="trip-leader-empty">No holders on the board yet — connect wallet to appear.</li>`;
    if (statusEl) statusEl.textContent = `Sorted by ${SORT_LABELS[currentSort]}.`;
    return;
  }

  const account = getAccount()?.toLowerCase();
  listEl.innerHTML = rows.slice(0, 50).map((row, i) => {
    const mine = account && row.address.toLowerCase() === account;
    const metric = metricValue(row, currentSort);
    return `
      <li class="trip-leader-row${mine ? " is-mine" : ""}">
        <span class="trip-leader-rank">#${i + 1}</span>
        <div class="trip-leader-meta">
          <strong class="trip-leader-name">${displayName(row)}</strong>
          <small class="trip-leader-rank-title">${row.rankTitle || "—"}${mine ? " · you" : ""}</small>
        </div>
        <span class="trip-leader-metric">${metric}${metricSuffix(currentSort)}</span>
      </li>`;
  }).join("");

  if (statusEl) {
    statusEl.textContent = `${rows.length} holder${rows.length === 1 ? "" : "s"} · sorted by ${SORT_LABELS[currentSort]}`;
  }
}

export async function loadTripLeaderboard(listEl, statusEl) {
  try {
    const data = await apiGet({ action: "leaderboard", sort: currentSort });
    rows = data.leaderboard || [];
    renderList(listEl, statusEl);
  } catch (err) {
    console.error(err);
    if (listEl) {
      listEl.innerHTML = `<li class="trip-leader-empty">Could not load leaderboard.</li>`;
    }
    if (statusEl) statusEl.textContent = err.message || "Load failed.";
  }
}

export async function submitTripScore({ wallet, result, holderName }) {
  if (!wallet?.startsWith("0x")) return;
  const name = holderName || resolveHolderName(wallet);
  try {
    await apiPost({
      address: wallet,
      holderName: name,
      score: result.total,
      rankId: result.rank.id,
      rankTitle: result.rank.title,
      stats: result.stats,
    });
  } catch (err) {
    console.warn("[trip-scores] submit failed:", err.message);
  }
}

export function initTripLeaderboard(els, options) {
  getAccount = options.getAccount || (() => null);

  els.sortButtons?.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentSort = btn.dataset.sort || "score";
      els.sortButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
      void loadTripLeaderboard(els.list, els.status);
    });
  });

  void loadTripLeaderboard(els.list, els.status);

  return {
    refresh: () => loadTripLeaderboard(els.list, els.status),
    setSort: (sort) => {
      currentSort = sort;
      els.sortButtons?.forEach((b) => b.classList.toggle("is-active", b.dataset.sort === sort));
    },
  };
}
