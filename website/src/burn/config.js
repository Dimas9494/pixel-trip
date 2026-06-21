// Stage 1 — SeaDrop collection (Ethereum Mainnet)
export const STAGE1_ADDRESS = "0x63cec36A9D7e755510ab04A2419666442EC05F2d";

// charId → character name (matches EvolvePixelTrip.stage1Character mapping)
export const CHAR_ID_TO_NAME = {
  0:"Mantis",1:"Ape_Beard",2:"Bog_Lizard",3:"Eskimo",4:"Specs_Witch",
  5:"Crying_Mime",6:"Lightning_Glam",7:"Goblin_Rogue",8:"Fire_Elemental",
  9:"Pale_Wraith",10:"Neon_Mohawk",11:"Shocked_Fishman",12:"Boxy_Bot",
  13:"Teal_Villain",14:"Painted_Mime",15:"Surprised Gorilla",16:"Sleepy_Koala",
  17:"Gladiator",18:"Derpy_Slug",19:"Fanged_Hippie",20:"Frost_Viking",
  21:"Cursed_Elmo",22:"Crying_Bling",23:"Leaf_Elf",24:"Gummy_Shock",
  25:"Fish_Diver",26:"Long_Eared_Aristocrat",27:"Tongue_Orc",28:"Shocked_Rooster",
  29:"Blank_Bot",30:"Fin_Merman",31:"Winter_Hunter",32:"Square_Professor",
  33:"Red_Eye_Astro",34:"Shadow_Mage",35:"Purple_Prince",36:"Gold_Tooth",
  37:"Party_Pug",38:"Bot_Cyclops",39:"Red_Cyborg",40:"Pink_Goggles_Lady",
  41:"Bucktooth_Cyclops",42:"Big_Old_Satoshi",43:"Motley_Jester",44:"Brain_Bot",
  45:"Beanie_Cyclops",46:"Funky_Geek",47:"Crybaby_Rocker",48:"Teal_Luchador",
  49:"Moss_Goblin",50:"Toxic_Mohawk",51:"Grandma",52:"Shocked_Face",
  53:"Safari_Turkey",54:"Chill_Goat",55:"Purple_Bustard",56:"Mossy_Gargoyle",
  57:"Shroom_Knight",58:"Miner",59:"Steampunk",60:"Blue_Ogre",61:"Cyan_INO",
  62:"Swamp_Beast",63:"Mad_Aviator",64:"Masked_Ranger",65:"Bark_Dryad",
  66:"Smoke_Lady",67:"Monk",68:"Stoned_Jason",69:"Bolt_Franken",
  70:"One_Straw_Patch",71:"Sombrero_Smile",72:"Two_Faced_Green",73:"Bubble_DJ",
  74:"Cyan_Punk",75:"Babushka",76:"Space_Chimp",77:"Derpy_Slime",
  78:"Grinning_Donkey",79:"Bolt_Block",80:"Diva",81:"Alpine_Hunter",82:"Antler_Skull",
};

// Characters that currently have Stage 2 art ready.
// Add new character names here when Stage 2 art for them is deployed.
export const BURNABLE_CHARS = new Set([
  "Ape_Beard",
  "Beanie_Cyclops",
  "Diva",
  "Alpine_Hunter",
]);

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
    type: "function", name: "stage1Character",
    stateMutability: "view",
    inputs:  [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint8" }],
  },
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
