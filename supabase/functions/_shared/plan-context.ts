type Page<T> = { data: T[] | null; error: unknown; count: number | null };

/** Read every page, including projects whose REST row limit is below 1,000.
 * Never silently plan against a truncated calendar. RLS remains on the caller.
 */
export async function readContextRows<T>(page: (from: number, to: number) => PromiseLike<Page<T>>) {
  const rows: T[] = [];
  while (rows.length < 50000) {
    const result = await page(rows.length, rows.length + 999);
    if (result.error || !result.data || result.count === null)
      throw new Error("No pudimos consultar tu calendario completo. Inténtalo de nuevo.");
    rows.push(...result.data);
    if (rows.length >= result.count) return rows;
    if (!result.data.length) break;
  }
  throw new Error("Tu calendario supera el tamaño que podemos planificar de forma segura.");
}

/** Keep planning meaning; exclude ownership IDs, audit timestamps and versions. */
export function planningGoal(goal: Record<string, unknown> | null) {
  if (!goal) return null;
  return Object.fromEntries([
    "title", "description", "category", "current_situation", "outcome",
    "weekly_minutes", "target_date", "status", "achieved_at",
  ].map((key) => [key, goal[key]]));
}

export function completedAction(task: Record<string, unknown>) {
  return Object.fromEntries([
    "title", "description", "area", "minutes", "priority", "scheduled_date", "deadline", "completed_at",
  ].map((key) => [key, task[key]]));
}
