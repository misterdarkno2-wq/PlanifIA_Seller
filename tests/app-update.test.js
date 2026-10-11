import { test } from "node:test";
import assert from "node:assert/strict";
import { updateAction, createUpdateChecker } from "../src/app-update.js";

const info = (extra = {}) => ({ available: true, status: "available", immediate: true, priority: 0, stalenessDays: 0, ...extra });

test("an update on Google Play is offered, required when urgent or old, and resumed if interrupted", () => {
  assert.equal(updateAction(info()), "offer");
  assert.equal(updateAction(info({ priority: 4 })), "required");
  assert.equal(updateAction(info({ stalenessDays: 14 })), "required");
  assert.equal(updateAction(info({ status: "in_progress" })), "resume");
  // Sin actualización, sin Google Play (APK instalado a mano o escritorio) o sin flujo inmediato.
  assert.equal(updateAction(info({ status: "none" })), "none");
  assert.equal(updateAction({ available: false }), "none");
  assert.equal(updateAction(null), "none");
  assert.equal(updateAction(info({ immediate: false })), "none");
});

test("'Más tarde' postpones an optional update for a day but never a required one", async () => {
  let clock = 1_000_000;
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let answer = info();
  const checker = createUpdateChecker({ native: async () => answer, storage, now: () => clock });

  assert.equal((await checker.check()).action, "offer");
  checker.later();
  assert.equal((await checker.check()).action, "none");
  answer = info({ priority: 5 });
  assert.equal((await checker.check()).action, "required");
  answer = info();
  clock += 24 * 60 * 60 * 1000 + 1;
  assert.equal((await checker.check()).action, "offer");
});

test("a Google Play failure or blocked storage never breaks the app", async () => {
  const failing = createUpdateChecker({ native: async () => { throw new Error("sin Play"); } });
  assert.deepEqual(await failing.check(), { info: null, action: "none" });
  const blocked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } };
  const checker = createUpdateChecker({ native: async () => info(), storage: blocked });
  assert.equal((await checker.check()).action, "offer");
  assert.doesNotThrow(() => checker.later());
});
