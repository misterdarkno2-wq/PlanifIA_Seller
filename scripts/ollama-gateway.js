import { createServer } from "node:http";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { startConfiguredWorker } from "./ai-worker.js";

const LOOPBACK = "127.0.0.1";
const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const OLLAMA_PRELOAD_URL = "http://127.0.0.1:11434/api/generate";
const MAX_BODY = 96 * 1024;
const MAX_MESSAGE_CHARS = 24000;
const MAX_SCHEMA_CHARS = 16000;
const MAX_CHAT_CHARS = 8000;
const CHAT_PATH = "/v1/lumi/chat";
const MODEL_NAME = /^[A-Za-z0-9_./:-]+$/;
const KEEP_ALIVE = /^(-1|0|\d{1,5}[smh])$/;
// Ollama sólo acepta duraciones con unidad o números; -1 debe ir como número.
const keepAliveValue = (value) => (/^-?\d+$/.test(String(value)) ? Number(value) : value);
const digest = (value) => createHash("sha256").update(value).digest();

class GatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function boundedInteger(value, fallback, min, max, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`Configura ${name} entre ${min} y ${max}.`);
  return parsed;
}

export function gatewayConfig(env = process.env) {
  const secret = env.GATEWAY_SECRET || "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret))
    throw new Error(
      "Configura GATEWAY_SECRET con un secreto aleatorio base64url de al menos 32 caracteres.",
    );
  const model = env.OLLAMA_MODEL || "";
  if (!model || model.length > 200 || !/^[A-Za-z0-9_./:-]+$/.test(model))
    throw new Error(
      "Configura OLLAMA_MODEL con el nombre exacto de un modelo instalado.",
    );
  // "-1" mantiene el modelo en VRAM; recargarlo desde disco cuesta 10-15 s por solicitud.
  const keepAlive = env.OLLAMA_KEEP_ALIVE || "-1";
  if (!KEEP_ALIVE.test(keepAlive))
    throw new Error(
      "Configura OLLAMA_KEEP_ALIVE como -1 (siempre cargado), 0 o una duración como 30m.",
    );
  // Modo rápido del chat de Lumi: un modelo pequeño propio o, si no hay, el principal con
  // salida corta. Nunca pasa por la cola de planes.
  const chatModel = env.OLLAMA_CHAT_MODEL || model;
  if (chatModel.length > 200 || !MODEL_NAME.test(chatModel))
    throw new Error("Configura OLLAMA_CHAT_MODEL con el nombre exacto de un modelo instalado.");
  const chatKeepAlive = env.CHAT_KEEP_ALIVE || "30m";
  if (!KEEP_ALIVE.test(chatKeepAlive))
    throw new Error("Configura CHAT_KEEP_ALIVE como -1, 0 o una duración como 30m.");
  const numCtx = boundedInteger(env.OLLAMA_NUM_CTX, 8192, 2048, 16384, "OLLAMA_NUM_CTX");
  return {
    secret,
    model,
    keepAlive: keepAliveValue(keepAlive),
    chatModel,
    // Con el mismo modelo se usan su contexto y keep_alive: otro num_ctx obligaría a Ollama a
    // recargarlo (10-15 s) cada vez que se alternan el chat y los planes.
    chatNumCtx:
      chatModel === model
        ? numCtx
        : boundedInteger(env.CHAT_NUM_CTX, 2048, 1024, 8192, "CHAT_NUM_CTX"),
    chatKeepAlive: chatModel === model ? keepAliveValue(keepAlive) : keepAliveValue(chatKeepAlive),
    chatMaxTokens: boundedInteger(env.CHAT_MAX_TOKENS, 220, 32, 512, "CHAT_MAX_TOKENS"),
    chatTimeoutMs: boundedInteger(env.CHAT_TIMEOUT_MS, 30000, 1000, 60000, "CHAT_TIMEOUT_MS"),
    chatConcurrency: boundedInteger(env.CHAT_CONCURRENCY, 2, 1, 4, "CHAT_CONCURRENCY"),
    concurrency: boundedInteger(
      env.GATEWAY_CONCURRENCY,
      1,
      1,
      4,
      "GATEWAY_CONCURRENCY",
    ),
    port: boundedInteger(env.GATEWAY_PORT, 8012, 1024, 65535, "GATEWAY_PORT"),
    timeoutMs: boundedInteger(
      env.GATEWAY_TIMEOUT_MS,
      120000,
      1000,
      180000,
      "GATEWAY_TIMEOUT_MS",
    ),
    maxTokens: boundedInteger(
      env.GATEWAY_MAX_TOKENS,
      6000,
      256,
      6000,
      "GATEWAY_MAX_TOKENS",
    ),
    numCtx,
  };
}

