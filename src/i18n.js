// Idioma de la interfaz: español o inglés. La primera vez se elige solo según el idioma del teléfono
// o del navegador; el botón ES/EN lo cambia y la elección queda guardada en este dispositivo.
// Los textos van en pares junto al código que los usa: tr("Guardar", "Save").
// También decide el idioma en que responde la IA (planes y chat con Lumi): ver aiLanguage().
export const LANGS = ["es", "en"];
// public/boot.js lee la misma clave para traducir el esqueleto de carga antes de que llegue la app.
export const LANG_STORAGE_KEY = "planifia-lang";
const listeners = new Set();

/** Idioma preferido según el dispositivo: español si lo pide, inglés para cualquier otro idioma. */
export function detectLang(languages) {
  const list = (languages || []).map((tag) => String(tag || "").toLowerCase().split("-")[0]).filter(Boolean);
  if (!list.length) return "es";
  const known = list.find((base) => LANGS.includes(base));
  return known || "en";
}

function storedLang() {
  try {
    const value = localStorage.getItem(LANG_STORAGE_KEY);
    return LANGS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

// Fuera del navegador (pruebas de Node) se usa español salvo que se elija otro con setLang().
let current =
  typeof document === "undefined"
    ? "es"
    : storedLang() || detectLang(navigator.languages?.length ? navigator.languages : [navigator.language]);

export const lang = () => current;
/** Formato de fechas y números del idioma actual. */
export const locale = () => (current === "en" ? "en-US" : "es-CL");
/** Texto en el idioma actual. Los dos textos se evalúan siempre: deben ser baratos de construir. */
export const tr = (es, en) => (current === "en" ? en : es);

/** Cambia el idioma, lo guarda en el dispositivo y avisa a quien redibuja la vista. */
export function setLang(next, { remember = true } = {}) {
  if (!LANGS.includes(next) || next === current) return;
  current = next;
  if (remember)
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {}
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener(next);
}

export function onLangChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Idioma en que deben responder la IA de planes y Lumi; el servidor acepta sólo "es" o "en". */
export const aiLanguage = () => current;

/**
 * Botón ES/EN. Cualquier botón con data-lang cambia el idioma (ver bindLangToggle). Cada opción está
 * escrita en su propio idioma para que se reconozca aunque no se entienda el idioma actual.
 */
export function langToggle(className = "") {
  return `<div class="lang-toggle ${className}" role="group" aria-label="${tr("Idioma", "Language")}">${[
    ["es", "ES", "Ver en español"],
    ["en", "EN", "View in English"],
  ]
    .map(
      ([code, short, label]) =>
        `<button type="button" data-lang="${code}" lang="${code}" aria-pressed="${current === code}" aria-label="${label}" title="${label}">${short}</button>`,
    )
    .join("")}</div>`;
}

let bound = false;
export function bindLangToggle(doc = document) {
  if (bound) return;
  bound = true;
  doc.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-lang]");
    if (button) setLang(button.dataset.lang);
  });
}

if (typeof document !== "undefined") document.documentElement.lang = current;
