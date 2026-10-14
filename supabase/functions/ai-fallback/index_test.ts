// Contratos del respaldo de planes: Auth, base de datos y NVIDIA son respuestas sintéticas, sin claves reales.
import { handleAiFallback, LIMITED, UNAVAILABLE } from "./handler.ts";
import { NVIDIA_DEFAULT_MODEL } from "../_shared/ai-fallback.ts";

function assert(condition: unknown, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}
const JOB = "55555555-5555-4555-8555-555555555555";
const plan = {
  title: "Aprender a dibujar",
  description: "Practicar el dibujo con pequeños ejercicios.",
  category: "creative",
  outcome: "Terminar un dibujo sencillo.",
  first_action: "Dibujar una taza.",
  summary: "Un ejercicio concreto.",
  milestones: [{
    title: "Un primer dibujo",
    tasks: [{ title: "Dibujar una taza", description: "Observar una taza y dibujarla.", minutes: 20, priority: "medium", day_offset: 0, deadline: null }],
  }],
};
const payload = {
  requestData: { idea: "Aprender a dibujar", current_situation: "Nunca dibujé" },
  limits: {
    weeklyMinutes: 140,
    remainingWeekly: [700, 100, 0, 70],
    remainingDaily: { "2026-10-03": 120, "2026-10-04": 120 },
    availableDays: [0, 1, 2, 3, 4, 5, 6],
    startDate: "2026-10-03",
    targetDate: null,
  },
  goal_id: null,
  expected_version: null,
};

