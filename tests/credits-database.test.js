import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  C = "33333333-3333-4333-8333-333333333333";
async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
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
    "insert into auth.users(id,email) values($1,'a@example.invalid'),($2,'b@example.invalid'),($3,'c@example.invalid')",
    [A, B, C],
  );
  return db;
}
const owner = (db) => db.exec("reset role");
const service = (db) => db.exec("reset role; set role service_role");
const user = (db, id) =>
  db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`,
  );
const one = async (db, sql, args = []) =>
  (await db.query(sql, args)).rows[0]?.result;
async function monetization(db, id = A) {
  await user(db, id);
  return one(db, "select public.monetization_state() result");
}
async function enqueue(db, id = A, kind = "generation") {
  await service(db);
  return one(
    db,
    "select public.enqueue_ai_job($1,$2,$3,$4::jsonb,'{}'::jsonb) result",
    [id, randomUUID(), kind, JSON.stringify({ idea: randomUUID() })],
  );
}
async function finish(db, job, ok = true) {
  await service(db);
  const claimed = await one(db, "select public.claim_ai_job() result");
  assert.equal(claimed.id, job.id);
  await one(
    db,
    "select public.finish_ai_job($1,$2,$3::jsonb,$4,false) result",
    [
      claimed.id,
      claimed.lease_token,
      ok ? JSON.stringify({ proposal: {} }) : null,
      ok ? null : "fallo",
    ],
  );
}
async function subscribe(db, id, product, token, extra = {}) {
  await service(db);
  return one(
    db,
    "select public.play_apply_subscription($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb) result",
    [
      id,
      token,
      product,
      extra.state || "SUBSCRIPTION_STATE_ACTIVE",
      extra.expiry || new Date(Date.now() + 30 * 86400000).toISOString(),
      true,
      extra.order || "GPA.1",
      extra.linked || null,
      false,
    ],
  );
}

test("Cuentas nuevas reciben 60 créditos; cada uso de IA cuesta 20 y se devuelve si la IA no entrega nada", async (t) => {
  const db = await setup(t);
  await db.exec("update private.ai_queue_settings set daily_limit=20");
  let state = await monetization(db);
  assert.equal(state.credits.balance, 60);
  assert.equal(state.credits.cost_per_use, 20);
  assert.equal(state.plan.id, "free");
  assert.equal(state.recent[0].reason, "welcome");

  const first = await enqueue(db);
  assert.equal((await monetization(db)).credits.balance, 40);
  await finish(db, first, false);
  assert.equal(
    (await monetization(db)).credits.balance,
    60,
    "Un error devuelve los créditos",
  );

  const cancelled = await enqueue(db);
  await user(db, A);
  await one(db, "select public.cancel_ai_job($1) result", [cancelled.id]);
  assert.equal(
    (await monetization(db)).credits.balance,
    60,
    "Cancelar antes de empezar devuelve los créditos",
  );
  await owner(db);
  await db.query(
    "update public.ai_jobs set status='error' where id=$1",
    [cancelled.id],
  );
  assert.equal((await monetization(db)).credits.balance, 60);

  for (let i = 0; i < 3; i++) await finish(db, await enqueue(db, A, "adjustment"));
  state = await monetization(db);
  assert.equal(state.credits.balance, 0);
  await assert.rejects(() => enqueue(db), /créditos suficientes/);
  await owner(db);
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.ai_jobs where user_id=$1 and status='queued'",
        [A],
      )
    ).rows[0].n,
    0,
    "Rechazar por créditos no deja una solicitud a medias",
  );
});

test("Plus y Pro dan créditos mensuales que se gastan primero y no se acumulan ni se reinician al cambiar de plan", async (t) => {
  const db = await setup(t);
  await db.exec("update private.ai_queue_settings set daily_limit=200");
  await subscribe(db, A, "planifia_plus", "token-plus-0001");
  let state = await monetization(db);
  assert.equal(state.plan.id, "plus");
  assert.equal(state.credits.plan_available, 1000);
  assert.equal(state.credits.bonus, 60);
  assert.equal(state.credits.balance, 1060);
  assert.equal(state.play_subscription.active, true);

  await finish(db, await enqueue(db));
  state = await monetization(db);
  assert.equal(state.credits.plan_available, 980);
  assert.equal(state.credits.bonus, 60, "Los créditos del plan se gastan primero");

  // Cambiar a Pro (token enlazado) no regala una ventana nueva.
  await subscribe(db, A, "planifia_pro", "token-pro-00001", {
    linked: "token-plus-0001",
  });
  state = await monetization(db);
  assert.equal(state.plan.id, "pro");
  assert.equal(state.credits.plan_available, 2480);
  await subscribe(db, A, "planifia_plus", "token-plus-0002", {
    linked: "token-pro-00001",
  });
  state = await monetization(db);
  assert.equal(state.plan.id, "plus");
  assert.equal(state.credits.plan_available, 980);

  // Al mes siguiente la ventana se renueva y lo no usado no se acumula.
  await owner(db);
  await db.query(
    "update private.credit_accounts set window_start=now()-interval '1 month 1 day' where user_id=$1",
    [A],
  );
  state = await monetization(db);
  assert.equal(state.credits.plan_available, 1000);
  await finish(db, await enqueue(db));
  assert.equal((await monetization(db)).credits.plan_available, 980);

  // Vencido o suspendido: quedan sólo los créditos que no vencen.
  await subscribe(db, A, "planifia_plus", "token-plus-0002", {
    state: "SUBSCRIPTION_STATE_ON_HOLD",
  });
  state = await monetization(db);
  assert.equal(state.plan.id, "free");
  assert.equal(state.credits.plan_available, 0);
  assert.equal(state.credits.balance, 60);

  await assert.rejects(
    () => subscribe(db, B, "planifia_plus", "token-plus-0002"),
    /otra cuenta/,
  );
  await assert.rejects(
    () => subscribe(db, A, "creditos_100", "token-wrong-001"),
    /desconocido/,
  );
});

test("Paquetes de créditos se acreditan una vez y un reembolso los descuenta sin saldo negativo", async (t) => {
  const db = await setup(t);
  await service(db);
  const grant = (id, token = "pack-token-0001", product = "creditos_300") =>
    one(
      db,
      "select public.play_grant_credits($1,$2,$3,'GPA.9',false) result",
      [id, token, product],
    );
  assert.deepEqual(await grant(A), { granted: true, credits: 300 });
  assert.deepEqual(await grant(A), { granted: false, credits: 300 });
  await assert.rejects(() => grant(B), /otra cuenta/);
  await assert.rejects(
    () => grant(A, "pack-token-0002", "planifia_plus"),
    /desconocido/,
  );
  assert.equal((await monetization(db)).credits.balance, 360);
  await owner(db);
  await db.query("update private.credit_accounts set bonus=100 where user_id=$1", [A]);
  await service(db);
  assert.equal(
    await one(db, "select public.play_revoke_credits('pack-token-0001') result"),
    true,
  );
  assert.equal(
    await one(db, "select public.play_revoke_credits('pack-token-0001') result"),
    false,
  );
  assert.equal((await monetization(db)).credits.balance, 0);
  await service(db);
  assert.equal(
    await one(db, "select public.play_token_owner('pack-token-0001') result"),
    A,
  );
});

test("Quitar anuncios: compra única por cuenta, se restaura sin duplicar y un reembolso la anula", async (t) => {
  const db = await setup(t);
  assert.equal((await monetization(db)).ad_free, false);
  await service(db);
  const grant = (id, token = "noads-token-0001", product = "sin_anuncios") =>
    one(db, "select public.play_grant_ad_free($1,$2,$3,'GPA.7',false) result", [id, token, product]);
  assert.deepEqual(await grant(A), { granted: true, ad_free: true });
  assert.deepEqual(await grant(A), { granted: false, ad_free: true }, "Restaurar no duplica");
  await assert.rejects(() => grant(B), /otra cuenta/);
  await assert.rejects(() => grant(A, "noads-token-0002", "creditos_100"), /desconocido/);
  const state = await monetization(db);
  assert.equal(state.ad_free, true);
  assert.equal(state.plan.id, "free", "No cambia el plan ni da créditos");
  assert.equal(state.credits.balance, 60);
  assert.ok(state.products.some((p) => p.product_id === "sin_anuncios" && p.kind === "ad_free"));
  assert.equal((await monetization(db, B)).ad_free, false);
  await service(db);
  assert.equal(await one(db, "select public.play_token_owner('noads-token-0001') result"), A);
  assert.equal(await one(db, "select public.play_revoke_ad_free('noads-token-0001') result"), true);
  assert.equal(await one(db, "select public.play_revoke_ad_free('noads-token-0001') result"), false);
  assert.equal((await monetization(db)).ad_free, false);
});

test("Anuncios recompensados dan 10 créditos, una vez por transacción y hasta 5 por día", async (t) => {
  const db = await setup(t);
  await service(db);
  const reward = (tx, id = A) =>
    one(db, "select public.admob_reward($1,$2) result", [id, tx]);
  assert.deepEqual(await reward("tx-1"), { granted: true, credits: 10 });
  assert.equal((await reward("tx-1")).reason, "duplicate");
  for (let i = 2; i <= 5; i++) assert.equal((await reward("tx-" + i)).granted, true);
  assert.equal((await reward("tx-6")).reason, "daily_limit");
  assert.equal(
    (await reward("tx-x", "44444444-4444-4444-8444-444444444444")).reason,
    "unknown_user",
  );
  const state = await monetization(db);
  assert.equal(state.credits.balance, 110);
  assert.equal(state.ads.today, 5);
  assert.equal(state.ads.daily_limit, 5);
});

test("Invitaciones: 40 a quien invita y 20 a quien llega, al confirmar correo y usar la IA, con tope mensual", async (t) => {
  const db = await setup(t);
  await db.exec("update private.ai_queue_settings set daily_limit=20");
  const code = (await monetization(db, A)).referral.code;
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.equal((await monetization(db, A)).referral.code, code, "El código es estable");

  await user(db, A);
  await assert.rejects(
    () => one(db, "select public.redeem_referral($1) result", [code]),
    /propio código/,
  );
  await owner(db);
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [B]);
  await user(db, B);
  await assert.rejects(
    () => one(db, "select public.redeem_referral('ZZZZZZZZ') result"),
    /No encontramos/,
  );
  assert.equal(
    (await one(db, "select public.redeem_referral($1) result", [code.toLowerCase()])).ok,
    true,
  );
  await assert.rejects(
    () => one(db, "select public.redeem_referral($1) result", [code]),
    /Ya usaste/,
  );
  await finish(db, await enqueue(db, B));
  assert.equal(
    (await monetization(db, A)).credits.balance,
    60,
    "Sin correo confirmado no hay recompensa",
  );
  await owner(db);
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [B]);
  await finish(db, await enqueue(db, B));
  assert.equal((await monetization(db, A)).credits.balance, 100);
  assert.equal((await monetization(db, B)).credits.balance, 40);
  assert.equal((await monetization(db, A)).referral.rewarded_this_month, 1);

  // Quien ya usó la IA o tiene una cuenta antigua no puede canjear.
  await finish(db, await enqueue(db, A));
  await user(db, A);
  const codeB = (await monetization(db, B)).referral.code;
  await user(db, A);
  await assert.rejects(
    () => one(db, "select public.redeem_referral($1) result", [codeB]),
    /primera solicitud/,
  );
  await owner(db);
  await db.query("update auth.users set created_at=now()-interval '30 days' where id=$1", [C]);
  await user(db, C);
  await assert.rejects(
    () => one(db, "select public.redeem_referral($1) result", [code]),
    /primeros 14 días/,
  );

  // Tope mensual: quien llega recibe sus 20, quien invita ya no suma.
  await owner(db);
  await db.query("update private.credit_settings set referral_monthly_limit=1");
  await db.query("update auth.users set created_at=now() where id=$1", [C]);
  await user(db, C);
  await one(db, "select public.redeem_referral($1) result", [code]);
  await finish(db, await enqueue(db, C));
  assert.equal((await monetization(db, C)).credits.balance, 60);
  assert.equal((await monetization(db, A)).credits.balance, 80);
});

test("El navegador no puede acreditar compras, anuncios ni leer tablas privadas", async (t) => {
  const db = await setup(t);
  await user(db, A);
  for (const sql of [
    "select public.admob_reward('11111111-1111-4111-8111-111111111111','x')",
    "select public.play_grant_credits('11111111-1111-4111-8111-111111111111','pack-token-0001','creditos_100',null,false)",
    "select public.play_apply_subscription('11111111-1111-4111-8111-111111111111','token-plus-0001','planifia_plus','SUBSCRIPTION_STATE_ACTIVE',now()+interval '1 day',true,null,null,false,'{}')",
    "select public.play_revoke_credits('x')",
    "select public.play_grant_ad_free('11111111-1111-4111-8111-111111111111','noads-token-0001','sin_anuncios',null,false)",
    "select public.play_revoke_ad_free('x')",
    "select * from private.play_ad_free_purchases",
    "select public.enqueue_ai_job('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'generation','{}','{}')",
    "select * from private.credit_accounts",
    "select * from private.play_subscriptions",
    "select private.add_bonus('11111111-1111-4111-8111-111111111111',100,'admin','x')",
  ])
    await assert.rejects(() => db.query(sql), /permission denied/, sql);
  await user(db, A);
  assert.equal(
    (await db.query("select monthly_credits from public.plan_catalog where id='pro'"))
      .rows[0].monthly_credits,
    2500,
  );
});
