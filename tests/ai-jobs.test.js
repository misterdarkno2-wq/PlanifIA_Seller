import { test } from "node:test";
import assert from "node:assert/strict";
import { createAiJobMonitor, jobDescription } from "../src/ai-jobs.js";
const pause = () => new Promise((r) => setTimeout(r, 10));
test("Reload recovery, cancellation and completion notifications use persisted jobs; network errors preserve last state", async (t) => {
  let status = "queued",
    failed = false,
    notifications = 0;
  const monitor = createAiJobMonitor({
    pollMs: 10000,
    visibility: () => false,
    list: async () => {
      if (failed) throw Error("offline");
      return [
        {
          id: "owned",
          status,
          plan_id: "free",
          position: 1,
          estimated_seconds: null,
          worker_online: false,
        },
      ];
    },
    cancel: async () => ({ id: "owned", status: "cancelled" }),
    notify: () => notifications++,
  });
  t.after(() => monitor.stop());
  monitor.start("account");
  await pause();
  assert.match(jobDescription(monitor.jobs[0]), /desconectada/);
  failed = true;
  await monitor.refresh();
  assert.equal(monitor.jobs[0].status, "queued");
  assert.ok(monitor.error);
  failed = false;
  status = "completed";
  await monitor.refresh();
  assert.equal(notifications, 1);
  await monitor.refresh();
  assert.equal(notifications, 1);
  monitor.stop();
  monitor.start("account");
  await pause();
  assert.equal(monitor.jobs[0].status, "completed");
  assert.equal(notifications, 1);
  await monitor.cancel("owned");
  assert.equal(monitor.jobs[0].status, "cancelled");
  monitor.stop();
});
test("Late polling results from a previous account are discarded", async (t) => {
  let release;
  const pending = new Promise((r) => (release = r));
  let calls = 0;
  const monitor = createAiJobMonitor({
    list: () =>
      ++calls === 1
        ? pending
        : Promise.resolve([{ id: "second", status: "queued" }]),
    cancel: async () => {},
    visibility: () => false,
    pollMs: 5,
  });
  t.after(() => monitor.stop());
  monitor.start("first");
  monitor.start("second");
  release([{ id: "private-first", status: "completed" }]);
  await pause();
  assert.equal(monitor.jobs[0].id, "second");
  monitor.stop();
});
