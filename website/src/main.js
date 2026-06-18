const PAGE_SIZE = 48;
const IMAGE_BASE = (import.meta.env.VITE_IMAGE_BASE_URL || "").replace(/\/$/, "");

let collectionData = null;
let filtered = [];
let currentPage = 1;

const els = {
  heroPreview: document.getElementById("hero-preview"),
  galleryGrid: document.getElementById("gallery-grid"),
  galleryCount: document.getElementById("gallery-count"),
  galleryPagination: document.getElementById("gallery-pagination"),
  oneOfOneGrid: document.getElementById("one-of-one-grid"),
  searchInput: document.getElementById("search-input"),
  filterBackground: document.getElementById("filter-background"),
  filterCharacter: document.getElementById("filter-character"),
  filterFrame: document.getElementById("filter-frame"),
  filterOneOfOne: document.getElementById("filter-one-of-one"),
  resetFilters: document.getElementById("reset-filters"),
  modal: document.getElementById("nft-modal"),
  modalClose: document.getElementById("modal-close"),
  modalImage: document.getElementById("modal-image"),
  modalTitle: document.getElementById("modal-title"),
  modalEdition: document.getElementById("modal-edition"),
  modalTraits: document.getElementById("modal-traits"),
  modalDna: document.getElementById("modal-dna"),
};

function imageUrl(edition) {
  if (IMAGE_BASE) {
    return `${IMAGE_BASE}/${edition}.gif`;
  }
  return `/images/${edition}.gif`;
}

function formatTrait(value) {
  return value.replace(/_/g, " ");
}

function populateSelect(select, values) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatTrait(value);
    select.appendChild(option);
  }
}

function renderHeroPreview(itemsByEdition, heroEditions) {
  els.heroPreview.innerHTML = "";
  for (const edition of heroEditions) {
    const item = itemsByEdition.get(edition);
    if (!item) continue;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "preview-card";
    card.setAttribute("aria-label", item.name);

    const img = document.createElement("img");
    img.src = imageUrl(edition);
    img.alt = item.name;
    img.loading = "lazy";

    card.appendChild(img);
    card.addEventListener("click", () => openModal(item));
    els.heroPreview.appendChild(card);
  }
}

function renderOneOfOnes(oneOfOnes) {
  els.oneOfOneGrid.innerHTML = "";
  for (const name of oneOfOnes) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "one-of-one-card";
    card.innerHTML = `<span>${formatTrait(name)}</span>`;
    card.addEventListener("click", () => {
      els.filterOneOfOne.checked = true;
      els.filterCharacter.value = name;
      applyFilters();
      document.getElementById("gallery").scrollIntoView({ behavior: "smooth" });
    });
    els.oneOfOneGrid.appendChild(card);
  }
}

function createNftCard(item) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "nft-card";

  const img = document.createElement("img");
  img.src = imageUrl(item.edition);
  img.alt = item.name;
  img.loading = "lazy";

  const info = document.createElement("div");
  info.className = "nft-card-info";
  info.innerHTML = `<div class="nft-card-name">#${item.edition}</div>`;

  card.appendChild(img);
  card.appendChild(info);

  if (item.isOneOfOne) {
    const badge = document.createElement("span");
    badge.className = "nft-card-badge";
    badge.textContent = "1/1";
    card.appendChild(badge);
  }

  card.addEventListener("click", () => openModal(item));
  return card;
}

