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

// Versión en inglés del aviso (la app la muestra cuando está en inglés). Las líneas son las mismas
// de Chile, con su nombre original, y se agrega qué hacer fuera de Chile.
const CRISIS_EN = {
  title: "What you're going through matters, and you don't have to face it alone.",
  intro: "Lumi is an AI and can't support you through a crisis, but there are people who can right now:",
  lines: [
    { name: "Suicide Prevention Line (Línea de Prevención del Suicidio)", detail: "free, confidential and 24 hours a day, from mobile phones" },
    { name: "Salud Responde", detail: "health guidance, 24 hours a day" },
    { name: "SAMU (ambulance)", detail: "if your life or someone else's is at risk" },
    { name: "Carabineros (police)", detail: "if you are in danger" },
    { name: "Violence against women helpline (SernamEG)", detail: "every day from 8:00 to 24:00" },
  ],
  abroad: "These lines are in Chile. If you are somewhere else, call your local emergency number.",
  closing: "If you can, also tell someone you trust. No credits were deducted.",
  notRefunded: "If you can, also tell someone you trust. Check your balance: we couldn't confirm the credit refund.",
};

/** Textos del aviso en "es" o "en", con las mismas líneas de ayuda y en el mismo orden. */
export function crisisText(language = "es") {
  if (language !== "en")
    return {
      title: CRISIS_TITLE,
      intro: CRISIS_INTRO,
      lines: CRISIS_LINES,
      abroad: "",
      closing: CRISIS_CLOSING,
      notRefunded: "Si puedes, cuéntale también a alguien de confianza. Revisa tu saldo: no pudimos confirmar la devolución de créditos.",
    };
  return { ...CRISIS_EN, lines: CRISIS_LINES.map((line, i) => ({ ...line, ...CRISIS_EN.lines[i] })) };
}

/** Texto completo del aviso, el mismo en la app y en las respuestas del servidor. */
export const CRISIS_MESSAGE = [
  CRISIS_TITLE,
  CRISIS_INTRO,
  ...CRISIS_LINES.map((line) => `• ${line.phone}: ${line.name} (${line.detail}).`),
  CRISIS_CLOSING,
].join("\n");

// "matarme estudiando" o "me voy a matar trabajando" son exageraciones comunes: un gerundio justo
// después no cuenta como crisis. Lo mismo en inglés: "killing myself studying".
const NOT_GERUND = "(?! [a-z]+(ando|iendo)\\b)";
const NOT_ING = "(?! [a-z]+ing\\b)";
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
  // Inglés: la app también se usa en inglés y el texto llega normalizado igual ("don't" → "don t").
  rule("\\b(kill|killing|hurt|hurting|harm|harming) (myself|yourself|themselves)\\b" + NOT_ING),
  /\b(cut|cutting|hang|hanging|shoot|shooting|drown|drowning|starve|starving) (myself|yourself|themselves)\b/,
  /\b(want|wanna|going|gonna|ready) to die\b/,
  /\bwish i (was|were) dead\b/,
  /\bbetter off dead\b/,
  /\b(end|take|ending|taking) (my|your|their) (own )?life\b/,
  /\b(don t|do not|dont|no longer|not) want to (live|be alive|exist|wake up)\b/,
  /\bno (reason|point) (to|in) (live|living|being alive)\b/,
  /\bjump(ing)? (off|from) (a |the )?(bridge|building|roof|balcony|window)\b/,
  /\boverdos(e|ing)\b/,
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
  /\b(going to|gonna|want to|plan to|planning to) (kill|stab|shoot) (him|her|them|someone|somebody|everyone)\b/,
  /\b(he|she|they|partner|husband|wife|boyfriend|girlfriend|dad|father|mom|mother) (hits|beats|abuses|threatens|rapes) me\b/,
  /\b(is|are) (hitting|beating|abusing|threatening) me\b/,
  /\bdeath threats?\b/,
  /\bdomestic (violence|abuse)\b/,
  /\bsexual(ly)? (abuse|abused|assault|assaulted)\b/,
  /\b(raped|abused) me\b/,
  /\bi was raped\b/,
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
