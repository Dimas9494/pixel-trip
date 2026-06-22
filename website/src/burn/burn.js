import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
} from "viem";
import { mainnet } from "viem/chains";
import {
  STAGE1_ADDRESS,
  EVOLVE_ADDRESS,
  STAGE1_ABI,
  EVOLVE_ABI,
  BURNABLE_CHARS,
  CHAR_ID_TO_NAME,
  STAGE2_VARIANTS,
  SCAN_MAX_ID,
  RECEIPT_RPC_URL,
} from "./config.js";
import IMAGE_MAP from "./image-map.json";
import VARIANT_MAP from "./variant-map.json";

const IMAGE_STAGE2       = "https://pixeltripnft.website/Test/stage2/images";
const IMAGE_STAGE3       = "https://pixeltripnft.website/Test/stage3/images";
const UPDATE_METADATA_URL = "https://pixeltripnft.website/Test/update-metadata.php";

function getStage2Variant(tokenId, character) {
  const mapped = VARIANT_MAP[String(tokenId)];
  if (mapped) return mapped;
  const variants = STAGE2_VARIANTS[character] || [];
  return variants[tokenId % variants.length] || null;
}

function getTokenImage(tokenId, character, stage) {
  if (stage === 2 && character) {
    const variant = getStage2Variant(tokenId, character);
    if (variant) return `${IMAGE_STAGE2}/${variant.slug}.gif`;
  }
  if (stage === 3 && character) {
    return `${IMAGE_STAGE3}/${character}.gif`;
  }
  return IMAGE_MAP[String(tokenId)] || `https://pixeltripnft.website/Test/images/${tokenId}.gif`;
}

function buildEvolvedMetadata(tokenId, charName, newStage) {
  if (newStage === 2) {
    const variant  = getStage2Variant(tokenId, charName) || { slug: charName, bg: "Unknown", frame: "Unknown" };
    return {
      name:          `PIXEL TRIP — ${variant.slug.replace(/_/g, " ")} #${tokenId}`,
      description:   "PIXEL TRIP — 4444 animated pixel portraits on a three-layer journey.",
      image:         `${IMAGE_STAGE2}/${variant.slug}.gif`,
      animation_url: `${IMAGE_STAGE2}/${variant.slug}.gif`,
      external_url:  "https://pixeltripnft.website",
      attributes: [
        { trait_type: "Background", value: variant.bg },
        { trait_type: "Character",  value: variant.slug },
        { trait_type: "Frame",      value: variant.frame },
        { trait_type: "Stage",      value: "2" },
      ],
    };
  }
  if (newStage === 3) {
    const display = (charName || "Character").replace(/_/g, " ");
    return {
      name:          `PIXEL TRIP — ${display} Stage 3 #${tokenId}`,
      description:   "PIXEL TRIP — A fully ascended traveler. Reached Stage 3 through the burn-to-evolve journey.",
      image:         `${IMAGE_STAGE3}/${charName || tokenId}.gif`,
      animation_url: `${IMAGE_STAGE3}/${charName || tokenId}.gif`,
      external_url:  "https://pixeltripnft.website",
      attributes: [
        { trait_type: "Character", value: charName || `#${tokenId}` },
        { trait_type: "Stage",     value: "3" },
      ],
    };
  }
  return null;
}

