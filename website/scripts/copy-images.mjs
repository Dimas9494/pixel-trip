import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(__dirname, "..");
const collectionRoot = path.resolve(websiteRoot, "../collection");

const buildPath = process.env.COLLECTION_BUILD_PATH
  ? path.resolve(process.env.COLLECTION_BUILD_PATH)
  : path.join(collectionRoot, "build");

const imagesDir = path.join(buildPath, "images");
const publicImagesDir = path.join(websiteRoot, "public/images");

if (process.env.COPY_IMAGES !== "1") {
  console.log("COPY_IMAGES is not set, skipping GIF copy.");
  process.exit(0);
}

if (!existsSync(imagesDir)) {
  console.warn(`Images directory not found: ${imagesDir}`);
  process.exit(0);
}

cpSync(imagesDir, publicImagesDir, { recursive: true, force: true });
console.log(`Copied GIF assets -> ${publicImagesDir}`);
