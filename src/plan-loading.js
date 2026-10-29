import { portrait } from "./pet-art.js";
import { createPetBehavior } from "./pet-behavior.js";
import { getPetMotionSettings } from "./pet-motion.js";
import { JOB_LABELS, jobDescription } from "./ai-jobs.js";
import { mountLumiGames } from "./lumi-games.js";
import { tr } from "./i18n.js";

/** Closing this view only detaches it. Persistent jobs continue in the worker. */
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
  screen.innerHTML = `<p class="eyebrow">${tr("UNA IDEA, MUCHOS PASOS POSIBLES", "ONE IDEA, MANY POSSIBLE STEPS")}</p>
    <div class="ai-loading-scene" aria-hidden="true"><span class="ai-orbit"></span><div class="ai-loading-portrait">${portrait(stage)}</div><span class="ai-spark ai-spark-one">✦</span><span class="ai-spark ai-spark-two">✧</span></div>
    <h3 tabindex="-1">${tr("Lumi está preparando tu plan", "Lumi is preparing your plan")}</h3>
    <p class="ai-loading-copy" data-plan-message>${tr("Buscando acciones que encajen con tu idea y el tiempo que tienes.", "Looking for actions that fit your idea and the time you have.")}</p>
    <div class="ai-loading-track" aria-hidden="true"><span></span></div>
    <p class="ai-loading-time" aria-hidden="true"><span class="ai-wait-dot"></span><span data-plan-status>${tr("Guardando solicitud", "Saving request")}</span> <span data-plan-elapsed>${tr("0:00 de espera", "0:00 waiting")}</span></p>
    <div class="lumi-games" data-lumi-games></div>
    <p data-plan-position></p><button type="button" class="secondary" data-cancel-job disabled>${tr("Cancelar solicitud", "Cancel request")}</button>
    <p class="ai-loading-note">${tr("Podrás revisar y editar la propuesta antes de guardar.<br>Tu meta todavía no ha cambiado. Puedes cerrar esta ventana: el trabajo seguirá guardado.", "You'll be able to review and edit the proposal before saving.<br>Your goal hasn't changed yet. You can close this window: the work will stay saved.")}</p>`;
  controls.forEach(([element]) => (element.disabled = true));
  form.hidden = true;
  form.setAttribute("aria-busy", "true");
  host.classList.add("is-generating");
  heading.textContent = tr("Tu plan está en camino", "Your plan is on its way");
  host.append(screen);
  const petBehavior = createPetBehavior(screen.querySelector(".lumi-art"), {
    motionQuery: getPetMotionSettings(),
  });
  const scene = screen.querySelector(".ai-loading-scene");
  // Mientras se juega, la Lumi del juego reemplaza al retrato grande.
  const games = mountLumiGames(screen.querySelector("[data-lumi-games]"), {
    stage,
    onPlayingChange(playing) {
      scene.hidden = playing;
      screen.classList.toggle("is-playing", playing);
    },
  });
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
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    elapsed.textContent = tr(`${clock} de espera`, `${clock} waiting`);
    if (seconds >= 90 && waitMessage < 2) {
      waitMessage = 2;
      message.textContent = tr(
        "Tu solicitud sigue guardada. Puedes continuar con tus metas y recuperar la propuesta desde «Mis solicitudes de IA».",
        "Your request is still saved. You can carry on with your goals and get the proposal from “My AI requests”.",
      );
    } else if (seconds >= 35 && waitMessage < 1) {
      waitMessage = 1;
      message.textContent = tr(
        "Los planes con más detalle pueden necesitar un poco más de tiempo. Lumi sigue preparando tu propuesta.",
        "More detailed plans can take a little longer. Lumi is still preparing your proposal.",
      );
    }
  }, 1000);

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    controller.abort();
    games.dispose();
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
    update(job, cancel) {
      if (disposed) return;
      screen.querySelector("h3").textContent =
        JOB_LABELS[job.status] || tr("Guardando solicitud", "Saving request");
      screen.querySelector("[data-plan-status]").textContent =
        JOB_LABELS[job.status];
      message.textContent =
        job.status === "queued"
          ? tr("Tu propuesta está guardada y espera su turno. Puedes continuar con tus metas.", "Your proposal is saved and waiting its turn. You can carry on with your goals.")
          : tr("Organizando acciones que encajen con tu idea y el tiempo que tienes.", "Organizing actions that fit your idea and the time you have.");
      screen.querySelector("[data-plan-position]").textContent =
        jobDescription(job);
      const button = screen.querySelector("[data-cancel-job]");
      button.disabled =
        !["queued", "processing"].includes(job.status) || job.cancel_requested;
      button.textContent =
        job.status === "processing"
          ? tr("Solicitar interrupción", "Ask to stop")
          : tr("Cancelar solicitud", "Cancel request");
      button.onclick = async () => {
        button.disabled = true;
        try {
          this.update(await cancel(job.id), cancel);
        } catch {
          screen.querySelector("[data-plan-position]").textContent =
            tr("No pudimos confirmar la cancelación. El trabajo sigue guardado; vuelve a intentarlo.", "We couldn't confirm the cancellation. The work is still saved; try again.");
          button.disabled = false;
        }
      };
    },
  };
}
