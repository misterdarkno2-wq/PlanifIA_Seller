// Idioma de la portada y de la app: detección automática, botón ES/EN, pantallas sin texto en español
// cuando se eligió inglés y el idioma que reciben la IA de planes y el chat con Lumi.
// Auth, base de datos e IA son fixtures, igual que en tests/ui.mjs.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { today } from "../src/domain.js";
import { LEGAL_VERSION } from "../src/legal.js";

const PORT = 5179;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  env: { ...process.env, VITE_SUPABASE_URL: "https://supabase.example.test", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture" },
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});

// Palabras y signos que delatan un texto en español que se quedó sin traducir.
const SPANISH = /[áéíóúñ¿¡]|\b(el|los|las|del|para|con|tus|una|que|por|tu|metas|acciones|hábitos|créditos|Guardar|Crear|Cerrar|Hoy|Ajustes)\b/i;
function spanishLeft(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && SPANISH.test(line));
}

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
  const date = today(),
    uid = randomUUID();
  const user = { id: uid, email: "sam@example.test", aud: "authenticated", role: "authenticated", user_metadata: { name: "Sam" } };
  const payload = Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 7200, aud: "authenticated" })).toString("base64url");
  const session = { access_token: "eyJhbGciOiJIUzI1NiJ9." + payload + ".fixture", token_type: "bearer", refresh_token: "fixture", expires_in: 7200, user };
  const goalId = randomUUID(),
    milestoneId = randomUUID();
  const data = {
    profiles: { user_id: uid, name: "Sam", timezone: "America/Santiago", weekly_minutes: 300, available_days: [0, 1, 2, 3, 4, 5, 6] },
    goals: [{ id: goalId, user_id: uid, title: "Run a 5K", description: "Build up running time.", outcome: "Run 5 km without stopping", category: "wellbeing", status: "active", weekly_minutes: 120, version: 1 }],
    milestones: [{ id: milestoneId, goal_id: goalId, title: "First week", position: 0 }],
    tasks: [{ id: randomUUID(), user_id: uid, goal_id: goalId, milestone_id: milestoneId, title: "Walk and jog 20 minutes", description: "", area: "", priority: "medium", minutes: 20, status: "pending", scheduled_date: date, deadline: null }],
    habits: [{ id: randomUUID(), title: "Stretch", days: [0, 1, 2, 3, 4, 5, 6], minutes: 10, priority: "low", active: true }],
    habit_completions: [],
    imports: [],
    legal_acceptances: [{ terms_version: LEGAL_VERSION.terms, privacy_version: LEGAL_VERSION.privacy, platform: "web", accepted_at: new Date().toISOString() }],
  };
  const plans = [
    { id: "free", name: "Gratis", price_clp: 0, max_active_goals: 3, ai_generations: 3, ai_adjustments: 1, monthly_credits: 0, benefits: ["Calendario y hábitos", "Lumi y progreso de tus metas"] },
    { id: "plus", name: "Plus", price_clp: 2750, max_active_goals: 15, ai_generations: 30, ai_adjustments: 15, monthly_credits: 1000, benefits: ["Calendario y hábitos", "Lumi y progreso de tus metas"] },
  ];
  const sent = { plan: [], chat: [] };
  const jobs = [];
  const proposal = {
    title: "Run a 5K",
    description: "Build up running time.",
    category: "wellbeing",
    outcome: "Run 5 km without stopping",
    first_action: "Walk and jog for 20 minutes",
    summary: "Short sessions that grow each week.",
    weekly_minutes: 120,
    target_date: null,
    start_date: date,
    milestones: [{ title: "First week", tasks: [{ title: "Walk and jog", description: "Alternate one minute each", priority: "medium", minutes: 20, day_offset: 0, deadline: null }] }],
  };
  async function fixture(route) {
    const request = route.request(),
      url = new URL(request.url()),
      body = request.postDataJSON() || {};
    let result;
    if (url.pathname.endsWith("/functions/v1/lumi-chat")) {
      sent.chat.push(body);
      return route.fulfill({ status: 200, json: { reply: body.language === "en" ? "Nice! Let's take one small step." : "¡Bien! Demos un paso pequeño.", credits: 55, source: "local" } });
    }
    if (url.pathname.endsWith("/functions/v1/goal-plan")) {
      sent.plan.push(body);
      const job = { id: randomUUID(), request_id: body.request_id, kind: "generation", plan_id: "free", status: "completed", position: 1, estimated_seconds: null, worker_online: true, result: { proposal, goal_id: null, expected_version: null } };
      jobs.unshift(job);
      return route.fulfill({ status: 202, json: { job: { id: job.id, status: job.status } } });
    }
    if (url.pathname.endsWith("/rest/v1/lumi_chat_messages")) return route.fulfill({ status: 200, json: [] });
    if (url.pathname.endsWith("/auth/v1/settings")) return route.fulfill({ status: 200, json: { external: { google: false } } });
    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, body: "" });
      result = url.pathname.endsWith("/user") ? user : session;
    } else if (url.pathname.includes("/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      if (name === "pet_state") result = { name: "Lumi", total_xp: 30, level: 1, stage: 1, level_xp: 30, next_xp: 100 };
      else if (name === "get_ai_jobs") result = jobs;
      else if (name === "billing_state") result = { effective_plan: "free", plans, usage: { active_goals: 1 } };
      else if (name === "monetization_state")
        result = {
          plan: { id: "free", name: "Gratis", monthly_credits: 0, max_active_goals: 3 },
          plans,
          credits: { balance: 60, plan_available: 0, plan_allowance: 0, bonus: 60, cost_per_use: 20, chat_cost: 5 },
          ads: { reward: 10, today: 0, daily_limit: 5 },
          referral: { code: "ABCD2345", inviter_reward: 40, invitee_reward: 20, monthly_limit: 10, rewarded_this_month: 0, can_redeem: true },
          play_subscription: null,
          products: [],
          recent: [{ reason: "welcome", delta: 60, created_at: new Date().toISOString() }],
        };
      else throw new Error("Unknown fixture RPC " + name);
    } else result = data[url.pathname.split("/").at(-1)] ?? [];
    await route.fulfill({ status: 200, json: result });
  }

  // 1. Un navegador en inglés ve la portada en inglés sin tocar nada.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await context.route("https://supabase.example.test/**", fixture);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(ORIGIN);
  await page.getByRole("heading", { name: /Your goals/ }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
  assert.equal(await page.title(), "PlanifIA · Your goals, step by step");
  assert.deepEqual(spanishLeft(await page.locator("#app").innerText()), [], "La portada en inglés no deja texto en español");
  assert.equal(await page.locator(".landing-footer a").first().getAttribute("href"), "./privacy.html");
  await page.screenshot({ path: "artifacts/qa/i18n-landing-en.png", fullPage: true });

  // 2. El botón cambia el idioma al instante y la elección se recuerda al volver a abrir.
  await page.getByRole("button", { name: "Ver en español" }).click();
  await page.getByRole("heading", { name: /Tus metas/ }).waitFor();
  assert.equal(await page.evaluate(() => [document.documentElement.lang, localStorage.getItem("planifia-lang")].join()), "es,es");
  assert.equal(await page.getByRole("button", { name: "Ver en español" }).getAttribute("aria-pressed"), "true");
  await page.reload();
  await page.getByRole("heading", { name: /Tus metas/ }).waitFor();
  assert.equal(await page.locator(".landing-footer a").first().getAttribute("href"), "./privacidad.html");
  await page.getByRole("button", { name: "View in English" }).click();
  await page.getByRole("heading", { name: /Your goals/ }).waitFor();

  // 3. Inicio de sesión y cada pantalla de la app en inglés.
  await page.goto(`${ORIGIN}/#login`);
  await page.getByLabel("Email").fill("sam@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: /One step at a time, Sam/ }).waitFor();
  const routes = ["today", "goals", "tasks", "calendar", "habits", "lumi", "subscription", "plans", "settings"];
  for (const route of routes) {
    await page.goto(`${ORIGIN}/#${route}`);
    await page.locator("#main h1").first().waitFor();
    if (["subscription", "plans"].includes(route)) await page.locator(".billing-loading").waitFor({ state: "detached" });
    if (route === "lumi") await page.getByRole("button", { name: "Send", exact: true }).waitFor();
    const left = spanishLeft(await page.locator(".app-shell").innerText());
    assert.deepEqual(left, [], `Texto en español en #${route}`);
  }
  await page.goto(`${ORIGIN}/#settings`);
  await page.locator("[data-language-panel]").waitFor();
  await page.screenshot({ path: "artifacts/qa/i18n-settings-en.png", fullPage: true });

  // 4. La IA de planes y Lumi reciben el idioma elegido.
  await page.goto(`${ORIGIN}/#today`);
  await page.getByRole("button", { name: "+ Create a goal" }).click();
  await page.getByLabel("My idea or goal").fill("Learn to cook three dinners");
  await page.getByRole("button", { name: "✦ Suggest a plan with AI" }).click();
  await page.getByRole("heading", { name: "Your proposal, before saving" }).waitFor();
  assert.equal(sent.plan.at(-1).language, "en", "La propuesta se pide en inglés");
  assert.deepEqual(spanishLeft(await page.locator("dialog").innerText()), [], "El editor de la propuesta está en inglés");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto(`${ORIGIN}/#lumi`);
  await page.getByLabel("Message for Lumi").fill("Hi Lumi");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.locator(".lumi-chat-lumi").filter({ hasText: "Nice!" }).waitFor();
  assert.equal(sent.chat.at(-1).language, "en", "Lumi responde en inglés");

  // 5. Desde Ajustes se vuelve al español y la IA lo recibe así.
  await page.goto(`${ORIGIN}/#settings`);
  await page.locator("[data-language-panel]").getByRole("button", { name: "Ver en español" }).click();
  await page.getByRole("heading", { name: "Tu ritmo y tus datos" }).waitFor();
  await page.goto(`${ORIGIN}/#lumi`);
  await page.getByLabel("Mensaje para Lumi").fill("Hola Lumi");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.locator(".lumi-chat-lumi").filter({ hasText: "¡Bien!" }).waitFor();
  assert.equal(sent.chat.at(-1).language, "es");

  // 6. En un teléfono la cabecera y la vista caben en ambos idiomas.
  const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, locale: "en-US", isMobile: true, hasTouch: true });
  await phone.route("https://supabase.example.test/**", fixture);
  const mobile = await phone.newPage();
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto(`${ORIGIN}/#login`);
  await mobile.getByLabel("Email").fill("sam@example.test");
  await mobile.getByLabel("Password", { exact: true }).fill("fixture-password");
  await mobile.getByRole("button", { name: "Sign in", exact: true }).click();
  await mobile.getByRole("heading", { name: /One step at a time, Sam/ }).waitFor();
  for (const language of ["en", "es"]) {
    if (language === "es") {
      // En el teléfono el botón está en Ajustes (la cabecera no tiene espacio).
      assert.equal(await mobile.locator(".app-header .lang-toggle").isVisible(), false);
      await mobile.goto(`${ORIGIN}/#settings`);
      await mobile.locator("[data-language-panel]").getByRole("button", { name: "Ver en español" }).click();
      await mobile.getByRole("heading", { name: "Tu ritmo y tus datos" }).waitFor();
      await mobile.goto(`${ORIGIN}/#today`);
      // Lumi vuelve a hablar en el idioma nuevo.
      await mobile.locator(".lumi-message-text").filter({ hasText: SPANISH }).waitFor();
    }
    await mobile.locator("#main h1").first().waitFor();
    const fits = await mobile.evaluate(() => ({
      page: document.documentElement.scrollWidth <= innerWidth,
      header: [...document.querySelectorAll(".app-header button, .app-header .lang-toggle")].every((n) => n.getBoundingClientRect().right <= innerWidth + 0.5),
    }));
    assert.deepEqual(fits, { page: true, header: true }, `La vista cabe en el teléfono (${language})`);
    await mobile.screenshot({ path: `artifacts/qa/i18n-today-phone-${language}.png` });
  }
  await mobile.goto(`${ORIGIN}/#home`);
  await mobile.getByRole("button", { name: "Cerrar sesión" }).click();
  await mobile.getByRole("heading", { name: /Tus metas/ }).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "La portada cabe en el teléfono");

  assert.deepEqual(errors, []);
  console.log("Idioma: detección, botón ES/EN, pantallas en inglés e idioma de la IA verificados.");
} finally {
  await browser?.close();
  server.kill();
}
