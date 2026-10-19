// Conmutación IA local ↔ respaldo en la nube (Groq), simulando caídas de red, del túnel y de Ollama.
// Ninguna prueba usa la red ni claves reales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  cloudChat,
  CloudLimited,
  cloudSettings,
  CloudUnavailable,
  isLocalOutage,
  LocalBusy,
  localChat,
  LocalUnavailable,
  GROQ_DEFAULT_MODEL,
  withCloudFallback,
} from "../supabase/functions/_shared/ai-fallback.ts";
import { parseJsonContent } from "../supabase/functions/_shared/generate-plan.ts";
import { createGatewayServer, createOllamaHealth } from "../scripts/ollama-gateway.js";
import { startAiWorker } from "../scripts/ai-worker.js";
import { aiSourceLabel, createCloudFallback } from "../src/ai-source.js";
import { jobDescription } from "../src/ai-jobs.js";

const BASE = "https://ia.example.test/v1";
const KEY = "test-only-gateway-key";
const settings = cloudSettings((k) => ({ GROQ_API_KEY: "gsk_test-only" })[k]);
const messages = [{ role: "user", content: "Hola" }];
const pause = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** Gateway simulado: cada llamada consume el siguiente comportamiento de la lista. */
function localFetch(...behaviours) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    const next = behaviours.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "number") return new Response("<html>error</html>", { status: next });
    return Response.json({ reply: next });
  };
  return { impl, calls };
}

test("Clasifica como caída de la IA local: red, timeout, 5xx y 530 de Cloudflare; no 429 ni validación", () => {
  for (const status of [500, 502, 503, 504, 530, 401, 403, 404, 408]) assert.equal(isLocalOutage({ status }), true, String(status));
  for (const status of [400, 413, 415, 422, 429]) assert.equal(isLocalOutage({ status }), false, String(status));
  assert.equal(isLocalOutage({ error: new TypeError("fetch failed") }), true);
});

test("La IA local responde: no se usa la nube", async () => {
  const local = localFetch("¡Hola desde el PC!");
  let cloudCalls = 0;
  const result = await withCloudFallback({
    localOnline: true,
    local: () => localChat({ base: BASE, key: KEY, messages, fetchImpl: local.impl }),
    cloud: async () => (cloudCalls++, "nube"),
  });
  assert.deepEqual(result, { source: "local", value: "¡Hola desde el PC!" });
  assert.equal(cloudCalls, 0);
  assert.equal(local.calls[0].url, "https://ia.example.test/v1/lumi/chat");
  assert.equal(new Headers(local.calls[0].options.headers).get("authorization"), `Bearer ${KEY}`);
});

test("Una caída a mitad de camino se reintenta UNA sola vez en la nube, de forma transparente", async () => {
  const failures = [
    new TypeError("fetch failed"), // PC apagado o sin red
    Object.assign(new Error("aborted"), { name: "TimeoutError" }), // Ollama colgado
    502, // Ollama detenido detrás del gateway
    503,
    530, // Túnel de Cloudflare caído
    "   ", // Respuesta vacía del modelo local
  ];
  for (const failure of failures) {
    const local = localFetch(failure);
    let cloudCalls = 0;
    const result = await withCloudFallback({
      localOnline: true,
      local: () => localChat({ base: BASE, key: KEY, messages, fetchImpl: local.impl }),
      cloud: async () => (cloudCalls++, "respuesta de respaldo"),
    });
    assert.deepEqual(result, { source: "cloud", value: "respuesta de respaldo" }, String(failure));
    assert.equal(local.calls.length, 1, "No reintenta la IA local");
    assert.equal(cloudCalls, 1, "Un solo intento en la nube");
  }
});

test("Con el PC sin señal va directo a la nube sin esperar el timeout del túnel", async () => {
  let localCalls = 0;
  const result = await withCloudFallback({
    localOnline: false,
    local: async () => (localCalls++, "local"),
    cloud: async () => "nube",
  });
  assert.equal(result.source, "cloud");
  assert.equal(localCalls, 0);
});

test("IA local ocupada (429): avisa sin gastar la cuota de la nube", async () => {
  const local = localFetch(429);
  let cloudCalls = 0;
  await assert.rejects(
    withCloudFallback({
      localOnline: true,
      local: () => localChat({ base: BASE, key: KEY, messages, fetchImpl: local.impl }),
      cloud: async () => (cloudCalls++, "nube"),
    }),
    LocalBusy,
  );
  assert.equal(cloudCalls, 0);
});

test("El límite de la nube se consulta sólo al necesitarla y la bloquea al alcanzarse", async () => {
  let checks = 0;
  await withCloudFallback({ localOnline: true, local: async () => "local", cloud: async () => "nube", allowCloud: async () => (checks++, true) });
  assert.equal(checks, 0, "Con la IA local no se registra uso de la nube");
  let cloudCalls = 0;
  await assert.rejects(
    withCloudFallback({ localOnline: false, local: async () => "local", cloud: async () => (cloudCalls++, "nube"), allowCloud: async () => false }),
    CloudLimited,
  );
  assert.equal(cloudCalls, 0);
});

