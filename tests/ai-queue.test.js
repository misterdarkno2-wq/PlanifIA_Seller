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
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
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
const call = async (db, sql, args = []) =>
  (await db.query(sql, args)).rows[0]?.result;
const enqueue = (
  db,
  id = A,
  request = randomUUID(),
  input = { idea: "Test" },
  payload = { limits: {} },
) =>
  call(
    db,
    "select public.enqueue_ai_job($1,$2,'generation',$3::jsonb,$4::jsonb) result",
    [id, request, JSON.stringify(input), JSON.stringify(payload)],
  );
const claim = (db) => call(db, "select public.claim_ai_job() result");
const finish = (db, j, result = { proposal: { title: "Fixture" } }) =>
  call(db, "select public.finish_ai_job($1,$2,$3::jsonb,null,false) result", [
    j.id,
    j.lease_token,
    JSON.stringify(result),
  ]);
async function paid(db, id, plan) {
  await service(db);
  const admin = (action, payload) =>
    call(db, "select public.billing_admin($1,$2::jsonb) result", [
      action,
      JSON.stringify(payload),
    ]);
  const order = await admin("create_order", {
    user_id: id,
    plan_id: plan,
    channel: "webpay",
    request_id: randomUUID(),
  });
  await admin("claim_order", { order_id: order.id });
  await admin("charge_started", { order_id: order.id });
  await admin("confirm_order", {
    order_id: order.id,
    provider_result: {
      approved: true,
      amount: order.amount,
      buy_order: order.buy_order,
      session_id: order.session_id,
      response_code: 0,
    },
  });
}

test("Queue quotas are atomic, retries are idempotent, concurrent claims cannot duplicate, ownership is enforced", async (t) => {
  const db = await setup(t);
  await service(db);
  const request = randomUUID();
  const job = await enqueue(db, A, request);
  await user(db, A);
  const initial = (
    await call(db, "select public.get_ai_jobs($1) result", [job.id])
  )[0];
  assert.equal(initial.estimated_seconds, null);
  assert.equal(initial.position, 1);
  await assert.rejects(
    () => db.query("update public.ai_jobs set status='completed'"),
    /permission denied/,
  );
  await service(db);
  assert.equal((await enqueue(db, A, request)).id, job.id);
  await assert.rejects(
    () => enqueue(db, A, request, { idea: "Different" }),
    /otra solicitud/,
  );
  await assert.rejects(() => enqueue(db, A), /preparación/);
  const claimed = await claim(db);
  assert.equal(claimed.id, job.id);
  const claims = await Promise.all([claim(db), claim(db)]);
  assert.deepEqual(claims, [null, null]);
  assert.equal(
    await call(
      db,
      "select public.finish_ai_job($1,$2,'{}',null,false) result",
      [job.id, randomUUID()],
    ),
    false,
  );
  await user(db, B);
  assert.deepEqual(
    await call(db, "select public.get_ai_jobs($1) result", [job.id]),
    [],
  );
  assert.equal(
    (await db.query("select id from public.ai_jobs")).rows.length,
    0,
  );
  await assert.rejects(
    () => call(db, "select public.cancel_ai_job($1) result", [job.id]),
    /no encontrada/,
  );
  await assert.rejects(() => claim(db), /permission denied/);
  await assert.rejects(() => enqueue(db), /permission denied/);
  await assert.rejects(
    () => db.query("select lease_token from public.ai_jobs"),
    /permission denied/,
  );
  await user(db, A);
  const viewed = (await call(db, "select public.get_ai_jobs() result"))[0];
  assert.equal(viewed.status, "processing");
  assert.ok(!Object.hasOwn(viewed, "lease_token"));
  await service(db);
  assert.equal(await finish(db, claimed), true);
  assert.equal(await finish(db, claimed), false);
  await owner(db);
  assert.equal(
    (
      await db.query("select requests from private.ai_usage where user_id=$1", [
        A,
      ])
    ).rows[0].requests,
    1,
  );
  await db.exec("update private.ai_queue_settings set daily_limit=1");
  await service(db);
  await assert.rejects(() => enqueue(db), /diario/);
  await owner(db);
  assert.equal(
    (
      await db.query(
        "select generations from private.plan_ai_usage where user_id=$1",
        [A],
      )
    ).rows[0].generations,
    1,
  );
  await user(db, A);
  assert.deepEqual(
    (await call(db, "select public.get_ai_jobs() result"))[0].result,
    { proposal: { title: "Fixture" } },
  );
});

