import {
  enrichTripToken,
  variantLabel,
  STAGE_LABELS,
  burnStatusLabel,
} from "../shared/token-images.js";

const STAGE_COLOR = { 0: "#00e5ff", 2: "#ff2bd6", 3: "#ffd700" };

export function createTripTokenPicker(root, { onSelect }) {
  let enrichedTokens = [];
  let selectedId = null;
  let stageFilter = "all";
  let burnFilter = "all";
  let search = "";

  root.innerHTML = `
    <div class="trip-picker">
      <div class="trip-picker-head">
        <span class="trip-picker-label">Featured tripper</span>
        <p class="trip-picker-selected" id="trip-picker-selected">None selected</p>
      </div>
      <div class="trip-picker-toolbar">
        <label class="trip-picker-search">
          <span class="sr-only">Search trippers</span>
          <input type="search" id="trip-picker-search" placeholder="Search #ID, name, variant…" autocomplete="off" />
        </label>
        <div class="trip-picker-filters" role="group" aria-label="Stage filter">
          <span class="trip-picker-filter-label">Stage</span>
          <button type="button" class="trip-filter-btn is-active" data-stage="all">All</button>
          <button type="button" class="trip-filter-btn" data-stage="0">Genesis</button>
          <button type="button" class="trip-filter-btn" data-stage="2">Awakened</button>
          <button type="button" class="trip-filter-btn" data-stage="3">Ascended</button>
        </div>
        <div class="trip-picker-filters" role="group" aria-label="Burn filter">
          <span class="trip-picker-filter-label">Burn</span>
          <button type="button" class="trip-filter-btn is-active" data-burn="all">All</button>
          <button type="button" class="trip-filter-btn" data-burn="ready">Available</button>
          <button type="button" class="trip-filter-btn" data-burn="locked">Unavailable</button>
        </div>
      </div>
      <p class="trip-picker-count" id="trip-picker-count"></p>
      <div class="trip-picker-grid burn-token-grid" id="trip-picker-grid"></div>
    </div>
  `;

  const selectedEl = root.querySelector("#trip-picker-selected");
  const searchInput = root.querySelector("#trip-picker-search");
  const countEl = root.querySelector("#trip-picker-count");
  const gridEl = root.querySelector("#trip-picker-grid");
  const stageButtons = root.querySelectorAll("[data-stage]");
  const burnButtons = root.querySelectorAll("[data-burn]");

  function matchesFilters(token) {
    if (stageFilter !== "all" && token.stage !== Number(stageFilter)) return false;
    if (burnFilter === "ready" && !token.canEvolve) return false;
    if (burnFilter === "locked" && token.canEvolve) return false;
    if (search) {
      const hay = [
        String(token.tokenId),
        token.character,
        token.displayName,
        token.variantSlug,
        variantLabel(token),
        STAGE_LABELS[token.stage],
        burnStatusLabel(token),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  }

  function updateSelectedLine() {
    const token = enrichedTokens.find((t) => t.tokenId === selectedId);
    if (!token) {
      selectedEl.textContent = "None selected";
      return;
    }
    selectedEl.textContent = `#${token.tokenId} · ${variantLabel(token)} · ${STAGE_LABELS[token.stage] || `S${token.stage}`}`;
  }

  function renderGrid() {
    const list = enrichedTokens.filter(matchesFilters);
    countEl.textContent = `${list.length} of ${enrichedTokens.length} trippers`;

    if (!list.length) {
      gridEl.innerHTML = `<p class="burn-empty">No trippers match filters.</p>`;
      return;
    }

    gridEl.innerHTML = "";
    for (const token of list) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "burn-token trip-picker-token";
      if (token.tokenId === selectedId) card.classList.add("is-selected");
      if (!token.canEvolve) card.classList.add("is-locked");

      const stageColor = STAGE_COLOR[token.stage] ?? "#fff";
      const burnNote = burnStatusLabel(token);

      card.innerHTML = `
        ${token.imageUrl
          ? `<img src="${token.imageUrl}" data-fallback="${token.imageFallback || ""}" alt="#${token.tokenId}" width="72" height="72" loading="lazy" />`
          : `<div class="burn-token-placeholder">✦</div>`
        }
        <span class="burn-token-id">#${token.tokenId}</span>
        <span class="burn-token-meta">${variantLabel(token)}</span>
        <span class="burn-token-level" style="color:${stageColor}">${STAGE_LABELS[token.stage] || `Stage ${token.stage}`}</span>
        <span class="burn-token-burn">${burnNote}</span>
      `;

      const img = card.querySelector("img");
      if (img) {
        img.addEventListener(
          "error",
          () => {
            const fb = img.dataset.fallback;
            if (fb && img.src !== fb) img.src = fb;
          },
          { once: true },
        );
      }

      card.addEventListener("click", () => {
        selectedId = token.tokenId;
        updateSelectedLine();
        renderGrid();
        onSelect?.(token.tokenId);
      });

      gridEl.appendChild(card);
    }
  }

  searchInput.addEventListener("input", () => {
    search = searchInput.value.trim().toLowerCase();
    renderGrid();
  });

  stageButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      stageFilter = btn.dataset.stage;
      stageButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
      renderGrid();
    });
  });

  burnButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      burnFilter = btn.dataset.burn;
      burnButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
      renderGrid();
    });
  });

  return {
    setTokens(tokens) {
      enrichedTokens = tokens.map(enrichTripToken);
      if (selectedId && !enrichedTokens.some((t) => t.tokenId === selectedId)) {
        selectedId = enrichedTokens[0]?.tokenId ?? null;
      }
      updateSelectedLine();
      renderGrid();
    },
    setSelected(tokenId) {
      selectedId = tokenId;
      updateSelectedLine();
      renderGrid();
    },
    getSelected() {
      return selectedId;
    },
    refreshImages() {
      enrichedTokens = enrichedTokens.map((t) =>
        enrichTripToken({
          tokenId: t.tokenId,
          character: t.character,
          stage: t.stage,
          charId: t.charId,
        }),
      );
      renderGrid();
    },
  };
}
