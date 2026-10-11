// Aviso de versión nueva en la app de Android: Google Play simulado (sin cuentas ni red).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5189", "--strictPort"], {
  env: { ...process.env, VITE_SUPABASE_URL: "https://supabase.example.test", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" },
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch("http://127.0.0.1:5189")).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await mkdir("dist/qa", { recursive: true });
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
  });
  await context.route("https://supabase.example.test/**", (route) => route.abort());
  // Tauri en Android: los plugins responden "no disponible", salvo la actualización de Google Play.
  await context.addInitScript(() => {
    const update = JSON.parse(localStorage.getItem("test-update") || "null");
    window.updateCalls = [];
    let id = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => ++id,
      unregisterCallback: () => {},
      invoke: async (command) => {
        window.updateCalls.push(command);
        if (command === "plugin:planifia-billing|check_update") return update || { available: true, status: "none" };
        if (command === "plugin:planifia-billing|start_update") return { status: "cancelled", code: 0 };
        return { available: false };
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async (update) => {
    await page.goto("http://127.0.0.1:5189");
    await page.evaluate((u) => localStorage.setItem("test-update", JSON.stringify(u)), update);
    await page.reload();
    await page.waitForFunction(() => window.updateCalls.includes("plugin:planifia-billing|check_update"));
    await page.waitForTimeout(300);
  };
  const dialog = page.locator("dialog[open]");
  const available = { available: true, status: "available", immediate: true, priority: 0, stalenessDays: 2, versionCode: 20304 };

  await open({ available: true, status: "none" });
  assert.equal(await dialog.count(), 0, "Sin versión nueva no aparece nada");

  await open(available);
  assert.match(await dialog.innerText(), /Hay una versión nueva de PlanifIA/);
  await page.screenshot({ path: "dist/qa/update-offer-mobile.png" });
  await dialog.getByRole("button", { name: "Actualizar ahora" }).click();
  await page.waitForFunction(() => window.updateCalls.includes("plugin:planifia-billing|start_update"));
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  assert.ok(Number(await page.evaluate(() => localStorage.getItem("planifia-update-later"))) > Date.now(), "Cerrar Google Play pospone el aviso");

  await page.reload();
  await page.waitForFunction(() => window.updateCalls.includes("plugin:planifia-billing|check_update"));
  await page.waitForTimeout(300);
  assert.equal(await dialog.count(), 0, "'Más tarde' no vuelve a preguntar el mismo día");

  await page.evaluate(() => localStorage.removeItem("planifia-update-later"));
  await open({ ...available, priority: 5 });
  assert.equal(await dialog.getByRole("button", { name: "Más tarde" }).count(), 0, "Obligatoria: sin 'Más tarde'");
  await page.screenshot({ path: "dist/qa/update-required-mobile.png" });

  await open({ ...available, status: "in_progress" });
  assert.equal(await dialog.count(), 0, "Una actualización a medias se retoma sin preguntar");
  assert.ok(await page.evaluate(() => window.updateCalls.includes("plugin:planifia-billing|start_update")));

  assert.deepEqual(errors, []);
  console.log("Update UI: sin versión nueva no avisa; aviso y 'Más tarde' por un día; obligatoria sin posponer; retoma la instalación a medias: OK.");
} finally {
  await browser?.close();
  server.kill();
}
