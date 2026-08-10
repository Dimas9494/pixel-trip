import {
  holderLabel,
  sanitizeName,
  shortAddress,
  renderCardCanvas,
  downloadCanvasPng,
} from "./trip-card-render.js";
import { renderAnimatedCardGif, downloadGifBytes } from "./trip-card-gif.js";
import { loadProfile, saveProfile, resolveHolderName } from "./trip-profile.js";
import { initTokenImageCatalog, loadMetadataForTokens, stageImageUrls } from "../shared/token-images.js";
import { createTripTokenPicker } from "./trip-token-picker.js";

/** Minimum rank id to unlock Trip Card claim */
export const CLAIMABLE_RANKS = new Set(["ascended", "legend"]);

export const CARD_THEMES = [
  {
    id: "neon",
    title: "Acid Cabinet",
    blurb: "CRT arcade — chromatic glitch, warp grid, neon stars.",
    minRank: "ascended",
    legendOnly: false,
  },
  {
    id: "tag",
    title: "Trip ID",
    blurb: "Psychedelic nametag — rainbow strip + deck stats.",
    minRank: "ascended",
    legendOnly: false,
  },
  {
    id: "holo",
    title: "Prism Pass",
    blurb: "Epic holo ticket — prism frame, deck stats, score gem.",
    minRank: "ascended",
    legendOnly: false,
  },
  {
    id: "legend",
    title: "Sovereign Seal",
    blurb: "Legendary royal seal — gold banner, hex score, starfield.",
    minRank: "legend",
    legendOnly: true,
  },
];

const RANK_ORDER = { wanderer: 0, traveler: 1, ascended: 2, legend: 3 };
const STORAGE_KEY = "pixeltrip-trip-card-v2";
const STAGE_LABEL = { 0: "Genesis", 2: "Awakened", 3: "Ascended" };

export { holderLabel };

function loadClaim(wallet) {
  if (!wallet || wallet.startsWith("Demo")) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("pixeltrip-trip-card-v1");
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.wallet?.toLowerCase() === wallet.toLowerCase() ? data : null;
  } catch {
    return null;
  }
}

function saveClaim(payload) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function rankMeets(minRank, userRankId) {
  return (RANK_ORDER[userRankId] || 0) >= (RANK_ORDER[minRank] || 0);
}

