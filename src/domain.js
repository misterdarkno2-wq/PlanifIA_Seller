export const CATEGORIES = {
  personal: "Personal",
  professional: "Profesional",
  learning: "Aprendizaje",
  wellbeing: "Bienestar",
  creative: "Creatividad",
  project: "Proyecto",
};
export const PRIORITIES = { low: "Baja", medium: "Media", high: "Alta" };
export const STAGES = [
  "Recién nacida",
  "Infantil",
  "Juvenil",
  "Avanzada",
  "Evolución final",
];
export function progression(
  total,
  { first = 100, increment = 35, max = 20 } = {},
) {
  let level = 1,
    floor = 0;
  while (level < max && total >= floor + first + (level - 1) * increment) {
    floor += first + (level - 1) * increment;
    level++;
  }
  return {
    level,
    stage: Math.min(5, 1 + Math.floor(level / 5)),
    levelXp: total - floor,
    nextXp: level === max ? null : first + (level - 1) * increment,
  };
}
export const progress = (tasks) => ({
  done: tasks.filter((t) => t.status === "completed").length,
  total: tasks.length,
  percent: tasks.length
    ? Math.round(
        (100 * tasks.filter((t) => t.status === "completed").length) /
          tasks.length,
      )
    : 0,
});
export function today(timeZone = "America/Santiago", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k).value)
    .join("-");
}
export const dateLabel = (value) =>
  value
    ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(
        new Date(value + "T12:00:00"),
      )
    : "Sin fecha";
export function normalizeLegacy(data, source = "PlanifIA anterior") {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error(
      "El archivo debe contener una exportación JSON de PlanifIA.",
    );
  const tasks = Array.isArray(data.tasks)
    ? data.tasks
    : Array.isArray(data.tareas)
      ? data.tareas
      : [];
  const exams = Array.isArray(data.exams)
    ? data.exams
    : Array.isArray(data.evaluaciones)
      ? data.evaluaciones
      : [];
  const items = [
    ...tasks.map((t) => ({ ...t, kind: "task" })),
    ...exams.map((t) => ({ ...t, kind: "exam" })),
  ];
  if (!items.length)
    throw new Error("No encontramos tareas o evaluaciones para importar.");
  if (items.length > 1000)
    throw new Error("Importa hasta 1.000 actividades por archivo.");
  const ids = new Set();
  const rows = items.map((t, i) => {
    const key = String(t.id ?? i),
      unique = t.kind + ":" + key;
    if (ids.has(unique))
      throw new Error("Hay identificadores repetidos dentro del archivo.");
    ids.add(unique);
    const priority =
      { baja: "low", media: "medium", alta: "high" }[t.prioridad] ||
      t.priority ||
      "medium";
    const deadline =
      String(t.fecha_entrega || t.fecha || t.deadline || "").slice(0, 10) ||
      null;
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline))
      throw new Error(
        "Hay una fecha que no podemos interpretar. Revisa el archivo original.",
      );
    return {
      key: unique,
      title: String(
        t.titulo || t.nombre || t.title || "Actividad importada",
      ).slice(0, 160),
      description: String(t.descripcion || t.description || "").slice(0, 3000),
      area: String(t.asignatura || t.area || "Aprendizaje").slice(0, 80),
      priority,
      deadline,
      scheduled_date: t.scheduled_date || deadline,
      status: ["completed", "completada"].includes(t.estado || t.status)
        ? "completed"
        : "pending",
      minutes: Math.min(
        6000,
        Math.max(5, Number(t.tiempo_estimado || t.minutes) || 30),
      ),
      original: t,
    };
  });
  return {
    source: String(data.sourceId || source).slice(0, 200),
    items: rows,
    original: data,
  };
}
