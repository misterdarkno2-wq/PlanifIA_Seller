// Isolated chat lifecycle checks: deferred fixtures, no accounts or AI calls.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5187", "--strictPort"], {
  env: { ...process.env, VITE_SUPABASE_URL: "https://supabase.example.test", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" },
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch("http://127.0.0.1:5187")).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
  const page = await browser.newPage();
  await page.route("https://supabase.example.test/**", (route) => route.abort());
  await page.goto("http://127.0.0.1:5187");
  await page.evaluate(async () => {
    const { lumiChatPage, mountLumiChat } = await import("/src/lumi-chat.js");
    const root = document.createElement("div");
    document.body.replaceChildren(root);
    root.innerHTML = lumiChatPage({ escape: String });
    window.chatCalls = { send: 0, clear: 0 };
    window.chatController = mountLumiChat(root, {
      api: {
        load: () => new Promise((resolve) => { window.finishLoad = resolve; }),
        send: () => { window.chatCalls.send++; return new Promise((resolve) => { window.finishSend = resolve; }); },
        clear: () => { window.chatCalls.clear++; return new Promise((resolve) => { window.finishClear = resolve; }); },
      },
    });
  });
  const send = page.locator("[data-lumi-chat-send]"), clear = page.locator("[data-lumi-chat-clear]");
  assert.equal(await send.isDisabled(), true);
  assert.equal(await clear.isDisabled(), true);
  await page.evaluate(() => window.finishLoad([{ role: "user", content: "Antes" }, { role: "lumi", content: "Hola" }]));
  await page.waitForFunction(() => !document.querySelector("[data-lumi-chat-send]").disabled);
  await page.locator("textarea").fill("Ahora");
  await send.click();
  assert.equal(await clear.isDisabled(), true, "No borra mientras se guarda una respuesta");
  assert.equal(await send.isDisabled(), true);
  await page.evaluate(() => window.finishSend({ reply: "Un paso pequeño.", credits: 55 }));
  await page.waitForFunction(() => !document.querySelector("[data-lumi-chat-send]").disabled);
  await clear.click();
  await clear.click();
  assert.equal(await send.isDisabled(), true, "No envía mientras se borra");
  assert.equal(await clear.isDisabled(), true);
  await page.evaluate(() => window.finishClear());
  await page.waitForFunction(() => !document.querySelector("[data-lumi-chat-clear]").disabled);
  assert.equal(await page.locator(".lumi-chat-message").count(), 0);
  assert.equal(await page.locator("[data-lumi-chat-say]").getAttribute("aria-label"), null);
  assert.deepEqual(await page.evaluate(() => window.chatCalls), { send: 1, clear: 1 });
  await page.evaluate(() => window.chatController.dispose());
  console.log("Chat UI: carga, envío y borrado excluyentes; limpieza del texto accesible: OK.");
} finally {
  await browser?.close();
  server.kill();
}
