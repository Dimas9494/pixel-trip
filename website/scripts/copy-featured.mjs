import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(__dirname, "..");
const collectionRoot = path.resolve(websiteRoot, "../collection");
const buildPath = path.join(collectionRoot, "build");
const imagesDir = path.join(buildPath, "images");
const configPath = path.join(websiteRoot, "public/data/config.json");
const publicImagesDir = path.join(websiteRoot, "public/images");

const config = JSON.parse(readFileSync(configPath, "utf8"));
const editions = [
  config.heroEdition,
  ...(config.featured || []).map((item) => item.edition),
].filter(Boolean);
const uniqueEditions = [...new Set(editions)];

mkdirSync(publicImagesDir, { recursive: true });

if (!existsSync(imagesDir)) {
  console.error(`Source folder not found: ${imagesDir}`);
  console.error("Run this script from the website folder after building the collection.");
  process.exit(1);
}

for (const edition of uniqueEditions) {
  const source = path.join(imagesDir, `${edition}.gif`);
  const target = path.join(publicImagesDir, `${edition}.gif`);
  if (!existsSync(source)) {
    console.error(`Missing: ${source}`);
    process.exit(1);
  }
  copyFileSync(source, target);
  console.log(`OK ${edition}.gif`);
}

console.log(`Done — ${uniqueEditions.length} GIFs in public/images`);
