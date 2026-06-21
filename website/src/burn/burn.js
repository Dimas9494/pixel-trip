import {
  createPublicClient,
  createWalletClient,
  custom,
  parseEventLogs,
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
} from "./config.js";

const IMAGE_STAGE2       = "https://pixeltripnft.website/Test/stage2/images";
const IMAGE_STAGE3       = "https://pixeltripnft.website/Test/stage3/images";
const UPDATE_METADATA_URL = "https://pixeltripnft.website/Test/update-metadata.php";

function buildEvolvedMetadata(tokenId, charName, newStage) {
  if (newStage === 2) {
    const variants = STAGE2_VARIANTS[charName] || [];
    const variant  = variants[tokenId % variants.length] || { slug: charName, bg: "Unknown", frame: "Unknown" };
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

async function autoUpdateMetadata(tokenId, charName, newStage, txHash) {
  try {
    const res = await fetch(UPDATE_METADATA_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tokenId, charName, newStage, txHash }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`[metadata] Updated metadata/${tokenId} → Stage ${newStage}`);
      return true;
    } else {
      console.warn("[metadata] Server returned error:", data.error);
      return false;
    }
  } catch (err) {
    console.warn("[metadata] Auto-update failed:", err.message);
    return false;
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
  message: document.getElementById("burn-message"),
};

let walletClient = null;
let publicClient = null;
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

async function getOwnedIds() {
  setMessage("Scanning wallet… (~5 sec)", "info");

  // multicall3: all ownerOf calls in ONE eth_call
  const MAX_ID  = 4443;
  const contracts = Array.from({ length: MAX_ID + 1 }, (_, i) => ({
    address: STAGE1_ADDRESS,
    abi:     STAGE1_ABI,
    functionName: "ownerOf",
    args:    [BigInt(i)],
  }));

  const results = await publicClient.multicall({ contracts, allowFailure: true });
  const owned   = [];
  for (let i = 0; i <= MAX_ID; i++) {
    const r = results[i];
    if (r?.status === "success" && r.result?.toLowerCase() === account.toLowerCase()) {
      owned.push(i);
    }
  }
  return owned;
}

async function loadTokens() {
  setMessage("Loading your travelers…", "info");

  const ownedIds = await getOwnedIds();

  // Batch-read charId and evolvedStage for each owned token
  const BATCH = 20;
  tokens = [];

  for (let b = 0; b < ownedIds.length; b += BATCH) {
    const slice = ownedIds.slice(b, b + BATCH);

    const results = await Promise.all(slice.map(async (id) => {
      try {
        const [charId, stage] = await Promise.all([
          publicClient.readContract({
            address: EVOLVE_ADDRESS, abi: EVOLVE_ABI,
            functionName: "stage1Character", args: [BigInt(id)],
          }),
          EVOLVE_ADDRESS ? publicClient.readContract({
            address: EVOLVE_ADDRESS, abi: EVOLVE_ABI,
            functionName: "evolvedStage", args: [BigInt(id)],
          }) : Promise.resolve(0),
        ]);

        const character = CHAR_ID_TO_NAME[Number(charId)] || null;

        // Only show tokens that are burnable (have Stage 2 art) OR already evolved
        const currentStage = Number(stage);
        if (currentStage === 0 && character && !BURNABLE_CHARS.has(character)) return null;

        return {
          tokenId:   id,
          character,
          stage:     currentStage,
          name:      `#${id}${character ? ` ${character}` : ""}`,
          image:     `https://pixeltripnft.website/Test/images/${id}.gif`,
        };
      } catch { return null; }
    }));

    for (const r of results) if (r) tokens.push(r);
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
    setMessage("No evolvable travelers found.");
  } else {
    setMessage(`${tokens.length} traveler(s) found. Select 2 of the same character — first selected will be upgraded.`);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

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
    publicClient = createPublicClient({ chain: mainnet, transport: custom(provider) });
    walletClient = createWalletClient({ chain: mainnet, transport: custom(provider) });

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

async function waitWithTimeout(hash, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${label}`)), 120_000);
    publicClient.waitForTransactionReceipt({ hash })
      .then(r => { clearTimeout(timer); resolve(r); })
      .catch(e => { clearTimeout(timer); reject(e); });
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
      setMessage(`Approval sent (${approveHash.slice(0, 10)}…). Waiting…`, "pending");
      try { await waitWithTimeout(approveHash, "approval"); }
      catch { setMessage("Approval likely confirmed. Proceeding…", "pending"); }
      isApproved = true;
      updateStats();
    }

    // Step 2: simulate first to catch revert reason early
    setMessage("Simulating evolve…", "pending");
    try {
      const { request } = await publicClient.simulateContract({
        account,
        address: EVOLVE_ADDRESS,
        abi:     EVOLVE_ABI,
        functionName: funcName,
        args:    [BigInt(keepToken.tokenId), BigInt(burnToken.tokenId)],
      });

      const stepLabel = keepToken.stage === 0 ? "Step 2/2" : "Step 1/1";
      setMessage(`${stepLabel} — Confirm EVOLVE in your wallet…`, "pending");
      const hash = await walletClient.writeContract(request);
      setMessage(`Evolve tx sent (${hash.slice(0, 10)}…). Waiting…`, "pending");

      let receipt;
      try { receipt = await waitWithTimeout(hash, "evolve"); }
      catch {
        setMessage("Tx sent — check your wallet / Etherscan for confirmation.", "success");
        await loadTokens();
        return;
      }

      // Parse Evolved event
      const logs = parseEventLogs({ abi: EVOLVE_ABI, logs: receipt.logs, eventName: "Evolved" });
      if (logs[0]) {
        const { keepTokenId, newStage, charId } = logs[0].args;
        const charName   = CHAR_ID_TO_NAME[Number(charId)] || null;
        const stageLabel = Number(newStage) === 2 ? "Stage 2" : "Stage 3";
        setMessage(`Evolved! Token #${keepTokenId} → ${stageLabel}. Updating metadata…`, "success");

        const updated = await autoUpdateMetadata(Number(keepTokenId), charName, Number(newStage), hash);
        if (updated) {
          setMessage(`Done! Token #${keepTokenId} is now ${stageLabel}. OpenSea will refresh in a few minutes.`, "success");
        } else {
          setMessage(`Evolved! But metadata auto-update failed — download manually below.`, "success");
          showMetadataDownload(Number(keepTokenId), charName, Number(newStage));
        }
      } else {
        const charName = keepToken.character;
        const newStage = keepToken.stage === 0 ? 2 : 3;
        setMessage(`Evolution complete! Token #${keepToken.tokenId} → Stage ${newStage}. Updating metadata…`, "success");

        const updated = await autoUpdateMetadata(keepToken.tokenId, charName, newStage, hash);
        if (!updated) showMetadataDownload(keepToken.tokenId, charName, newStage);
      }

      await loadTokens();
    } catch (simErr) {
      const reason = simErr.shortMessage || simErr.cause?.reason || simErr.message || "Simulation failed";
      setMessage(`❌ ${reason}`, "error");
      console.error("[evolve simulate]", simErr);
      updateEvolveButton();
    }
  } catch (err) {
    console.error("[evolve]", err);
    setMessage(err.shortMessage || err.message || "Transaction failed.", "error");
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
}

initBurnDapp();
