import { locale, tr } from "./i18n.js";

// Etiquetas en el idioma actual: cada propiedad se lee al dibujar, así que cambiar de idioma basta
// con volver a dibujar la vista. En la base de datos sólo se guardan las claves.
function localized(pairs) {
  const labels = Array.isArray(pairs) ? [] : {};
  for (const [key, [es, en]] of Object.entries(pairs))
    Object.defineProperty(labels, key, { enumerable: true, get: () => tr(es, en) });
  return Object.freeze(labels);
}
export const CATEGORIES = localized({
  personal: ["Personal", "Personal"],
  professional: ["Profesional", "Professional"],
  learning: ["Aprendizaje", "Learning"],
  wellbeing: ["Bienestar", "Wellbeing"],
  creative: ["Creatividad", "Creativity"],
  project: ["Proyecto", "Project"],
});
export const PRIORITIES = localized({ low: ["Baja", "Low"], medium: ["Media", "Medium"], high: ["Alta", "High"] });
export const STAGES = localized([
  ["Recién nacida", "Newborn"],
  ["Infantil", "Little one"],
  ["Juvenil", "Young"],
  ["Avanzada", "Advanced"],
  ["Evolución final", "Final evolution"],
]);
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
    ? new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short" }).format(
        new Date(value + "T12:00:00"),
      )
    : tr("Sin fecha", "No date");
export function normalizeLegacy(data, source = "PlanifIA anterior") {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error(
      tr("El archivo debe contener una exportación JSON de PlanifIA.", "The file must contain a PlanifIA JSON export."),
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
    throw new Error(tr("No encontramos tareas o evaluaciones para importar.", "We found no tasks or exams to import."));
  if (items.length > 1000)
    throw new Error(tr("Importa hasta 1.000 actividades por archivo.", "Import up to 1,000 activities per file."));
  const ids = new Set();
  const rows = items.map((t, i) => {
    const key = String(t.id ?? i),
      unique = t.kind + ":" + key;
    if (ids.has(unique))
      throw new Error(tr("Hay identificadores repetidos dentro del archivo.", "The file has duplicate identifiers."));
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
        tr("Hay una fecha que no podemos interpretar. Revisa el archivo original.", "There is a date we can't read. Check the original file."),
      );
    return {
      key: unique,
      title: String(
        t.titulo || t.nombre || t.title || tr("Actividad importada", "Imported activity"),
      ).slice(0, 160),
      description: String(t.descripcion || t.description || "").slice(0, 3000),
      area: String(t.asignatura || t.area || tr("Aprendizaje", "Learning")).slice(0, 80),
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
