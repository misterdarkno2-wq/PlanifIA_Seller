import { test } from "node:test";
import assert from "node:assert/strict";
import {
  progression,
  progress,
  normalizeLegacy,
  today,
} from "../src/domain.js";
import { validateProposal } from "../supabase/functions/_shared/plan.js";

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
