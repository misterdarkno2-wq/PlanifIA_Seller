import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createGatewayServer,
  gatewayConfig,
  preloadModel,
} from "../scripts/ollama-gateway.js";

const secret = "test-only-gateway-token-not-a-real-secret-000000000";
const model = "test-fixture:27b";
const schema = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
};
const request = (overrides = {}) => ({
  model,
  messages: [{ role: "user", content: "Una meta de prueba." }],
  max_tokens: 6000,
  response_format: {
    type: "json_schema",
    json_schema: { name: "goal_plan", strict: true, schema },
  },
  ...overrides,
});
const success = () =>
  Response.json({
    done: true,
    done_reason: "stop",
    message: { content: JSON.stringify({ title: "Propuesta de prueba" }) },
    prompt_eval_count: 40,
    eval_count: 12,
  });

async function fixture(t, fetchImpl, overrides = {}) {
  const server = createGatewayServer({
    secret,
    model,
    fetchImpl,
    ...overrides,
  });
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.equal(address.address, "127.0.0.1");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const url = `http://127.0.0.1:${address.port}`;
  return {
    server,
    url,
    call: (
      body = request(),
      headers = {},
      path = "/v1/chat/completions",
      method = "POST",
    ) =>
      fetch(url + path, {
        method,
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: method === "POST" ? JSON.stringify(body) : undefined,
      }),
  };
}

test("El adaptador exige secreto y no permite escuchar fuera de loopback", async (t) => {
  assert.throws(() => gatewayConfig({ OLLAMA_MODEL: model }), /GATEWAY_SECRET/);
  assert.throws(
    () =>
      gatewayConfig({
        GATEWAY_SECRET: secret,
        OLLAMA_MODEL: model,
        OLLAMA_NUM_CTX: 99999,
      }),
    /OLLAMA_NUM_CTX/,
  );
  let calls = 0;
  const f = await fixture(
    t,
    async () => {
      calls++;
      return success();
    },
    { timeoutMs: 1000 },
  );
  assert.throws(() => f.server.listen(8012, "0.0.0.0"), /siempre 127/);
  for (const authorization of ["", "Bearer wrong", `Bearer ${secret}wrong`]) {
    const r = await f.call(request(), { Authorization: authorization });
    assert.equal(r.status, 401);
    assert.equal((await r.text()).includes(secret), false);
  }
  assert.equal((await f.call(request(), {}, "/api/pull")).status, 404);
  assert.equal(
    (await f.call(request(), {}, "/v1/chat/completions", "GET")).status,
    405,
  );
  assert.equal(
    (await f.call(request(), {}, "/v1/chat/completions", "OPTIONS")).status,
    405,
  );
  assert.equal(calls, 0);
});

test("Rechaza JSON inválido y cuerpos grandes antes de ejecutar el modelo", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return success();
  });
  const headers = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
  const malformed = await fetch(f.url + "/v1/chat/completions", {
    method: "POST",
    headers,
    body: "{broken",
  });
  assert.equal(malformed.status, 400);
  const large = await fetch(f.url + "/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(
      request({ messages: [{ role: "user", content: "x".repeat(100000) }] }),
    ),
  });
  assert.equal(large.status, 413);
  // No Content-Length: verify that chunked transport has the same byte limit.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"padding":"'));
      controller.enqueue(encoder.encode("x".repeat(100000)));
      controller.enqueue(encoder.encode('"}'));
      controller.close();
    },
  });
  const chunked = await fetch(f.url + "/v1/chat/completions", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  });
  assert.equal(chunked.status, 413);
  assert.equal(calls, 0);
});

test("Sólo usa el modelo fijo, JSON Schema, texto y límites de contexto y salida", async (t) => {
  const calls = [];
  const f = await fixture(
    t,
    async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return success();
    },
    { maxTokens: 2048, numCtx: 4096 },
  );
  for (const body of [
    request({ model: "other:70b" }),
    request({ stream: true }),
    request({ max_tokens: 9000 }),
    request({ messages: [{ role: "tool", content: "x" }] }),
    request({
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "https://example.com" } },
          ],
        },
      ],
    }),
    request({ messages: [{ role: "user", content: "x", images: ["data"] }] }),
    request({ response_format: { type: "json_object" } }),
    request({ options: { num_ctx: 100000 } }),
    request({
      response_format: {
        type: "json_schema",
        json_schema: {
          schema: { type: "object", $ref: "https://example.com/schema" },
        },
      },
    }),
  ])
    assert.equal((await f.call(body)).status, 422);
  assert.equal(
    (
      await f.call(
        request({ messages: [{ role: "user", content: "x".repeat(24001) }] }),
      )
    ).status,
    413,
  );
  assert.equal(
    (await f.call(request(), { "Content-Type": "text/plain" })).status,
    415,
  );
  assert.equal(calls.length, 0);
  const r = await f.call();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  const result = await r.json();
  assert.equal(result.choices[0].finish_reason, "stop");
  assert.deepEqual(JSON.parse(result.choices[0].message.content), {
    title: "Propuesta de prueba",
  });
  assert.deepEqual(result.usage, {
    prompt_tokens: 40,
    completion_tokens: 12,
    total_tokens: 52,
  });
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(calls[0].body.format, schema);
  assert.equal(calls[0].body.model, model);
  assert.equal(calls[0].body.think, false);
  assert.equal(calls[0].body.stream, false);
  assert.deepEqual(calls[0].body.options, {
    temperature: 0.3,
    num_ctx: 4096,
    num_predict: 2048,
  });
});

