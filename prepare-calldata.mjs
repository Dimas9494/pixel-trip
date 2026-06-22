/**
 * prepare-calldata.mjs
 *
 * READ-ONLY. No private key needed.
 *
 * 1. Reads all minted token IDs from the Stage 1 contract via Transfer events
 * 2. Fetches metadata from your server for each token
 * 3. Builds charId maps and evolution paths
 * 4. Outputs ready-to-paste arrays for Remix
 *
 * Usage:
 *   node prepare-calldata.mjs
 */

import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_METADATA_URL = "https://pixeltripnft.website/Test/metadata";
const SCAN_FROM         = 1;
const SCAN_TO           = 4444;
const CONCURRENCY       = 20; // parallel requests
const SUMMARY_FILE      = join(__dirname, "collection", "build", "collection_summary.json");
const OUT_FILE          = join(__dirname, "calldata.json");
const STAGE2_VARIANTS   = JSON.parse(
  readFileSync(join(__dirname, "website", "src", "burn", "stage2-variants.json"), "utf8")
);

// ── Load collection summary ───────────────────────────────────────────────────

const summary         = JSON.parse(readFileSync(SUMMARY_FILE, "utf8"));
const characterCounts = summary.characterCounts;

function getEvoPath(charName) {
  const count = characterCounts[charName] ?? 0;
  if (count <= 1) return 0; // Blocked
  if (count === 2) return 2; // DirectToS3
  return 1;                  // Normal
}

// ── Scan metadata server for all existing tokens ──────────────────────────────
// No RPC needed — just fetch each metadata URL and check if it returns valid JSON.
// Runs CONCURRENCY requests in parallel for speed.

console.log(`Scanning ${BASE_METADATA_URL}/${SCAN_FROM}...${SCAN_TO} for existing tokens...`);
console.log(`(${SCAN_TO - SCAN_FROM + 1} URLs, ${CONCURRENCY} parallel)\n`);

const characterIndex = new Map();
let nextCharId = 0;

const tokenIds = [];
const charIds  = [];
const imageMap = {};
let found      = 0;
let checked    = 0;
const total    = SCAN_TO - SCAN_FROM + 1;

async function checkToken(id) {
  try {
    const res = await fetch(`${BASE_METADATA_URL}/${id}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const meta = await res.json();
    const attr = meta?.attributes?.find(
      (a) => typeof a.trait_type === "string" && a.trait_type.toUpperCase() === "CHARACTER"
    );
    const character = attr?.value ?? null;
    if (!character) return null;
    const image = meta.animation_url || meta.image || null;
    return { character, image };
  } catch {
    return null;
  }
}

// Process in batches of CONCURRENCY
for (let start = SCAN_FROM; start <= SCAN_TO; start += CONCURRENCY) {
  const batch = [];
  for (let id = start; id < Math.min(start + CONCURRENCY, SCAN_TO + 1); id++) {
    batch.push(id);
  }

  const results = await Promise.all(batch.map(async (id) => {
    const data = await checkToken(id);
    return { id, data };
  }));

  for (const { id, data } of results) {
    checked++;
    if (!data) continue;
    found++;

    const { character, image } = data;
    if (!characterIndex.has(character)) {
      characterIndex.set(character, nextCharId++);
    }
    tokenIds.push(id);
    charIds.push(characterIndex.get(character));
    if (image) imageMap[id] = image;
  }

  process.stdout.write(`  Checked ${checked}/${total}, found ${found} tokens...\r`);
}

console.log(`\n\n✓ Found ${tokenIds.length} tokens with metadata (scanned ${total} IDs)`);
console.log(`  Unique characters: ${characterIndex.size}\n`);

// ── Build character paths ─────────────────────────────────────────────────────

const charPathIds  = [];
const charPathVals = [];
const charMapObj   = {};

for (const [name, id] of characterIndex) {
  charMapObj[name] = id;
  charPathIds.push(id);
  charPathVals.push(getEvoPath(name));
}

// ── Split into batches of 50 ──────────────────────────────────────────────────

const BATCH = 50;
const stage1Batches = [];
for (let s = 0; s < tokenIds.length; s += BATCH) {
  stage1Batches.push({
    tokenIds: tokenIds.slice(s, s + BATCH),
    charIds:  charIds.slice(s, s + BATCH),
  });
}

const pathBatches = [];
for (let s = 0; s < charPathIds.length; s += BATCH) {
  pathBatches.push({
    charIds: charPathIds.slice(s, s + BATCH),
    paths:   charPathVals.slice(s, s + BATCH),
  });
}

// ── Stage 2 variant map (copy index per character) ────────────────────────────

const idToCharName = {};
for (const [name, cid] of Object.entries(charMapObj)) idToCharName[cid] = name;

const tokensByChar = {};
for (let i = 0; i < tokenIds.length; i++) {
  const charName = idToCharName[charIds[i]];
  if (!charName) continue;
  (tokensByChar[charName] ??= []).push(tokenIds[i]);
}

const variantMap = {};
for (const [charName, ids] of Object.entries(tokensByChar)) {
  const variants = STAGE2_VARIANTS[charName];
  if (!variants?.length) continue;
  ids.sort((a, b) => a - b);
  ids.forEach((id, copyIdx) => {
    variantMap[id] = variants[copyIdx % variants.length];
  });
}

// ── Save + print ──────────────────────────────────────────────────────────────

writeFileSync(OUT_FILE, JSON.stringify({
  charMap: charMapObj,
  setStage1Characters_batches: stage1Batches,
  setCharacterPaths_batches: pathBatches,
}, null, 2));

writeFileSync(join(__dirname, "char-map.json"), JSON.stringify(charMapObj, null, 2));

const IMAGE_MAP_FILE    = join(__dirname, "website", "src", "burn", "image-map.json");
const VARIANT_MAP_FILE  = join(__dirname, "website", "src", "burn", "variant-map.json");
const VARIANT_DEPLOY    = join(__dirname, "collection", "build", "deploy", "variant-map.json");
writeFileSync(IMAGE_MAP_FILE, JSON.stringify(imageMap, null, 2));
writeFileSync(VARIANT_MAP_FILE, JSON.stringify(variantMap, null, 2));
writeFileSync(VARIANT_DEPLOY, JSON.stringify(variantMap, null, 2));

console.log("=".repeat(60));
console.log("REMIX — paste these into EvolvePixelTrip functions");
console.log("=".repeat(60));

console.log(`\n--- setStage1Characters (${stage1Batches.length} batch(es)) ---\n`);
stage1Batches.forEach((b, i) => {
  console.log(`Batch ${i + 1}:`);
  console.log(`  tokenIds: [${b.tokenIds.join(",")}]`);
  console.log(`  charIds:  [${b.charIds.join(",")}]\n`);
});

console.log(`--- setCharacterPaths (${pathBatches.length} batch(es)) ---\n`);
pathBatches.forEach((b, i) => {
  console.log(`Batch ${i + 1}:`);
  console.log(`  charIds: [${b.charIds.join(",")}]`);
  console.log(`  paths:   [${b.paths.join(",")}]  (0=Blocked 1=Normal 2=DirectToS3)\n`);
});

console.log(`\nSaved: ${OUT_FILE}`);
console.log(`Saved: ${IMAGE_MAP_FILE} (${Object.keys(imageMap).length} image URLs)`);
console.log(`Saved: ${VARIANT_MAP_FILE} (${Object.keys(variantMap).length} Stage 2 variants)`);
console.log(`  #103 → ${variantMap[103]?.slug ?? "?"}`);
