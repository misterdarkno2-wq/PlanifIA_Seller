import { test } from "node:test";
import assert from "node:assert/strict";

// Simula un WebView sin las funciones recientes antes de cargar src/compat.js.
const saved = { at: Array.prototype.at, hasOwn: Object.hasOwn };
delete Array.prototype.at;
delete Object.hasOwn;
const randomUUID = crypto.randomUUID;
crypto.randomUUID = undefined;
await import("../src/compat.js");

test.after(() => {
  Array.prototype.at = saved.at;
  Object.hasOwn = saved.hasOwn;
  crypto.randomUUID = randomUUID;
});

test("compat completa at, hasOwn y randomUUID", () => {
  assert.equal([1, 2, 3].at(-1), 3);
  assert.equal([1, 2, 3].at(0), 1);
  assert.equal(Object.hasOwn({ a: 1 }, "a"), true);
  assert.equal(Object.hasOwn({}, "toString"), false);
  assert.match(crypto.randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

