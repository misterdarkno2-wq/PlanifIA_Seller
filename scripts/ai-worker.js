import { createClient } from "@supabase/supabase-js";
import {
  generateValidatedPlan,
  PlanGenerationError,
} from "../supabase/functions/_shared/generate-plan.ts";

/** One loop per slot. PostgreSQL owns scheduling, leases, retries and quotas. */
export function startAiWorker({
  rpc,
  generate,
  pollMs = 3000,
  heartbeatMs = 10000,
  onError = () => {},
}) {
  let stopped = false,
    timer,
    active = null,
    pulse;
  const invoke = async (name, args) => {
    const { data, error } = await rpc(name, args);
    if (error) throw new Error("No pudimos acceder a la cola privada.");
    return data;
  };
  async function tick() {
    if (stopped) return;
    try {
      const job = await invoke("claim_ai_job");
      if (job && !stopped) {
        const controller = new AbortController();
        active = controller;
        let checking = false;
        const renew = async () => {
          if (checking) return;
          checking = true;
          try {
            const state = await invoke("heartbeat_ai_job", {
              p_id: job.id,
              p_token: job.lease_token,
            });
            if (!state?.owned || state.cancel_requested)
              controller.abort(
                new Error("Trabajo cancelado o concesión perdida."),
              );
          } catch {
            // Fail closed: do not keep consuming the GPU without a confirmed lease.
            controller.abort(new Error("Se perdió la conexión con la cola."));
          } finally {
            checking = false;
          }
        };
        pulse = setInterval(renew, heartbeatMs);
        let result = null,
          problem = null,
          retry = false;
        try {
          result = await generate(job, controller.signal);
        } catch (error) {
          problem =
            error instanceof PlanGenerationError
              ? error.message
              : "No pudimos conectar con la GPU. Se intentará de nuevo dentro del límite configurado.";
          retry =
            !stopped &&
            (!controller.signal.aborted ||
              !/cancelado/.test(controller.signal.reason?.message || "")) &&
            (!(error instanceof PlanGenerationError) ||
              [429, 502, 504].includes(error.status));
        } finally {
          clearInterval(pulse);
          pulse = null;
        }
        // Fencing token prevents a stale process from saving a second result.
        await invoke("finish_ai_job", {
          p_id: job.id,
          p_token: job.lease_token,
          p_result: result,
          p_error: problem,
          p_retry: retry || stopped,
        });
        active = null;
      }
    } catch {
      onError("Cola temporalmente desconectada; volveremos a comprobarla.");
    } finally {
      if (!stopped) timer = setTimeout(tick, pollMs);
    }
  }
  tick();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      active?.abort(new Error("Servicio detenido."));
    },
  };
}

export function startConfiguredWorker(gateway, env = process.env) {
  const url = env.QUEUE_SUPABASE_URL,
    key = env.QUEUE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Faltan QUEUE_SUPABASE_URL y QUEUE_SERVICE_ROLE_KEY en .env.gateway.local para iniciar la cola.",
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".supabase.co") ||
    parsed.username ||
    parsed.password
  )
    throw new Error(
      "Configura la URL HTTPS del proyecto Supabase para la cola.",
    );
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, options = {}) =>
        fetch(url, {
          ...options,
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
            : AbortSignal.timeout(15000),
        }),
    },
  });
  const workers = Array.from({ length: gateway.concurrency || 1 }, () =>
    startAiWorker({
      rpc: (name, args) => client.rpc(name, args),
      onError: console.error,
      generate: async (job, signal) => {
        const { requestData, limits, goal_id, expected_version } = job.payload;
        const proposal = await generateValidatedPlan({
          endpoint: `http://127.0.0.1:${gateway.port}/v1/chat/completions`,
          apiKey: gateway.secret,
          model: gateway.model,
          requestData,
          limits,
          signal,
          allowLoopback: true,
          budgetMs: job.timeout_ms,
        });
        return {
          proposal: {
            ...proposal,
            start_date: limits.startDate,
            target_date: limits.targetDate,
            weekly_minutes: limits.weeklyMinutes,
            current_situation: requestData.current_situation || "",
          },
          constraints: {
            remainingDaily: limits.remainingDaily,
            remainingWeekly: limits.remainingWeekly,
            availableDays: limits.availableDays,
          },
          goal_id,
          expected_version,
        };
      },
    }),
  );
  return {
    stop() {
      workers.forEach((worker) => worker.stop());
    },
  };
}
