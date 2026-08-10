import { buildBurnableList, burnableStats, formatName } from "./catalog-data.js";
import { loadBurnProgram, getStage2Variants } from "../burn/burn-program.js";
import {
  mountCatalogGridFilters,
  matchesCatalogFilters,
  formatFilterCount,
} from "../shared/token-grid-filters.js";

const els = {
  count: document.getElementById("catalog-count"),
  countLine: document.getElementById("catalog-count-line"),
  filters: document.getElementById("catalog-filters"),
  grid: document.getElementById("catalog-grid"),
  empty: document.getElementById("catalog-empty"),
};

let burnableList = buildBurnableList();
let catalogFilters = { getState: () => ({ s3Filter: "all", search: "" }) };

function renderGrid() {
  if (!els.grid) return;
  const state = catalogFilters.getState();
  const list = burnableList.filter((entry) => matchesCatalogFilters(entry, state));

  if (els.countLine) {
    els.countLine.textContent = formatFilterCount(list.length, burnableList.length, "characters");
  }

  els.grid.innerHTML = list
    .map(
      (entry) => `
    <article class="catalog-card is-burnable${entry.hasS3 ? " has-s3" : ""}">
      <div class="catalog-card-media">
        <img src="${entry.imageUrl}" alt="${entry.label}" width="96" height="96" loading="lazy" />
      </div>
      <div class="catalog-card-body">
        <h3 class="catalog-card-name">${entry.label}</h3>
        <p class="catalog-card-meta">${entry.s2Count} Stage 2 variants</p>
        <p class="catalog-card-meta catalog-card-s3">${entry.hasS3
          ? `Stage 3 · ${entry.s3Count} variant${entry.s3Count === 1 ? "" : "s"}`
          : "Stage 3 · not yet"}</p>
      </div>
    </article>
  `,
    )
    .join("");

  if (els.empty) els.empty.hidden = list.length > 0;
}

function init() {
  const stats = burnableStats(burnableList);
  if (els.count) {
    els.count.textContent = `${stats.count} characters · Stage 2 live · ${stats.stage3} with Stage 3`;
  }
  catalogFilters = mountCatalogGridFilters(els.filters, { onChange: renderGrid });
  renderGrid();
}

async function boot() {
  await loadBurnProgram();
  burnableList = buildBurnableList(getStage2Variants());
  init();
}

boot();

export { formatName };
