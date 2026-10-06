export const isNative = () => Boolean(globalThis.window?.__TAURI_INTERNALS__);

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
