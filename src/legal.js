// Versión vigente de los Términos de uso y de la Política de privacidad. Es el único lugar del código
// donde se cambia. Al publicar una versión nueva:
//   1. Copia la página anterior a public/legal/ (por ejemplo, public/legal/terminos-2026-10-21.html).
//   2. Cambia aquí la fecha y actualiza data-legal-version y el historial de la página.
//   3. Las cuentas que aceptaron una versión anterior verán la pantalla para aceptar de nuevo antes de
//      usar la IA o comprar (tests/legal-security.test.js comprueba que todo coincida).
import { locale, tr } from "./i18n.js";
import { serverText } from "./server-messages.js";

export const LEGAL_VERSION = Object.freeze({ terms: "2026-10-21", privacy: "2026-10-22" });

/** La más reciente de dos versiones (fechas ISO, se comparan como texto). */
export const newerVersion = (a, b) => (a > b ? a : b);

// Páginas legales en el idioma actual. La versión en español es la que rige; la de inglés es una
// traducción (lo dice al comienzo de cada página).
const PAGES = {
  terms: ["terminos.html", "terms.html"],
  privacy: ["privacidad.html", "privacy.html"],
  deletion: ["eliminar-cuenta.html", "delete-account.html"],
};
const pages = (prefix) =>
  Object.freeze(
    Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(PAGES).map(([key, [es, en]]) => [key, { enumerable: true, get: () => prefix + tr(es, en) }]),
      ),
    ),
  );
/** Direcciones completas: Android las abre en el navegador del teléfono. */
export const LEGAL_URLS = pages("https://planifia.cl/");
/** Direcciones relativas para los enlaces de la portada web. */
export const LEGAL_PAGES = pages("./");

const VERSION = /^\d{4}-\d{2}-\d{2}$/;

/** ¿La última aceptación cubre las versiones vigentes? Las fechas ISO se comparan como texto. */
export function legalCurrent(acceptance, version = LEGAL_VERSION) {
  return Boolean(
    acceptance &&
      VERSION.test(acceptance.terms_version || "") &&
      VERSION.test(acceptance.privacy_version || "") &&
      acceptance.terms_version >= version.terms &&
      acceptance.privacy_version >= version.privacy,
  );
}

/** Lo que se envía al crear la cuenta; el servidor lo registra con su propia fecha y hora. */
export function signupLegal(platform) {
  return {
    terms_version: LEGAL_VERSION.terms,
    privacy_version: LEGAL_VERSION.privacy,
    platform,
    age_confirmed: true,
  };
}

export const legalDateLabel = (value) =>
  new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );

/**
 * Casilla obligatoria y sin marcar con enlaces que se abren aparte (sin perder lo escrito).
 * `name` permite tener más de una en la página.
 */
export function legalConsentMarkup(name = "legal_consent") {
  const terms = `<a href="${LEGAL_URLS.terms}" target="_blank" rel="noopener noreferrer" data-external-link>${tr("Términos de uso", "Terms of Use")}</a>`,
    privacy = `<a href="${LEGAL_URLS.privacy}" target="_blank" rel="noopener noreferrer" data-external-link>${tr("Política de privacidad", "Privacy Policy")}</a>`;
  return `<label class="legal-consent"><input type="checkbox" name="${name}" required data-legal-consent> <span>${tr(`Tengo 18 años o más y acepto los ${terms} y la ${privacy}.`, `I am 18 or older and I accept the ${terms} and the ${privacy}.`)}</span></label>`;
}

/**
 * Tarjeta para aceptar una versión nueva. Se inserta dentro de lo que la persona estaba haciendo
 * (formulario de meta, chat o compra) para no perder lo escrito. Todo el texto es fijo.
 * `accept()` registra la aceptación; `onExport` y `onDelete` son las salidas si no acepta.
 */
