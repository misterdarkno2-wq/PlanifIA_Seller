import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  for (const name of [
    "202610030001_goals.sql",
    "202610030002_plans_import.sql",
    "202610030003_manual_actions.sql",
    "202610040001_billing.sql",
    "202610040002_closed_renewals.sql",
    "202610040003_welcome_campaign.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  await db.query(
    "insert into auth.users(id,email) values($1,'a@example.invalid'),($2,'b@example.invalid')",
    [A, B],
  );
  return db;
}
const owner = (db) => db.exec("reset role");
const asUser = (db, id = A) =>
  db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
async function admin(db, action, payload = {}) {
  await db.exec("reset role;set role service_role");
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
async function quote(db, plan = "plus", user = A, extra = {}) {
  return admin(db, "quote", {
    user_id: user,
    plan_id: plan,
    channel: "webpay",
    ...extra,
  });
}
async function order(db, plan = "plus", user = A, extra = {}) {
  return admin(db, "create_order", {
    user_id: user,
    plan_id: plan,
    channel: "webpay",
    request_id: randomUUID(),
    ...extra,
  });
}
async function approve(db, o) {
  const claim = await admin(db, "claim_order", {
    order_id: o.id,
    environment: o.environment,
  });
  assert.equal(claim.claimed, true);
  Object.assign(o, claim.order);
  await admin(db, "charge_started", {
    order_id: o.id,
    environment: o.environment,
  });
  return admin(db, "confirm_order", {
    order_id: o.id,
    environment: o.environment,
    provider_result: {
      approved: true,
      amount: o.amount,
      buy_order: o.buy_order,
      session_id: o.session_id,
      response_code: 0,
    },
  });
}
async function closeCampaign(db) {
  await owner(db);
  await db.exec(
    "update private.billing_campaign set starts_at=now()-interval '8 days',ends_at=now()-interval '1 day' where id='welcome'",
  );
}
async function openCampaign(db) {
  await owner(db);
  await db.exec(
    "update private.billing_campaign set starts_at=now()-interval '1 hour',ends_at=now()+interval '7 days',enabled=true where id='welcome'",
  );
}
async function finishEnrollment(db, e) {
  await admin(db, "enroll_start_claim", { enrollment_id: e.id });
  await admin(db, "enroll_started", {
    enrollment_id: e.id,
    token: "token-" + e.id,
    url: "https://test.invalid",
  });
  await admin(db, "enroll_claim", { enrollment_id: e.id });
  return admin(db, "enroll_finish", {
    enrollment_id: e.id,
    response_code: 0,
    tbk_user: "private-card-ref",
    card_type: "Visa",
    last4: "6623",
  });
}

test("Campaña pública: siete días persistentes y reloj del servidor, sin acceso a configuración o núcleos privados", async () => {
  const db = await setup();
  try {
    await db.exec("set role anon");
    const first = (await db.query("select public.billing_promotion() result"))
      .rows[0].result;
    assert.equal(first.active, true);
    assert.equal(
      new Date(first.ends_at) - new Date(first.starts_at),
      7 * 86400000,
    );
    assert.ok(Math.abs(Date.now() - new Date(first.server_now)) < 5000);
    for (const sql of [
      "select * from private.billing_campaign",
      "update private.billing_campaign set enabled=false",
      "select private.billing_admin_base('create_order','{}')",
      "select private.billing_state_base()",
      "select public.billing_admin('create_order','{}')",
    ])
      await assert.rejects(db.query(sql), /permission denied/);
    await owner(db);
    await db.exec(
      "insert into private.billing_campaign(id,starts_at,ends_at) values('welcome',now(),now()+interval '7 days') on conflict(id) do nothing",
    );
    const unchanged = (
      await db.query("select public.billing_promotion() result")
    ).rows[0].result;
    assert.equal(unchanged.starts_at, first.starts_at);
    assert.equal(unchanged.ends_at, first.ends_at);
    await db.exec("set role service_role");
    await assert.rejects(
      db.query("select private.billing_admin_base('create_order','{}')"),
      /permission denied/,
    );
    assert.equal((await state(db)).promotion_available, true);
  } finally {
    await db.close();
  }
});

test("Antes del inicio o después del cierre sólo se cobra precio regular; expected_amount evita efectos y el primer pago agota bienvenida", async () => {
  const db = await setup();
  try {
    await owner(db);
    await db.exec(
      "update private.billing_campaign set starts_at=now()+interval '1 day',ends_at=now()+interval '8 days'",
    );
    assert.equal((await state(db)).promotion_available, false);
    const regular = await quote(db);
    assert.equal(regular.amount_clp, 2750);
    assert.equal(regular.promotion_applied, false);
    await assert.rejects(
      order(db, "plus", A, { expected_amount_clp: 990 }),
      /El precio cambió/,
    );
    await assert.rejects(
      admin(db, "enroll_create", {
        user_id: A,
        plan_id: "plus",
        purpose: "checkout",
        recurring_consent: true,
        expected_amount_clp: 990,
      }),
      /El precio cambió/,
    );
    await owner(db);
    assert.equal(
      (await db.query("select count(*)::integer n from public.payment_orders"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from private.billing_enrollments",
        )
      ).rows[0].n,
      0,
    );
    const o = await order(db, "plus", A, { expected_amount_clp: 2750 });
    assert.equal(o.amount, 2750);
    assert.equal(o.promo_applied, false);
    await openCampaign(db);
    assert.equal(
      (await quote(db)).amount_clp,
      2750,
      "Una orden regular ya abierta tampoco se cambia al iniciar la campaña",
    );
    await approve(db, o);
    assert.equal((await state(db)).promotion_available, false);
    assert.equal(
      (await quote(db)).amount_clp,
      2750,
      "Una segunda compra no usa bienvenida tras el primer pago regular",
    );
    await closeCampaign(db);
    const pro = await quote(db, "pro", B);
    assert.equal(pro.amount_clp, 4990);
    assert.equal(pro.promotion_applied, false);
    await owner(db);
    await db.exec(
      "update private.billing_campaign set ends_at=now(),starts_at=now()-interval '7 days'",
    );
    assert.equal(
      (await db.query("select public.billing_promotion() result")).rows[0]
        .result.active,
      false,
      "El instante final es exclusivo",
    );
  } finally {
    await db.close();
  }
});

test("Reservas Webpay fijan 990/1990 antes del cierre y se confirman después, sin nueva promoción ni cambios de importe", async () => {
  const db = await setup();
  try {
    assert.equal((await quote(db)).amount_clp, 990);
    assert.equal((await quote(db, "pro", B)).amount_clp, 1990);
    await assert.rejects(
      order(db, "plus", A, { expected_amount_clp: 2750 }),
      /El precio cambió/,
    );
    await assert.rejects(
      order(db, "plus", A, { expected_amount_clp: "990" }),
      /El precio cambió/,
    );
    const request = randomUUID(),
      o = await order(db, "plus", A, {
        request_id: request,
        expected_amount_clp: 990,
      });
    const pro = await order(db, "pro", B, { expected_amount_clp: 1990 });
    await closeCampaign(db);
    assert.equal((await state(db)).promotion_available, false);
    assert.equal((await quote(db)).amount_clp, 990);
    const repeated = await order(db, "plus", A, {
      request_id: request,
      expected_amount_clp: 990,
    });
    assert.equal(repeated.id, o.id);
    assert.equal((await approve(db, o)).amount, 990);
    await approve(db, pro);
    await openCampaign(db);
    assert.equal((await state(db)).promotion_available, false);
    assert.equal((await quote(db)).amount_clp, 2750);
    assert.equal((await quote(db, "pro", B)).amount_clp, 4990);
    await owner(db);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from public.subscription_periods",
        )
      ).rows[0].n,
      2,
    );
  } finally {
    await db.close();
  }
});

