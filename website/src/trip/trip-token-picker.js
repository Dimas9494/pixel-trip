import {
  enrichTripToken,
  variantLabel,
  STAGE_LABELS,
  burnStatusLabel,
} from "../shared/token-images.js";
import {
  matchesTokenGridFilters,
  mountTokenGridFilters,
  formatFilterCount,
} from "../shared/token-grid-filters.js";

const STAGE_COLOR = { 0: "#00e5ff", 2: "#ff2bd6", 3: "#ffd700" };

export function createTripTokenPicker(root, { onSelect }) {
  let enrichedTokens = [];
  let selectedId = null;

  root.innerHTML = `
    <div class="trip-picker">
      <div class="trip-picker-head">
        <span class="trip-picker-label">Featured tripper</span>
        <p class="trip-picker-selected" id="trip-picker-selected">None selected</p>
      </div>
      <div id="trip-picker-filters"></div>
      <p class="trip-picker-count" id="trip-picker-count"></p>
      <div class="trip-picker-grid burn-token-grid" id="trip-picker-grid"></div>
    </div>
  `;

  const selectedEl = root.querySelector("#trip-picker-selected");
  const countEl = root.querySelector("#trip-picker-count");
  const gridEl = root.querySelector("#trip-picker-grid");
  const filtersHost = root.querySelector("#trip-picker-filters");

  const filterControls = mountTokenGridFilters(filtersHost, { onChange: renderGrid });

  function updateSelectedLine() {
    const token = enrichedTokens.find((t) => t.tokenId === selectedId);
    if (!token) {
      selectedEl.textContent = "None selected";
      return;
    }
    selectedEl.textContent = `#${token.tokenId} · ${variantLabel(token)} · ${STAGE_LABELS[token.stage] || `S${token.stage}`}`;
  }

  function renderGrid() {
    const state = filterControls.getState();
    const list = enrichedTokens.filter((t) => matchesTokenGridFilters(t, state));
    countEl.textContent = formatFilterCount(list.length, enrichedTokens.length);

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
