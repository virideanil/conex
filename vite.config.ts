import { defineConfig } from "vite";

// the api and the live channel come from server/index.ts (port 3000); in
// development vite serves the page and passes those through
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
  build: { target: "es2022", sourcemap: false },
});
