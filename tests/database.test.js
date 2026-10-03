import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to authenticated,anon,service_role;`);
  for (const file of [
    "202610030001_goals.sql",
    "202610030002_plans_import.sql",
    "202610030003_manual_actions.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$3),($2,$3)",
    [A, B, JSON.stringify({ name: "Persona de prueba" })],
  );
  return db;
}
const asUser = (db, id) =>
  db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
async function rpc(db, name, args) {
  const keys = Object.keys(args),
    values = Object.values(args).map((v) =>
      Array.isArray(v)
        ? "{" + v.join(",") + "}"
        : v && typeof v === "object"
          ? JSON.stringify(v)
          : v,
    );
  const sql = keys.map((key, i) => `${key}=>$${i + 1}`).join(",");
  return (await db.query(`select public.${name}(${sql}) as result`, values))
    .rows[0].result;
}
const task = {
  title: "Primer paso",
  description: "",
  area: "Proyecto",
  priority: "high",
  deadline: "2099-12-20",
  scheduled_date: null,
  minutes: 30,
};

test("Migraciones, RLS, XP atómica, hábitos, planes e importación", async () => {
  const db = await setup();
  try {
    await asUser(db, A);
    assert.equal(
      (await db.query("select * from public.profiles")).rows.length,
      1,
    );
    const goal = await rpc(db, "save_goal", {
      p_data: {
        title: "Crear mi proyecto",
        category: "project",
        weekly_minutes: 180,
        outcome: "Publicar un prototipo",
      },
      p_id: null,
    });
    const mid = await rpc(db, "save_milestone", {
      p_goal_id: goal,
      p_title: "Mi primer prototipo",
      p_id: null,
    });
    assert.equal(
      (await db.query("select title from public.milestones where id=$1", [mid]))
        .rows[0].title,
      "Mi primer prototipo",
    );
    const id = await rpc(db, "save_task", {
      p_data: { ...task, goal_id: goal },
      p_id: null,
    });
    const createId = randomUUID(),
      createData = { ...task, title: "No duplicar al reintentar" };
    const created = await rpc(db, "save_task", {
      p_data: createData,
      p_id: null,
      p_request_id: createId,
    });
    assert.equal(
      await rpc(db, "save_task", {
        p_data: createData,
        p_id: null,
        p_request_id: createId,
      }),
      created,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from public.tasks where title=$1",
          [createData.title],
        )
      ).rows[0].n,
      1,
    );
    const command = randomUUID();
    let result = await rpc(db, "set_task_status", {
      p_id: id,
      p_status: "completed",
      p_request_id: command,
    });
    assert.equal(result.xp_delta, 40);
    assert.equal(result.pet.total_xp, 40);
    assert.deepEqual(
      await rpc(db, "set_task_status", {
        p_id: id,
        p_status: "completed",
        p_request_id: command,
      }),
      result,
    );
    assert.equal(
      (
        await rpc(db, "set_task_status", {
          p_id: id,
          p_status: "completed",
          p_request_id: randomUUID(),
        })
      ).xp_delta,
      0,
    );
    result = await rpc(db, "set_task_status", {
      p_id: id,
      p_status: "pending",
      p_request_id: randomUUID(),
    });
    assert.equal(result.xp_delta, -40);
    assert.equal(result.pet.total_xp, 0);
    // Una respuesta antigua reintentada no vuelve a completar la tarea.
    await rpc(db, "set_task_status", {
      p_id: id,
      p_status: "completed",
      p_request_id: command,
    });
    assert.equal(
      (await db.query("select status from public.tasks where id=$1", [id]))
        .rows[0].status,
      "pending",
    );
    await rpc(db, "save_task", {
      p_data: { ...task, goal_id: goal, priority: "low", deadline: null },
      p_id: id,
    });
    result = await rpc(db, "set_task_status", {
      p_id: id,
      p_status: "completed",
      p_request_id: randomUUID(),
    });
    assert.equal(result.xp_delta, 40);
    assert.equal(
      (await db.query("select count(*)::integer as n from public.xp_rewards"))
        .rows[0].n,
      1,
    );
    for (const [priority, xp] of [
      ["low", 10],
      ["medium", 20],
      ["high", 35],
    ]) {
      const t = await rpc(db, "save_task", {
        p_data: { ...task, priority, deadline: null },
        p_id: null,
      });
      assert.equal(
        (
          await rpc(db, "set_task_status", {
            p_id: t,
            p_status: "completed",
            p_request_id: randomUUID(),
          })
        ).xp_delta,
        xp,
      );
    }
    const late = await rpc(db, "save_task", {
      p_data: { ...task, deadline: "2000-01-01" },
      p_id: null,
    });
    assert.equal(
      (
        await rpc(db, "set_task_status", {
          p_id: late,
          p_status: "completed",
          p_request_id: randomUUID(),
        })
      ).xp_delta,
      35,
    );
    await assert.rejects(
      db.query("update public.pets set total_xp=999999"),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "insert into public.xp_rewards(user_id,task_id,xp_awarded) values($1,$2,99999)",
        [A, id],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query("update public.tasks set status='pending'"),
      /permission denied/,
    );
    await assert.rejects(
      rpc(db, "reserve_ai_request", { p_user_id: A, p_limit: 100 }),
      /permission denied/,
    );
    await asUser(db, B);
    assert.equal(
      (await db.query("select * from public.profiles where user_id=$1", [A]))
        .rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.pets where user_id=$1", [A])).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query("select * from private.commands"),
      /permission denied/,
    );
    for (const table of [
      "goals",
      "tasks",
      "milestones",
      "habits",
      "habit_completions",
      "xp_rewards",
      "xp_events",
      "imports",
    ])
      assert.equal(
        (await db.query("select * from public." + table)).rows.length,
        0,
        table,
      );
    await assert.rejects(
      rpc(db, "set_task_status", {
        p_id: id,
        p_status: "pending",
        p_request_id: randomUUID(),
      }),
      /no encontrada/,
    );
    await assert.rejects(
      rpc(db, "save_task", { p_data: { ...task, goal_id: goal }, p_id: null }),
      /foreign key/,
    );
    assert.equal((await rpc(db, "pet_state", {})).total_xp, 0);
    await asUser(db, A);
    const date = (
      await db.query(
        "select (now() at time zone 'America/Santiago')::date::text as d",
      )
    ).rows[0].d;
    const habit = await rpc(db, "save_habit", {
      p_data: {
        title: "Leer 10 minutos",
        days: [0, 1, 2, 3, 4, 5, 6],
        minutes: 10,
        priority: "low",
      },
      p_id: null,
    });
    const hcmd = randomUUID();
    result = await rpc(db, "set_habit_completion", {
      p_id: habit,
      p_day: date,
      p_completed: true,
      p_request_id: hcmd,
    });
    assert.equal(result.xp_delta, 10);
    await rpc(db, "set_habit_completion", {
      p_id: habit,
      p_day: date,
      p_completed: true,
      p_request_id: hcmd,
    });
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from public.habit_completions",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await rpc(db, "set_habit_completion", {
          p_id: habit,
          p_day: date,
          p_completed: false,
          p_request_id: randomUUID(),
        })
      ).xp_delta,
      -10,
    );
    assert.equal(
      (
        await rpc(db, "set_habit_completion", {
          p_id: habit,
          p_day: date,
          p_completed: true,
          p_request_id: randomUUID(),
        })
      ).xp_delta,
      10,
    );
    await assert.rejects(
      rpc(db, "set_habit_completion", {
        p_id: habit,
        p_day: "2099-01-01",
        p_completed: true,
        p_request_id: randomUUID(),
      }),
      /no corresponde/,
    );
    await rpc(db, "save_profile", {
      p_name: "Persona",
      p_timezone: "America/Santiago",
      p_minutes: 700,
      p_days: [0, 1, 2, 3, 4, 5, 6],
    });
    const plan = {
      title: "Aprender francés",
      description: "Una conversación breve",
      outcome: "Presentarme sin apuntes",
      category: "learning",
      weekly_minutes: 180,
      start_date: date,
      target_date: null,
      milestones: [
        {
          title: "Presentarme",
          tasks: [
            {
              title: "Practicar mi presentación",
              description: "Voz alta",
              priority: "medium",
              minutes: 20,
              day_offset: 1,
              deadline: null,
            },
          ],
        },
      ],
    };
    const pcmd = randomUUID(),
      newGoal = await rpc(db, "apply_goal_plan", {
        p_goal_id: null,
        p_expected_version: null,
        p_plan: plan,
        p_request_id: pcmd,
      });
    assert.equal(
      await rpc(db, "apply_goal_plan", {
        p_goal_id: null,
        p_expected_version: null,
        p_plan: plan,
        p_request_id: pcmd,
      }),
      newGoal,
    );
    const completedTask = (
      await db.query("select id from public.tasks where goal_id=$1", [newGoal])
    ).rows[0].id;
    await rpc(db, "set_task_status", {
      p_id: completedTask,
      p_status: "completed",
      p_request_id: randomUUID(),
    });
    const pendingTask = await rpc(db, "save_task", {
      p_data: {
        ...task,
        goal_id: newGoal,
        title: "Acción que puede reemplazarse",
        deadline: null,
      },
      p_id: null,
    });
    const xpBeforeAdjustment = (await rpc(db, "pet_state", {})).total_xp;
    const version = (
      await db.query("select version from public.goals where id=$1", [newGoal])
    ).rows[0].version;
    await rpc(db, "apply_goal_plan", {
      p_goal_id: newGoal,
      p_expected_version: version,
      p_plan: plan,
      p_request_id: randomUUID(),
    });
    assert.equal(
      (
        await db.query("select status from public.tasks where id=$1", [
          completedTask,
        ])
      ).rows[0].status,
      "completed",
    );
    assert.equal(
      (
        await db.query("select status from public.tasks where id=$1", [
          pendingTask,
        ])
      ).rows[0].status,
      "cancelled",
    );
    assert.equal((await rpc(db, "pet_state", {})).total_xp, xpBeforeAdjustment);
    await assert.rejects(
      rpc(db, "apply_goal_plan", {
        p_goal_id: newGoal,
        p_expected_version: version,
        p_plan: plan,
        p_request_id: randomUUID(),
      }),
      /cambió/,
    );
    await assert.rejects(
      rpc(db, "apply_goal_plan", {
        p_goal_id: newGoal,
        p_expected_version: null,
        p_plan: plan,
        p_request_id: randomUUID(),
      }),
      /cambió/,
    );
    const count = (
      await db.query("select count(*)::integer n from public.goals")
    ).rows[0].n;
    await assert.rejects(
      rpc(db, "apply_goal_plan", {
        p_goal_id: null,
        p_expected_version: null,
        p_plan: {
          ...plan,
          milestones: [
            {
              title: "Mucho",
              tasks: [{ ...plan.milestones[0].tasks[0], minutes: 120 }],
            },
          ],
        },
        p_request_id: randomUUID(),
      }),
      /tiempo/,
    );
    assert.equal(
      (await db.query("select count(*)::integer n from public.goals")).rows[0]
        .n,
      count,
      "El plan fallido debe revertir toda la transacción",
    );
    const payload = {
      source: "anterior:user-1",
      items: [
        {
          key: "task:1",
          ...task,
          priority: "medium",
          deadline: "2026-10-10",
          status: "completed",
        },
      ],
      original: {
        tareas: [{ id: 1, titulo: "Original" }],
        mascota: { total_xp: 8000 },
      },
    };
    const initial = (await rpc(db, "pet_state", {})).total_xp;
    assert.equal(
      (
        await rpc(db, "import_legacy", {
          p_data: payload,
          p_request_id: randomUUID(),
        })
      ).added,
      1,
    );
    assert.equal(
      (
        await rpc(db, "import_legacy", {
          p_data: payload,
          p_request_id: randomUUID(),
        })
      ).skipped,
      1,
    );
    assert.equal(
      (await rpc(db, "pet_state", {})).total_xp,
      initial,
      "Importar no debe regalar XP arbitraria",
    );
    assert.deepEqual(
      (await db.query("select original from public.imports")).rows[0].original,
      payload.original,
    );
    await rpc(db, "import_legacy", {
      p_data: { ...payload, original: { ...payload.original, version: 2 } },
      p_request_id: randomUUID(),
    });
    assert.equal(
      (await db.query("select count(*)::integer n from public.imports")).rows[0]
        .n,
      2,
      "Se conservan ambas versiones del original",
    );
    await asUser(db, B);
    assert.equal(
      (await db.query("select * from public.imports")).rows.length,
      0,
    );
    await db.exec("reset role");
    await db.exec("set role service_role");
    assert.equal(
      await rpc(db, "reserve_ai_request", { p_user_id: A, p_limit: 2 }),
      true,
    );
    assert.equal(
      await rpc(db, "reserve_ai_request", { p_user_id: A, p_limit: 2 }),
      true,
    );
    assert.equal(
      await rpc(db, "reserve_ai_request", { p_user_id: A, p_limit: 2 }),
      false,
    );
    await db.exec("reset role");
    await db.query("update public.pets set total_xp=20000 where user_id=$1", [
      A,
    ]);
    await asUser(db, A);
    result = await rpc(db, "pet_state", {});
    assert.equal(result.level, 20);
    assert.equal(result.stage, 5);
    assert.equal(result.next_xp, null);
  } finally {
    await db.close();
  }
});
