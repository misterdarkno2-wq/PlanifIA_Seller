import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const missing = [
  !url && "VITE_SUPABASE_URL",
  !key && "VITE_SUPABASE_PUBLISHABLE_KEY",
].filter(Boolean);
export const cloud = missing.length
  ? null
  : createClient(url, key, {
      auth: {
        storageKey: "planifia-seller-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        fetch: async (url, options = {}) => {
          const timeout = AbortSignal.timeout(
            String(url).includes("/functions/") ? 140000 : 25000,
          );
          return fetch(url, {
            ...options,
            signal: options.signal
              ? AbortSignal.any([options.signal, timeout])
              : timeout,
          });
        },
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
        "Usa una contraseña más segura, de al menos ocho caracteres.",
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
  const { data, error } = await cloud.functions.invoke("goal-plan", {
    body: input,
    signal,
  });
  if (error) {
    let detail;
    try {
      detail = await error.context?.json();
    } catch {}
    throw new Error(
      detail?.error ||
        "No pudimos crear la propuesta. Comprueba que la función goal-plan esté desplegada y sus secretos configurados.",
    );
  }
  return data;
}
