import { getBurnableChars } from "../burn/burn-program.js";
import {
  voteWeight,
  formatCharacter,
} from "./config.js";
import {
  computeStage3VoteCharacters,
  voteableStage2Variants,
  stage2ImageUrl,
  stage2VariantsFor,
  hasStage3Art,
  isStage3ArtCompleteForCharacter,
  characterVoteProgress,
  characterStage3ArtProgress,
  isCharacterVoteClosed,
  isStage3VoteRowActive,
  activeStage3VotesByCharacter,
  migrateStage3WalletVotes,
  CHARACTER_SAMPLES,
} from "./vote-stage3-config.js";
import { IMAGE_STAGE1 } from "../burn/config.js";

const STORAGE_KEY = "pixel-trip-votes-stage3-v2";

function loadLocalVotes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLocalVotes(votes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(votes));
}

function buildLocalLeaderboard(votes) {
  const totals = new Map();
  let voterCount = 0;
  for (const wallet of Object.values(votes)) {
    const byChar = activeStage3VotesByCharacter(wallet);
    for (const [baseCharacter, row] of Object.entries(byChar)) {
      if (!isStage3VoteRowActive(row)) continue;
      const key = `${baseCharacter}\0${row.s2Slug}`;
      const w = Number(row.weight) || 0;
      if (!row.s2Slug || w <= 0) continue;
      voterCount++;
      totals.set(key, (totals.get(key) || 0) + w);
    }
  }
  const leaderboard = [...totals.entries()]
    .map(([key, points]) => {
      const [baseCharacter, s2Slug] = key.split("\0");
      return { baseCharacter, s2Slug, points };
    })
    .sort((a, b) => b.points - a.points);
  return { leaderboard, voterCount };
}

function localGet(params) {
  const votes = loadLocalVotes();
  if (params.action === "leaderboard") {
    return { ok: true, poll: "stage3", ...buildLocalLeaderboard(votes) };
  }
  if (params.action === "mine") {
    const address = (params.address || "").toLowerCase();
    const active = activeStage3VotesByCharacter(votes[address]);
    const baseFilter = params.baseCharacter || "";
    const mine = baseFilter && active[baseFilter] ? active[baseFilter] : null;
    return {
      ok: true,
      poll: "stage3",
      votesByCharacter: active,
      vote: mine,
      canVote: true,
    };
  }
  throw new Error(`Unknown action: ${params.action}`);
}

function localPost(body, balance) {
  const address = (body.address || "").toLowerCase();
  const baseCharacter = body.baseCharacter;
  const s2Slug = body.s2Slug;
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid address");
  if (!/^[A-Za-z_]+$/.test(baseCharacter) || !/^[A-Za-z_]+$/.test(s2Slug)) {
    throw new Error("Invalid vote target");
  }

  const weight = voteWeight(balance);
  if (weight <= 0) throw new Error("Wallet must hold at least 1 PIXEL TRIP NFT to vote");

  const variants = stage2VariantsFor(baseCharacter);
  if (!variants.some((v) => v.slug === s2Slug)) {
    throw new Error("Invalid Stage 2 variant for character");
  }
  if (hasStage3Art(s2Slug)) {
    throw new Error("This Stage 2 variant already has Stage 3 art");
  }
  if (isStage3ArtCompleteForCharacter(baseCharacter)) {
    throw new Error("Stage 3 art is complete for this character");
  }

  const votes = loadLocalVotes();
  const lbBefore = buildLocalLeaderboard(votes).leaderboard;
  if (isCharacterVoteClosed(baseCharacter, lbBefore)) {
    throw new Error("Voting for this character is complete");
  }

  const active = activeStage3VotesByCharacter(votes[address]);
  if (active[baseCharacter]) {
    throw new Error("You already have an active vote for this character. Vote again after that Stage 3 art ships.");
  }

  const updated = new Date().toISOString();
  const nextWallet = {
    ...migrateStage3WalletVotes(votes[address]),
    [baseCharacter]: { s2Slug, weight, balance, updated },
  };
  votes[address] = nextWallet;
  saveLocalVotes(votes);
  const lb = buildLocalLeaderboard(votes);
  const activeAfter = activeStage3VotesByCharacter(nextWallet);
  return {
    ok: true,
    poll: "stage3",
    vote: activeAfter[baseCharacter],
    votesByCharacter: activeAfter,
    weight,
    canVote: true,
    leaderboard: lb.leaderboard,
    mode: "local",
  };
}

