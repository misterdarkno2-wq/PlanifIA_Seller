// Provider fixtures only: these tests do not call Ollama, Supabase or the network.
import {
  generateValidatedPlan,
  PlanGenerationError,
  type PlanLimits,
} from "./generate-plan.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
const limits: PlanLimits = {
  weeklyMinutes: 140,
  remainingWeekly: [700, 100, 0, 70],
  remainingDaily: { "2026-10-03": 120, "2026-10-04": 120 },
  availableDays: [0, 1, 2, 3, 4, 5, 6],
  startDate: "2026-10-03",
  targetDate: null,
};
const validPlan = () => ({
  title: "Aprender a dibujar",
  description: "Practicar el dibujo con pequeños ejercicios.",
  category: "creative",
  outcome: "Terminar un dibujo sencillo.",
  first_action: "Dibujar una taza.",
  summary: "Un ejercicio concreto.",
  milestones: [
    {
      title: "Un primer dibujo",
      tasks: [
        {
          title: "Dibujar una taza",
          description: "Observar una taza y dibujarla.",
          minutes: 20,
          priority: "medium",
          day_offset: 0,
          deadline: null,
        },
      ],
    },
  ],
});
const completion = (content: unknown, finish = "stop") =>
  Response.json({
    choices: [
      {
        finish_reason: finish,
        message: {
          content:
            typeof content === "string" ? content : JSON.stringify(content),
        },
      },
    ],
  });
const options = (fetchImpl: typeof fetch, extra = {}) => ({
  endpoint: "https://ai.example.test/v1/chat/completions",
  apiKey: "test-only-secret",
  model: "fixture:27b",
  requestData: {
    idea: "Aprender a dibujar",
    remainingWeekly: [9999],
    weekly_minutes: 9999,
  },
  limits,
  fetchImpl,
  ...extra,
});
async function rejection(operation: Promise<unknown>, status: number) {
  try {
    await operation;
    throw new Error("Expected rejection");
  } catch (error) {
    assert(error instanceof PlanGenerationError);
    assert(
      error.status === status,
      `Expected ${status}, received ${error.status}`,
    );
    assert(!error.message.includes("test-only-secret"));
    return error;
  }
}

Deno.test(
  "Una propuesta válida usa una llamada y presupuestos efectivos exactos",
  async () => {
    let calls = 0;
    const proposal = await generateValidatedPlan(
      options(async (_url, init) => {
        calls++;
        assert(init?.signal instanceof AbortSignal);
        assert(init?.redirect === "error");
        const body = JSON.parse(String(init.body));
        assert(body.response_format.type === "json_schema");
        assert(body.model === "fixture:27b");
        assert(body.messages.length === 2);
        const payload = JSON.parse(body.messages[1].content);
        assert(JSON.stringify(payload.remainingWeekly) === "[140,100,0,70]");
        assert(
          JSON.stringify(payload.remainingDaily) ===
            JSON.stringify(limits.remainingDaily),
        );
        assert(payload.weekly_minutes === 140);
        return completion(validPlan());
      }),
    );
    assert(calls === 1);
    assert(proposal.title === validPlan().title);
  },
);

Deno.test(
  "Una propuesta fuera de presupuesto se reparte en el calendario sin una segunda generación",
  async () => {
    let calls = 0;
    const overBudget = validPlan();
    overBudget.milestones[0].tasks = [
      { ...overBudget.milestones[0].tasks[0], minutes: 120 },
      { ...overBudget.milestones[0].tasks[0], minutes: 120, day_offset: 1 },
    ];
    const result = await generateValidatedPlan(
      options(async () => {
        calls++;
        return completion(overBudget);
      }),
    );
    assert(calls === 1);
    const tasks = result.milestones.flatMap(
      (m: { tasks: { minutes: number }[] }) => m.tasks,
    );
    assert(tasks.length >= 1);
    assert(tasks.every((t: { minutes: number }) => t.minutes >= 5 && t.minutes <= 120));
  },
);

