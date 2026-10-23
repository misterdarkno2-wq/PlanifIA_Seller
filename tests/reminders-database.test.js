// Hora del recordatorio diario en el perfil (PostgreSQL con PGlite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";

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
  await db.query("insert into auth.users(id,email) values($1,'a@example.invalid'),($2,'b@example.invalid')", [A, B]);
  return db;
}
const user = (db, id) =>
  db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`);
const anon = (db) => db.exec("reset role; set role anon; select set_config('request.jwt.claim.sub','',false)");
const hour = async (db) => (await db.query("select reminder_time::text h from public.profiles")).rows.map((r) => r.h);

test("Cada persona guarda sólo su propia hora, redondeada al minuto", async (t) => {
  const db = await setup(t);
  await user(db, A);
  assert.deepEqual(await hour(db), [null], "Sin hora elegida hasta que la persona la guarde");
  await db.query("select public.save_reminder_time($1)", ["07:45:59"]);
  assert.deepEqual(await hour(db), ["07:45:00"]);
  await user(db, B);
  assert.deepEqual(await hour(db), [null], "La hora de A no cambia ni se ve desde B");
  await db.query("select public.save_reminder_time($1)", ["21:30"]);
  assert.deepEqual(await hour(db), ["21:30:00"]);
  await user(db, A);
  assert.deepEqual(await hour(db), ["07:45:00"]);
});

test("Sin sesión no se guarda, la hora no puede quedar vacía y la tabla no se escribe directo", async (t) => {
  const db = await setup(t);
  await anon(db);
  await assert.rejects(db.query("select public.save_reminder_time('08:00')"), /permission denied/);
  await user(db, A);
  await assert.rejects(db.query("select public.save_reminder_time(null)"), /Elige una hora/);
  await assert.rejects(db.query("select public.save_reminder_time('25:00')"), /out of range|invalid/i);
  await assert.rejects(db.query("update public.profiles set reminder_time='08:00'"), /permission denied/);
  assert.deepEqual(await hour(db), [null]);
});

test("La función sigue el estilo de seguridad de las demás", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202610220001_reminders.sql", import.meta.url), "utf8");
  assert.match(sql, /save_reminder_time\(p_time time\)[^$]*security definer set search_path=''/);
  assert.match(sql, /private\.require_user\(\)/);
  assert.match(sql, /revoke all on function public\.save_reminder_time\(time\) from public,anon;/);
});
