// Respaldo de planes: con el PC apagado (o Ollama detenido) la cola no avanza. La app llama a esta
// función con la sesión de la persona; si la IA local sigue sin señal, toma UNA solicitud en cola
// de esa cuenta y la prepara con Groq. La clave sólo existe en Deno.env. Los créditos ya se
// cobraron al encolar y la base los devuelve si la solicitud termina en error o cancelada.
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { BodyTooLarge, readRequestText } from "../_shared/request-body.ts";
import { CLOUD_PLAN_ADDENDUM, CloudUnavailable, cloudSettings, isRetiredModel, type CloudSettings } from "../_shared/ai-fallback.ts";
import { generateValidatedPlan, PlanGenerationError, planJobResult } from "../_shared/generate-plan.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UNAVAILABLE = "La IA de respaldo no está disponible. Tu solicitud sigue guardada y se preparará cuando vuelva la IA local.";
export const LIMITED = "La IA de respaldo alcanzó su límite por hoy. Tu solicitud sigue guardada y se preparará cuando vuelva la IA local.";

type ClaimedJob = {
  status: "claimed";
  id: string;
  lease_token: string;
  timeout_ms: number;
  payload: Parameters<typeof planJobResult>[0];
};
/** Sólo se usa rpc(): un tipo mínimo evita los genéricos del cliente y facilita las pruebas. */
type SupabaseAdmin = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ error: { code?: string } | null }>;
};

const json = (data: unknown, status: number, headers: HeadersInit) => Response.json(data, { status, headers });

/** Genera, valida y guarda el resultado con el token de la concesión, igual que el trabajador local. */
export async function runCloudJob(admin: SupabaseAdmin, job: ClaimedJob, settings: CloudSettings) {
  let result = null,
    problem: string | null = null,
    retry = false;
  try {
    let proposal;
    for (const [index, model] of settings.models.entries()) {
      try {
        proposal = await generateValidatedPlan({
          endpoint: settings.endpoint,
          apiKey: settings.apiKey,
          model,
          requestData: job.payload.requestData,
          limits: job.payload.limits,
          budgetMs: job.timeout_ms,
          systemAddendum: CLOUD_PLAN_ADDENDUM,
          responseFormat: settings.planFormat,
        });
        break;
      } catch (error) {
        // Un modelo retirado (404/410) responde de inmediato: se prueba el siguiente de la lista.
        const retired = error instanceof PlanGenerationError && isRetiredModel(error.providerStatus);
        if (!retired || index === settings.models.length - 1) throw error;
        console.error("ai-fallback model retired", model);
      }
    }
    result = planJobResult(job.payload, proposal!);
  } catch (error) {
    problem =
      error instanceof PlanGenerationError
        ? error.message
        : "No pudimos conectar con la IA de respaldo. Se intentará de nuevo dentro del límite configurado.";
    retry = !(error instanceof PlanGenerationError) || error.retryable;
    console.error("ai-fallback generation", error instanceof Error ? error.name : "unknown");
  }
  const finished = await admin.rpc("finish_ai_job", {
    p_id: job.id,
    p_token: job.lease_token,
    p_result: result,
    p_error: problem,
    p_retry: retry,
  });
  if (finished.error) console.error("ai-fallback finish", finished.error.code);
}

export async function handleAiFallback(req: Request) {
  const origin = req.headers.get("origin") || "";
  const origins = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((x) => x.trim());
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  if (!origin || !origins.includes(origin)) {
    return json({ error: "Origen no autorizado. Configura ALLOWED_ORIGINS para esta web." }, 403, {});
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405, headers);

  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return json({ error: "Inicia sesión para usar la IA." }, 401, headers);
  const url = Deno.env.get("SUPABASE_URL")!,
    anon = Deno.env.get("SUPABASE_ANON_KEY")!,
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: authError } = await client.auth.getUser(token);
  if (authError || !user) return json({ error: "Tu sesión terminó. Vuelve a iniciar sesión." }, 401, headers);

  let input: { job_id?: unknown };
  try {
    const raw = await readRequestText(req, 2000);
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    return json({ error: error instanceof BodyTooLarge ? "Solicitud demasiado grande." : "Envía un JSON válido." }, 400, headers);
  }
  if (input?.job_id !== undefined && input.job_id !== null && !UUID.test(String(input.job_id))) {
    return json({ error: "Identificador de solicitud inválido." }, 422, headers);
  }

  let settings: CloudSettings | null;
  try {
    settings = cloudSettings();
  } catch (error) {
    console.error("ai-fallback config", error instanceof CloudUnavailable ? error.message : "unknown");
    settings = null;
  }
  if (!settings) return json({ status: "unavailable", error: UNAVAILABLE }, 503, headers);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const claimed = await admin.rpc("claim_ai_job_cloud", { p_user: user.id, p_job: input?.job_id ?? null });
  if (claimed.error) {
    console.error("ai-fallback claim", claimed.error.code);
    return json({ status: "unavailable", error: UNAVAILABLE }, 503, headers);
  }
  const job = claimed.data as { status: string } | null;
  // El PC volvió: la cola local se encarga y no se gasta la cuota de la nube.
  if (job?.status === "local_online") return json({ status: "local" }, 200, headers);
  if (job?.status === "limited") return json({ status: "limited", error: LIMITED }, 429, headers);
  if (job?.status !== "claimed") return json({ status: "none" }, 200, headers);

  const work = runCloudJob(admin as unknown as SupabaseAdmin, job as ClaimedJob, settings);
  // La generación sigue aunque la app se cierre; el resultado aparece en la cola como siempre.
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
  else await work;
  return json({ status: "processing", job_id: (job as ClaimedJob).id }, 202, headers);
}