async function syncMetadataToServer(tokenId) {
  try {
    const res = await fetch(UPDATE_METADATA_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tokenId, sync: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      console.log(`[metadata] Synced metadata/${tokenId} → Stage ${data.stage}`);
      return { ok: true, data };
    }
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function autoUpdateMetadata(tokenId, charName, newStage, txHash) {
  if (!charName) {
    console.warn("[metadata] charName is empty — cannot update");
    return { ok: false, error: "Character name missing" };
  }
  try {
    const res = await fetch(UPDATE_METADATA_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tokenId, charName, newStage, txHash }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      console.log(`[metadata] Updated metadata/${tokenId} → Stage ${newStage}`);
      return { ok: true, data };
    }
    const errMsg = data.error || `HTTP ${res.status}`;
    console.warn("[metadata] Server returned error:", errMsg);
    return { ok: false, error: errMsg };
  } catch (err) {
    console.warn("[metadata] Auto-update failed:", err.message);
    return { ok: false, error: err.message };
  }
}

async function syncAllEvolvedTokens() {
  const evolved = tokens.filter(t => t.stage >= 2);
  if (!evolved.length) return;

  setMessage(`Syncing ${evolved.length} evolved token(s) to server…`, "pending");
  const failed = [];

  for (const t of evolved) {
    const r = await syncMetadataToServer(t.tokenId);
    if (!r.ok) failed.push(`#${t.tokenId}: ${r.error}`);
  }

  if (!failed.length) {
    setMessage(`Metadata synced for ${evolved.length} token(s). Refresh OpenSea in a few minutes.`, "success");
  } else {
    setMessage(`Some tokens failed to sync: ${failed.join("; ")}`, "error");
  }
}

function showMetadataDownload(tokenId, charName, newStage) {
  const meta = buildEvolvedMetadata(tokenId, charName, newStage);
  if (!meta) return;

  const json = JSON.stringify(meta, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);

  // Remove old download banner if exists
  document.getElementById("burn-meta-download")?.remove();

  const banner = document.createElement("div");
  banner.id = "burn-meta-download";
  banner.style.cssText = "margin-top:12px;padding:14px;background:#111;border:1px solid #00ff88;border-radius:6px;font-size:0.85rem;line-height:1.6;color:#ccc;";
  banner.innerHTML = `
    <strong style="color:#00ff88">Token #${tokenId} evolved to ${newStage === 2 ? "Stage 2" : "Stage 3"}!</strong><br>
    Скачай JSON и загрузи на сервер через WinSCP:<br>
    <code style="color:#00e5ff">pixeltripnft.website/Test/metadata/${tokenId}</code>
    <br><br>
    <a href="${url}" download="${tokenId}"
       style="display:inline-block;padding:8px 18px;background:#00ff88;color:#000;font-weight:700;border-radius:4px;text-decoration:none;margin-right:8px;">
      Скачать metadata/${tokenId}
    </a>
    <button onclick="navigator.clipboard.writeText(${JSON.stringify(json)}).then(()=>this.textContent='Скопировано!')"
      style="padding:8px 18px;background:#222;color:#00e5ff;border:1px solid #00e5ff;border-radius:4px;cursor:pointer;">
      Копировать JSON
    </button>
  `;
  els.root.appendChild(banner);
}

const els = {
  root:    document.getElementById("burn-dapp"),
  network: document.getElementById("burn-network"),
  connect: document.getElementById("burn-connect"),
  stats:   document.getElementById("burn-stats"),
  grid:    document.getElementById("burn-token-grid"),
  evolve:  document.getElementById("burn-evolve"),
  sync:    document.getElementById("burn-sync"),
  message: document.getElementById("burn-message"),
};

let walletClient = null;
let publicClient = null;
let receiptClient = null;
let account      = null;
let tokens       = [];   // { tokenId, name, image, character, stage }
let keepToken    = null; // first selected — will be upgraded
let burnToken    = null; // second selected — will be destroyed
let isApproved   = false;

// ── UI helpers ────────────────────────────────────────────────────────────────

function setMessage(text, type = "info") {
  if (!els.message) return;
  els.message.textContent = text;
  els.message.dataset.type = type;
}

function shortAddress(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function updateEvolveButton() {
  if (!els.evolve) return;
  if (!keepToken || !burnToken) {
    els.evolve.textContent = "Evolve (select 2 same-character tokens)";
    els.evolve.disabled = true;
    return;
  }
  els.evolve.disabled = false;
  const action = isApproved ? "Evolve" : "Approve + Evolve";
  els.evolve.textContent = `${action}: keep #${keepToken.tokenId}, burn #${burnToken.tokenId}`;
}

// ── Network ───────────────────────────────────────────────────────────────────

async function ensureMainnet() {
  const chainId = await walletClient.request({ method: "eth_chainId" });
  if (chainId !== "0x1") {
    await walletClient.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }],
    });
  }
}

// ── Token discovery ───────────────────────────────────────────────────────────

async function getScanMaxId() {
  try {
    const supply = await publicClient.readContract({
      address: STAGE1_ADDRESS,
      abi:     STAGE1_ABI,
      functionName: "totalSupply",
    });
    return Math.min(Math.max(Number(supply) + 10, SCAN_MAX_ID), 4444);
  } catch {
    return SCAN_MAX_ID;
  }
}