// claim: lo que responde claim_ai_job_cloud. cloud: "ok" | "fenced" | "503" | "400". key: con NVIDIA_API_KEY.
function setup({ claim = "claimed", cloud = "ok", key = true }: { claim?: string; cloud?: string; key?: boolean } = {}) {
  const savedFetch = globalThis.fetch;
  const rpcs: { name: string; body: Record<string, unknown> }[] = [];
  let cloudBody: Record<string, unknown> | null = null;
  let cloudAuth = "";
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ALLOWED_ORIGINS", "NVIDIA_API_KEY", "NVIDIA_MODEL", "NVIDIA_PLAN_FORMAT"];
  const saved = new Map(keys.map((k) => [k, Deno.env.get(k)]));
  for (const k of keys) Deno.env.delete(k);
  for (const [k, value] of Object.entries({
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_ANON_KEY: "test-only-public-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-private-key",
    ALLOWED_ORIGINS: "https://web.example.test,https://tauri.localhost",
  }))
    Deno.env.set(k, value);
  if (key) Deno.env.set("NVIDIA_API_KEY", "nvapi-test-only-not-a-real-key");
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
      if (rpc === "claim_ai_job_cloud")
        return Response.json(claim === "claimed"
          ? { status: "claimed", id: JOB, lease_token: "66666666-6666-4666-8666-666666666666", timeout_ms: 125000, payload }
          : { status: claim });
      if (rpc === "finish_ai_job") return Response.json(true);
    }
    if (url === "https://integrate.api.nvidia.com/v1/chat/completions") {
      cloudBody = JSON.parse(String(options?.body));
      cloudAuth = new Headers(options?.headers).get("authorization") || "";
      if (/^\d{3}$/.test(cloud)) return Response.json({ error: "fixture" }, { status: Number(cloud) });
      const content = cloud === "fenced" ? "```json\n" + JSON.stringify(plan) + "\n```" : JSON.stringify(plan);
      return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] });
    }
    throw new Error("Unexpected fixture URL " + url);
  };
  return {
    rpcs: () => rpcs,
    finish: () => rpcs.find((r) => r.name === "finish_ai_job")?.body,
    cloudBody: () => cloudBody,
    cloudAuth: () => cloudAuth,
    close: () => {
      globalThis.fetch = savedFetch;
      for (const [k, value] of saved) value === undefined ? Deno.env.delete(k) : Deno.env.set(k, value);
    },
  };
}
const request = (body: unknown = { job_id: JOB }, token: string | null = "test-valid-session", origin = "https://tauri.localhost") =>
  new Request("https://function.example.test", {
    method: "POST",
    headers: { Origin: origin, ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

Deno.test("ai-fallback exige origen permitido, sesión válida e identificador correcto antes de tocar la cola", async () => {
  const f = setup();
  try {
    assert((await handleAiFallback(request(undefined, "test-valid-session", "https://evil.example.test"))).status === 403);
    assert((await handleAiFallback(request(undefined, null))).status === 401);
    assert((await handleAiFallback(request(undefined, "expired"))).status === 401);
    assert((await handleAiFallback(request({ job_id: "1; drop table" }))).status === 422);
    assert(f.rpcs().length === 0 && f.cloudBody() === null);
  } finally { f.close(); }
});

Deno.test("Sin NVIDIA_API_KEY no toma la solicitud: sigue en cola para la IA local", async () => {
  const f = setup({ key: false });
  try {
    const response = await handleAiFallback(request());
    const body = await response.json();
    assert(response.status === 503 && body.error === UNAVAILABLE);
    assert(f.rpcs().length === 0);
  } finally { f.close(); }
});

Deno.test("Si el PC volvió, no hay nada en cola o se alcanzó el límite, no llama a NVIDIA", async () => {
  for (const [claim, status, expected] of [["local_online", 200, "local"], ["none", 200, "none"], ["limited", 429, "limited"]] as const) {
    const f = setup({ claim });
    try {
      const response = await handleAiFallback(request());
      const body = await response.json();
      assert(response.status === status && body.status === expected, `${claim}: ${response.status}`);
      if (claim === "limited") assert(body.error === LIMITED);
      assert(f.cloudBody() === null && !f.finish(), claim);
      assert(f.rpcs()[0].body.p_user === "11111111-1111-4111-8111-111111111111" && f.rpcs()[0].body.p_job === JOB);
    } finally {
      f.close();
    }
  }
});

Deno.test("Con el PC apagado prepara la propuesta en NVIDIA, la valida y la guarda con el token de la concesión", async () => {
  for (const cloud of ["ok", "fenced"]) {
    const f = setup({ cloud });
    try {
      const response = await handleAiFallback(request());
      assert(response.status === 202, `${cloud}: ${response.status}`);
      assert((await response.json()).status === "processing");
      assert(f.cloudAuth() === "Bearer nvapi-test-only-not-a-real-key");
      const body = f.cloudBody() as { model: string; response_format: { type: string }; messages: { role: string; content: string }[] };
      assert(body.model === NVIDIA_DEFAULT_MODEL);
      assert(body.response_format.type === "json_schema");
      assert(/Formato de respuesta/.test(body.messages[0].content), "Prompt de sistema adaptado a la nube");
      const finish = f.finish() as { p_id: string; p_token: string; p_result: { proposal: Record<string, unknown> }; p_error: unknown; p_retry: boolean };
      assert(finish.p_id === JOB && finish.p_token === "66666666-6666-4666-8666-666666666666");
      assert(finish.p_error === null && finish.p_retry === false);
      assert(finish.p_result.proposal.title === "Aprender a dibujar", `${cloud}: sin propuesta`);
      assert(finish.p_result.proposal.start_date === "2026-10-03" && finish.p_result.proposal.current_situation === "Nunca dibujé");
    } finally {
      f.close();
    }
  }
});

Deno.test("Un fallo de NVIDIA no guarda propuesta: reintenta sólo si es transitorio (los créditos los devuelve la base)", async () => {
  for (const [cloud, retry] of [["503", true], ["400", false]] as const) {
    const f = setup({ cloud });
    try {
      assert((await handleAiFallback(request())).status === 202);
      const finish = f.finish() as { p_result: unknown; p_error: string; p_retry: boolean };
      assert(finish.p_result === null && typeof finish.p_error === "string" && finish.p_retry === retry, `${cloud}`);
    } finally {
      f.close();
    }
  }
});

Deno.test("NVIDIA_MODEL y NVIDIA_PLAN_FORMAT cambian el modelo y el formato pedido", async () => {
  const f = setup();
  try {
    Deno.env.set("NVIDIA_MODEL", "qwen/qwen3.5-122b-a10b");
    Deno.env.set("NVIDIA_PLAN_FORMAT", "json_object");
    assert((await handleAiFallback(request())).status === 202);
    const body = f.cloudBody() as { model: string; response_format: { type: string } };
    assert(body.model === "qwen/qwen3.5-122b-a10b" && body.response_format.type === "json_object");
  } finally { f.close(); }
});

Deno.test("Si NVIDIA retiró el primer modelo (410), el plan se prepara con el siguiente de NVIDIA_MODEL", async () => {
  const f = setup();
  const savedFetch = globalThis.fetch;
  const asked: string[] = [];
  try {
    Deno.env.set("NVIDIA_MODEL", "meta/llama-3.3-70b-instruct,openai/gpt-oss-20b");
    globalThis.fetch = async (input, options) => {
      if (String(input).includes("integrate.api.nvidia.com")) {
        const model = JSON.parse(String(options?.body)).model;
        asked.push(model);
        if (model === "meta/llama-3.3-70b-instruct") return Response.json({ title: "Gone" }, { status: 410 });
      }
      return savedFetch(input, options);
    };
    assert((await handleAiFallback(request())).status === 202);
    const finish = f.finish() as { p_result: { proposal: Record<string, unknown> }; p_error: unknown };
    assert(finish.p_error === null && finish.p_result.proposal.title === "Aprender a dibujar");
    assert(JSON.stringify(asked) === JSON.stringify(["meta/llama-3.3-70b-instruct", "openai/gpt-oss-20b"]), asked.join());
  } finally {
    globalThis.fetch = savedFetch;
    f.close();
  }
});
