// Detección de crisis (suicidio, autolesión y violencia) para el chat con Lumi y los planes con IA.
// La usan la app (antes de enviar el texto) y las Edge Functions (antes de llamar al modelo y sobre su
// respuesta). Ante una coincidencia Lumi no sigue la conversación: se muestra CRISIS_MESSAGE, que es
// fijo y no lo escribe la IA. Es una lista de expresiones, no un diagnóstico: prefiere mostrar el aviso
// de más antes que dejar pasar una crisis. Sin dependencias: también la cargan las pruebas de Node.

/**
 * Líneas de ayuda de Chile, verificadas el 2026-10-18 en minsal.cl y chileatiende.gob.cl.
 * Revisa los números al menos una vez al año (ver docs/auditoria-legal-seguridad-2026-10-18.md).
 */
export const CRISIS_LINES = [
  { phone: "*4141", name: "Línea de Prevención del Suicidio", detail: "gratuita, confidencial y las 24 horas, desde celulares" },
  { phone: "600 360 7777", name: "Salud Responde", detail: "orientación en salud, las 24 horas" },
  { phone: "131", name: "SAMU", detail: "si hay riesgo para tu vida o la de otra persona" },
  { phone: "133", name: "Carabineros", detail: "si estás en peligro" },
  { phone: "1455", name: "Orientación en violencia contra la mujer (SernamEG)", detail: "todos los días de 8:00 a 24:00" },
];

export const CRISIS_TITLE = "Lo que cuentas importa y no tienes que pasarlo sola ni solo.";
export const CRISIS_INTRO =
  "Lumi es una IA y no puede acompañarte en una crisis, pero hay personas que sí pueden hacerlo ahora mismo:";
export const CRISIS_CLOSING =
  "Si puedes, cuéntale también a alguien de confianza. No se descontaron créditos.";

/** Texto completo del aviso, el mismo en la app y en las respuestas del servidor. */
export const CRISIS_MESSAGE = [
  CRISIS_TITLE,
  CRISIS_INTRO,
  ...CRISIS_LINES.map((line) => `• ${line.phone}: ${line.name} (${line.detail}).`),
  CRISIS_CLOSING,
].join("\n");

// "matarme estudiando" o "me voy a matar trabajando" son exageraciones comunes: un gerundio justo
// después no cuenta como crisis.
const NOT_GERUND = "(?! [a-z]+(ando|iendo)\\b)";
const rule = (source) => new RegExp(source);

// Se buscan sobre el texto normalizado: minúsculas, sin tildes y con la puntuación como espacios.
// "(me|te|se)" cubre lo que escribe la persona y lo que podría responder el modelo.
const SELF_HARM = [
  /\bsuicid/,
  /\bquitar(me|te|se) la vida\b/,
  rule("\\b(me|te|se) (quiero|quieres|quiere|voy a|vas a|va a) (matar|quitar la vida)\\b" + NOT_GERUND),
  rule("\\bmatar(me|te|se)\\b" + NOT_GERUND),
  /\b(no quiero|no quieres|ya no quiero) (seguir )?(vivir|existir)\b/,
  /\b(quiero|quisiera|me quiero) morir(me)?\b/,
  /\bganas de morir(me)?\b/,
  /\b(prefiero|preferiria|mejor) (estar )?muert[oa]\b/,
  /\bacabar con (todo|mi vida|tu vida|su vida)\b/,
  /\bno (vale|tiene sentido) (la pena )?(seguir )?vivir\b/,
  /\bhacer(me|te|se) dano\b/,
  /\b(me|te|se) (hago|haces|hace) dano\b/,
  /\bautolesi/,
  /\blastimar(me|te|se)\b/,
  /\bcortar(me|te|se) (las venas|los brazos|las munecas|las piernas)\b/,
  /\b(me|te|se) (corto|cortas|corta) (las venas|los brazos|las munecas|las piernas)\b/,
  /\b(tirar|lanzar)(me|te|se) (de|del|desde|al|a la|a las) (un |una |el |la )?(puente|edificio|balcon|piso|techo|metro|vias|tren|ventana)\b/,
  /\bahorcar(me|te|se)\b/,
  /\bsobredosis\b/,
  /\b(kill|hurt) (myself|yourself)\b/,
  /\b(want|wanna) to die\b/,
  /\bself ?harm\b/,
];
const VIOLENCE = [
  /\b(voy a|quiero|pienso|planeo|tengo ganas de) (matar a|matarl[oa]s?|apunalar|dispararle)\b/,
  /\bhacerle dano a\b/,
  /\b(me|nos) (pega|pegan|golpea|golpean|maltrata|maltratan|amenaza|amenazan)\b/,
  /\b(me|nos) (esta|estan) (pegando|golpeando|maltratando|amenazando)\b/,
  /\bamenaza(s|do|da)? de muerte\b/,
  /\bviolencia (intrafamiliar|domestica|de genero)\b/,
  /\babuso sexual\b/,
  /\babusaron de mi\b/,
  /\bme (violo|violaron)\b/,
];

export function normalizeForCrisis(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "self_harm", "violence" o null. Acepta varios textos (por ejemplo, los campos de una meta). */
export function detectCrisis(...texts) {
  const text = normalizeForCrisis(texts.filter((t) => t != null).join(" \n "));
  if (!text) return null;
  if (SELF_HARM.some((pattern) => pattern.test(text))) return "self_harm";
  if (VIOLENCE.some((pattern) => pattern.test(text))) return "violence";
  return null;
}
