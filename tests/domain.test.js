import { test } from "node:test";
import assert from "node:assert/strict";
import {
  progression,
  progress,
  normalizeLegacy,
  today,
} from "../src/domain.js";
import { fitSchedule, validateProposal } from "../supabase/functions/_shared/plan.js";

test("Los 20 niveles, cinco etapas y saltos grandes respetan la curva creciente", () => {
  let floor = 0;
  for (let level = 1; level <= 20; level++) {
    const p = progression(floor);
    assert.equal(p.level, level);
    assert.equal(p.stage, Math.min(5, 1 + Math.floor(level / 5)));
    if (level < 20) {
      assert.equal(p.nextXp, 100 + (level - 1) * 35);
      assert.equal(progression(floor + p.nextXp - 1).level, level);
      floor += p.nextXp;
    }
  }
  assert.equal(progression(100000).level, 20);
  assert.equal(progression(0).level, 1);
});
test("Progreso de acciones y fechas locales sin confirmar automáticamente el resultado", () => {
  assert.deepEqual(progress([{ status: "completed" }, { status: "pending" }]), {
    done: 1,
    total: 2,
    percent: 50,
  });
  assert.equal(
    today("America/Santiago", new Date("2026-10-04T01:00:00Z")),
    "2026-10-03",
  );
});
test("Importar conserva el original, los tiempos, las fechas y los estados académicos", () => {
  const original = {
    sourceId: "legacy:42",
    tareas: [
      {
        id: 7,
        titulo: "Estudiar",
        asignatura: "Biología",
        fecha_entrega: "2026-10-15",
        tiempo_estimado: 600,
        estado: "completada",
      },
    ],
    evaluaciones: [
      { id: 7, nombre: "Examen", asignatura: "Historia", fecha: "2026-10-17" },
    ],
  };
  const result = normalizeLegacy(original);
  assert.deepEqual(result.original, original);
  assert.equal(result.items[0].minutes, 600);
  assert.equal(result.items[0].status, "completed");
  assert.equal(result.items[0].deadline, "2026-10-15");
  assert.notEqual(result.items[0].key, result.items[1].key);
  assert.throws(
    () => normalizeLegacy({ tareas: [{ id: 1 }, { id: 1 }] }),
    /repetidos/,
  );
});
const proposal = {
  title: "Practicar inglés",
  description: "Una conversación breve",
  outcome: "Presentarme",
  category: "learning",
  first_action: "Grabar mi presentación",
  summary: "Un paso posible.",
  milestones: [
    {
      title: "Una presentación",
      tasks: [
        {
          title: "Grabar",
          description: "Voz alta",
          priority: "medium",
          minutes: 20,
          day_offset: 0,
          deadline: null,
        },
      ],
    },
  ],
};
test("La propuesta de IA debe caber en los días y en el tiempo restante", () => {
  assert.equal(
    validateProposal(proposal, { startDate: "2026-10-03", weeklyMinutes: 140 }),
    proposal,
  );
  assert.throws(
    () =>
      validateProposal(proposal, {
        startDate: "2026-10-03",
        availableDays: [1, 2, 3, 4, 5],
      }),
    /día/,
  );
  assert.throws(
    () =>
      validateProposal(proposal, {
        startDate: "2026-10-03",
        remainingDaily: { "2026-10-03": 10 },
      }),
    /tiempo/,
  );
  assert.throws(
    () =>
      validateProposal(proposal, {
        startDate: "2026-10-03",
        remainingWeekly: [10],
      }),
    /tiempo/,
  );
  assert.throws(
    () => validateProposal({ ...proposal, title: "" }),
    /incompleta/,
  );
});

test("fitSchedule corrige días, capacidad y vencimientos sin una segunda generación", () => {
  // 2026-10-07 es miércoles; disponible lunes, miércoles y viernes con 60 min por día.
  const limits = {
    weeklyMinutes: 150,
    startDate: "2026-10-07",
    targetDate: "2026-10-20",
    availableDays: [1, 3, 5],
    remainingWeekly: [150, 150],
    remainingDaily: { "2026-10-07": 60, "2026-10-09": 60, "2026-10-12": 60, "2026-10-14": 60, "2026-10-16": 60, "2026-10-19": 60 },
  };
  const task = (title, minutes, day_offset, deadline = null) => ({ title, description: "", priority: "medium", minutes, day_offset, deadline });
  const proposal = {
    title: "Correr 5 km", description: "Plan", outcome: "Correr 5 km", category: "wellbeing", first_action: "Caminar", summary: "Resumen",
    milestones: [
      { title: "Base", tasks: [task("Martes no disponible", 30, 6), task("Mismo día lleno", 50, 0), task("Otra", 40, 0, "2026-10-01")] },
      { title: "Cierre", tasks: [task("Después del objetivo", 30, 25), task("Sin espacio", 120, 13)] },
    ],
  };
  assert.throws(() => validateProposal(proposal, limits));
  const fitted = fitSchedule(proposal, limits);
  assert.doesNotThrow(() => validateProposal(fitted, limits));
  const all = fitted.milestones.flatMap((m) => m.tasks);
  assert.equal(all[0].day_offset, 7, "martes pasa al lunes siguiente disponible");
  assert.equal(all[2].deadline >= "2026-10-07", true);
  assert.ok(all.every((t) => t.minutes >= 5 && t.minutes <= 120));
  const week = (n) => all.filter((t) => Math.floor(t.day_offset / 7) === n).reduce((s, t) => s + t.minutes, 0);
  assert.ok(week(0) <= 150 && week(1) <= 150);
  // Sin capacidad, se retiran acciones en vez de inventar tiempo.
  const empty = fitSchedule(proposal, { ...limits, remainingWeekly: [0, 0] });
  assert.equal(empty.milestones.length, 0);
});

test("fitSchedule mantiene el orden de las acciones aunque la IA ponga días anteriores", () => {
  const limits = { weeklyMinutes: 300, startDate: "2026-10-05", availableDays: [0, 1, 2, 3, 4, 5, 6], remainingWeekly: [300, 300, 300, 300], remainingDaily: { "2026-10-31": 120 } };
  const task = (title, day_offset) => ({ title, description: "", priority: "medium", minutes: 30, day_offset, deadline: null });
  const fitted = fitSchedule({
    milestones: [
      { title: "Inicio", tasks: [task("Diagnóstico", 0), task("Plan", 2)] },
      { title: "Final", tasks: [task("Simulacro final", 26), task("Repaso", 2), task("Evaluación final", 12)] },
    ],
  }, limits);
  const offsets = fitted.milestones.flatMap((m) => m.tasks.map((t) => t.day_offset));
  assert.deepEqual(offsets, [0, 2, 26, 26, 26]);
});
