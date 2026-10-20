import { defineConfig, loadEnv } from "vite";
import { webSecurityMeta } from "./scripts/web-csp.js";

// La web publicada lleva su CSP y su política de referencia en etiquetas <meta> (GitHub Pages no
// permite cabeceras). En la compilación de Tauri (TAURI_ENV_PLATFORM) la CSP la pone Tauri desde
// tauri.conf.json con sus propios nonces, así que aquí no se repite.
function webSecurity(supabaseUrl) {
  return {
    name: "planifia-web-security",
    apply: "build",
    transformIndexHtml(html) {
      if (process.env.TAURI_ENV_PLATFORM) return html;
      const charset = '<meta charset="utf-8" />';
      if (!html.includes(charset)) throw new Error("index.html debe declarar <meta charset> para insertar la CSP.");
      return html.replace(charset, `${charset}\n    ${webSecurityMeta(supabaseUrl)}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  return {
    base: env.VITE_BASE_PATH || "./",
    plugins: [webSecurity(env.VITE_SUPABASE_URL)],
    // Android 8 y 9 se quedan como máximo en WebView 138 y algunos teléfonos no lo actualizan:
    // la sintaxis se traduce para WebView/Chrome 87+ (las funciones faltantes están en src/compat.js
    // y en requestSignal de src/platform.js). public/compat.js avisa si el WebView es anterior.
    build: { outDir: "dist", sourcemap: false, target: ["chrome87", "edge88", "firefox78", "safari14"] },
  };
});
