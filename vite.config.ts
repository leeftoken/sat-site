import { defineConfig } from "vite";

export default defineConfig({
  define: {
    global: "globalThis",
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
});
