import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEventLogs,
} from "viem";
import { mainnet } from "viem/chains";
import {
  STAGE1_ADDRESS,
  EVOLVE_ADDRESS,
  STAGE1_ABI,
  EVOLVE_ABI,
  BURNABLE_CHARS,
} from "./config.js";

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
let tokens       = [];   // { tokenId, name, image, character, stage, source }
let selected     = new Set();
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
  if (selected.size !== 2) {
    els.evolve.textContent = "Evolve (burn 2 → mint 1)";
    els.evolve.disabled = true;
    return;
  }
  els.evolve.disabled = false;
  els.evolve.textContent = isApproved
    ? "Evolve (burn 2 → mint 1)"
    : "Approve + Evolve";
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

// ── Load tokens ───────────────────────────────────────────────────────────────

async function fetchMetadata(uri) {
  try {
    const res = await fetch(uri);
    if (res.ok) return await res.json();
  } catch { /* ignore */ }
  return null;
}

function extractCharacter(attributes) {
  return attributes?.find(
    (a) => typeof a.trait_type === "string" && a.trait_type.toUpperCase() === "CHARACTER"
  )?.value ?? null;
}

async function loadStage1Tokens() {
  const totalSupply = await publicClient.readContract({
    address: STAGE1_ADDRESS, abi: STAGE1_ABI, functionName: "totalSupply",
  });

  const loaded = [];
  for (let i = 0n; i < totalSupply; i++) {
    let owner;
    try {
      owner = await publicClient.readContract({
        address: STAGE1_ADDRESS, abi: STAGE1_ABI, functionName: "ownerOf", args: [i],
      });
    } catch { continue; }

    if (owner.toLowerCase() !== account.toLowerCase()) continue;

    let meta = null;
    try {
      const uri = await publicClient.readContract({
        address: STAGE1_ADDRESS, abi: STAGE1_ABI, functionName: "tokenURI", args: [i],
      });
      meta = await fetchMetadata(uri);
    } catch { /* skip */ }

    const character = extractCharacter(meta?.attributes);

    // Only show tokens whose character has Stage 2 art ready
    if (character && !BURNABLE_CHARS.has(character)) continue;

    loaded.push({
      tokenId:   Number(i),
      name:      meta?.name  || `Stage 1 #${i}`,
      image:     meta?.image || null,
      character,
      stage:     1,
      source:    "stage1",
    });
  }
  return loaded;
}

async function loadStage2Tokens() {
  if (!EVOLVE_ADDRESS) return [];

  const balance = await publicClient.readContract({
    address: EVOLVE_ADDRESS, abi: EVOLVE_ABI, functionName: "balanceOf", args: [account],
  });

  const loaded = [];
  for (let i = 0n; i < balance; i++) {
    let tokenId;
    try {
      tokenId = await publicClient.readContract({
        address: EVOLVE_ADDRESS, abi: EVOLVE_ABI,
        functionName: "tokenOfOwnerByIndex", args: [account, i],
      });
    } catch { continue; }

    const info = await publicClient.readContract({
      address: EVOLVE_ADDRESS, abi: EVOLVE_ABI,
      functionName: "tokenInfo", args: [tokenId],
    });

    const stage = Number(info[1]);
    if (stage !== 2) continue; // Stage 3 tokens can't evolve further

    let meta = null;
    try {
      const uri = await publicClient.readContract({
        address: EVOLVE_ADDRESS, abi: EVOLVE_ABI, functionName: "tokenURI", args: [tokenId],
      });
      meta = await fetchMetadata(uri);
    } catch { /* skip */ }

    loaded.push({
      tokenId:   Number(tokenId),
      name:      meta?.name  || `Stage 2 #${tokenId}`,
      image:     meta?.image || null,
      character: extractCharacter(meta?.attributes),
      stage:     2,
      source:    "stage2",
    });
  }
  return loaded;
}

