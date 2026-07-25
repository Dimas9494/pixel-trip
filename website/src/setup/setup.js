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
  SITE_BASE,
  RECEIPT_RPC_URL,
} from "../burn/config.js";

const CHAR_MAP_URL = `${SITE_BASE}/char-map.json`;
const META_BASE = `${SITE_BASE}/metadata`;
const STORAGE_KEY = "pixel-trip-setup-last-token";
const BATCH_SIZE_DEFAULT = 50;

const SETUP_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "stage1Character",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "setStage1Characters",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIds", type: "uint256[]" },
      { name: "charIds", type: "uint16[]" },
    ],
    outputs: [],
  },
];

const els = {
  metaBase: document.getElementById("setup-meta-base"),
  network: document.getElementById("setup-network"),
  connect: document.getElementById("setup-connect"),
  message: document.getElementById("setup-message"),
  stats: document.getElementById("setup-stats"),
  progress: document.getElementById("setup-progress"),
  progressBar: document.getElementById("setup-progress-bar"),
  log: document.getElementById("setup-log"),
  from: document.getElementById("setup-from"),
  to: document.getElementById("setup-to"),
  batch: document.getElementById("setup-batch"),
  run: document.getElementById("setup-run"),
  stop: document.getElementById("setup-stop"),
};

let walletClient = null;
let publicClient = null;
let account = null;
let isOwner = false;
let stopRequested = false;
let charMap = null;

function setMessage(text, type = "info") {
  if (!els.message) return;
  els.message.textContent = text;
  els.message.dataset.type = type;
}

function log(line) {
  if (!els.log) return;
  els.log.textContent += `${line}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function getCharacterTrait(attributes) {
  if (!Array.isArray(attributes)) return null;
  const attr = attributes.find(
    (a) => typeof a.trait_type === "string" && a.trait_type.toUpperCase() === "CHARACTER",
  );
  return attr?.value ?? null;
}

async function loadCharMap() {
  const res = await fetch(`${CHAR_MAP_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`char-map.json not found (${res.status})`);
  charMap = await res.json();
  return charMap;
}

async function fetchMetadata(tokenId) {
  const res = await fetch(`${META_BASE}/${tokenId}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function ensureMainnet() {
  const chainId = await walletClient.request({ method: "eth_chainId" });
  if (chainId !== "0x1") {
    await walletClient.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }],
    });
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setMessage("No Web3 wallet found. Install MetaMask or use a Web3 browser.", "error");
    return;
  }
  if (!EVOLVE_ADDRESS) {
    setMessage("EVOLVE_ADDRESS is not configured.", "error");
    return;
  }

  setMessage("Connecting wallet…", "pending");
  const [addr] = await window.ethereum.request({ method: "eth_requestAccounts" });

  walletClient = createWalletClient({
    chain: mainnet,
    transport: custom(window.ethereum),
  });
  publicClient = createPublicClient({
    chain: mainnet,
    transport: http(RECEIPT_RPC_URL),
  });
  account = addr;

  await ensureMainnet();

  const owner = await publicClient.readContract({
    address: EVOLVE_ADDRESS,
    abi: SETUP_ABI,
    functionName: "owner",
  });

  isOwner = owner.toLowerCase() === account.toLowerCase();
  els.network.textContent = `${shortAddr(account)} · Mainnet`;
  els.connect.textContent = shortAddr(account);

  if (!isOwner) {
    setMessage(
      `Connected ${shortAddr(account)}, but evolve owner is ${shortAddr(owner)}. Switch to the owner wallet.`,
      "error",
    );
    els.run.disabled = true;
    return;
  }

  await loadCharMap();

  const last = Number(localStorage.getItem(STORAGE_KEY) || 0);
  if (last > 0 && Number(els.from.value) === 1) {
    els.from.value = String(last + 1);
    log(`Resume suggested from token #${last + 1} (last completed: #${last})`);
  }

  setMessage("Owner verified. Set range and click Run batches.", "success");
  els.run.disabled = false;
  els.stats.textContent = `Evolve: ${shortAddr(EVOLVE_ADDRESS)} · Collection: ${shortAddr(STAGE1_ADDRESS)} · ${Object.keys(charMap).length} characters in map`;
}

