import { fitSchedule, PLAN_SCHEMA, SYSTEM, validateProposal } from "./plan.js";

export class PlanGenerationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PlanGenerationError";
    this.status = status;
  }
}

export type PlanLimits = {
  weeklyMinutes: number;
  remainingDaily: Record<string, number>;
  remainingWeekly: number[];
  startDate: string;
  targetDate?: string | null;
  availableDays: number[];
};

type GenerationOptions = {
  endpoint: string;
  apiKey: string;
  model: string;
  requestData: Record<string, unknown>;
  limits: PlanLimits;
  fetchImpl?: typeof fetch;
  /** Tests may reduce the total budget, but cannot exceed the production limit. */
  budgetMs?: number;
  signal?: AbortSignal;
  /** Private worker may call only the loopback gateway over HTTP. */
  allowLoopback?: boolean;
};

const timeoutError = () =>
  new PlanGenerationError(
    504,
    "La IA está tardando demasiado. Puedes reintentarlo o crear la meta manualmente.",
  );

async function withinBudget<T>(
  deadline: number,
  operation: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  const remaining = Math.ceil(deadline - performance.now());
  if (remaining <= 0) throw timeoutError();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError());
      controller.abort();
    }, remaining);
  });
  try {
    parent?.throwIfAborted();
    return await Promise.race([
      operation(
        parent
          ? AbortSignal.any([controller.signal, parent])
          : controller.signal,
      ),
      expired,
    ]);
  } catch (error) {
    if (parent?.aborted) throw parent.reason;
    if (error instanceof PlanGenerationError) throw error;
    if (
      controller.signal.aborted ||
      (error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name))
    )
      throw timeoutError();
    throw new PlanGenerationError(
      502,
      "No pudimos comunicarnos con el proveedor de IA. Inténtalo de nuevo más tarde.",
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Generates at most twice, validating every result without saving a plan. */
export async function generateValidatedPlan({
  endpoint,
  apiKey,
  model,
  requestData,
  limits,
  fetchImpl = fetch,
  budgetMs = 125000,
  signal,
  allowLoopback = false,
}: GenerationOptions) {
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 125000)
    throw new PlanGenerationError(
      502,
      "El tiempo máximo de IA está mal configurado.",
    );
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PlanGenerationError(
      502,
      "La dirección del proveedor de IA está mal configurada.",
    );
  }
  if (
    (url.protocol !== "https:" &&
      !(
        allowLoopback &&
        url.protocol === "http:" &&
        url.hostname === "127.0.0.1"
      )) ||
    url.username ||
    url.password ||
    !apiKey ||
    !model
  )
    throw new PlanGenerationError(
      502,
      "La conexión segura con el proveedor de IA está incompleta.",
    );
  const deadline = performance.now() + budgetMs;
  const effectiveWeekly = Array.from({ length: 4 }, (_, index) =>
    Math.max(
      0,
      Math.min(
        limits.weeklyMinutes,
        limits.remainingWeekly[index] ?? limits.weeklyMinutes,
      ),
    ),
  );
  const payload = {
    ...requestData,
    startDate: limits.startDate,
    targetDate: limits.targetDate ?? null,
    weekly_minutes: limits.weeklyMinutes,
    remainingDaily: limits.remainingDaily,
    remainingWeekly: effectiveWeekly,
    availableDays: limits.availableDays,
    capacity_instructions:
      "remainingWeekly indica el máximo TOTAL de minutos de todas las acciones nuevas en cada semana de siete días desde startDate, no el tiempo de cada acción. Suma los minutos antes de responder. remainingDaily fija el máximo TOTAL exacto de cada fecha. Respeta ambos límites y reduce el número o duración de las acciones cuando sea necesario.",
  };
  const originalMessages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: JSON.stringify(payload) },
  ];
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages =
      attempt === 0
        ? originalMessages
        : [
            ...originalMessages,
            {
              role: "user",
              content: JSON.stringify({
                correction: problem,
                instruction:
                  "La propuesta anterior fue rechazada. Genera una nueva propuesta JSON completa cumpliendo los datos originales y los límites. Corrige el problema señalado antes de responder y suma los minutos de todas las acciones por semana y por día. No repitas acciones ya completadas.",
                remainingWeekly: effectiveWeekly,
              }),
            },
          ];
    const content = await withinBudget(
      deadline,
      async (signal) => {
        const response = await fetchImpl(url.href, {
          method: "POST",
          signal,
          redirect: "error",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 6000,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "goal_plan",
                strict: true,
                schema: PLAN_SCHEMA,
              },
            },
            messages,
          }),
        });
        if (!response.ok) {
          if (response.status === 429)
            throw new PlanGenerationError(
              429,
              "La IA está ocupada. Inténtalo de nuevo en unos segundos.",
            );
          if (response.status === 504) throw timeoutError();
          throw new PlanGenerationError(
            502,
            "El proveedor de IA rechazó la solicitud. Revisa el modelo y su configuración.",
          );
        }
        let result;
        try {
          result = await response.json();
        } catch {
          if (signal.aborted) throw timeoutError();
          throw new PlanGenerationError(
            502,
            "El proveedor de IA devolvió una respuesta ilegible.",
          );
        }
        if (result?.choices?.[0]?.finish_reason !== "stop")
          throw new PlanGenerationError(
            502,
            "La IA no terminó la propuesta. Inténtalo con una meta más acotada.",
          );
        const text = result.choices[0].message?.content;
        if (typeof text !== "string" || text.length > 128000)
          throw new PlanGenerationError(
            502,
            "El proveedor de IA devolvió una respuesta inválida.",
          );
        return text;
      },
      signal,
    );
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      problem =
        "La propuesta no es un JSON válido. Devuelve únicamente el objeto JSON solicitado, sin texto ni bloques de código.";
      continue;
    }
    let proposal;
    try {
      const fitted = { ...limits, remainingWeekly: effectiveWeekly };
      proposal = validateProposal(fitSchedule(parsed, fitted), fitted);
    } catch (error) {
      problem =
        error instanceof Error
          ? error.message
          : "La propuesta no respeta las condiciones de planificación.";
      continue;
    }
    if (performance.now() >= deadline) throw timeoutError();
    return proposal;
  }
  throw new PlanGenerationError(
    502,
    `La IA no pudo ajustar una propuesta válida. ${problem}`,
  );
}
