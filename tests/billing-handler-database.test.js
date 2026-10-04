// Edge handlers call the real migration through a minimal local PostgREST fixture.
// Transbank responses are synthetic; no real card or payment is involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  C = "33333333-3333-4333-8333-333333333333";
test(
  "Edge handlers + migraciones reales: pagos, inscripción, reintentos, cancelación y aislamiento",
  { timeout: 90000 },
  async () => {
    const db = new PGlite();
    let server;
    try {
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
      ])
        await db.exec(
          await readFile(
            new URL("../supabase/migrations/" + name, import.meta.url),
            "utf8",
          ),
        );
      await db.query(
        "insert into auth.users(id,email) values($1,'a@example.test'),($2,'b@example.test'),($3,'c@example.test')",
        [A, B, C],
      );
      let queue = Promise.resolve();
      server = createServer((req, res) => {
        const operation = async () => {
          let raw = "";
          for await (const chunk of req) raw += chunk;
          const body = raw ? JSON.parse(raw) : {},
            path = new URL(req.url, "http://localhost").pathname;
          const token = req.headers.authorization;
          let data;
          if (path === "/auth/v1/user") {
            if (
              ![
                "Bearer fixture-user-a",
                "Bearer fixture-user-b",
                "Bearer fixture-user-c",
              ].includes(token)
            ) {
              res.writeHead(401);
              res.end(JSON.stringify({ msg: "Invalid token" }));
              return;
            }
            const id = token.endsWith("-a") ? A : token.endsWith("-b") ? B : C;
            data = {
              id,
              email:
                id === A
                  ? "a@example.test"
                  : id === B
                    ? "b@example.test"
                    : "c@example.test",
              aud: "authenticated",
            };
          } else if (path === "/fixture/admin") {
            // Test-only control, bound to localhost and never shipped in Edge code.
            await db.exec("reset role");
            data = (await db.query(body.sql, body.params || [])).rows;
          } else {
            if (token === "Bearer fixture-service")
              await db.exec("reset role;set role service_role;");
            else if (
              [
                "Bearer fixture-user-a",
                "Bearer fixture-user-b",
                "Bearer fixture-user-c",
              ].includes(token)
            ) {
              const id = token.endsWith("-a")
                ? A
                : token.endsWith("-b")
                  ? B
                  : C;
              await db.exec(
                `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
              );
            } else await db.exec("reset role;set role anon;");
            if (path === "/rest/v1/rpc/billing_admin")
              data = (
                await db.query(
                  "select public.billing_admin($1,$2::jsonb) result",
                  [body.p_action, JSON.stringify(body.p_payload)],
                )
              ).rows[0].result;
            else if (path === "/rest/v1/rpc/billing_state")
              data = (await db.query("select public.billing_state() result"))
                .rows[0].result;
            else if (path === "/rest/v1/rpc/manage_subscription")
              data = (
                await db.query(
                  "select public.manage_subscription($1,$2,$3) result",
                  [
                    body.p_action,
                    body.p_plan_id,
                    body.p_recurring_consent || false,
                  ],
                )
              ).rows[0].result;
            else if (path === "/rest/v1/plan_catalog")
              data = (
                await db.query(
                  "select * from public.plan_catalog where enabled order by position",
                )
              ).rows;
            else throw new Error("Unexpected fixture route");
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        };
        queue = queue.then(operation).catch((error) => {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              code: error.code || "fixture_error",
              message: error.message,
            }),
          );
        });
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      const args = [
        "--yes",
        "deno",
        "run",
        "--no-config",
        "--no-lock",
        "--node-modules-dir=none",
        "--allow-env",
        `--allow-net=127.0.0.1:${port}`,
        "tests/billing-edge-db.ts",
      ];
      const child =
        process.platform === "win32"
          ? spawn(
              process.env.ComSpec || "cmd.exe",
              ["/d", "/s", "/c", "npx.cmd " + args.join(" ")],
              {
                cwd: new URL("..", import.meta.url),
                env: { ...process.env, BILLING_FIXTURE_PORT: String(port) },
                windowsHide: true,
              },
            )
          : spawn("npx", args, {
              cwd: new URL("..", import.meta.url),
              env: { ...process.env, BILLING_FIXTURE_PORT: String(port) },
            });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      const exit = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      assert.equal(exit, 0, output);
      assert.match(output, /billing-edge-db: verified/);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  },
);
