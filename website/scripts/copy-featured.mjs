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

let copied = 0;

if (existsSync(imagesDir)) {
  for (const edition of uniqueEditions) {
    const source = path.join(imagesDir, `${edition}.gif`);
    const target = path.join(publicImagesDir, `${edition}.gif`);
    if (!existsSync(source)) {
      console.warn(`Missing source GIF: ${source}`);
      continue;
    }
    copyFileSync(source, target);
    copied += 1;
  }
  console.log(`Copied ${copied} featured GIFs from collection -> ${publicImagesDir}`);
} else {
  console.warn(`Collection images not found: ${imagesDir}`);
}

const missing = uniqueEditions.filter(
  (edition) => !existsSync(path.join(publicImagesDir, `${edition}.gif`))
);

if (missing.length > 0) {
  console.error(`Missing preview GIFs in public/images: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`All ${uniqueEditions.length} preview GIFs ready in public/images`);
