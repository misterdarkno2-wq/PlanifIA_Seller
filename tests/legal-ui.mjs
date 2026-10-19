// Aceptación de términos, nueva aceptación, reportes de contenido de IA, avisos de crisis y escape de
// cargas XSS en la app real (Vite) con Supabase simulado. Las reglas SQL se prueban en
// tests/legal-database.test.js y las Edge Functions con Deno.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { today } from "../src/domain.js";
import { LEGAL_URLS, LEGAL_VERSION } from "../src/legal.js";
import { CRISIS_MESSAGE } from "../supabase/functions/_shared/crisis.js";

const PORT = 5184;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const XSS = `<img src=x onerror="window.__xss=(window.__xss||0)+1">`;

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  env: {
    ...process.env,
    VITE_SUPABASE_URL: "https://supabase.example.test",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture",
  },
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});
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
  const date = today();
  const goalId = randomUUID();
  const data = {
    profiles: { user_id: uid, name: `Ana ${XSS}`, timezone: "America/Santiago", weekly_minutes: 700, available_days: [0, 1, 2, 3, 4, 5, 6] },
    goals: [{ id: goalId, user_id: uid, title: `Meta ${XSS}`, description: XSS, outcome: `Resultado ${XSS}`, category: "learning", status: "active", version: 1, weekly_minutes: 120 }],
    milestones: [],
    tasks: [{ id: randomUUID(), user_id: uid, goal_id: goalId, title: `Acción ${XSS}`, description: XSS, area: XSS, priority: "medium", status: "pending", minutes: 20, scheduled_date: date }],
    habits: [{ id: randomUUID(), user_id: uid, title: `Hábito ${XSS}`, days: [0, 1, 2, 3, 4, 5, 6], minutes: 10, priority: "low", active: true }],
    habit_completions: [],
    imports: [],
  };
  // La cuenta aceptó una versión anterior: debe aceptar la vigente antes de usar la IA o comprar.
  let legalLatest = { terms_version: "2026-10-09", privacy_version: "2026-10-09", platform: "web", accepted_at: "2026-10-09T12:00:00Z" };
  const calls = { goalPlan: 0, chat: 0, accept: [], reports: [] };
  const chatMessages = [{ id: 1, role: "lumi", content: `Hola de nuevo ${XSS}`, created_at: new Date().toISOString() }];
  const proposal = {
    title: "Hablar inglés con confianza",
    description: "Practicar una presentación breve.",
    category: "learning",
    outcome: "Presentarme durante dos minutos sin apuntes",
    first_action: "Grabar una presentación",
    summary: "Dos pasos pequeños para empezar.",
    weekly_minutes: 140,
    target_date: null,
    start_date: date,
    milestones: [
      {
        title: "Mi presentación",
        tasks: [{ title: "Grabar mi presentación", description: "Escuchar y corregir una frase", priority: "medium", minutes: 20, day_offset: 0, deadline: null }],
      },
    ],
  };
  const jobs = [];

  async function fixture(route) {
    const request = route.request(),
      url = new URL(request.url()),
      body = request.postDataJSON() || {};
    const json = (result, status = 200) => route.fulfill({ status, json: result });
    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, body: "" });
      return json(url.pathname.endsWith("/user") ? user : session);
    }
    if (url.pathname.endsWith("/functions/v1/lumi-chat")) {
      calls.chat++;
      if (body.text === "Mensaje que el modelo responde mal")
        return json({ reply: CRISIS_MESSAGE, source: "safety", crisis: true, credits: null, refunded: true });
      const reply = `Respuesta con ${XSS} y un paso pequeño.`;
      chatMessages.push({ id: chatMessages.length + 1, role: "user", content: body.text }, { id: chatMessages.length + 2, role: "lumi", content: reply });
      return json({ reply, source: "cloud", credits: 50 });
    }
    if (url.pathname.endsWith("/functions/v1/goal-plan")) {
      calls.goalPlan++;
      const job = { id: randomUUID(), request_id: body.request_id, kind: "generation", plan_id: "free", status: "completed", position: 1, worker_online: true, result: { proposal, goal_id: null, expected_version: null } };
      jobs.unshift(job);
      return json({ job: { id: job.id, status: job.status } }, 202);
    }
    if (url.pathname.endsWith("/functions/v1/ai-fallback")) return json({ status: "none" });
    if (url.pathname.endsWith("/rest/v1/lumi_chat_messages")) return json([...chatMessages].reverse());
    if (url.pathname.endsWith("/rest/v1/legal_acceptances")) return json(legalLatest ? [legalLatest] : []);
    if (url.pathname.includes("/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      if (name === "pet_state") return json({ name: "Lumi", total_xp: 0, level: 1, stage: 1, level_xp: 0, next_xp: 100 });
      if (name === "get_ai_jobs") return json(jobs);
      if (name === "accept_legal") {
        calls.accept.push(body);
        legalLatest = { terms_version: body.p_terms_version, privacy_version: body.p_privacy_version, platform: body.p_platform, accepted_at: new Date().toISOString() };
        return json(legalLatest);
      }
      if (name === "report_ai_content") {
        calls.reports.push(body);
        return json({ id: randomUUID(), status: "open" });
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
      throw new Error("RPC no prevista " + name);
    }
    const table = url.pathname.split("/").at(-1);
    return json(data[table] ?? []);
  }

  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  await context.route("https://supabase.example.test/**", fixture);
  // Los enlaces legales abren planifia.cl en otra pestaña; aquí se responde sin salir a Internet.
  await context.route("https://planifia.cl/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Términos</title><h1>Términos de uso</h1>" }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const xssFired = () => page.evaluate(() => window.__xss || 0);
  const noInjectedImages = async () => assert.equal(await page.locator('img[src="x"]').count(), 0, "Ninguna carga XSS se convierte en HTML");

  // 1. Registro: casilla obligatoria, sin marcar; los enlaces se abren aparte sin perder lo escrito.
  await page.goto(`${ORIGIN}/#register`);
  const consent = page.getByRole("checkbox", { name: /18 años o más/ });
  await consent.waitFor();
  assert.equal(await consent.isChecked(), false, "La casilla empieza sin marcar");
  const create = page.getByRole("button", { name: "Crear cuenta", exact: true });
  assert.equal(await create.isDisabled(), true);
  for (const [name, href] of [["Términos de uso", LEGAL_URLS.terms], ["Política de privacidad", LEGAL_URLS.privacy]]) {
    const link = page.locator("#auth-form").getByRole("link", { name });
    assert.equal(await link.getAttribute("href"), href);
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
  }
  await page.getByLabel("Tu nombre", { exact: true }).fill("Ana");
  await page.getByLabel("Correo electrónico").fill("ana@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("corta1");
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.locator("#auth-form").getByRole("link", { name: "Términos de uso" }).click(),
  ]);
  await popup.close();
  assert.equal(await page.getByLabel("Tu nombre", { exact: true }).inputValue(), "Ana", "Lo escrito se conserva");
  assert.equal(await page.getByLabel("Correo electrónico").inputValue(), "ana@example.test");
  await consent.check();
  assert.equal(await create.isDisabled(), false);
  assert.equal(
    await page.getByLabel("Contraseña", { exact: true }).evaluate((input) => input.validity.valid),
    false,
    "La contraseña nueva exige al menos 10 caracteres con letras y números",
  );
  await page.getByLabel("Contraseña", { exact: true }).fill("una-clave-2026");
  assert.equal(await page.getByLabel("Contraseña", { exact: true }).evaluate((input) => input.validity.valid), true);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Sin desplazamiento horizontal en el teléfono");
  await page.screenshot({ path: "dist/qa/legal-register-mobile.png" });
  await page.setViewportSize({ width: 1366, height: 1000 });

  // 2. Inicio de sesión con una versión anterior aceptada: aviso una vez, sin bloquear el resto.
  await page.goto(`${ORIGIN}/#login`);
  await page.getByLabel("Correo electrónico").fill("ana@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
  const notice = page.locator("[data-legal-update]");
  await notice.waitFor();
  assert.match(await notice.innerText(), /Actualizamos los Términos y la Política de privacidad/);
  assert.match(await notice.innerText(), /exportar tus datos[\s\S]*eliminar tu cuenta/);
  assert.equal(await notice.getByRole("button", { name: "Aceptar y continuar" }).isDisabled(), true);
  await page.screenshot({ path: "dist/qa/legal-update-desktop.png" });
  await notice.getByRole("button", { name: "Ahora no" }).click();
  await notice.waitFor({ state: "detached" });
  assert.equal(calls.accept.length, 0);
  // Cargas XSS en nombre, metas, acciones y hábitos: se muestran como texto.
  assert.match(await page.locator(".app-header").innerText(), /Ana <img src=x/);
  assert.match(await page.locator(".goal-card").first().innerText(), /Meta <img src=x/);
  assert.match(await page.locator(".task-row").first().innerText(), /Acción <img src=x/);
  await page.goto(`${ORIGIN}/#habits`);
  await page.getByRole("heading", { name: /Hábito <img src=x/ }).waitFor();
  await noInjectedImages();
  assert.equal(await xssFired(), 0);

  // 3. Antes de usar la IA se pide aceptar dentro del formulario, sin perder la meta escrita.
  await page.goto(`${ORIGIN}/#today`);
  await page.locator("[data-new-goal]").first().click();
  await page.getByLabel("Mi idea o meta").fill("Hablar inglés con confianza");
  await page.getByRole("button", { name: /Proponer un plan con IA/ }).click();
  const gate = page.locator("dialog [data-legal-update]");
  await gate.waitFor();
  await gate.getByRole("button", { name: "Ahora no" }).click();
  await gate.waitFor({ state: "detached" });
  assert.equal(calls.goalPlan, 0, "Sin aceptar no se llama a la IA");
  await page.getByRole("button", { name: /Proponer un plan con IA/ }).click();
  await gate.waitFor();
  assert.equal(await page.getByLabel("Mi idea o meta").inputValue(), "Hablar inglés con confianza");
  await gate.getByRole("checkbox", { name: /18 años o más/ }).check();
  await gate.getByRole("button", { name: "Aceptar y continuar" }).click();
  await page.getByRole("heading", { name: "Tu propuesta, antes de guardar" }).waitFor();
  assert.deepEqual(calls.accept, [{ p_terms_version: LEGAL_VERSION.terms, p_privacy_version: LEGAL_VERSION.privacy, p_platform: "web" }]);
  assert.equal(calls.goalPlan, 1, "Al aceptar continúa la solicitud que la persona había pedido");
  assert.match(await page.locator("dialog").innerText(), /La preparó una IA[\s\S]*no reemplaza consejo médico, psicológico, legal ni financiero/);
  // Reportar la propuesta sin salir de la app.
  await page.getByRole("button", { name: "Reportar esta propuesta" }).click();
  await page.getByRole("button", { name: "Enviar reporte" }).click();
  await page.getByText("Elige qué problema tiene.").waitFor();
  await page.getByLabel("Incorrecta o engañosa").check();
  await page.locator(".ai-report-form textarea").fill("Las fechas no calzan.");
  await page.getByRole("button", { name: "Enviar reporte" }).click();
  await page.getByText(/Gracias. Revisaremos este contenido/).waitFor();
  assert.deepEqual(calls.reports.at(-1), { p_kind: "plan", p_ref: jobs[0].id, p_content: null, p_reason: "wrong", p_details: "Las fechas no calzan." });
  await page.locator("dialog [data-close]").click();

  // 4. Una meta que describe una crisis no llega a la IA: se muestran líneas de ayuda de Chile.
  await page.locator("[data-new-goal]").first().click();
  await page.getByLabel("Mi idea o meta").fill("Salir adelante");
  await page.getByLabel("Mi punto de partida").fill("A veces pienso en quitarme la vida");
  await page.getByRole("button", { name: /Proponer un plan con IA/ }).click();
  const goalHelp = page.locator("dialog [data-crisis-help]");
  await goalHelp.waitFor();
  assert.match(await goalHelp.innerText(), /\*4141[\s\S]*600 360 7777[\s\S]*131[\s\S]*133/);
  assert.equal(calls.goalPlan, 1, "La meta en crisis no se envía");
  await page.locator("dialog [data-close]").click();

  // 5. Chat con Lumi: escape, reporte de respuestas y avisos de crisis (local y del servidor).
  await page.goto(`${ORIGIN}/#lumi`);
  const log = page.locator("[data-lumi-chat-log]");
  await log.getByText(/Hola de nuevo <img src=x/).waitFor();
  assert.equal(await log.getByRole("button", { name: "Reportar respuesta" }).count(), 1, "Cada respuesta guardada se puede reportar");
  const input = page.getByLabel("Mensaje para Lumi");
  await input.fill("Hola Lumi, ¿qué hago hoy?");
  await input.press("Enter");
  await log.getByText(/Respuesta con <img src=x/).waitFor({ timeout: 15000 });
  await noInjectedImages();
  assert.equal(await xssFired(), 0, "Ninguna respuesta de la IA ejecuta código");
  const reply = log.locator(".lumi-chat-lumi").last();
  await reply.getByRole("button", { name: "Reportar respuesta" }).click();
  await reply.getByLabel("Ofensiva o inapropiada").check();
  await reply.getByRole("button", { name: "Enviar reporte" }).click();
  await reply.getByText(/Gracias. Revisaremos este contenido/).waitFor();
  assert.deepEqual(calls.reports.at(-1), {
    p_kind: "chat",
    p_ref: null,
    p_content: `Respuesta con ${XSS} y un paso pequeño.`,
    p_reason: "offensive",
    p_details: "",
  });
  const sentBefore = calls.chat;
  await input.fill("Ya no quiero vivir");
  await input.press("Enter");
  const safety = log.locator(".lumi-chat-safety").last();
  await safety.waitFor();
  assert.match(await safety.innerText(), /\*4141[\s\S]*Salud Responde[\s\S]*No se descontaron créditos/);
  assert.equal(calls.chat, sentBefore, "El mensaje de crisis no sale del teléfono");
  assert.equal(await safety.getByRole("button", { name: "Reportar respuesta" }).count(), 0);
  await input.fill("Mensaje que el modelo responde mal");
  await input.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".lumi-chat-safety").length === 2);
  assert.equal(calls.chat, sentBefore + 1);
  assert.equal(await log.locator(".lumi-chat-lumi").filter({ hasText: "Lo que cuentas importa" }).count(), 0, "El aviso no aparece como respuesta de la IA");
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await safety.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "dist/qa/lumi-crisis-mobile.png" });

  // 6. Ajustes: derechos, versión aceptada y enlaces legales a ancho de teléfono.
  await page.goto(`${ORIGIN}/#settings`);
  const rights = page.locator("[data-rights]");
  await rights.waitFor();
  assert.match(await rights.innerText(), /acceso, rectificación, supresión, oposición, portabilidad o bloqueo/);
  assert.match(await rights.innerText(), /Aceptaste la versión del 18 de octubre de 2026/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await rights.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "dist/qa/settings-rights-mobile.png" });

  assert.deepEqual(errors, []);
  console.log("UI legal: casilla de registro, enlaces sin perder lo escrito, nueva aceptación, reportes, crisis y XSS: OK");
} finally {
  await browser?.close();
  server.kill();
}
