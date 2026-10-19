// Límite por IP: la IP no sale de la función (sólo un hash con secreto) y una caída de la base no bloquea.
import { allowIp, clientIp, ipKey } from "./rate-limit.ts";

function assert(condition: unknown, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}
const request = (headers: Record<string, string>) => new Request("https://function.example.test", { method: "POST", headers });

Deno.test("Toma la primera IP de X-Forwarded-For y descarta valores que no son una IP", () => {
  assert(clientIp(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })) === "203.0.113.7");
  assert(clientIp(request({ "x-real-ip": "2001:db8::1" })) === "2001:db8::1");
  assert(clientIp(request({ "x-forwarded-for": "<script>" })) === "");
  assert(clientIp(request({})) === "");
});

Deno.test("Envía a la base un hash SHA-256 con secreto, nunca la IP", async () => {
  const calls: Record<string, unknown>[] = [];
  const admin = { rpc: (_name: string, args: Record<string, unknown>) => (calls.push(args), Promise.resolve({ data: true, error: null })) };
  assert(await allowIp(admin, request({ "x-forwarded-for": "203.0.113.7" }), { salt: "test-only-salt" }));
  assert(calls.length === 1);
  assert(calls[0].p_key === await ipKey("203.0.113.7", "test-only-salt"));
  assert(/^[0-9a-f]{64}$/.test(String(calls[0].p_key)) && !JSON.stringify(calls[0]).includes("203.0.113.7"));
  assert(await ipKey("203.0.113.7", "otro") !== calls[0].p_key, "Sin el secreto no se puede recalcular");
});

Deno.test("Corta al superar el límite, deja pasar sin IP y no bloquea si la base falla", async () => {
  const deny = { rpc: () => Promise.resolve({ data: false, error: null }) };
  const broken = { rpc: () => Promise.resolve({ data: null, error: { code: "PGRST000" } }) };
  let called = false;
  const spy = { rpc: () => ((called = true), Promise.resolve({ data: false, error: null })) };
  assert(!(await allowIp(deny, request({ "x-forwarded-for": "203.0.113.7" }), { salt: "s" })));
  assert(await allowIp(broken, request({ "x-forwarded-for": "203.0.113.7" }), { salt: "s" }));
  assert(await allowIp(spy, request({}), { salt: "s" }) && !called, "Sin IP no consulta la base");
});
