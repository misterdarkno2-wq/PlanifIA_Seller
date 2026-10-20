import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Planes, uso del mes y límites en el servidor con todas las migraciones. El cobro web con
// Transbank se retiró (202610190001_retire_transbank.sql): los planes pagados llegan por Google Play.
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',
      email_confirmed_at timestamptz default now(),created_at timestamptz not null default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  await db.query(
    "insert into auth.users(id,email) values($1,'a@example.invalid'),($2,'b@example.invalid')",
    [A, B],
  );
  return db;
}
const asUser = (db, id = A) =>
  db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
const asService = (db) => db.exec("reset role; set role service_role;");
const owner = (db) => db.exec("reset role;");
async function state(db, user = A) {
  await asUser(db, user);
  return (await db.query("select public.billing_state() result")).rows[0]
    .result;
}
// Mismo camino que play-billing tras validar la compra con Google Play.
async function subscribe(db, user, product, token) {
  await asService(db);
  return (
    await db.query(
      "select public.play_apply_subscription($1,$2,$3,'SUBSCRIPTION_STATE_ACTIVE',now()+interval '30 days',true,'GPA.1',null,false,'{}'::jsonb) result",
      [user, token, product],
    )
  ).rows[0].result;
}

test("Catálogo y RLS: cualquiera lee los planes; ningún cliente activa planes ni reserva IA", async () => {
  const db = await setup();
  try {
    await db.exec("set role anon");
    const catalog = (
      await db.query(
        "select * from public.plan_catalog where enabled order by position",
      )
    ).rows;
    assert.deepEqual(
      catalog.map((p) => [p.id, p.price_clp, p.monthly_credits]),
      [
        ["free", 0, 0],
        ["plus", 2750, 1000],
        ["pro", 4990, 2500],
      ],
    );
    await assert.rejects(
      db.query("select public.billing_state()"),
      /permission denied/,
    );
    await asUser(db);
    for (const sql of [
      "update public.plan_catalog set price_clp=1",
      "select * from private.billing_methods",
      "select * from private.play_subscriptions",
      "select public.reserve_plan_ai($1,'generation')",
      "insert into public.subscriptions(user_id,plan_id) values($1,'pro')",
      "insert into public.subscription_periods(user_id,plan_id) values($1,'pro')",
    ])
      await assert.rejects(
        db.query(sql, sql.includes("$1") ? [A] : []),
        /permission denied/,
      );
    const own = await state(db);
    assert.equal(own.effective_plan.id, "free");
    assert.deepEqual(
      own.plans.map((p) => p.id),
      ["free", "plus", "pro"],
    );
    assert.deepEqual(own.payments, []);
    assert.equal(own.pending_order, null);
    assert.equal(own.usage.max_active_goals, 3);
  } finally {
    await db.close();
  }
});

test("Transbank retirado: nadie ejecuta billing_admin, manage_subscription ni billing_promotion; Mi plan sigue con Google Play", async () => {
  const db = await setup();
  try {
    const retired = [
      ["billing_admin(text,jsonb)", "select public.billing_admin('create_order','{}'::jsonb)"],
      ["manage_subscription(text,text,boolean)", "select public.manage_subscription('cancel')"],
      ["billing_promotion()", "select public.billing_promotion()"],
    ];
    for (const role of ["anon", "authenticated", "service_role"])
      for (const [, sql] of retired) {
        await db.exec(`reset role; set role ${role}`);
        if (role === "authenticated")
          await db.exec(`select set_config('request.jwt.claim.sub','${A}',false)`);
        await assert.rejects(db.query(sql), /permission denied/, `${role}: ${sql}`);
      }
    await owner(db);
    for (const [signature] of retired)
      assert.match(
        (
          await db.query("select obj_description($1::regprocedure,'pg_proc') d", [
            "public." + signature,
          ])
        ).rows[0].d,
        /^Retirada el 2026-10-19/,
      );
    // billing_state usa la campaña con los permisos de su dueño: Mi plan no depende del permiso retirado.
    assert.equal((await state(db)).effective_plan.id, "free");
    await subscribe(db, A, "planifia_pro", "token-pro-retiro-0001");
    const pro = await state(db);
    assert.equal(pro.effective_plan.id, "pro");
    assert.equal(pro.usage.max_active_goals, 50);
    assert.equal((await state(db, B)).effective_plan.id, "free");
    await asUser(db);
    assert.equal(
      (await db.query("select public.monetization_state() result")).rows[0]
        .result.plan.id,
      "pro",
    );
  } finally {
    await db.close();
  }
});

