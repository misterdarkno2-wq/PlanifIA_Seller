import { portrait } from "./pet-art.js";
import { createPetBehavior } from "./pet-behavior.js";

/** Owns the waiting screen, request lifetime and form restoration. */
export function startPlanLoading(host, form, stage) {
  const controller = new AbortController();
  const controls = [...form.elements].map((element) => [
    element,
    element.disabled,
  ]);
  const heading = host.querySelector("#dialog-title");
  const originalTitle = heading.textContent;
  const started = performance.now();
  let disposed = false,
    waitMessage = 0;
  const screen = document.createElement("section");
  screen.className = "ai-loading pet-thinking";
  screen.setAttribute("role", "status");
  screen.setAttribute("aria-live", "polite");
  screen.setAttribute("aria-atomic", "true");
  screen.innerHTML = `<p class="eyebrow">UNA IDEA, MUCHOS PASOS POSIBLES</p>
    <div class="ai-loading-scene" aria-hidden="true"><span class="ai-orbit"></span><div class="ai-loading-portrait">${portrait(stage)}</div><span class="ai-spark ai-spark-one">✦</span><span class="ai-spark ai-spark-two">✧</span></div>
    <h3 tabindex="-1">Lumi está preparando tu plan</h3>
    <p class="ai-loading-copy" data-plan-message>Buscando acciones que encajen con tu idea y el tiempo que tienes.</p>
    <div class="ai-loading-track" aria-hidden="true"><span></span></div>
    <p class="ai-loading-time" aria-hidden="true"><span class="ai-wait-dot"></span>Generando con IA <span data-plan-elapsed>0:00 de espera</span></p>
    <div class="ai-plan-preview" aria-hidden="true">${[1, 2, 3].map((number) => `<div class="ai-preview-card"><span class="ai-preview-number">${number}</span><div><i></i><i></i></div></div>`).join("")}</div>
    <p class="ai-loading-note">Podrás revisar y editar la propuesta antes de guardar.<br>Tu meta todavía no ha cambiado.</p>`;
  controls.forEach(([element]) => (element.disabled = true));
  form.hidden = true;
  form.setAttribute("aria-busy", "true");
  host.classList.add("is-generating");
  heading.textContent = "Tu plan está en camino";
  host.append(screen);
  const petBehavior = createPetBehavior(screen.querySelector(".lumi-art"));
  host.scrollTop = 0;
  screen.querySelector("h3").focus({ preventScroll: true });

  const elapsed = screen.querySelector("[data-plan-elapsed]");
  const message = screen.querySelector("[data-plan-message]");
  const timer = setInterval(() => {
    if (!host.isConnected || !host.open) {
      dispose();
      return;
    }
    const seconds = Math.floor((performance.now() - started) / 1000);
    elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} de espera`;
    if (seconds >= 90 && waitMessage < 2) {
      waitMessage = 2;
      message.textContent =
        "Seguimos esperando la respuesta de la IA. Puedes cerrar esta ventana y volver a intentarlo cuando quieras.";
    } else if (seconds >= 35 && waitMessage < 1) {
      waitMessage = 1;
      message.textContent =
        "Los planes con más detalle pueden necesitar un poco más de tiempo. Lumi sigue preparando tu propuesta.";
    }
  }, 1000);

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    controller.abort();
    petBehavior.dispose();
    host.removeEventListener("close", dispose);
    host.removeEventListener("cancel", dispose);
    screen.remove();
    host.classList.remove("is-generating");
    form.removeAttribute("aria-busy");
    heading.textContent = originalTitle;
    form.hidden = false;
    controls.forEach(([element, disabled]) => (element.disabled = disabled));
  }
  host.addEventListener("close", dispose, { once: true });
  host.addEventListener("cancel", dispose, { once: true });
  return {
    signal: controller.signal,
    isActive: () => !disposed && host.isConnected && host.open,
    dispose,
  };
}