function availableThemes(rankId) {
  return CARD_THEMES.filter(
    (t) => rankMeets(t.minRank, rankId) && (!t.legendOnly || rankId === "legend"),
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function previewImgTag(data) {
  const urls = stageImageUrls(data.tokenId, data.character, data.stage);
  const fb = urls.fallback ? ` data-fallback="${urls.fallback}"` : "";
  return `<img src="${urls.primary}"${fb} alt="#${data.tokenId}" loading="lazy" />`;
}

function buildPrismPreviewHtml(data, label, stage, locked) {
  const char = escapeHtml(data.character.replace(/_/g, " "));
  const st = data.stats || {};
  const progress =
    data.nextRank && data.score < data.nextRank.min
      ? `${data.nextRank.min - data.score} pts → ${data.nextRank.title}`
      : "★ TRIP MASTER ★";
  return `<div class="trip-card-preview trip-tcg trip-tcg-holo${locked}" data-theme="holo">
    <div class="trip-tcg-shell">
      <div class="trip-prism-kicker">PRISM PASS</div>
      <div class="trip-tcg-header">
        <span class="trip-tcg-char">${char}</span>
        <span class="trip-tcg-id">#${data.tokenId}</span>
      </div>
      <div class="trip-tcg-art">${previewImgTag(data)}</div>
      <div class="trip-tcg-mid">
        <span class="trip-tcg-mid-label">Trip ID</span>
      </div>
      <div class="trip-tcg-deck">
        <div class="trip-tcg-deck-stat magenta"><b>${st.owned ?? "—"}</b><small>TRIPPERS</small></div>
        <div class="trip-tcg-deck-stat green"><b>${st.burned ?? "—"}</b><small>BURNED</small></div>
        <div class="trip-tcg-deck-stat gold"><b>${st.pairs ?? "—"}</b><small>PAIRS</small></div>
      </div>
      <div class="trip-tcg-footer">
        <div class="trip-tcg-footer-left">
          <small>HOLDER</small>
          <strong class="trip-tcg-holder-name">${label}</strong>
          <span class="trip-tcg-progress">${progress}</span>
        </div>
        <div class="trip-tcg-score-orb">
          <b>${data.score}</b>
        </div>
      </div>
    </div>
  </div>`;
}

function buildSovereignPreviewHtml(data, label, stage, locked) {
  const char = escapeHtml(data.character.replace(/_/g, " "));
  const st = data.stats || {};
  return `<div class="trip-card-preview trip-tcg trip-tcg-legend trip-tcg-sovereign${locked}" data-theme="legend">
    <div class="trip-tcg-shell">
      <div class="trip-sovereign-banner">◆&nbsp;&nbsp;SOVEREIGN SEAL&nbsp;&nbsp;◆</div>
      <div class="trip-sovereign-name">${char}</div>
      <div class="trip-sovereign-art">
        <span class="trip-sovereign-id">#${data.tokenId}</span>
        ${previewImgTag(data)}
      </div>
      <div class="trip-tcg-mid trip-sovereign-mid">
        <span class="trip-tcg-mid-label">Trip ID</span>
      </div>
      <div class="trip-tcg-deck trip-sovereign-deck">
        <div class="trip-tcg-deck-stat magenta"><b>${st.owned ?? "—"}</b><small>TRIPPERS</small></div>
        <div class="trip-tcg-deck-stat green"><b>${st.burned ?? "—"}</b><small>BURNED</small></div>
        <div class="trip-tcg-deck-stat gold"><b>${st.pairs ?? "—"}</b><small>PAIRS</small></div>
      </div>
      <div class="trip-sovereign-footer">
        <div class="trip-tcg-footer-left">
          <small>HOLDER</small>
          <strong class="trip-tcg-holder-name">${label}</strong>
          <span class="trip-tcg-progress">★ TRIP MASTER ★</span>
        </div>
        <div class="trip-sovereign-hex"><b>${data.score}</b></div>
      </div>
    </div>
  </div>`;
}

function buildTcgPreviewHtml(themeId, data, label, stage, locked) {
  if (themeId === "legend") return buildSovereignPreviewHtml(data, label, stage, locked);
  return buildPrismPreviewHtml(data, label, stage, locked);
}

function buildPreviewHtml(themeId, data, eligible) {
  const locked = !eligible ? " is-locked" : "";
  const stage = STAGE_LABEL[data.stage] || `S${data.stage}`;
  const label = escapeHtml(holderLabel(data));

  if (themeId === "neon") {
    return `<div class="trip-card-preview trip-preview-neon trip-preview-trippy${locked}" data-theme="${themeId}">
      <div class="trip-preview-head"><span>PIXEL TRIP</span><small>▶ ACID CABINET ◀</small></div>
      <div class="trip-preview-art">${previewImgTag(data)}</div>
      <div class="trip-preview-foot trip-preview-foot-split trip-preview-foot-neon">
        <div class="trip-preview-foot-left">
          <span class="trip-preview-name">${label}</span>
          <span class="trip-preview-meta">#${data.tokenId} · ${escapeHtml(data.character.replace(/_/g, " "))}</span>
          <span class="trip-preview-stage">◆ ${stage}</span>
        </div>
        <div class="trip-preview-foot-right">
          <em class="trip-preview-rank">${data.rankTitle}</em>
          <strong>${data.score}</strong>
          <small>TRIP SCORE</small>
        </div>
      </div>
    </div>`;
  }
  if (themeId === "tag") {
    const st = data.stats || {};
    return `<div class="trip-card-preview trip-preview-tag trip-preview-trippy${locked}" data-theme="${themeId}">
      <div class="trip-preview-tag-head">
        <strong class="trip-preview-tag-head-name">${label}</strong>
        <span class="trip-preview-tag-head-id">#${data.tokenId}</span>
      </div>
      <div class="trip-preview-tag-body">
        <div class="trip-preview-art sm">${previewImgTag(data)}</div>
        <div class="trip-preview-tag-info">
          <span>#${data.tokenId}</span>
          <span>${escapeHtml(data.character.replace(/_/g, " "))}</span>
          <em>${data.rankTitle} · ${data.score}</em>
        </div>
      </div>
      <div class="trip-preview-tag-deck">
        <span class="trip-preview-deck-title">MY TRIP DECK</span>
        <div class="trip-preview-stat-boxes">
          <div class="trip-stat-box magenta"><small>TRIPPERS</small><strong>${st.owned ?? "—"}</strong></div>
          <div class="trip-stat-box purple"><small>STAGE 1</small><strong>${st.s1 ?? "—"}</strong></div>
          <div class="trip-stat-box green"><small>STAGE 2</small><strong>${st.s2 ?? "—"}</strong></div>
          <div class="trip-stat-box gold"><small>STAGE 3</small><strong>${st.s3 ?? "—"}</strong></div>
          <div class="trip-stat-box green"><small>BURNED</small><strong>${st.burned ?? "—"}</strong></div>
          <div class="trip-stat-box purple"><small>PAIRS</small><strong>${st.pairs ?? "—"}</strong></div>
        </div>
        <div class="trip-preview-rank-strip">★ MAX RANK · TRIP MASTER ★</div>
      </div>
    </div>`;
  }
  if (themeId === "holo" || themeId === "legend") {
    return buildTcgPreviewHtml(themeId, data, label, stage, locked);
  }
  return buildTcgPreviewHtml("legend", data, label, stage, locked);
}

function setExportButtons({ claimBtn, downloadPngBtn, downloadGifBtn, isDemo, sameClaim, hasExisting }) {
  if (sameClaim) {
    claimBtn.textContent = "Card claimed ✓";
    claimBtn.disabled = true;
    downloadPngBtn.disabled = false;
    downloadGifBtn.disabled = false;
  } else if (hasExisting) {
    claimBtn.textContent = "Update Trip Card";
    claimBtn.disabled = isDemo;
    downloadPngBtn.disabled = isDemo;
    downloadGifBtn.disabled = isDemo;
  } else {
    claimBtn.textContent = "Claim Trip Card";
    claimBtn.disabled = isDemo;
    downloadPngBtn.disabled = true;
    downloadGifBtn.disabled = true;
  }
}

export function initTripCard(root, getState) {
  if (!root) return;

  let selectedTheme = "neon";
  let selectedTokenId = null;
  let holderName = "";

  root.innerHTML = `
    <section class="trip-card-section" aria-labelledby="trip-card-title">
      <div class="trip-card-section-head">
        <h3 id="trip-card-title" class="trip-card-title">Trip Card</h3>
        <p class="trip-card-sub" id="trip-card-sub">Claim a shareable holder card featuring one of your trippers.</p>
      </div>
      <div class="trip-card-gate" id="trip-card-gate" hidden></div>
      <div class="trip-card-panel" id="trip-card-panel" hidden>
        <div class="trip-card-controls">
          <fieldset class="trip-identity">
            <legend>Your name on card</legend>
            <label class="trip-field">
              <span>Display name</span>
              <input type="text" id="trip-card-name" maxlength="24" placeholder="e.g. LOKI" autocomplete="nickname" />
            </label>
            <p class="trip-identity-hint">Leave blank to show wallet address instead.</p>
          </fieldset>
          <div class="trip-theme-picker" id="trip-theme-picker"></div>
        </div>
        <div class="trip-card-stage">
          <div class="trip-card-live" id="trip-card-live"></div>
          <div class="trip-card-actions">
            <button type="button" class="btn btn-primary" id="trip-card-claim">Claim Trip Card</button>
            <button type="button" class="btn btn-trip-png" id="trip-card-download-png" disabled>Download PNG</button>
            <button type="button" class="btn btn-trip-gif" id="trip-card-download-gif" disabled>Download GIF</button>
            <a class="btn btn-ghost" id="trip-card-opensea" href="#" target="_blank" rel="noopener">View on OpenSea</a>
          </div>
          <p class="trip-card-status" id="trip-card-status"></p>
        </div>
        <div class="trip-picker-row">
          <div class="trip-token-picker-host" id="trip-token-picker"></div>
        </div>
      </div>
      <details class="trip-design-notes">
        <summary>Design variants</summary>
        <ul class="trip-design-list">
          ${CARD_THEMES.map(
            (t) =>
              `<li><strong>${t.title}</strong>${t.legendOnly ? " · Legend only" : ""} — ${t.blurb}</li>`,
          ).join("")}
        </ul>
      </details>
    </section>
  `;

  const gate = root.querySelector("#trip-card-gate");
  const panel = root.querySelector("#trip-card-panel");
  const nameInput = root.querySelector("#trip-card-name");
  const pickerHost = root.querySelector("#trip-token-picker");
  const tokenPicker = createTripTokenPicker(pickerHost, {
    onSelect: (tokenId) => {
      selectedTokenId = tokenId;
      const { tokens, result, wallet, isDemo } = getState();
      const token = tokens.find((t) => t.tokenId === tokenId);
      if (!token) return;
      const data = cardData(token, result, wallet);
      renderLive(data);
      openseaBtn.href = `https://opensea.io/assets/ethereum/0x1B174b30A0ABA50bd73aF305caDB01e23bfda0EC/${token.tokenId}`;
      const existing = !isDemo ? loadClaim(wallet) : null;
      const sameClaim =
        existing &&
        existing.tokenId === token.tokenId &&
        existing.theme === selectedTheme &&
        sanitizeName(existing.holderName) === holderName;
      setExportButtons({
        claimBtn,
        downloadPngBtn,
        downloadGifBtn,
        isDemo,
        sameClaim,
        hasExisting: !!existing,
      });
    },
  });
  const themePicker = root.querySelector("#trip-theme-picker");
  const live = root.querySelector("#trip-card-live");
  const claimBtn = root.querySelector("#trip-card-claim");
  const downloadPngBtn = root.querySelector("#trip-card-download-png");
  const downloadGifBtn = root.querySelector("#trip-card-download-gif");
  const openseaBtn = root.querySelector("#trip-card-opensea");
  const statusEl = root.querySelector("#trip-card-status");

  function readProfile() {
    holderName = sanitizeName(nameInput.value);
  }

  function cardData(token, result, wallet) {
    readProfile();
    return {
      tokenId: token.tokenId,
      character: token.character,
      stage: token.stage,
      rankId: result.rank.id,
      rankTitle: result.rank.title,
      score: result.total,
      wallet,
      holderName,
      stats: result.stats,
      nextRank: result.next,
      progress: result.progress,
      claimedAt: new Date().toISOString(),
    };
  }

  function currentData() {
    const { tokens, result, wallet } = getState();
    const token = tokens.find((t) => t.tokenId === selectedTokenId) || tokens[0];
    if (!token) return null;
    return cardData(token, result, wallet);
  }

  function renderThemes(data, rankId) {
    const themes = availableThemes(rankId);
    if (!themes.some((t) => t.id === selectedTheme)) {
      selectedTheme = themes[0]?.id || "neon";
    }
    themePicker.innerHTML = themes
      .map(
        (t) =>
          `<button type="button" class="trip-theme-btn${t.id === selectedTheme ? " is-active" : ""}" data-theme="${t.id}">
            <span class="trip-theme-btn-title">${t.title}</span>
            <span class="trip-theme-btn-blurb">${t.blurb}</span>
          </button>`,
      )
      .join("");

    themePicker.querySelectorAll(".trip-theme-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedTheme = btn.dataset.theme;
        renderThemes(data, rankId);
        renderLive(data);
      });
    });
  }

  function renderLive(data) {
    live.innerHTML = buildPreviewHtml(selectedTheme, data, true);
    live.querySelectorAll("img[data-fallback]").forEach((img) => {
      img.addEventListener(
        "error",
        () => {
          const fb = img.dataset.fallback;
          if (fb && img.src !== fb) img.src = fb;
        },
        { once: true },
      );
    });
  }

  function updatePreviewOnly() {
    const data = currentData();
    if (data) renderLive(data);
  }

  function refreshPreview() {
    const data = currentData();
    if (data) renderLive(data);
  }

  async function refresh() {
    const { tokens, result, wallet, isDemo } = getState();
    const eligible = CLAIMABLE_RANKS.has(result.rank.id);

    if (!eligible) {
      gate.hidden = false;
      panel.hidden = true;
      gate.innerHTML = `
        <div class="trip-card-locked">
          <p><strong>Trip Card locked</strong> — reach <span class="trip-highlight">Ascended (280+ pts)</span> to claim.</p>
          <p class="trip-card-locked-hint">You are <strong>${result.rank.title}</strong> (${result.total} pts).
          ${result.next ? ` Need ${result.next.min - result.total} more for ${result.next.title}.` : ""}</p>
          <div class="trip-card-locked-previews">
            ${buildPreviewHtml("neon", cardData(tokens[0] || { tokenId: 515, character: "Hungry_Flytrap", stage: 3 }, result, wallet), false)}
            ${buildPreviewHtml("holo", cardData(tokens[0] || { tokenId: 515, character: "Hungry_Flytrap", stage: 3 }, result, wallet), false)}
          </div>
        </div>`;
      return;
    }

    gate.hidden = true;
    panel.hidden = false;

    if (!tokens.length) {
      panel.querySelector(".trip-card-controls").hidden = true;
      statusEl.textContent = "No trippers in wallet to feature.";
      return;
    }
    panel.querySelector(".trip-card-controls").hidden = false;

    const existing = !isDemo ? loadClaim(wallet) : null;
    const profile = !isDemo ? loadProfile() : null;
    const savedName =
      existing?.holderName ||
      (profile?.wallet === wallet?.toLowerCase() ? profile.holderName : "") ||
      resolveHolderName(wallet);
    if (!nameInput.value && savedName) nameInput.value = savedName;

    if (existing?.theme) selectedTheme = existing.theme;

    if (!selectedTokenId || !tokens.some((t) => t.tokenId === selectedTokenId)) {
      const best = [...tokens].sort((a, b) => b.stage - a.stage || b.tokenId - a.tokenId)[0];
      selectedTokenId = existing?.tokenId || best.tokenId;
    }

    statusEl.textContent = "Loading tripper art…";
    await initTokenImageCatalog();
    if (!isDemo) {
      await loadMetadataForTokens(tokens.map((t) => t.tokenId));
    }
    tokenPicker.setTokens(tokens);
    tokenPicker.setSelected(selectedTokenId);

    const token = tokens.find((t) => t.tokenId === selectedTokenId) || tokens[0];
    const data = cardData(token, result, wallet);
    renderThemes(data, result.rank.id);
    renderLive(data);

    openseaBtn.href = `https://opensea.io/assets/ethereum/0x1B174b30A0ABA50bd73aF305caDB01e23bfda0EC/${token.tokenId}`;

    const sameClaim =
      existing &&
      existing.tokenId === token.tokenId &&
      existing.theme === selectedTheme &&
      sanitizeName(existing.holderName) === holderName;

    setExportButtons({
      claimBtn,
      downloadPngBtn,
      downloadGifBtn,
      isDemo,
      sameClaim,
      hasExisting: !!existing,
    });

    if (sameClaim) {
      statusEl.textContent = `Claimed ${existing.claimedAt?.slice(0, 10) || ""} · export PNG (static) or GIF (animated NFT)`;
    } else if (existing) {
      statusEl.textContent = isDemo
        ? "Connect wallet to claim your card."
        : "Update name, tripper or theme — then claim again.";
    } else {
      statusEl.textContent = isDemo
        ? "Connect wallet to claim your card."
        : "GIF keeps NFT animation · PNG is a single frame.";
    }
  }

  let nameSaveTimer = null;
  nameInput.addEventListener("input", () => {
    updatePreviewOnly();
    const { wallet, isDemo, onProfileChange } = getState();
    if (isDemo || !wallet?.startsWith("0x")) return;
    const name = sanitizeName(nameInput.value);
    saveProfile({ wallet, holderName: name });
    clearTimeout(nameSaveTimer);
    nameSaveTimer = setTimeout(() => onProfileChange?.(name), 350);
  });

  claimBtn.addEventListener("click", () => {
    const { tokens, result, wallet, isDemo } = getState();
    if (isDemo) return;
    const token = tokens.find((t) => t.tokenId === selectedTokenId);
    if (!token) return;
    const payload = {
      ...cardData(token, result, wallet),
      theme: selectedTheme,
      claimedAt: new Date().toISOString(),
    };
    saveClaim(payload);
    saveProfile({ wallet, holderName: payload.holderName });
    statusEl.textContent = "Trip Card claimed! Download PNG or animated GIF.";
    claimBtn.textContent = "Card claimed ✓";
    claimBtn.disabled = true;
    downloadPngBtn.disabled = false;
    downloadGifBtn.disabled = false;
  });

  downloadPngBtn.addEventListener("click", async () => {
    const { tokens, result, wallet } = getState();
    const token = tokens.find((t) => t.tokenId === selectedTokenId);
    if (!token) return;
    const stored = loadClaim(wallet);
    const data = {
      ...cardData(token, result, wallet),
      theme: selectedTheme,
      claimedAt: stored?.claimedAt || new Date().toISOString(),
    };
    downloadPngBtn.disabled = true;
    statusEl.textContent = "Rendering PNG…";
    try {
      const canvas = await renderCardCanvas(selectedTheme, data);
      downloadCanvasPng(canvas, `pixeltrip-card-${token.tokenId}-${selectedTheme}.png`);
      statusEl.textContent = "PNG download started.";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "PNG export failed.";
    } finally {
      downloadPngBtn.disabled = false;
    }
  });

  downloadGifBtn.addEventListener("click", async () => {
    const { tokens, result, wallet } = getState();
    const token = tokens.find((t) => t.tokenId === selectedTokenId);
    if (!token) return;
    const stored = loadClaim(wallet);
    const data = {
      ...cardData(token, result, wallet),
      theme: selectedTheme,
      claimedAt: stored?.claimedAt || new Date().toISOString(),
    };
    downloadGifBtn.disabled = true;
    downloadPngBtn.disabled = true;
    statusEl.textContent = "Loading NFT animation…";
    try {
      const bytes = await renderAnimatedCardGif(selectedTheme, data, (cur, total) => {
        statusEl.textContent = `Rendering GIF… frame ${cur}/${total}`;
      });
      downloadGifBytes(bytes, `pixeltrip-card-${token.tokenId}-${selectedTheme}.gif`);
      statusEl.textContent = "GIF download started — animated NFT inside card frame.";
    } catch (err) {
      console.error(err);
      statusEl.textContent = err.message || "GIF export failed — try PNG or another tripper.";
    } finally {
      downloadGifBtn.disabled = false;
      downloadPngBtn.disabled = false;
    }
  });

  return { refresh };
}
