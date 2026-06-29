import PREVIEW_ITEMS from "./preview-data.json";

const CDN_BASE = "https://pixeltripnft.website/Test/images";

const grid = document.getElementById("preview-mystery-grid");
const counter = document.getElementById("preview-revealed-count");

function imageSrc(id) {
  return `/images/${id}.gif`;
}

function revealedKey(id) {
  return `pixel-trip-preview-${id}`;
}

function isRevealed(id) {
  try {
    return sessionStorage.getItem(revealedKey(id)) === "1";
  } catch {
    return false;
  }
}

function markRevealed(id) {
  try {
    sessionStorage.setItem(revealedKey(id), "1");
  } catch {
    /* ignore */
  }
}

function updateCounter() {
  if (!counter || !grid) return;
  const total = grid.querySelectorAll(".preview-mystery").length;
  const open = grid.querySelectorAll(".preview-mystery.is-revealed").length;
  counter.textContent = `${open} / ${total} revealed`;
}

function applyRevealedState(card, item) {
  const label = card.querySelector(".preview-mystery-label");
  const img = card.querySelector(".preview-mystery-art");
  if (label) label.textContent = `#${item.id} ${item.name}`;
  if (img) img.alt = `PIXEL TRIP #${item.id} ${item.name}`;
}

function revealCard(card, item) {
  if (card.classList.contains("is-revealed")) return;
  card.classList.add("is-revealed");
  markRevealed(item.id);
  applyRevealedState(card, item);
  updateCounter();
}

function wireImageFallback(img, id) {
  img.addEventListener("error", () => {
    const cdn = `${CDN_BASE}/${id}.gif`;
    if (img.src !== cdn) img.src = cdn;
  }, { once: true });
}

function buildCard(item) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "preview-mystery";
  card.dataset.id = String(item.id);
  card.dataset.name = item.name;
  if (isRevealed(item.id)) card.classList.add("is-revealed");

  card.innerHTML = `
    <span class="preview-mystery-cover" aria-hidden="true">
      <span class="preview-mystery-q">?</span>
      <span class="preview-mystery-hint">tap to reveal</span>
    </span>
    <img class="preview-mystery-art" src="${imageSrc(item.id)}" alt="" width="256" height="256" loading="lazy" />
    <span class="preview-mystery-label">???</span>
  `;

  const img = card.querySelector(".preview-mystery-art");
  wireImageFallback(img, item.id);

  card.addEventListener("click", () => revealCard(card, item));

  if (isRevealed(item.id)) applyRevealedState(card, item);

  return card;
}

function initPreview() {
  if (!grid) return;
  grid.innerHTML = "";
  for (const item of PREVIEW_ITEMS) {
    grid.appendChild(buildCard(item));
  }
  updateCounter();
}

initPreview();
