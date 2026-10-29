import { textLanguage } from "./language.js";

function assert(condition: unknown, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}

Deno.test("El idioma es el del texto; si no se distingue, el de la app", () => {
  const cases: [string | string[], string, string][] = [
    ["Run my first 5K race", "es", "en"],
    ["Correr mi primera carrera de 5 km", "en", "es"],
    ["Quiero hablar inglés con más confianza", "en", "es"],
    ["I want to speak Spanish with more confidence", "es", "en"],
    ["¿Qué hago hoy?", "en", "es"],
    ["What should I do today?", "es", "en"],
    ["Hola Lumi", "en", "es"],
    ["Hi Lumi", "es", "en"],
    [["Aprender Python", "", "Hacer una app"], "en", "es"],
    ["Learn Python", "es", "en"],
    // Sin pistas: decide la app.
    ["ok", "en", "en"],
    ["ok", "es", "es"],
    ["5 km", "en", "en"],
    ["Python", "es", "es"],
  ];
  for (const [text, app, expected] of cases)
    assert(textLanguage(text, app) === expected, `${JSON.stringify(text)} con la app en ${app}: ${textLanguage(text, app)}`);
  // Un idioma desconocido de la app equivale a español.
  assert(textLanguage("ok", "fr") === "es");
});
