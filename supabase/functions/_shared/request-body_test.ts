import { BodyTooLarge, readRequestText } from "./request-body.ts";
function assert(value: unknown) { if (!value) throw new Error("Assertion failed"); }

Deno.test("La lectura acotada conserva UTF-8 dividido entre fragmentos", async () => {
  const bytes = new TextEncoder().encode("Hola, ¿cómo estás? 🌱");
  const body = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
  assert(await readRequestText(new Request("https://fixture.test", { method: "POST", body }), 100) === "Hola, ¿cómo estás? 🌱");
});

Deno.test("Cancela cuerpos grandes sin confiar en Content-Length", async () => {
  for (const headers of [{}, { "Content-Length": "1" }, { "Content-Length": "1000" }] as Record<string, string>[]) {
    let cancelled = false, rejected = false;
    const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
    try { await readRequestText(new Request("https://fixture.test", { method: "POST", body, headers }), 30); }
    catch (error) { rejected = error instanceof BodyTooLarge; }
    assert(rejected);
    assert(cancelled);
  }
});
