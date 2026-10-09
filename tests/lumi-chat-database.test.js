import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',
      email_confirmed_at timestamptz default now(),created_at timestamptz not null default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  await db.query(
    `insert into auth.users(id,email,raw_user_meta_data) values($1,'a@example.invalid','{"name":"Ana"}'),($2,'b@example.invalid','{}')`,
    [A, B],
  );
  return db;
}
const owner = (db) => db.exec("reset role");
const service = (db) => db.exec("reset role; set role service_role");
const user = (db, id) =>
  db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`);
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
async function balance(db, id = A) {
  await user(db, id);
  return (await one(db, "select public.monetization_state() result")).credits;
}
async function begin(db, text = "Hola Lumi", id = A, request = randomUUID()) {
  await service(db);
  const context = await one(db, "select public.lumi_chat_begin($1,$2,$3) result", [id, request, text]);
  return { request, context };
}
async function finish(db, request, text = "Hola Lumi", reply = "¡Hola! Vamos paso a paso.", id = A) {
  await service(db);
  return one(db, "select public.lumi_chat_finish($1,$2,$3,$4) result", [id, request, text, reply]);
}
const refund = async (db, request, id = A) => {
  await service(db);
  return one(db, "select public.lumi_chat_refund($1,$2) result", [id, request]);
};

test("Cada mensaje a Lumi cuesta 5 créditos; los planes siguen costando 20", async (t) => {
  const db = await setup(t);
  const start = await balance(db);
  assert.equal(start.balance, 60);
  assert.equal(start.chat_cost, 5);
  assert.equal(start.cost_per_use, 20);
  const { request, context } = await begin(db);
  assert.equal(context.cost, 5);
  assert.equal((await balance(db)).balance, 55);
  assert.deepEqual(await finish(db, request), { credits: 55 });
  await service(db);
  await one(db, "select public.enqueue_ai_job($1,$2,'generation',$3::jsonb,'{}'::jsonb) result", [
    A,
    randomUUID(),
    JSON.stringify({ idea: "meta" }),
  ]);
  assert.equal((await balance(db)).balance, 35, "Un plan con IA sigue costando 20");
  await owner(db);
  const reasons = (await db.query("select reason,bonus_delta from private.credit_events where user_id=$1 order by id", [A])).rows;
  assert.deepEqual(reasons.map((r) => [r.reason, r.bonus_delta]), [
    ["welcome", 60],
    ["lumi_chat", -5],
    ["ai_use", -20],
  ]);
});

test("Si Lumi no responde se devuelven los créditos una sola vez, también si la respuesta nunca llegó", async (t) => {
  const db = await setup(t);
  const { request } = await begin(db);
  assert.equal((await balance(db)).balance, 55);
  assert.equal(await refund(db, request), true);
  assert.equal(await refund(db, request), false, "No se devuelve dos veces");
  assert.equal((await balance(db)).balance, 60);
  await assert.rejects(() => finish(db, request), /ya no está disponible/);
  await assert.rejects(() => begin(db, "otra vez", A, request), /ya se envió/);
  // Un mensaje cobrado cuya respuesta nunca llegó se devuelve en el siguiente envío.
  const lost = await begin(db);
  await owner(db);
  await db.query("update private.lumi_chat_pending set created_at=now()-interval '10 minutes' where request_id=$1", [lost.request]);
  await begin(db);
  assert.equal((await balance(db)).balance, 55, "Sólo queda cobrado el último mensaje");
  await owner(db);
  assert.equal(
    (await db.query("select count(*)::int n from private.credit_events where reason='lumi_chat_refund' and user_id=$1", [A])).rows[0].n,
    2,
  );
});

test("Devolución con créditos del plan: vuelven al plan si la ventana mensual es la misma", async (t) => {
  const db = await setup(t);
  await service(db);
  await one(
    db,
    "select public.play_apply_subscription($1,'token-plus-0001','planifia_plus','SUBSCRIPTION_STATE_ACTIVE',now()+interval '20 days',true,null,null,false,'{}') result",
    [A],
  );
  const { request } = await begin(db);
  const charged = await balance(db);
  assert.equal(charged.plan_available, 995);
  assert.equal(charged.bonus, 60, "Gasta primero los del plan");
  await refund(db, request);
  assert.equal((await balance(db)).plan_available, 1000);
});

test("Sin créditos: mensaje claro con el enlace a Mi plan y nada cobrado", async (t) => {
  const db = await setup(t);
  await balance(db);
  await owner(db);
  await db.query("update private.credit_accounts set bonus=4 where user_id=$1", [A]);
  await assert.rejects(() => begin(db), /No tienes créditos suficientes\. Cada mensaje a Lumi cuesta 5 créditos/);
  assert.equal((await balance(db)).balance, 4);
  await assert.rejects(() => begin(db, " "), /1 a 500 caracteres/);
  await assert.rejects(() => begin(db, "x".repeat(501)), /1 a 500 caracteres/);
});

test("Límites: 6 mensajes por minuto y 200 por día por persona", async (t) => {
  const db = await setup(t);
  await balance(db);
  await owner(db);
  await db.query("update private.credit_accounts set bonus=5000 where user_id=$1", [A]);
  for (let i = 0; i < 6; i++) await begin(db);
  await assert.rejects(() => begin(db), /Vas muy rápido/);
  await assert.doesNotReject(() => begin(db, "hola", B), "El límite es por persona");
  await owner(db);
  await db.query("update private.credit_events set created_at=now()-interval '2 minutes' where reason='lumi_chat'");
  await db.query("update private.credit_settings set chat_per_day=7");
  await begin(db);
  await assert.rejects(() => begin(db), /límite diario/);
});

test("Contexto mínimo: perfil, Lumi, hasta 3 metas con su próxima acción y los últimos 6 mensajes", async (t) => {
  const db = await setup(t);
  await owner(db);
  for (const [i, title] of ["Correr 5 km", "Leer más", "Aprender inglés", "Meta pausada"].entries()) {
    const goal = (
      await db.query(
        `insert into public.goals(user_id,title,category,status,updated_at) values($1,$2,'wellbeing',$3,now()-make_interval(mins=>$4)) returning id`,
        [A, title, i === 3 ? "paused" : "active", i],
      )
    ).rows[0].id;
    await db.query(
      `insert into public.tasks(user_id,goal_id,title,status,scheduled_date) values($1,$2,$3,'completed',current_date),($1,$2,$4,'pending',current_date+1)`,
      [A, goal, `Hecho ${i}`, `Siguiente ${i}`],
    );
  }
  await db.query(
    `insert into public.goals(user_id,title,category) values($1,'Meta de otra cuenta','project')`,
    [B],
  );
  for (let i = 0; i < 4; i++) {
    const { request } = await begin(db, `pregunta ${i}`);
    await finish(db, request, `pregunta ${i}`, `respuesta ${i}`);
  }
  const { context } = await begin(db, "¿Qué hago hoy?");
  assert.deepEqual(context.profile, { name: "Ana", pet: { name: "Lumi", stage: 1 } });
  assert.deepEqual(context.goals, [
    { title: "Correr 5 km", next_action: "Siguiente 0" },
    { title: "Leer más", next_action: "Siguiente 1" },
    { title: "Aprender inglés", next_action: "Siguiente 2" },
  ]);
  assert.equal(context.history.length, 6);
  assert.deepEqual(context.history.at(-1), { role: "lumi", content: "respuesta 3" });
  assert.deepEqual(context.history[0], { role: "user", content: "pregunta 1" });
  assert.ok(!JSON.stringify(context).includes("otra cuenta"));
});

test("Historial: sólo los últimos 100 mensajes, cada uno lee los suyos y puede borrarlos", async (t) => {
  const db = await setup(t);
  await balance(db, A);
  await balance(db, B);
  await owner(db);
  await db.query("update private.credit_settings set chat_history=10, chat_per_minute=60");
  await db.query("update private.credit_accounts set bonus=5000");
  for (let i = 0; i < 7; i++) {
    const { request } = await begin(db, `mensaje ${i}`);
    await finish(db, request, `mensaje ${i}`, "x".repeat(700));
  }
  const { request } = await begin(db, "de B", B);
  await finish(db, request, "de B", "hola B", B);
  await user(db, A);
  const mine = (await db.query("select role,content from public.lumi_chat_messages order by id")).rows;
  assert.equal(mine.length, 10, "Se conservan los últimos chat_history");
  assert.equal(mine[0].content, "mensaje 2");
  assert.equal(mine.at(-1).content.length, 600, "Respuestas recortadas a 600 caracteres");
  assert.ok(mine.every((m) => m.content !== "de B"), "RLS: sólo los mensajes propios");
  for (const sql of [
    "insert into public.lumi_chat_messages(user_id,role,content) values('11111111-1111-4111-8111-111111111111','lumi','falso')",
    "select public.lumi_chat_begin('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'hola')",
    "select public.lumi_chat_finish('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'a','b')",
    "select public.lumi_chat_refund('11111111-1111-4111-8111-111111111111',gen_random_uuid())",
    "select private.spend_credits('11111111-1111-4111-8111-111111111111',5,'lumi_chat','x')",
    "select * from private.lumi_chat_pending",
  ])
    await assert.rejects(() => db.query(sql), /permission denied/, sql);
  assert.equal(await one(db, "select public.lumi_chat_clear() result"), 10);
  await user(db, B);
  assert.equal((await db.query("select count(*)::int n from public.lumi_chat_messages")).rows[0].n, 2, "Borrar no toca otras cuentas");
  await user(db, B);
  await one(db, "select public.delete_my_account('ELIMINAR') result");
  await owner(db);
  assert.equal(
    (await db.query("select count(*)::int n from public.lumi_chat_messages where user_id=$1", [B])).rows[0].n,
    0,
    "Eliminar la cuenta borra la conversación",
  );
});