function renderGallery() {
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  els.galleryGrid.innerHTML = "";
  for (const item of pageItems) {
    els.galleryGrid.appendChild(createNftCard(item));
  }

  els.galleryCount.textContent =
    total === collectionData.items.length
      ? `Showing ${total.toLocaleString()} travelers`
      : `Showing ${pageItems.length} of ${total.toLocaleString()} matches`;

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  els.galleryPagination.innerHTML = "";
  if (totalPages <= 1) return;

  const addBtn = (label, page, active = false, disabled = false) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `page-btn${active ? " active" : ""}`;
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener("click", () => {
      currentPage = page;
      renderGallery();
      document.getElementById("gallery").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    els.galleryPagination.appendChild(btn);
  };

  addBtn("←", currentPage - 1, false, currentPage === 1);

  const windowSize = 5;
  let startPage = Math.max(1, currentPage - Math.floor(windowSize / 2));
  let endPage = Math.min(totalPages, startPage + windowSize - 1);
  startPage = Math.max(1, endPage - windowSize + 1);

  for (let page = startPage; page <= endPage; page += 1) {
    addBtn(String(page), page, page === currentPage);
  }

  addBtn("→", currentPage + 1, false, currentPage === totalPages);
}

function applyFilters() {
  const query = els.searchInput.value.trim().toLowerCase();
  const bg = els.filterBackground.value;
  const character = els.filterCharacter.value;
  const frame = els.filterFrame.value;
  const oneOfOneOnly = els.filterOneOfOne.checked;

  filtered = collectionData.items.filter((item) => {
    if (oneOfOneOnly && !item.isOneOfOne) return false;
    if (bg && item.background !== bg) return false;
    if (character && item.character !== character) return false;
    if (frame && item.frame !== frame) return false;
    if (!query) return true;

    const editionMatch = String(item.edition).includes(query.replace("#", ""));
    const nameMatch = item.name.toLowerCase().includes(query);
    const traitMatch = [item.background, item.character, item.frame]
      .join(" ")
      .toLowerCase()
      .includes(query.replace(/ /g, "_"));

    return editionMatch || nameMatch || traitMatch;
  });

  currentPage = 1;
  renderGallery();
}

function openModal(item) {
  els.modalImage.src = imageUrl(item.edition);
  els.modalImage.alt = item.name;
  els.modalTitle.textContent = item.name;
  els.modalEdition.textContent = `Edition ${item.edition}${item.isOneOfOne ? " · 1/1 Character" : ""}`;

  els.modalTraits.innerHTML = `
    <li><span>Background</span><span>${formatTrait(item.background)}</span></li>
    <li><span>Character</span><span>${formatTrait(item.character)}</span></li>
    <li><span>Frame</span><span>${formatTrait(item.frame)}</span></li>
  `;

  els.modalDna.textContent = item.dna ? `DNA: ${item.dna}` : "";
  els.modal.showModal();
}

function bindEvents() {
  [
    els.searchInput,
    els.filterBackground,
    els.filterCharacter,
    els.filterFrame,
    els.filterOneOfOne,
  ].forEach((el) => el.addEventListener("input", applyFilters));

  els.resetFilters.addEventListener("click", () => {
    els.searchInput.value = "";
    els.filterBackground.value = "";
    els.filterCharacter.value = "";
    els.filterFrame.value = "";
    els.filterOneOfOne.checked = false;
    applyFilters();
  });

  els.modalClose.addEventListener("click", () => els.modal.close());
  els.modal.addEventListener("click", (event) => {
    const rect = els.modal.getBoundingClientRect();
    const inDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!inDialog) els.modal.close();
  });
}

async function init() {
  const response = await fetch("/data/collection.json");
  if (!response.ok) {
    throw new Error("collection.json not found. Run npm run build first.");
  }

  collectionData = await response.json();
  filtered = collectionData.items;

  const itemsByEdition = new Map(collectionData.items.map((item) => [item.edition, item]));

  populateSelect(els.filterBackground, collectionData.traits.Background || []);
  populateSelect(els.filterCharacter, collectionData.traits.Character || []);
  populateSelect(els.filterFrame, collectionData.traits.Frame || []);

  renderOneOfOnes(collectionData.oneOfOnes || []);
  renderHeroPreview(itemsByEdition, collectionData.heroEditions || [25, 42, 133, 2847]);
  renderGallery();
  bindEvents();
}

init().catch((error) => {
  console.error(error);
  els.galleryCount.textContent =
    "Failed to load collection. Run: npm run build (or npm run dev).";
});
