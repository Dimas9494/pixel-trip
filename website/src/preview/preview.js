import PREVIEW_ITEMS from "./preview-data.json";

const META_PROXY = "https://pixeltripnft.website/Test/update-metadata.php";

const grid = document.getElementById("preview-mystery-grid");
const counter = document.getElementById("preview-revealed-count");

function formatCharacter(value) {
  return value.replace(/_/g, " ");
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

async function loadPreviewItem(raw) {
  try {
    const res = await fetch(`${META_PROXY}?metadata=${raw.id}&t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`metadata ${raw.id} not found`);
    const meta = await res.json();
    const character = meta.attributes?.find((a) => a.trait_type === "Character")?.value;
    const image = meta.image || meta.animation_url;
    if (!image) throw new Error(`no image for ${raw.id}`);
    return {
      id: raw.id,
      name: character ? formatCharacter(character) : raw.name || `Tripper #${raw.id}`,
      image,
    };
  } catch (err) {
    console.warn("[preview]", err);
    if (raw.image && raw.name) {
      return { id: raw.id, name: raw.name, image: raw.image };
    }
    return null;
  }
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
    <img class="preview-mystery-art" src="${item.image}" alt="" width="256" height="256" loading="lazy" />
    <span class="preview-mystery-label">???</span>
  `;

  card.addEventListener("click", () => revealCard(card, item));

  if (isRevealed(item.id)) applyRevealedState(card, item);

  return card;
}

async function initPreview() {
  if (!grid) return;
  grid.innerHTML = `<p class="preview-footnote">Loading trippers…</p>`;

  const items = (await Promise.all(PREVIEW_ITEMS.map(loadPreviewItem))).filter(Boolean);

  grid.innerHTML = "";
  if (!items.length) {
    grid.innerHTML = `<p class="preview-footnote">Preview unavailable — metadata server not reachable.</p>`;
    return;
  }

  for (const item of items) {
    grid.appendChild(buildCard(item));
  }
  updateCounter();
}

initPreview();
