import { cpSync, existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicImages = path.join(__dirname, "public/images");
const collectionImages = path.resolve(__dirname, "../collection/build/images");

function serveImageMiddleware(req, res, next) {
  const rel = decodeURIComponent((req.url || "/").split("?")[0].replace(/^\//, ""));
  const candidates = [
    path.join(publicImages, rel),
    path.join(publicImages, path.basename(rel)),
    path.join(collectionImages, path.basename(rel)),
  ];

  const types = {
    ".gif": "image/gif",
    ".png": "image/png",
    ".webp": "image/webp",
  };

  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader("Content-Type", types[ext] || "application/octet-stream");
      createReadStream(filePath).pipe(res);
      return;
    }
  }
  next();
}

export default defineConfig({
  root: ".",
  publicDir: "public",
  optimizeDeps: {
    exclude: ["viem", "viem/chains"],
  },
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
        console.log("Ensured images in dist/images");
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        burn: path.resolve(__dirname, "burn.html"),
        preview: path.resolve(__dirname, "preview.html"),
      },
      external: ["viem", "viem/chains"],
    },
  },
});