async function buildBatch(fromId, toId) {
  const rows = [];

  for (let tokenId = fromId; tokenId <= toId; tokenId++) {
    const meta = await fetchMetadata(tokenId);
    if (!meta) {
      log(`  #${tokenId}: metadata missing — skipped`);
      continue;
    }

    const character = getCharacterTrait(meta.attributes);
    if (!character) {
      log(`  #${tokenId}: no CHARACTER trait — skipped`);
      continue;
    }

    const charId = charMap[character];
    if (charId === undefined) {
      log(`  #${tokenId}: "${character}" not in char-map.json — skipped`);
      continue;
    }

    if (charId !== 0) {
      try {
        const onChain = await publicClient.readContract({
          address: EVOLVE_ADDRESS,
          abi: SETUP_ABI,
          functionName: "stage1Character",
          args: [BigInt(tokenId)],
        });
        if (Number(onChain) === charId) continue;
      } catch {
        /* include in batch */
      }
    }

    rows.push({ tokenId, charId, character });
  }

  return rows;
}

function chunkRows(rows, size) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

async function runBatches() {
  if (!isOwner || !walletClient || !account) return;

  const fromId = Math.max(1, Number(els.from.value) || 1);
  const toId = Math.min(4444, Math.max(fromId, Number(els.to.value) || 4444));
  const batchSize = Math.min(100, Math.max(1, Number(els.batch.value) || BATCH_SIZE_DEFAULT));

  stopRequested = false;
  els.run.disabled = true;
  els.stop.disabled = false;
  els.progress.hidden = false;
  els.progressBar.style.width = "0%";
  els.log.textContent = "";

  setMessage(`Loading metadata for tokens ${fromId}–${toId}…`, "pending");
  log(`Scanning metadata ${fromId} → ${toId}`);

  const rows = await buildBatch(fromId, toId);
  if (!rows.length) {
    setMessage("Nothing to send — all tokens in range already match or metadata missing.", "info");
    els.run.disabled = false;
    els.stop.disabled = true;
    return;
  }

  const chunks = chunkRows(rows, batchSize);
  log(`Prepared ${rows.length} token(s) in ${chunks.length} batch(es)`);

  let done = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (stopRequested) {
      log("Stopped by user.");
      break;
    }

    const chunk = chunks[i];
    const tokenIds = chunk.map((r) => BigInt(r.tokenId));
    const charIds = chunk.map((r) => r.charId);
    const first = chunk[0].tokenId;
    const last = chunk[chunk.length - 1].tokenId;

    setMessage(`Batch ${i + 1}/${chunks.length}: tokens #${first}–#${last} — confirm in wallet…`, "pending");
    log(`Batch ${i + 1}: #${first}–#${last} (${chunk.length} tokens)`);

    const hash = await walletClient.writeContract({
      account,
      address: EVOLVE_ADDRESS,
      abi: SETUP_ABI,
      functionName: "setStage1Characters",
      args: [tokenIds, charIds],
      chain: mainnet,
    });

    log(`  tx ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    log(`  ✓ confirmed`);

    localStorage.setItem(STORAGE_KEY, String(last));
    done += chunk.length;
    els.progressBar.style.width = `${Math.round((done / rows.length) * 100)}%`;
  }

  if (!stopRequested) {
    setMessage(`Done. Registered ${done} token(s). Evolution Lab is ready for those IDs.`, "success");
  } else {
    setMessage(`Paused after ${done} token(s). Adjust "From token ID" and run again.`, "info");
  }

  els.run.disabled = false;
  els.stop.disabled = true;
}

function init() {
  if (els.metaBase) els.metaBase.textContent = META_BASE;

  if (!EVOLVE_ADDRESS) {
    setMessage("Configure VITE_EVOLVE_CONTRACT / EVOLVE_ADDRESS first.", "error");
    return;
  }

  els.connect.addEventListener("click", () => {
    connectWallet().catch((err) => {
      console.error(err);
      setMessage(err.shortMessage || err.message || "Wallet connect failed.", "error");
    });
  });

  els.run.addEventListener("click", () => {
    runBatches().catch((err) => {
      console.error(err);
      setMessage(err.shortMessage || err.message || "Batch failed.", "error");
      els.run.disabled = false;
      els.stop.disabled = true;
    });
  });

  els.stop.addEventListener("click", () => {
    stopRequested = true;
    setMessage("Stopping after current batch…", "pending");
  });
}

init();
