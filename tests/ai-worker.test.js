import { test } from "node:test";
import assert from "node:assert/strict";
import { startAiWorker } from "../scripts/ai-worker.js";
import { generateValidatedPlan, PlanGenerationError } from "../supabase/functions/_shared/generate-plan.ts";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test("Agotar la corrección de una propuesta no reinicia la generación desde la cola", async () => {
  let calls = 0, claimed = false, finished, complete;
  const done = new Promise((resolve) => { complete = resolve; });
  const worker = startAiWorker({
    rpc: async (name, args) => {
      if (name === "claim_ai_job") return { data: claimed ? null : ((claimed = true), { id: "job", lease_token: "lease" }) };
      if (name === "finish_ai_job") { finished = args; complete(); return { data: true }; }
    },
    generate: () => generateValidatedPlan({
      endpoint: "https://fixture.test/v1", apiKey: "fixture", model: "fixture",
      requestData: { idea: "Aprender" },
      limits: { weeklyMinutes: 60, remainingDaily: {}, remainingWeekly: [60], startDate: "2026-10-09", availableDays: [5] },
      fetchImpl: async () => {
        calls++;
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{}' } }] });
      },
    }),
  });
  try { await done; } finally { worker.stop(); }
  assert.equal(calls, 2);
  assert.equal(finished.p_result, null);
  assert.equal(finished.p_retry, false);
});

test("Los fallos transitorios conservan los reintentos de la cola", async () => {
  for (const status of [429, 502, 504]) {
    let claimed = false, finished, complete;
    const done = new Promise((resolve) => { complete = resolve; });
    const worker = startAiWorker({
      rpc: async (name, args) => {
        if (name === "claim_ai_job") return { data: claimed ? null : ((claimed = true), { id: "job", lease_token: "lease" }) };
        if (name === "finish_ai_job") { finished = args; complete(); return { data: true }; }
      },
      generate: async () => { throw new PlanGenerationError(status, "Transitorio"); },
    });
    try { await done; } finally { worker.stop(); }
    assert.equal(finished.p_retry, true);
  }
});

test("Worker survives browser absence, renews lease, handles processing cancellation without saving a proposal", async () => {
  let claimed = false,
    cancelled = false,
    finished,
    resolve;
  const done = new Promise((r) => (resolve = r));
  const rpc = async (name, args) => {
    if (name === "claim_ai_job")
      return {
        data: claimed
          ? null
          : ((claimed = true),
            { id: "owned", lease_token: "fence", payload: {} }),
      };
    if (name === "heartbeat_ai_job")
      return { data: { owned: true, cancel_requested: cancelled } };
    if (name === "finish_ai_job") {
      finished = args;
      resolve();
      return { data: true };
    }
  };
  let generating = 0,
    max = 0;
  const worker = startAiWorker({
    rpc,
    pollMs: 5,
    heartbeatMs: 5,
    generate: async (_j, signal) => {
      generating++;
      max = Math.max(max, generating);
      try {
        await new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      } finally {
        generating--;
      }
    },
  });
  await pause(10);
  cancelled = true;
  await done;
  worker.stop();
  assert.equal(max, 1);
  assert.equal(finished.p_result, null);
  assert.equal(finished.p_token, "fence");
  assert.equal(finished.p_retry, false);
});

test("Lost lease aborts generation; unavailable DB never submits an unclaimed GPU request", async () => {
  let calls = 0,
    claimed = false,
    finished,
    resolve;
  const done = new Promise((r) => (resolve = r));
  const worker = startAiWorker({
    pollMs: 5,
    heartbeatMs: 5,
    rpc: async (name, args) => {
      if (name === "claim_ai_job")
        return {
          data: claimed
            ? null
            : ((claimed = true), { id: "owned", lease_token: "old" }),
        };
      if (name === "heartbeat_ai_job") return { error: { code: "offline" } };
      if (name === "finish_ai_job") {
        finished = args;
        resolve();
        return { data: false };
      }
    },
    generate: async (_job, signal) => {
      calls++;
      await new Promise((_r, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      );
    },
  });
  await done;
  worker.stop();
  assert.equal(calls, 1);
  assert.equal(finished.p_result, null);
  const offline = startAiWorker({
    rpc: async () => ({ error: {} }),
    generate: async () => calls++,
    pollMs: 5,
  });
  await pause(15);
  offline.stop();
  assert.equal(calls, 1);
});
