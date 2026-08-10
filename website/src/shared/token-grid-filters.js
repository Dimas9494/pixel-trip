import { STAGE_LABELS, burnStatusLabel, variantLabel } from "./token-images.js";

export function tokenFilterHaystack(token) {
  return [
    String(token.tokenId),
    token.character,
    token.displayName,
    token.variantSlug,
    token.name,
    variantLabel(token),
    STAGE_LABELS[token.stage],
    burnStatusLabel(token),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesTokenGridFilters(
  token,
  { stageFilter = "all", burnFilter = "all", search = "" } = {},
) {
  if (stageFilter !== "all" && token.stage !== Number(stageFilter)) return false;
  if (burnFilter === "ready" && !token.canEvolve) return false;
  if (burnFilter === "locked" && token.canEvolve) return false;
  if (search && !tokenFilterHaystack(token).includes(search)) return false;
  return true;
}

export function mountTokenGridFilters(container, { onChange } = {}) {
  if (!container) {
    return {
      getState: () => ({ stageFilter: "all", burnFilter: "all", search: "" }),
    };
  }

  container.innerHTML = `
    <div class="trip-picker-toolbar token-grid-toolbar">
      <label class="trip-picker-search">
        <span class="sr-only">Search trippers</span>
        <input type="search" class="token-grid-search" placeholder="Search #ID, name, variant…" autocomplete="off" />
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
  `;

  let stageFilter = "all";
  let burnFilter = "all";
  let search = "";

  const searchInput = container.querySelector(".token-grid-search");
  const stageButtons = container.querySelectorAll("[data-stage]");
  const burnButtons = container.querySelectorAll("[data-burn]");

  const notify = () => onChange?.({ stageFilter, burnFilter, search });

  searchInput?.addEventListener("input", () => {
    search = searchInput.value.trim().toLowerCase();
    notify();
  });

  stageButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      stageFilter = btn.dataset.stage;
      stageButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
      notify();
    });
  });

  burnButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      burnFilter = btn.dataset.burn;
      burnButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
      notify();
    });
  });

  return { getState: () => ({ stageFilter, burnFilter, search }) };
}

export function formatFilterCount(shown, total, noun = "trippers") {
  return `${shown} of ${total} ${noun}`;
}

export function mountCatalogGridFilters(container, { onChange } = {}) {
  if (!container) {
    return { getState: () => ({ s3Filter: "all", search: "" }) };
  }

  container.innerHTML = `
    <div class="trip-picker-toolbar token-grid-toolbar">
      <label class="trip-picker-search">
        <span class="sr-only">Search characters</span>
        <input type="search" class="token-grid-search" placeholder="Search character…" autocomplete="off" />
      </label>
      <div class="trip-picker-filters" role="group" aria-label="Stage 3 filter">
        <span class="trip-picker-filter-label">Stage 3</span>
        <button type="button" class="trip-filter-btn is-active" data-s3="all">All</button>
        <button type="button" class="trip-filter-btn" data-s3="has_s3">Has S3</button>
        <button type="button" class="trip-filter-btn" data-s3="s2_only">S2 only</button>
      </div>
    </div>
  `;

  let s3Filter = "all";
  let search = "";

  const searchInput = container.querySelector(".token-grid-search");
  const s3Buttons = container.querySelectorAll("[data-s3]");

  const notify = () => onChange?.({ s3Filter, search });

  searchInput?.addEventListener("input", () => {
    search = searchInput.value.trim().toLowerCase();
    notify();
  });

  s3Buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      s3Filter = btn.dataset.s3;
      s3Buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
      notify();
    });
  });

  return { getState: () => ({ s3Filter, search }) };
}

export function matchesCatalogFilters(entry, { s3Filter = "all", search = "" } = {}) {
  if (s3Filter === "has_s3" && !entry.hasS3) return false;
  if (s3Filter === "s2_only" && entry.hasS3) return false;
  if (search) {
    const hay = [entry.name, entry.label].join(" ").toLowerCase();
    if (!hay.includes(search)) return false;
  }
  return true;
}
