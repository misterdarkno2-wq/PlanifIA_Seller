import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { validateProposal } from "../supabase/functions/_shared/plan.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

// Run the shipped SQL, including permissions, rather than a mock of the RPCs.
async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb default '{}',
      email_confirmed_at timestamptz default now(), created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
  `);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  }
  await db.query("insert into auth.users(id,email) values($1,'a@example.invalid'),($2,'b@example.invalid')", [A, B]);
  return db;
}
const owner = (db) => db.exec("reset role");
const service = (db) => db.exec("reset role; set role service_role");
const user = (db, id = A) =>
  db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`);
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
async function state(db, id = A) {
  await user(db, id);
  return one(db, "select public.monetization_state() result");
}
async function beginChat(db, id = A, text = "Hola", request = randomUUID()) {
  await service(db);
  await one(db, "select public.lumi_chat_begin($1,$2,$3) result", [id, request, text]);
  return request;
}
async function finishChat(db, request, id = A, text = "Hola", reply = "Seguimos paso a paso.") {
  await service(db);
  return one(db, "select public.lumi_chat_finish($1,$2,$3,$4) result", [id, request, text, reply]);
}

test("Borrar conversación en otro dispositivo impide que una respuesta en vuelo restaure los mensajes borrados", async (t) => {
  const db = await setup(t);
  const old = await beginChat(db);
  await finishChat(db, old);
  const otherAccount = await beginChat(db, B, "Mensaje de B");
  await finishChat(db, otherAccount, B, "Mensaje de B");
  const pending = await beginChat(db, A, "Mensaje que está esperando respuesta");

  // First device waits for the provider; the second clears the same account.
  await user(db);
  assert.equal(await one(db, "select public.lumi_chat_clear() result"), 2);
  assert.equal((await db.query("select count(*)::int n from public.lumi_chat_messages")).rows[0].n, 0);
  assert.equal((await state(db, B)).credits.balance, 55);
  await user(db, B);
  assert.equal((await db.query("select count(*)::int n from public.lumi_chat_messages")).rows[0].n, 2);

  // Deliver the provider result after clear, without any timing-dependent wait.
  try {
    await finishChat(db, pending, A, "Mensaje que está esperando respuesta");
  } catch (error) {
    assert.match(error.message, /ya no está disponible/, "A cancelled response may be rejected");
  }
  await user(db);
  assert.equal(
    (await db.query("select count(*)::int n from public.lumi_chat_messages")).rows[0].n,
    0,
    "An in-flight response must not recreate the conversation after an explicit clear",
  );
});

test("Un chat huérfano devuelve su cobro aunque el siguiente envío sea rechazado por el límite diario", async (t) => {
  const db = await setup(t);
  await owner(db);
  await db.exec("update private.credit_settings set chat_per_day=1");
  const request = await beginChat(db);
  assert.equal((await state(db)).credits.balance, 55);
  await owner(db);
  await db.query("update private.lumi_chat_pending set created_at=now()-interval '10 minutes' where request_id=$1", [request]);
  await assert.rejects(() => beginChat(db), /límite diario/);
  assert.equal(
    (await state(db)).credits.balance,
    60,
    "A rejected new request must not retain the charge of a previous message that never received a reply",
  );
});

async function scheduleFixture(t, status) {
  const db = await setup(t);
  await user(db);
  await one(db, "select public.save_profile('Ana','America/Santiago',70,array[0,1,2,3,4,5,6]) result");
  const goalData = { title: "Aprender inglés", category: "learning", weekly_minutes: 70 };
  const goal = await one(db, "select public.save_goal($1::jsonb,null,$2) result", [JSON.stringify(goalData), randomUUID()]);
  if (status !== "active") await one(db, "select public.set_goal_status($1,$2) result", [goal, status]);
  await owner(db);
  const day = (await db.query("select private.local_today($1)::text as day", [A])).rows[0].day;
  await user(db);
  const version = (await db.query("select version from public.goals where id=$1", [goal])).rows[0].version;
  const plan = {
    ...goalData, description: "Una sesión breve", outcome: "Presentarme", start_date: day, target_date: null,
    first_action: "Preparar frases", summary: "Practicar una presentación breve",
    milestones: [{ title: "Presentación", tasks: [
      { title: "Preparar frases", description: "", priority: "medium", minutes: 10, day_offset: 0, deadline: null },
      { title: "Practicar en voz alta", description: "", priority: "medium", minutes: 10, day_offset: 0, deadline: null },
    ] }],
  };
  assert.throws(
    () => validateProposal(plan, { weeklyMinutes: 70, startDate: day, availableDays: [0, 1, 2, 3, 4, 5, 6] }),
    /supera.*tiempo|minutos.*disponible/,
    "The app's proposal contract rejects this schedule for capacity, not for malformed fields",
  );
  return { db, goal, version, plan };
}

