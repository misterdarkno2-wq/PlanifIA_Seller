// Recordatorio diario: qué días se avisa, a qué hora, con qué texto y cuándo se pide el permiso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_REMINDER_TIME,
  createReminders,
  pendingSteps,
  planReminders,
  reminderTime,
  zonedEpoch,
} from "../src/reminders.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
// Jueves 22 de octubre de 2026, 08:00 en Santiago (UTC-3 en horario de verano).
const NOW = new Date("2026-10-22T11:00:00Z");
const base = (extra = {}) => ({
  profile: { timezone: "America/Santiago", reminder_time: "09:30:00" },
  goals: [
    { id: "g1", status: "active" },
    { id: "g2", status: "paused" },
  ],
  tasks: [],
  habits: [],
  completions: [],
  ...extra,
});

test("La hora guardada se lee como HH:MM y sin hora se usa la de por defecto", () => {
  assert.equal(reminderTime("07:45:00"), "07:45");
  assert.equal(reminderTime("21:05"), "21:05");
  for (const value of [null, undefined, "", "25:00", "texto"]) assert.equal(reminderTime(value), DEFAULT_REMINDER_TIME);
});

test("La hora del aviso respeta la zona horaria del perfil y el cambio de hora", () => {
  assert.equal(new Date(zonedEpoch("2026-10-22", "09:30", "America/Santiago")).toISOString(), "2026-10-22T12:30:00.000Z");
  assert.equal(new Date(zonedEpoch("2026-07-01", "09:30", "America/Santiago")).toISOString(), "2026-07-01T13:30:00.000Z");
  assert.equal(new Date(zonedEpoch("2026-10-22", "20:00", "Europe/Madrid")).toISOString(), "2026-10-22T18:00:00.000Z");
  assert.equal(new Date(zonedEpoch("2026-10-22", "09:00", "UTC")).toISOString(), "2026-10-22T09:00:00.000Z");
});

test("Cuenta acciones del día (hoy también las atrasadas) y hábitos sin marcar; ignora metas en pausa", () => {
  const state = base({
    tasks: [
      { id: "t1", status: "pending", scheduled_date: "2026-10-22", goal_id: "g1" },
      { id: "t2", status: "pending", scheduled_date: "2026-10-20", goal_id: null },
      { id: "t3", status: "completed", scheduled_date: "2026-10-22", goal_id: "g1" },
      { id: "t4", status: "pending", scheduled_date: "2026-10-22", goal_id: "g2" },
      { id: "t5", status: "pending", scheduled_date: null, goal_id: null },
      { id: "t6", status: "cancelled", scheduled_date: "2026-10-22", goal_id: null },
      { id: "t7", status: "pending", scheduled_date: "2026-10-23", goal_id: "g1" },
    ],
    habits: [
      { id: "h1", active: true, days: [4] },
      { id: "h2", active: true, days: [4] },
      { id: "h3", active: false, days: [4] },
      { id: "h4", active: true, days: [5] },
    ],
    completions: [{ habit_id: "h2", day: "2026-10-22", completed: true }],
  });
  assert.equal(pendingSteps("2026-10-22", "2026-10-22", state), 3, "t1 + t2 atrasada + h1");
  assert.equal(pendingSteps("2026-10-23", "2026-10-22", state), 2, "t7 + h4; la atrasada sólo cuenta hoy");
  assert.equal(pendingSteps("2026-10-24", "2026-10-22", state), 0);
});

test("Programa sólo los días con pasos, después de ahora, y el texto no revela nada de las metas", () => {
  const state = base({
    tasks: [
      { id: "t1", title: "Llamar a la psicóloga", status: "pending", scheduled_date: "2026-10-22", goal_id: "g1" },
      { id: "t2", title: "Pagar la deuda", status: "pending", scheduled_date: "2026-10-25", goal_id: null },
    ],
    habits: [{ id: "h1", title: "Tomar el remedio", active: true, days: [1] }],
  });
  const items = planReminders(state, NOW);
  assert.deepEqual(
    items.map((i) => [i.id, new Date(i.at).toISOString()]),
    [
      [1, "2026-10-22T12:30:00.000Z"],
      [4, "2026-10-25T12:30:00.000Z"],
      [5, "2026-10-26T12:30:00.000Z"],
    ],
  );
  for (const item of items) {
    assert.equal(item.title, "PlanifIA");
    assert.match(item.body, /^[^]*\b1 paso\b/);
    assert.doesNotMatch(item.body, /psicóloga|deuda|remedio|meta:/i);
    assert.ok(item.body.length <= 200);
  }
  const later = planReminders(state, new Date("2026-10-22T13:00:00Z"));
  assert.equal(later[0].id, 4, "Si la hora de hoy ya pasó, el aviso de hoy no se programa");
  assert.equal(planReminders(base(), NOW).length, 0, "Sin nada pendiente no hay avisos");
  const many = planReminders(
    base({ tasks: [1, 2, 3].map((n) => ({ id: `x${n}`, status: "pending", scheduled_date: "2026-10-22" })) }),
    NOW,
  );
  assert.match(many[0].body, /3 pasos/);
  assert.ok(planReminders(base({ habits: [{ id: "h", active: true, days: [0, 1, 2, 3, 4, 5, 6] }] }), NOW).length <= 7);
});

