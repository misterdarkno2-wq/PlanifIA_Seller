// «Olvidé mi contraseña» de punta a punta en la app real (Vite) con Supabase simulado: el pedido vuelve a
// la portada sin "#reset", y el enlace del correo (también el formato antiguo "#reset#access_token=…")
// abre el formulario de la contraseña nueva, guarda la contraseña y no deja el token en la dirección.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { LEGAL_VERSION } from "../src/legal.js";

const PORT = 5198;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SUPABASE = "https://supabase.example.test";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  env: { ...process.env, VITE_SUPABASE_URL: SUPABASE, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture" },
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});

const uid = randomUUID();
const user = {
  id: uid,
  email: "ana@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { name: "Ana" },
};
const exp = Math.floor(Date.now() / 1000) + 3600;
const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: uid, exp, aud: "authenticated" })).toString("base64url")}.fixture`;
const fragment = `access_token=${token}&expires_at=${exp}&expires_in=3600&refresh_token=fixture&token_type=bearer&type=recovery`;

let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(ORIGIN)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  await mkdir("artifacts/qa", { recursive: true });
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });

  async function open(hash) {
    const calls = { recover: [], password: [] };
    const context = await browser.newContext({ locale: "es-CL", viewport: { width: 390, height: 844 } });
    await context.route(`${SUPABASE}/**`, (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const json = (body, status = 200) => route.fulfill({ status, json: body });
      if (url.pathname === "/auth/v1/recover") {
        calls.recover.push({ redirect_to: url.searchParams.get("redirect_to"), ...request.postDataJSON() });
        return json({});
      }
      if (url.pathname === "/auth/v1/user") {
        if (request.method() === "PUT") calls.password.push(request.postDataJSON().password);
        return json(user);
      }
      if (url.pathname === "/auth/v1/settings") return json({ external: { google: false } });
      if (url.pathname.startsWith("/auth/v1/")) return json({ access_token: token, refresh_token: "fixture", token_type: "bearer", expires_in: 3600, user });
      if (url.pathname.endsWith("/legal_acceptances"))
        return json([{ terms_version: LEGAL_VERSION.terms, privacy_version: LEGAL_VERSION.privacy, platform: "web" }]);
      if (url.pathname.endsWith("/profiles"))
        return json({ user_id: uid, name: "Ana", timezone: "America/Santiago", weekly_minutes: 300, available_days: [1, 2, 3] });
      if (url.pathname.endsWith("/pet_state")) return json({ name: "Lumi", total_xp: 0, level: 1, stage: 1, level_xp: 0, next_xp: 100 });
      if (url.pathname.endsWith("/monetization_state")) return json(null);
      return json([]);
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${ORIGIN}/${hash}`);
    return { context, page, calls, errors };
  }

  // 1. Pedir el enlace: Supabase debe volver a la portada, sin "#reset" (agrega su propio fragmento).
  {
    const { context, page, calls, errors } = await open("#login");
    await page.getByLabel("Correo electrónico").fill("ana@example.test");
    await page.getByRole("button", { name: "Olvidé mi contraseña" }).click();
    await page.getByText(/recibirás un enlace para cambiar la contraseña/).waitFor();
    assert.equal(calls.recover.length, 1);
    assert.equal(calls.recover[0].email, "ana@example.test");
    assert.equal(calls.recover[0].redirect_to, `${ORIGIN}/`, "Sin #reset: Supabase no debe quedar con dos #");
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 2. Abrir el enlace del correo, con el formato nuevo y con el antiguo (correos ya enviados y la app
  //    de Android anterior), y guardar la contraseña nueva.
  for (const [label, hash] of [
    ["nuevo", `#${fragment}`],
    ["antiguo", `#reset#${fragment}`],
  ]) {
    const { context, page, calls, errors } = await open(hash);
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("heading", { name: "Una nueva contraseña" }).waitFor();
    assert.doesNotMatch(page.url(), /access_token/, `${label}: el token no queda en la dirección`);
    if (label === "antiguo") await page.screenshot({ path: "artifacts/qa/recovery-mobile.png" });
    await dialog.getByLabel("Contraseña", { exact: true }).fill("una-clave-nueva-2026");
    await dialog.getByRole("button", { name: "Guardar contraseña" }).click();
    await page.getByText("Contraseña actualizada.").waitFor();
    assert.deepEqual(calls.password, ["una-clave-nueva-2026"], label);
    assert.deepEqual(errors, [], label);
    await context.close();
  }

  console.log("UI recuperación: el pedido vuelve sin #reset y el enlace (nuevo y antiguo) abre el formulario, guarda la contraseña y limpia el token: OK");
} finally {
  await browser?.close();
  server.kill();
}
