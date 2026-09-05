import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const extensionRoot = resolve(process.cwd(), "extension");
const extensionDist = resolve(extensionRoot, "dist");

export default defineConfig({
  root: extensionRoot,
  plugins: [
    react(),
    {
      name: "copy-extension-assets",
      closeBundle() {
        cpSync(resolve(extensionRoot, "manifest.json"), resolve(extensionDist, "manifest.json"));
        cpSync(resolve(extensionRoot, "icons"), resolve(extensionDist, "icons"), { recursive: true });
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(extensionRoot, "sidepanel/index.html"),
        background: resolve(extensionRoot, "background/service-worker.ts"),
        contentSnapshot: resolve(extensionRoot, "content/snapshot.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background/service-worker.js"
            : chunk.name === "contentSnapshot"
              ? "content/snapshot.js"
              : "assets/[name]-[hash].js",
      },
    },
  },
});
