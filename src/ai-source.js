// Origen de la IA que se muestra en la app. La conmutación local ↔ nube ocurre en el servidor
// (lumi-chat y ai-fallback): la clave de Groq nunca llega al teléfono. Aquí sólo se muestra el
// origen y se pide el respaldo para una propuesta en cola mientras el PC está apagado.

export const AI_SOURCE_LABELS = {
  local: "IA local",
  cloud: "IA en la nube (respaldo)",
};

export const aiSourceLabel = (source) => AI_SOURCE_LABELS[source] || "";

/** Mientras la IA local siga apagada se vuelve a pedir el respaldo cada minuto, no en cada sondeo. */
export const CLOUD_RETRY_MS = 60000;

/**
 * Observa las solicitudes de la cola (las mismas que muestra la app) y, para cada una en cola con el
 * PC desconectado, pide a ai-fallback que la prepare en la nube. El servidor vuelve a comprobar que
 * la IA local siga apagada y aplica los límites; si el PC volvió, no hace nada.
 */
export function createCloudFallback({
  request,
  onStarted = () => {},
  now = Date.now,
  retryMs = CLOUD_RETRY_MS,
}) {
  const attempts = new Map();
  const inflight = new Set();
  return {
    consider(jobs) {
      const waiting = new Set();
      for (const job of jobs || []) {
        if (job.status !== "queued" || job.cancel_requested || job.worker_online !== false) continue;
        waiting.add(job.id);
        if (inflight.has(job.id) || now() - (attempts.get(job.id) ?? -Infinity) < retryMs) continue;
        attempts.set(job.id, now());
        inflight.add(job.id);
        Promise.resolve()
          .then(() => request(job.id))
          .then((result) => {
            if (result?.status === "processing") onStarted(job.id);
          })
          // Sin respaldo o con su límite alcanzado la solicitud sigue guardada en la cola.
          .catch(() => {})
          .finally(() => inflight.delete(job.id));
      }
      // Si el PC vuelve o la solicitud termina, se olvida para no acumular estado.
      for (const id of attempts.keys()) if (!waiting.has(id) && !inflight.has(id)) attempts.delete(id);
    },
    reset() {
      attempts.clear();
      inflight.clear();
    },
  };
}
