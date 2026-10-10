import { readContextRows, planningGoal, completedAction } from "./plan-context.ts";
function assert(value: unknown, message = "Assertion failed") {
  if (!value) throw new Error(message);
}

Deno.test("El calendario conserva filas más allá de 1.000 y respeta límites menores del servidor", async () => {
  const tasks = Array.from({ length: 1201 }, (_, id) => ({ id, minutes: 5 }));
  let calls = 0;
  const result = await readContextRows((from, to) => {
    calls++;
    return Promise.resolve({ data: tasks.slice(from, Math.min(to + 1, from + 400)), count: tasks.length, error: null });
  });
  assert(calls === 4 && result.length === tasks.length);
  assert(result.reduce((sum, row) => sum + row.minutes, 0) === 6005);
});

Deno.test("Un calendario incompleto falla antes de generar un plan", async () => {
  for (const response of [{ data: [], count: null, error: null }, { data: [], count: 10, error: null }, { data: null, count: null, error: {} }]) {
    let rejected = false;
    try { await readContextRows(() => Promise.resolve(response)); } catch { rejected = true; }
    assert(rejected);
  }
});

Deno.test("El contexto preserva contenido útil y omite identificadores y auditoría", () => {
  const input = { title: "Escribir", description: "No repetir el borrador", minutes: 30, priority: "high",
    scheduled_date: "2026-10-09", deadline: null, completed_at: "2026-10-09T12:00:00Z", area: "Novela",
    user_id: "private-owner", id: "private-id", created_at: "audit", version: 9 };
  const action = completedAction(input);
  assert(action.title === input.title && action.description === input.description && action.minutes === 30);
  assert(action.area === input.area && action.completed_at === input.completed_at);
  const goal = planningGoal({ ...input, outcome: "Publicar", current_situation: "Borrador terminado" });
  assert(goal?.outcome === "Publicar" && goal.current_situation === "Borrador terminado");
  assert(!JSON.stringify([action, goal]).includes("private-") && !("version" in goal!));
  assert(planningGoal(null) === null);
});
