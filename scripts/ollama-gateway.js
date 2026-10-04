import { createServer } from "node:http";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const LOOPBACK = "127.0.0.1";
const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MAX_BODY = 96 * 1024;
const MAX_MESSAGE_CHARS = 24000;
const MAX_SCHEMA_CHARS = 16000;
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
  return {
    secret,
    model,
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
    numCtx: boundedInteger(
      env.OLLAMA_NUM_CTX,
      8192,
      2048,
      16384,
      "OLLAMA_NUM_CTX",
    ),
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
    keep_alive: "5m",
    options: {
      temperature,
      num_ctx: config.numCtx,
      num_predict: Math.min(requestedTokens, config.maxTokens),
    },
  };
}

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

/** The only upstream is local Ollama; fetch injection is solely for tests. */
export function createGatewayServer(options) {
  const config = gatewayConfig({
    GATEWAY_SECRET: options.secret,
    OLLAMA_MODEL: options.model,
    GATEWAY_PORT: options.port,
    GATEWAY_TIMEOUT_MS: options.timeoutMs,
    GATEWAY_MAX_TOKENS: options.maxTokens,
    OLLAMA_NUM_CTX: options.numCtx,
  });
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const expectedSecret = digest(config.secret);
  let busy = false;
  const server = createServer(async (req, res) => {
    if (req.url !== "/v1/chat/completions")
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
    let ownsSlot = false;
    let timeout;
    let abortOnClose;
    try {
      const body = ollamaRequest(await readBody(req), config);
      if (busy)
        return json(
          res,
          429,
          {
            error:
              "La IA local está ocupada. Inténtalo de nuevo en unos segundos.",
          },
          { "Retry-After": "10" },
        );
      busy = ownsSlot = true;
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
      const generation = (async () => {
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
      if (ownsSlot) busy = false;
    }
  });
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
  const server = createGatewayServer(config);
  server.on("error", () => {
    console.error(
      "No pudimos iniciar el adaptador. Comprueba que GATEWAY_PORT está libre.",
    );
    process.exitCode = 1;
  });
  server.listen(config.port, () =>
    console.log(
      `Adaptador Ollama: http://${LOOPBACK}:${config.port}/v1 (${config.model})`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
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
