// Run: node --test tests/reminders-ui.mjs
// Panel «Recordatorios» de Ajustes en la app real (Vite) con Supabase y el plugin planifia-reminders
// simulados: sin cuentas, red ni teléfono reales. La lógica de los avisos está en tests/reminders.test.js
// y la hora en la base en tests/reminders-database.test.js.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { LEGAL_VERSION } from "../src/legal.js";

const PORT = 5199;
const origin = `http://127.0.0.1:${PORT}`;
const serviceOrigin = "https://reminders.example.test";
const A = "11111111-1111-4111-8111-111111111111";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
// Jueves 22 de octubre de 2026, 08:00 en Santiago.
const clockDate = new Date("2026-10-22T11:00:00Z");
let server, browser;

function session(id) {
  const expires_at = Math.floor(new Date("2030-01-01T00:00:00Z").getTime() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: id, exp: expires_at, aud: "authenticated" })).toString("base64url");
  return {
    user: { id, email: "ana@example.test", aud: "authenticated", role: "authenticated", user_metadata: { name: "Ana" } },
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
    refresh_token: `fixture-${id}`,
    token_type: "bearer",
    expires_in: 7200,
    expires_at,
  };
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    env: { ...process.env, VITE_SUPABASE_URL: serviceOrigin, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Vite no arrancó")), 15000);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes(String(PORT))) {
        clearTimeout(deadline);
        resolve();
      }
    });
    server.on("exit", (code) => code && reject(new Error(`Vite terminó con ${code}`)));
  });
  await mkdir("artifacts/qa", { recursive: true });
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function setup(t, { android = true, permission = "granted" } = {}) {
  const context = await browser.newContext({ locale: "es-CL",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "America/Santiago",
    ...(android ? { userAgent: ANDROID_UA } : {}),
  });
  t.after(() => context.close());
  await context.addInitScript(({ saved }) => localStorage.setItem("planifia-seller-auth", JSON.stringify(saved)), { saved: session(A) });
  if (android)
    // Tauri: planifia-reminders responde como el plugin; los demás plugins, "no disponible".
    await context.addInitScript(({ permission }) => {
      let id = 0,
        granted = false;
      window.reminderCalls = [];
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => ++id,
        unregisterCallback: () => {},
        invoke: async (command, args) => {
          if (!command.startsWith("plugin:planifia-reminders|")) return { available: false };
          const name = command.split("|")[1];
          window.reminderCalls.push([name, args]);
          // Un teléfono lento: el estado inicial responde después que el diálogo del permiso.
          if (name === "get_status") await new Promise((r) => setTimeout(r, 300));
          if (name === "request_permission") granted = permission === "granted";
          const status = granted ? "granted" : name === "request_permission" ? "denied" : "prompt";
          return { available: true, permission: status, scheduled: args?.items?.length ?? 0 };
        },
      };
    }, { permission });
  const profile = { user_id: A, name: "Ana", timezone: "America/Santiago", weekly_minutes: 700, available_days: [0, 1, 2, 3, 4, 5, 6], reminder_time: null };
  const writes = [], errors = [];
  await context.route(`${serviceOrigin}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      body = request.postDataJSON() || {};
    const json = (result) => route.fulfill({ status: 200, json: result });
    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, body: "" });
      return json(url.pathname.endsWith("/user") ? session(A).user : session(A));
    }
    if (url.pathname.includes("/rpc/")) {
      const method = url.pathname.split("/").at(-1);
      if (method === "save_reminder_time") {
        writes.push({ method, ...body });
        profile.reminder_time = `${body.p_time}:00`;
        return json(null);
      }
      if (method === "get_ai_jobs") return json([]);
      if (method === "pet_state") return json({ name: "Lumi", stage: 1, level: 1, total_xp: 0, level_xp: 0, next_xp: 100 });
      if (method === "monetization_state")
        return json({ plan: { id: "free", name: "Gratis" }, credits: { balance: 60, cost_per_use: 20, chat_cost: 5 }, products: [], plans: [], recent: [] });
      throw new Error(`RPC inesperada: ${method}`);
    }
    const table = url.pathname.split("/").at(-1);
    if (table === "profiles") return json(profile);
    if (table === "tasks")
      return json([
        { id: "t1", title: "Llamar al médico", status: "pending", scheduled_date: "2026-10-22", goal_id: null, minutes: 20, priority: "medium" },
        { id: "t2", title: "Revisar el presupuesto", status: "pending", scheduled_date: "2026-10-24", goal_id: null, minutes: 20, priority: "medium" },
      ]);
    if (["goals", "milestones", "habits", "habit_completions", "imports"].includes(table)) return json([]);
    if (table === "legal_acceptances")
      return json([{ terms_version: LEGAL_VERSION.terms, privacy_version: LEGAL_VERSION.privacy, platform: "android" }]);
    throw new Error(`URL inesperada: ${url.pathname}`);
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: clockDate });
  await page.goto(`${origin}/#settings`);
  await page.getByRole("heading", { name: "Tu ritmo y tus datos" }).waitFor();
  const calls = () => page.evaluate(() => window.reminderCalls || []);
  return { page, writes, errors, calls };
}

