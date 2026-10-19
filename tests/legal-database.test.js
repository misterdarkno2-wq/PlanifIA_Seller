// Aceptación de términos, reportes de contenido de la IA y límites por IP en PostgreSQL (PGlite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { LEGAL_VERSION, signupLegal } from "../src/legal.js";

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
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  // A se registró con la casilla marcada; B es una cuenta anterior a la casilla.
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'a@example.invalid',$2),($3,'b@example.invalid','{}')", [
    A,
    JSON.stringify({ name: "Ana", legal: signupLegal("web") }),
    B,
  ]);
  return db;
}
const owner = (db) => db.exec("reset role");
const service = (db) => db.exec("reset role; set role service_role");
const anon = (db) => db.exec("reset role; set role anon; select set_config('request.jwt.claim.sub','',false)");
const user = (db, id) =>
  db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`);
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const rows = async (db, sql, args = []) => (await db.query(sql, args)).rows;
const accept = (db, terms = LEGAL_VERSION.terms, privacy = LEGAL_VERSION.privacy, platform = "android") =>
  one(db, "select public.accept_legal($1,$2,$3) result", [terms, privacy, platform]);

test("El registro guarda la aceptación con la fecha del servidor y nunca falla por datos inválidos", async (t) => {
  const db = await setup(t);
  await user(db, A);
  const own = await rows(db, "select terms_version,privacy_version,platform,age_confirmed,source from public.legal_acceptances");
  assert.deepEqual(own, [
    { terms_version: LEGAL_VERSION.terms, privacy_version: LEGAL_VERSION.privacy, platform: "web", age_confirmed: true, source: "signup" },
  ]);
  await user(db, B);
  assert.equal((await rows(db, "select * from public.legal_acceptances")).length, 0, "Cuenta anterior: debe aceptar de nuevo");
  await owner(db);
  // Metadatos manipulados o incompletos: la cuenta se crea igual, sin registrar una aceptación.
  for (const legal of [
    { ...signupLegal("web"), age_confirmed: false },
    { ...signupLegal("web"), terms_version: "2099-01-01" },
    { ...signupLegal("web"), terms_version: "'; drop table x; --" },
    { ...signupLegal("web"), platform: "ios" },
    "texto",
  ]) {
    const id = randomUUID();
    await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)", [id, JSON.stringify({ legal })]);
    assert.equal(Number(await one(db, "select count(*) result from public.legal_acceptances where user_id=$1", [id])), 0);
  }
});

test("La persona lee su historial de aceptación pero no puede escribirlo ni ver el de otra cuenta", async (t) => {
  const db = await setup(t);
  await user(db, B);
  const accepted = await accept(db);
  assert.equal(accepted.terms_version, LEGAL_VERSION.terms);
  assert.equal(accepted.platform, "android");
  const again = await accept(db);
  assert.equal(again.accepted_at, accepted.accepted_at, "Un doble toque no crea otra fila");
  assert.equal((await rows(db, "select * from public.legal_acceptances")).length, 1);
  for (const sql of [
    "insert into public.legal_acceptances(user_id,terms_version,privacy_version,platform,age_confirmed,source) values(auth.uid(),'2026-10-18','2026-10-18','web',true,'update')",
    "update public.legal_acceptances set terms_version='2030-01-01'",
    "delete from public.legal_acceptances",
  ])
    await assert.rejects(db.query(sql), /permission denied/, sql);
  await user(db, A);
  assert.equal((await rows(db, "select user_id from public.legal_acceptances")).every((r) => r.user_id === A), true);
  await assert.rejects(accept(db, "2099-01-01"), /versión de los términos no es válida/);
  await assert.rejects(accept(db, LEGAL_VERSION.terms, LEGAL_VERSION.privacy, "ios"), /Plataforma no válida/);
  await anon(db);
  await assert.rejects(accept(db), /permission denied/);
  await assert.rejects(db.query("select * from public.legal_acceptances"), /permission denied/);
});

async function lumiSaid(db, id, content) {
  await owner(db);
  return one(db, "insert into public.lumi_chat_messages(user_id,role,content) values($1,'lumi',$2) returning id result", [id, content]);
}
const report = (db, kind, ref, content, reason = "offensive", details = "") =>
  one(db, "select public.report_ai_content($1,$2,$3,$4,$5) result", [kind, ref, content, reason, details]);

test("Reportar una respuesta de Lumi guarda la copia del servidor, una sola vez y sólo de la propia cuenta", async (t) => {
  const db = await setup(t);
  const said = "Respuesta de prueba que alguien considera ofensiva.";
  const messageId = await lumiSaid(db, A, said);
  await lumiSaid(db, B, "Respuesta para otra cuenta.");
  await user(db, A);
  const first = await report(db, "chat", null, said, "offensive", "  No me gustó el tono.  ");
  assert.equal(first.status, "open");
  const again = await report(db, "chat", String(messageId), "texto distinto", "wrong");
  assert.equal(again.id, first.id, "El mismo mensaje no se reporta dos veces");
  const [saved] = await rows(db, "select kind,message_id,content,reason,details from public.ai_content_reports");
  assert.deepEqual(saved, { kind: "chat", message_id: messageId, content: said, reason: "offensive", details: "No me gustó el tono." });
  await assert.rejects(report(db, "chat", null, "Lumi nunca dijo esto"), /No encontramos esa respuesta/);
  await assert.rejects(report(db, "chat", null, said, "spam"), /Elige qué problema tiene/);
  await assert.rejects(report(db, "chat", null, said, "other", "x".repeat(501)), /hasta 500 caracteres/);
  await assert.rejects(db.query("insert into public.ai_content_reports(user_id,kind,message_id,content,reason) values(auth.uid(),'chat',1,'x','other')"), /permission denied/);
  await assert.rejects(db.query("update public.ai_content_reports set status='dismissed'"), /permission denied/);
  // B no puede reportar (ni leer) lo que Lumi le dijo a A.
  await user(db, B);
  await assert.rejects(report(db, "chat", String(messageId), said), /No encontramos esa respuesta/);
  assert.equal((await rows(db, "select * from public.ai_content_reports")).length, 0);
  // "Borrar conversación" no borra el reporte: el dueño conserva la copia para revisarla.
  await owner(db);
  await db.query("delete from public.lumi_chat_messages where user_id=$1", [A]);
  assert.equal(Number(await one(db, "select count(*) result from public.ai_content_reports")), 1);
});

test("Reportar un plan propuesto copia la propuesta y el proveedor; hay un límite diario", async (t) => {
  const db = await setup(t);
  await owner(db);
  const job = await one(
    db,
    `insert into public.ai_jobs(user_id,request_id,kind,plan_id,priority,status,result,provider)
     values($1,$2,'generation','free',1,'completed',$3,'cloud') returning id result`,
    [A, randomUUID(), JSON.stringify({ proposal: { title: "Plan reportado", milestones: [] } })],
  );
  await user(db, B);
  await assert.rejects(report(db, "plan", job, null, "harmful"), /No encontramos esa propuesta/);
  await user(db, A);
  await assert.rejects(report(db, "plan", "no-es-un-uuid", null, "harmful"), /No encontramos esa propuesta/);
  await report(db, "plan", job, null, "harmful", "Sugiere algo peligroso.");
  const [saved] = await rows(db, "select kind,job_id,provider,content from public.ai_content_reports");
  assert.equal(saved.kind, "plan");
  assert.equal(saved.provider, "cloud");
  assert.match(saved.content, /Plan reportado/);
  await assert.rejects(report(db, "otro", job, null), /Tipo de contenido no válido/);
  // Con el plan ya reportado, 19 respuestas más completan el máximo de 20 por día.
  for (let i = 0; i <= 19; i++) await lumiSaid(db, A, `Mensaje ${i}`);
  await user(db, A);
  for (let i = 0; i < 19; i++) await report(db, "chat", null, `Mensaje ${i}`);
  await assert.rejects(report(db, "chat", null, "Mensaje 19"), /muchos reportes hoy/);
});

test("Los reportes se borran a los 12 meses, como dice la política de privacidad", async (t) => {
  const db = await setup(t);
  const old = await lumiSaid(db, B, "Respuesta reportada hace más de un año.");
  await owner(db);
  await db.query(
    "insert into public.ai_content_reports(user_id,kind,message_id,content,reason,created_at) values($1,'chat',$2,'copia antigua','other',now()-interval '13 months'),($1,'chat',$2+1000,'copia reciente','other',now()-interval '11 months')",
    [B, old],
  );
  const said = "Respuesta nueva.";
  await lumiSaid(db, A, said);
  await user(db, A);
  await report(db, "chat", null, said);
  await owner(db);
  assert.deepEqual(
    (await rows(db, "select content from public.ai_content_reports order by created_at")).map((r) => r.content),
    ["copia reciente", said],
    "Borra sólo los reportes de más de 12 meses, de cualquier cuenta",
  );
});

test("Eliminar la cuenta borra su historial de aceptación y sus reportes", async (t) => {
  const db = await setup(t);
  const said = "Respuesta a reportar.";
  await lumiSaid(db, A, said);
  await user(db, A);
  await report(db, "chat", null, said);
  await one(db, "select public.delete_my_account('ELIMINAR') result");
  await owner(db);
  assert.equal(Number(await one(db, "select count(*) result from public.legal_acceptances where user_id=$1", [A])), 0);
  assert.equal(Number(await one(db, "select count(*) result from public.ai_content_reports where user_id=$1", [A])), 0);
});

test("El límite por IP sólo lo usa el servidor, guarda un hash y corta al superar el máximo", async (t) => {
  const db = await setup(t);
  const key = createHash("sha256").update("secreto:203.0.113.7").digest("hex");
  const take = () => one(db, "select public.rate_limit_take('ai',$1,3,600) result", [key]);
  await user(db, A);
  await assert.rejects(take(), /permission denied/);
  await anon(db);
  await assert.rejects(take(), /permission denied/);
  await service(db);
  assert.deepEqual([await take(), await take(), await take(), await take()], [true, true, true, false]);
  await assert.rejects(one(db, "select public.rate_limit_take('ai','203.0.113.7',3,600) result"), /Límite no válido/);
  await owner(db);
  assert.deepEqual(await rows(db, "select bucket,key,hits from private.rate_limits"), [{ bucket: "ai", key, hits: 3 }]);
  await db.query("insert into private.rate_limits values('ai',$1,now()-interval '2 days',9)", [createHash("sha256").update("vieja").digest("hex")]);
  await service(db);
  await take();
  await owner(db);
  assert.equal(Number(await one(db, "select count(*) result from private.rate_limits")), 1, "Borra ventanas de más de un día");
});

test("Nadie más que la cuenta puede ver sus filas y anon no ve nada", async (t) => {
  const db = await setup(t);
  await user(db, C);
  assert.equal((await rows(db, "select * from public.legal_acceptances")).length, 0);
  assert.equal((await rows(db, "select * from public.ai_content_reports")).length, 0);
  await anon(db);
  await assert.rejects(db.query("select * from public.ai_content_reports"), /permission denied/);
  await assert.rejects(report(db, "chat", null, "x"), /permission denied/);
});
