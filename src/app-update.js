import { billingCommand } from "./native-billing.js";

// Aviso de versión nueva en la app de Android (Play In-App Updates, en BillingPlugin.kt).
const LATER_KEY = "planifia-update-later";
const LATER_MS = 24 * 60 * 60 * 1000;
// Prioridad 4-5 (se fija al publicar con la API de Play) o una versión con más de dos semanas
// de atraso: el aviso no se puede posponer.
const REQUIRED_PRIORITY = 4;
const REQUIRED_STALE_DAYS = 14;

/** Qué hacer con la respuesta de Google Play: "none", "offer", "required" o "resume". */
export function updateAction(info, { now = Date.now(), laterUntil = 0 } = {}) {
  if (!info?.available) return "none";
  // Una actualización inmediata interrumpida se retoma sin preguntar (lo exige Google Play).
  if (info.status === "in_progress") return "resume";
  if (info.status !== "available" || !info.immediate) return "none";
  if ((info.priority ?? 0) >= REQUIRED_PRIORITY || (info.stalenessDays ?? 0) >= REQUIRED_STALE_DAYS) return "required";
  return now < laterUntil ? "none" : "offer";
}

export function createUpdateChecker({ native = billingCommand, storage = globalThis.localStorage, now = () => Date.now() } = {}) {
  const laterUntil = () => {
    try {
      return Number(storage?.getItem(LATER_KEY)) || 0;
    } catch {
      return 0;
    }
  };
  return {
    async check() {
      try {
        const info = await native("check_update");
        return { info, action: updateAction(info, { now: now(), laterUntil: laterUntil() }) };
      } catch {
        // Sin Google Play o sin conexión, la app sigue igual.
        return { info: null, action: "none" };
      }
    },
    later() {
      try {
        storage?.setItem(LATER_KEY, String(now() + LATER_MS));
      } catch {}
    },
    start: () => native("start_update"),
  };
}
