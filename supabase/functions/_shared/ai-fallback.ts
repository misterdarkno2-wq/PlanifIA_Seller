// Conmutación IA local (Ollama en el PC, vía túnel) ↔ respaldo en la nube (NVIDIA NIM).
// La clave de NVIDIA sólo existe como secreto de Supabase (Deno.env); nunca llega al teléfono.
// Sin imports npm: también lo cargan las pruebas de Node en tests/.

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
/**
 * Modelos de build.nvidia.com probados el 2026-10-14 con chat en español y JSON Schema. NVIDIA retira
 * modelos (meta/llama-3.3-70b-instruct responde 410 desde el 2026-08-26): ante 404/410 se usa el
 * siguiente. Se cambian con NVIDIA_MODEL, que acepta una lista separada por comas.
 */
export const NVIDIA_DEFAULT_MODELS = ["openai/gpt-oss-20b", "z-ai/glm-5.3-flash"];
export const NVIDIA_DEFAULT_MODEL = NVIDIA_DEFAULT_MODELS[0];
const MODEL_NAME = /^[A-Za-z0-9_./:-]{1,200}$/;
const LOCAL_TIMEOUT_MS = 35000;
const CLOUD_CHAT_TIMEOUT_MS = 25000;

export type AiSource = "local" | "cloud";
export type PlanFormat = "json_schema" | "json_object" | "none";
export type CloudSettings = {
  apiKey: string;
  endpoint: string;
  /** Primer modelo de cada lista; los siguientes se usan si NVIDIA retiró el anterior. */
  model: string;
  chatModel: string;
  models: string[];
  chatModels: string[];
  planFormat: PlanFormat;
};
type ChatMessage = { role: string; content: string };
type EnvGetter = (key: string) => string | undefined;

const denoEnv: EnvGetter = (key) =>
  (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno?.env.get(key);

/** El gateway local no respondió (PC apagado, túnel caído, Ollama detenido): se usa la nube. */
export class LocalUnavailable extends Error {
  constructor(message = "IA local no disponible") {
    super(message);
    this.name = "LocalUnavailable";
  }
}
/** La IA local está viva pero ocupada (429): no se gasta la cuota de la nube. */
export class LocalBusy extends Error {
  constructor() {
    super("IA local ocupada");
    this.name = "LocalBusy";
  }
}
/** La nube tampoco respondió o no está configurada. */
export class CloudUnavailable extends Error {
  status?: number;
  constructor(message = "IA en la nube no disponible", status?: number) {
    super(message);
    this.name = "CloudUnavailable";
    this.status = status;
  }
}

/** Se alcanzó el límite de uso de la nube (por persona o de la app). */
export class CloudLimited extends Error {
  constructor() {
    super("Límite de la IA de respaldo");
    this.name = "CloudLimited";
  }
}

/** null = respaldo apagado (falta NVIDIA_API_KEY). */
export function cloudSettings(get: EnvGetter = denoEnv): CloudSettings | null {
  const apiKey = (get("NVIDIA_API_KEY") || "").trim();
  if (!apiKey) return null;
  const list = (value: string | undefined) => (value || "").split(",").map((m) => m.trim()).filter(Boolean);
  const models = list(get("NVIDIA_MODEL"));
  if (!models.length) models.push(...NVIDIA_DEFAULT_MODELS);
  const chatModels = list(get("NVIDIA_CHAT_MODEL"));
  if (!chatModels.length) chatModels.push(...models);
  if (models.length > 5 || chatModels.length > 5 || ![...models, ...chatModels].every((m) => MODEL_NAME.test(m)))
    throw new CloudUnavailable("NVIDIA_MODEL o NVIDIA_CHAT_MODEL tiene un nombre inválido (máximo 5 por lista).");
  const format = (get("NVIDIA_PLAN_FORMAT") || "json_schema").trim();
  if (!["json_schema", "json_object", "none"].includes(format))
    throw new CloudUnavailable("NVIDIA_PLAN_FORMAT debe ser json_schema, json_object o none.");
  return {
    apiKey,
    endpoint: `${NVIDIA_BASE_URL}/chat/completions`,
    model: models[0],
    chatModel: chatModels[0],
    models,
    chatModels,
    planFormat: format as PlanFormat,
  };
}

/** NVIDIA retiró el modelo (410) o no lo ofrece (404): se prueba el siguiente de la lista. */
export const isRetiredModel = (status: number | undefined) => status === 404 || status === 410;

/**
 * ¿Es una caída de la IA local? Sí: error de red, timeout, 5xx (502/503/504 del gateway,
 * 530 de Cloudflare con el túnel caído) y 401/403/404 (ruta o secreto del túnel mal configurados).
 * No: 429 (ocupada) ni errores de validación de la solicitud.
 */
export function isLocalOutage(failure: { status?: number; error?: unknown }) {
  if (failure.error !== undefined) return true;
  const status = failure.status ?? 0;
  return status >= 500 || [401, 403, 404, 408].includes(status);
}

// Algunos modelos dejan su razonamiento entre etiquetas aunque se pida una respuesta directa.
export const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();

/** Chat de Lumi en el modo rápido del gateway. Lanza LocalUnavailable o LocalBusy. */
export async function localChat({
  base,
  key,
  messages,
  temperature = 0.7,
  timeoutMs = LOCAL_TIMEOUT_MS,
  fetchImpl = fetch,
}: {
  base: string;
  key: string;
  messages: ChatMessage[];
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) {
  if (!base || !key) throw new LocalUnavailable("Sin IA local configurada");
  const endpoint = new URL("lumi/chat", base.endsWith("/") ? base : `${base}/`);
  // Nunca se envía el secreto del gateway sin cifrar.
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw new LocalUnavailable("Conexión de IA no segura");
  let response: Response;
  try {
    response = await fetchImpl(endpoint.href, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages, temperature }),
    });
  } catch (error) {
    throw new LocalUnavailable(error instanceof Error ? error.name : "network");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) throw new LocalBusy();
    if (isLocalOutage({ status: response.status })) throw new LocalUnavailable(`HTTP ${response.status}`);
    throw new Error(`La IA local rechazó la solicitud (HTTP ${response.status}).`);
  }
  let reply: unknown;
  try {
    reply = (await response.json())?.reply;
  } catch (error) {
    throw new LocalUnavailable(error instanceof Error ? error.name : "unreadable");
  }
  const text = typeof reply === "string" ? stripThinking(reply) : "";
  // Una respuesta vacía significa que el modelo local no funcionó: la nube lo intenta una vez.
  if (!text) throw new LocalUnavailable("Respuesta vacía");
  return text;
}

