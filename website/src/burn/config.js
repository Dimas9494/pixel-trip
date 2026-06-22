// Stage 1 — SeaDrop collection (Ethereum Mainnet)
export const STAGE1_ADDRESS = "0x63cec36A9D7e755510ab04A2419666442EC05F2d";

// charId → character name (matches EvolvePixelTrip.stage1Character mapping)
export const CHAR_ID_TO_NAME = {
  0:"Mantis",1:"Bog_Lizard",2:"Eskimo",3:"Specs_Witch",4:"Crying_Mime",
  5:"Lightning_Glam",6:"Goblin_Rogue",7:"Fire_Elemental",8:"Pale_Wraith",
  9:"Neon_Mohawk",10:"Shocked_Fishman",11:"Boxy_Bot",12:"Teal_Villain",
  13:"Painted_Mime",14:"Surprised Gorilla",15:"Sleepy_Koala",16:"Gladiator",
  17:"Derpy_Slug",18:"Fanged_Hippie",19:"Frost_Viking",20:"Cursed_Elmo",
  21:"Crying_Bling",22:"Leaf_Elf",23:"Gummy_Shock",24:"Fish_Diver",
  25:"Long_Eared_Aristocrat",26:"Tongue_Orc",27:"Shocked_Rooster",28:"Blank_Bot",
  29:"Fin_Merman",30:"Winter_Hunter",31:"Square_Professor",32:"Red_Eye_Astro",
  33:"Shadow_Mage",34:"Purple_Prince",35:"Gold_Tooth",36:"Party_Pug",
  37:"Bot_Cyclops",38:"Red_Cyborg",39:"Pink_Goggles_Lady",40:"Bucktooth_Cyclops",
  41:"Big_Old_Satoshi",42:"Motley_Jester",43:"Brain_Bot",44:"Beanie_Cyclops",
  45:"Funky_Geek",46:"Crybaby_Rocker",47:"Teal_Luchador",48:"Moss_Goblin",
  49:"Toxic_Mohawk",50:"Grandma",51:"Shocked_Face",52:"Safari_Turkey",
  53:"Chill_Goat",54:"Purple_Bustard",55:"Mossy_Gargoyle",56:"Shroom_Knight",
  57:"Miner",58:"Steampunk",59:"Blue_Ogre",60:"Cyan_INO",61:"Swamp_Beast",
  62:"Mad_Aviator",63:"Masked_Ranger",64:"Bark_Dryad",65:"Smoke_Lady",
  66:"Monk",67:"Stoned_Jason",68:"Bolt_Franken",69:"One_Straw_Patch",
  70:"Sombrero_Smile",71:"Two_Faced_Green",72:"Bubble_DJ",73:"Cyan_Punk",
  74:"Babushka",75:"Space_Chimp",76:"Derpy_Slime",77:"Grinning_Donkey",
  78:"Bolt_Block",79:"Ape_Beard",80:"Diva",81:"Alpine_Hunter",82:"Antler_Skull",
};

// Characters that currently have Stage 2 art ready.
// Add new character names here when Stage 2 art for them is deployed.
export const BURNABLE_CHARS = new Set([
  "Ape_Beard",
  "Beanie_Cyclops",
  "Diva",
  "Alpine_Hunter",
  "Antler_Skull",
]);

/** 2× Stage 1 → Stage 3 directly (no Stage 2). Matches EvolvePixelTrip EvoPath.DirectToS3 */
export const DIRECT_TO_S3_CHARS = new Set([
  "Antler_Skull",
]);

import STAGE2_VARIANTS_JSON from "./stage2-variants.json";

export const STAGE2_VARIANTS = STAGE2_VARIANTS_JSON;

// EvolvePixelTrip v2 — in-place evolution (no new tokens minted)
// Update this after deploying the new contract via Remix
export const EVOLVE_ADDRESS = import.meta.env.VITE_EVOLVE_CONTRACT || "0x8D0b7Eb6A057ed921a1d6E245b899Beca1B1Bf77";

// Max token ID to scan (test mint ~136). Increase when full collection is live.
export const SCAN_MAX_ID = 200;

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
    outputs: [{ type: "uint8" }],
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
      { indexed: false, name: "charId",       type: "uint8"   },
    ],
  },
];