function json(res, status, body, extra = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    const timer = setTimeout(
      () =>
        fail(new GatewayError(408, "La solicitud tardó demasiado en llegar.")),
      10000,
    );
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", data);
      req.off("end", end);
      req.off("error", error);
      req.off("aborted", aborted);
    };
    const fail = (failure) => {
      cleanup();
      req.resume();
      reject(failure);
    };
    const data = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY)
        return fail(
          new GatewayError(413, "La solicitud supera el tamaño permitido."),
        );
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new GatewayError(400, "Envía un objeto JSON válido."));
      }
    };
    const error = () =>
      fail(new GatewayError(400, "No pudimos leer la solicitud."));
    const aborted = () =>
      fail(new GatewayError(400, "La solicitud se interrumpió."));
    req.on("data", data);
    req.on("end", end);
    req.on("error", error);
    req.on("aborted", aborted);
  });
}

function validateSchema(schema) {
  if (
    !schema ||
    typeof schema !== "object" ||
    Array.isArray(schema) ||
    schema.type !== "object"
  )
    throw new GatewayError(
      422,
      "Envía un JSON Schema con raíz de tipo object.",
    );
  if (JSON.stringify(schema).length > MAX_SCHEMA_CHARS)
    throw new GatewayError(422, "El esquema supera el tamaño permitido.");
  let nodes = 0;
  const walk = (value, depth) => {
    if (++nodes > 2048 || depth > 16)
      throw new GatewayError(422, "El esquema es demasiado complejo.");
    if (value && typeof value === "object") {
      if (typeof value.$ref === "string" && !value.$ref.startsWith("#"))
        throw new GatewayError(
          422,
          "El esquema no admite referencias externas.",
        );
      for (const child of Object.values(value)) walk(child, depth + 1);
    }
  };
  walk(schema, 0);
  return schema;
}