async function loadTokens() {
  setMessage("Loading your travelers…", "info");

  const [stage1, stage2] = await Promise.all([loadStage1Tokens(), loadStage2Tokens()]);
  tokens = [...stage1, ...stage2];
  selected.clear();

  isApproved = await publicClient.readContract({
    address: STAGE1_ADDRESS, abi: STAGE1_ABI,
    functionName: "isApprovedForAll", args: [account, EVOLVE_ADDRESS],
  });

  renderGrid();
  updateStats();
  updateEvolveButton();

  if (!tokens.length) {
    setMessage("No travelers found in this wallet.");
  } else {
    const s2count = stage2.length;
    setMessage(
      `${stage1.length} Stage 1 traveler(s)${s2count ? `, ${s2count} Stage 2 traveler(s)` : ""}. Select 2 of the same character + same stage to evolve.`
    );
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

const STAGE_LABEL = { 1: "Stage 1", 2: "Stage 2" };
const STAGE_COLOR = { 1: "#00e5ff", 2: "#ff2bd6" };

function renderGrid() {
  if (!els.grid) return;
  if (!tokens.length) {
    els.grid.innerHTML = `<p class="burn-empty">No evolveable travelers in this wallet.</p>`;
    return;
  }

  els.grid.innerHTML = "";
  for (const token of tokens) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "burn-token";
    if (selected.has(`${token.source}:${token.tokenId}`)) card.classList.add("is-selected");

    const stageColor = STAGE_COLOR[token.stage] || "#fff";
    card.innerHTML = `
      ${token.image
        ? `<img src="${token.image}" alt="${token.name}" width="72" height="72" />`
        : `<div class="burn-token-placeholder">✦</div>`
      }
      <span class="burn-token-id">#${token.tokenId}</span>
      <span class="burn-token-meta">${token.character || token.name}</span>
      <span class="burn-token-level" style="color:${stageColor}">${STAGE_LABEL[token.stage]}</span>
    `;

    card.addEventListener("click", () => toggleSelect(token));
    els.grid.appendChild(card);
  }
}

function toggleSelect(token) {
  const key = `${token.source}:${token.tokenId}`;
  if (selected.has(key)) {
    selected.delete(key);
  } else {
    if (selected.size >= 2) selected.clear();
    selected.add(key);
  }

  renderGrid();
  updateStats();

  if (selected.size === 2) {
    const err = validateSelection();
    if (err) {
      setMessage(err, "error");
      els.evolve.disabled = true;
    } else {
      const [a] = getSelectedTokens();
      const nextStage = a.stage === 1
        ? (/* DirectToS3 check done on-chain */ "Stage 2 or 3")
        : "Stage 3";
      setMessage(
        isApproved
          ? `Ready! Evolve → ${nextStage}`
          : `Ready! Approve + Evolve → ${nextStage}`
      );
      updateEvolveButton();
    }
  } else {
    updateEvolveButton();
    if (selected.size === 1) setMessage("Select one more traveler with the same character and stage.");
  }
}

function getSelectedTokens() {
  return [...selected].map((key) => {
    const [source, idStr] = key.split(":");
    return tokens.find((t) => t.source === source && t.tokenId === Number(idStr));
  });
}

function validateSelection() {
  const [a, b] = getSelectedTokens();
  if (!a || !b) return "Select 2 travelers.";

  if (a.stage !== b.stage)
    return `Stage mismatch: Stage ${a.stage} vs Stage ${b.stage}. Both must be the same stage.`;

  if (a.character && b.character && a.character !== b.character)
    return `Character mismatch: "${a.character}" vs "${b.character}". Both must be the same character.`;

  return null;
}

function updateStats() {
  if (!els.stats) return;
  const s1 = tokens.filter((t) => t.stage === 1).length;
  const s2 = tokens.filter((t) => t.stage === 2).length;
  els.stats.textContent = [
    s1 ? `${s1} Stage 1` : null,
    s2 ? `${s2} Stage 2` : null,
    `${selected.size}/2 selected`,
    isApproved ? "approved ✓" : null,
  ].filter(Boolean).join(" · ");
}

// ── Connect wallet ────────────────────────────────────────────────────────────

function getProvider() {
  // OKX Wallet, MetaMask, Coinbase, Rainbow — all inject window.ethereum
  // OKX also exposes window.okxwallet as fallback
  return window.ethereum || window.okxwallet || null;
}

async function connectWallet() {
  const provider = getProvider();
  if (!provider) {
    setMessage("No Web3 wallet found. Install OKX Wallet, MetaMask or any EVM wallet.", "error");
    return;
  }
  if (!EVOLVE_ADDRESS) { setMessage("Deploy EvolvePixelTrip and set VITE_EVOLVE_CONTRACT in .env.", "error"); return; }

  try {
    publicClient = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
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

async function evolveTokens() {
  const err = validateSelection();
  if (err) { setMessage(err, "error"); return; }

  const [tokenA, tokenB] = getSelectedTokens();
  els.evolve.disabled = true;

  try {
    // Step 1: approve Stage 1 collection if needed (only for Stage 1 burns)
    if (tokenA.stage === 1 && !isApproved) {
      setMessage("Step 1/2 — Approve the evolve contract in MetaMask…", "pending");
      const approveHash = await walletClient.writeContract({
        account,
        address: STAGE1_ADDRESS,
        abi: STAGE1_ABI,
        functionName: "setApprovalForAll",
        args: [EVOLVE_ADDRESS, true],
      });
      setMessage("Waiting for approval confirmation…", "pending");
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      isApproved = true;
      updateStats();
    }

    // Step 2: call the right evolve function
    const funcName = tokenA.stage === 1 ? "evolveFromStage1" : "evolveFromStage2";
    const stepLabel = tokenA.stage === 1 ? "Step 2/2" : "Step 1/1";
    setMessage(`${stepLabel} — Confirm the Evolve transaction in MetaMask…`, "pending");

    const hash = await walletClient.writeContract({
      account,
      address: EVOLVE_ADDRESS,
      abi: EVOLVE_ABI,
      functionName: funcName,
      args: [BigInt(tokenA.tokenId), BigInt(tokenB.tokenId)],
    });

    setMessage("Transaction sent. Waiting for confirmation…", "pending");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Parse any Evolved event
    const s2logs = parseEventLogs({ abi: EVOLVE_ABI, logs: receipt.logs, eventName: "EvolvedToStage2" });
    const s3logs = parseEventLogs({ abi: EVOLVE_ABI, logs: receipt.logs, eventName: "EvolvedToStage3" });

    if (s3logs[0]) {
      const e = s3logs[0].args;
      const skipped = e.skippedStage2 ? " (skipped Stage 2 — rare character!)" : "";
      setMessage(`Evolved to Stage 3! Burned #${tokenA.tokenId} + #${tokenB.tokenId} → Stage 3 traveler #${e.newTokenId}${skipped}`, "success");
    } else if (s2logs[0]) {
      const e = s2logs[0].args;
      setMessage(`Evolved to Stage 2! Burned #${tokenA.tokenId} + #${tokenB.tokenId} → Stage 2 traveler #${e.newTokenId}`, "success");
    } else {
      setMessage("Evolution complete!", "success");
    }

    await loadTokens();
  } catch (err) {
    console.error(err);
    setMessage(err.shortMessage || err.message || "Transaction failed.", "error");
    updateEvolveButton();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function initBurnDapp() {
  console.log("[burn] initBurnDapp called, root:", els.root, "EVOLVE_ADDRESS:", EVOLVE_ADDRESS);
  if (!els.root) return;
  if (!EVOLVE_ADDRESS) {
    setMessage("Deploy EvolvePixelTrip, then set VITE_EVOLVE_CONTRACT in website/.env", "error");
    if (els.connect) els.connect.disabled = true;
    return;
  }
  els.connect.addEventListener("click", connectWallet);
  els.evolve.addEventListener("click", evolveTokens);
}

initBurnDapp();
