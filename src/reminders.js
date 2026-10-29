import { isAndroidApp } from "./native-ads.js";
import { lang } from "./i18n.js";

// Recordatorio diario (sólo la app de Android): un aviso a la hora que la persona eligió, y sólo los
// días en que tiene acciones o hábitos pendientes. Lo programa el teléfono con alarmas inexactas
// (plugin planifia-reminders); el servidor sólo guarda la hora en el perfil (save_reminder_time).
// Encenderlo o apagarlo es una decisión de cada teléfono y de cada cuenta: se guarda aquí, no en la base.
export const DEFAULT_REMINDER_TIME = "09:00";
// Se programan los próximos 7 días y se recalculan cada vez que se abre la app o cambia algo. Si la
// persona deja de abrir la app, los avisos se acaban solos en una semana: no insistimos sin fin.
export const REMINDER_DAYS = 7;
const TITLE = "PlanifIA";
// Se ve con el teléfono bloqueado: sólo cuántos pasos hay, nunca títulos de metas, acciones ni hábitos.
// Se redactan en el idioma de la app al programarlos; al cambiar de idioma se vuelven a programar.
const BODIES = {
  es: [
    (n) => (n === 1 ? "Hoy tienes 1 paso para tus metas. ¿Lo damos?" : `Hoy tienes ${n} pasos para tus metas. Empieza por el más pequeño.`),
    (n) => (n === 1 ? "Tienes 1 paso pendiente para hoy. Un rato basta." : `Tienes ${n} pasos pendientes para hoy. Uno a la vez.`),
    (n) => (n === 1 ? "Tu meta te espera con 1 paso para hoy." : `Tus metas te esperan con ${n} pasos para hoy.`),
  ],
  en: [
    (n) => (n === 1 ? "You have 1 step for your goals today. Shall we take it?" : `You have ${n} steps for your goals today. Start with the smallest one.`),
    (n) => (n === 1 ? "You have 1 pending step for today. A little while is enough." : `You have ${n} pending steps for today. One at a time.`),
    (n) => (n === 1 ? "Your goal is waiting with 1 step for today." : `Your goals are waiting with ${n} steps for today.`),
  ],
};

export function remindersCommand(command, args = {}) {
  if (!isAndroidApp()) return Promise.resolve({ available: false });
  return import("@tauri-apps/api/core").then(({ invoke }) => invoke(`plugin:planifia-reminders|${command}`, args));
}

/** "07:45:00" (como lo devuelve la base) → "07:45". Sin hora o con un valor raro, la hora por defecto. */
export function reminderTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value || "");
  return match ? `${match[1]}:${match[2]}` : DEFAULT_REMINDER_TIME;
}

const addDays = (iso, days) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

function offsetAt(epoch, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(epoch))
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(epoch / 1000) * 1000;
}

/** Instante (ms desde 1970) de la fecha y hora de reloj indicadas en la zona horaria del perfil. */
export function zonedEpoch(iso, time, timeZone) {
  const [y, m, d] = iso.split("-").map(Number),
    [h, min] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  let guess = wall;
  // Dos o tres vueltas bastan; en el cambio de hora una hora que no existe queda una hora después.
  for (let i = 0; i < 3; i++) {
    const next = wall - offsetAt(guess, timeZone);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/**
 * Pasos pendientes de un día: acciones con esa fecha (hoy también las atrasadas) de metas activas o
 * independientes, más los hábitos activos de ese día de la semana que aún no se marcaron.
 */
export function pendingSteps(day, todayIso, { tasks = [], goals = [], habits = [], completions = [] }) {
  const activeGoal = (t) => !t.goal_id || goals.some((g) => g.id === t.goal_id && g.status === "active");
  const taskCount = tasks.filter(
    (t) =>
      t.status === "pending" &&
      t.scheduled_date &&
      (day === todayIso ? t.scheduled_date <= todayIso : t.scheduled_date === day) &&
      activeGoal(t),
  ).length;
  const dow = weekday(day);
  const habitCount = habits.filter(
    (h) =>
      h.active &&
      h.days.includes(dow) &&
      !completions.some((c) => c.habit_id === h.id && c.day === day && c.completed),
  ).length;
  return taskCount + habitCount;
}

/** Los avisos de los próximos días, ya redactados, para el plugin. Sin pasos pendientes no hay aviso. */
export function planReminders(state, now = new Date(), days = REMINDER_DAYS, language = lang()) {
  const timeZone = state.profile.timezone || "America/Santiago",
    time = reminderTime(state.profile.reminder_time),
    start = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const items = [];
  for (let offset = 0; offset < days; offset++) {
    const day = addDays(start, offset),
      at = zonedEpoch(day, time, timeZone),
      steps = pendingSteps(day, start, state);
    if (at <= now.getTime() || !steps) continue;
    const bodies = BODIES[language] || BODIES.es;
    items.push({ id: offset + 1, at, title: TITLE, body: bodies[weekday(day) % bodies.length](steps) });
  }
  return items;
}

export function createReminders({
  native = remindersCommand,
  available = isAndroidApp,
  storage = globalThis.localStorage,
  now = () => new Date(),
  onError = () => {},
} = {}) {
  const key = (userId) => `planifia-reminders:${userId}`;
  const call = (command, args) =>
    Promise.resolve()
      .then(() => native(command, args))
      .catch((error) => {
        onError(error);
        return { available: true, error: "native" };
      });
  const isOn = (userId) => {
    try {
      return Boolean(userId) && storage?.getItem(key(userId)) === "on";
    } catch {
      return false;
    }
  };
  const setOn = (userId, on) => {
    try {
      if (on) storage?.setItem(key(userId), "on");
      else storage?.removeItem(key(userId));
    } catch {}
  };
  return {
    available,
    isOn,
    status: () => (available() ? call("get_status") : Promise.resolve({ available: false })),
    /** Pide el permiso de Android 13+ sólo ahora, cuando la persona enciende el interruptor. */
    async enable(userId, state) {
      if (!available() || !userId) return { available: false };
      const status = await call("request_permission");
      if (status?.permission !== "granted") return status;
      setOn(userId, true);
      return state ? this.sync(userId, state) : status;
    },
    async disable(userId) {
      setOn(userId, false);
      return available() ? call("cancel_all") : { available: false };
    },
    /** Reprograma los avisos con los datos vigentes. No hace nada si esta cuenta no los encendió aquí. */
    async sync(userId, state) {
      if (!available() || !state?.profile || !isOn(userId)) return { available: available() };
      return call("schedule", { items: planReminders(state, now()) });
    },
    /** Al cerrar sesión o cambiar de cuenta: ningún aviso de la cuenta anterior queda programado. */
    stop: () => (available() ? call("cancel_all") : Promise.resolve({ available: false })),
    forget: (userId) => setOn(userId, false),
    openSettings: () => call("open_settings"),
  };
}
