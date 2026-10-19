import { createClient } from "@supabase/supabase-js";
import { requestSignal } from "./platform.js";
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
// public/boot.js lee la misma clave para elegir el esqueleto de carga.
export const AUTH_STORAGE_KEY = "planifia-seller-auth";
export const missing = [
  !url && "VITE_SUPABASE_URL",
  !key && "VITE_SUPABASE_PUBLISHABLE_KEY",
].filter(Boolean);
export const cloud = missing.length
  ? null
  : createClient(url, key, {
      auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        fetch: async (url, options = {}) =>
          fetch(url, {
            ...options,
            signal: requestSignal(
              String(url).includes("/functions/") ? 140000 : 25000,
              options.signal,
            ),
          }),
      },
    });
export async function checked(promise) {
  const { data, error } = await promise;
  if (error) {
    const messages = {
      invalid_credentials: "Correo o contraseña incorrectos.",
      email_not_confirmed: "Confirma primero tu correo electrónico.",
      user_already_exists:
        "Ese correo ya tiene una cuenta. Prueba iniciar sesión.",
      weak_password:
        "Usa una contraseña más segura: al menos 10 caracteres, con letras y números.",
      PGRST205:
        "Faltan las tablas de PlanifIA. Aplica las migraciones de Supabase indicadas en el README.",
      "42P01":
        "Faltan las tablas de PlanifIA. Aplica las migraciones de Supabase indicadas en el README.",
    };
    if (messages[error.code]) throw new Error(messages[error.code]);
    throw error;
  }
  return data;
}
async function all(table, columns = "*") {
  const rows = [];
  for (let start = 0; start < 50000; start += 1000) {
    const page = await checked(
      cloud
        .from(table)
        .select(columns)
        .order("id")
        .range(start, start + 999),
    );
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
  throw new Error(
    "Hay demasiados registros para esta vista. Contacta con soporte para exportarlos.",
  );
}
export async function loadState() {
  const [profile, goals, milestones, tasks, habits, completions, pet, imports] =
    await Promise.all([
      checked(cloud.from("profiles").select("*").single()),
      all("goals"),
      all("milestones"),
      all("tasks"),
      all("habits"),
      all("habit_completions"),
      checked(cloud.rpc("pet_state")),
      all("imports", "id,source,imported_at"),
    ]);
  return {
    profile,
    goals,
    milestones,
    tasks,
    habits,
    completions,
    pet,
    imports,
  };
}
export const rpc = (name, args) => checked(cloud.rpc(name, args));
export async function generatePlan(input, { signal } = {}) {
  const { data: sessionData } = await cloud.auth.getSession();
  const account = sessionData.session?.user.id;
  if (!account) throw new Error("Inicia sesión para crear un plan.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(input)),
  );
  const key = `planifia-ai-request:${account}:${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("")}`;
  let id;
  try {
    id = localStorage.getItem(key);
  } catch {}
  id ||= crypto.randomUUID();
  try {
    localStorage.setItem(key, id);
  } catch {}
  const { data, error } = await cloud.functions.invoke("goal-plan", {
    body: { ...input, request_id: id },
    signal,
  });
  if (error) {
    let detail;
    try {
      detail = await error.context?.json();
    } catch {}
    const failure = new Error(
      detail?.error || "No pudimos crear la propuesta. Inténtalo de nuevo en un momento.",
    );
    // La meta describe una crisis: la app muestra las líneas de ayuda en vez de un error.
    failure.crisis = detail?.crisis === true;
    throw failure;
  }
  return data;
}
export const listAiJobs = () => rpc("get_ai_jobs", { p_id: null });
/** Pide a la IA de respaldo una propuesta en cola mientras el PC está apagado (ver ai-source.js). */
export async function requestCloudFallback(jobId) {
  const { data, error } = await cloud.functions.invoke("ai-fallback", { body: { job_id: jobId } });
  if (error) {
    let detail;
    try {
      detail = await error.context?.json();
    } catch {}
    throw new Error(detail?.error || "La IA de respaldo no respondió.");
  }
  return data;
}
export const cancelAiJob = (id) => rpc("cancel_ai_job", { p_id: id });
export function releaseAiRequest(requestId) {
  // Only identifiers/digests are cached, never the prompt or its result.
  try {
    for (const key of Object.keys(localStorage))
      if (
        key.startsWith("planifia-ai-request:") &&
        localStorage.getItem(key) === requestId
      )
        localStorage.removeItem(key);
  } catch {}
}

/**
 * Última aceptación de los términos. { available: false } si la tabla todavía no existe (migración
 * pendiente) o no se pudo consultar: en ese caso la app no bloquea nada.
 */
export async function loadLegalStatus() {
  const { data, error } = await cloud
    .from("legal_acceptances")
    .select("terms_version,privacy_version,platform,accepted_at")
    .order("accepted_at", { ascending: false })
    .limit(1);
  if (error) return { available: false };
  return { available: true, latest: data?.[0] || null };
}
export const acceptLegal = (version, platform) =>
  rpc("accept_legal", { p_terms_version: version.terms, p_privacy_version: version.privacy, p_platform: platform });
export const reportAiPlan = (jobId, { reason, details }) =>
  rpc("report_ai_content", { p_kind: "plan", p_ref: jobId, p_content: null, p_reason: reason, p_details: details });

/**
 * Datos de la cuenta que no están en la vista principal, para "Exportar mis datos" (derecho de acceso
 * y portabilidad). Cada parte es opcional: si una falla, el respaldo sale igual con lo demás.
 */
export async function loadExportExtras() {
  const parts = {
    lumi_chat_messages: () => all("lumi_chat_messages", "id,role,content,created_at"),
    ai_jobs: () => rpc("get_ai_jobs", { p_id: null }),
    legal_acceptances: () => all("legal_acceptances", "id,terms_version,privacy_version,platform,source,accepted_at"),
    ai_content_reports: () => all("ai_content_reports", "id,kind,content,reason,details,status,created_at"),
    subscriptions: () => checked(cloud.from("subscriptions").select("*")),
    subscription_periods: () => all("subscription_periods"),
    payment_orders: () => all("payment_orders"),
    monetization: () => rpc("monetization_state"),
  };
  const result = {};
  await Promise.all(
    Object.entries(parts).map(async ([name, load]) => {
      try {
        result[name] = await load();
      } catch {
        result[name] = null;
      }
    }),
  );
  return result;
}