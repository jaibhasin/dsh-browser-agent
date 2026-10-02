import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import { extensionIdFromKey } from "./scripts/extension-identity.mjs";
import react from "@vitejs/plugin-react";

const extensionRoot = resolve(process.cwd(), "extension");
const extensionDist = resolve(extensionRoot, "dist");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, extensionRoot, "VITE_DSH_");
  const manifest = JSON.parse(readFileSync(resolve(extensionRoot, "manifest.json"), "utf8"));
  const key = env.VITE_DSH_EXTENSION_KEY ?? manifest.key;
  if (env.VITE_DSH_EXTENSION_ID && (!key || extensionIdFromKey(key) !== env.VITE_DSH_EXTENSION_ID)) {
    throw new Error("The extension key and configured bridge extension ID do not match. Run setup:dsh-profile or reinstall.");
  }
  if (key) manifest.key = key;
  return {
  root: extensionRoot,
  plugins: [
    react(),
    {
      name: "copy-extension-assets",
      closeBundle() {
        writeFileSync(resolve(extensionDist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
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
        microphone: resolve(extensionRoot, "sidepanel/microphone.html"),
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
  };
});
