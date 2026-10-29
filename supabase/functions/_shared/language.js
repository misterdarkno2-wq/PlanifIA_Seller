// Idioma en que escribe la persona, para que los planes y Lumi le respondan en ese idioma. La IA
// recibe una sola instrucción clara (no "detecta el idioma"), porque los modelos locales pequeños
// mezclan idiomas cuando la regla es condicional. Si el texto no lo deja claro (un nombre, "ok",
// números), se usa el idioma de la app. Sin dependencias: también la cargan las pruebas de Node.

// Palabras frecuentes que casi no existen en el otro idioma (sin "a", "me", "no" ni "son").
const SPANISH = new Set(
  (
    "de la el que y en los las del al lo le se para con por una un unos unas mi mis tu tus su sus es " +
    "esta este esto estoy estas como pero porque cuando donde muy mas ya hay tengo tiene quiero puedo " +
    "hacer ser estar sobre sin entre hasta desde cada todo todos hoy manana semana semanas dia dias mes " +
    "meses ano hola gracias buenos buenas meta metas habito habitos proyecto libro libros curso " +
    "examen peso kilos dinero trabajo ingles espanol aprender correr leer escribir estudiar bajar subir " +
    "mejorar empezar terminar hablar practicar trabajar ahorrar crear lanzar preparar entrenar comer " +
    "dormir ayuda ayudame necesito minutos veces carrera idioma"
  ).split(" "),
);
const ENGLISH = new Set(
  (
    "the and to of in for with on at is are am was be been my your our this that these those it its " +
    "i im i'm you he she we they what how why when where can could will would should want need have " +
    "has do does did get make about from into every each today tomorrow week weeks day days month " +
    "months year hello hi thanks thank please goal goals habit habits project book books course exam " +
    "weight money work english spanish learn run read write study lose improve start finish speak " +
    "practice save build launch prepare train eat sleep help minutes times race language"
  ).split(" "),
);

const normalize = (text) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * "es" o "en" según el texto; `fallback` (el idioma de la app) si no se distingue. Acepta varios
 * textos, por ejemplo la idea, la situación y el resultado de una meta.
 */
export function textLanguage(texts, fallback = "es") {
  const raw = (Array.isArray(texts) ? texts : [texts]).filter((t) => t != null).join(" ");
  let es = (raw.match(/[áéíóúñ¿¡]/gi) || []).length;
  let en = 0;
  for (const word of normalize(raw).match(/[a-z']+/g) || []) {
    if (SPANISH.has(word)) es++;
    if (ENGLISH.has(word)) en++;
  }
  if (es > en) return "es";
  if (en > es) return "en";
  return fallback === "en" ? "en" : "es";
}