test("Una sola generación mantiene la segunda solicitud fuera de Ollama", async (t) => {
  let release;
  let entered;
  let count = 0;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async () => {
    count++;
    entered();
    await pending;
    return success();
  });
  const first = f.call();
  await started;
  const second = await f.call();
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("retry-after"), "10");
  assert.equal(count, 1);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await f.call()).status, 200);
  assert.equal(count, 2);
});

test("Los fallos y respuestas incompletas no devuelven una propuesta falsa ni datos privados", async (t) => {
  const cases = [
    async () => {
      throw new Error("secret-provider-detail");
    },
    async () =>
      Response.json({ error: "secret-provider-detail" }, { status: 500 }),
    async () =>
      Response.json({
        done: true,
        done_reason: "length",
        message: { content: '{"title":' },
      }),
    async () =>
      Response.json({ done: false, message: { content: '{"title":"x"}' } }),
    async () => Response.json({ done: true, message: { content: "not JSON" } }),
    async () => Response.json({ done: true, message: { content: "" } }),
    async () => new Response("not JSON"),
    async () => new Response("x".repeat(256 * 1024 + 1)),
  ];
  for (const upstream of cases) {
    const f = await fixture(t, upstream);
    const r = await f.call();
    assert.equal(r.status, 502);
    const body = await r.text();
    assert.equal(body.includes("secret-provider-detail"), false);
    assert.equal(body.includes("choices"), false);
    assert.equal(body.includes(secret), false);
  }
});

test("El timeout aborta Ollama y libera la plaza para reintentar", async (t) => {
  let calls = 0;
  let aborted = false;
  const f = await fixture(
    t,
    async (_url, options) => {
      calls++;
      if (calls > 1) return success();
      return new Promise((_, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("Aborted"));
          },
          { once: true },
        );
      });
    },
    { timeoutMs: 1000 },
  );
  const first = await f.call();
  assert.equal(first.status, 504);
  assert.equal(aborted, true);
  assert.equal((await f.call()).status, 200);
});

test("La concurrencia se configura explícitamente y nunca sobrepasa sus plazas", async (t) => {
  assert.equal(
    gatewayConfig({ GATEWAY_SECRET: secret, OLLAMA_MODEL: model }).concurrency,
    1,
  );
  let release,
    entered = 0;
  const pending = new Promise((resolve) => (release = resolve));
  const f = await fixture(
    t,
    async () => {
      entered++;
      await pending;
      return success();
    },
    { concurrency: 2, timeoutMs: 1000 },
  );
  const first = f.call(),
    second = f.call();
  for (let i = 0; i < 100 && entered < 2; i++)
    await new Promise((r) => setTimeout(r, 5));
  const third = await f.call();
  assert.equal(third.status, 429);
  assert.equal(entered, 2);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
});

test("Un proveedor que ignora abort mantiene la plaza hasta terminar, sin duplicar GPU tras timeout", async (t) => {
  let release,
    calls = 0;
  const pending = new Promise((resolve) => (release = resolve));
  const f = await fixture(
    t,
    async () => {
      calls++;
      if (calls === 1) await pending;
      return success();
    },
    { timeoutMs: 1000 },
  );
  assert.equal((await f.call()).status, 504);
  assert.equal((await f.call()).status, 429);
  assert.equal(calls, 1);
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await f.call()).status, 200);
});

test("El modelo queda residente en VRAM y se precarga con el mismo contexto", async () => {
  const config = gatewayConfig({ GATEWAY_SECRET: secret, OLLAMA_MODEL: model });
  assert.equal(config.keepAlive, -1);
  assert.equal(
    gatewayConfig({ GATEWAY_SECRET: secret, OLLAMA_MODEL: model, OLLAMA_KEEP_ALIVE: "30m" }).keepAlive,
    "30m",
  );
  assert.throws(
    () => gatewayConfig({ GATEWAY_SECRET: secret, OLLAMA_MODEL: model, OLLAMA_KEEP_ALIVE: "siempre" }),
    /OLLAMA_KEEP_ALIVE/,
  );
  let sent;
  await preloadModel(config, async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return Response.json({ done: true });
  });
  assert.equal(sent.url, "http://127.0.0.1:11434/api/generate");
  assert.deepEqual(sent.body, {
    model,
    keep_alive: -1,
    options: { num_ctx: config.numCtx },
  });
});
