import { tr } from "./i18n.js";
import { serverText } from "./server-messages.js";

const LABELS = {
  queued: ["En cola", "Queued"],
  processing: ["Procesando", "Processing"],
  completed: ["Completado", "Completed"],
  cancelled: ["Cancelado", "Cancelled"],
  error: ["Error", "Error"],
};
// Se lee al dibujar, en el idioma actual.
export const JOB_LABELS = Object.freeze(
  Object.defineProperties(
    {},
    Object.fromEntries(Object.entries(LABELS).map(([key, [es, en]]) => [key, { enumerable: true, get: () => tr(es, en) }])),
  ),
);
export const terminalJob = (job) =>
  ["completed", "cancelled", "error"].includes(job.status);
export function jobDescription(job) {
  if (job.status === "queued") {
    const position = job.position ? tr(`Posición ${job.position}. `, `Position ${job.position}. `) : "";
    const minutes = Math.max(1, Math.ceil(job.estimated_seconds / 60));
    const estimate =
      job.estimated_seconds === null || job.estimated_seconds === undefined
        ? tr("Tiempo variable; aún no hay suficientes datos.", "Variable time; there isn't enough data yet.")
        : tr(`Espera aproximada: ${minutes} min. Puede cambiar.`, `Approximate wait: ${minutes} min. It may change.`);
    const plan = { free: tr("Gratis", "Free"), plus: "Plus", pro: "Pro" }[job.plan_id] || "";
    return `${position}${job.worker_online ? estimate : tr("La IA local está desconectada; la IA en la nube (respaldo) preparará tu propuesta. Tu solicitud sigue guardada.", "The local AI is offline; the cloud AI (backup) will prepare your proposal. Your request is still saved.")} ${tr(`Prioridad según tu plan ${plan}, sin atención inmediata garantizada.`, `Priority based on your ${plan} plan, with no guaranteed immediate handling.`)}`;
  }
  if (job.status === "processing")
    return job.cancel_requested
      ? tr("Cancelación solicitada. Esperamos a que el servicio confirme la interrupción; no se guardará la propuesta.", "Cancellation requested. We're waiting for the service to confirm it stopped; the proposal won't be saved.")
      : job.provider === "cloud"
        ? tr("La IA en la nube (respaldo) está preparando la propuesta. Puedes navegar o cerrar la página y recuperarla al volver.", "The cloud AI (backup) is preparing the proposal. You can browse or close the page and get it back when you return.")
        : tr("La IA local está preparando la propuesta. Puedes navegar o cerrar la página y recuperarla al volver.", "The local AI is preparing the proposal. You can browse or close the page and get it back when you return.");
  if (job.status === "completed")
    return tr(
      `Tu propuesta está lista para revisar. La meta no cambia hasta que la confirmes.${job.provider === "cloud" ? " Preparada con IA en la nube (respaldo)." : ""}`,
      `Your proposal is ready to review. The goal doesn't change until you confirm it.${job.provider === "cloud" ? " Prepared with the cloud AI (backup)." : ""}`,
    );
  if (job.status === "cancelled")
    return tr("Solicitud cancelada. Tus metas se conservan.", "Request cancelled. Your goals are kept.");
  return (
    serverText(job.error) ||
    tr("No pudimos preparar la propuesta. Puedes editar la meta manualmente.", "We couldn't prepare the proposal. You can edit the goal manually.")
  );
}

/** Cloud polling is shared by the badge and dialogs, independent of navigation. */
export function createAiJobMonitor({
  list,
  cancel,
  notify = () => {},
  visibility = () => document.hidden,
  pollMs = 3000,
}) {
  let account = null,
    version = 0,
    timer,
    jobs = [],
    error = null,
    running = false;
  const listeners = new Set(),
    watchers = new Map(),
    notified = new Set();
  function publish() {
    listeners.forEach((fn) => fn(jobs, error));
  }
  async function poll() {
    if (!account || running) return;
    running = true;
    const revision = version;
    try {
      const next = await list();
      if (revision !== version) return;
      const previous = new Map(jobs.map((job) => [job.id, job.status]));
      const known = new Map(jobs.map((job) => [job.id, job]));
      // Un estado final no se revierte en el servidor: una lectura que salió antes de cancelar (red
      // móvil lenta) no puede volver a mostrar el trabajo como pendiente.
      jobs = next.map((job) => {
        const before = known.get(job.id);
        return before && terminalJob(before) && !terminalJob(job) ? before : job;
      });
      error = null;
      for (const job of jobs) {
        const callbacks = watchers.get(job.id);
        callbacks?.forEach((fn) => fn(job));
        if (terminalJob(job)) watchers.delete(job.id);
        if (job.status === "completed" && !notified.has(job.id)) {
          notified.add(job.id);
          // Tell once per running session; a reload shows the persistent result badge.
          if (
            callbacks ||
            ["queued", "processing"].includes(previous.get(job.id))
          )
            notify(tr("Tu propuesta con IA está lista para revisar.", "Your AI proposal is ready to review."));
        }
      }
      publish();
    } catch {
      if (revision === version) {
        error = tr(
          "No pudimos actualizar el estado. El trabajo sigue guardado; reintentaremos.",
          "We couldn't update the status. The work is still saved; we'll try again.",
        );
        publish();
      }
    } finally {
      running = false;
      clearTimeout(timer);
      if (account)
        timer = setTimeout(
          poll,
          revision !== version
            ? 0
            : visibility()
              ? 20000
              : jobs.some((job) => !terminalJob(job)) || watchers.size
                ? pollMs
                : 30000,
        );
    }
  }
  return {
    start(id) {
      if (id === account) return;
      this.stop();
      account = id;
      poll();
    },
    stop() {
      account = null;
      version++;
      clearTimeout(timer);
      jobs = [];
      error = null;
      watchers.clear();
      notified.clear();
    },
    refresh: poll,
    subscribe(fn) {
      listeners.add(fn);
      fn(jobs, error);
      return () => listeners.delete(fn);
    },
    watch(id, fn) {
      if (!watchers.has(id)) watchers.set(id, new Set());
      watchers.get(id).add(fn);
      const existing = jobs.find((j) => j.id === id);
      if (existing) fn(existing);
      if (existing && terminalJob(existing)) watchers.delete(id);
      poll();
      return () => {
        watchers.get(id)?.delete(fn);
      };
    },
    async cancel(id) {
      const job = await cancel(id);
      jobs = jobs.map((j) => (j.id === id ? job : j));
      watchers.get(id)?.forEach((fn) => fn(job));
      publish();
      return job;
    },
    get jobs() {
      return jobs;
    },
    get error() {
      return error;
    },
  };
}