function fakeNative(permission = "granted") {
  const calls = [];
  const native = async (command, args) => {
    calls.push([command, args]);
    if (command === "request_permission") return { available: true, permission };
    return { available: true, permission, scheduled: args?.items?.length ?? 0 };
  };
  return { calls, native };
}
const memory = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
};

test("Apagado por defecto: sin encenderlo no se pide permiso ni se programa nada", async () => {
  const { calls, native } = fakeNative();
  const reminders = createReminders({ native, available: () => true, storage: memory(), now: () => NOW });
  assert.equal(reminders.isOn("u1"), false);
  await reminders.sync("u1", base({ tasks: [{ id: "t", status: "pending", scheduled_date: "2026-10-22" }] }));
  assert.deepEqual(calls, []);
});

test("Al encenderlo pide el permiso y programa; si lo niegan queda apagado", async () => {
  const state = base({ tasks: [{ id: "t", status: "pending", scheduled_date: "2026-10-22" }] });
  const granted = fakeNative("granted"),
    storage = memory();
  const reminders = createReminders({ native: granted.native, available: () => true, storage, now: () => NOW });
  const result = await reminders.enable("u1", state);
  assert.deepEqual(granted.calls.map(([c]) => c), ["request_permission", "schedule"]);
  assert.equal(result.scheduled, 1);
  assert.equal(reminders.isOn("u1"), true);
  assert.equal(reminders.isOn("u2"), false, "Cada cuenta decide en este teléfono");
  await reminders.disable("u1");
  assert.equal(reminders.isOn("u1"), false);
  assert.equal(granted.calls.at(-1)[0], "cancel_all");

  const denied = fakeNative("denied");
  const off = createReminders({ native: denied.native, available: () => true, storage: memory(), now: () => NOW });
  assert.equal((await off.enable("u1", state)).permission, "denied");
  assert.equal(off.isOn("u1"), false);
  assert.deepEqual(denied.calls.map(([c]) => c), ["request_permission"]);
});

test("Fuera de Android no llama al plugin y un error nativo no rompe la app", async () => {
  const { calls, native } = fakeNative();
  const web = createReminders({ native, available: () => false, storage: memory() });
  assert.deepEqual(await web.enable("u1", base()), { available: false });
  assert.deepEqual(await web.status(), { available: false });
  await web.stop();
  assert.deepEqual(calls, []);
  const errors = [];
  const broken = createReminders({
    native: async () => {
      throw new Error("plugin caído");
    },
    available: () => true,
    storage: memory(),
    onError: (e) => errors.push(e.message),
  });
  assert.equal((await broken.enable("u1", base())).error, "native");
  assert.equal(broken.isOn("u1"), false);
  assert.deepEqual(errors, ["plugin caído"]);
});

test("Android: sin alarmas exactas, permiso de notificaciones y reglas para no cerrar la app", async () => {
  const manifest = await read("src-tauri/plugins/planifia-reminders/android/src/main/AndroidManifest.xml");
  const scheduler = await read("src-tauri/plugins/planifia-reminders/android/src/main/java/ReminderScheduler.kt");
  const plugin = await read("src-tauri/plugins/planifia-reminders/android/src/main/java/RemindersPlugin.kt");
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(manifest, /android\.permission\.RECEIVE_BOOT_COMPLETED/);
  assert.doesNotMatch(manifest, /uses-permission[^>]*(SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM)/);
  assert.match(manifest, /ReminderReceiver"\s+android:exported="false"/);
  assert.doesNotMatch(scheduler + plugin, /setExact|setAlarmClock|canScheduleExactAlarms/);
  // Ventana de 15 minutos y respaldo para el reposo profundo; ninguna de las dos es exacta.
  assert.match(scheduler, /setWindow\(AlarmManager\.RTC_WAKEUP, r\.at, WINDOW_MS/);
  assert.match(scheduler, /setAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP/);
  assert.match(scheduler, /FLAG_IMMUTABLE/);
  // Cada comando atrapa sus errores y responde en vez de lanzar.
  for (const command of ["getStatus", "requestPermission", "schedule", "cancelAll", "openSettings"])
    assert.match(plugin, new RegExp(`fun ${command}\\(invoke: Invoke\\) = guard\\(`), command);
  const capabilities = JSON.parse(await read("src-tauri/capabilities/default.json"));
  assert.ok(capabilities.permissions.includes("planifia-reminders:default"));
});