async function getOwnedIds() {
  setMessage("Scanning wallet…", "info");

  const MAX_ID = await getScanMaxId();
  const contracts = Array.from({ length: MAX_ID }, (_, i) => ({
    address: STAGE1_ADDRESS,
    abi:     STAGE1_ABI,
    functionName: "ownerOf",
    args:    [BigInt(i + 1)],
  }));

  const owned = [];
  try {
    const results = await publicClient.multicall({ contracts, allowFailure: true });
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r?.status === "success" && r.result?.toLowerCase() === account.toLowerCase()) {
        owned.push(i + 1);
      }
    }
  } catch (err) {
    console.warn("[scan] multicall failed:", err.message);
  }

  console.log(`[scan] Owned token IDs (${owned.length}), scanned 1..${MAX_ID}`);
  return owned;
}

async function loadTokens() {
  setMessage("Loading your travelers…", "info");

  const ownedIds = await getOwnedIds();

  // One multicall for all evolve contract reads
  const contracts = ownedIds.flatMap((id) => [
    { address: EVOLVE_ADDRESS, abi: EVOLVE_ABI, functionName: "stage1Character", args: [BigInt(id)] },
    { address: EVOLVE_ADDRESS, abi: EVOLVE_ABI, functionName: "evolvedStage",   args: [BigInt(id)] },
  ]);

  let mcResults = [];
  try {
    mcResults = await publicClient.multicall({ contracts, allowFailure: true });
  } catch (err) {
    console.warn("[token] evolve multicall failed:", err.message);
  }

  tokens = [];
  for (let i = 0; i < ownedIds.length; i++) {
    const id = ownedIds[i];
    try {
      const charR  = mcResults[i * 2];
      const stageR = mcResults[i * 2 + 1];
      const charId = charR?.status === "success" ? Number(charR.result) : 0;
      const stage  = stageR?.status === "success" ? Number(stageR.result) : 0;

      const character    = CHAR_ID_TO_NAME[charId] || null;
      const currentStage = stage;

      if (currentStage === 0 && !BURNABLE_CHARS.has(character)) continue;

      tokens.push({
        tokenId:   id,
        character,
        stage:     currentStage,
        name:      `#${id}${character ? ` ${character}` : ""}`,
        image:     getTokenImage(id, character, currentStage),
      });
    } catch (e) {
      console.warn(`[token] #${id} read failed:`, e.message);
    }
  }

  keepToken  = null;
  burnToken  = null;
  isApproved = await publicClient.readContract({
    address: STAGE1_ADDRESS, abi: STAGE1_ABI,
    functionName: "isApprovedForAll", args: [account, EVOLVE_ADDRESS],
  }).catch(() => false);

  renderGrid();
  updateStats();
  updateEvolveButton();

  if (!tokens.length) {
    if (!ownedIds.length) {
      setMessage("No tokens found in this wallet on Ethereum Mainnet.", "error");
    } else {
      setMessage(
        `${ownedIds.length} token(s) found, but none are currently evolvable. ` +
        `(Only characters with Stage 2 art are shown: Ape_Beard, Beanie_Cyclops, Diva, Alpine_Hunter.) ` +
        `Check console for details.`,
        "info"
      );
    }
  } else {
    setMessage(`${tokens.length} traveler(s) found. Select 2 of the same character — first selected will be upgraded.`);
  }
}

function applyEvolveResult(keepId, burnId, newStage) {
  tokens = tokens
    .filter(t => t.tokenId !== burnId)
    .map(t => {
      if (t.tokenId !== keepId) return t;
      return {
        ...t,
        stage: newStage,
        image: getTokenImage(keepId, t.character, newStage),
      };
    });
  keepToken = null;
  burnToken = null;
  renderGrid();
  updateStats();
  updateEvolveButton();
}

const STAGE_LABEL = { 0: "Stage 1", 2: "Stage 2", 3: "Stage 3 ✓" };
const STAGE_COLOR = { 0: "#00e5ff", 2: "#ff2bd6", 3: "#ffd700" };