/** Respuesta de texto de NVIDIA (formato OpenAI). Lanza CloudUnavailable. */
export async function cloudChat({
  settings,
  messages,
  temperature = 0.7,
  // Holgura para modelos que razonan antes de responder (gpt-oss); Lumi igual responde en 1 a 4 frases.
  maxTokens = 700,
  timeoutMs = CLOUD_CHAT_TIMEOUT_MS,
  fetchImpl = fetch,
}: {
  settings: CloudSettings | null;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) {
  if (!settings) throw new CloudUnavailable("Falta NVIDIA_API_KEY");
  const deadline = Date.now() + timeoutMs;
  let lastError = new CloudUnavailable("Sin modelos configurados");
  for (const model of settings.chatModels) {
    try {
      return await cloudChatOnce({ settings, model, messages, temperature, maxTokens, timeoutMs: deadline - Date.now(), fetchImpl });
    } catch (error) {
      if (!(error instanceof CloudUnavailable) || !isRetiredModel(error.status) || deadline <= Date.now()) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

async function cloudChatOnce({
  settings,
  model,
  messages,
  temperature,
  maxTokens,
  timeoutMs,
  fetchImpl,
}: {
  settings: CloudSettings;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}) {
  let response: Response;
  try {
    response = await fetchImpl(settings.endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
  } catch (error) {
    throw new CloudUnavailable(error instanceof Error ? error.name : "network");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new CloudUnavailable(`HTTP ${response.status} (${model})`, response.status);
  }
  let content: unknown;
  try {
    content = (await response.json())?.choices?.[0]?.message?.content;
  } catch {
    throw new CloudUnavailable("Respuesta ilegible");
  }
  const text = typeof content === "string" ? stripThinking(content) : "";
  if (!text) throw new CloudUnavailable("Respuesta vacía");
  return text;
}

/**
 * Usa la IA local si el PC está en línea y, ante una caída a mitad de camino, reintenta UNA vez
 * en la nube. Con el PC apagado va directo a la nube, sin esperar timeouts.
 * `allowCloud` se consulta sólo al necesitar la nube (p. ej. para registrar el límite de uso).
 */
export async function withCloudFallback<T>({
  localOnline,
  local,
  cloud,
  allowCloud = async () => true,
}: {
  localOnline: boolean;
  local: () => Promise<T>;
  cloud: () => Promise<T>;
  allowCloud?: () => Promise<boolean>;
}): Promise<{ source: AiSource; value: T }> {
  if (localOnline) {
    try {
      return { source: "local", value: await local() };
    } catch (error) {
      if (!(error instanceof LocalUnavailable)) throw error;
    }
  }
  if (!(await allowCloud())) throw new CloudLimited();
  return { source: "cloud", value: await cloud() };
}

/** Ajustes del prompt para los modelos de NVIDIA, que se comportan distinto a los Qwen locales. */
export const CLOUD_CHAT_ADDENDUM = `
Formato de respuesta (obligatorio):
- Escribe sólo lo que Lumi diría, en texto plano y en español. Sin razonamiento, sin etiquetas, sin Markdown, sin listas ni emojis en exceso.
- No te presentes como un modelo de lenguaje ni menciones a NVIDIA, Meta u otros proveedores: eres Lumi.`;

export const CLOUD_PLAN_ADDENDUM = `
Formato de respuesta (obligatorio): devuelve únicamente el objeto JSON del esquema, sin texto antes ni después y sin bloques de código. Todas las cadenas en español. Usa exactamente los nombres de campos del esquema.`;