test("FIFO within equal priority and configured concurrency; overdue jobs become actionable errors", async (t) => {
  const db = await setup(t);
  await service(db);
  const first = await enqueue(db, A),
    second = await enqueue(db, B),
    third = await enqueue(db, C);
  await owner(db);
  await db.exec("update private.ai_queue_settings set concurrency=2");
  await service(db);
  const a = await claim(db),
    b = await claim(db);
  assert.equal(a.id, first.id);
  assert.equal(b.id, second.id);
  assert.equal(await claim(db), null);
  await finish(db, a);
  await finish(db, b);
  await owner(db);
  await db.query(
    "update public.ai_jobs set created_at=now()-interval '2 days' where id=$1",
    [third.id],
  );
  await service(db);
  assert.equal(await claim(db), null);
  await user(db, C);
  assert.equal(
    (await call(db, "select public.get_ai_jobs($1) result", [third.id]))[0]
      .status,
    "error",
  );
});

test("Priority uses paid plan; FIFO and aging advance older free jobs; wait estimates use observed durations", async (t) => {
  const db = await setup(t);
  await owner(db);
  await paid(db, B, "plus");
  await paid(db, C, "pro");
  await service(db);
  const free = await enqueue(db, A),
    second = await enqueue(db, B),
    third = await enqueue(db, C);
  await owner(db);
  assert.deepEqual(
    (
      await db.query(
        "select plan_id,priority from public.ai_jobs order by created_at",
      )
    ).rows,
    [
      { plan_id: "free", priority: 0 },
      { plan_id: "plus", priority: 10 },
      { plan_id: "pro", priority: 20 },
    ],
  );
  await service(db);
  const high = await claim(db);
  assert.equal(high.id, third.id);
  await finish(db, high);
  await owner(db);
  await db.query(
    "update public.ai_jobs set created_at=now()-interval '30 minutes' where id=$1",
    [free.id],
  );
  await service(db);
  const aged = await claim(db);
  assert.equal(aged.id, free.id);
  await finish(db, aged);
  const fifo = await claim(db);
  assert.equal(fifo.id, second.id);
  await finish(db, fifo);
  await service(db);
  const queued = await enqueue(db, A);
  await user(db, A);
  const view = (
    await call(db, "select public.get_ai_jobs($1) result", [queued.id])
  )[0];
  assert.equal(view.position, 1);
  assert.equal(typeof view.estimated_seconds, "number");
});

test("Pending cancellation is final; processing cancellation waits for worker; stale leases recover with bounded retries and no quota charge", async (t) => {
  const db = await setup(t);
  await service(db);
  const pending = await enqueue(db, A);
  await user(db, A);
  assert.equal(
    (await call(db, "select public.cancel_ai_job($1) result", [pending.id]))
      .status,
    "cancelled",
  );
  await service(db);
  const running = await enqueue(db, A);
  const j = await claim(db);
  assert.equal(j.id, running.id);
  await user(db, A);
  const cancelled = await call(db, "select public.cancel_ai_job($1) result", [
    j.id,
  ]);
  assert.equal(cancelled.status, "processing");
  assert.equal(cancelled.cancel_requested, true);
  await service(db);
  const beat = await call(db, "select public.heartbeat_ai_job($1,$2) result", [
    j.id,
    j.lease_token,
  ]);
  assert.equal(beat.cancel_requested, true);
  await finish(db, j);
  await user(db, A);
  assert.equal(
    (await call(db, "select public.get_ai_jobs($1) result", [j.id]))[0].status,
    "cancelled",
  );
  await service(db);
  const retry = await enqueue(db, B);
  const lost = await claim(db);
  await owner(db);
  await db.query(
    "update public.ai_jobs set lease_until=now()-interval '1 second' where id=$1",
    [retry.id],
  );
  await service(db);
  await claim(db);
  assert.equal(await finish(db, lost), false);
  await owner(db);
  await db.query(
    "update public.ai_jobs set available_at=now()-interval '1 second' where id=$1",
    [retry.id],
  );
  await service(db);
  const retried = await claim(db);
  assert.equal(retried.id, retry.id);
  assert.notEqual(retried.lease_token, lost.lease_token);
  await owner(db);
  await db.query(
    "update public.ai_jobs set attempts=3,lease_until=now()-interval '1 second' where id=$1",
    [retry.id],
  );
  await service(db);
  await claim(db);
  await user(db, B);
  assert.equal(
    (await call(db, "select public.get_ai_jobs($1) result", [retry.id]))[0]
      .status,
    "error",
  );
  await owner(db);
  assert.equal(
    (
      await db.query("select requests from private.ai_usage where user_id=$1", [
        B,
      ])
    ).rows[0].requests,
    1,
  );
});
