import { BURNABLE_LIST, BURNABLE_COUNT, STAGE3_COUNT, formatName } from "./catalog-data.js";

const els = {
  count:  document.getElementById("catalog-count"),
  search: document.getElementById("catalog-search"),
  grid:   document.getElementById("catalog-grid"),
  empty:  document.getElementById("catalog-empty"),
};

function renderGrid() {
  if (!els.grid) return;
  const q = (els.search?.value || "").trim().toLowerCase();
  const list = BURNABLE_LIST.filter((entry) => {
    if (!q) return true;
    return entry.name.toLowerCase().includes(q) || entry.label.toLowerCase().includes(q);
  });

  els.grid.innerHTML = list.map((entry) => `
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
  `).join("");

  if (els.empty) els.empty.hidden = list.length > 0;
}

function init() {
  if (els.count) {
    els.count.textContent = `${BURNABLE_COUNT} characters · Stage 2 live · ${STAGE3_COUNT} with Stage 3`;
  }
  els.search?.addEventListener("input", renderGrid);
  renderGrid();
}

init();
