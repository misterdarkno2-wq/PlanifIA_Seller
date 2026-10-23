// Versión vigente de los Términos de uso y de la Política de privacidad. Es el único lugar del código
// donde se cambia. Al publicar una versión nueva:
//   1. Copia la página anterior a public/legal/ (por ejemplo, public/legal/terminos-2026-10-21.html).
//   2. Cambia aquí la fecha y actualiza data-legal-version y el historial de la página.
//   3. Las cuentas que aceptaron una versión anterior verán la pantalla para aceptar de nuevo antes de
//      usar la IA o comprar (tests/legal-security.test.js comprueba que todo coincida).
export const LEGAL_VERSION = Object.freeze({ terms: "2026-10-21", privacy: "2026-10-22" });

/** La más reciente de dos versiones (fechas ISO, se comparan como texto). */
export const newerVersion = (a, b) => (a > b ? a : b);

export const LEGAL_URLS = Object.freeze({
  terms: "https://planifia.cl/terminos.html",
  privacy: "https://planifia.cl/privacidad.html",
});

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
  new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );

/**
 * Casilla obligatoria y sin marcar con enlaces que se abren aparte (sin perder lo escrito).
 * `name` permite tener más de una en la página.
 */
export function legalConsentMarkup(name = "legal_consent") {
  return `<label class="legal-consent"><input type="checkbox" name="${name}" required data-legal-consent> <span>Tengo 18 años o más y acepto los <a href="${LEGAL_URLS.terms}" target="_blank" rel="noopener noreferrer" data-external-link>Términos de uso</a> y la <a href="${LEGAL_URLS.privacy}" target="_blank" rel="noopener noreferrer" data-external-link>Política de privacidad</a>.</span></label>`;
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
  card.innerHTML = `<h2 id="legal-update-title" tabindex="-1">Actualizamos los Términos y la Política de privacidad</h2>
    <p>${reason ? `${reason} ` : ""}Revisa y acepta la versión del ${legalDateLabel(newerVersion(LEGAL_VERSION.terms, LEGAL_VERSION.privacy))} para seguir usando la IA y comprar en PlanifIA. Tus metas y tu progreso siguen disponibles aunque no aceptes.</p>
    <ul class="legal-update-changes">
      <li>Los correos de tu cuenta (confirmación y recuperación de contraseña) ahora los envía Brevo, desde no-responder@planifia.cl.</li>
      <li>En la app para Android puedes activar un recordatorio diario: guardamos la hora que eliges y el aviso lo programa tu teléfono.</li>
      <li>Ahora puedes entrar con tu cuenta de Google: explicamos qué datos nos entrega Google y cómo quitarle el acceso.</li>
      <li>Identificamos a quien responde por tus datos y explicamos todos tus derechos y cómo ejercerlos.</li>
      <li>Detallamos qué datos recibe cada proveedor (Supabase, Groq, Google, Cloudflare y GitHub) y en qué país.</li>
      <li>Explicamos los límites de la IA, las líneas de ayuda y cómo reportar una respuesta.</li>
      <li>Aclaramos las compras, la renovación de las suscripciones, el retracto y los reembolsos.</li>
    </ul>
    <form data-legal-form>${legalConsentMarkup("legal_update")}
      <p class="error" role="alert" hidden></p>
      <div class="actions"><button data-legal-accept disabled>Aceptar y continuar</button><button type="button" class="text-button" data-legal-later>Ahora no</button></div>
    </form>
    <p class="fine">Si no estás de acuerdo, puedes <button type="button" class="text-button" data-legal-export>exportar tus datos</button> y <button type="button" class="text-button" data-legal-delete>eliminar tu cuenta</button>.</p>`;
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
    button.textContent = "Guardando…";
    alert.hidden = true;
    try {
      const result = await accept();
      card.remove();
      onAccepted(result);
    } catch (error) {
      alert.textContent = error?.message || "No pudimos guardar tu aceptación. Inténtalo de nuevo.";
      alert.hidden = false;
      button.disabled = !box.checked;
      button.textContent = "Aceptar y continuar";
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
