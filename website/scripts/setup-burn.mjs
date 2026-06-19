import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(__dirname, "..");
const burnDir = path.join(websiteRoot, "public/images/burn");
const files = [
  { name: "level-1.gif", label: "Level 1 — Genesis" },
  { name: "level-2.gif", label: "Level 2 — Awakened" },
  { name: "level-3.gif", label: "Level 3 — Ascended" },
];

const args = process.argv.slice(2);

mkdirSync(burnDir, { recursive: true });

if (args.length >= 3) {
  args.slice(0, 3).forEach((source, index) => {
    const target = path.join(burnDir, files[index].name);
    if (!existsSync(source)) {
      console.error(`File not found: ${source}`);
      process.exit(1);
    }
    copyFileSync(source, target);
    console.log(`OK ${files[index].name} ← ${source}`);
  });
  console.log("Burn evolution images ready.");
  process.exit(0);
}

console.log("Burn evolution images — expected files:");
for (const file of files) {
  const target = path.join(burnDir, file.name);
  const status = existsSync(target) ? "OK" : "MISSING";
  console.log(`  [${status}] ${file.name} — ${file.label}`);
}

const missing = files.filter((file) => !existsSync(path.join(burnDir, file.name)));
if (missing.length > 0) {
  console.log("");
  console.log("Copy 3 GIFs into public/images/burn/ with these names, or run:");
  console.log('  node scripts/setup-burn.mjs "path\\level1.gif" "path\\level2.gif" "path\\level3.gif"');
  process.exit(missing.length === files.length ? 1 : 0);
}

console.log("All burn images present.");
