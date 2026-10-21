// «Continuar con Google» (pasos de configuración en docs/login-google.md).
// - Web: OAuth de Supabase. Google vuelve a planifia.cl y supabase-js recupera la sesión del enlace.
// - Android: Google bloquea OAuth dentro de un WebView (disallowed_useragent). El plugin planifia-auth
//   abre Credential Manager y devuelve un ID token, que Supabase valida junto con el nonce.
// - Escritorio: no disponible; el comando nativo responde "no disponible".
import { isNative } from "./platform.js";
import { isAndroidApp } from "./native-ads.js";

// ID de cliente *Web* de Google. Es público: va dentro de la app. El secreto del cliente sólo se pega
// en el panel de Supabase y nunca llega al repositorio.
const CLIENT_ID = /^[0-9]{6,20}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/;

// Comandos del plugin planifia-auth. Fuera de Android responden "no disponible" sin error.
export async function authCommand(command, args = {}) {
  if (!isAndroidApp()) return { available: false };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(`plugin:planifia-auth|${command}`, args);
}

/** "web", "native" (Android con el ID de cliente configurado) o null (escritorio o sin configurar). */
export function googleSignInMode(clientId = "") {
  if (isAndroidApp()) return CLIENT_ID.test(clientId) ? "native" : null;
  return isNative() ? null : "web";
}

const hex = (buffer) => Array.from(new Uint8Array(buffer), (n) => n.toString(16).padStart(2, "0")).join("");

/**
 * Nonce de un solo uso. Google recibe su SHA-256 en hexadecimal y lo copia en el ID token; Supabase
 * recibe el original, calcula el mismo hash y los compara. Así un token robado no sirve dos veces.
 */
export async function createNonce(cryptoApi = globalThis.crypto) {
  const raw = hex(cryptoApi.getRandomValues(new Uint8Array(32)));
  const hashed = hex(await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  return { raw, hashed };
}

export const GOOGLE_MESSAGES = Object.freeze({
  config: "El inicio con Google no está disponible en esta versión. Entra con tu correo.",
  unavailable: "El inicio con Google no está disponible en este dispositivo. Entra con tu correo.",
  offline: "No hay conexión a Internet. Conéctate y vuelve a intentarlo.",
  no_account:
    "No hay una cuenta de Google en este teléfono. Agrégala en Ajustes del teléfono → Cuentas, o entra con tu correo.",
  no_play_services:
    "Para entrar con Google hace falta Google Play Services actualizado. Actualízalo desde Google Play o entra con tu correo.",
  interrupted: "Se interrumpió el inicio con Google. Vuelve a intentarlo.",
  disabled: "El inicio con Google todavía no está activado. Entra con tu correo.",
  account: "No pudimos crear tu cuenta con Google. Inténtalo de nuevo en unos minutos o escríbenos a planifiaprivacity@gmail.com.",
  error: "No pudimos iniciar sesión con Google. Inténtalo de nuevo o entra con tu correo.",
});

/** Traduce un error de Supabase Auth (o de la red) al iniciar sesión con Google. */
export function googleAuthError(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  if (error?.status === 0 || /fetch|network|timeout|Failed to fetch/i.test(text)) return new Error(GOOGLE_MESSAGES.offline);
  if (/provider_disabled|not enabled|Unsupported provider/i.test(text)) return new Error(GOOGLE_MESSAGES.disabled);
  if (/Database error/i.test(text)) return new Error(GOOGLE_MESSAGES.account);
  return new Error(GOOGLE_MESSAGES.error);
}

/** Web: lleva a Google; al volver, supabase-js lee la sesión del enlace (detectSessionInUrl). */
export async function signInWithGoogleWeb({ auth, redirectTo }) {
  const { error } = await auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  if (error) throw googleAuthError(error);
}

/**
 * Android: pide el ID token al teléfono y abre la sesión en Supabase. Devuelve la sesión, o null si
 * la persona canceló. Cualquier otro caso lanza un Error con un mensaje en español.
 */
export async function signInWithGoogleNative({
  auth,
  clientId,
  native = authCommand,
  nonce = createNonce,
  online = () => globalThis.navigator?.onLine !== false,
}) {
  if (!CLIENT_ID.test(clientId || "")) throw new Error(GOOGLE_MESSAGES.config);
  if (!online()) throw new Error(GOOGLE_MESSAGES.offline);
  const { raw, hashed } = await nonce();
  let answer;
  try {
    answer = await native("sign_in_with_google", { serverClientId: clientId, nonce: hashed });
  } catch {
    throw new Error(GOOGLE_MESSAGES.error);
  }
  if (!answer?.available) throw new Error(GOOGLE_MESSAGES.unavailable);
  if (answer.status === "cancelled") return null;
  if (answer.status !== "ok" || typeof answer.idToken !== "string" || !answer.idToken)
    throw new Error(GOOGLE_MESSAGES[answer.status] || GOOGLE_MESSAGES.error);
  let result;
  try {
    result = await auth.signInWithIdToken({ provider: "google", token: answer.idToken, nonce: raw });
  } catch (error) {
    throw googleAuthError(error);
  }
  if (result.error || !result.data?.session) throw googleAuthError(result.error);
  return result.data.session;
}

/**
 * Error que Supabase deja en el enlace al volver de Google (o de un enlace de correo vencido), por
 * ejemplo #error=access_denied&error_code=otp_expired&error_description=…. null si no hay.
 */
export function authReturnError(hash = "") {
  const params = new URLSearchParams(String(hash).replace(/^#/, ""));
  if (!params.has("error") && !params.has("error_code") && !params.has("error_description")) return null;
  return {
    code: params.get("error_code") || params.get("error") || "",
    description: params.get("error_description") || "",
  };
}

export function authReturnMessage({ code = "", description = "" } = {}) {
  if (code === "otp_expired") return "El enlace del correo venció o ya se usó. Inicia sesión o pide uno nuevo.";
  if (/Database error/i.test(description)) return GOOGLE_MESSAGES.account;
  if (/provider is not enabled|Unsupported provider/i.test(description)) return GOOGLE_MESSAGES.disabled;
  if (code === "access_denied") return "No se completó el inicio de sesión. Puedes intentarlo de nuevo o entrar con tu correo.";
  return "No pudimos completar el inicio de sesión. Inténtalo de nuevo.";
}

/** La cuenta tiene una identidad de Google (entró con Google al menos una vez). */
export const usesGoogle = (account) =>
  Boolean(
    account?.app_metadata?.providers?.includes?.("google") ||
      account?.app_metadata?.provider === "google" ||
      account?.identities?.some?.((identity) => identity?.provider === "google"),
  );
