import { test } from "node:test";
import assert from "node:assert/strict";
import { backAction, authRedirect, isNative, downloadJson } from "../src/platform.js";

test("Android Back closes modals before navigating, returns through history and exits at home", () => {
  assert.equal(backAction({ modalOpen: true, hash: "#today", canGoBack: true }), "modal");
  assert.equal(backAction({ modalOpen: false, hash: "#goals", canGoBack: true }), "history");
  assert.equal(backAction({ modalOpen: false, hash: "#settings", canGoBack: false }), "home");
  for (const hash of ["", "#home", "#today"]) assert.equal(backAction({ modalOpen: false, hash, canGoBack: true }), "exit");
});

test("email confirmation and recovery target the public website inside Tauri", () => {
  globalThis.window = { __TAURI_INTERNALS__: {} };
  assert.equal(isNative(), true);
  assert.equal(authRedirect("#reset"), "https://planifia.cl/#reset");
  delete globalThis.window;
  globalThis.location = { origin: "http://127.0.0.1:5173", pathname: "/" };
  assert.equal(authRedirect(), "http://127.0.0.1:5173/");
  delete globalThis.location;
});

test("native export awaits the write and propagates disk errors; cancel writes nothing", async () => {
  let cancelled = false, fail = false, writes = 0;
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command) => {
    if (command === "plugin:dialog|save") return cancelled ? null : "content://selected/backup";
    assert.equal(command, "plugin:fs|write_text_file");
    await new Promise(resolve => setTimeout(resolve, 10));
    if (fail) throw new Error("Disco lleno");
    writes++;
  } } };
  try {
    assert.equal(await downloadJson("backup.json", { test: true }), true);
    assert.equal(writes, 1);
    cancelled = true;
    assert.equal(await downloadJson("backup.json", {}), false);
    assert.equal(writes, 1);
    cancelled = false; fail = true;
    await assert.rejects(downloadJson("backup.json", {}), /Disco lleno/);
  } finally { delete globalThis.window; }
});