test("Ajustar una meta pausada valida la capacidad diaria de todas las acciones de la propuesta", async (t) => {
  const { db, goal, version, plan } = await scheduleFixture(t, "paused");
  // The profile allows 10 minutes/day; both actions are individually valid,
  // but their combined 20 minutes exceed the same capacity used for active goals.
  await assert.rejects(
    () => one(db, "select public.apply_goal_plan($1,$2,$3::jsonb,$4) result", [goal, version, JSON.stringify(plan), randomUUID()]),
    /No queda suficiente tiempo/,
    "Paused goals must not bypass the proposal's daily scheduling constraints",
  );
});

test("Control: la misma propuesta excesiva se rechaza y revierte por completo para una meta activa", async (t) => {
  const { db, goal, version, plan } = await scheduleFixture(t, "active");
  await assert.rejects(
    () => one(db, "select public.apply_goal_plan($1,$2,$3::jsonb,$4) result", [goal, version, JSON.stringify(plan), randomUUID()]),
    /No queda suficiente tiempo/,
  );
  assert.equal((await db.query("select count(*)::int n from public.tasks where goal_id=$1", [goal])).rows[0].n, 0);
  assert.equal((await db.query("select version from public.goals where id=$1", [goal])).rows[0].version, version);
});

test("El período de gracia de Google Play conserva acceso pero no regala créditos de un mes sin pagar", async (t) => {
  const db = await setup(t);
  await state(db);
  await service(db);
  await one(
    db,
    "select public.play_apply_subscription($1,'grace-token-0001','planifia_plus','SUBSCRIPTION_STATE_ACTIVE',now()-interval '1 hour',true,'GPA.first-month',null,false,jsonb_build_object('startTime',now()-interval '1 month 1 hour')) result",
    [A],
  );
  // A real first paid month has just ended; Google extends expiry during grace,
  // but there is no second successful payment/order. No wall-clock sleep is used.
  await owner(db);
  await db.query(
    "update private.credit_accounts set window_start=now()-interval '1 month 1 hour',plan_used=1000 where user_id=$1",
    [A],
  );
  await db.query("update private.play_subscriptions set created_at=now()-interval '1 month 1 hour' where user_id=$1", [A]);
  await service(db);
  await one(
    db,
    "select public.play_apply_subscription($1,'grace-token-0001','planifia_plus','SUBSCRIPTION_STATE_IN_GRACE_PERIOD',now()+interval '7 days',true,'GPA.first-month',null,false,'{}') result",
    [A],
  );
  await owner(db);
  assert.deepEqual((await db.query("select latest_order_id from private.play_subscriptions where user_id=$1", [A])).rows, [{ latest_order_id: "GPA.first-month" }], "There is still only the first successful paid order");
  const grace = await state(db);
  assert.equal(grace.plan.id, "plus", "Grace preserves subscription access");
  assert.equal(grace.credits.bonus, 60, "Extra credits never expire");
  assert.equal(
    grace.credits.plan_available,
    0,
    "The documented allowance is per paid month; a failed renewal cannot credit a new 1000-credit month",
  );
});

test("La renovación pagada concede el nuevo mes aunque la primera compra se haya restaurado días después", async (t) => {
  const db = await setup(t);
  await state(db);
  await service(db);
  await one(
    db,
    "select public.play_apply_subscription($1,'renew-token-0001','planifia_plus','SUBSCRIPTION_STATE_ACTIVE',now()-interval '1 hour',true,'GPA.first-month',null,false,jsonb_build_object('startTime',now()-interval '1 month 1 hour')) result",
    [A],
  );
  // The purchase was restored several days into its first paid month. The
  // current implementation starts credits on restoration, ignoring startTime.
  await owner(db);
  await db.query("update private.credit_accounts set window_start=now()-interval '27 days',plan_used=1000 where user_id=$1", [A]);
  await db.query("update private.play_subscriptions set created_at=now()-interval '27 days' where user_id=$1", [A]);
  await service(db);
  await one(
    db,
    "select public.play_apply_subscription($1,'renew-token-0001','planifia_plus','SUBSCRIPTION_STATE_ACTIVE',now()+interval '1 month',true,'GPA.second-month',null,false,jsonb_build_object('startTime',now()-interval '1 month 1 hour')) result",
    [A],
  );
  const renewed = await state(db);
  assert.equal(renewed.plan.id, "plus");
  assert.equal(renewed.credits.bonus, 60);
  assert.equal(renewed.credits.plan_available, 1000, "The second paid period must grant its allowance when Google confirms the new successful order");
});

test("Los RPC de chat no permiten finalizar ni devolver la solicitud de otra cuenta", async (t) => {
  const db = await setup(t);
  const request = await beginChat(db);
  await assert.rejects(() => finishChat(db, request, B), /ya no está disponible/);
  await service(db);
  assert.equal(await one(db, "select public.lumi_chat_refund($1,$2) result", [B, request]), false);
  assert.equal((await state(db)).credits.balance, 55);
  await finishChat(db, request);
  assert.equal((await state(db)).credits.balance, 55);
  await user(db);
  assert.equal((await db.query("select count(*)::int n from public.lumi_chat_messages")).rows[0].n, 2);
  await user(db, B);
  assert.equal((await db.query("select count(*)::int n from public.lumi_chat_messages")).rows[0].n, 0);
});
