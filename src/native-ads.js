import { isNative } from "./platform.js";

export const isAndroidApp = () =>
  isNative() && /Android/i.test(globalThis.navigator?.userAgent || "");

// Comandos del plugin planifia-ads. Fuera de Android responden "no disponible" sin error.
export async function adsCommand(command, args = {}) {
  if (!isAndroidApp()) return { available: false };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(`plugin:planifia-ads|${command}`, args);
}
export async function onAdsEvent(event, handler) {
  if (!isAndroidApp()) return () => {};
  const { addPluginListener } = await import("@tauri-apps/api/core");
  const listener = await addPluginListener("planifia-ads", event, handler);
  return () => listener.unregister().catch(() => {});
}

/**
 * Reglas de anuncios: sólo plan Gratis, consentimiento UMP antes de cargar nada y únicamente
 * anuncios recompensados que la persona elige ver para ganar créditos. Sin banner ni intersticiales.
 */
export function createAdManager({ native = adsCommand, onError = () => {} } = {}) {
  let eligible = false,
    ready = false,
    starting = null,
    privacyRequired = false,
    testAds = false;
  function start() {
    if (!eligible) return Promise.resolve(false);
    starting ||= native("init_ads")
      .then((state) => {
        ready = Boolean(state?.available && state.initialized && state.canRequestAds);
        privacyRequired = Boolean(state?.privacyOptionsRequired);
        testAds = Boolean(state?.testAds);
        if (ready) native("load_rewarded").catch(() => {});
        else starting = null;
        return ready;
      })
      .catch((error) => {
        starting = null;
        onError(error);
        return false;
      });
    return starting;
  }
  return {
    get eligible() {
      return eligible;
    },
    get ready() {
      return ready;
    },
    get privacyRequired() {
      return privacyRequired;
    },
    get testAds() {
      return testAds;
    },
    async setEligible(value) {
      eligible = Boolean(value);
      if (eligible) await start();
    },
    /** Anuncio voluntario; el servidor acredita los créditos cuando AdMob confirma (SSV). */
    async rewarded(userId) {
      if (!eligible) return { shown: false, earned: false, reason: "not_eligible" };
      if (!(await start())) return { shown: false, earned: false, reason: "not_ready" };
      let result = await native("show_rewarded", { userId });
      if (!result?.shown && result?.reason === "not_loaded") {
        const loaded = await native("load_rewarded");
        if (loaded?.loaded) result = await native("show_rewarded", { userId });
      }
      return result || { shown: false, earned: false };
    },
    async privacyOptions() {
      const state = await native("show_privacy_options");
      privacyRequired = Boolean(state?.privacyOptionsRequired);
      return state;
    },
  };
}
