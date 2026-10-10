import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, process.cwd(), "VITE_").VITE_BASE_PATH || "./",
  // Android 8 y 9 se quedan en WebView 138 como máximo. chrome107 es el mínimo explícito (el valor
  // por defecto de Vite 7): public/compat.js avisa si el WebView es anterior.
  build: { outDir: "dist", sourcemap: false, target: "chrome107" },
}));