test("Cuotas de metas e IA en servidor: downgrade conserva tareas y XP, reactivar y aplicar planes no elude límites", async () => {
  const db = await setup();
  try {
    const createGoal = async (title) => {
      await asUser(db);
      return (
        await db.query("select public.save_goal($1::jsonb) id", [
          JSON.stringify({ title, category: "learning", weekly_minutes: 180 }),
        ])
      ).rows[0].id;
    };
    const goals = [];
    for (let i = 0; i < 3; i++) goals.push(await createGoal("Meta " + i));
    await assert.rejects(createGoal("Cuarta"), /3 metas activas/);
    await db.query("select public.set_goal_status($1,'paused')", [goals[0]]);
    const fourth = await createGoal("Cuarta permitida");
    await assert.rejects(
      db.query("select public.set_goal_status($1,'active')", [goals[0]]),
      /3 metas activas/,
    );
    const today = (
      await db.query(
        "select (now() at time zone 'America/Santiago')::date::text d",
      )
    ).rows[0].d;
    const plan = {
      title: "Plan bloqueado",
      description: "",
      outcome: "Completarlo",
      category: "learning",
      weekly_minutes: 180,
      start_date: today,
      milestones: [
        {
          title: "Paso",
          tasks: [
            { title: "Primero", priority: "low", minutes: 10, day_offset: 1 },
          ],
        },
      ],
    };
    await assert.rejects(
      db.query("select public.apply_goal_plan(null,null,$1::jsonb,$2)", [
        JSON.stringify(plan),
        randomUUID(),
      ]),
      /3 metas activas/,
    );
    await asService(db);
    assert.equal(
      (await db.query("select public.reserve_plan_ai($1,'generation') r", [A]))
        .rows[0].r,
      false,
      "Se bloquea la llamada IA antes de superar metas activas",
    );
    await asUser(db);
    await db.query("select public.set_goal_status($1,'paused')", [fourth]);
    await asService(db);
    for (let i = 0; i < 3; i++)
      assert.equal(
        (
          await db.query("select public.reserve_plan_ai($1,'generation') r", [
            A,
          ])
        ).rows[0].r,
        true,
      );
    assert.equal(
      (await db.query("select public.reserve_plan_ai($1,'generation') r", [A]))
        .rows[0].r,
      false,
    );
    assert.equal(
      (await db.query("select public.reserve_plan_ai($1,'adjustment') r", [A]))
        .rows[0].r,
      true,
    );
    assert.equal(
      (await db.query("select public.reserve_plan_ai($1,'adjustment') r", [A]))
        .rows[0].r,
      false,
    );
    await subscribe(db, A, "planifia_plus", "token-plus-cuotas-0001");
    assert.equal((await state(db)).usage.generation_limit, 30);
    assert.equal(
      (await state(db)).usage.generations,
      3,
      "Cambiar plan no reinicia consumo",
    );
    for (let i = 0; i < 5; i++) await createGoal("Extra " + i);
    await owner(db);
    await db.query("update public.pets set total_xp=1234 where user_id=$1", [
      A,
    ]);
    await db.query(
      "insert into public.tasks(user_id,title,goal_id) values($1,'Historial conservado',$2)",
      [A, fourth],
    );
    await db.query(
      "update private.play_subscriptions set state='SUBSCRIPTION_STATE_EXPIRED',expiry_time=now()-interval '1 day' where user_id=$1",
      [A],
    );
    const expired = await state(db);
    assert.equal(expired.effective_plan.id, "free");
    assert.equal(expired.usage.active_goals, 7);
    assert.equal(
      (await db.query("select total_xp from public.pets")).rows[0].total_xp,
      1234,
    );
    assert.equal(
      (await db.query("select count(*)::integer n from public.tasks")).rows[0]
        .n,
      1,
    );
    await assert.rejects(createGoal("Bloqueada"), /3 metas activas/);
    await db.query("select public.save_goal($1::jsonb,$2)", [
      JSON.stringify({
        title: "Edición permitida",
        category: "learning",
        weekly_minutes: 180,
      }),
      fourth,
    ]);
    await db.query("select public.set_goal_status($1,'paused')", [fourth]);
    await assert.rejects(
      db.query("select public.set_goal_status($1,'active')", [fourth]),
      /3 metas activas/,
    );
    await owner(db);
    await db.query("update public.goals set status='paused' where user_id=$1", [
      A,
    ]);
    await db.query(
      "update private.plan_ai_usage set month=(date_trunc('month',now() at time zone 'UTC')-interval '1 month')::date where user_id=$1",
      [A],
    );
    await asService(db);
    assert.equal(
      (await db.query("select public.reserve_plan_ai($1,'generation') r", [A]))
        .rows[0].r,
      true,
    );
    assert.equal((await state(db)).usage.generations, 1);
  } finally {
    await db.close();
  }
});
