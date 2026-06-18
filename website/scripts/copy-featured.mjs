import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(__dirname, "..");
const collectionRoot = path.resolve(websiteRoot, "../collection");

const buildPath = process.env.COLLECTION_BUILD_PATH
  ? path.resolve(process.env.COLLECTION_BUILD_PATH)
  : path.join(collectionRoot, "build");

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
  console.warn(`Images source not found: ${imagesDir}`);
  process.exit(0);
}

let copied = 0;
for (const edition of uniqueEditions) {
  const source = path.join(imagesDir, `${edition}.gif`);
  const target = path.join(publicImagesDir, `${edition}.gif`);
  if (!existsSync(source)) {
    console.warn(`Missing GIF: ${source}`);
    continue;
  }
  copyFileSync(source, target);
  copied += 1;
}

console.log(`Copied ${copied} featured GIFs -> ${publicImagesDir}`);
