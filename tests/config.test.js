import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("Una compilación pública rechaza las claves administrativas y de IA", () => {
  for (const value of [
    "sb_secret_test-only-fixture",
    "sk-test-only-fixture",
    "header." +
      Buffer.from(JSON.stringify({ role: "service_role" })).toString(
        "base64url",
      ) +
      ".signature",
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/check-public-config.js"],
      {
        env: { ...process.env, VITE_SUPABASE_PUBLISHABLE_KEY: value },
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /privada|pública/);
    assert.equal(result.stderr.includes(value), false);
  }
});

test("El control también revisa los archivos de entorno de producción", () => {
  const folder = mkdtempSync(join(tmpdir(), "planifia-config-"));
  try {
    writeFileSync(
      join(folder, ".env.production.local"),
      "VITE_AI_KEY=sk-test-only-fixture\n",
    );
    const script = fileURLToPath(
      new URL("../scripts/check-public-config.js", import.meta.url),
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: folder,
      env: process.env,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /privada/);
    assert.equal(result.stderr.includes("sk-test-only-fixture"), false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("Transbank y el secreto de renovaciones quedan fuera de la web publicada", () => {
  for (const key of [
    "VITE_TRANSBANK_API_KEY",
    "VITE_TRANSBANK_COMMERCE_CODE",
    "VITE_BILLING_CRON_SECRET",
  ]) {
    const value = "private-payment-fixture";
    const result = spawnSync(
      process.execPath,
      ["scripts/check-public-config.js"],
      {
        env: { ...process.env, [key]: value },
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /privada/);
    assert.equal(result.stderr.includes(value), false);
  }
});