export function legalUpdateCard({ doc = document, accept, onAccepted = () => {}, onLater = () => {}, onExport, onDelete, reason = "" }) {
  const card = doc.createElement("section");
  card.className = "legal-update panel";
  card.dataset.legalUpdate = "";
  card.setAttribute("aria-labelledby", "legal-update-title");
  const date = legalDateLabel(newerVersion(LEGAL_VERSION.terms, LEGAL_VERSION.privacy));
  card.innerHTML = `<h2 id="legal-update-title" tabindex="-1">${tr("Actualizamos los Términos y la Política de privacidad", "We updated the Terms and the Privacy Policy")}</h2>
    <p>${reason ? `${reason} ` : ""}${tr(`Revisa y acepta la versión del ${date} para seguir usando la IA y comprar en PlanifIA. Tus metas y tu progreso siguen disponibles aunque no aceptes.`, `Review and accept the ${date} version to keep using the AI and buying in PlanifIA. Your goals and progress stay available even if you don't accept.`)}</p>
    <ul class="legal-update-changes">
      <li>${tr("Los correos de tu cuenta (confirmación y recuperación de contraseña) ahora los envía Brevo, desde no-responder@planifia.cl.", "Your account emails (confirmation and password recovery) are now sent by Brevo, from no-responder@planifia.cl.")}</li>
      <li>${tr("En la app para Android puedes activar un recordatorio diario: guardamos la hora que eliges y el aviso lo programa tu teléfono.", "In the Android app you can turn on a daily reminder: we store the time you choose and your phone schedules the notification.")}</li>
      <li>${tr("Ahora puedes entrar con tu cuenta de Google: explicamos qué datos nos entrega Google y cómo quitarle el acceso.", "You can now sign in with your Google account: we explain what data Google gives us and how to remove its access.")}</li>
      <li>${tr("Identificamos a quien responde por tus datos y explicamos todos tus derechos y cómo ejercerlos.", "We identify who is responsible for your data and explain all your rights and how to exercise them.")}</li>
      <li>${tr("Detallamos qué datos recibe cada proveedor (Supabase, Groq, Google, Cloudflare y GitHub) y en qué país.", "We detail what data each provider receives (Supabase, Groq, Google, Cloudflare and GitHub) and in which country.")}</li>
      <li>${tr("Explicamos los límites de la IA, las líneas de ayuda y cómo reportar una respuesta.", "We explain the AI's limits, the helplines and how to report a response.")}</li>
      <li>${tr("Aclaramos las compras, la renovación de las suscripciones, el retracto y los reembolsos.", "We clarify purchases, subscription renewals, withdrawal and refunds.")}</li>
    </ul>
    <form data-legal-form>${legalConsentMarkup("legal_update")}
      <p class="error" role="alert" hidden></p>
      <div class="actions"><button data-legal-accept disabled>${tr("Aceptar y continuar", "Accept and continue")}</button><button type="button" class="text-button" data-legal-later>${tr("Ahora no", "Not now")}</button></div>
    </form>
    <p class="fine">${tr("Si no estás de acuerdo, puedes", "If you don't agree, you can")} <button type="button" class="text-button" data-legal-export>${tr("exportar tus datos", "export your data")}</button> ${tr("y", "and")} <button type="button" class="text-button" data-legal-delete>${tr("eliminar tu cuenta", "delete your account")}</button>.</p>`;
  const form = card.querySelector("[data-legal-form]");
  const box = form.querySelector("[data-legal-consent]");
  const button = form.querySelector("[data-legal-accept]");
  const alert = form.querySelector("[role=alert]");
  box.addEventListener("change", () => (button.disabled = !box.checked));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // La tarjeta se coloca junto a otros formularios (una meta, el chat): su envío no debe llegarles.
    event.stopPropagation();
    if (!box.checked || button.disabled) return;
    button.disabled = true;
    button.textContent = tr("Guardando…", "Saving…");
    alert.hidden = true;
    try {
      const result = await accept();
      card.remove();
      onAccepted(result);
    } catch (error) {
      alert.textContent = serverText(error?.message) || tr("No pudimos guardar tu aceptación. Inténtalo de nuevo.", "We couldn't save your acceptance. Try again.");
      alert.hidden = false;
      button.disabled = !box.checked;
      button.textContent = tr("Aceptar y continuar", "Accept and continue");
    }
  });
  card.querySelector("[data-legal-later]").addEventListener("click", () => {
    card.remove();
    onLater();
  });
  card.querySelector("[data-legal-export]").addEventListener("click", () => onExport?.());
  card.querySelector("[data-legal-delete]").addEventListener("click", () => onDelete?.());
  return card;
}