const names = (calls) => calls.map(([name]) => name);

test("Android: apagado por defecto, el permiso se pide al encender y el aviso no revela las acciones", async (t) => {
  const { page, writes, errors, calls } = await setup(t);
  const toggle = page.getByLabel("Recordarme mis pasos del día");
  await page.getByRole("heading", { name: "Recordatorios" }).waitFor();
  assert.equal(await toggle.isChecked(), false);
  assert.equal(await page.getByLabel("Hora del aviso").inputValue(), "09:00");
  assert.deepEqual(names(await calls()).filter((n) => n !== "get_status"), [], "Sin encender no se pide permiso ni se programa");

  await toggle.check();
  await page.getByText("Listo. Te avisaremos").waitFor();
  assert.equal(await toggle.isChecked(), true);
  let schedule = (await calls()).findLast(([name]) => name === "schedule")[1].items;
  assert.deepEqual(
    schedule.map((i) => new Date(i.at).toISOString()),
    ["2026-10-22T12:00:00.000Z", "2026-10-24T12:00:00.000Z"],
  );
  for (const item of schedule) assert.doesNotMatch(`${item.title} ${item.body}`, /médico|presupuesto/);
  assert.match(await page.locator("[data-reminders-note]").textContent(), /Encendido/);

  await page.getByLabel("Hora del aviso").fill("07:15");
  await page.getByRole("button", { name: "Guardar hora" }).click();
  await page.getByText("Hora del recordatorio guardada.").waitFor();
  assert.deepEqual(writes, [{ method: "save_reminder_time", p_time: "07:15" }]);
  await page.waitForFunction(() => window.reminderCalls.filter(([n]) => n === "schedule").length >= 2);
  schedule = (await calls()).findLast(([name]) => name === "schedule")[1].items;
  assert.deepEqual(
    schedule.map((i) => new Date(i.at).toISOString()),
    ["2026-10-24T10:15:00.000Z"],
    "A las 07:15 de hoy ya pasó: queda sólo el sábado",
  );
  assert.equal(await page.getByLabel("Hora del aviso").inputValue(), "07:15");
  assert.equal(await page.getByLabel("Recordarme mis pasos del día").isChecked(), true, "Sigue encendido tras guardar");

  await page.getByLabel("Recordarme mis pasos del día").uncheck();
  await page.waitForFunction(() => window.reminderCalls.at(-1)[0] === "cancel_all");
  await page.getByLabel("Recordarme mis pasos del día").check();
  await page.getByText("Listo. Te avisaremos").first().waitFor();

  // Al cerrar sesión no queda ningún aviso de la cuenta programado en el teléfono.
  const before = (await calls()).length;
  await page.evaluate(async () => {
    const { cloud } = await import("/src/cloud.js");
    await cloud.auth.signOut({ scope: "local" });
  });
  await page.locator(".landing-header").waitFor();
  await page.waitForFunction((n) => window.reminderCalls.slice(n).some(([c]) => c === "cancel_all"), before);
  await page.screenshot({ path: "artifacts/qa/reminders-signed-out.png" });
  assert.deepEqual(errors, []);
});

test("Android: si la persona niega el permiso, queda apagado y se ofrece abrir los ajustes", async (t) => {
  const { page, errors, calls } = await setup(t, { permission: "denied" });
  const toggle = page.getByLabel("Recordarme mis pasos del día");
  // click y no check: la app vuelve a apagarlo en cuanto el teléfono responde que no.
  await toggle.click();
  const open = page.getByRole("button", { name: "Abrir los ajustes del teléfono" });
  await open.waitFor();
  assert.equal(await toggle.isChecked(), false);
  assert.ok(!names(await calls()).includes("schedule"));
  await open.click();
  await page.waitForFunction(() => window.reminderCalls.at(-1)[0] === "open_settings");
  assert.deepEqual(errors, []);
});

test("Android a 320 px: el panel cabe sin desplazamiento horizontal", async (t) => {
  const { page, errors } = await setup(t);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.locator("[data-reminders]").scrollIntoViewIfNeeded();
  await page.locator("[data-reminders]").screenshot({ path: "artifacts/qa/reminders-settings-320.png" });
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 320);
  assert.deepEqual(errors, []);
});

test("Web: no aparece el panel de recordatorios", async (t) => {
  const { page, errors } = await setup(t, { android: false });
  await page.getByRole("heading", { name: "Disponibilidad" }).waitFor();
  assert.equal(await page.locator("[data-reminders]").count(), 0);
  assert.equal(await page.getByText("Recordatorios").count(), 0);
  assert.deepEqual(errors, []);
});
