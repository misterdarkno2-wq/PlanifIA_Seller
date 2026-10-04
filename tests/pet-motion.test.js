import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PET_MOTION_STORAGE_KEY,
  createPetMotionSettings,
} from "../src/pet-motion.js";

class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  listenerCount() {
    return [...this.listeners.values()].reduce(
      (sum, listeners) => sum + listeners.size,
      0,
    );
  }
}

function fixture({
  reduced = true,
  stored = null,
  readError = false,
  writeError = false,
} = {}) {
  const systemQuery = new TrackedTarget();
  systemQuery.matches = reduced;
  const eventTarget = new TrackedTarget();
  const values = new Map(
    stored === null ? [] : [[PET_MOTION_STORAGE_KEY, stored]],
  );
  const writes = [];
  const storage = {
    getItem(key) {
      if (readError) throw new Error("Storage unavailable");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (writeError) throw new Error("Storage unavailable");
      writes.push({ key, value });
      values.set(key, value);
    },
  };
  const settings = createPetMotionSettings({
    systemQuery,
    storage,
    eventTarget,
  });
  return {
    settings,
    systemQuery,
    eventTarget,
    storage,
    values,
    writes,
    system(matches) {
      systemQuery.matches = matches;
      systemQuery.dispatchEvent(new Event("change"));
    },
    external(newValue, key = PET_MOTION_STORAGE_KEY, storageArea = storage) {
      const event = new Event("storage");
      Object.assign(event, { key, newValue, storageArea });
      eventTarget.dispatchEvent(event);
    },
  };
}

test("Lumi está animada por defecto incluso si el dispositivo reduce el movimiento", () => {
  const { settings } = fixture();
  assert.equal(settings.mode, "animated");
  assert.equal(settings.systemReduced, true);
  assert.equal(settings.matches, false);
  settings.setMode("animated");
  assert.equal(settings.mode, "animated");
  assert.equal(settings.matches, false);
  assert.equal(
    settings.systemReduced,
    true,
    "La elección no altera la preferencia del sistema",
  );
  settings.setMode("calm");
  assert.equal(settings.matches, true);
  settings.setMode("auto");
  assert.equal(settings.matches, true);
  assert.throws(() => settings.setMode("unexpected"), RangeError);
  assert.equal(settings.mode, "auto");
  settings.dispose();
});

test("La elección de Lumi persiste en este dispositivo y se restaura al recargar", () => {
  for (const mode of ["auto", "animated", "calm"]) {
    const original = fixture({ reduced: false });
    original.settings.setMode(mode);
    assert.equal(original.values.get(PET_MOTION_STORAGE_KEY), mode);
    const reloaded = createPetMotionSettings({
      systemQuery: original.systemQuery,
      eventTarget: original.eventTarget,
      storage: original.storage,
    });
    assert.equal(reloaded.mode, mode);
    assert.equal(reloaded.matches, mode === "calm");
    original.settings.dispose();
    reloaded.dispose();
  }
});

test("Configuraciones ausentes o dañadas y errores de lectura mantienen Lumi animada", () => {
  for (const stored of [null, "", "invalid", "ANIMATED", "{}", '"calm"']) {
    const { settings, writes } = fixture({ stored, reduced: true });
    assert.equal(settings.mode, "animated", String(stored));
    assert.equal(settings.matches, false);
    assert.deepEqual(writes, [], "Leer una preferencia no debe escribirla");
    settings.dispose();
  }
  const { settings } = fixture({
    stored: "calm",
    readError: true,
    reduced: false,
  });
  assert.equal(settings.mode, "animated");
  assert.equal(settings.matches, false);
  settings.dispose();
});

test("Si el almacenamiento rechaza una escritura la elección sigue funcionando durante la sesión", () => {
  const { settings, system } = fixture({ writeError: true });
  assert.doesNotThrow(() => settings.setMode("animated"));
  assert.equal(settings.mode, "animated");
  assert.equal(settings.matches, false);
  system(false);
  system(true);
  assert.equal(settings.matches, false);
  assert.doesNotThrow(() => settings.setMode("calm"));
  assert.equal(settings.matches, true);
  settings.dispose();
});

test("Los cambios del sistema se reflejan en automático y notifican sin anular elecciones explícitas", () => {
  const f = fixture({ reduced: false, stored: "auto" });
  const changes = [];
  const listener = () =>
    changes.push({
      mode: f.settings.mode,
      reduced: f.settings.matches,
      system: f.settings.systemReduced,
    });
  f.settings.addEventListener("change", listener);
  f.system(true);
  assert.deepEqual(changes.at(-1), {
    mode: "auto",
    reduced: true,
    system: true,
  });
  f.settings.setMode("animated");
  f.system(false);
  assert.deepEqual(changes.at(-1), {
    mode: "animated",
    reduced: false,
    system: false,
  });
  f.system(true);
  assert.deepEqual(changes.at(-1), {
    mode: "animated",
    reduced: false,
    system: true,
  });
  f.settings.setMode("calm");
  f.system(false);
  assert.deepEqual(changes.at(-1), {
    mode: "calm",
    reduced: true,
    system: false,
  });
  const before = changes.length;
  f.settings.setMode("calm");
  f.system(false);
  assert.equal(
    changes.length,
    before,
    "Un valor idéntico no duplica notificaciones",
  );
  f.settings.removeEventListener("change", listener);
  f.settings.setMode("auto");
  assert.equal(changes.length, before);
  f.settings.dispose();
});

test("Las otras pestañas sincronizan la elección sin reescribir ni reaccionar a claves ajenas", () => {
  const f = fixture();
  f.external("animated");
  assert.equal(f.settings.mode, "animated");
  assert.equal(f.settings.matches, false);
  f.external("calm", "another-setting");
  f.external("calm", PET_MOTION_STORAGE_KEY, {});
  assert.equal(f.settings.mode, "animated");
  f.external("calm");
  assert.equal(f.settings.mode, "calm");
  assert.equal(f.settings.matches, true);
  f.external("invalid");
  assert.equal(f.settings.mode, "animated");
  f.external("calm");
  f.external(null);
  assert.equal(f.settings.mode, "animated");
  assert.equal(f.settings.matches, false);
  f.external("auto");
  assert.equal(f.settings.mode, "auto");
  assert.equal(f.settings.matches, true);
  f.external(null, null);
  assert.equal(
    f.settings.mode,
    "animated",
    "Limpiar el almacenamiento en otra pestaña restaura Lumi animada",
  );
  assert.deepEqual(
    f.writes,
    [],
    "Sincronizar no debe provocar ecos de escritura",
  );
  f.settings.dispose();
});

test("Desmontar las preferencias limpia los listeners y no permite reactivaciones", () => {
  const f = fixture();
  let changes = 0;
  f.settings.addEventListener("change", () => changes++);
  assert.equal(f.systemQuery.listenerCount(), 1);
  assert.equal(f.eventTarget.listenerCount(), 1);
  f.settings.dispose();
  f.settings.dispose();
  assert.equal(f.systemQuery.listenerCount(), 0);
  assert.equal(f.eventTarget.listenerCount(), 0);
  f.system(false);
  f.external("animated");
  f.settings.setMode("animated");
  assert.equal(f.settings.mode, "animated");
  assert.equal(f.settings.matches, false);
  assert.equal(changes, 0);
  assert.deepEqual(f.writes, []);
});