function ollamaRequest(input, config) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new GatewayError(422, "Envía un objeto de solicitud.");
  const fields = new Set([
    "model",
    "messages",
    "response_format",
    "temperature",
    "max_tokens",
    "stream",
  ]);
  if (Object.keys(input).some((key) => !fields.has(key)))
    throw new GatewayError(422, "La solicitud contiene opciones no admitidas.");
  if (input.model !== config.model)
    throw new GatewayError(
      422,
      "El modelo solicitado no coincide con el modelo configurado.",
    );
  if (input.stream !== undefined && input.stream !== false)
    throw new GatewayError(
      422,
      "Este adaptador entrega únicamente respuestas completas.",
    );
  if (
    !Array.isArray(input.messages) ||
    !input.messages.length ||
    input.messages.length > 16
  )
    throw new GatewayError(
      422,
      "Envía entre uno y dieciséis mensajes de texto.",
    );
  let chars = 0;
  const messages = input.messages.map((message) => {
    if (
      !message ||
      typeof message !== "object" ||
      Object.keys(message).some((key) => !["role", "content"].includes(key)) ||
      !["system", "user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      !message.content.trim()
    )
      throw new GatewayError(
        422,
        "Los mensajes deben contener solamente role y content de texto.",
      );
    chars += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (chars > MAX_MESSAGE_CHARS)
    throw new GatewayError(413, "Los mensajes superan el tamaño permitido.");
  if (input.response_format?.type !== "json_schema")
    throw new GatewayError(
      422,
      "La propuesta necesita response_format de tipo json_schema.",
    );
  const format = validateSchema(input.response_format.json_schema?.schema);
  const temperature = input.temperature ?? 0.3;
  if (
    typeof temperature !== "number" ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 1
  )
    throw new GatewayError(422, "La temperatura debe estar entre cero y uno.");
  const requestedTokens = input.max_tokens ?? config.maxTokens;
  if (
    !Number.isInteger(requestedTokens) ||
    requestedTokens < 1 ||
    requestedTokens > 6000
  )
    throw new GatewayError(422, "max_tokens debe estar entre uno y 6.000.");
  return {
    model: config.model,
    messages,
    format,
    stream: false,
    think: false,
    keep_alive: config.keepAlive,
    options: {
      temperature,
      num_ctx: config.numCtx,
      num_predict: Math.min(requestedTokens, config.maxTokens),
    },
  };
}

/** Chat de Lumi: sólo texto, sin JSON Schema, con contexto y salida cortos. */
function chatRequest(input, config) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new GatewayError(422, "Envía un objeto de solicitud.");
  if (Object.keys(input).some((key) => !["messages", "temperature"].includes(key)))
    throw new GatewayError(422, "La solicitud contiene opciones no admitidas.");
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 16)
    throw new GatewayError(422, "Envía entre uno y dieciséis mensajes de texto.");
  let chars = 0;
  const messages = input.messages.map((message) => {
    if (
      !message ||
      typeof message !== "object" ||
      Object.keys(message).some((key) => !["role", "content"].includes(key)) ||
      !["system", "user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      !message.content.trim()
    )
      throw new GatewayError(422, "Los mensajes deben contener solamente role y content de texto.");
    chars += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (chars > MAX_CHAT_CHARS)
    throw new GatewayError(413, "Los mensajes superan el tamaño permitido.");
  const temperature = input.temperature ?? 0.7;
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 1)
    throw new GatewayError(422, "La temperatura debe estar entre cero y uno.");
  return {
    model: config.chatModel,
    messages,
    stream: false,
    think: false,
    keep_alive: config.chatKeepAlive,
    options: { temperature, num_ctx: config.chatNumCtx, num_predict: config.chatMaxTokens },
  };
}

// Algunos modelos dejan su razonamiento entre etiquetas aunque se pida think:false.
const chatReply = (content) => content.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();

async function readOllama(response, signal) {
  if (!response.ok)
    throw new GatewayError(
      502,
      "Ollama rechazó la generación. Comprueba el modelo local.",
    );
  if (!response.body)
    throw new GatewayError(502, "Ollama devolvió una respuesta vacía.");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 256 * 1024) {
        await reader.cancel();
        throw new GatewayError(
          502,
          "La respuesta de Ollama supera el tamaño permitido.",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GatewayError(502, "Ollama devolvió una respuesta ilegible.");
  }
}

/** Loads the model with the same num_ctx as real requests so the first plan does not wait for disk. */
export async function preloadModel(config, fetchImpl = globalThis.fetch, { chat = false } = {}) {
  const response = await fetchImpl(OLLAMA_PRELOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chat ? config.chatModel : config.model,
      keep_alive: chat ? config.chatKeepAlive : config.keepAlive,
      options: { num_ctx: chat ? config.chatNumCtx : config.numCtx },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error("Ollama no pudo cargar el modelo.");
  await response.arrayBuffer();
}

/** The only upstream is local Ollama; fetch injection is solely for tests. */
export function createGatewayServer(options) {
  const config = gatewayConfig({
    GATEWAY_SECRET: options.secret,
    OLLAMA_MODEL: options.model,
    GATEWAY_PORT: options.port,
    GATEWAY_TIMEOUT_MS: options.timeoutMs,
    GATEWAY_MAX_TOKENS: options.maxTokens,
    OLLAMA_NUM_CTX: options.numCtx,
    OLLAMA_KEEP_ALIVE: options.keepAlive,
    GATEWAY_CONCURRENCY: options.concurrency,
    OLLAMA_CHAT_MODEL: options.chatModel,
    CHAT_NUM_CTX: options.chatModel && options.chatModel !== options.model ? options.chatNumCtx : undefined,
    CHAT_MAX_TOKENS: options.chatMaxTokens,
    CHAT_TIMEOUT_MS: options.chatTimeoutMs,
    CHAT_KEEP_ALIVE:
      options.chatModel && options.chatModel !== options.model ? options.chatKeepAlive : undefined,
    CHAT_CONCURRENCY: options.chatConcurrency,
  });
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const expectedSecret = digest(config.secret);
  let activeSlots = 0;
  let chatSlots = 0;
  const server = createServer(async (req, res) => {
    if (req.url !== "/v1/chat/completions" && req.url !== CHAT_PATH)
      return json(res, 404, { error: "Ruta no disponible." });
    if (req.method !== "POST")
      return json(
        res,
        405,
        { error: "Método no permitido." },
        { Allow: "POST" },
      );
    const token =
      req.headers.authorization?.match(
        /^Bearer ([A-Za-z0-9_-]{32,256})$/i,
      )?.[1] || "";
    if (!timingSafeEqual(expectedSecret, digest(token)))
      return json(
        res,
        401,
        { error: "Autenticación requerida." },
        { "WWW-Authenticate": "Bearer" },
      );
    if (
      !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")
    )
      return json(res, 415, { error: "Usa Content-Type application/json." });
    if (Number(req.headers["content-length"]) > MAX_BODY)
      return json(
        res,
        413,
        { error: "La solicitud supera el tamaño permitido." },
        { Connection: "close" },
      );
    if (req.url === CHAT_PATH) return handleChat(req, res);
    let ownsSlot = false;
    let timeout;
    let abortOnClose;
    let generation;
    try {
      const body = ollamaRequest(await readBody(req), config);
      if (activeSlots >= config.concurrency)
        return json(
          res,
          429,
          {
            error:
              "La IA local está ocupada. Inténtalo de nuevo en unos segundos.",
          },
          { "Retry-After": "10" },
        );
      activeSlots++;
      ownsSlot = true;
      const controller = new AbortController();
      abortOnClose = () => {
        if (!res.writableEnded) controller.abort(new Error("Disconnected"));
      };
      res.on("close", abortOnClose);
      const expired = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new GatewayError(
              504,
              "La IA local tardó demasiado. Puedes volver a intentarlo.",
            ),
          );
          controller.abort(new Error("Timeout"));
        }, config.timeoutMs);
      });
      generation = (async () => {
        const upstream = await fetchImpl(OLLAMA_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: "error",
        });
        const result = await readOllama(upstream, controller.signal);
        if (
          result.done !== true ||
          (result.done_reason && result.done_reason !== "stop")
        )
          throw new GatewayError(
            502,
            "La IA local no terminó la propuesta. Reduce el alcance o vuelve a intentarlo.",
          );
        const content = result.message?.content;
        if (typeof content !== "string" || !content.trim())
          throw new GatewayError(
            502,
            "La IA local devolvió una propuesta vacía.",
          );
        try {
          JSON.parse(content);
        } catch {
          throw new GatewayError(
            502,
            "La IA local no devolvió una propuesta JSON completa.",
          );
        }
        const completion = {
          id: `chatcmpl-${randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: config.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
        };
        if (
          Number.isInteger(result.prompt_eval_count) &&
          result.prompt_eval_count >= 0 &&
          Number.isInteger(result.eval_count) &&
          result.eval_count >= 0
        )
          completion.usage = {
            prompt_tokens: result.prompt_eval_count,
            completion_tokens: result.eval_count,
            total_tokens: result.prompt_eval_count + result.eval_count,
          };
        return completion;
      })();
      const result = await Promise.race([generation, expired]);
      json(res, 200, result);
    } catch (error) {
      const controlled = error instanceof GatewayError;
      json(
        res,
        controlled ? error.status : 502,
        {
          error: controlled
            ? error.message
            : "No pudimos comunicarnos con Ollama. Comprueba que está abierto.",
        },
        error?.status === 413 || error?.status === 408
          ? { Connection: "close" }
          : {},
      );
    } finally {
      clearTimeout(timeout);
      if (abortOnClose) res.off("close", abortOnClose);
      // Keep the slot until upstream really settles, even after timeout/disconnect.
      if (ownsSlot) {
        await generation?.catch(() => {});
        activeSlots--;
      }
    }
  });
  // Chat de Lumi: plazas propias para no esperar a los planes ni bloquearlos.
  async function handleChat(req, res) {
    let ownsSlot = false;
    let timeout;
    let abortOnClose;
    let generation;
    try {
      const body = chatRequest(await readBody(req), config);
      // Con un solo modelo, Ollama atiende de a una generación: mientras se prepara un plan el
      // chat respondería en minutos. Mejor avisar de inmediato (el servidor devuelve los créditos).
      if (config.chatModel === config.model && activeSlots >= config.concurrency)
        return json(
          res,
          429,
          { error: "Lumi está terminando un plan. Inténtalo en un minuto." },
          { "Retry-After": "30" },
        );
      if (chatSlots >= config.chatConcurrency)
        return json(
          res,
          429,
          { error: "Lumi está atendiendo otras conversaciones. Inténtalo en unos segundos." },
          { "Retry-After": "5" },
        );
      chatSlots++;
      ownsSlot = true;
      const controller = new AbortController();
      abortOnClose = () => {
        if (!res.writableEnded) controller.abort(new Error("Disconnected"));
      };
      res.on("close", abortOnClose);
      const expired = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new GatewayError(504, "Lumi tardó demasiado en responder."));
          controller.abort(new Error("Timeout"));
        }, config.chatTimeoutMs);
      });
      generation = (async () => {
        const upstream = await fetchImpl(OLLAMA_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: "error",
        });
        const result = await readOllama(upstream, controller.signal);
        // Una respuesta cortada por el límite de salida sigue siendo útil en un chat.
        if (result.done !== true || !["stop", "length", undefined].includes(result.done_reason))
          throw new GatewayError(502, "Lumi no terminó su respuesta.");
        const reply =
          typeof result.message?.content === "string" ? chatReply(result.message.content) : "";
        if (!reply) throw new GatewayError(502, "Lumi devolvió una respuesta vacía.");
        const completion = { reply, model: config.chatModel };
        if (Number.isInteger(result.prompt_eval_count) && Number.isInteger(result.eval_count))
          completion.usage = {
            prompt_tokens: result.prompt_eval_count,
            completion_tokens: result.eval_count,
          };
        return completion;
      })();
      json(res, 200, await Promise.race([generation, expired]));
    } catch (error) {
      const controlled = error instanceof GatewayError;
      json(
        res,
        controlled ? error.status : 502,
        {
          error: controlled
            ? error.message
            : "No pudimos comunicarnos con Ollama. Comprueba que está abierto.",
        },
        error?.status === 413 || error?.status === 408 ? { Connection: "close" } : {},
      );
    } finally {
      clearTimeout(timeout);
      if (abortOnClose) res.off("close", abortOnClose);
      // Igual que en los planes: la plaza se libera cuando Ollama termina de verdad.
      if (ownsSlot) {
        await generation?.catch(() => {});
        chatSlots--;
      }
    }
  }
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 32;
  // Restrict all callers of listen(), including the CLI, to loopback.
  const listen = server.listen.bind(server);
  server.listen = function (port = config.port, callback) {
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("El adaptador necesita un puerto local válido.");
    if (callback !== undefined && typeof callback !== "function")
      throw new Error("La dirección del adaptador es siempre 127.0.0.1.");
    return listen(port, LOOPBACK, callback);
  };
  return server;
}

export async function startGateway() {
  const envFile = fileURLToPath(
    new URL("../.env.gateway.local", import.meta.url),
  );
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error("No pudimos cargar .env.gateway.local.");
  }
  const config = gatewayConfig();
  if (!process.env.QUEUE_SUPABASE_URL || !process.env.QUEUE_SERVICE_ROLE_KEY)
    throw new Error(
      "Faltan QUEUE_SUPABASE_URL y QUEUE_SERVICE_ROLE_KEY en .env.gateway.local.",
    );
  const server = createGatewayServer(config);
  let worker;
  server.on("error", () => {
    console.error(
      "No pudimos iniciar el adaptador. Comprueba que GATEWAY_PORT está libre.",
    );
    process.exitCode = 1;
  });
  server.listen(config.port, () => {
    console.log(
      `Adaptador Ollama: http://${LOOPBACK}:${config.port}/v1 (${config.model})`,
    );
    if (config.keepAlive !== 0)
      preloadModel(config).then(
        () => console.log(`Modelo cargado en la GPU (keep_alive ${config.keepAlive}).`),
        () => console.error("No pudimos precargar el modelo; se cargará con la primera solicitud."),
      );
    if (config.chatModel !== config.model && config.chatKeepAlive !== 0)
      preloadModel(config, undefined, { chat: true }).then(
        () => console.log(`Chat de Lumi: ${config.chatModel} cargado (keep_alive ${config.chatKeepAlive}).`),
        () => console.error("No pudimos precargar el modelo del chat; se cargará con el primer mensaje."),
      );
    try {
      worker = startConfiguredWorker(config);
      console.log(
        `Cola persistente de Supabase conectada. Concurrencia GPU: ${config.concurrency}.`,
      );
    } catch (error) {
      console.error(error.message);
      server.close();
      process.exitCode = 1;
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      worker?.stop();
      server.close();
      server.closeIdleConnections();
    });
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  startGateway().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