test("Oneclick congela el importe autorizado al inscribir y honra el descuento aunque cierre la campaña", async () => {
  const db = await setup();
  try {
    const e = await admin(db, "enroll_create", {
      user_id: A,
      plan_id: "plus",
      purpose: "checkout",
      recurring_consent: true,
      expected_amount_clp: 990,
    });
    assert.equal(e.amount_clp, 990);
    assert.equal(e.promo_applied, true);
    await closeCampaign(db);
    const repeated = await admin(db, "enroll_create", {
      user_id: A,
      plan_id: "plus",
      purpose: "checkout",
      recurring_consent: true,
      expected_amount_clp: 990,
    });
    assert.equal(repeated.id, e.id);
    assert.equal(repeated.amount_clp, 990);
    assert.equal(
      (await quote(db, "plus", A, { channel: "oneclick" })).amount_clp,
      990,
      "Una inscripción aún abierta conserva su cotización",
    );
    await finishEnrollment(db, e);
    assert.equal((await state(db)).effective_plan.id, "free");
    assert.equal(
      (await quote(db, "plus", A, { channel: "oneclick" })).amount_clp,
      2750,
      "Una revisión nueva no cotiza la inscripción ya terminada",
    );
    const o = await order(db, "plus", A, {
      channel: "oneclick",
      request_id: e.id,
      recurring_consent: true,
      expected_amount_clp: 990,
    });
    assert.equal(o.amount, 990);
    assert.equal(o.promo_applied, true);
    await approve(db, o);
    assert.equal((await state(db)).effective_plan.id, "plus");
    await openCampaign(db);
    assert.equal((await state(db)).promotion_available, false);
    const production = await admin(db, "configure_environment", {
      environment: "production",
    });
    assert.equal(production.environment, "production");
    assert.equal(
      (await state(db)).promotion_available,
      true,
      "La elegibilidad se conserva separada por ambiente",
    );
    const fresh = await order(db, "pro", A, {
      environment: "production",
      expected_amount_clp: 1990,
    });
    assert.equal(fresh.amount, 1990);
  } finally {
    await db.close();
  }
});

