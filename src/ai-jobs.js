export const JOB_LABELS = {
  queued: "En cola",
  processing: "Procesando",
  completed: "Completado",
  cancelled: "Cancelado",
  error: "Error",
};
export const terminalJob = (job) =>
  ["completed", "cancelled", "error"].includes(job.status);
export function jobDescription(job) {
  if (job.status === "queued") {
    const position = job.position ? `Posición ${job.position}. ` : "";
    const estimate =
      job.estimated_seconds === null || job.estimated_seconds === undefined
        ? "Tiempo variable; aún no hay suficientes datos."
        : `Espera aproximada: ${Math.max(1, Math.ceil(job.estimated_seconds / 60))} min. Puede cambiar.`;
    return `${position}${job.worker_online ? estimate : "La GPU está desconectada; tu solicitud sigue guardada."} Prioridad según tu plan ${{ free: "Gratis", plus: "Plus", pro: "Pro" }[job.plan_id] || ""}, sin atención inmediata garantizada.`;
  }
  if (job.status === "processing")
    return job.cancel_requested
      ? "Cancelación solicitada. Esperamos a que el servicio confirme la interrupción; no se guardará la propuesta."
      : "La GPU está preparando la propuesta. Puedes navegar o cerrar la página y recuperarla al volver.";
  if (job.status === "completed")
    return "Tu propuesta está lista para revisar. La meta no cambia hasta que la confirmes.";
  if (job.status === "cancelled")
    return "Solicitud cancelada. Tus metas se conservan.";
  return (
    job.error ||
    "No pudimos preparar la propuesta. Puedes editar la meta manualmente."
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
      jobs = next;
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
            notify("Tu propuesta con IA está lista para revisar.");
        }
      }
      publish();
    } catch {
      if (revision === version) {
        error =
          "No pudimos actualizar el estado. El trabajo sigue guardado; reintentaremos.";
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
