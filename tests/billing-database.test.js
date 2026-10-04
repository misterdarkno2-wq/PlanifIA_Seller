import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  for (const file of [
    "202610030001_goals.sql",
    "202610030002_plans_import.sql",
    "202610030003_manual_actions.sql",
    "202610040001_billing.sql",
    "202610040002_closed_renewals.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
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
async function admin(db, action, payload = {}) {
  await asService(db);
  return (
    await db.query("select public.billing_admin($1,$2::jsonb) result", [
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
}
async function state(db, user = A) {
  await asUser(db, user);
  return (await db.query("select public.billing_state() result")).rows[0]
    .result;
}
async function order(
  db,
  plan = "plus",
  channel = "webpay",
  user = A,
  extras = {},
) {
  return admin(db, "create_order", {
    user_id: user,
    plan_id: plan,
    channel,
    request_id: randomUUID(),
    ...extras,
  });
}
async function approve(db, o, extra = {}) {
  const confirmed = await admin(db, "confirm_order", {
    order_id: o.id,
    provider_result: {
      approved: true,
      amount: o.amount,
      buy_order: o.buy_order,
      session_id: o.session_id,
      response_code: 0,
    },
    ...extra,
  });
  Object.assign(o, confirmed);
  return confirmed;
}
async function start(db, o) {
  const claim = await admin(db, "claim_order", { order_id: o.id });
  assert.equal(claim.claimed, true);
  Object.assign(o, claim.order);
  return admin(db, "charge_started", { order_id: o.id });
}
async function method(db, user = A) {
  return admin(db, "save_method", {
    user_id: user,
    tbk_user: "private-provider-ref",
    username: "private-user",
    card_type: "Visa",
    last4: "6623",
    consent: true,
  });
}

test("Catálogo, RLS y referencias privadas: ningún cliente puede activar, cobrar ni reservar IA", async () => {
  const db = await setup();
  try {
    await db.exec("set role anon");
    const catalog = (
      await db.query("select * from public.plan_catalog order by position")
    ).rows;
    assert.deepEqual(
      catalog.map((p) => [p.id, p.first_month_clp, p.price_clp]),
      [
        ["free", 0, 0],
        ["plus", 990, 2750],
        ["pro", 1990, 4990],
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
      "select public.billing_admin('create_order','{}')",
      "select public.reserve_plan_ai($1,'generation')",
      "insert into public.subscriptions(user_id,plan_id) values($1,'pro')",
    ])
      await assert.rejects(
        db.query(sql, sql.includes("$1") ? [A] : []),
        /permission denied/,
      );
    const o = await order(db);
    await admin(db, "provider_started", {
      order_id: o.id,
      token: "never-public",
      url: "https://test.invalid",
    });
    const own = await state(db);
    assert.equal(own.pending_order.id, o.id);
    assert.equal(JSON.stringify(own).includes("never-public"), false);
    assert.equal(JSON.stringify(own).includes("provider_token"), false);
    assert.deepEqual((await state(db, B)).payments, []);
    assert.equal(
      (await db.query("select * from public.payment_orders")).rows.length,
      0,
    );
    assert.equal((await state(db)).effective_plan.id, "free");
  } finally {
    await db.close();
  }
});

test("Promoción: fallo no consume, un checkout bloquea el paralelo, validación estricta e idempotencia", async () => {
  const db = await setup();
  try {
    let o = await order(db, "plus");
    assert.equal(o.amount, 990);
    const duplicate = await order(db, "plus");
    assert.equal(duplicate.id, o.id);
    assert.equal(
      (
        await admin(db, "quote", {
          user_id: A,
          plan_id: "plus",
          channel: "webpay",
        })
      ).amount_clp,
      990,
      "Cotizar un checkout pendiente conserva el formato y monto fijado",
    );
    await assert.rejects(order(db, "pro"), /pendiente/);
    await start(db, o);
    await admin(db, "fail_order", {
      order_id: o.id,
      status: "rejected",
      provider_result: { response_code: -1 },
    });
    assert.equal((await state(db)).promotion_available, true);
    o = await order(db, "pro");
    assert.equal(o.amount, 1990);
    await start(db, o);
    for (const bad of [
      { amount: 1 },
      { buy_order: "other" },
      { session_id: B },
      { approved: false },
      { response_code: -1 },
    ])
      await assert.rejects(
        admin(db, "confirm_order", {
          order_id: o.id,
          provider_result: {
            approved: true,
            amount: o.amount,
            buy_order: o.buy_order,
            session_id: o.session_id,
            response_code: 0,
            ...bad,
          },
        }),
        /no coincide/,
      );
    assert.equal((await state(db)).effective_plan.id, "free");
    await approve(db, o);
    await approve(db, o);
    assert.equal((await state(db)).effective_plan.id, "pro");
    assert.equal((await state(db)).promotion_available, false);
    await owner(db);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from public.subscription_periods",
        )
      ).rows[0].n,
      1,
    );
    await asUser(db);
    await db.query("select public.manage_subscription('cancel')");
    assert.equal(
      (await state(db)).effective_plan.id,
      "pro",
      "La cancelación mantiene el acceso pagado",
    );
    await db.query("select public.manage_subscription('change_plan','plus')");
    const renewal = await order(db, "plus");
    assert.equal(renewal.amount, 2750);
    assert.equal(renewal.promo_applied, false);
    assert.equal(renewal.period_start, o.period_end);
    await start(db, renewal);
    await approve(db, renewal);
    assert.equal(
      (await state(db)).effective_plan.id,
      "pro",
      "El cambio pagado anticipadamente espera al inicio siguiente",
    );
    const early = await state(db);
    assert.equal(early.subscription.period_start, o.period_start);
    assert.equal(early.subscription.period_end, o.period_end);
    assert.equal(early.subscription.paid_until, renewal.period_end);
    assert.equal(
      (
        await admin(db, "quote", {
          user_id: A,
          plan_id: "free",
          channel: "webpay",
          for_change: true,
        })
      ).amount_clp,
      0,
    );
    await owner(db);
    await db.query(
      "update public.subscription_periods set starts_at=now()-interval '2 months',ends_at=now()-interval '1 month' where order_id=$1",
      [o.id],
    );
    await db.query(
      "update public.subscription_periods set starts_at=now()-interval '1 day',ends_at=now()+interval '1 month' where order_id=$1",
      [renewal.id],
    );
    assert.equal((await state(db)).effective_plan.id, "plus");
    const proPrice = await admin(db, "quote", {
      user_id: B,
      plan_id: "pro",
      channel: "webpay",
    });
    assert.equal(proPrice.amount_clp, 1990);
    const firstPro = await order(db, "pro", "webpay", B);
    await start(db, firstPro);
    await approve(db, firstPro);
    assert.equal(
      (
        await admin(db, "quote", {
          user_id: B,
          plan_id: "pro",
          channel: "webpay",
        })
      ).amount_clp,
      4990,
    );
    const reg = await admin(db, "quote", {
      user_id: A,
      plan_id: "plus",
      channel: "webpay",
    });
    assert.equal(reg.amount_clp, 2750);
  } finally {
    await db.close();
  }
});

test("Mes calendario UTC sin drift, renovación durable, incertidumbre y cancelación antes del cobro", async () => {
  const db = await setup();
  try {
    await owner(db);
    for (const [start, day, end] of [
      ["2027-01-31T12:34:56Z", 31, "2027-02-28T12:34:56.000Z"],
      ["2027-02-28T12:34:56Z", 31, "2027-03-31T12:34:56.000Z"],
      ["2028-01-31T12:34:56Z", 31, "2028-02-29T12:34:56.000Z"],
      ["2027-12-30T12:34:56Z", 30, "2028-01-30T12:34:56.000Z"],
    ])
      assert.equal(
        (
          await db.query("select private.billing_month_end($1,$2) d", [
            start,
            day,
          ])
        ).rows[0].d.toISOString(),
        end,
      );
    await method(db);
    const revoked = await admin(db, "enroll_create", {
      user_id: B,
      plan_id: "plus",
      purpose: "checkout",
      recurring_consent: true,
    });
    await admin(db, "enroll_started", {
      enrollment_id: revoked.id,
      token: "revoked-inscription-token",
      url: "https://test.invalid",
    });
    await admin(db, "enroll_claim", { enrollment_id: revoked.id });
    await admin(db, "remove_method", { user_id: B });
    assert.equal(
      (
        await admin(db, "enroll_finish", {
          enrollment_id: revoked.id,
          tbk_user: "must-not-reactivate",
          response_code: 0,
        })
      ).status,
      "cancelled",
    );
    assert.equal(await admin(db, "get_method", { user_id: B }), null);
    const o = await order(db, "plus", "oneclick", A, {
      recurring_consent: true,
    });
    await start(db, o);
    await approve(db, o);
    await owner(db);
    await db.query(
      "update public.subscriptions set period_start=now()-interval '1 month',period_end=now()-interval '1 second' where user_id=$1",
      [A],
    );
    const r = await admin(db, "create_renewal", { user_id: A });
    assert.equal(r.amount, 2750);
    assert.equal(r.renewal, true);
    assert.equal((await admin(db, "create_renewal", { user_id: A })).id, r.id);
    await start(db, r);
    assert.equal(
      (await admin(db, "claim_order", { order_id: r.id })).claimed,
      false,
    );
    await owner(db);
    await db.query(
      "update private.payment_provider set lease_until=now()-interval '1 second' where order_id=$1",
      [r.id],
    );
    const uncertain = await admin(db, "claim_order", { order_id: r.id });
    assert.equal(uncertain.claimed, false);
    assert.equal(uncertain.order.status, "unknown");
    await assert.rejects(order(db, "pro"), /pendiente/);
    await assert.rejects(
      admin(db, "fail_order", { order_id: r.id, status: "rejected" }),
      /Consulta/,
    );
    await admin(db, "fail_order", {
      order_id: r.id,
      status: "rejected",
      reconciled: true,
      provider_result: { response_code: -1 },
    });
    assert.equal(
      (await admin(db, "claim_order", { order_id: r.id })).claimed,
      false,
      "No hay reintento inmediato",
    );
    await owner(db);
    await db.query(
      "update public.payment_orders set retry_at=now()-interval '1 second' where id=$1",
      [r.id],
    );
    await asUser(db);
    await db.query("select public.manage_subscription('cancel')");
    assert.equal(
      (await admin(db, "claim_order", { order_id: r.id })).claimed,
      false,
      "Cancelar desautoriza un reintento preparado",
    );
    assert.equal(await admin(db, "create_renewal", { user_id: A }), null);
    assert.equal(
      (await state(db)).effective_plan.id,
      "plus",
      "El fixture de período pagado no se borra al cancelar",
    );
  } finally {
    await db.close();
  }
});

test("Inscribir una tarjeta no activa el plan; separar integración y producción evita beneficios o promoción cruzados", async () => {
  const db = await setup();
  try {
    const e = await admin(db, "enroll_create", {
      user_id: A,
      plan_id: "plus",
      purpose: "checkout",
      recurring_consent: true,
    });
    const held = await admin(db, "enroll_start_claim", { enrollment_id: e.id });
    assert.equal(held.claimed, true);
    assert.equal(
      (await admin(db, "enroll_start_claim", { enrollment_id: e.id })).claimed,
      false,
    );
    assert.equal((await state(db)).pending_enrollment.id, e.id);
    await admin(db, "enroll_started", {
      enrollment_id: e.id,
      token: "inscription-token",
      url: "https://test.invalid",
    });
    assert.equal(
      (await admin(db, "enroll_claim", { enrollment_id: e.id })).claimed,
      true,
    );
    assert.equal(
      (await admin(db, "enroll_claim", { enrollment_id: e.id })).claimed,
      false,
    );
    await admin(db, "enroll_finish", {
      enrollment_id: e.id,
      tbk_user: "enrolled-ref",
      response_code: 0,
      card_type: "Visa",
      last4: "6623",
    });
    await admin(db, "enroll_finish", {
      enrollment_id: e.id,
      tbk_user: "different-ref",
      response_code: 0,
    });
    assert.equal(
      (await admin(db, "get_method", { user_id: A })).tbk_user,
      "enrolled-ref",
    );
    assert.equal((await state(db)).effective_plan.id, "free");
    const o = await order(db, "plus", "oneclick", A, {
      recurring_consent: true,
    });
    await start(db, o);
    await approve(db, o);
    assert.equal((await state(db)).promotion_available, false);
    await admin(db, "configure_environment", { environment: "production" });
    assert.equal((await state(db)).effective_plan.id, "free");
    assert.equal((await state(db)).promotion_available, true);
    await assert.rejects(
      admin(db, "get_order", { order_id: o.id }),
      /ambiente/,
    );
    await assert.rejects(
      admin(db, "get_order", { order_id: o.id, environment: "production" }),
      /otro ambiente/,
    );
    assert.equal(
      await admin(db, "get_method", { user_id: A, environment: "production" }),
      null,
    );
    const prod = await order(db, "pro", "webpay", A, {
      environment: "production",
    });
    assert.equal(prod.amount, 1990);
    assert.equal(prod.environment, "production");
    await assert.rejects(approve(db, prod), /ambiente/);
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
    const paid = await order(db);
    await start(db, paid);
    await approve(db, paid);
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
      "update public.subscription_periods set starts_at=now()-interval '2 months',ends_at=now()-interval '1 month' where user_id=$1",
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

test("Rechazos recurrentes tienen reintentos limitados; un cobro preparado comprueba de nuevo la autorización", async () => {
  const db = await setup();
  try {
    await method(db);
    const o = await order(db, "plus", "oneclick", A, {
      recurring_consent: true,
    });
    await start(db, o);
    await approve(db, o);
    await owner(db);
    await db.query(
      "update public.subscriptions set period_start=now()-interval '1 month',period_end=now()-interval '1 second' where user_id=$1",
      [A],
    );
    const r = await admin(db, "create_renewal", { user_id: A });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claim = await admin(db, "claim_order", { order_id: r.id });
      assert.equal(claim.claimed, true);
      assert.equal(claim.order.attempts, attempt);
      await admin(db, "charge_started", { order_id: r.id });
      await admin(db, "fail_order", {
        order_id: r.id,
        status: "rejected",
        provider_result: { response_code: -1 },
      });
      await owner(db);
      await db.query(
        "update public.payment_orders set retry_at=now()-interval '1 second' where id=$1",
        [r.id],
      );
    }
    assert.equal(
      (await admin(db, "claim_order", { order_id: r.id })).claimed,
      false,
    );
    assert.equal(
      await admin(db, "create_renewal", { user_id: A }),
      null,
      "Los reintentos agotados detienen la autorización del ciclo",
    );
    const exhausted = await state(db);
    assert.equal(exhausted.subscription.auto_renew, false);
    assert.equal(exhausted.subscription.status, "past_due");
    const manual = await order(db, "plus", "webpay");
    assert.equal(manual.amount, 2750);
    assert.equal(manual.promo_applied, false);
    await owner(db);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from private.payment_attempts where order_id=$1",
          [r.id],
        )
      ).rows[0].n,
      3,
    );
    assert.equal(
      (
        await db.query(
          "select count(distinct buy_order)::integer n from private.payment_attempts where order_id=$1",
          [r.id],
        )
      ).rows[0].n,
      3,
      "Cada intento confirmado usa referencia persistente diferente",
    );
    await method(db, B);
    const b = await order(db, "pro", "oneclick", B, {
      recurring_consent: true,
    });
    await start(db, b);
    await approve(db, b);
    await owner(db);
    await db.query(
      "update public.subscriptions set period_start=now()-interval '1 month',period_end=now()-interval '1 second' where user_id=$1",
      [B],
    );
    const pending = await admin(db, "create_renewal", { user_id: B });
    assert.equal(
      (await admin(db, "claim_order", { order_id: pending.id })).claimed,
      true,
    );
    await asUser(db, B);
    await db.query("select public.manage_subscription('cancel')");
    assert.equal(
      (await admin(db, "charge_started", { order_id: pending.id })).status,
      "cancelled",
    );
  } finally {
    await db.close();
  }
});

test("Webpay: crear, retornar y verificar usan el mismo token; cancelar o abandonar no activa ni consume la promoción", async () => {
  const db = await setup();
  try {
    const o = await order(db);
    assert.equal(
      (await admin(db, "claim_order", { order_id: o.id })).claimed,
      true,
    );
    await admin(db, "provider_started", {
      order_id: o.id,
      token: "same-opaque-token",
      url: "https://test.invalid",
    });
    assert.equal(
      (await admin(db, "get_order", { provider_token: "same-opaque-token" }))
        .id,
      o.id,
    );
    assert.equal(
      await admin(db, "get_order", { buy_order: o.buy_order, session_id: B }),
      null,
    );
    assert.equal(
      (
        await admin(db, "get_order", {
          buy_order: o.buy_order,
          session_id: o.session_id,
        })
      ).id,
      o.id,
    );
    assert.equal((await admin(db, "renewal_due")).webpay_pending.length, 1);
    const commit = await admin(db, "claim_order", { order_id: o.id });
    assert.equal(commit.claimed, true);
    await admin(db, "charge_started", { order_id: o.id });
    await approve(db, o);
    assert.equal((await state(db)).effective_plan.id, "plus");
    const b = await order(db, "pro", "webpay", B);
    await admin(db, "provider_started", {
      order_id: b.id,
      token: "cancel-opaque-token",
      url: "https://test.invalid",
    });
    await admin(db, "fail_order", { order_id: b.id, status: "cancelled" });
    await assert.rejects(approve(db, b), /no coincide/);
    assert.equal((await state(db, B)).promotion_available, true);
    assert.equal((await state(db, B)).effective_plan.id, "free");
    const abandoned = await order(db, "pro", "webpay", B);
    await admin(db, "fail_order", {
      order_id: abandoned.id,
      status: "abandoned",
    });
    assert.equal((await state(db, B)).promotion_available, true);
  } finally {
    await db.close();
  }
});

test("Renovación tardía concede un mes completo, no recupera meses pasados; reanudar requiere consentimiento nuevo y deja auditoría", async () => {
  const db = await setup();
  try {
    await method(db);
    const first = await order(db, "plus", "oneclick", A, {
      recurring_consent: true,
    });
    await start(db, first);
    await approve(db, first);
    await asUser(db);
    await db.query("select public.manage_subscription('cancel')");
    await assert.rejects(
      db.query("select public.manage_subscription('resume')"),
      /Acepta expresamente/,
    );
    await db.query("select public.manage_subscription('resume',null,true)");
    assert.equal((await state(db)).subscription.auto_renew, true);
    await assert.rejects(
      db.query("select * from private.billing_consent_events"),
      /permission denied/,
    );
    await owner(db);
    const events = (
      await db.query(
        "select event,accepted from private.billing_consent_events where user_id=$1 order by id",
        [A],
      )
    ).rows;
    assert.equal(
      events.filter((e) => e.event === "cancel" && !e.accepted).length,
      1,
    );
    assert.equal(
      events.filter((e) => e.event === "resume" && e.accepted).length,
      1,
    );
    await db.query(
      "update public.subscriptions set period_start=now()-interval '1 month',period_end=now()-interval '24 hours' where user_id=$1",
      [A],
    );
    const late = await admin(db, "create_renewal", { user_id: A });
    assert.ok(
      new Date(late.period_start) > new Date(late.renewal_cycle_end),
      "Un período vencido no comienza en el pasado",
    );
    assert.equal(
      (await admin(db, "create_renewal", { user_id: A })).id,
      late.id,
    );
    await start(db, late);
    await owner(db);
    await db.query(
      "update public.payment_orders set period_start=now()-interval '5 days',period_end=now()+interval '1 day' where id=$1",
      [late.id],
    );
    await approve(db, late);
    assert.ok(Date.now() - new Date(late.period_start).getTime() < 1000);
    assert.ok(
      new Date(late.period_end) - new Date(late.period_start) >= 28 * 86400000,
    );
    assert.equal((await state(db)).effective_plan.id, "plus");
    await method(db, B);
    const b = await order(db, "pro", "oneclick", B, {
      recurring_consent: true,
    });
    await start(db, b);
    await approve(db, b);
    await owner(db);
    await db.query(
      "update public.subscriptions set period_start=now()-interval '7 months',period_end=now()-interval '6 months' where user_id=$1",
      [B],
    );
    const due = await admin(db, "renewal_due");
    assert.equal(due.users.includes(B), false);
    assert.equal(await admin(db, "create_renewal", { user_id: B }), null);
    const stale = await state(db, B);
    assert.equal(stale.subscription.auto_renew, false);
    assert.equal(stale.subscription.status, "past_due");
    await owner(db);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from public.payment_orders where user_id=$1 and renewal",
          [B],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from private.billing_consent_events where user_id=$1 and event='renewal_grace_expired'",
          [B],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("Carreras de autorización: cambiar plan tras claim evita el cargo antiguo; revocar durante el pago conserva acceso sin renovar", async () => {
  const db = await setup();
  try {
    await method(db);
    const initial = await order(db, "plus", "oneclick", A, {
      recurring_consent: true,
    });
    await start(db, initial);
    await admin(db, "remove_method", { user_id: A });
    await approve(db, initial);
    const revoked = await state(db);
    assert.equal(
      revoked.effective_plan.id,
      "plus",
      "Un pago validado conserva el período contratado",
    );
    assert.equal(revoked.subscription.auto_renew, false);
    assert.equal(revoked.subscription.cancel_at_period_end, true);
    assert.equal(
      revoked.promotion_available,
      false,
      "La aprobación real consume la promoción aunque se hayan cancelado futuros cobros",
    );
    await method(db, B);
    const original = await order(db, "plus", "oneclick", B, {
      recurring_consent: true,
    });
    await start(db, original);
    await approve(db, original);
    await owner(db);
    await db.query(
      "update public.subscriptions set period_start=now()-interval '1 month',period_end=now()-interval '1 second' where user_id=$1",
      [B],
    );
    const renewal = await admin(db, "create_renewal", { user_id: B });
    assert.equal(
      (await admin(db, "claim_order", { order_id: renewal.id })).claimed,
      true,
    );
    await asUser(db, B);
    await db.query("select public.manage_subscription('change_plan','pro')");
    const stale = await admin(db, "charge_started", { order_id: renewal.id });
    assert.equal(stale.status, "cancelled");
    assert.equal(stale.charge_started_at, null);
    const cancelledCycle = await state(db, B);
    assert.equal(cancelledCycle.subscription.auto_renew, false);
    assert.equal(cancelledCycle.subscription.status, "past_due");
    const manual = await order(db, "pro", "webpay", B);
    assert.equal(manual.amount, 4990, "El plan nuevo se renueva manualmente al precio regular");
    assert.equal(manual.promo_applied, false);
    await owner(db);
    assert.equal(
      (
        await db.query(
          "select next_plan_id from public.subscriptions where user_id=$1",
          [B],
        )
      ).rows[0].next_plan_id,
      "pro",
    );
  } finally {
    await db.close();
  }
});

test("Crear el formulario fallido sin referencia no bloquea nuevos pagos; una referencia ya persistida se conserva", async () => {
  const db = await setup();
  try {
    const failed = await order(db);
    await admin(db, "claim_order", { order_id: failed.id });
    assert.equal(
      (await admin(db, "initial_creation_failed", { order_id: failed.id }))
        .status,
      "abandoned",
    );
    assert.equal((await state(db)).promotion_available, true);
    const retry = await order(db);
    assert.notEqual(retry.id, failed.id);
    await admin(db, "claim_order", { order_id: retry.id });
    await admin(db, "provider_started", {
      order_id: retry.id,
      token: "persisted-form-token",
      url: "https://test.invalid",
    });
    assert.equal(
      (await admin(db, "initial_creation_failed", { order_id: retry.id }))
        .status,
      "pending",
    );
    assert.equal(
      (await admin(db, "get_order", { order_id: retry.id })).provider_token,
      "persisted-form-token",
    );
    const e = await admin(db, "enroll_create", {
      user_id: B,
      plan_id: "plus",
      purpose: "checkout",
      recurring_consent: true,
    });
    await admin(db, "enroll_start_claim", { enrollment_id: e.id });
    assert.equal(
      (await admin(db, "enroll_start_failed", { enrollment_id: e.id })).status,
      "cancelled",
    );
    const e2 = await admin(db, "enroll_create", {
      user_id: B,
      plan_id: "plus",
      purpose: "checkout",
      recurring_consent: true,
    });
    assert.notEqual(e2.id, e.id);
    await admin(db, "enroll_start_claim", { enrollment_id: e2.id });
    await admin(db, "enroll_started", {
      enrollment_id: e2.id,
      token: "persisted-enrollment-token",
      url: "https://test.invalid",
    });
    assert.equal(
      (await admin(db, "enroll_start_failed", { enrollment_id: e2.id })).status,
      "pending",
    );
  } finally {
    await db.close();
  }
});
