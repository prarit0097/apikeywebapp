import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  // Serve even small fonts as same-origin files, matching the strict CSP.
  build: { outDir: "dist/client", assetsInlineLimit: 0 },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/v1": "http://localhost:4000",
      "/healthz": "http://localhost:4000",
    },
  },
});
