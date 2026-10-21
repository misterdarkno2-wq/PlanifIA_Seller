// «Continuar con Google» en la app real (Vite) con Supabase y Google simulados: sin cuentas, red ni
// credenciales reales. Cubre la web (ida y vuelta de OAuth), la casilla obligatoria la primera vez,
// rechazarla, una cuenta de correo vinculada, los errores al volver, Android (plugin planifia-auth
// simulado en Tauri) y escritorio. Las reglas de la base están en tests/google-database.test.js.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { LEGAL_VERSION } from "../src/legal.js";
import { GOOGLE_MESSAGES } from "../src/google-auth.js";

const PORT = 5197;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SUPABASE = "https://supabase.example.test";
const CLIENT_ID = "123456789012-abcdefghijklmnop0123456789.apps.googleusercontent.com";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  env: {
    ...process.env,
    VITE_SUPABASE_URL: SUPABASE,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture",
    VITE_GOOGLE_WEB_CLIENT_ID: CLIENT_ID,
  },
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});
let browser;

// Cuentas: una nueva con Google (sin aceptación) y una de correo que ya aceptó y se vinculó a Google.
const accounts = {
  google: {
    id: randomUUID(),
    email: "ana.perez@example.test",
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { name: "Ana Pérez", full_name: "Ana Pérez", avatar_url: "https://lh3.googleusercontent.com/a/fixture" },
    identities: [{ provider: "google" }],
  },
  linked: {
    id: randomUUID(),
    email: "bea@example.test",
    app_metadata: { provider: "email", providers: ["email", "google"] },
    user_metadata: { name: "Bea" },
    identities: [{ provider: "email" }, { provider: "google" }],
  },
};
for (const account of Object.values(accounts)) Object.assign(account, { aud: "authenticated", role: "authenticated" });

function tokens(account) {
  const exp = Math.floor(Date.now() / 1000) + 7200;
  const payload = Buffer.from(JSON.stringify({ sub: account.id, exp, aud: "authenticated" })).toString("base64url");
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`, refresh_token: `fixture-${account.id}`, token_type: "bearer", expires_in: 7200, expires_at: exp };
}

/** Supabase simulado. `next` es la cuenta que Google entregará en el próximo inicio de sesión. */
function supabaseFixture({ googleEnabled = true } = {}) {
  const calls = { authorize: [], idToken: [], accept: [], logout: 0, rpc: [] };
  const acceptances = new Map([[accounts.linked.id, { terms_version: LEGAL_VERSION.terms, privacy_version: LEGAL_VERSION.privacy, platform: "web", accepted_at: "2026-10-21T12:00:00Z" }]]);
  const byToken = new Map();
  const fixture = { calls, acceptances, next: accounts.google };
  fixture.handler = async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      body = request.postDataJSON() || {};
    const json = (result, status = 200) => route.fulfill({ status, json: result });
    const current = byToken.get(request.headers().authorization?.replace(/^Bearer /i, "")) || null;
    if (url.pathname === "/auth/v1/settings") return json({ external: { google: googleEnabled, email: true }, disable_signup: false });
    if (url.pathname === "/auth/v1/authorize") {
      calls.authorize.push(Object.fromEntries(url.searchParams));
      // Google y Supabase devuelven la sesión en el fragmento de la dirección de retorno (flujo implícito).
      const session = tokens(fixture.next);
      byToken.set(session.access_token, fixture.next);
      const hash = new URLSearchParams({ ...session, expires_in: String(session.expires_in), expires_at: String(session.expires_at), type: "signup" });
      return route.fulfill({ status: 302, headers: { location: `${url.searchParams.get("redirect_to")}#${hash}` } });
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "id_token") {
      calls.idToken.push(body);
      const session = tokens(fixture.next);
      byToken.set(session.access_token, fixture.next);
      return json({ ...session, user: fixture.next });
    }
    if (url.pathname === "/auth/v1/user") return current ? json(current) : json({ message: "invalid" }, 401);
    if (url.pathname === "/auth/v1/logout") {
      calls.logout++;
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.pathname.startsWith("/auth/v1/")) return json({ message: "no prevista" }, 400);
    if (url.pathname.endsWith("/rest/v1/legal_acceptances")) return json(current && acceptances.has(current.id) ? [acceptances.get(current.id)] : []);
    if (url.pathname.includes("/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      calls.rpc.push(name);
      if (name === "pet_state") return json({ name: "Lumi", total_xp: 0, level: 1, stage: 1, level_xp: 0, next_xp: 100 });
      if (name === "get_ai_jobs") return json([]);
      if (name === "accept_legal") {
        calls.accept.push(body);
        const row = { terms_version: body.p_terms_version, privacy_version: body.p_privacy_version, platform: body.p_platform, accepted_at: new Date().toISOString() };
        acceptances.set(current.id, row);
        return json(row);
      }
      if (name === "monetization_state")
        return json({
          plan: { id: "free", name: "Gratis", monthly_credits: 0, max_active_goals: 3 },
          plans: [],
          credits: { balance: 60, plan_available: 0, plan_allowance: 0, bonus: 60, cost_per_use: 20, chat_cost: 5 },
          ads: { reward: 10, today: 0, daily_limit: 5 },
          referral: null,
          play_subscription: null,
          products: [],
          recent: [],
        });
      return json(null);
    }
    const table = url.pathname.split("/").at(-1);
    if (table === "profiles")
      return json({ user_id: current?.id, name: current?.user_metadata?.name || "", timezone: "America/Santiago", weekly_minutes: 300, available_days: [1, 2, 3, 4, 5] });
    return json([]);
  };
  return fixture;
}