Deno.test(
  "Una primera propuesta incompleta provoca una corrección sin reenviar su contenido",
  async () => {
    let calls = 0;
    const invalid = validPlan();
    invalid.description = "PRIVATE_PREVIOUS_OUTPUT_MUST_NOT_APPEAR";
    invalid.outcome = "";
    const result = await generateValidatedPlan(
      options(async (_url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        if (calls === 1) return completion(invalid);
        assert(body.messages.length === 3);
        assert(body.messages[2].role === "user");
        assert(body.messages[2].content.includes("incompleta"));
        assert(
          !String(init?.body).includes(
            "PRIVATE_PREVIOUS_OUTPUT_MUST_NOT_APPEAR",
          ),
        );
        return completion(validPlan());
      }),
    );
    assert(calls === 2);
    assert(result.milestones[0].tasks[0].minutes === 20);
  },
);

Deno.test(
  "JSON inválido se corrige una vez; dos propuestas inválidas se rechazan sin inventar un plan",
  async () => {
    let calls = 0;
    const result = await generateValidatedPlan(
      options(async (_url, init) => {
        calls++;
        if (calls === 1) return completion("{bad JSON");
        assert(
          String(init?.body).includes("La propuesta no es un JSON válido"),
        );
        return completion(validPlan());
      }),
    );
    assert(result.title === validPlan().title && calls === 2);
    calls = 0;
    const error = await rejection(
      generateValidatedPlan(
        options(async () => {
          calls++;
          return completion({ invalid: true });
        }),
      ),
      502,
    );
    assert(calls === 2);
    assert(error.message.includes("meta incompleta"));
    assert(error.retryable === false, "La cola no debe repetir dos propuestas ya inválidas");
  },
);

Deno.test(
  "HTTP, proveedor ilegible y tokens truncados no se reintentan",
  async () => {
    const cases: Array<{ response: () => Response; status: number }> = [
      {
        response: () =>
          Response.json({ error: "provider-private-detail" }, { status: 500 }),
        status: 502,
      },
      {
        response: () =>
          Response.json({ error: "provider-private-detail" }, { status: 429 }),
        status: 429,
      },
      {
        response: () =>
          Response.json({ error: "provider-private-detail" }, { status: 504 }),
        status: 504,
      },
      { response: () => new Response("not JSON"), status: 502 },
      { response: () => completion(validPlan(), "length"), status: 502 },
      { response: () => Response.json({ choices: [] }), status: 502 },
    ];
    for (const item of cases) {
      let calls = 0;
      const error = await rejection(
        generateValidatedPlan(
          options(async () => {
            calls++;
            return item.response();
          }),
        ),
        item.status,
      );
      assert(calls === 1);
      assert(!error.message.includes("provider-private-detail"));
    }
    let calls = 0;
    await rejection(
      generateValidatedPlan(
        options(async () => {
          calls++;
          throw new Error("provider-private-detail");
        }),
      ),
      502,
    );
    assert(calls === 1);
  },
);

Deno.test(
  "Los dos intentos comparten un solo presupuesto total y abortan el segundo",
  async () => {
    let calls = 0;
    let firstSignal: AbortSignal | null = null;
    let secondAborted = false;
    const started = performance.now();
    await rejection(
      generateValidatedPlan(
        options(
          async (_url, init) => {
            calls++;
            if (calls === 1) {
              firstSignal = init?.signal as AbortSignal;
              await new Promise((resolve) => setTimeout(resolve, 100));
              return completion({ invalid: true });
            }
            assert(init?.signal !== firstSignal);
            return await new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  secondAborted = true;
                  reject(new DOMException("aborted", "AbortError"));
                },
                { once: true },
              );
            });
          },
          { budgetMs: 200 },
        ),
      ),
      504,
    );
    assert(calls === 2 && secondAborted);
    assert(
      performance.now() - started < 275,
      "Retry reset the total time budget",
    );
  },
);
