// Las respuestas de Auth y de IA son fixtures explícitas. Las reglas SQL se prueban aparte.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { today, progression } from "../src/domain.js";

const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5183",
    "--strictPort",
  ],
  {
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "https://supabase.example.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture",
    },
  },
);
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:5183")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  await mkdir("dist/qa", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const date = today(),
    uid = randomUUID(),
    user = {
      id: uid,
      email: "ana@example.test",
      aud: "authenticated",
      role: "authenticated",
      user_metadata: { name: "Ana" },
    };
  const payload = Buffer.from(
    JSON.stringify({
      sub: uid,
      exp: Math.floor(Date.now() / 1000) + 7200,
      aud: "authenticated",
    }),
  ).toString("base64url");
  const token = "eyJhbGciOiJIUzI1NiJ9." + payload + ".fixture";
  const session = {
    access_token: token,
    token_type: "bearer",
    refresh_token: "fixture",
    expires_in: 7200,
    user,
  };
  const data = {
    profiles: {
      user_id: uid,
      name: "Ana",
      timezone: "America/Santiago",
      weekly_minutes: 700,
      available_days: [0, 1, 2, 3, 4, 5, 6],
    },
    goals: [],
    milestones: [],
    tasks: [],
    habits: [],
    habit_completions: [],
    imports: [],
  };
  let total = 0,
    aiCalls = 0,
    failSave = false,
    nextAi = null;
  function holdAi(status = 200) {
    let release, finished;
    const response = new Promise((resolve) => (release = resolve));
    const done = new Promise((resolve) => (finished = resolve));
    nextAi = { response, status, finished };
    return { release, done };
  }
  const pet = () => {
    const p = progression(total);
    return {
      name: "Lumi",
      total_xp: total,
      level: p.level,
      stage: p.stage,
      level_xp: p.levelXp,
      next_xp: p.nextXp,
    };
  };
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
        tasks: [
          {
            title: "Grabar mi presentación",
            description: "Escuchar y corregir una frase",
            priority: "medium",
            minutes: 20,
            day_offset: 0,
            deadline: null,
          },
          {
            title: "Practicar una conversación",
            description: "Responder tres preguntas",
            priority: "high",
            minutes: 20,
            day_offset: 1,
            deadline: null,
          },
        ],
      },
    ],
  };
  async function fixture(route) {
    const request = route.request(),
      url = new URL(request.url()),
      body = request.postDataJSON() || {};
    let result;
    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/signup")) result = { user, session: null };
      else if (url.pathname.endsWith("/logout"))
        return route.fulfill({ status: 204, body: "" });
      else result = url.pathname.endsWith("/user") ? user : session;
    } else if (url.pathname.includes("/functions/")) {
      aiCalls++;
      const pending = nextAi;
      nextAi = null;
      if (pending) {
        await pending.response;
        try {
          if (pending.status !== 200)
            return await route.fulfill({
              status: pending.status,
              json: { error: "La IA está ocupada. Inténtalo nuevamente." },
            });
          return await route.fulfill({
            status: 200,
            json: {
              proposal,
              goal_id: body.goal_id || null,
              expected_version: body.goal_id
                ? data.goals.find((g) => g.id === body.goal_id).version
                : null,
            },
          });
        } finally {
          pending.finished();
        }
      }
      result = {
        proposal,
        goal_id: body.goal_id || null,
        expected_version: body.goal_id
          ? data.goals.find((g) => g.id === body.goal_id).version
          : null,
      };
    } else if (url.pathname.includes("/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      if (failSave && name === "save_task") {
        failSave = false;
        return route.fulfill({
          status: 503,
          json: { message: "No se pudo guardar la acción.", code: "PGRST503" },
        });
      }
      if (name === "pet_state") result = pet();
      else if (name === "apply_goal_plan") {
        let g = data.goals.find((g) => g.id === body.p_goal_id);
        if (g) {
          data.tasks
            .filter((t) => t.goal_id === g.id && t.status === "pending")
            .forEach((t) => (t.status = "cancelled"));
          Object.assign(g, body.p_plan, { version: g.version + 1 });
        } else {
          g = {
            ...body.p_plan,
            id: randomUUID(),
            user_id: uid,
            status: "active",
            version: 1,
          };
          data.goals.push(g);
        }
        for (const milestone of body.p_plan.milestones) {
          const mid = randomUUID();
          data.milestones.push({
            id: mid,
            goal_id: g.id,
            title: milestone.title,
          });
          for (const t of milestone.tasks) {
            const d = new Date(date + "T12:00:00Z");
            d.setUTCDate(d.getUTCDate() + t.day_offset);
            data.tasks.push({
              ...t,
              id: randomUUID(),
              user_id: uid,
              goal_id: g.id,
              milestone_id: mid,
              status: "pending",
              scheduled_date: d.toISOString().slice(0, 10),
            });
          }
        }
        result = g.id;
      } else if (name === "save_milestone") {
        const m = {
          id: randomUUID(),
          goal_id: body.p_goal_id,
          title: body.p_title,
          position: data.milestones.length,
        };
        data.milestones.push(m);
        result = m.id;
      } else if (name === "save_goal") {
        let g = data.goals.find((g) => g.id === body.p_id);
        if (g) Object.assign(g, body.p_data, { version: g.version + 1 });
        else {
          g = {
            ...body.p_data,
            id: randomUUID(),
            user_id: uid,
            status: "active",
            version: 1,
          };
          data.goals.push(g);
        }
        result = g.id;
      } else if (name === "save_task") {
        let t = data.tasks.find((t) => t.id === body.p_id);
        if (t) Object.assign(t, body.p_data);
        else {
          t = {
            ...body.p_data,
            id: randomUUID(),
            user_id: uid,
            status: "pending",
          };
          data.tasks.push(t);
        }
        result = t.id;
      } else if (name === "set_task_status") {
        const t = data.tasks.find((t) => t.id === body.p_id);
        const amount = { low: 10, medium: 20, high: 35 }[t.priority];
        const delta =
          t.status === body.p_status
            ? 0
            : body.p_status === "completed"
              ? amount
              : -amount;
        t.status = body.p_status;
        total += delta;
        result = { xp_delta: delta, pet: pet() };
      } else if (name === "set_goal_status") {
        data.goals.find((g) => g.id === body.p_id).status = body.p_status;
        result = null;
      } else if (name === "save_profile") {
        Object.assign(data.profiles, {
          name: body.p_name,
          timezone: body.p_timezone,
          weekly_minutes: body.p_minutes,
          available_days: body.p_days,
        });
        result = null;
      } else if (name === "save_habit") {
        let h = data.habits.find((h) => h.id === body.p_id);
        if (h) Object.assign(h, body.p_data);
        else {
          h = { ...body.p_data, id: randomUUID() };
          data.habits.push(h);
        }
        result = h.id;
      } else if (name === "set_habit_completion") {
        let c = data.habit_completions.find(
          (c) => c.habit_id === body.p_id && c.day === body.p_day,
        );
        if (c) c.completed = body.p_completed;
        else {
          c = {
            id: randomUUID(),
            habit_id: body.p_id,
            day: body.p_day,
            completed: body.p_completed,
          };
          data.habit_completions.push(c);
        }
        total += body.p_completed ? 10 : -10;
        result = { xp_delta: body.p_completed ? 10 : -10, pet: pet() };
      } else if (name === "import_legacy") {
        const existing = data.imports.some(
          (i) => i.source === body.p_data.source,
        );
        if (!existing) {
          data.imports.push({
            id: randomUUID(),
            source: body.p_data.source,
            original: body.p_data.original,
          });
          for (const t of body.p_data.items)
            data.tasks.push({ ...t, id: randomUUID() });
        }
        result = {
          added: existing ? 0 : body.p_data.items.length,
          skipped: existing ? body.p_data.items.length : 0,
        };
      } else throw new Error("Unknown fixture RPC " + name);
    } else result = data[url.pathname.split("/").at(-1)] ?? [];
    await route.fulfill({ status: 200, json: result });
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.route("https://supabase.example.test/**", fixture);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto("http://127.0.0.1:5183");
  await page.getByRole("heading", { name: /Tus metas/ }).waitFor();
  await page.screenshot({
    path: "dist/qa/landing-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Empezar", exact: true }).click();
  await page.getByLabel("Tu nombre", { exact: true }).fill("Ana");
  await page.getByLabel("Correo electrónico").fill("ana@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Revisa tu correo" })
    .waitFor();
  async function login(p) {
    await p.goto("http://127.0.0.1:5183/#login");
    await p.getByLabel("Correo electrónico").fill("ana@example.test");
    await p.getByLabel("Contraseña", { exact: true }).fill("fixture-password");
    await p
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await p.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
  }
  async function featuredLumi(p) {
    const card = p.locator("#pet.pet-card.featured");
    await card.waitFor();
    const portrait = await card.locator(".pet-portrait").boundingBox(),
      overview = await p.locator(".overview").boundingBox(),
      bounds = await card.boundingBox(),
      viewport = p.viewportSize();
    assert.ok(bounds.y < overview.y, "Lumi aparece antes de las estadísticas");
    assert.ok(portrait.width >= 140, "El retrato de Lumi tiene protagonismo");
    assert.ok(
      portrait.y + portrait.height <= viewport.height,
      "El retrato es visible en la primera pantalla",
    );
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(await card.getByRole("button").count(), 0);
    assert.equal(await card.locator("[data-greet-pet]").count(), 0);
    assert.equal(await card.getByLabel("Animaciones de Lumi").count(), 0);
  }
  const petSvg = "#pet .lumi-art";
  async function pauseClock(p) {
    await p.clock.pauseAt(await p.evaluate(() => Date.now() + 100));
  }
  async function lumiState(p, root = "#pet") {
    return p.locator(`${root} .lumi-art`).getAttribute("data-lumi-state");
  }
  async function finishLumi(p, root = "#pet") {
    await p.locator(`${root} .lumi-art`).evaluate(async (svg) => {
      const actions = svg
        .getAnimations({ subtree: true })
        .filter((a) => Number.isFinite(a.effect.getTiming().iterations));
      actions.forEach((action) => action.finish());
      await Promise.allSettled(actions.map((action) => action.finished));
    });
    assert.equal(await lumiState(p, root), "idle");
  }
  async function boundedLumi(p, root = "#pet") {
    const bounds = await p.locator(`${root} .pet-portrait`).boundingBox(),
      body = await p.locator(`${root} .lumi-action`).boundingBox(),
      info = await p.locator(`${root} .pet-info`).boundingBox();
    const detail = `${await lumiState(p, root)}, stage ${await p.locator(`${root} .lumi-art`).getAttribute("data-lumi-stage")}, phase ${await p.locator(`${root} .lumi-art`).getAttribute("data-test-phase")}: ${JSON.stringify({ body, bounds })}`;
    assert.ok(
      body.x >= bounds.x - 1,
      `Lumi no sale por la izquierda (${detail})`,
    );
    assert.ok(body.y >= bounds.y - 1, `Lumi no sale por arriba (${detail})`);
    assert.ok(
      body.x + body.width <= bounds.x + bounds.width + 1,
      `Lumi no sale por la derecha (${detail})`,
    );
    assert.ok(
      body.y + body.height <= bounds.y + bounds.height + 1,
      `Lumi no sale por abajo (${detail})`,
    );
    assert.ok(
      body.x + body.width <= info.x || body.y + body.height <= info.y,
      "El personaje no invade el texto del planificador",
    );
    assert.equal(
      await p
        .locator(`${root} .lumi-art`)
        .evaluate((svg) => getComputedStyle(svg).transform),
      "none",
      "La tarjeta y el SVG no giran",
    );
  }
  async function sampleAction(p, root = "#pet") {
    for (let fraction = 0; fraction < 1; fraction += 0.1) {
      await p.locator(`${root} .lumi-art`).evaluate((svg, progress) => {
        svg.dataset.testPhase = String(progress);
        const actions = svg
          .getAnimations({ subtree: true })
          .filter((a) => Number.isFinite(a.effect.getTiming().iterations));
        for (const action of actions) {
          action.pause();
          action.currentTime = action.effect.getTiming().duration * progress;
        }
        const characterActions = actions.filter((a) =>
          a.effect.target.classList.contains("lumi-action"),
        );
        if (characterActions.length > 1)
          throw new Error("No deben superponerse dos acciones del personaje");
      }, fraction);
      await boundedLumi(p, root);
    }
  }
  async function autonomousLumi(p, { cycles = 4 } = {}) {
    await pauseClock(p);
    assert.equal(await lumiState(p), "idle");
    const before = await p.locator(petSvg).evaluate((svg) =>
      svg
        .getAnimations({ subtree: true })
        .map((a) => a.animationName || "WAAPI")
        .sort(),
    );
    await p.locator("#pet .pet-portrait").hover();
    await p.locator("#pet .pet-portrait").click();
    assert.equal(
      await lumiState(p),
      "idle",
      "Clic y cursor no activan acciones",
    );
    assert.equal(await p.locator("#pet.pet-greeting").count(), 0);
    assert.deepEqual(
      await p.locator(petSvg).evaluate((svg) =>
        svg
          .getAnimations({ subtree: true })
          .map((a) => a.animationName || "WAAPI")
          .sort(),
      ),
      before,
      "Clic y cursor no añaden animaciones",
    );
    const seen = new Set();
    for (let i = 0; i < cycles; i++) {
      await p.clock.fastForward(21000);
      const action = await lumiState(p);
      assert.ok(
        ["walk", "look", "jump", "stretch", "turn", "flip"].includes(action),
        "Una acción espontánea comienza sin interactuar",
      );
      seen.add(action);
      const destination =
        action === "walk"
          ? await p.locator("#pet .lumi-position").evaluate((position) => {
              const movement = position
                .getAnimations()
                .find((a) => Number.isFinite(a.effect.getTiming().iterations));
              return new DOMMatrix(
                movement.effect.getKeyframes().at(-1).transform,
              ).m41;
            })
          : null;
      await sampleAction(p);
      await finishLumi(p);
      if (destination !== null) {
        const settled = await p
          .locator("#pet .lumi-position")
          .evaluate(
            (position) =>
              new DOMMatrix(getComputedStyle(position).transform).m41,
          );
        assert.ok(
          Math.abs(settled - destination) < 0.1,
          "Caminar mantiene la posición alcanzada y no vuelve al centro",
        );
      }
      await boundedLumi(p);
      await p.clock.fastForward(7000);
      assert.equal(
        await lumiState(p),
        "idle",
        "Cada acción deja una pausa tranquila",
      );
    }
    assert.ok(seen.size > 1, "Las acciones espontáneas varían");
    await p.clock.fastForward(21000);
    const activeState = await lumiState(p);
    await p.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      await p
        .locator(petSvg)
        .evaluate((svg) =>
          svg
            .getAnimations({ subtree: true })
            .every((a) => a.playState === "paused"),
        ),
      true,
      "Ocultar la pestaña pausa también respiración y parpadeo",
    );
    const position = await p.locator("#pet .lumi-position").boundingBox();
    await p.clock.fastForward(60000);
    assert.equal(await lumiState(p), activeState);
    assert.deepEqual(
      await p.locator("#pet .lumi-position").boundingBox(),
      position,
      "El tiempo oculto no mueve ni acumula acciones",
    );
    await p.evaluate(() => {
      delete document.hidden;
      delete document.visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await finishLumi(p);
    await p.clock.resume();
  }
  async function lumiGeometry(p) {
    await pauseClock(p);
    const issues = [];
    for (const stage of [1, 2, 3, 4, 5]) {
      for (const action of [
        "walk",
        "look",
        "jump",
        "stretch",
        "turn",
        "flip",
        "celebrate",
      ]) {
        await p.evaluate(
          async ({ action, stage }) => {
            const { createPetBehavior, LUMI_BEHAVIOR } =
              await import("/src/pet-behavior.js");
            const { portrait } = await import("/src/pet-art.js");
            const copy = document.querySelector("#pet").cloneNode(true);
            copy.id = "lumi-geometry-probe";
            copy.removeAttribute("aria-labelledby");
            copy.setAttribute("aria-hidden", "true");
            copy
              .querySelectorAll("[id]")
              .forEach((element) => element.removeAttribute("id"));
            copy.querySelector(".pet-portrait").innerHTML = portrait(stage);
            document.querySelector("#pet").after(copy);
            const breathing = copy
              .querySelector(".lumi-body")
              .getAnimations()[0];
            breathing.pause();
            breathing.currentTime = 2250;
            window.geometryController = createPetBehavior(
              copy.querySelector(".lumi-art"),
              {
                config: {
                  ...LUMI_BEHAVIOR,
                  actions:
                    action === "celebrate"
                      ? LUMI_BEHAVIOR.actions
                      : { [action]: LUMI_BEHAVIOR.actions[action] },
                },
                random: () => 0.75,
                initialPosition: LUMI_BEHAVIOR.maxTravel,
                lastFlipAt: -Infinity,
              },
            );
            if (action === "celebrate")
              window.geometryController.celebrate("evolve");
          },
          { action, stage },
        );
        if (action !== "celebrate") await p.clock.fastForward(21000);
        assert.equal(await lumiState(p, "#lumi-geometry-probe"), action);
        try {
          await sampleAction(p, "#lumi-geometry-probe");
          await finishLumi(p, "#lumi-geometry-probe");
          await boundedLumi(p, "#lumi-geometry-probe");
        } catch (error) {
          issues.push(`Etapa ${stage}, ${action}: ${error.message}`);
        }
        await p.evaluate(() => {
          window.geometryController.dispose();
          document.querySelector("#lumi-geometry-probe").remove();
          delete window.geometryController;
        });
      }
    }
    await p.clock.resume();
    assert.deepEqual(issues, [], issues.join("\n"));
  }
  async function waitingPlan(p) {
    const loader = p.locator(".ai-loading"),
      host = p.getByRole("dialog");
    await loader.waitFor();
    assert.equal(await loader.getByLabel("Animaciones de Lumi").count(), 0);
    assert.equal(await loader.getAttribute("role"), "status");
    assert.equal(await loader.getAttribute("aria-live"), "polite");
    assert.equal(await loader.getAttribute("aria-atomic"), "true");
    assert.equal(
      await p.locator("#goal-form").getAttribute("aria-busy"),
      "true",
    );
    assert.notEqual(await host.getAttribute("aria-busy"), "true");
    await loader
      .getByRole("heading", { name: "Lumi está preparando tu plan" })
      .waitFor();
    assert.equal(await p.locator("#goal-form").isVisible(), false);
    assert.equal(
      await p
        .locator("#goal-form")
        .evaluate((form) =>
          [...form.elements].every((control) => control.disabled),
        ),
      true,
    );
    assert.equal(
      await host
        .getByRole("button", { name: "Cerrar", exact: true })
        .isEnabled(),
      true,
    );
    assert.equal(
      await loader
        .locator("[data-plan-elapsed]")
        .evaluate((timer) => Boolean(timer.closest('[aria-hidden="true"]'))),
      true,
    );
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  async function waitAiCalls(expected) {
    for (let i = 0; i < 100 && aiCalls < expected; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(aiCalls, expected);
  }
  await login(page);
  await featuredLumi(page);
  for (const part of [".lumi-body", ".lumi-eyes"])
    assert.notEqual(
      await page
        .locator(`#pet ${part}`)
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
  await autonomousLumi(page);
  assert.equal(total, 0, "Las acciones espontáneas de Lumi no entregan XP");
  await page
    .getByRole("button", { name: "+ Crear una meta", exact: true })
    .click();
  await page.getByLabel("Mi idea o meta").fill("Quiero hablar inglés");
  await page.getByLabel("Minutos por semana para esta meta").fill("140");
  const firstPlan = holdAi();
  await page.getByRole("button", { name: "Proponer un plan con IA" }).click();
  await waitingPlan(page);
  await waitAiCalls(1);
  await page
    .locator("#ai-plan")
    .evaluate((button) =>
      button.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  await page
    .locator("#goal-form")
    .evaluate((form) =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
  assert.equal(aiCalls, 1, "Repetir el clic no duplica la generación");
  assert.equal(
    data.goals.length,
    0,
    "El formulario no se guarda mientras genera",
  );
  await page.screenshot({
    path: "dist/qa/loading-desktop.png",
    fullPage: false,
  });
  firstPlan.release();
  await firstPlan.done;
  await page
    .getByRole("heading", { name: "Tu propuesta, antes de guardar" })
    .waitFor();
  assert.equal(await page.locator(".ai-loading").count(), 0);
  assert.equal(data.goals.length, 0);
  await page
    .locator("[data-field=title]")
    .first()
    .fill("Grabar una presentación de dos minutos");
  await page
    .getByRole("button", { name: "Confirmar y guardar el plan" })
    .click();
  await page
    .getByRole("button", { name: "Hablar inglés con confianza", exact: true })
    .waitFor();
  assert.equal(data.goals.length, 1);
  assert.equal(aiCalls, 1);
  await page.screenshot({
    path: "dist/qa/dashboard-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Hablar inglés con confianza", exact: true })
    .click();
  await page.getByRole("button", { name: "+ Crear hito" }).click();
  await page
    .getByLabel("Qué quiero completar en esta etapa")
    .fill("Una conversación real");
  await page.getByRole("button", { name: "Guardar hito" }).click();
  await page.getByRole("heading", { name: "Una conversación real" }).waitFor();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Completar: Grabar una presentación de dos minutos",
      exact: true,
    })
    .click();
  await page.getByText("+20 XP.", { exact: false }).waitFor();
  assert.equal(total, 20);
  assert.equal(await lumiState(page), "celebrate");
  assert.equal(
    await page.locator(petSvg).getAttribute("data-lumi-reaction"),
    "happy",
  );
  await finishLumi(page);
  await page
    .getByRole("button", {
      name: "Volver a pendiente: Grabar una presentación de dos minutos",
      exact: true,
    })
    .click();
  await page.getByText("Se ajustaron 20 XP", { exact: false }).waitFor();
  assert.equal(total, 0);
  assert.equal(
    await lumiState(page),
    "idle",
    "Retirar XP no provoca celebración",
  );
  // Progreso previo cargado desde el servidor: el nuevo paso cruza un umbral.
  for (const [startingXp, expectedLevel, expectedStage, reaction, message] of [
    [95, 2, 1, "level", "¡Nivel 2!"],
    [600, 5, 2, "evolve", "¡Lumi evolucionó!"],
  ]) {
    total = startingXp;
    data.tasks[0].status = "pending";
    await page.reload();
    await page
      .getByRole("heading", { name: /Un paso a la vez, Ana/ })
      .waitFor();
    await page
      .getByRole("button", {
        name: "Completar: Grabar una presentación de dos minutos",
        exact: true,
      })
      .click();
    await page.getByText(message, { exact: false }).waitFor();
    assert.equal(total, startingXp + 20);
    assert.equal(progression(total).level, expectedLevel);
    assert.equal(
      await page.locator(petSvg).getAttribute("data-lumi-stage"),
      String(expectedStage),
    );
    assert.equal(await lumiState(page), "celebrate");
    assert.equal(
      await page.locator(petSvg).getAttribute("data-lumi-reaction"),
      reaction,
    );
    await sampleAction(page);
    await finishLumi(page);
  }
  total = 0;
  data.tasks[0].status = "pending";
  await page.reload();
  await page.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
  await page
    .getByRole("button", { name: "Reprogramar / editar" })
    .first()
    .click();
  await page.getByLabel("Hacer el", { exact: true }).fill("2026-10-25");
  await page
    .getByRole("button", { name: "Guardar acción", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(data.tasks[0].scheduled_date, "2026-10-25");
  await page
    .getByRole("button", { name: "Hablar inglés con confianza", exact: true })
    .click();
  await page.getByRole("button", { name: "Revisar / ajustar con IA" }).click();
  await page.getByRole("button", { name: "Proponer un plan con IA" }).click();
  await page.getByRole("heading", { name: "Revisar el ajuste" }).waitFor();
  await page
    .getByRole("button", { name: "Confirmar y guardar el plan" })
    .click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(data.tasks.filter((t) => t.status === "cancelled").length, 2);
  await page
    .getByRole("button", { name: "Hablar inglés con confianza", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar que logré mi meta" })
    .click();
  await page.getByRole("button", { name: "Sí, alcancé mi meta" }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(data.goals[0].status, "achieved");
  await page.getByRole("link", { name: "Hábitos", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Crear hábito", exact: true })
    .click();
  await page.getByLabel("Qué quiero repetir").fill("Leer diez minutos");
  await page
    .getByLabel(
      ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][
        new Date(date + "T12:00:00").getDay()
      ],
      { exact: true },
    )
    .check();
  await page.getByRole("button", { name: "Guardar hábito" }).click();
  await page.getByRole("button", { name: "Marcar hoy como hecho" }).click();
  await page.getByRole("button", { name: "✓ Hecho hoy · deshacer" }).waitFor();
  assert.equal(data.habit_completions.length, 1);
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await page.locator("#import-file").setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        sourceId: "legacy-user-1",
        tareas: [
          {
            id: 1,
            titulo: "Tarea anterior",
            asignatura: "Biología",
            fecha_entrega: "2026-10-20",
            tiempo_estimado: 600,
          },
        ],
      }),
    ),
  });
  await page.getByLabel("Confirmo que estos datos son míos").check();
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(data.imports.length, 1);
  await page.getByRole("link", { name: "Acciones", exact: true }).click();
  await page
    .locator(".task-row")
    .filter({ hasText: "Tarea anterior" })
    .getByRole("button", { name: "Reprogramar / editar" })
    .click();
  await page.getByLabel("Hacer el", { exact: true }).fill("2026-10-26");
  await page
    .getByRole("button", { name: "Guardar acción", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(
    data.tasks.find((t) => t.title === "Tarea anterior").minutes,
    600,
  );
  await page.getByRole("button", { name: "+ Crear acción" }).click();
  await page.getByLabel("Acción", { exact: true }).fill("No debe guardarse");
  failSave = true;
  await page
    .getByRole("button", { name: "Guardar acción", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "No se pudo guardar" })
    .waitFor();
  assert.equal(
    data.tasks.some((t) => t.title === "No debe guardarse"),
    false,
  );
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();

  await page.getByRole("link", { name: "Hoy", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Crear una meta", exact: true })
    .click();
  await page.getByLabel("Mi idea o meta").fill("Retomar mi inglés");
  await page.getByLabel("Minutos por semana para esta meta").fill("140");
  const failedPlan = holdAi(503);
  await page.getByRole("button", { name: "Proponer un plan con IA" }).click();
  await waitingPlan(page);
  await waitAiCalls(3);
  failedPlan.release();
  await failedPlan.done;
  await page
    .getByRole("alert")
    .filter({ hasText: "La IA está ocupada" })
    .waitFor();
  assert.equal(await page.locator(".ai-loading").count(), 0);
  assert.notEqual(
    await page.getByRole("dialog").getAttribute("aria-busy"),
    "true",
  );
  assert.notEqual(
    await page.locator("#goal-form").getAttribute("aria-busy"),
    "true",
  );
  assert.equal(
    await page.getByLabel("Mi idea o meta").inputValue(),
    "Retomar mi inglés",
  );
  assert.equal(
    await page
      .locator("#goal-form")
      .evaluate((form) =>
        [...form.elements].every((control) => !control.disabled),
      ),
    true,
    "Un error restaura el formulario y permite reintentar",
  );
  assert.equal(data.goals.length, 1);
  const retryPlan = holdAi();
  await page.getByRole("button", { name: "Proponer un plan con IA" }).click();
  await waitingPlan(page);
  await waitAiCalls(4);
  assert.equal(
    (await page.locator("#goal-form [role=alert]").getAttribute("hidden")) !==
      null,
    true,
  );
  retryPlan.release();
  await retryPlan.done;
  await page
    .getByRole("heading", { name: "Tu propuesta, antes de guardar" })
    .waitFor();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  assert.equal(
    data.goals.length,
    1,
    "Reintentar no guarda una propuesta sin confirmación",
  );

  await page
    .getByRole("button", { name: "+ Crear una meta", exact: true })
    .click();
  await page.getByLabel("Mi idea o meta").fill("Una idea para después");
  await page.getByLabel("Minutos por semana para esta meta").fill("140");
  const closedPlan = holdAi();
  await page.getByRole("button", { name: "Proponer un plan con IA" }).click();
  await waitingPlan(page);
  await waitAiCalls(5);
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  assert.equal(await page.locator("dialog").count(), 0);
  closedPlan.release();
  await closedPlan.done;
  await page.waitForLoadState("networkidle");
  assert.equal(
    await page.locator("dialog").count(),
    0,
    "Una respuesta tardía no reabre el diálogo",
  );
  assert.equal(await page.locator(".ai-loading").count(), 0);
  assert.equal(data.goals.length, 1);
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Iniciar sesión", exact: true })
    .waitFor();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await mobile.route("https://supabase.example.test/**", fixture);
  const phone = await mobile.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.clock.install();
  await login(phone);
  await featuredLumi(phone);
  await phone.screenshot({
    path: "dist/qa/dashboard-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await phone.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    true,
  );
  assert.equal(
    await phone.locator(petSvg).getAttribute("data-lumi-motion"),
    "animated",
  );
  for (const part of [".lumi-body", ".lumi-eyes"])
    assert.notEqual(
      await phone
        .locator(`#pet ${part}`)
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
      "Lumi respira y parpadea desde el primer inicio aunque el dispositivo reduzca movimiento",
    );
  await autonomousLumi(phone, { cycles: 2 });
  async function setPhoneMotion(mode) {
    await phone.getByRole("link", { name: "Ajustes", exact: true }).click();
    const selector = phone
      .locator(".pet-motion-panel")
      .getByLabel("Animaciones de Lumi");
    await selector.selectOption(mode);
    assert.equal(await selector.inputValue(), mode);
    await phone.getByRole("link", { name: "Hoy", exact: true }).click();
    await phone
      .getByRole("heading", { name: /Un paso a la vez, Ana/ })
      .waitFor();
    assert.equal(
      await phone.locator(petSvg).getAttribute("data-lumi-motion"),
      mode,
    );
    assert.equal(
      await phone.getByLabel("Animaciones de Lumi").count(),
      0,
      "El retrato no pide elegir un modo",
    );
  }
  await setPhoneMotion("calm");
  await phone.reload();
  await phone.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
  assert.equal(
    await phone.locator(petSvg).getAttribute("data-lumi-motion"),
    "calm",
    "Tranquilas persiste al recargar",
  );
  await pauseClock(phone);
  await phone.clock.fastForward(60000);
  assert.equal(await lumiState(phone), "idle");
  assert.equal(
    await phone
      .locator(petSvg)
      .evaluate((svg) => svg.getAnimations({ subtree: true }).length),
    0,
    "La opción Tranquilas detiene tanto las acciones espontáneas como las animaciones de las partes",
  );
  await phone.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(
    await phone
      .locator(petSvg)
      .evaluate((svg) => svg.getAnimations({ subtree: true }).length),
    0,
    "Tranquilas conserva la calma aunque el sistema permita animaciones",
  );
  await phone.clock.resume();
  await setPhoneMotion("auto");
  assert.notEqual(
    await phone
      .locator("#pet .lumi-body")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await phone.emulateMedia({ reducedMotion: "reduce" });
  await phone.waitForFunction(() => {
    const svg = document.querySelector("#pet .lumi-art");
    return (
      svg.dataset.lumiMotion === "auto" &&
      svg.getAnimations({ subtree: true }).length === 0
    );
  });
  await phone.reload();
  await phone.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
  assert.equal(
    await phone.locator(petSvg).getAttribute("data-lumi-motion"),
    "auto",
    "Según dispositivo persiste si se eligió explícitamente",
  );
  await pauseClock(phone);
  await phone.clock.fastForward(60000);
  assert.equal(await lumiState(phone), "idle");
  assert.equal(
    await phone
      .locator(petSvg)
      .evaluate((svg) => svg.getAnimations({ subtree: true }).length),
    0,
  );
  await phone.clock.resume();
  await setPhoneMotion("animated");
  await phone.reload();
  await phone.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
  assert.equal(
    await phone.locator(petSvg).getAttribute("data-lumi-motion"),
    "animated",
    "Animadas persiste si se eligió explícitamente",
  );
  await phone
    .getByRole("button", { name: "+ Crear una meta", exact: true })
    .click();
  await phone.getByLabel("Mi idea o meta").fill("Practicar en mi teléfono");
  await phone.getByLabel("Minutos por semana para esta meta").fill("140");
  const mobilePlan = holdAi();
  await phone.getByRole("button", { name: "Proponer un plan con IA" }).click();
  await waitingPlan(phone);
  await waitAiCalls(6);
  for (const part of [".lumi-body", ".lumi-eyes"])
    assert.notEqual(
      await phone
        .locator(`.ai-loading ${part}`)
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
      "La Lumi de la carga está animada sin pedir una selección",
    );
  assert.equal(
    await phone
      .locator(".ai-loading-track")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
    "Animar Lumi no anula la reducción de movimiento de los otros adornos",
  );
  await phone.screenshot({
    path: "dist/qa/loading-mobile.png",
    fullPage: false,
  });
  await pauseClock(phone);
  await phone.clock.fastForward(21000);
  assert.ok(
    ["walk", "look", "jump", "stretch", "turn", "flip"].includes(
      await lumiState(phone, ".ai-loading"),
    ),
    "La Lumi de la carga actúa autónomamente sin interacción",
  );
  await finishLumi(phone, ".ai-loading");
  await phone.clock.resume();
  mobilePlan.release();
  await mobilePlan.done;
  await phone
    .getByRole("heading", { name: "Tu propuesta, antes de guardar" })
    .waitFor();
  await phone.getByRole("button", { name: "Cerrar", exact: true }).click();
  await setPhoneMotion("auto");
  await phone
    .getByRole("button", { name: "+ Crear una meta", exact: true })
    .click();
  await phone
    .getByLabel("Mi idea o meta")
    .fill("Una carga tranquila por elección");
  await phone.getByLabel("Minutos por semana para esta meta").fill("140");
  const quietMobilePlan = holdAi();
  await phone.getByRole("button", { name: "Proponer un plan con IA" }).click();
  await waitingPlan(phone);
  await waitAiCalls(7);
  for (const part of [
    ".lumi-body",
    ".lumi-eyes",
    ".lumi-pupils",
    ".ai-loading-track",
  ])
    assert.equal(
      await phone
        .locator(`.ai-loading ${part}`)
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
      "La pantalla de carga respeta Según dispositivo cuando se eligió explícitamente",
    );
  await pauseClock(phone);
  await phone.clock.fastForward(60000);
  assert.equal(
    await phone
      .locator(".ai-loading")
      .evaluate((loader) => loader.getAnimations({ subtree: true }).length),
    0,
  );
  await phone.clock.resume();
  quietMobilePlan.release();
  await quietMobilePlan.done;
  await phone
    .getByRole("heading", { name: "Tu propuesta, antes de guardar" })
    .waitFor();
  await phone.getByRole("button", { name: "Cerrar", exact: true }).click();
  await phone.getByRole("link", { name: "Metas", exact: true }).click();
  await phone
    .getByRole("heading", { name: "Metas alcanzadas", exact: true })
    .waitFor();
  await phone.getByRole("link", { name: "Hoy", exact: true }).click();
  total = 100000; // También se comprueba el espacio de la evolución final.
  await phone.reload();
  await phone.getByRole("heading", { name: /Un paso a la vez, Ana/ }).waitFor();
  await phone.emulateMedia({ reducedMotion: "no-preference" });
  await featuredLumi(phone);
  await autonomousLumi(phone, { cycles: 4 });
  assert.equal(
    await phone.locator(petSvg).getAttribute("data-lumi-stage"),
    "5",
  );
  await lumiGeometry(phone);
  await phone.screenshot({
    path: "dist/qa/lumi-autonomous-mobile.png",
    fullPage: true,
  });
  await pauseClock(phone);
  await phone.evaluate(() => {
    window.detachedLumi = document.querySelector("#pet .lumi-art");
  });
  await phone.getByRole("link", { name: "Metas", exact: true }).click();
  await phone
    .getByRole("heading", { name: "Metas alcanzadas", exact: true })
    .waitFor();
  const detachedState = await phone.evaluate(
    () => window.detachedLumi.dataset.lumiState,
  );
  await phone.clock.fastForward(60000);
  assert.equal(
    await phone.evaluate(
      () => window.detachedLumi.getAnimations({ subtree: true }).length,
    ),
    0,
    "Navegar desmonta las animaciones de la mascota anterior",
  );
  assert.equal(
    await phone.evaluate(() => window.detachedLumi.dataset.lumiState),
    detachedState,
    "No quedan acciones espontáneas en un personaje desmontado",
  );
  await phone.clock.resume();
  assert.deepEqual(errors, []);
  console.log(
    "UI fixtures: registro, login/logout, Lumi autónoma sin clic/hover, movimientos dentro del retrato, pausa de pestaña y desmontaje, XP/nivel/evolución, propuesta editable, carga IA, doble clic, error/reintento, cierre seguro, ajustes, acciones, hábitos, importación, segundo dispositivo, responsive, movimiento reducido y preferencia de Lumi persistente y sincronizada: OK",
  );
} finally {
  if (browser) await browser.close();
  server.kill();
}
