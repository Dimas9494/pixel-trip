import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectionDir = path.resolve(__dirname, "../collection/build");
const imagesDir = path.join(collectionDir, "images");
const metadataDir = path.join(collectionDir, "metadata");

function staticDirMiddleware(baseDir, contentTypes) {
  return (req, res, next) => {
    req.url = req.url || "/";
    import("node:fs").then(({ createReadStream, existsSync }) => {
      const filePath = path.join(baseDir, decodeURIComponent(req.url.slice(1)));
      if (!existsSync(filePath)) {
        next();
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
      createReadStream(filePath).pipe(res);
    });
  };
}

export default defineConfig({
  base: "./",
  root: ".",
  publicDir: "public",
  server: {
    fs: {
      allow: [__dirname, collectionDir],
    },
  },
  plugins: [
    {
      name: "pixel-trip-assets",
      configureServer(server) {
        server.middlewares.use(
          "/images",
          staticDirMiddleware(imagesDir, {
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".png": "image/png",
          })
        );
        server.middlewares.use(
          "/metadata",
          staticDirMiddleware(metadataDir, {
            "": "application/json",
          })
        );
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
