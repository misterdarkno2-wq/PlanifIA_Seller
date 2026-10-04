// Opt-in verification against the configured Supabase project. No fixtures.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { today } from "../src/domain.js";

if (process.env.PLANIFIA_RUN_LIVE !== "1")
  throw new Error(
    "Esta prueba crea y elimina sus propias cuentas de validación. Actívala con PLANIFIA_RUN_LIVE=1.",
  );
const settings = Object.fromEntries(
  (await readFile(".env.local", "utf8"))
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).trim()];
    }),
);
const url = settings.VITE_SUPABASE_URL,
  publicKey = settings.VITE_SUPABASE_PUBLISHABLE_KEY;
const ref = new URL(url).hostname.split(".")[0];
assert.match(ref, /^[a-z]{20}$/);
const raw = execFileSync(
  process.env.ComSpec || "C:/Windows/System32/cmd.exe",
  [
    "/d",
    "/s",
    "/c",
    `npx.cmd supabase projects api-keys --project-ref ${ref} --reveal --output json`,
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const keys = JSON.parse(raw);
const key = keys.find((k) => k.name === "service_role")?.api_key;
assert.ok(
  key,
  "La CLI necesita acceso administrativo al proyecto de validación.",
);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, key, options),
  clientA = createClient(url, publicKey, options),
  clientB = createClient(url, publicKey, options);
const created = [],
  password = randomBytes(24).toString("base64url"),
  suffix = randomUUID();
const emails = ["a", "b"].map(
  (tag) => `seller-check-${tag}-${suffix}@example.test`,
);
let browser;
const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};
const rpc = async (client, name, args) => unwrap(await client.rpc(name, args));
try {
  for (const email of emails) {
    const data = unwrap(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: "Validación" },
      }),
    );
    created.push(data.user.id);
  }
  await Promise.all(
    [clientA, clientB].map(async (client, i) =>
      unwrap(
        await client.auth.signInWithPassword({ email: emails[i], password }),
      ),
    ),
  );
  await rpc(clientA, "save_profile", {
    p_name: "Validación",
    p_timezone: "America/Santiago",
    p_minutes: 700,
    p_days: [0, 1, 2, 3, 4, 5, 6],
  });
  const goal = await rpc(clientA, "save_goal", {
    p_id: null,
    p_request_id: randomUUID(),
    p_data: {
      title: "Mi proyecto de fotografía",
      category: "creative",
      description: "Prueba de validación",
      current_situation: "Tengo una cámara y puedo practicar",
      outcome: "Publicar una serie de cuatro fotografías",
      weekly_minutes: 140,
      target_date: null,
    },
  });
  const date = today("America/Santiago"),
    future = new Date(date + "T12:00:00Z");
  future.setUTCDate(future.getUTCDate() + 2);
  const task = await rpc(clientA, "save_task", {
    p_id: null,
    p_request_id: randomUUID(),
    p_data: {
      title: "Elegir el tema de mi serie",
      description: "Prueba de validación",
      area: "Creatividad",
      goal_id: goal,
      priority: "high",
      minutes: 30,
      scheduled_date: date,
      deadline: future.toISOString().slice(0, 10),
    },
  });
  const pending = await rpc(clientA, "save_task", {
    p_id: null,
    p_request_id: randomUUID(),
    p_data: {
      title: "Acción anterior pendiente",
      goal_id: goal,
      priority: "low",
      minutes: 10,
      scheduled_date: date,
    },
  });
  const request = randomUUID(),
    first = await rpc(clientA, "set_task_status", {
      p_id: task,
      p_status: "completed",
      p_request_id: request,
    });
  assert.equal(first.xp_delta, 40);
  await rpc(clientA, "set_task_status", {
    p_id: task,
    p_status: "completed",
    p_request_id: request,
  });
  assert.equal((await rpc(clientA, "pet_state", {})).total_xp, 40);
  assert.equal(
    (
      await rpc(clientA, "set_task_status", {
        p_id: task,
        p_status: "pending",
        p_request_id: randomUUID(),
      })
    ).xp_delta,
    -40,
  );
  await rpc(clientA, "set_task_status", {
    p_id: task,
    p_status: "completed",
    p_request_id: randomUUID(),
  });
  assert.deepEqual(
    unwrap(await clientB.from("tasks").select("id").eq("id", task)),
    [],
  );
  assert.ok(
    (
      await clientB.rpc("set_task_status", {
        p_id: task,
        p_status: "completed",
        p_request_id: randomUUID(),
      })
    ).error,
  );
  assert.ok(
    (
      await clientA
        .from("pets")
        .update({ total_xp: 999999 })
        .eq("user_id", created[0])
    ).error,
  );
  const habit = await rpc(clientA, "save_habit", {
    p_id: null,
    p_request_id: randomUUID(),
    p_data: {
      title: "Mirar una fotografía cada día",
      minutes: 10,
      priority: "low",
      days: [0, 1, 2, 3, 4, 5, 6],
      active: true,
      goal_id: null,
    },
  });
  const habitRequest = randomUUID();
  await rpc(clientA, "set_habit_completion", {
    p_id: habit,
    p_day: date,
    p_completed: true,
    p_request_id: habitRequest,
  });
  await rpc(clientA, "set_habit_completion", {
    p_id: habit,
    p_day: date,
    p_completed: true,
    p_request_id: habitRequest,
  });
  assert.equal((await rpc(clientA, "pet_state", {})).total_xp, 50);
  await rpc(clientA, "set_habit_completion", {
    p_id: habit,
    p_day: date,
    p_completed: false,
    p_request_id: randomUUID(),
  });
  assert.equal((await rpc(clientA, "pet_state", {})).total_xp, 40);
  const session = unwrap(await clientA.auth.getSession()).session;
  const started = Date.now();
  const response = await fetch(url + "/functions/v1/goal-plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + session.access_token,
      apikey: publicKey,
      Origin: "http://127.0.0.1:5173",
    },
    signal: AbortSignal.timeout(140000),
    body: JSON.stringify({
      goal_id: goal,
      idea: "Quiero publicar una serie de cuatro fotografías. Propón sólo cuatro acciones pequeñas para esta semana, repartidas en días distintos, con dos hitos.",
      current_situation:
        "Ya elegí el tema de mi serie. Dispongo de una cámara y soy principiante.",
      outcome: "Publicar cuatro fotografías que compartan un tema",
      weekly_minutes: 140,
      target_date: null,
    }),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    200,
    result.error || "La función no devolvió una propuesta.",
  );
  assert.equal(
    unwrap(await clientA.from("milestones").select("id").eq("goal_id", goal))
      .length,
    0,
    "La IA no debe guardar automáticamente.",
  );
  await rpc(clientA, "apply_goal_plan", {
    p_goal_id: goal,
    p_expected_version: result.expected_version,
    p_plan: result.proposal,
    p_request_id: randomUUID(),
  });
  assert.equal(
    unwrap(await clientA.from("tasks").select("status").eq("id", task).single())
      .status,
    "completed",
  );
  assert.equal(
    unwrap(
      await clientA.from("tasks").select("status").eq("id", pending).single(),
    ).status,
    "cancelled",
  );
  console.log(
    "Supabase real: Auth, dos usuarios/RLS, guardado, XP, hábitos y propuesta Ollama aprobada: OK. Generación: " +
      Math.round((Date.now() - started) / 1000) +
      " s.",
  );

  await mkdir("dist/qa-live", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const web = process.env.PLANIFIA_LIVE_WEB_URL || "http://127.0.0.1:5173/";
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 1050 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
        viewport,
        reducedMotion: label === "mobile" ? "reduce" : "no-preference",
      }),
      page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(web + "#login");
    await page.getByLabel("Correo electrónico").fill(emails[0]);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await page
      .getByRole("heading", { name: /Un paso a la vez, Validación/ })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `dist/qa-live/${label}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Iniciar sesión", exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Interfaz real sin interceptar peticiones: login/logout, recuperación de datos y escritorio/móvil: OK.",
  );
} finally {
  if (browser) await browser.close();
  for (const id of created) unwrap(await admin.auth.admin.deleteUser(id));
  console.log(
    "Cuentas temporales de validación eliminadas; no se modificaron cuentas ajenas.",
  );
}