test("Si la nube también falla, el error llega a quien llama (que devuelve los créditos)", async () => {
  const local = localFetch(new TypeError("fetch failed"));
  await assert.rejects(
    withCloudFallback({
      localOnline: true,
      local: () => localChat({ base: BASE, key: KEY, messages, fetchImpl: local.impl }),
      cloud: () => cloudChat({ settings, messages, fetchImpl: async () => new Response("overloaded", { status: 503 }) }),
    }),
    CloudUnavailable,
  );
});

test("El secreto del gateway nunca viaja por HTTP sin cifrar", async () => {
  const local = localFetch("hola");
  await assert.rejects(localChat({ base: "http://ia.example.test/v1", key: KEY, messages, fetchImpl: local.impl }), LocalUnavailable);
  assert.equal(local.calls.length, 0);
});

test("Groq: clave sólo del entorno del servidor, modelo configurable y respuesta normalizada", async () => {
  assert.equal(cloudSettings(() => undefined), null, "Sin clave no hay respaldo");
  assert.equal(settings.model, GROQ_DEFAULT_MODEL);
  assert.equal(settings.endpoint, "https://api.groq.com/openai/v1/chat/completions");
  const custom = cloudSettings((k) => ({ GROQ_API_KEY: "k", GROQ_MODEL: "groq/plan", GROQ_CHAT_MODEL: "groq/chat" })[k]);
  assert.equal(custom.model, "groq/plan");
  assert.equal(custom.chatModel, "groq/chat");
  assert.throws(() => cloudSettings((k) => ({ GROQ_API_KEY: "k", GROQ_MODEL: "bad model; rm" })[k]), CloudUnavailable);
  let sent;
  const reply = await cloudChat({
    settings,
    messages,
    fetchImpl: async (url, options) => {
      sent = { url, options, body: JSON.parse(options.body) };
      return Response.json({ choices: [{ message: { content: "<think>razono</think> ¡Hola desde la nube!" } }] });
    },
  });
  assert.equal(reply, "¡Hola desde la nube!", "Mismo formato que la IA local: sólo el texto");
  assert.equal(sent.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(new Headers(sent.options.headers).get("authorization"), "Bearer gsk_test-only");
  assert.equal(sent.body.model, GROQ_DEFAULT_MODEL);
  assert.equal(sent.body.stream, false);
  await assert.rejects(cloudChat({ settings: null, messages }), CloudUnavailable);
  await assert.rejects(cloudChat({ settings, messages, fetchImpl: async () => { throw new TypeError("fetch failed"); } }), CloudUnavailable);
});

test("Las propuestas JSON envueltas en un bloque de código se aceptan; el texto libre no", () => {
  assert.deepEqual(parseJsonContent('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonContent('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJsonContent("Aquí tienes tu plan: {"));
});

// --- Gateway: /health comprueba de verdad que Ollama responde ---------------------------------

const secret = "test-only-gateway-token-not-a-real-secret-000000000";
async function gateway(t, fetchImpl) {
  const server = createGatewayServer({ secret, model: "plan:9b", chatModel: "chat:4b", fetchImpl });
  server.listen(0);
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const tags = (...names) => Response.json({ models: names.map((name) => ({ name })) });

test("/health responde 200 sólo si Ollama contesta y tiene los dos modelos, sin pedir el secreto", async (t) => {
  const url = await gateway(t, async (target) => {
    assert.equal(target, "http://127.0.0.1:11434/api/tags");
    return tags("plan:9b", "chat:4b", "otro:latest");
  });
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", ollama: true });
  assert.equal((await fetch(`${url}/health`, { method: "POST" })).status, 405);
});

test("/health responde 503 con Ollama detenido, colgado o sin el modelo configurado", async (t) => {
  for (const ollama of [
    async () => { throw new TypeError("connect ECONNREFUSED"); },
    async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    async () => tags("plan:9b"),
    async () => new Response("error", { status: 500 }),
  ]) {
    const health = createOllamaHealth({ model: "plan:9b", chatModel: "chat:4b" }, ollama, { timeoutMs: 50 });
    assert.equal(await health.check(), false);
  }
  const url = await gateway(t, async () => { throw new TypeError("connect ECONNREFUSED"); });
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable", ollama: false });
});

test("/health guarda el resultado unos segundos y detecta cuando Ollama vuelve", async () => {
  let clock = 0, calls = 0, up = false;
  const health = createOllamaHealth(
    { model: "plan:9b", chatModel: "plan:9b" },
    async () => (calls++, up ? tags("plan:9b") : new Response("", { status: 500 })),
    { ttlMs: 5000, now: () => clock },
  );
  assert.equal(await health.check(), false);
  up = true;
  clock = 4000;
  assert.equal(await health.check(), false, "Dentro del TTL no vuelve a consultar");
  assert.equal(calls, 1);
  clock = 5001;
  assert.equal(await health.check(), true, "Pasado el TTL detecta que Ollama volvió");
  assert.equal(calls, 2);
});

// --- Trabajador: sin Ollama no toma solicitudes ni renueva la señal de "PC encendido" ----------

test("Sin Ollama el trabajador no reclama trabajos; cuando vuelve, retoma la cola solo", async () => {
  let healthy = false, claims = 0;
  const errors = [], statuses = [];
  const worker = startAiWorker({
    pollMs: 5,
    ready: async () => healthy,
    onError: (m) => errors.push(m),
    onStatus: (m) => statuses.push(m),
    rpc: async (name) => {
      if (name === "claim_ai_job") claims++;
      return { data: null };
    },
    generate: async () => null,
  });
  try {
    await pause(40);
    assert.equal(claims, 0, "claim_ai_job renueva last_worker_at: no se llama sin Ollama");
    assert.equal(errors.length, 1, "Avisa una sola vez");
    healthy = true;
    await pause(40);
    assert.ok(claims > 0, "Vuelve a la IA local sin intervención");
    assert.equal(statuses.length, 1);
  } finally {
    worker.stop();
  }
});

// --- Cliente: pide el respaldo para propuestas en cola con el PC apagado -----------------------

test("El cliente pide el respaldo una vez por minuto por solicitud y sólo con el PC desconectado", async () => {
  let clock = 0;
  const requested = [];
  const started = [];
  const fallback = createCloudFallback({
    now: () => clock,
    request: async (id) => (requested.push(id), id === "a" ? { status: "processing" } : Promise.reject(new Error("límite"))),
    onStarted: (id) => started.push(id),
  });
  const offline = [
    { id: "a", status: "queued", worker_online: false },
    { id: "b", status: "queued", worker_online: false },
    { id: "c", status: "queued", worker_online: true },
    { id: "d", status: "processing", worker_online: false },
    { id: "e", status: "queued", worker_online: false, cancel_requested: true },
  ];
  fallback.consider(offline);
  fallback.consider(offline);
  await pause();
  assert.deepEqual(requested, ["a", "b"], "Una vez por solicitud, aunque se sondee cada 3 s");
  assert.deepEqual(started, ["a"]);
  clock = 59000;
  fallback.consider(offline);
  await pause();
  assert.equal(requested.length, 2, "Antes de un minuto no repite");
  clock = 60000;
  fallback.consider(offline);
  await pause();
  assert.deepEqual(requested, ["a", "b", "a", "b"], "Mientras el PC siga apagado, reintenta cada minuto");
  fallback.consider([{ id: "a", status: "queued", worker_online: true }]);
  clock = 120000;
  fallback.consider([{ id: "a", status: "queued", worker_online: true }]);
  await pause();
  assert.equal(requested.length, 4, "Con el PC de vuelta no llama a la nube");
});

test("La app muestra un indicador discreto del origen de la IA", () => {
  assert.equal(aiSourceLabel("local"), "IA local");
  assert.equal(aiSourceLabel("cloud"), "IA en la nube (respaldo)");
  assert.equal(aiSourceLabel(undefined), "");
  assert.match(jobDescription({ status: "queued", worker_online: false, plan_id: "free" }), /IA en la nube \(respaldo\)/);
  assert.match(jobDescription({ status: "processing", provider: "cloud" }), /IA en la nube \(respaldo\) está preparando/);
  assert.match(jobDescription({ status: "processing", provider: "local" }), /IA local está preparando/);
  assert.match(jobDescription({ status: "completed", provider: "cloud" }), /Preparada con IA en la nube/);
  assert.doesNotMatch(jobDescription({ status: "completed", provider: "local" }), /nube/);
});

test("Si Groq retiró un modelo (404/410) el chat usa el siguiente de la lista; otros errores no", async () => {
  const chain = cloudSettings((k) => ({ GROQ_API_KEY: "k", GROQ_MODEL: "viejo/retirado, nuevo/activo" })[k]);
  assert.deepEqual(chain.models, ["viejo/retirado", "nuevo/activo"]);
  assert.deepEqual(chain.chatModels, chain.models, "El chat usa la misma lista si no se configura otra");
  for (const retired of [404, 410]) {
    const asked = [];
    const reply = await cloudChat({
      settings: chain,
      messages,
      fetchImpl: async (_url, options) => {
        const { model } = JSON.parse(options.body);
        asked.push(model);
        return model === "viejo/retirado"
          ? Response.json({ title: "Gone" }, { status: retired })
          : Response.json({ choices: [{ message: { content: "Hola" } }] });
      },
    });
    assert.equal(reply, "Hola");
    assert.deepEqual(asked, ["viejo/retirado", "nuevo/activo"]);
  }
  const asked = [];
  await assert.rejects(
    cloudChat({ settings: chain, messages, fetchImpl: async (_u, o) => (asked.push(JSON.parse(o.body).model), new Response("", { status: 401 })) }),
    CloudUnavailable,
  );
  assert.deepEqual(asked, ["viejo/retirado"], "Una clave inválida no se arregla cambiando de modelo");
  assert.deepEqual(cloudSettings((k) => ({ GROQ_API_KEY: "k" })[k]).models, ["openai/gpt-oss-20b"]);
});