test("Una bienvenida congelada en tarjeta no se aplica por segunda vez si otro pago la consumió; fallos no consumen el derecho", async () => {
  const db = await setup();
  try {
    const e = await admin(db, "enroll_create", {
      user_id: A,
      plan_id: "plus",
      purpose: "checkout",
      recurring_consent: true,
      expected_amount_clp: 990,
    });
    await finishEnrollment(db, e);
    const webpay = await order(db, "pro", A, { expected_amount_clp: 1990 });
    await approve(db, webpay);
    await closeCampaign(db);
    await assert.rejects(
      order(db, "plus", A, {
        channel: "oneclick",
        request_id: e.id,
        recurring_consent: true,
        expected_amount_clp: 990,
      }),
      /ya se aplicó/,
    );
    await owner(db);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from public.payment_orders where user_id=$1",
          [A],
        )
      ).rows[0].n,
      1,
    );
    await openCampaign(db);
    const failed = await order(db, "plus", B, { expected_amount_clp: 990 });
    await admin(db, "fail_order", {
      order_id: failed.id,
      status: "rejected",
      provider_result: { response_code: -1 },
    });
    assert.equal((await state(db, B)).promotion_available, true);
    await closeCampaign(db);
    assert.equal((await quote(db, "plus", B)).amount_clp, 2750);
    await openCampaign(db);
    assert.equal((await quote(db, "plus", B)).amount_clp, 990);
  } finally {
    await db.close();
  }
});

test("Inscripción regular queda congelada aunque abra la campaña y sus renovaciones no reciben una bienvenida tardía", async () => {
  const db = await setup();
  try {
    await closeCampaign(db);
    const e = await admin(db, "enroll_create", {
      user_id: A,
      plan_id: "pro",
      purpose: "checkout",
      recurring_consent: true,
      expected_amount_clp: 4990,
    });
    assert.equal(e.amount_clp, 4990);
    assert.equal(e.promo_applied, false);
    await finishEnrollment(db, e);
    await openCampaign(db);
    const o = await order(db, "pro", A, {
      channel: "oneclick",
      request_id: e.id,
      recurring_consent: true,
      expected_amount_clp: 4990,
    });
    assert.equal(o.amount, 4990);
    assert.equal(o.promo_applied, false);
    await approve(db, o);
    assert.equal((await state(db)).promotion_available, false);
    await owner(db);
    const account = (
      await db.query(
        "select first_paid_at,promotion_used_at from private.billing_accounts where user_id=$1 and environment='integration'",
        [A],
      )
    ).rows[0];
    assert.ok(account.first_paid_at);
    assert.equal(
      account.promotion_used_at,
      null,
      "No se registra un descuento inexistente",
    );
    await db.query(
      "update public.subscriptions set period_start=now()-interval '1 month',period_end=now()-interval '1 second' where user_id=$1",
      [A],
    );
    const renewal = await admin(db, "create_renewal", { user_id: A });
    assert.equal(renewal.amount, 4990);
    assert.equal(renewal.promo_applied, false);
  } finally {
    await db.close();
  }
});
