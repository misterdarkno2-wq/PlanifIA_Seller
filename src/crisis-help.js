// Aviso fijo con líneas de ayuda de Chile cuando un mensaje o una meta describe una crisis.
// Lo escribe la app (no la IA) con los textos de supabase/functions/_shared/crisis.js.
import {
  CRISIS_CLOSING,
  CRISIS_INTRO,
  CRISIS_LINES,
  CRISIS_TITLE,
  detectCrisis,
} from "../supabase/functions/_shared/crisis.js";

export { detectCrisis };

export const CRISIS_NOT_REFUNDED =
  "Si puedes, cuéntale también a alguien de confianza. Revisa tu saldo: no pudimos confirmar la devolución de créditos.";

/** Bloque con las líneas de ayuda, construido con nodos (sin innerHTML). */
export function crisisHelp({ doc = document, refunded = true, tag = "div" } = {}) {
  const box = doc.createElement(tag);
  box.className = "crisis-help";
  box.dataset.crisisHelp = "";
  box.setAttribute("role", "alert");
  const title = doc.createElement("strong");
  title.textContent = CRISIS_TITLE;
  const intro = doc.createElement("p");
  intro.textContent = CRISIS_INTRO;
  const list = doc.createElement("ul");
  for (const line of CRISIS_LINES) {
    const item = doc.createElement("li");
    const phone = doc.createElement("strong");
    phone.textContent = line.phone;
    item.append(phone, ` ${line.name} (${line.detail}).`);
    list.append(item);
  }
  const closing = doc.createElement("p");
  closing.textContent = refunded ? CRISIS_CLOSING : CRISIS_NOT_REFUNDED;
  box.append(title, intro, list, closing);
  return box;
}
