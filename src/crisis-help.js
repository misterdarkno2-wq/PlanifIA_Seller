// Aviso fijo con líneas de ayuda de Chile cuando un mensaje o una meta describe una crisis.
// Lo escribe la app (no la IA) con los textos de supabase/functions/_shared/crisis.js, en el idioma
// de la app.
import { crisisText, detectCrisis } from "../supabase/functions/_shared/crisis.js";
import { lang } from "./i18n.js";

export { detectCrisis };

export const CRISIS_NOT_REFUNDED = crisisText("es").notRefunded;

/** Bloque con las líneas de ayuda, construido con nodos (sin innerHTML). */
export function crisisHelp({ doc = document, refunded = true, tag = "div" } = {}) {
  const text = crisisText(lang());
  const box = doc.createElement(tag);
  box.className = "crisis-help";
  box.dataset.crisisHelp = "";
  box.setAttribute("role", "alert");
  const title = doc.createElement("strong");
  title.textContent = text.title;
  const intro = doc.createElement("p");
  intro.textContent = text.intro;
  const list = doc.createElement("ul");
  for (const line of text.lines) {
    const item = doc.createElement("li");
    const phone = doc.createElement("strong");
    phone.textContent = line.phone;
    item.append(phone, ` ${line.name} (${line.detail}).`);
    list.append(item);
  }
  const closing = doc.createElement("p");
  closing.textContent = refunded ? text.closing : text.notRefunded;
  box.append(title, intro, list);
  if (text.abroad) {
    const abroad = doc.createElement("p");
    abroad.textContent = text.abroad;
    box.append(abroad);
  }
  box.append(closing);
  return box;
}
