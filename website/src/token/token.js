import { UPDATE_METADATA_URL, STAGE1_ADDRESS } from "../burn/config.js";
import { fetchEvolutionHistory, renderEvolutionPanel, OPENSEA_ITEM_BASE } from "../burn/evolution.js";

const params = new URLSearchParams(location.search);
const tokenId = Number(params.get("id") || params.get("tokenId") || 0);

const els = {
  loading: document.getElementById("token-loading"),
  error: document.getElementById("token-error"),
  root: document.getElementById("token-root"),
  image: document.getElementById("token-image"),
  name: document.getElementById("token-name"),
  id: document.getElementById("token-id"),
  stage: document.getElementById("token-stage"),
  opensea: document.getElementById("token-opensea"),
  evolution: document.getElementById("token-evolution"),
};

function metaStage(meta) {
  let stage = 0;
  for (const attr of meta.attributes ?? []) {
    if (attr.trait_type === "Stage") stage = Math.max(stage, Number(attr.value) || 0);
    if (attr.trait_type === "Stage_1") stage = Math.max(stage, 1);
  }
  return stage || 1;
}

async function fetchMetadata(id) {
  const res = await fetch(`${UPDATE_METADATA_URL}?metadata=${id}&t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Metadata not found for #${id}`);
  return res.json();
}

function showError(msg) {
  els.loading.hidden = true;
  els.error.hidden = false;
  els.error.textContent = msg;
}

async function init() {
  if (!tokenId || tokenId < 1) {
    showError("Enter a token id: token.html?id=515");
    return;
  }

  try {
    const meta = await fetchMetadata(tokenId);
    const stage = metaStage(meta);
    const image = meta.image || meta.animation_url || `https://pixeltripnft.website/images/${tokenId}.gif`;

    document.title = `${meta.name || `PIXEL TRIP #${tokenId}`} — PIXEL TRIP`;
    els.name.textContent = meta.name || `PIXEL TRIP #${tokenId}`;
    els.id.textContent = `#${tokenId}`;
    els.stage.textContent = stage >= 3 ? "Stage 3 — Ascended" : stage >= 2 ? "Stage 2 — Awakened" : "Stage 1 — Genesis";
    els.image.src = image;
    els.image.alt = meta.name || `Token #${tokenId}`;
    els.opensea.href = `${OPENSEA_ITEM_BASE}${tokenId}`;

    const history = meta.evolution_history || (await fetchEvolutionHistory(tokenId));
    renderEvolutionPanel(els.evolution, {
      tokenId,
      currentStage: stage,
      currentImage: image,
      history,
      onSelect(v) {
        if (v?.image) els.image.src = v.image;
        if (v?.name) els.image.alt = v.name;
      },
    });

    els.loading.hidden = true;
    els.root.hidden = false;
  } catch (err) {
    showError(err.message || "Failed to load token");
  }
}

init();
