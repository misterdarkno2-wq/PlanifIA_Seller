// Contratos de la función: Auth y proveedor son respuestas sintéticas, sin claves reales.
import { handleGoalPlan } from "./handler.ts";

function assert(condition: unknown, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}
function setup() {
  const savedFetch = globalThis.fetch;
  let enqueueBody: Record<string, unknown> | null = null;
  let providerCalls = 0,
    quota = true,
    monthlyQuota = true;
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "AI_BASE_URL",
    "AI_API_KEY",
    "AI_MODEL",
    "AI_DAILY_LIMIT",
    "ALLOWED_ORIGINS",
  ];
  const saved = new Map(keys.map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries({
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_ANON_KEY: "test-only-public-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-private-key",
    AI_BASE_URL: "https://ai.example.test/v1",
    AI_API_KEY: "test-only-provider-key",
    AI_MODEL: "fixture",
    AI_DAILY_LIMIT: "2",
    ALLOWED_ORIGINS: "https://web.example.test",
  })) {
    Deno.env.set(key, value);
  }
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      if (
        new Headers(options?.headers).get("authorization") !==
        "Bearer test-valid-session"
      ) {
        return Response.json({ msg: "Session expired" }, { status: 401 });
      }
      return Response.json({
        id: "11111111-1111-4111-8111-111111111111",
        email: "test@example.test",
        aud: "authenticated",
      });
    }
    if (url.includes("/rest/v1/profiles")) {
      return Response.json({
        timezone: "America/Santiago",
        weekly_minutes: 700,
        available_days: [0, 1, 2, 3, 4, 5, 6],
      });
    }
    if (url.includes("/rpc/enqueue_ai_job")) {
      enqueueBody = JSON.parse(String(options?.body));
      return quota && monthlyQuota
        ? Response.json({
            id: "33333333-3333-4333-8333-333333333333",
            status: "queued",
          })
        : Response.json(
            { code: "P0001", message: "Llegaste al límite de tu plan." },
            { status: 400 },
          );
    }
    if (url.includes("/rpc/reserve_ai_request")) return Response.json(quota);
    if (url.includes("/rpc/reserve_plan_ai")) {
      return Response.json(monthlyQuota);
    }
    if (url.includes("/rest/v1/")) return Response.json([]);
    if (url.startsWith("https://ai.example.test")) {
      providerCalls++;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                title: "Aprender inglés",
                description: "Practicar una conversación breve",
                outcome: "Presentarme con confianza",
                category: "learning",
                first_action: "Grabar mi presentación",
                summary: "Un paso pequeño.",
                milestones: [
                  {
                    title: "Una presentación",
                    tasks: [
                      {
                        title: "Grabar",
                        description: "Hablar dos minutos",
                        priority: "medium",
                        minutes: 20,
                        day_offset: 0,
                        deadline: null,
                      },
                    ],
                  },
                ],
              }),
            },
          },
        ],
      });
    }
    throw new Error("Unexpected fixture URL");
  };
  return {
    calls: () => providerCalls,
    submission: () => enqueueBody,
    denyQuota: () => {
      quota = false;
    },
    denyMonthlyQuota: () => {
      monthlyQuota = false;
    },
    close: () => {
      globalThis.fetch = savedFetch;
      for (const [key, value] of saved) {
        value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
      }
    },
  };
}
const request = (
  token: string | null = "test-valid-session",
  origin = "https://web.example.test",
) =>
  new Request("https://function.example.test", {
    method: "POST",
    headers: {
      Origin: origin,
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request_id: "22222222-2222-4222-8222-222222222222",
      plan_id: "pro",
      priority: 999,
      idea: "Hablar inglés",
      weekly_minutes: 140,
      current_situation: "Principiante",
      outcome: "Presentarme",
    }),
  });

Deno.test(
  "JWT ausente, vencido y origen no autorizado nunca llaman al proveedor",
  async () => {
    const fixture = setup();
    try {
      assert((await handleGoalPlan(request(null))).status === 401);
      assert((await handleGoalPlan(request("expired"))).status === 401);
      assert(
        (
          await handleGoalPlan(
            request("test-valid-session", "https://other.example.test"),
          )
        ).status === 403,
      );
      assert(fixture.calls() === 0);
    } finally {
      fixture.close();
    }
  },
);
Deno.test(
  "Cuota mensual agotada impide llamar a la IA aunque quede cuota diaria",
  async () => {
    const fixture = setup();
    try {
      fixture.denyMonthlyQuota();
      const response = await handleGoalPlan(request());
      assert(response.status === 429);
      assert((await response.json()).error.includes("límite"));
      assert(fixture.calls() === 0);
    } finally {
      fixture.close();
    }
  },
);
Deno.test(
  "No requiere credencial de GPU en Edge: valida y guarda una solicitud, sin generación síncrona",
  async () => {
    const fixture = setup();
    try {
      Deno.env.delete("AI_API_KEY");
      const response = await handleGoalPlan(request());
      assert(response.status === 202);
      assert((await response.json()).job.status === "queued");
      const submission = fixture.submission()!;
      assert(submission.p_user_id === "11111111-1111-4111-8111-111111111111");
      assert(!Object.hasOwn(submission, "priority"));
      assert(!Object.hasOwn(submission.p_input as object, "plan_id"));
      assert(fixture.calls() === 0);
    } finally {
      fixture.close();
    }
  },
);
Deno.test(
  "Cuota agotada bloquea el proveedor y una sesión válida recibe una propuesta sin guardar",
  async () => {
    let fixture = setup();
    try {
      fixture.denyQuota();
      assert((await handleGoalPlan(request())).status === 429);
      assert(fixture.calls() === 0);
    } finally {
      fixture.close();
    }
    fixture = setup();
    try {
      const response = await handleGoalPlan(request());
      assert(response.status === 202);
      const data = await response.json();
      assert(data.job.status === "queued");
      assert(fixture.calls() === 0);
    } finally {
      fixture.close();
    }
  },
);