function renderGrid() {
  if (!els.grid) return;
  if (!tokens.length) {
    els.grid.innerHTML = `<p class="burn-empty">No evolveable travelers in this wallet.</p>`;
    return;
  }

  els.grid.innerHTML = "";
  for (const token of tokens) {
    const card = document.createElement("button");
    card.type  = "button";
    card.className = "burn-token";

    const isKeep = keepToken?.tokenId === token.tokenId;
    const isBurn = burnToken?.tokenId === token.tokenId;
    if (isKeep) card.classList.add("is-keep");
    if (isBurn) card.classList.add("is-burn");

    const stageColor = STAGE_COLOR[token.stage] ?? "#fff";
    const roleLabel  = isKeep ? "⬆ KEEP" : isBurn ? "🔥 BURN" : "";

    card.innerHTML = `
      ${token.image
        ? `<img src="${token.image}" alt="${token.name}" width="72" height="72" />`
        : `<div class="burn-token-placeholder">✦</div>`
      }
      <span class="burn-token-id">#${token.tokenId}</span>
      <span class="burn-token-meta">${token.character || token.name}</span>
      <span class="burn-token-level" style="color:${stageColor}">${STAGE_LABEL[token.stage] ?? `Stage ${token.stage}`}</span>
      ${roleLabel ? `<span class="burn-token-role">${roleLabel}</span>` : ""}
    `;

    card.addEventListener("click", () => toggleSelect(token));
    els.grid.appendChild(card);
  }
}

function toggleSelect(token) {
  // Stage 3 tokens can't evolve
  if (token.stage === 3) {
    setMessage("Stage 3 tokens are fully evolved — nothing more to do!", "info");
    return;
  }

  if (keepToken?.tokenId === token.tokenId) {
    // Deselect keep → also clear burn
    keepToken = null;
    burnToken = null;
  } else if (burnToken?.tokenId === token.tokenId) {
    // Deselect burn
    burnToken = null;
  } else if (!keepToken) {
    keepToken = token;
  } else if (!burnToken) {
    burnToken = token;
  } else {
    // Both slots full — replace burn with new pick
    burnToken = token;
  }

  renderGrid();
  updateStats();

  if (keepToken && burnToken) {
    const err = validateSelection();
    if (err) {
      setMessage(err, "error");
      els.evolve.disabled = true;
      return;
    }
    const nextStage = keepToken.stage === 0 ? "Stage 2" : "Stage 3";
    setMessage(
      `Ready! #${keepToken.tokenId} → ${nextStage}. #${burnToken.tokenId} will be destroyed.` +
      (isApproved ? "" : " (approval required first)")
    );
    updateEvolveButton();
  } else if (keepToken) {
    setMessage(`#${keepToken.tokenId} selected as KEEP. Now pick the token to BURN.`, "info");
    updateEvolveButton();
  } else {
    setMessage("Select the token you want to UPGRADE first.", "info");
    updateEvolveButton();
  }
}

function validateSelection() {
  if (!keepToken || !burnToken) return "Select 2 travelers.";
  if (keepToken.stage !== burnToken.stage)
    return `Stage mismatch: keep is Stage ${keepToken.stage === 0 ? 1 : keepToken.stage}, burn is Stage ${burnToken.stage === 0 ? 1 : burnToken.stage}.`;
  if (keepToken.character && burnToken.character && keepToken.character !== burnToken.character)
    return `Character mismatch: "${keepToken.character}" vs "${burnToken.character}". Both must be the same character.`;
  return null;
}

function updateStats() {
  if (!els.stats) return;
  const s1 = tokens.filter(t => t.stage === 0).length;
  const s2 = tokens.filter(t => t.stage === 2).length;
  els.stats.textContent = [
    s1 ? `${s1} Stage 1` : null,
    s2 ? `${s2} Stage 2` : null,
    keepToken ? `keep: #${keepToken.tokenId}` : null,
    burnToken ? `burn: #${burnToken.tokenId}` : null,
    isApproved ? "approved ✓" : null,
  ].filter(Boolean).join(" · ");
}

// ── Connect wallet ────────────────────────────────────────────────────────────

function getProvider() {
  return window.ethereum || window.okxwallet || null;
}

