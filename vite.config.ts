import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  root: "frontend",
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.ALDER_DEV_API || "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Packaged CSP permits local fonts, not data URLs (including tiny KaTeX faces).
    assetsInlineLimit: 0,
    // PDF.js also bundles extensionless licence files. Avoid a trailing period,
    // which Windows normalises inconsistently between build and packaging.
    rollupOptions: { output: { assetFileNames: "assets/[name]-[hash][extname]" } },
  },
});
