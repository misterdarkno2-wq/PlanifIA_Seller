export const isNative = () => Boolean(globalThis.window?.__TAURI_INTERNALS__);

// Señal con tiempo límite para fetch. AbortSignal.timeout llegó en Chrome 103 y AbortSignal.any en
// Chrome 116: un WebView más antiguo (Android 8 y 9 sin actualizar) fallaba en cada consulta.
export function requestSignal(ms, signal, api = globalThis.AbortSignal) {
  if (typeof api?.timeout === "function" && (!signal || typeof api.any === "function")) {
    const timeout = api.timeout(ms);
    return signal ? api.any([signal, timeout]) : timeout;
  }
  const controller = new AbortController();
  const abort = (reason) => { if (!controller.signal.aborted) controller.abort(reason); };
  const timer = setTimeout(() => abort(new DOMException("signal timed out", "TimeoutError")), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  if (signal?.aborted) abort(signal.reason);
  else signal?.addEventListener("abort", () => abort(signal.reason), { once: true });
  return controller.signal;
}

// Hay una sesión guardada que Supabase todavía está recuperando (sin localStorage, no).
export function hasStoredSession(key, storage = globalThis.localStorage) {
  try {
    return Boolean(storage?.getItem(key));
  } catch {
    return false;
  }
}

export function backAction({ modalOpen, hash, canGoBack }) {
  if (modalOpen) return "modal";
  if (["", "#home", "#today"].includes(hash)) return "exit";
  return canGoBack ? "history" : "home";
}

export async function installNativeBack({ modalOpen, closeModal, goHome, onError }) {
  if (!isNative() || !/Android/i.test(navigator.userAgent)) return;
  const { onBackButtonPress, exit } = await import("@tauri-apps/api/app");
  const listener = await onBackButtonPress(({ canGoBack }) => {
    switch (backAction({ modalOpen: modalOpen(), hash: location.hash, canGoBack })) {
      case "modal": closeModal(); break;
      case "history": history.back(); break;
      case "home": goHome(); break;
      case "exit": exit(0).catch(onError); break;
    }
  });
  window.addEventListener("pagehide", () => listener.unregister().catch(onError), { once: true });
}

// On Android the app draws under the status and gesture bars; MainActivity reports their size.
export function watchSafeArea() {
  const bridge = globalThis.window?.PlanifiaInsets;
  if (!bridge) return;
  const apply = () => {
    try {
      const insets = JSON.parse(bridge.get());
      for (const side of ["top", "right", "bottom", "left", "ime"]) {
        document.documentElement.style.setProperty(`--inset-${side}`, `${Math.round(Number(insets[side]) || 0)}px`);
      }
      // Teclado abierto: la ventana no cambia de tamaño, así que la interfaz sube sus campos.
      document.documentElement.classList.toggle("keyboard-open", Number(insets.ime) > 0);
    } catch {
      // Keep the CSS env() fallback.
    }
  };
  apply();
  window.addEventListener("planifia-insets", apply);
}

/**
 * Supabase agrega "#access_token=…" (o "#error=…") a la dirección de retorno. Si esa dirección ya traía
 * un fragmento, como "#reset" en las versiones anteriores de la app, queda "#reset#access_token=…" y
 * supabase-js no reconoce el enlace: no abre la sesión y el token se queda a la vista. Devuelve el
 * fragmento corregido, o null si no hay nada que corregir.
 */
export function repairedAuthHash(hash = "") {
  // Sólo el prefijo que generaba la app ("#reset#"). No da acceso a nada nuevo: el mismo enlace con un
  // solo "#" ya lo acepta supabase-js.
  const match = /^#reset#(.+)$/.exec(hash);
  return match && /(^|&)(access_token|error|error_code|error_description)=/.test(match[1]) ? `#${match[1]}` : null;
}

// Se llama antes de crear el cliente de Supabase (src/cloud.js), que lee la dirección al iniciar. Sin
// nada que corregir reescribe la misma dirección, sin efecto (replaceState no navega ni recarga).
export function repairAuthHash(location = globalThis.location, history = globalThis.history) {
  if (!location || !history) return;
  const hash = repairedAuthHash(location.hash) ?? location.hash;
  history.replaceState(history.state, "", `${location.pathname}${location.search}${hash}`);
}

// Email links must open a publicly reachable website, never an APK's local origin.
export function authRedirect(fragment = "") {
  const base = isNative() ? "https://planifia.cl/" : location.origin + location.pathname;
  return base + fragment;
}

export async function downloadJson(name, data) {
  const text = JSON.stringify(data, null, 2);
  if (isNative()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({ defaultPath: name, filters: [{ name: "Respaldo JSON", extensions: ["json"] }] });
    if (!path) return false;
    // The picker grants access only to the selected path/Android content URI.
    await writeTextFile(path, text);
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