export function createStage3Api(remoteGet, remotePost, useLocalRef) {
  return {
    async get(params) {
      if (useLocalRef.current) return localGet(params);
      try {
        return await remoteGet({ ...params, poll: "stage3" });
      } catch (err) {
        if (/404|503|Failed to fetch/i.test(String(err.message))) {
          useLocalRef.current = true;
          return localGet(params);
        }
        throw err;
      }
    },
    async post(body) {
      if (useLocalRef.current) return localPost(body, body._balance);
      try {
        return await remotePost({ ...body, poll: "stage3" });
      } catch (err) {
        if (/404|503/.test(err.message)) {
          useLocalRef.current = true;
          return localPost(body, body._balance);
        }
        throw err;
      }
    },
  };
}

export function mountStage3Vote(ctx) {
  const els = {
    panel: document.getElementById("vote-panel-stage3"),
    grid: document.getElementById("vote-s3-char-grid"),
    variants: document.getElementById("vote-s3-variant-panel"),
    variantGrid: document.getElementById("vote-s3-variant-grid"),
    charStep: document.getElementById("vote-s3-char-step"),
    back: document.getElementById("vote-s3-back"),
    charTitle: document.getElementById("vote-s3-char-title"),
    selected: document.getElementById("vote-s3-selected"),
    submit: document.getElementById("vote-s3-submit"),
    leaderboard: document.getElementById("vote-s3-leaderboard"),
    stats: document.getElementById("vote-s3-stats"),
    search: document.getElementById("vote-s3-search"),
  };

  if (!els.panel) return;

  const api = createStage3Api(ctx.remoteGet, ctx.remotePost, ctx.useLocalRef);

  let characters = computeStage3VoteCharacters(getBurnableChars());
  let leaderboard = [];
  let selectedBase = null;
  let selectedS2 = null;
  let myVotesByCharacter = {};
  let canVote = true;

  function s1Image(name) {
    const id = CHARACTER_SAMPLES[name];
    return id ? `${IMAGE_STAGE1}/${id}.gif` : null;
  }

  function refreshCharacters() {
    characters = computeStage3VoteCharacters(getBurnableChars());
  }

  function syncMine(data) {
    myVotesByCharacter = data.votesByCharacter || {};
    canVote = data.canVote !== false;
    if (selectedBase && myVotesByCharacter[selectedBase]?.s2Slug) {
      selectedS2 = myVotesByCharacter[selectedBase].s2Slug;
    }
  }

  function hasActiveVoteForBase(base) {
    return Boolean(base && myVotesByCharacter[base]?.s2Slug);
  }

  function updateSubmit() {
    if (!els.submit) return;
    const weight = voteWeight(ctx.getBalance());
    const closed = selectedBase && isCharacterVoteClosed(selectedBase, leaderboard);
    const lockedHere = hasActiveVoteForBase(selectedBase);
    const ready = ctx.getAccount() && weight > 0 && selectedBase && selectedS2 && canVote && !lockedHere && !closed;
    els.submit.disabled = !ready;
    els.submit.hidden = lockedHere;
  }

  function updateSelectedLabel() {
    if (!els.selected) return;
    const locked = selectedBase && myVotesByCharacter[selectedBase];
    if (locked?.s2Slug) {
      els.selected.textContent = `${formatCharacter(locked.s2Slug)} (${formatCharacter(selectedBase)}) — locked until art ships`;
      return;
    }
    if (!selectedS2) {
      els.selected.textContent = selectedBase ? "Pick a Stage 2 variant" : "Pick a character";
      return;
    }
    els.selected.textContent = `${formatCharacter(selectedS2)} · ${formatCharacter(selectedBase)}`;
  }

  function renderLeaderboard() {
    if (!els.leaderboard) return;
    if (!leaderboard.length) {
      els.leaderboard.innerHTML = `<li class="vote-leader-empty">No Stage 3 votes yet.</li>`;
      return;
    }
    els.leaderboard.innerHTML = leaderboard.slice(0, 25).map((row, i) => {
      const img = stage2ImageUrl(row.s2Slug);
      return `
      <li class="vote-leader-row">
        <span class="vote-leader-rank">#${i + 1}</span>
        <img class="vote-leader-thumb" src="${img}" alt="" width="32" height="32" loading="lazy" />
        <span class="vote-leader-name">${formatCharacter(row.s2Slug)}<span class="vote-leader-sub">${formatCharacter(row.baseCharacter)}</span></span>
        <span class="vote-leader-points">${row.points} pt</span>
      </li>`;
    }).join("");
  }

  function renderCharGrid(filter = "") {
    if (!els.grid) return;
    const q = filter.trim().toLowerCase();
    const list = characters.filter((name) => {
      if (!q) return true;
      return name.toLowerCase().includes(q) || formatCharacter(name).toLowerCase().includes(q);
    });

    els.grid.innerHTML = list.map((name) => {
      const { cap, points, closed } = characterVoteProgress(name, leaderboard);
      const { drawn, artCap, complete: artComplete } = characterStage3ArtProgress(name);
      const img = s1Image(name);
      const sel = selectedBase === name && !selectedS2;
      const voted = hasActiveVoteForBase(name);
      const meta = artComplete
        ? "S3 complete"
        : voted
          ? `Your vote · S3 ${drawn}/${artCap}`
          : `S3 ${drawn}/${artCap} · ${points}/${cap} votes`;
      return `
        <button type="button" class="vote-char${sel ? " is-selected" : ""}${closed ? " is-closed" : ""}${voted ? " has-vote" : ""}" data-base="${name}" ${closed ? "disabled" : ""}>
          ${img ? `<img src="${img}" alt="" width="72" height="72" loading="lazy" />` : ""}
          <span class="vote-char-name">${formatCharacter(name)}</span>
          <span class="vote-char-meta">${closed ? "Complete" : meta}</span>
        </button>`;
    }).join("");

    if (!list.length) {
      els.grid.innerHTML = `<p class="vote-empty">No characters match.</p>`;
    }
  }

  function showVariantPanel(baseCharacter) {
    selectedBase = baseCharacter;
    selectedS2 = myVotesByCharacter[baseCharacter]?.s2Slug || null;
    if (els.variants) els.variants.hidden = false;
    if (els.charStep) els.charStep.hidden = true;
    if (els.charTitle) {
      const { cap, points } = characterVoteProgress(baseCharacter, leaderboard);
      const { drawn, artCap } = characterStage3ArtProgress(baseCharacter);
      els.charTitle.textContent = `${formatCharacter(baseCharacter)} — S3 ${drawn}/${artCap} · votes ${points}/${cap}`;
    }
    renderVariantGrid();
    updateSelectedLabel();
    updateSubmit();
  }

  function hideVariantPanel() {
    selectedBase = null;
    selectedS2 = null;
    if (els.variants) els.variants.hidden = true;
    if (els.charStep) els.charStep.hidden = false;
    renderCharGrid(els.search?.value || "");
    updateSelectedLabel();
    updateSubmit();
  }

  function renderVariantGrid() {
    if (!els.variantGrid || !selectedBase) return;
    const variants = voteableStage2Variants(selectedBase);
    if (!variants.length) {
      els.variantGrid.innerHTML = `<p class="vote-empty">All Stage 2 variants already have Stage 3 art.</p>`;
      return;
    }
    els.variantGrid.innerHTML = variants.map((v) => {
      const sel = selectedS2 === v.slug;
      const img = stage2ImageUrl(v.slug);
      return `
        <button type="button" class="vote-char vote-char-variant${sel ? " is-selected" : ""}" data-s2="${v.slug}">
          <img src="${img}" alt="" width="72" height="72" loading="lazy" />
          <span class="vote-char-name">${formatCharacter(v.slug)}</span>
        </button>`;
    }).join("");
  }

  function updateStats() {
    if (!els.stats) return;
    const open = characters.filter((c) => !isCharacterVoteClosed(c, leaderboard)).length;
    els.stats.textContent = [
      `${characters.length} characters`,
      `${open} open`,
      `${leaderboard.length ? `${leaderboard.length} variant rows` : "no votes yet"}`,
      "one vote per character until that S3 art ships",
    ].join(" · ");
  }

  async function loadLeaderboard() {
    try {
      const data = await api.get({ action: "leaderboard" });
      leaderboard = data.leaderboard || [];
      renderLeaderboard();
      updateStats();
      if (selectedBase) renderVariantGrid();
      renderCharGrid(els.search?.value || "");
    } catch (err) {
      console.warn("[vote-s3] leaderboard:", err.message);
    }
  }

  async function loadMyVote() {
    const account = ctx.getAccount();
    if (!account) {
      myVotesByCharacter = {};
      canVote = true;
      return;
    }
    try {
      const data = await api.get({ action: "mine", address: account });
      syncMine(data);
    } catch {
      myVotesByCharacter = {};
      canVote = true;
    }
  }

  async function onWalletReady() {
    refreshCharacters();
    await loadMyVote();
    renderCharGrid(els.search?.value || "");
    renderLeaderboard();
    updateSelectedLabel();
    updateSubmit();
    ctx.updateHolderPanel?.();
  }

  async function submitVote() {
    const account = ctx.getAccount();
    if (!account || !selectedBase || !selectedS2 || hasActiveVoteForBase(selectedBase)) return;
    if (isCharacterVoteClosed(selectedBase, leaderboard)) {
      ctx.setMessage("Voting for this character is complete.", "error");
      return;
    }
    const label = `${formatCharacter(selectedS2)} (${formatCharacter(selectedBase)})`;
    if (!window.confirm(`Vote for ${label}? One vote for this character until that art ships.`)) return;

    els.submit.disabled = true;
    ctx.setMessage(`Submitting Stage 3 vote…`, "pending");
    try {
      const data = await api.post({
        address: account,
        baseCharacter: selectedBase,
        s2Slug: selectedS2,
        _balance: ctx.getBalance(),
      });
      syncMine(data);
      leaderboard = data.leaderboard || leaderboard;
      renderLeaderboard();
      renderCharGrid(els.search?.value || "");
      if (selectedBase) renderVariantGrid();
      updateSubmit();
      updateSelectedLabel();
      ctx.setMessage(`Vote recorded — ${label} (+${data.weight} pt). You can vote for other characters.`, "success");
    } catch (err) {
      ctx.setMessage(err.message || "Vote failed.", "error");
      updateSubmit();
    }
  }

  els.back?.addEventListener("click", hideVariantPanel);
  els.submit?.addEventListener("click", submitVote);
  els.search?.addEventListener("input", (e) => renderCharGrid(e.target.value));
  els.grid?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-base]");
    if (!btn || btn.disabled) return;
    showVariantPanel(btn.dataset.base);
  });
  els.variantGrid?.addEventListener("click", (e) => {
    if (hasActiveVoteForBase(selectedBase)) return;
    const btn = e.target.closest("[data-s2]");
    if (!btn) return;
    selectedS2 = btn.dataset.s2;
    updateSelectedLabel();
    updateSubmit();
    renderVariantGrid();
  });

  refreshCharacters();
  loadLeaderboard();

  return {
    onWalletReady,
    onTabShow() {
      refreshCharacters();
      void loadLeaderboard();
      void loadMyVote();
      renderCharGrid(els.search?.value || "");
    },
    reload: loadLeaderboard,
  };
}
