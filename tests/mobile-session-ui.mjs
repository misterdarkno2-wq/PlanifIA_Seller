// Run: node --test tests/mobile-session-ui.mjs
// Browser integration of the real app + Supabase SDK. Only HTTP services are fixtures.
// No real accounts, network services, tokens or AI are used.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { LEGAL_VERSION } from "../src/legal.js";

const origin = "http://127.0.0.1:5193";
const serviceOrigin = "https://mobile-session.example.test";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const habitId = "33333333-3333-4333-8333-333333333333";
const startDate = "2026-10-11";
const clockDate = new Date("2026-10-11T15:00:00Z");
let server, browser;

function session(id) {
  const user = {
    id,
    email: id === A ? "ana@example.test" : "bob@example.test",
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { name: id === A ? "Ana" : "Bob" },
  };
  const expires_at = Math.floor(new Date("2030-01-01T00:00:00Z").getTime() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: id, exp: expires_at, aud: "authenticated" })).toString("base64url");
  return {
    user,
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
    refresh_token: `fixture-${id}`,
    token_type: "bearer",
    expires_in: 7200,
    expires_at,
  };
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5193", "--strictPort"], {
    env: {
      ...process.env,
      VITE_SUPABASE_URL: serviceOrigin,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Fixture Vite server did not become ready")), 15000);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("5193")) {
        clearTimeout(deadline);
        resolve();
      }
    });
    server.on("error", reject);
    server.on("exit", (code) => {
      clearTimeout(deadline);
      if (code) reject(new Error(`Fixture Vite exited ${code}`));
    });
  });
  assert.equal((await fetch(origin)).ok, true);
  await mkdir("dist/qa", { recursive: true });
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function setup(t, { completedHabit = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "America/Santiago",
  });
  t.after(() => context.close());
  await context.addInitScript(({ saved }) => localStorage.setItem("planifia-seller-auth", JSON.stringify(saved)), { saved: session(A) });
  const writes = [], errors = [];
  let currentUser = A;
  const goals = new Map([[A, []], [B, []]]);
  const completions = completedHabit ? [{ id: "fixture-completion", habit_id: habitId, day: startDate, completed: true }] : [];
  await context.route(`${serviceOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON() || {};
    const token = request.headers().authorization?.replace(/^Bearer /i, "");
    const owner = token === session(B).access_token ? B : A;
    const name = owner === A ? "Ana" : "Bob";
    const json = (result) => route.fulfill({ status: 200, json: result });
    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, body: "" });
      if (url.pathname.endsWith("/token")) {
        currentUser = body.email === session(B).user.email ? B : A;
        return json(session(currentUser));
      }
      return json(url.pathname.endsWith("/user") ? session(owner).user : session(currentUser));
    }
    if (url.pathname.includes("/rpc/")) {
      const method = url.pathname.split("/").at(-1);
      if (method === "get_ai_jobs") return json([]);
      if (method === "pet_state") return json({ name: "Lumi", stage: 1, level: 1, total_xp: 0, level_xp: 0, next_xp: 100 });
      if (method === "monetization_state") return json({
        plan: { id: "free", name: "Gratis" },
        credits: { balance: 60, cost_per_use: 20, chat_cost: 5 },
        products: [], plans: [], recent: [],
      });
      if (method === "save_goal") {
        writes.push({ method, owner, data: body.p_data });
        const id = "44444444-4444-4444-8444-444444444444";
        goals.get(owner).push({ ...body.p_data, id, user_id: owner, status: "active", version: 1 });
        return json(id);
      }
      if (method === "set_habit_completion") {
        writes.push({ method, owner, day: body.p_day, completed: body.p_completed });
        completions.push({ id: "next-completion", habit_id: habitId, day: body.p_day, completed: body.p_completed });
        return json({ xp_delta: body.p_completed ? 10 : 0, pet: { name: "Lumi", stage: 1, level: 1, total_xp: 10, level_xp: 10, next_xp: 100 } });
      }
      throw new Error(`Unexpected fixture RPC: ${method}`);
    }
    const table = url.pathname.split("/").at(-1);
    if (table === "profiles") return json({ user_id: owner, name, timezone: "America/Santiago", weekly_minutes: 700, available_days: [0, 1, 2, 3, 4, 5, 6] });
    if (table === "goals") return json(goals.get(owner));
    if (table === "habits") return json(completedHabit && owner === A ? [{ id: habitId, title: "Leer diez minutos", minutes: 10, days: [0, 1, 2, 3, 4, 5, 6], active: true }] : []);
    if (table === "habit_completions") return json(completions);
    if (["milestones", "tasks", "imports"].includes(table)) return json([]);
    if (table === "legal_acceptances")
      return json([{ terms_version: LEGAL_VERSION.terms, privacy_version: LEGAL_VERSION.privacy, platform: "android" }]);
    throw new Error(`Unexpected fixture URL: ${url.pathname}`);
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: clockDate });
  await page.goto(origin);
  await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
  return { page, writes, errors };
}

async function openPrivateDraft(page) {
  await page.locator(".page-heading [data-new-goal]").click();
  await page.locator("#goal-form [name=title]").fill("Borrador privado de Ana");
}

test("SIGNED_OUT closes an already open private dialog", async (t) => {
  const { page, errors } = await setup(t);
  await openPrivateDraft(page);
  // Triggers the same real Auth callback used by expiration and sign-out in another tab.
  // Intentionally bypasses #logout's extra UI cleanup, not the Supabase or app callback.
  await page.evaluate(async () => {
    const { cloud } = await import("/src/cloud.js");
    const result = await cloud.auth.signOut({ scope: "local" });
    if (result.error) throw result.error;
  });
  await page.locator(".landing-header").waitFor();
  assert.deepEqual(errors, []);
  assert.equal(await page.locator("dialog[open]").count(), 0,
    "Ending the session must remove private account dialogs as well as the main view");
});

test("Changing account cannot submit the previous account's draft as the new user", async (t) => {
  const { page, writes, errors } = await setup(t);
  await openPrivateDraft(page);
  await page.evaluate(async () => {
    const { cloud } = await import("/src/cloud.js");
    const result = await cloud.auth.signInWithPassword({ email: "bob@example.test", password: "fixture-password" });
    if (result.error) throw result.error;
  });
  await page.getByRole("heading", { name: /Un paso a la vez, Bob/ }).waitFor();
  // If the old draft survives, exercise its actual consumer and inspect the transmitted owner.
  // A fixed app removes the stale form; it must never send its data with Bob's current token.
  if (await page.locator("#goal-form").count()) {
    await page.getByRole("button", { name: "Crear sin IA", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#goal-form"));
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, [], "Ana's stale form must not create a goal authenticated as Bob");
});

test("Returning after midnight refreshes today's habit before applying its completion", async (t) => {
  const { page, writes, errors } = await setup(t, { completedHabit: true });
  await page.evaluate(() => { location.hash = "habits"; });
  await page.getByRole("heading", { name: "Hábitos a tu ritmo" }).waitFor();
  assert.equal(await page.locator(`[data-habit="${habitId}"]`).getAttribute("data-completed"), "false");
  // Advance the date deterministically, without waiting or running queued UI timers.
  await page.clock.setFixedTime(new Date("2026-10-12T15:00:00Z"));
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.locator(`[data-habit="${habitId}"]`).click();
  await page.waitForFunction(() => !document.querySelector("[data-habit]").disabled);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, [{ method: "set_habit_completion", owner: A, day: "2026-10-12", completed: true }],
    "Yesterday's completed state must not turn the first tap today into an undo of today's habit");
});

test("A normal 320px view and account switch display only the current account", async (t) => {
  const { page, writes, errors } = await setup(t);
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= page.viewportSize().width);
  await page.evaluate(async () => {
    const { cloud } = await import("/src/cloud.js");
    const result = await cloud.auth.signInWithPassword({ email: "bob@example.test", password: "fixture-password" });
    if (result.error) throw result.error;
  });
  await page.getByRole("heading", { name: /Un paso a la vez, Bob/ }).waitFor();
  assert.equal(await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).count(), 0);
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
});

test("A maximum-length goal title fits a 320px screen without horizontal overflow", async (t) => {
  const { page, errors } = await setup(t);
  await page.setViewportSize({ width: 320, height: 740 });
  await openPrivateDraft(page);
  const title = "A".repeat(160); // Valid supported title length; no server-side length exception.
  await page.locator("#goal-form [name=title]").fill(title);
  await page.getByRole("button", { name: "Crear sin IA", exact: true }).click();
  await page.getByRole("button", { name: title, exact: true }).waitFor();
  const bounds = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, layoutViewport: innerWidth }));
  bounds.screen = page.viewportSize().width;
  await page.screenshot({ path: "dist/qa/mobile-session-long-title-320.png", fullPage: true });
  assert.deepEqual(errors, []);
  assert.ok(bounds.scroll <= bounds.screen,
    `A title allowed by the form must wrap rather than expanding the mobile page: ${JSON.stringify(bounds)}`);
});
