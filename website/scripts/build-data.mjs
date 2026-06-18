import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(__dirname, "..");
const collectionRoot = path.resolve(websiteRoot, "../collection");

const buildPath = process.env.COLLECTION_BUILD_PATH
  ? path.resolve(process.env.COLLECTION_BUILD_PATH)
  : path.join(collectionRoot, "build");

const metadataDir = path.join(buildPath, "metadata");
const configPath = existsSync(path.join(collectionRoot, "config.json"))
  ? path.join(collectionRoot, "config.json")
  : path.join(websiteRoot, "public/data/config.json");
const siteConfigPath = path.join(websiteRoot, "public/data/config.json");
const outPath = path.join(websiteRoot, "public/data/collection.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function main() {
  if (!existsSync(metadataDir)) {
    if (existsSync(outPath)) {
      console.log(`Metadata not found at ${metadataDir}, keeping existing collection.json`);
      return;
    }
    throw new Error(
      `Metadata directory not found: ${metadataDir}\n` +
        "Commit collection/build/metadata to GitHub or run build from the monorepo root."
    );
  }

  const cfg = readJson(configPath);
  const siteCfg = existsSync(siteConfigPath) ? readJson(siteConfigPath) : {};
  const editionSize = cfg.editionSize;
  const oneOfOnes = new Set(cfg.oneOfOneCharacters || []);

  const items = [];
  const traitValues = {
    Background: new Set(),
    Character: new Set(),
    Frame: new Set(),
  };

  for (let edition = 1; edition <= editionSize; edition += 1) {
    const metaPath = path.join(metadataDir, String(edition));
    if (!existsSync(metaPath)) continue;

    const meta = readJson(metaPath);
    const attrs = Object.fromEntries(
      (meta.attributes || []).map((trait) => [trait.trait_type, trait.value])
    );

    for (const key of Object.keys(traitValues)) {
      if (attrs[key]) traitValues[key].add(attrs[key]);
    }

    const character = attrs.Character || "";
    items.push({
      edition,
      name: meta.name || `PIXEL TRIP #${edition}`,
      dna: meta.dna || "",
      background: attrs.Background || "",
      character,
      frame: attrs.Frame || "",
      isOneOfOne: oneOfOnes.has(character),
    });
  }

  const payload = {
    name: cfg.namePrefix || "PIXEL TRIP",
    description: cfg.description || "",
    editionSize,
    oneOfOnes: cfg.oneOfOneCharacters || [],
    heroEditions: siteCfg.heroEditions || [25, 42, 133, 2847],
    stats: siteCfg.stats || { backgrounds: 154, characters: 291, frames: 200 },
    traits: Object.fromEntries(
      Object.entries(traitValues).map(([key, values]) => [key, [...values].sort()])
    ),
    items,
  };

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload));
  console.log(`Wrote ${items.length} items -> ${outPath}`);
}

main();
