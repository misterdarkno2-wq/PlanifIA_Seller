// Respaldo en la nube en PostgreSQL (PGlite): señal del PC, toma de solicitudes, límites y permisos.
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
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  await db.query("insert into auth.users(id,email) values($1,'a@example.invalid'),($2,'b@example.invalid')", [A, B]);
  return db;
}
const owner = (db) => db.exec("reset role");
const service = (db) => db.exec("reset role; set role service_role");
const user = (db, id) =>
  db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`);
const call = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const enqueue = (db, id = A) =>
  call(db, "select public.enqueue_ai_job($1,$2,'generation',$3::jsonb,$4::jsonb) result", [
    id,
    randomUUID(),
    JSON.stringify({ idea: "Test " + randomUUID() }),
    JSON.stringify({ limits: {} }),
  ]);
const claimLocal = (db) => call(db, "select public.claim_ai_job() result");
const claimCloud = (db, id = A, job = null) => call(db, "select public.claim_ai_job_cloud($1,$2) result", [id, job]);
const online = (db) => call(db, "select public.ai_local_online() result");
const lastWorker = async (db) => {
  await owner(db);
  const value = (await db.query("select last_worker_at from private.ai_queue_settings")).rows[0].last_worker_at;
  await service(db);
  return value;
};
const finish = (db, j, result = { proposal: { title: "Nube" } }, error = null, retry = false) =>
  call(db, "select public.finish_ai_job($1,$2,$3::jsonb,$4,$5) result", [j.id, j.lease_token, result && JSON.stringify(result), error, retry]);

test("Con el PC sin señal la nube toma sólo la solicitud de esa cuenta y nunca renueva la señal del PC", async (t) => {
  const db = await setup(t);
  await service(db);
  assert.equal(await online(db), false, "Sin trabajador nunca visto, la IA local está apagada");
  const jobA = await enqueue(db, A);
  const jobB = await enqueue(db, B);
  assert.deepEqual(await claimCloud(db, A, jobB.id), { status: "none" }, "No toma solicitudes de otra cuenta");
  const claimed = await claimCloud(db, A);
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.id, jobA.id);
  assert.ok(claimed.lease_token && claimed.timeout_ms === 125000);
  assert.equal(await lastWorker(db), null, "La nube no aparenta que el PC está encendido");
  assert.deepEqual(await claimCloud(db, A), { status: "none" }, "No hay otra en cola");
  assert.equal(await finish(db, claimed), true);
  await user(db, A);
  const [viewed] = await call(db, "select public.get_ai_jobs() result");
  assert.equal(viewed.status, "completed");
  assert.equal(viewed.provider, "cloud", "La app puede mostrar que la preparó el respaldo");
  assert.equal(viewed.worker_online, false);
  await user(db, B);
  const [other] = await call(db, "select public.get_ai_jobs() result");
  assert.equal(other.status, "queued");
  assert.equal(other.provider, "local");
});

test("Cuando el PC vuelve, la nube no toma nada y la cola vuelve a la IA local", async (t) => {
  const db = await setup(t);
  await service(db);
  assert.equal(await claimLocal(db), null, "El trabajador sondea: renueva la señal");
  assert.equal(await online(db), true);
  await enqueue(db, A);
  assert.deepEqual(await claimCloud(db, A), { status: "local_online" });
  const local = await claimLocal(db);
  assert.ok(local?.id, "La IA local la toma");
  await owner(db);
  assert.equal((await db.query("select provider from public.ai_jobs")).rows[0].provider, "local");
  // 45 s sin señal (el trabajador dejó de sondear porque Ollama no responde) => apagada.
  await db.exec("update private.ai_queue_settings set last_worker_at=now()-interval '46 seconds'");
  await service(db);
  assert.equal(await online(db), false);
});

test("Una propuesta en la nube no ocupa la plaza de la GPU cuando el PC vuelve", async (t) => {
  const db = await setup(t);
  await service(db);
  await enqueue(db, A);
  const cloud = await claimCloud(db, A);
  assert.equal(cloud.status, "claimed");
  const jobB = await enqueue(db, B);
  const local = await claimLocal(db);
  assert.equal(local?.id, jobB.id, "Concurrencia 1 de la GPU: la de la nube no cuenta");
});

test("Si la función de la nube muere, su concesión vence y la solicitud se vuelve a intentar", async (t) => {
  const db = await setup(t);
  await service(db);
  const job = await enqueue(db, A);
  const first = await claimCloud(db, A);
  await owner(db);
  await db.query("update public.ai_jobs set lease_until=now()-interval '1 second' where id=$1", [job.id]);
  await service(db);
  const second = await claimCloud(db, A);
  assert.equal(second.status, "claimed");
  assert.notEqual(second.lease_token, first.lease_token);
  assert.equal(await finish(db, first), false, "El token vencido ya no guarda resultados");
  await owner(db);
  assert.equal((await db.query("select attempts from public.ai_jobs where id=$1", [job.id])).rows[0].attempts, 2);
});

test("Un error de la nube cierra la solicitud y la base devuelve los créditos como con la IA local", async (t) => {
  const db = await setup(t);
  await owner(db);
  const balance = async () => (await db.query("select coalesce(sum(plan_delta+bonus_delta),0)::int n from private.credit_events where user_id=$1", [A])).rows[0].n;
  await service(db);
  await enqueue(db, A);
  await owner(db);
  const charged = await balance();
  assert.equal((await db.query("select plan_delta+bonus_delta n from private.credit_events where user_id=$1 and reason='ai_use'", [A])).rows[0].n, -20,
    "Mismo costo que con la IA local");
  await service(db);
  const job = await claimCloud(db, A);
  assert.equal(await finish(db, job, null, "La IA no pudo ajustar una propuesta válida.", false), true);
  await owner(db);
  assert.equal(await balance(), charged + 20, "Créditos devueltos");
});

test("Límites de la nube por persona y de toda la app; el respaldo se puede apagar", async (t) => {
  const db = await setup(t);
  await owner(db);
  await db.exec("update private.ai_fallback_settings set chat_per_hour=2,plans_per_day=1,global_chat_per_day=3");
  await service(db);
  const take = (id, kind) => call(db, "select public.ai_fallback_take($1,$2) result", [id, kind]);
  assert.deepEqual([await take(A, "chat"), await take(A, "chat"), await take(A, "chat")], [true, true, false]);
  assert.equal(await take(B, "chat"), true, "Otra persona tiene su propio límite");
  assert.equal(await take(B, "chat"), false, "Límite diario de toda la app");
  const first = await enqueue(db, A);
  const claimed = await claimCloud(db, A);
  assert.equal(claimed.id, first.id);
  await finish(db, claimed);
  const second = await enqueue(db, A);
  assert.deepEqual(await claimCloud(db, A), { status: "limited" });
  await owner(db);
  assert.equal((await db.query("select status from public.ai_jobs where id=$1", [second.id])).rows[0].status, "queued",
    "Con el límite alcanzado la solicitud sigue esperando a la IA local");
  await db.exec("update private.ai_fallback_settings set enabled=false");
  await service(db);
  assert.equal(await take(B, "plan"), false);
});

test("El navegador no puede usar el respaldo directamente ni leer sus tablas privadas", async (t) => {
  const db = await setup(t);
  await user(db, A);
  await assert.rejects(() => claimCloud(db, A), /permission denied/);
  await assert.rejects(() => call(db, "select public.ai_fallback_take($1,'chat') result", [A]), /permission denied/);
  await assert.rejects(() => online(db), /permission denied/);
  await assert.rejects(() => db.query("select * from private.ai_fallback_usage"), /permission denied/);
  await assert.rejects(() => db.query("update public.ai_jobs set provider='cloud'"), /permission denied/);
});
