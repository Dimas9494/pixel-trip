// Stage 1 — SeaDrop collection (Ethereum Mainnet)
export const STAGE1_ADDRESS = "0x63cec36A9D7e755510ab04A2419666442EC05F2d";

// Stage 2/3 — EvolvePixelTrip contract (Ethereum Mainnet)
export const EVOLVE_ADDRESS = import.meta.env.VITE_EVOLVE_CONTRACT || "0x44dC167e639e238B8fCbd3A0b72D69Bd03F0d1Bc";

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

export const EVOLVE_ABI = [
  {
    type: "function", name: "evolveFromStage1",
    stateMutability: "nonpayable",
    inputs:  [{ name: "tokenIdA", type: "uint256" }, { name: "tokenIdB", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "evolveFromStage2",
    stateMutability: "nonpayable",
    inputs:  [{ name: "tokenIdA", type: "uint256" }, { name: "tokenIdB", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "balanceOf",
    stateMutability: "view",
    inputs:  [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "tokenOfOwnerByIndex",
    stateMutability: "view",
    inputs:  [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "tokenInfo",
    stateMutability: "view",
    inputs:  [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "charId", type: "uint8" }, { name: "stage", type: "uint8" }],
  },
  {
    type: "function", name: "tokenURI",
    stateMutability: "view",
    inputs:  [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function", name: "totalEvolved",
    stateMutability: "view",
    inputs:  [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event", name: "EvolvedToStage2",
    inputs: [
      { indexed: true,  name: "user",       type: "address" },
      { indexed: false, name: "burnedA",    type: "uint256" },
      { indexed: false, name: "burnedB",    type: "uint256" },
      { indexed: true,  name: "newTokenId", type: "uint256" },
      { indexed: false, name: "charId",     type: "uint8"   },
    ],
  },
  {
    type: "event", name: "EvolvedToStage3",
    inputs: [
      { indexed: true,  name: "user",          type: "address" },
      { indexed: false, name: "burnedA",        type: "uint256" },
      { indexed: false, name: "burnedB",        type: "uint256" },
      { indexed: true,  name: "newTokenId",     type: "uint256" },
      { indexed: false, name: "charId",         type: "uint8"   },
      { indexed: false, name: "skippedStage2",  type: "bool"    },
    ],
  },
];
