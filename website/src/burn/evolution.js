import { UPDATE_METADATA_URL, STAGE1_ADDRESS } from "./config.js";

export const LINEAGE_URL = `${UPDATE_METADATA_URL}?lineage=`;
export const OPENSEA_ITEM_BASE = `https://opensea.io/assets/ethereum/${STAGE1_ADDRESS}/`;

const STAGE_LABEL = { 1: "Stage 1", 2: "Stage 2", 3: "Stage 3" };

export async function fetchEvolutionHistory(tokenId) {
  const id = Number(tokenId);
  if (!id) return null;

  try {
    const res = await fetch(`${LINEAGE_URL}${id}&t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) return res.json();
  } catch {
    /* lineage API optional until server deploy */
  }

  try {
    const metaRes = await fetch(`${UPDATE_METADATA_URL}?metadata=${id}&t=${Date.now()}`, { cache: "no-store" });
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta.evolution_history) return meta.evolution_history;
    }
  } catch {
    /* ignore */
  }

  return null;
}

export function buildEvolutionViews(tokenId, currentStage, currentImage, history) {
  const views = [];
  const seen = new Set();

  function pushView(entry, role, label) {
    const key = `${entry.tokenId}-${entry.stage}-${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    views.push({
      tokenId: entry.tokenId,
      stage: entry.stage,
      role,
      label,
      name: entry.name || `#${entry.tokenId}`,
      image: entry.image,
      opensea: `${OPENSEA_ITEM_BASE}${entry.tokenId}`,
    });
  }

  for (const entry of history?.self ?? []) {
    pushView(entry, "self", `${STAGE_LABEL[entry.stage] || `Stage ${entry.stage}`} · #${entry.tokenId}`);
  }

  if (currentStage >= 2 && currentImage) {
    pushView(
      { tokenId, stage: currentStage, name: `#${tokenId}`, image: currentImage },
      "current",
      `Current · ${STAGE_LABEL[currentStage] || `Stage ${currentStage}`}`,
    );
  }

  views.sort((a, b) => a.stage - b.stage || a.tokenId - b.tokenId || (a.role === "current" ? 1 : 0));
  return views;
}

export function renderEvolutionPanel(container, { tokenId, currentStage, currentImage, history, onSelect }) {
  if (!container) return;

  const views = buildEvolutionViews(tokenId, currentStage, currentImage, history);
  if (views.length <= 1) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  container.hidden = false;
  let activeIdx = views.findIndex(v => v.role === "current");
  if (activeIdx < 0) activeIdx = views.length - 1;

  function selectIdx(idx) {
    activeIdx = idx;
    renderMain();
    renderThumbs();
    onSelect?.(views[idx]);
  }

  function renderMain() {
    const v = views[activeIdx];
    const main = container.querySelector(".evo-history-main");
    if (!main || !v) return;
    main.innerHTML = `
      <img src="${v.image}" alt="${v.name}" width="320" height="320" />
      <div class="evo-history-main-meta">
        <span class="evo-history-title">${v.name.replace(/</g, "&lt;")}</span>
        <span class="evo-history-label">${v.label}</span>
        <a class="evo-history-opensea" href="${v.opensea}" target="_blank" rel="noopener">OpenSea #${v.tokenId}</a>
      </div>
    `;
    const img = main.querySelector("img");
    img?.addEventListener("error", () => { img.style.opacity = "0.35"; }, { once: true });
  }

  function renderThumbs() {
    const strip = container.querySelector(".evo-history-strip");
    if (!strip) return;
    strip.innerHTML = views.map((v, i) => `
      <button type="button" class="evo-history-thumb${i === activeIdx ? " is-active" : ""}${v.role === "burned" ? " is-burned" : ""}" data-idx="${i}" title="${v.label}">
        <img src="${v.image}" alt="" width="72" height="72" />
        <span>#${v.tokenId}</span>
        <span class="evo-history-thumb-stage">${STAGE_LABEL[v.stage] || v.stage}</span>
      </button>
    `).join("");

    strip.querySelectorAll(".evo-history-thumb").forEach(btn => {
      btn.addEventListener("click", () => selectIdx(Number(btn.dataset.idx)));
    });
  }

  container.innerHTML = `
    <div class="evo-history">
      <h3 class="evo-history-heading">Evolution timeline</h3>
      <p class="evo-history-lead">Previous forms of this tripper on the burn-to-evolve path.</p>
      <div class="evo-history-main"></div>
      <div class="evo-history-strip" role="tablist" aria-label="Evolution versions"></div>
    </div>
  `;

  renderMain();
  renderThumbs();
  onSelect?.(views[activeIdx]);
}

export function openEvolutionModal({ tokenId, currentStage, currentImage, history }) {
  let overlay = document.getElementById("evo-history-modal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "evo-history-modal";
    overlay.className = "evo-history-modal";
    overlay.innerHTML = `<div class="evo-history-modal-inner"><button type="button" class="evo-history-close" aria-label="Close">×</button><div class="evo-history-modal-body"></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", e => {
      if (e.target === overlay || e.target.closest(".evo-history-close")) overlay.hidden = true;
    });
  }

  overlay.hidden = false;
  const body = overlay.querySelector(".evo-history-modal-body");
  renderEvolutionPanel(body, { tokenId, currentStage, currentImage, history });
}
