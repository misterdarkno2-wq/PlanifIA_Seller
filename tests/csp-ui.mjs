// Compila la web como en GitHub Pages (con la CSP en <meta>) y recorre la portada, el registro, la
// sesión, el chat, los ajustes y las páginas legales en teléfono y escritorio. Falla si la CSP bloquea
// algo que la app necesita o si una página se desborda a lo ancho.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { LEGAL_VERSION } from "../src/legal.js";

const PORT = 5185;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = "dist/csp-check";
const env = {
  ...process.env,
  VITE_SUPABASE_URL: "https://supabase.example.test",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture",
  VITE_BASE_PATH: "./",
};
delete env.TAURI_ENV_PLATFORM;
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", ...args], { env, stdio: "ignore" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`vite ${args[0]} terminó con ${code}`))));
  });
await run(["build", "--outDir", OUT, "--emptyOutDir", "--logLevel", "error"]);
const html = await readFile(`${OUT}/index.html`, "utf8");
assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]*connect-src 'self' https:\/\/supabase\.example\.test wss:\/\/supabase\.example\.test/);
assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin" \/>/);
assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "Sin scripts en línea en index.html");

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--outDir", OUT, "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { env, stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(ORIGIN)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  await mkdir("dist/qa", { recursive: true });
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
  const uid = randomUUID();
  const user = { id: uid, email: "ana@example.test", aud: "authenticated", role: "authenticated", user_metadata: { name: "Ana" } };
  const payload = Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 7200, aud: "authenticated" })).toString("base64url");
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`, token_type: "bearer", refresh_token: "fixture", expires_in: 7200, user };
  const tables = {
    profiles: { user_id: uid, name: "Ana", timezone: "America/Santiago", weekly_minutes: 300, available_days: [1, 2, 3, 4, 5] },
    legal_acceptances: [{ terms_version: LEGAL_VERSION.terms, privacy_version: LEGAL_VERSION.privacy, platform: "web", accepted_at: new Date().toISOString() }],
    lumi_chat_messages: [],
  };
  const fixture = async (route) => {
    const url = new URL(route.request().url());
    const json = (result, status = 200) => route.fulfill({ status, json: result });
    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, body: "" });
      return json(url.pathname.endsWith("/user") ? user : session);
    }
    if (url.pathname.endsWith("/functions/v1/lumi-chat")) return json({ reply: "¡Vamos paso a paso!", source: "local", credits: 55 });
    if (url.pathname.includes("/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      if (name === "pet_state") return json({ name: "Lumi", total_xp: 0, level: 1, stage: 1, level_xp: 0, next_xp: 100 });
      if (name === "get_ai_jobs") return json([]);
      if (name === "monetization_state")
        return json({ plan: { id: "free", name: "Gratis" }, plans: [], credits: { balance: 60, cost_per_use: 20, chat_cost: 5 }, products: [], recent: [] });
      if (name === "billing_promotion") return json({ active: false });
      return json(null);
    }
    if (url.pathname.endsWith("/functions/v1/billing")) return json({ plans: [] });
    return json(tables[url.pathname.split("/").at(-1)] ?? []);
  };
  const violations = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    await context.route("https://supabase.example.test/**", fixture);
    await context.addInitScript(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        window.__csp.push(`${event.violatedDirective} ${event.blockedURI}`),
      );
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(`${viewport.width}: ${message.text()}`);
    });
    const collect = async (step) => {
      for (const v of await page.evaluate(() => window.__csp)) violations.push(`${viewport.width} ${step}: ${v}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${step} sin desborde a ${viewport.width}px`);
    };
    await page.goto(`${ORIGIN}/`);
    await page.getByRole("heading", { name: /Tus metas/ }).waitFor();
    // Control: la CSP está activa y este detector la ve (un script en línea inyectado se bloquea).
    const beforeControl = violations.length;
    await page.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.__inline = 1";
      document.body.append(script);
    });
    await page.waitForFunction(() => window.__csp.length > 0);
    assert.equal(await page.evaluate(() => window.__inline), undefined, "La CSP bloquea scripts en línea");
    assert.match((await page.evaluate(() => window.__csp.splice(0)))[0], /^script-src/);
    await page.waitForTimeout(100);
    violations.splice(beforeControl);
    await collect("portada");
    await page.goto(`${ORIGIN}/#register`);
    await page.getByRole("checkbox", { name: /18 años o más/ }).waitFor();
    await collect("registro");
    await page.goto(`${ORIGIN}/#login`);
    await page.getByLabel("Correo electrónico").fill("ana@example.test");
    await page.getByLabel("Contraseña", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
    await page.locator("#pet .lumi-art").waitFor();
    await collect("hoy");
    await page.goto(`${ORIGIN}/#lumi`);
    const input = page.getByLabel("Mensaje para Lumi");
    await input.fill("Hola Lumi");
    await input.press("Enter");
    await page.locator(".lumi-chat-lumi").first().waitFor();
    await collect("chat");
    await page.goto(`${ORIGIN}/#settings`);
    await page.locator("[data-rights]").waitFor();
    await collect("ajustes");
    for (const legal of ["privacidad.html", "terminos.html", "eliminar-cuenta.html", "legal/privacidad-2026-10-09.html", "legal/terminos-2026-10-09.html"]) {
      await page.goto(`${ORIGIN}/${legal}`);
      await page.locator("h1").waitFor();
      await collect(legal);
      if (viewport.width < 500 && !legal.startsWith("legal/"))
        await page.screenshot({ path: `dist/qa/legal-${legal.replace(".html", "")}-mobile.png`, fullPage: false });
    }
    assert.deepEqual(errors, [], `Errores de JavaScript a ${viewport.width}px`);
    await context.close();
  }
  assert.deepEqual(violations, [], "La CSP no bloquea nada que la app necesite");
  console.log("CSP de la web: portada, registro, sesión, chat, ajustes y páginas legales sin bloqueos en teléfono y escritorio: OK");
} finally {
  await browser?.close();
  server.kill();
}
