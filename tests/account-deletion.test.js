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
const asUser = (db, id) =>
  db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`,
  );
const count = async (db, table, id) =>
  (await db.query(`select count(*)::int n from ${table} where user_id=$1`, [id]))
    .rows[0].n;

test("Eliminar cuenta borra sólo los datos de quien la solicita", async (t) => {
  const db = await setup(t);
  await db.query(
    "select public.enqueue_ai_job($1,$2,'generation','{}'::jsonb,'{\"limits\":{}}'::jsonb)",
    [A, randomUUID()],
  );
  for (const id of [A, B]) {
    await asUser(db, id);
    await db.query(
      "select public.save_task(p_data=>$1::jsonb,p_request_id=>$2)",
      [JSON.stringify({ title: "Paso", description: "", area: "Proyecto", priority: "low", deadline: null, scheduled_date: null, minutes: 15 }), randomUUID()],
    );
  }
  await db.exec("reset role");
  assert.equal(await count(db, "public.tasks", A), 1);

  await db.exec("reset role; set role anon");
  await assert.rejects(db.query("select public.delete_my_account('ELIMINAR')"));
  await asUser(db, A);
  await assert.rejects(
    db.query("select public.delete_my_account('eliminar')"),
    /ELIMINAR/,
  );
  const deleted = await db.query(
    "select public.delete_my_account('ELIMINAR') as result",
  );
  assert.equal(deleted.rows[0].result, true);

  await db.exec("reset role");
  for (const table of [
    "public.profiles",
    "public.pets",
    "public.tasks",
    "public.ai_jobs",
  ])
    assert.equal(await count(db, table, A), 0, table);
  assert.equal(
    (await db.query("select count(*)::int n from auth.users where id=$1", [A]))
      .rows[0].n,
    0,
  );
  assert.equal(await count(db, "public.tasks", B), 1);
  assert.equal(await count(db, "public.profiles", B), 1);
});
