export const PET_MOTION_STORAGE_KEY = "planifia-lumi-motion";
const MODES = new Set(["auto", "animated", "calm"]);

/** A browser preference for Lumi, independent of the rest of the interface. */
export function createPetMotionSettings({
  systemQuery,
  storage,
  eventTarget,
} = {}) {
  const browser = typeof window === "undefined" ? null : window;
  eventTarget ??= browser;
  systemQuery ??= browser?.matchMedia("(prefers-reduced-motion: reduce)");
  if (storage === undefined) {
    try {
      storage = browser?.localStorage;
    } catch {
      // A blocked storage area still allows a preference for this session.
    }
  }
  let mode = "auto";
  try {
    const saved = storage?.getItem(PET_MOTION_STORAGE_KEY);
    if (MODES.has(saved)) mode = saved;
  } catch {
    // Automatic motion remains the default if storage cannot be read.
  }
  let systemReduced = Boolean(systemQuery?.matches);
  let disposed = false;
  const listeners = new Set();
  const settings = {
    get mode() {
      return mode;
    },
    get systemReduced() {
      return systemReduced;
    },
    get matches() {
      return mode === "calm" || (mode === "auto" && systemReduced);
    },
    setMode(next) {
      if (disposed) return;
      if (!MODES.has(next)) throw new RangeError("Unknown Lumi motion mode");
      try {
        storage?.setItem(PET_MOTION_STORAGE_KEY, next);
      } catch {
        // Motion can change now even when the browser cannot save it.
      }
      if (mode === next) return;
      mode = next;
      notify();
    },
    addEventListener(type, listener) {
      if (type === "change" && listener && !disposed) listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "change") listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      systemQuery?.removeEventListener("change", systemChange);
      eventTarget?.removeEventListener("storage", storageChange);
    },
  };
  function notify() {
    const event = {
      type: "change",
      target: settings,
      currentTarget: settings,
      matches: settings.matches,
      mode,
      systemReduced,
    };
    for (const listener of [...listeners]) {
      if (typeof listener === "function") listener.call(settings, event);
      else listener.handleEvent?.(event);
    }
  }
  function systemChange() {
    if (disposed) return;
    const next = Boolean(systemQuery.matches);
    if (next === systemReduced) return;
    systemReduced = next;
    notify();
  }
  function storageChange(event) {
    if (
      disposed ||
      (event.key !== null && event.key !== PET_MOTION_STORAGE_KEY) ||
      (event.storageArea && event.storageArea !== storage)
    )
      return;
    const next = MODES.has(event.newValue) ? event.newValue : "auto";
    if (next === mode) return;
    mode = next;
    notify();
  }
  systemQuery?.addEventListener("change", systemChange);
  eventTarget?.addEventListener("storage", storageChange);
  return settings;
}

let browserSettings;
/** Lazily initialized so importing the module is also safe in Node tests. */
export function getPetMotionSettings() {
  browserSettings ??= createPetMotionSettings();
  return browserSettings;
}