async function newContext({ android = false, desktopApp = false, mobile = false, googleEnabled = true } = {}) {
  const context = await browser.newContext({
    viewport: mobile || android ? { width: 375, height: 812 } : { width: 1366, height: 900 },
    ...(android ? { userAgent: ANDROID_UA } : {}),
  });
  const fixture = supabaseFixture({ googleEnabled });
  await context.route(`${SUPABASE}/**`, fixture.handler);
  await context.route("https://planifia.cl/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Legal</title>" }));
  if (android || desktopApp)
    // Tauri: el plugin planifia-auth responde según localStorage("test-google"); los demás, "no disponible".
    await context.addInitScript(() => {
      window.authCalls = [];
      let id = 0;
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => ++id,
        unregisterCallback: () => {},
        invoke: async (command, args) => {
          if (command === "plugin:planifia-auth|sign_in_with_google") {
            window.authCalls.push(args);
            if (!/Android/.test(navigator.userAgent)) return { available: false };
            return JSON.parse(localStorage.getItem("test-google") || '{"available":true,"status":"cancelled"}');
          }
          return { available: false };
        },
      };
    });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, fixture, errors };
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(ORIGIN)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  await mkdir("artifacts/qa", { recursive: true });
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });

  // 1. Sin Google activado en Supabase no aparece el botón; el acceso con correo no cambia.
  {
    const { page, context, errors } = await newContext({ googleEnabled: false });
    await page.goto(`${ORIGIN}/#login`);
    await page.getByLabel("Correo electrónico").waitFor();
    await page.waitForTimeout(400);
    assert.equal(await page.getByRole("button", { name: "Continuar con Google" }).isVisible(), false);
    assert.equal(await page.getByRole("button", { name: "Iniciar sesión", exact: true }).isVisible(), true);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 2. Web: el botón está en el inicio de sesión y en el registro, fuera del formulario de correo.
  const web = await newContext();
  {
    const { page, fixture } = web;
    await page.goto(`${ORIGIN}/#register`);
    const google = page.getByRole("button", { name: "Continuar con Google" });
    await google.waitFor();
    assert.match(await page.locator("[data-google-auth]").innerText(), /te pediremos confirmar tu edad y aceptar los términos/);
    assert.equal(await page.locator("#auth-form [data-google-signin]").count(), 0, "No forma parte del formulario de correo");
    assert.equal(await page.getByRole("button", { name: "Crear cuenta", exact: true }).isDisabled(), true, "El registro con correo sigue igual");
    await page.goto(`${ORIGIN}/#login`);
    await google.waitFor();
    await page.screenshot({ path: "artifacts/qa/google-login-desktop.png" });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await noHorizontalScroll(page), true);
    await page.screenshot({ path: "artifacts/qa/google-login-mobile.png" });

    // 3. Ida a Google y vuelta con la sesión en el enlace: la sesión se recupera y la cuenta nueva
    //    ve sólo la casilla obligatoria, sin la app detrás.
    await google.click();
    const gate = page.locator("[data-signup-consent]");
    await gate.getByRole("checkbox", { name: /18 años o más/ }).waitFor();
    assert.deepEqual(fixture.calls.authorize.map((q) => [q.provider, q.redirect_to]), [["google", `${ORIGIN}/`]]);
    assert.doesNotMatch(page.url(), /access_token/, "El token no queda en la dirección");
    assert.ok(await page.evaluate(() => localStorage.getItem("planifia-seller-auth")), "La sesión quedó guardada");
    assert.match(await gate.innerText(), /Entraste con Google como ana\.perez@example\.test/);
    assert.equal(await page.locator(".app-shell, nav[aria-label='Navegación principal']").count(), 0, "La app queda bloqueada");
    const accept = gate.getByRole("button", { name: "Aceptar y continuar" });
    assert.equal(await accept.isDisabled(), true, "La casilla empieza sin marcar");
    for (const name of ["Términos de uso", "Política de privacidad"])
      assert.equal(await gate.getByRole("link", { name }).getAttribute("rel"), "noopener noreferrer");
    assert.equal(await noHorizontalScroll(page), true);
    await page.screenshot({ path: "artifacts/qa/google-consent-mobile.png" });
    // Navegar a otra vista no salta la pantalla.
    for (const route of ["#today", "#lumi", "#subscription", "#settings"]) {
      await page.evaluate((hash) => (location.hash = hash), route);
      await gate.waitFor();
      assert.equal(await page.locator(".app-shell").count(), 0, route);
    }
    assert.deepEqual(
      fixture.calls.rpc.filter((name) => ["monetization_state", "get_ai_jobs", "accept_legal"].includes(name)),
      [],
      "Sin aceptar no se consultan créditos, IA ni compras",
    );

    // 4. No acepta: se cierra la sesión.
    await gate.getByRole("button", { name: "No acepto, cerrar sesión" }).click();
    await page.getByRole("heading", { name: /Tus metas\./ }).waitFor();
    assert.equal(fixture.calls.logout, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem("planifia-seller-auth")), null);
    assert.match(await page.locator("#toast").innerText(), /Cerramos la sesión/);
    assert.equal(fixture.calls.accept.length, 0);

    // 5. Vuelve a entrar y acepta: se guarda con la función existente y ve la app; no se vuelve a pedir.
    await page.goto(`${ORIGIN}/#login`);
    await page.getByRole("button", { name: "Continuar con Google" }).click();
    await gate.getByRole("checkbox", { name: /18 años o más/ }).check();
    await gate.getByRole("button", { name: "Aceptar y continuar" }).click();
    await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
    assert.deepEqual(fixture.calls.accept, [{ p_terms_version: LEGAL_VERSION.terms, p_privacy_version: LEGAL_VERSION.privacy, p_platform: "web" }]);
    assert.equal(await page.locator("[data-legal-update]").count(), 0, "No aparece además el aviso de versión nueva");
    await page.reload();
    await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
    assert.equal(await gate.count(), 0);
    assert.equal(fixture.calls.accept.length, 1);
    assert.deepEqual(web.errors, []);
    await web.context.close();
  }

  // 6. Una cuenta de correo que ya aceptó y entra con Google (identidad vinculada): sin casilla.
  {
    const { page, fixture, errors, context } = await newContext();
    fixture.next = accounts.linked;
    await page.goto(`${ORIGIN}/#login`);
    await page.getByRole("button", { name: "Continuar con Google" }).click();
    await page.getByRole("heading", { name: /Un paso a la vez, Bea/ }).waitFor();
    assert.equal(await page.locator("[data-signup-consent], [data-legal-update]").count(), 0);
    assert.equal(fixture.calls.accept.length, 0);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 7. Volver de Google con un error: se explica en el formulario y el enlace se limpia.
  {
    const { page, errors, context } = await newContext();
    await page.goto(`${ORIGIN}/#error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user`);
    const problem = page.locator("dialog #auth-form [role=alert]");
    await problem.waitFor();
    assert.equal(await problem.innerText(), GOOGLE_MESSAGES.account);
    assert.equal(new URL(page.url()).hash, "#login");
    await page.reload();
    assert.equal(await page.locator("dialog #auth-form [role=alert]").isHidden(), true, "Al recargar no se repite el aviso");
    // Un enlace de confirmación de correo vencido llega igual: ahora también se explica.
    await page.goto("about:blank");
    await page.goto(`${ORIGIN}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    await page.locator("dialog #auth-form [role=alert]").getByText(/venció o ya se usó/).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 8. Android: Credential Manager simulado. Cada estado se explica sin cerrar la app; con el token,
  //    Supabase recibe el nonce original y Google su SHA-256.
  {
    const { page, fixture, errors, context } = await newContext({ android: true });
    await page.goto(`${ORIGIN}/#login`);
    const google = page.getByRole("button", { name: "Continuar con Google" });
    await google.waitFor();
    const problem = page.locator("[data-google-auth] [role=alert]");
    const answer = (value) => page.evaluate((v) => localStorage.setItem("test-google", JSON.stringify(v)), value);
    for (const status of ["no_account", "no_play_services", "offline", "error"]) {
      await answer({ available: true, status });
      await google.click();
      await problem.getByText(GOOGLE_MESSAGES[status]).waitFor();
      assert.equal(await google.isDisabled(), false, `${status}: se puede reintentar`);
    }
    await page.screenshot({ path: "artifacts/qa/google-android-error.png" });
    await answer({ available: true, status: "cancelled" });
    await google.click();
    await page.waitForFunction(() => window.authCalls.length === 5);
    await page.waitForTimeout(200);
    assert.equal(await problem.isHidden(), true, "Cancelar no muestra un error");
    assert.equal(fixture.calls.idToken.length, 0, "Sin token no se llama a Supabase");

    await answer({ available: true, status: "ok", idToken: "google-id-token-fixture" });
    await google.click();
    const gate = page.locator("[data-signup-consent]");
    await gate.getByRole("checkbox", { name: /18 años o más/ }).waitFor();
    const calls = await page.evaluate(() => window.authCalls);
    assert.ok(calls.every((c) => c.serverClientId === CLIENT_ID && /^[0-9a-f]{64}$/.test(c.nonce)));
    assert.equal(new Set(calls.map((c) => c.nonce)).size, calls.length, "Un nonce nuevo en cada intento");
    const [sent] = fixture.calls.idToken;
    assert.equal(sent.provider, "google");
    assert.equal(sent.id_token, "google-id-token-fixture");
    assert.equal(createHash("sha256").update(sent.nonce).digest("hex"), calls.at(-1).nonce, "Google recibió el SHA-256 del nonce de Supabase");
    await gate.getByRole("checkbox", { name: /18 años o más/ }).check();
    await gate.getByRole("button", { name: "Aceptar y continuar" }).click();
    await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
    assert.equal(fixture.calls.accept.at(-1).p_platform, "android");
    assert.equal(fixture.calls.authorize.length, 0, "En Android no se usa OAuth en el WebView");
    assert.equal(await noHorizontalScroll(page), true);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 9. Escritorio (Tauri fuera de Android): no se ofrece Google.
  {
    const { page, errors, context } = await newContext({ desktopApp: true });
    await page.goto(`${ORIGIN}/#login`);
    await page.getByLabel("Correo electrónico").waitFor();
    await page.waitForTimeout(400);
    assert.equal(await page.locator("[data-google-auth]").isVisible(), false);
    assert.deepEqual(errors, []);
    await context.close();
  }

  console.log(
    "UI Google: botón sólo con el proveedor activo, ida y vuelta de OAuth en la web, casilla obligatoria que bloquea la app, rechazo con cierre de sesión, aceptación una sola vez, cuenta vinculada sin casilla, errores al volver, Android con nonce y estados en español, escritorio sin botón: OK",
  );
} finally {
  await browser?.close();
  server.kill();
}