async function connectWallet() {
  const provider = getProvider();
  if (!provider) {
    setMessage("No Web3 wallet found. Install OKX Wallet, MetaMask or any EVM wallet.", "error");
    return;
  }
  if (!EVOLVE_ADDRESS) {
    setMessage("Deploy EvolvePixelTrip v2 via Remix, then update EVOLVE_ADDRESS in config.js.", "error");
    return;
  }

  try {
    publicClient  = createPublicClient({ chain: mainnet, transport: custom(provider) });
    walletClient  = createWalletClient({ chain: mainnet, transport: custom(provider) });
    receiptClient = createPublicClient({ chain: mainnet, transport: http(RECEIPT_RPC_URL) });

    const [address] = await walletClient.requestAddresses();
    account = address;
    await ensureMainnet();

    els.connect.textContent = shortAddress(account);
    els.network.textContent = "Ethereum Mainnet";

    await loadTokens();
  } catch (err) {
    console.error(err);
    setMessage(err.shortMessage || err.message || "Connection failed.", "error");
  }
}

// ── Evolve ────────────────────────────────────────────────────────────────────

async function waitForReceipt(hash) {
  return receiptClient.waitForTransactionReceipt({
    hash,
    pollingInterval: 2_000,
    timeout:         90_000,
  });
}

async function evolveTokens() {
  const err = validateSelection();
  if (err) { setMessage(err, "error"); return; }

  els.evolve.disabled = true;

  try {
    const funcName = keepToken.stage === 0 ? "evolveFromStage1" : "evolveFromStage2";

    // Step 1: approve if needed
    if (!isApproved) {
      setMessage("Step 1/2 — Confirm APPROVE in your wallet…", "pending");
      const approveHash = await walletClient.writeContract({
        account,
        address: STAGE1_ADDRESS,
        abi:     STAGE1_ABI,
        functionName: "setApprovalForAll",
        args:    [EVOLVE_ADDRESS, true],
      });
      setMessage(`Approval sent. Waiting for confirmation…`, "pending");
      await waitForReceipt(approveHash);
      isApproved = true;
      updateStats();
    }

    setMessage("Confirm EVOLVE in your wallet…", "pending");
    const hash = await walletClient.writeContract({
      account,
      address: EVOLVE_ADDRESS,
      abi:     EVOLVE_ABI,
      functionName: funcName,
      args:    [BigInt(keepToken.tokenId), BigInt(burnToken.tokenId)],
    });
    setMessage(`Evolve tx sent. Waiting for confirmation…`, "pending");

    try {
      await waitForReceipt(hash);
    } catch {
      setMessage("Tx sent — check Etherscan for confirmation.", "success");
      els.evolve.disabled = false;
      updateEvolveButton();
      return;
    }

    const keepId   = keepToken.tokenId;
    const burnId   = burnToken.tokenId;
    const charName = keepToken.character;
    const newStage = keepToken.stage === 0 ? 2 : 3;
    const stageLabel = newStage === 2 ? "Stage 2" : "Stage 3";

    applyEvolveResult(keepId, burnId, newStage);
    setMessage(`Evolved! #${keepId} → ${stageLabel}. Updating metadata…`, "success");

    const updated = await syncMetadataToServer(keepId);
    if (updated.ok) {
      setMessage(`Done! #${keepId} → ${stageLabel}. Refresh OpenSea in a few minutes.`, "success");
    } else {
      setMessage(`Evolved on-chain! Metadata sync failed: ${updated.error}`, "error");
      showMetadataDownload(keepId, charName, newStage);
    }

    els.evolve.disabled = false;
    updateEvolveButton();
  } catch (err) {
    console.error("[evolve]", err);
    setMessage(err.shortMessage || err.message || "Transaction failed.", "error");
    els.evolve.disabled = false;
    updateEvolveButton();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function initBurnDapp() {
  console.log("[burn] initBurnDapp called, root:", els.root, "EVOLVE_ADDRESS:", EVOLVE_ADDRESS);
  if (!els.root) return;
  if (!EVOLVE_ADDRESS) {
    setMessage("Deploy EvolvePixelTrip v2 via Remix and update EVOLVE_ADDRESS in config.js", "error");
    if (els.connect) els.connect.disabled = true;
    return;
  }
  els.connect.addEventListener("click", connectWallet);
  els.evolve.addEventListener("click", evolveTokens);
  els.sync?.addEventListener("click", syncAllEvolvedTokens);
}

initBurnDapp();
