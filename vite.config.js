import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, process.cwd(), "VITE_").VITE_BASE_PATH || "./",
  build: { outDir: "dist", sourcemap: false },
}));
