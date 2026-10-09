// Contratos del chat de Lumi: Auth, base de datos y gateway son respuestas sintéticas, sin claves reales.
import { cleanReply, handleLumiChat, lumiMessages, RESTING, BUSY } from "./handler.ts";

function assert(condition: unknown, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}
const REQUEST = "44444444-4444-4444-8444-444444444444";

function setup({ ai = "ok", begin = "ok" }: { ai?: string; begin?: string } = {}) {
  const savedFetch = globalThis.fetch;
  const rpcs: { name: string; body: Record<string, unknown> }[] = [];
  let aiBody: Record<string, unknown> | null = null;
  let aiAuth = "";
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "AI_BASE_URL", "AI_API_KEY", "ALLOWED_ORIGINS"];
  const saved = new Map(keys.map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries({
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_ANON_KEY: "test-only-public-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-private-key",
    AI_BASE_URL: "https://ai.example.test/v1",
    AI_API_KEY: "test-only-gateway-key",
    ALLOWED_ORIGINS: "https://web.example.test,https://tauri.localhost",
  }))
    Deno.env.set(key, value);
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      if (new Headers(options?.headers).get("authorization") !== "Bearer test-valid-session")
        return Response.json({ msg: "Session expired" }, { status: 401 });
      return Response.json({ id: "11111111-1111-4111-8111-111111111111", aud: "authenticated" });
    }
    const rpc = url.match(/\/rpc\/(\w+)/)?.[1];
    if (rpc) {
      rpcs.push({ name: rpc, body: JSON.parse(String(options?.body)) });
      if (rpc === "lumi_chat_begin") {
        if (begin === "no_credits")
          return Response.json(
            { code: "P0001", message: "No tienes créditos suficientes. Cada mensaje a Lumi cuesta 5 créditos; consigue más en Mi plan." },
            { status: 400 },
          );
        return Response.json({
          cost: 5,
          profile: { name: "Ana", pet: { name: "Lumi", stage: 2 } },
          goals: [{ title: "Correr 5 km", next_action: "Trotar 10 minutos" }],
          history: [
            { role: "user", content: "Hola" },
            { role: "lumi", content: "¡Hola, Ana!" },
          ],
        });
      }
      if (rpc === "lumi_chat_finish") return Response.json({ credits: 55 });
      if (rpc === "lumi_chat_refund") return Response.json(true);
    }
    if (url === "https://ai.example.test/v1/lumi/chat") {
      aiBody = JSON.parse(String(options?.body));
      aiAuth = new Headers(options?.headers).get("authorization") || "";
      if (ai === "down") throw new TypeError("connection refused");
      if (ai === "busy") return Response.json({ error: "Lumi está terminando un plan." }, { status: 429 });
      if (ai === "empty") return Response.json({ reply: "   " });
      return Response.json({ reply: "¡Vamos, Ana! Trota 10 minutos hoy.\u0007", model: "fixture" });
    }
    throw new Error("Unexpected fixture URL " + url);
  };
  return {
    rpcs: () => rpcs,
    aiBody: () => aiBody,
    aiAuth: () => aiAuth,
    close: () => {
      globalThis.fetch = savedFetch;
      for (const [key, value] of saved) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    },
  };
}
const request = (body: unknown = { request_id: REQUEST, text: "  ¿Qué hago hoy?  " }, token: string | null = "test-valid-session", origin = "https://tauri.localhost") =>
  new Request("https://function.example.test", {
    method: "POST",
    headers: { Origin: origin, ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

Deno.test("Cobra, pide al modo rápido del gateway, guarda los dos mensajes y responde reply y credits", async () => {
  const f = setup();
  try {
    const response = await handleLumiChat(request());
    assert(response.status === 200, `status ${response.status}`);
    const body = await response.json();
    assert(body.reply === "¡Vamos, Ana! Trota 10 minutos hoy.", body.reply);
    assert(body.credits === 55);
    const names = f.rpcs().map((r) => r.name);
    assert(JSON.stringify(names) === JSON.stringify(["lumi_chat_begin", "lumi_chat_finish"]), names.join());
    assert(f.rpcs()[0].body.p_text === "¿Qué hago hoy?", "Texto recortado antes de cobrar");
    assert(f.aiAuth() === "Bearer test-only-gateway-key");
    const messages = (f.aiBody() as { messages: { role: string; content: string }[] }).messages;
    assert(messages[0].role === "system" && /Eres Lumi/.test(messages[0].content));
    assert(/Correr 5 km \(próxima acción: Trotar 10 minutos\)/.test(messages[1].content));
    assert(messages[3].role === "assistant", "Los mensajes de Lumi van como assistant");
    assert(messages.at(-1)?.content === "¿Qué hago hoy?");
    assert(!("model" in (f.aiBody() as object)), "El gateway decide el modelo");
  } finally {
    f.close();
  }
});

Deno.test("Si Lumi no responde (PC apagado, vacío u ocupado) devuelve los créditos con un mensaje claro", async () => {
  for (const [ai, message] of [["down", RESTING], ["empty", RESTING], ["busy", BUSY]]) {
    const f = setup({ ai });
    try {
      const response = await handleLumiChat(request());
      assert(response.status === 503, `${ai}: ${response.status}`);
      const body = await response.json();
      assert(body.error === message && body.refunded === true, `${ai}: ${body.error}`);
      assert(/No se descontaron créditos/.test(body.error));
      const names = f.rpcs().map((r) => r.name);
      assert(names.includes("lumi_chat_refund") && !names.includes("lumi_chat_finish"), names.join());
    } finally {
      f.close();
    }
  }
});

Deno.test("Sin créditos responde 402 con el texto que muestra el enlace a Mi plan y no llama a la IA", async () => {
  const f = setup({ begin: "no_credits" });
  try {
    const response = await handleLumiChat(request());
    assert(response.status === 402);
    assert(/créditos suficientes/.test((await response.json()).error));
    assert(f.aiBody() === null);
  } finally {
    f.close();
  }
});

Deno.test("Valida origen, sesión, identificador y largo del mensaje sin cobrar", async () => {
  const f = setup();
  try {
    assert((await handleLumiChat(request(undefined, "test-valid-session", "https://evil.example.test"))).status === 403);
    assert((await handleLumiChat(request(undefined, null))).status === 401);
    assert((await handleLumiChat(request(undefined, "expired"))).status === 401);
    assert((await handleLumiChat(request({ request_id: "x", text: "hola" }))).status === 422);
    assert((await handleLumiChat(request({ request_id: REQUEST, text: "   " }))).status === 422);
    assert((await handleLumiChat(request({ request_id: REQUEST, text: "x".repeat(501) }))).status === 422);
    assert(f.rpcs().length === 0 && f.aiBody() === null);
    const options = await handleLumiChat(
      new Request("https://function.example.test", { method: "OPTIONS", headers: { Origin: "https://tauri.localhost" } }),
    );
    assert(options.status === 204);
  } finally {
    f.close();
  }
});

Deno.test("El contexto es mínimo y la respuesta se limpia y recorta", () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "lumi" : "user", content: `m${i}` } as const));
  const messages = lumiMessages({ profile: { name: null }, goals: [], history }, "hola");
  assert(messages.length === 2 + 6 + 1, String(messages.length));
  assert(/No tiene metas activas/.test(messages[1].content));
  assert(cleanReply("a".repeat(250) + ". " + "b".repeat(500)).length <= 600);
  assert(cleanReply(42) === "");
});
