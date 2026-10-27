// Frontend real en una pantalla Android; sólo Google Play/Tauri y la red externa
// se sustituyen. No ejecuta un WebView Android ni acredita instalación nativa.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";

const origin = "http://127.0.0.1:5194";
const available = { available: true, status: "available", immediate: true, priority: 0, stalenessDays: 2, versionCode: 20304 };
let server, browser;
before(async () => {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5194", "--strictPort"], {
    env: { ...process.env, VITE_SUPABASE_URL: "https://supabase.example.test", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Vite no empezó a escuchar")), 10000);
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Vite terminó: ${code}`)));
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("5194")) { clearTimeout(timeout); resolve(); }
    });
  });
  assert.equal((await fetch(origin)).ok, true);
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(update) {
  const context = await browser.newContext({ locale: "es-CL", viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36" });
  await context.route("https://supabase.example.test/**", (route) => route.abort());
  await context.addInitScript((initial) => {
    // Reloj fijo: el regreso ocurre en la misma ventana de seis horas.
    Date.now = () => 1700000000000;
    window.updateState = initial;
    window.nativeCalls = [];
    let id = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => ++id,
      unregisterCallback: () => {},
      invoke: async (command) => {
        window.nativeCalls.push(command);
        if (command === "plugin:planifia-billing|check_update") return { ...window.updateState };
        // Una instalación inmediata interrumpida sigue pendiente en el SDK:
        // su Task no termina antes de que la app vuelva a primer plano.
        if (command === "plugin:planifia-billing|start_update") return new Promise(() => {});
        return { available: false };
      },
    };
  }, update);
  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => window.nativeCalls.includes("plugin:planifia-billing|check_update"));
  return { context, page };
}

test("una actualización opcional interrumpida se consulta y retoma al volver, dentro de las seis horas", async () => {
  const { context, page } = await open(available);
  try {
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Actualizar ahora" }).click();
    await page.waitForFunction(() => window.nativeCalls.includes("plugin:planifia-billing|start_update"));
    const result = await page.evaluate(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.updateState.status = "in_progress";
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      // Checkpoint de tareas/microtareas, sin espera temporal de red ni servicios reales.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return window.nativeCalls;
    });
    assert.equal(result.filter((c) => c === "plugin:planifia-billing|check_update").length, 2,
      "el límite de seis horas no debe impedir detectar una instalación que el usuario ya inició");
    assert.equal(result.filter((c) => c === "plugin:planifia-billing|start_update").length, 2,
      "Play exige retomar el flujo inmediato interrumpido");
  } finally { await context.close(); }
});

test("control: una instalación ya interrumpida al arrancar se retoma", async () => {
  const { context, page } = await open({ ...available, status: "in_progress" });
  try {
    await page.waitForFunction(() => window.nativeCalls.includes("plugin:planifia-billing|start_update"));
    assert.equal(await page.locator("dialog[open]").count(), 0);
  } finally { await context.close(); }
});
