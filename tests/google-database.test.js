// Entrar con Google en PostgreSQL (PGlite con todas las migraciones). Supabase Auth (GoTrue) no corre
// aquí: se reproducen sus escrituras en auth.users y auth.identities, según internal/api/external.go
// y internal/models/linking.go del repositorio supabase/auth:
// - Cuenta nueva: inserta en auth.users con los datos de Google y sin 'legal'.
// - Mismo correo que una cuenta existente: agrega la identidad de Google a ESE usuario (mismo id) y
//   mezcla los datos de Google en raw_user_meta_data.
// - Si esa cuenta no había confirmado su correo: borra la identidad de correo, quita la contraseña,
//   reemplaza raw_user_meta_data por los datos de Google y confirma el correo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { LEGAL_VERSION, legalCurrent, signupLegal } from "../src/legal.js";

const A = "11111111-1111-4111-8111-111111111111",
  U = "22222222-2222-4222-8222-222222222222";
// Lo que Google entrega a Supabase (identity_data) para una cuenta.
const googleData = (email, name = "Ana Pérez") => ({
  iss: "https://accounts.google.com",
  sub: "108" + Math.floor(Math.random() * 1e12),
  name,
  full_name: name,
  email,
  email_verified: true,
  phone_verified: false,
  picture: "https://lh3.googleusercontent.com/a/fixture",
  avatar_url: "https://lh3.googleusercontent.com/a/fixture",
  provider_id: "108000000000",
});

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',
      encrypted_password text,email_confirmed_at timestamptz default now(),created_at timestamptz not null default now());
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
      provider text not null,provider_id text not null,identity_data jsonb not null,email text,unique(provider,provider_id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  return db;
}
const owner = (db) => db.exec("reset role");
const user = (db, id) =>
  db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`);
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
const count = async (db, sql, args = []) => Number(await one(db, sql, args));

async function emailSignup(db, id, email, { confirmed = true } = {}) {
  await owner(db);
  await db.query(
    "insert into auth.users(id,email,raw_user_meta_data,encrypted_password,email_confirmed_at) values($1,$2,$3,'$2a$hash',$4)",
    [id, email, JSON.stringify({ name: "Ana", legal: signupLegal("web") }), confirmed ? new Date().toISOString() : null],
  );
  await db.query("insert into auth.identities(user_id,provider,provider_id,identity_data,email) values($1,'email',$2,$3,$4)", [
    id,
    id,
    JSON.stringify({ sub: id, email }),
    email,
  ]);
}
// Igual que GoTrue: buscar una identidad o usuario con el mismo correo y vincular, o crear la cuenta.
async function googleSignIn(db, email, data = googleData(email)) {
  await owner(db);
  const existing = (await db.query("select id,email_confirmed_at from auth.users where lower(email)=lower($1)", [email])).rows[0];
  if (!existing) {
    const id = randomUUID();
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [id, email, JSON.stringify(data)]);
    await db.query("insert into auth.identities(user_id,provider,provider_id,identity_data,email) values($1,'google',$2,$3,$4)", [
      id, data.sub, JSON.stringify(data), email,
    ]);
    return id;
  }
  await db.query(
    "insert into auth.identities(user_id,provider,provider_id,identity_data,email) values($1,'google',$2,$3,$4) on conflict do nothing",
    [existing.id, data.sub, JSON.stringify(data), email],
  );
  if (existing.email_confirmed_at) {
    await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||$2 where id=$1", [existing.id, JSON.stringify(data)]);
  } else {
    await db.query("delete from auth.identities where user_id=$1 and provider<>'google'", [existing.id]);
    await db.query("update auth.users set encrypted_password=null,raw_user_meta_data=$2,email_confirmed_at=now() where id=$1", [
      existing.id,
      JSON.stringify(data),
    ]);
  }
  return existing.id;
}
const credits = async (db, id) => {
  await user(db, id);
  return (await one(db, "select public.monetization_state() result")).credits;
};
const latest = async (db, id) => {
  await user(db, id);
  return (await db.query("select terms_version,privacy_version from public.legal_acceptances order by accepted_at desc limit 1")).rows[0] || null;
};

test("Una cuenta nueva con Google se crea sin 'legal' y la app debe pedir la aceptación", async (t) => {
  const db = await setup(t);
  const id = await googleSignIn(db, "nueva@example.invalid");
  await owner(db);
  // El trigger de aceptación no falla con 'legal' nulo: no aparece «Database error saving new user».
  assert.equal(await one(db, "select name result from public.profiles where user_id=$1", [id]), "Ana Pérez", "El nombre viene de Google");
  assert.equal(await count(db, "select count(*) result from public.pets where user_id=$1", [id]), 1);
  assert.equal(await latest(db, id), null, "Sin aceptación registrada: la app bloquea hasta aceptar");
  assert.equal(legalCurrent(await latest(db, id)), false);
  // Al marcar la casilla, la app usa la función existente.
  const accepted = await one(db, "select public.accept_legal($1,$2,'android') result", [LEGAL_VERSION.terms, LEGAL_VERSION.privacy]);
  assert.equal(accepted.terms_version, LEGAL_VERSION.terms);
  assert.equal(legalCurrent(await latest(db, id)), true);
  // Un nombre de Google muy largo o ausente tampoco impide crear la cuenta.
  const long = await googleSignIn(db, "largo@example.invalid", googleData("largo@example.invalid", "N".repeat(300)));
  const unnamed = await googleSignIn(db, "sinnombre@example.invalid", { ...googleData("sinnombre@example.invalid"), name: undefined, full_name: undefined });
  await owner(db);
  assert.equal((await one(db, "select name result from public.profiles where user_id=$1", [long])).length, 80);
  assert.equal(await one(db, "select name result from public.profiles where user_id=$1", [unnamed]), "");
});

test("Entrar con Google con el correo de una cuenta confirmada usa la misma cuenta, sin duplicar créditos", async (t) => {
  const db = await setup(t);
  await emailSignup(db, A, "ana@example.invalid");
  const before = await credits(db, A);
  assert.equal(before.balance, 60, "Créditos de bienvenida de la cuenta de correo");
  const google = googleData("ana@example.invalid");
  for (let i = 0; i < 2; i++) assert.equal(await googleSignIn(db, "ANA@example.invalid", google), A, "Mismo usuario (mismo id)");
  await owner(db);
  assert.equal(await count(db, "select count(*) result from auth.users"), 1, "No se crea una segunda cuenta");
  assert.equal(await count(db, "select count(*) result from public.profiles"), 1);
  assert.equal(await count(db, "select count(*) result from public.pets"), 1);
  assert.deepEqual((await credits(db, A)).balance, before.balance);
  await owner(db);
  assert.equal(await count(db, "select count(*) result from private.credit_events where user_id=$1 and reason='welcome'", [A]), 1);
  assert.equal(await count(db, "select count(*) result from private.credit_accounts"), 1);
  assert.equal(await one(db, "select name result from public.profiles where user_id=$1", [A]), "Ana", "El perfil no cambia");
  // Ya aceptó al registrarse con correo: Google no le vuelve a pedir la casilla.
  assert.equal(legalCurrent(await latest(db, A)), true);
  await owner(db);
  assert.deepEqual(
    (await db.query("select provider from auth.identities where user_id=$1 order by provider", [A])).rows.map((r) => r.provider),
    ["email", "google"],
    "Puede seguir entrando con su contraseña o con Google",
  );
});

test("Si la cuenta de correo no estaba confirmada, Google la confirma y conserva su aceptación y sus créditos", async (t) => {
  const db = await setup(t);
  await emailSignup(db, U, "sinconfirmar@example.invalid", { confirmed: false });
  assert.equal(await googleSignIn(db, "sinconfirmar@example.invalid"), U);
  await owner(db);
  const row = (await db.query("select email_confirmed_at,encrypted_password,raw_user_meta_data from auth.users where id=$1", [U])).rows[0];
  assert.ok(row.email_confirmed_at, "Queda confirmada");
  assert.equal(row.encrypted_password, null, "GoTrue quita la contraseña: puede crear otra con «Olvidé mi contraseña»");
  assert.equal(row.raw_user_meta_data.legal, undefined, "Los metadatos pasan a ser los de Google");
  // La aceptación se guardó al crear la cuenta (trigger), así que no se pierde.
  assert.equal(legalCurrent(await latest(db, U)), true);
  assert.equal((await credits(db, U)).balance, 60);
  await googleSignIn(db, "sinconfirmar@example.invalid");
  assert.equal((await credits(db, U)).balance, 60, "Volver a entrar no suma otra bienvenida");
  await owner(db);
  assert.equal(await count(db, "select count(*) result from private.credit_events where reason='welcome'"), 1);
  assert.equal(await count(db, "select count(*) result from auth.users"), 1);
});
