import { cpSync, existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicImages = path.join(__dirname, "public/images");
const collectionImages = path.resolve(__dirname, "../collection/build/images");

function serveImageMiddleware(req, res, next) {
  const name = path.basename(decodeURIComponent((req.url || "/").split("?")[0]));
  const candidates = [
    path.join(publicImages, name),
    path.join(collectionImages, name),
  ];

  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      res.setHeader("Content-Type", "image/gif");
      createReadStream(filePath).pipe(res);
      return;
    }
  }
  next();
}

export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    fs: { allow: [__dirname, path.resolve(__dirname, "../collection/build")] },
  },
  plugins: [
    {
      name: "pixel-trip-images-dev",
      configureServer(server) {
        server.middlewares.use("/images", serveImageMiddleware);
      },
    },
    {
      name: "ensure-preview-images",
      closeBundle() {
        if (!existsSync(publicImages)) {
          console.warn("public/images missing — run: npm run setup-images");
          return;
        }
        const distImages = path.join(__dirname, "dist/images");
        cpSync(publicImages, distImages, { recursive: true, force: true });
        console.log("Ensured preview GIFs in dist/images");
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
