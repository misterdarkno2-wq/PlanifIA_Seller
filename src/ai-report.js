// "Reportar respuesta": cada respuesta de Lumi y cada plan propuesto por la IA se pueden reportar sin
// salir de la app (política de contenido generado por IA de Google Play). El servidor guarda una copia
// del contenido reportado tomada de la base de datos, no la que envía el teléfono (función
// report_ai_content). Todo se construye con nodos y textContent: el contenido nunca se interpreta.

export const REPORT_REASONS = {
  offensive: "Ofensiva o inapropiada",
  harmful: "Peligrosa o puede causar daño",
  wrong: "Incorrecta o engañosa",
  other: "Otro motivo",
};
export const REPORT_DETAILS_MAX = 500;
export const REPORT_THANKS = "Gracias. Revisaremos este contenido y, si corresponde, ajustaremos a Lumi.";

let formCount = 0;

/**
 * Botón "Reportar" que despliega un formulario breve debajo. `submit({ reason, details })` envía el
 * reporte; si lanza un error, su mensaje se muestra en el formulario.
 */
export function reportControl({ doc = document, label = "Reportar respuesta", submit }) {
  const wrap = doc.createElement("div");
  wrap.className = "ai-report";
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "text-button ai-report-toggle";
  toggle.textContent = label;
  toggle.setAttribute("aria-expanded", "false");
  wrap.append(toggle);
  let form = null;
  const close = () => {
    form?.remove();
    form = null;
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle.addEventListener("click", () => {
    if (form) return close();
    form = reportForm({ doc, submit, onCancel: close, onDone: (message) => {
      close();
      toggle.remove();
      const done = doc.createElement("p");
      done.className = "fine ai-report-done";
      done.setAttribute("role", "status");
      done.textContent = message;
      wrap.append(done);
    } });
    toggle.setAttribute("aria-expanded", "true");
    wrap.append(form);
    form.querySelector("input")?.focus({ preventScroll: true });
  });
  return wrap;
}

function reportForm({ doc, submit, onCancel, onDone }) {
  const id = `ai-report-${++formCount}`;
  const form = doc.createElement("form");
  form.className = "ai-report-form";
  form.noValidate = true;
  const fieldset = doc.createElement("fieldset");
  const legend = doc.createElement("legend");
  legend.textContent = "¿Qué problema tiene?";
  fieldset.append(legend);
  for (const [value, text] of Object.entries(REPORT_REASONS)) {
    const label = doc.createElement("label");
    const input = doc.createElement("input");
    input.type = "radio";
    input.name = `${id}-reason`;
    input.value = value;
    label.append(input, ` ${text}`);
    fieldset.append(label);
  }
  const detailsLabel = doc.createElement("label");
  detailsLabel.textContent = "Cuéntanos más · opcional";
  const details = doc.createElement("textarea");
  details.rows = 2;
  details.maxLength = REPORT_DETAILS_MAX;
  detailsLabel.append(details);
  const alert = doc.createElement("p");
  alert.className = "error";
  alert.setAttribute("role", "alert");
  alert.hidden = true;
  const actions = doc.createElement("div");
  actions.className = "actions";
  const send = doc.createElement("button");
  send.textContent = "Enviar reporte";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "text-button";
  cancel.textContent = "Cancelar";
  actions.append(send, cancel);
  form.append(fieldset, detailsLabel, alert, actions);
  cancel.addEventListener("click", onCancel);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const reason = form.querySelector("input:checked")?.value;
    if (!reason) {
      alert.textContent = "Elige qué problema tiene.";
      alert.hidden = false;
      return;
    }
    send.disabled = true;
    send.textContent = "Enviando…";
    alert.hidden = true;
    try {
      await submit({ reason, details: details.value.trim().slice(0, REPORT_DETAILS_MAX) });
      onDone(REPORT_THANKS);
    } catch (error) {
      alert.textContent = error?.message || "No pudimos enviar el reporte. Inténtalo de nuevo.";
      alert.hidden = false;
      send.disabled = false;
      send.textContent = "Enviar reporte";
    }
  });
  return form;
}
