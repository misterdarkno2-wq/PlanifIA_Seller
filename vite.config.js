import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, process.cwd(), "VITE_").VITE_BASE_PATH || "./",
  // Android 8 y 9 se quedan como máximo en WebView 138 y algunos teléfonos no lo actualizan:
  // la sintaxis se traduce para WebView/Chrome 87+ (las funciones faltantes están en src/compat.js
  // y en requestSignal de src/platform.js). public/compat.js avisa si el WebView es anterior.
  build: { outDir: "dist", sourcemap: false, target: ["chrome87", "edge88", "firefox78", "safari14"] },
}));
