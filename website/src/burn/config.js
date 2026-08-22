// Stage 1 — PIXEL TRIP main collection (Ethereum Mainnet, OpenSea SeaDrop)
export const STAGE1_ADDRESS = "0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9";

export const SITE_BASE = "https://pixeltripnft.website";
export const IMAGE_STAGE1 = `${SITE_BASE}/images`;
export const IMAGE_STAGE2 = `${SITE_BASE}/stage2/images`;
export const IMAGE_STAGE3 = `${SITE_BASE}/stage3/images`;
export const UPDATE_METADATA_URL = `${SITE_BASE}/update-metadata.php`;
export const SYNC_EVOLVE_URL = `${SITE_BASE}/sync-evolve-events.php`;
export const ASSIGNMENTS_URL = `${UPDATE_METADATA_URL}?assignments=1`;
export const STAGE3_ASSIGNMENTS_URL = `${UPDATE_METADATA_URL}?stage3assignments=1`;
export const LINEAGE_URL = `${UPDATE_METADATA_URL}?lineage=`;

// charId → character name (from char-map.json — matches on-chain stage1Character)
import CHAR_MAP_JSON from "../../char-map.json";

export const CHAR_ID_TO_NAME = Object.fromEntries(
  Object.entries(CHAR_MAP_JSON).map(([name, id]) => [Number(id), name]),
);

/** @deprecated use CHAR_MAP name→id */
export const CHAR_NAME_TO_ID = CHAR_MAP_JSON;

import STAGE2_VARIANTS_JSON from "./stage2-variants.json";

export const STAGE2_VARIANTS = STAGE2_VARIANTS_JSON;

/** Characters with Stage 2 art deployed (from stage2-variants.json). */
export const BURNABLE_CHARS = new Set(Object.keys(STAGE2_VARIANTS));

/** Bump when stage2-variants.json changes — shown in Evolution Lab footer. */
export const BURN_PROGRAM_VERSION = `2026-08-23-wallet-v3-${BURNABLE_CHARS.size}c`;

/** 2× Stage 1 → Stage 3 directly (no Stage 2). Must match on-chain characterPath = DirectToS3 (2). */
export const DIRECT_TO_S3_CHARS = new Set([
  // count=3 legendaries — Normal path dead-ends (1×S2 + 1×S1 left)
  "Brain_Zombie",
  "Crimson_Samurai",
  "Cyber_Bear",
  "Flame_Skull",
  "Gold_Warrior",
  "Winged_Demon",
]);

// EvolvePixelTrip v2 — in-place evolution (separate contract, NOT the SeaDrop collection)
// Deploy with stage1Collection = STAGE1_ADDRESS, then set VITE_EVOLVE_CONTRACT in Netlify/.env
export const EVOLVE_ADDRESS = import.meta.env.VITE_EVOLVE_CONTRACT || "0x1B174b30A0ABA50bd73aF305caDB01e23bfda0EC";

export const SCAN_MAX_ID = 4444;

/** First mainnet block with PIXEL TRIP transfers (contract deploy). */
export const COLLECTION_DEPLOY_BLOCK = 25_613_313n;

/** Enable Connect Wallet on Evolution Lab (main collection is live). */
export const WALLET_DAPP_ENABLED = true;

// Fast public RPC for waiting tx receipts (wallet RPC is often slow)
export const RECEIPT_RPC_URL = "https://ethereum-rpc.publicnode.com";

export const STAGE1_ABI = [
  {
    type: "function", name: "balanceOf",
    stateMutability: "view",
    inputs:  [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "totalSupply",
    stateMutability: "view",
    inputs:  [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "ownerOf",
    stateMutability: "view",
    inputs:  [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function", name: "tokenURI",
    stateMutability: "view",
    inputs:  [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function", name: "isApprovedForAll",
    stateMutability: "view",
    inputs:  [{ name: "owner", type: "address" }, { name: "operator", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs:  [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }],
    outputs: [],
  },
];

// EvolvePixelTrip v2 ABI — in-place evolution, no minting
export const EVOLVE_ABI = [
  {
    type: "function", name: "evolvedStage",
    stateMutability: "view",
    inputs:  [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function", name: "stage1Character",
    stateMutability: "view",
    inputs:  [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function", name: "characterPath",
    stateMutability: "view",
    inputs:  [{ name: "charId", type: "uint16" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function", name: "setStage1Characters",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIds", type: "uint256[]" },
      { name: "charIds", type: "uint16[]" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "evolveFromStage1",
    stateMutability: "nonpayable",
    inputs:  [{ name: "keepId", type: "uint256" }, { name: "burnId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "evolveFromStage2",
    stateMutability: "nonpayable",
    inputs:  [{ name: "keepId", type: "uint256" }, { name: "burnId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "totalEvolved",
    stateMutability: "view",
    inputs:  [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event", name: "Evolved",
    inputs: [
      { indexed: true,  name: "user",         type: "address" },
      { indexed: true,  name: "keepTokenId",  type: "uint256" },
      { indexed: false, name: "burnTokenId",  type: "uint256" },
      { indexed: false, name: "newStage",     type: "uint8"   },
      { indexed: false, name: "charId",       type: "uint16"  },
    ],
  },
];
