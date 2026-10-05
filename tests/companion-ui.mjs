// Explicit Auth/queue fixtures; actual DOM, CSS and original Web Audio synthesis.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { today, progression } from "../src/domain.js";
const origin = "http://127.0.0.1:5188";
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5188",
    "--strictPort",
  ],
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
  await mkdir("dist/qa", { recursive: true });
  await mkdir("supabase/.temp/lumi-audio-qa", { recursive: true });
  browser = await chromium.launch({
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    headless: true,
  });
  for (const viewport of [
    { width: 1365, height: 950 },
    { width: 390, height: 844 },
  ]) {
    const uid = randomUUID(),
      user = {
        id: uid,
        email: "companion@example.test",
        aud: "authenticated",
        role: "authenticated",
        user_metadata: { name: "Ana" },
      };
    const access_token =
      "eyJhbGciOiJIUzI1NiJ9." +
      Buffer.from(
        JSON.stringify({
          sub: uid,
          exp: Math.floor(Date.now() / 1000) + 7200,
          aud: "authenticated",
        }),
      ).toString("base64url") +
      ".fixture";
    const session = {
      access_token,
      refresh_token: "fixture",
      token_type: "bearer",
      expires_in: 7200,
      expires_at: Math.floor(Date.now() / 1000) + 7200,
      user,
    };
    const context = await browser.newContext({
      viewport,
      reducedMotion: "no-preference",
    });
    await context.addInitScript(
      ({ session }) => {
        if (!localStorage.getItem("planifia-seller-auth"))
          localStorage.setItem("planifia-seller-auth", JSON.stringify(session));
        const Original = window.AudioContext;
        window.audioProof = {
          started: 0,
          stopped: 0,
          disconnected: 0,
          contexts: 0,
          meters: [],
        };
        window.AudioContext = class extends Original {
          constructor(...args) {
            super(...args);
            window.audioProof.contexts++;
          }
          createOscillator() {
            const node = super.createOscillator(),
              start = node.start.bind(node),
              stop = node.stop.bind(node),
              disconnect = node.disconnect.bind(node);
            node.start = (...a) => {
              window.audioProof.started++;
              return start(...a);
            };
            node.stop = (...a) => {
              window.audioProof.stopped++;
              return stop(...a);
            };
            node.disconnect = (...a) => {
              window.audioProof.disconnected++;
              return disconnect(...a);
            };
            return node;
          }
          createGain() {
            const node = super.createGain(), meter = this.createAnalyser();
            meter.fftSize = 256;
            node.connect(meter);
            window.audioProof.meters.push(meter);
            return node;
          }
        };
      },
      { session },
    );
    const date = today(),
      task = {
        id: randomUUID(),
        user_id: uid,
        title: "Mi paso breve",
        minutes: 10,
        priority: "medium",
        status: "pending",
        scheduled_date: date,
        goal_id: null,
      };
    let xp = 0,
      enqueues = 0,
      jobs = [];
    const proposal = {
      title: "Una meta de prueba",
      description: "Propuesta simulada",
      outcome: "Un siguiente paso",
      category: "personal",
      first_action: "Una acción",
      summary: "Una propuesta",
      weekly_minutes: 30,
      start_date: date,
      target_date: null,
      milestones: [
        {
          title: "Un hito",
          tasks: [
            {
              title: "Una acción",
              description: "Detalle",
              priority: "low",
              minutes: 10,
              day_offset: 0,
              deadline: null,
            },
          ],
        },
      ],
    };
    const pet = () => {
      const p = progression(xp);
      return {
        name: "Lumi",
        total_xp: xp,
        level: p.level,
        stage: p.stage,
        level_xp: p.levelXp,
        next_xp: p.nextXp,
      };
    };
    await context.route("https://supabase.example.test/**", async (route) => {
      const url = new URL(route.request().url()),
        body = route.request().postDataJSON() || {};
      let result;
      if (url.pathname.startsWith("/auth/v1/"))
        result = url.pathname.endsWith("/user") ? user : session;
      else if (url.pathname.includes("/functions/v1/goal-plan")) {
        enqueues++;
        const j = {
          id: randomUUID(),
          request_id: body.request_id,
          status: "queued",
          plan_id: "free",
          position: 2,
          estimated_seconds: null,
          worker_online: true,
          kind: "generation",
        };
        jobs.unshift(j);
        result = { job: { id: j.id, status: j.status } };
      } else if (url.pathname.includes("/rpc/")) {
        const name = url.pathname.split("/").at(-1);
        if (name === "pet_state") result = pet();
        else if (name === "get_ai_jobs") result = jobs;
        else if (name === "cancel_ai_job") {
          const job = jobs.find((j) => j.id === body.p_id);
          job.status = job.status === "queued" ? "cancelled" : "processing";
          job.cancel_requested = true;
          result = job;
        } else if (name === "set_task_status") {
          const old = task.status;
          task.status = body.p_status;
          const delta =
            old === task.status ? 0 : task.status === "completed" ? 20 : -20;
          xp += delta;
          result = { xp_delta: delta, pet: pet() };
        } else result = null;
      } else {
        const table = url.pathname.split("/").at(-1);
        result =
          table === "profiles"
            ? {
                user_id: uid,
                name: "Ana",
                timezone: "America/Santiago",
                weekly_minutes: 180,
                available_days: [1, 2, 3, 4, 5],
              }
            : table === "tasks"
              ? [task]
              : [];
      }
      await route.fulfill({
        status: url.pathname.includes("/functions/v1/goal-plan") ? 202 : 200,
        json: result,
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/#today");
    await page
      .getByRole("heading", { name: /Un paso a la vez, Ana/ })
      .waitFor();
    assert.equal(await page.locator("[data-lumi-mood]").count(), 5);
    assert.equal((await page.evaluate(() => window.audioProof)).started, 0);
    assert.equal(await page.getByRole("button", { name: "Silenciar", exact: true }).count(), 1);
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => window.audioProof.started === 6);
    await page.waitForFunction(() => window.audioProof.meters.some((meter) => {
      const samples = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(samples);
      return samples.some((sample) => Math.abs(sample) > 0.015);
    }));
    assert.equal(await page.locator(".lumi-speech-bubble").count(), 1);
    assert.equal(await page.locator(".lumi-talking-mouth").count(), 1);
    await page.getByRole("button", { name: "Cansado", exact: true }).click();
    await page.waitForFunction(() => window.audioProof.started === 12);
    assert.match(
      await page.locator(".lumi-message-text").getAttribute("aria-label"),
      /cansado|pausa|ritmo/,
    );
    assert.equal(
      await page.locator("#pet .lumi-art").getAttribute("data-lumi-state"),
      "idle",
      "Enabling audio or selecting mood never triggers movement",
    );
    assert.equal(
      await page.evaluate(() =>
        Object.keys(localStorage).some((k) => k.includes("mood")),
      ),
      false,
    );
    await page.getByRole("button", { name: "Silenciar", exact: true }).click();
    assert.equal(
      (await page.evaluate(() => window.audioProof)).disconnected,
      12,
    );
    await page
      .getByRole("button", { name: "Mostrar texto completo", exact: true })
      .click();
    assert.equal(
      await page.locator(".lumi-message-text span").textContent(),
      await page.locator(".lumi-message-text").getAttribute("aria-label"),
    );
    await page.getByRole("button", {name:"Activar sonido", exact:true}).click();
    await page.waitForFunction(() => window.audioProof.started === 18);
    await page.screenshot({path:`supabase/.temp/lumi-audio-qa/lumi-bubble-${viewport.width}.png`,fullPage:false});
    await page.getByRole("button", {name:"Silenciar", exact:true}).click();
    assert.equal(enqueues, 0, "Mood and sound do not consume GPU");
    await page.reload();
    await page
      .getByRole("heading", { name: /Un paso a la vez, Ana/ })
      .waitFor();
    assert.equal(await page.locator(".lumi-moods").isVisible(), false);
    assert.equal(await page.getByRole("button", { name: "Activar sonido", exact:true }).count(), 1, "An explicit mute survives reload");
    await page
      .getByRole("button", { name: "Completar: Mi paso breve", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector(".lumi-message-text")
        ?.getAttribute("aria-label")
        ?.match(/completada|suma|esfuerzo/),
    );
    assert.equal(enqueues, 0, "Real progress uses local messages");
    await page.screenshot({
      path: `dist/qa/companion-${viewport.width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Ajustes", exact: true }).click();
    await page.getByLabel("Mostrar el texto completo inmediatamente").check();
    await page.getByLabel("Mensajes espontáneos").selectOption("quiet");
    await page
      .getByLabel("Saludar y preguntar cómo estoy al iniciar una sesión")
      .uncheck();
    await page.getByRole("link", { name: "Hoy", exact: true }).click();
    await page.reload();
    await page
      .getByRole("heading", { name: /Un paso a la vez, Ana/ })
      .waitFor();
    assert.equal(
      await page.locator(".lumi-message-text span").textContent(),
      await page.locator(".lumi-message-text").getAttribute("aria-label"),
    );
    await page
      .getByRole("button", { name: "+ Crear una meta", exact: true })
      .click();
    await page.getByLabel("Mi idea o meta").fill("Una meta recuperable");
    await page.getByLabel("Minutos por semana para esta meta").fill("30");
    await page.getByRole("button", { name: "Proponer un plan con IA" }).click();
    await page
      .locator(".ai-loading")
      .getByRole("heading", { name: "En cola", exact: true })
      .waitFor();
    assert.match(
      await page.locator("[data-plan-position]").textContent(),
      /Posición 2.*Tiempo variable/,
    );
    await page.screenshot({
      path: `dist/qa/queue-${viewport.width}.png`,
      fullPage: false,
    });
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.reload();
    await page
      .getByRole("heading", { name: /Un paso a la vez, Ana/ })
      .waitFor();
    await page.locator("#ai-jobs").click();
    await page.getByRole("heading", { name: "En cola", exact: true }).waitFor();
    assert.equal(enqueues, 1);
    await page
      .getByRole("button", { name: "Cancelar solicitud", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Cancelado", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    jobs[0] = {
      ...jobs[0],
      status: "completed",
      cancel_requested: false,
      result: { proposal, goal_id: null, expected_version: null },
    };
    await page.reload();
    await page
      .getByRole("heading", { name: /Un paso a la vez, Ana/ })
      .waitFor();
    await page.locator("#ai-jobs").click();
    await page.getByRole("button", { name: "Revisar propuesta" }).click();
    await page
      .getByRole("heading", { name: "Tu propuesta, antes de guardar" })
      .waitFor();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.getByRole("link", { name: "Ajustes", exact: true }).click();
    await page.getByLabel("Mostrar el texto completo inmediatamente").uncheck();
    await page.getByRole("link", { name: "Hoy", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", {
        name: "Volver a pendiente: Mi paso breve",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Completar: Mi paso breve", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Volver a pendiente: Mi paso breve",
        exact: true,
      })
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".lumi-message-text span")?.textContent ===
        document
          .querySelector(".lumi-message-text")
          ?.getAttribute("aria-label"),
    );
    assert.equal(
      await page
        .locator(".lumi-talking-mouth")
        .evaluate(
          (el) =>
            el.isConnected &&
            el.getAnimations().filter((a) => a.playState === "running")
              .length === 0,
        ),
      true,
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("link", { name: "Ajustes", exact: true }).click();
    await page.getByLabel("Sonido suave al conversar").check();
    await page.getByRole("link", { name: "Hoy", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Volver a pendiente: Mi paso breve",
        exact: true,
      })
      .click();
    let beforeAudio = (await page.evaluate(() => window.audioProof)).started;
    await page
      .getByRole("button", { name: "Completar: Mi paso breve", exact: true })
      .click();
    await page.waitForFunction(
      (before) => window.audioProof.started > before,
      beforeAudio,
    );
    await page
      .getByRole("button", { name: "Cerrar mensaje", exact: true })
      .click();
    assert.ok(
      (await page.evaluate(() => window.audioProof)).disconnected >=
        beforeAudio + 6,
    );
    await page
      .getByRole("button", {
        name: "Volver a pendiente: Mi paso breve",
        exact: true,
      })
      .click();
    beforeAudio = (await page.evaluate(() => window.audioProof)).started;
    await page
      .getByRole("button", { name: "Completar: Mi paso breve", exact: true })
      .click();
    await page.waitForFunction(
      (before) => window.audioProof.started > before,
      beforeAudio,
    );
    await page.getByRole("link", { name: "Ajustes", exact: true }).click();
    await page
      .getByRole("heading", { name: "Tu ritmo y tus datos", exact: true })
      .waitFor();
    assert.ok(
      (await page.evaluate(() => window.audioProof)).disconnected >=
        beforeAudio + 6,
      "Navigation stops the original audio",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Companion UI desktop/mobile: original Web Audio, mute, session/mood privacy, local progress, settings, reduced speech motion, persistent queue/reload/review/cancel: OK (cloud/GPU fixtures).",
  );
} finally {
  await browser?.close();
  server.kill();
}
