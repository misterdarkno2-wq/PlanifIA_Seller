// Skins de Lumi en el navegador real: Auth y RPC simulados; DOM, CSS y animaciones reales.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { today, progression } from "../src/domain.js";
import { LEGAL_VERSION } from "../src/legal.js";
const origin = "http://127.0.0.1:5196";
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5196", "--strictPort"],
  {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "https://supabase.example.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    },
  },
);
let browser;
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await mkdir("artifacts/qa", { recursive: true });
  browser = await chromium.launch({
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    headless: true,
  });
  for (const [label, viewport] of [
    ["desktop", { width: 1365, height: 950 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const uid = randomUUID(),
      user = { id: uid, email: "skins@example.test", aud: "authenticated", role: "authenticated", user_metadata: { name: "Ana" } };
    const access_token =
      "eyJhbGciOiJIUzI1NiJ9." +
      Buffer.from(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 7200, aud: "authenticated" })).toString("base64url") +
      ".fixture";
    const session = { access_token, refresh_token: "fixture", token_type: "bearer", expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, user };
    const context = await browser.newContext({ locale: "es-CL", viewport, reducedMotion: "no-preference" });
    await context.addInitScript(({ session }) => {
      if (!localStorage.getItem("planifia-seller-auth")) localStorage.setItem("planifia-seller-auth", JSON.stringify(session));
    }, { session });
    const task = { id: randomUUID(), user_id: uid, title: "Mi paso breve", minutes: 10, priority: "medium", status: "pending", scheduled_date: today(), goal_id: null };
    // Nivel 2 a 15 XP del nivel 3, donde se desbloquea Océano.
    let xp = 220;
    const pet = () => {
      const p = progression(xp);
      return { name: "Lumi", total_xp: xp, level: p.level, stage: p.stage, level_xp: p.levelXp, next_xp: p.nextXp };
    };
    await context.route("https://supabase.example.test/**", async (route) => {
      const url = new URL(route.request().url()),
        body = route.request().postDataJSON() || {};
      let result = [];
      if (url.pathname.startsWith("/auth/v1/")) result = url.pathname.endsWith("/user") ? user : session;
      else if (url.pathname.includes("/rpc/")) {
        const name = url.pathname.split("/").at(-1);
        if (name === "pet_state") result = pet();
        else if (name === "set_task_status") {
          const old = task.status;
          task.status = body.p_status;
          const delta = old === task.status ? 0 : task.status === "completed" ? 20 : -20;
          xp += delta;
          result = { xp_delta: delta, pet: pet() };
        } else result = null;
      } else {
        const table = url.pathname.split("/").at(-1);
        result =
          table === "profiles"
            ? { user_id: uid, name: "Ana", timezone: "America/Santiago", weekly_minutes: 180, available_days: [1, 2, 3, 4, 5] }
            : table === "tasks"
              ? [task]
              : table === "legal_acceptances"
                ? [{ terms_version: LEGAL_VERSION.terms, privacy_version: LEGAL_VERSION.privacy, platform: "web" }]
                : [];
      }
      await route.fulfill({ status: 200, json: result });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const petSkin = () => page.locator("#pet .lumi-art").getAttribute("data-lumi-skin");
    const running = (selector) =>
      page.locator(selector).first().evaluate((el) => el.getAnimations().filter((a) => a.playState === "running").length);

    await page.goto(origin + "/#today");
    await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
    assert.equal(await petSkin(), "menta", "Sin elegir, Lumi es la de siempre");
    assert.equal(await page.locator("#pet .lumi-fx").count(), 0);

    await page.locator("#pet").getByRole("button", { name: "Skins" }).click();
    const dialog = page.getByRole("dialog", { name: "Skins de Lumi" });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("radio").count(), 9);
    assert.deepEqual(
      await dialog.getByRole("radio").evaluateAll((inputs) => inputs.filter((i) => !i.disabled).map((i) => i.value)),
      ["menta", "durazno"],
      "En el nivel 2 sólo están las skins iniciales",
    );
    assert.match(await dialog.locator("label", { hasText: "Océano" }).textContent(), /Nivel 3/);
    await dialog.getByText("Durazno", { exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-lumi-skin-preview] .lumi-art")?.dataset.lumiSkin === "durazno");
    assert.equal(await page.evaluate(() => localStorage.getItem("planifia-lumi-skin")), "durazno");
    assert.match(await dialog.locator("[data-lumi-skin-caption]").textContent(), /Durazno/);
    assert.equal(await dialog.locator("[data-lumi-skin-preview] .lumi-art").getAttribute("data-lumi-state"), "celebrate", "La vista previa festeja la skin nueva");
    assert.ok((await running("[data-lumi-skin-preview] .lumi-fx-p")) > 0, "Los corazones se animan en la vista previa");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `artifacts/qa/lumi-skins-picker-${label}.png` });
    await dialog.getByRole("button", { name: "Listo" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelector("#pet .lumi-art")?.dataset.lumiSkin === "durazno");
    assert.ok((await running("#pet .lumi-fx-p")) > 0, "La skin queda animada en la tarjeta");

    await page.locator(`[data-toggle-task="${task.id}"]`).first().click();
    await page.getByText(/Nueva skin para Lumi: Océano\./).waitFor();
    await page.locator("#pet").getByRole("button", { name: "Skins" }).click();
    await dialog.getByText("Océano", { exact: true }).click();
    await dialog.getByRole("button", { name: "Cerrar" }).click();
    await page.waitForFunction(() => document.querySelector("#pet .lumi-art")?.dataset.lumiSkin === "oceano");
    assert.equal(await page.locator("#pet .lumi-fx-bubbles").count(), 1);
    await page.screenshot({ path: `artifacts/qa/lumi-skins-card-${label}.png` });

    await page.reload();
    await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
    assert.equal(await petSkin(), "oceano", "La skin se recuerda al recargar");

    await page.goto(origin + "/#lumi");
    await page.getByRole("heading", { name: "Hablar con Lumi" }).waitFor();
    assert.equal(await page.locator(".lumi-chat-portrait .lumi-art").getAttribute("data-lumi-skin"), "oceano");
    assert.equal(await page.getByRole("button", { name: "Skins" }).count(), 1);

    await page.goto(origin + "/#settings");
    await page.getByRole("heading", { name: "Tu ritmo y tus datos" }).waitFor();
    await page.getByRole("button", { name: "Elegir la skin de Lumi" }).click();
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Listo" }).click();
    await page.getByLabel("Animaciones de Lumi").selectOption("calm");
    await page.goto(origin + "/#today");
    await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
    assert.equal(await running("#pet .lumi-fx-p"), 0, "El modo tranquilo detiene los efectos de la skin");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Lumi skins UI desktop/mobile: picker, level locks, unlock toast, card/chat/settings, persistence and calm mode: OK.");
} finally {
  await browser?.close();
  server.kill();
}
