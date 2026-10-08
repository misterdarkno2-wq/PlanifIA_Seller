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

const LAST_KEY = "planifia-ads-last-video";
// Video obligatorio al usar la IA en el plan Gratis: como máximo uno cada 5 minutos.
export const AI_VIDEO_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Reglas de anuncios: sólo plan Gratis y consentimiento UMP antes de cargar nada. Sin banner.
 * - Video de pantalla completa mientras la IA prepara un plan, máximo uno cada 5 minutos y nunca
 *   en el primer plan. Lo quita la compra única "Quitar anuncios".
 * - Anuncio recompensado voluntario para ganar créditos (sigue disponible aunque se compre
 *   "Quitar anuncios").
 */
export function createAdManager({
  native = adsCommand,
  now = () => Date.now(),
  storage = globalThis.localStorage,
  onError = () => {},
} = {}) {
  let eligible = false,
    // null hasta que el servidor confirme si la cuenta compró "Quitar anuncios".
    adFree = null,
    ready = false,
    starting = null,
    privacyRequired = false,
    testAds = false;
  const readLast = () => {
    try {
      return Number(storage?.getItem(LAST_KEY)) || 0;
    } catch {
      return 0;
    }
  };
  const writeLast = (value) => {
    try {
      storage?.setItem(LAST_KEY, String(value));
    } catch {}
  };
  const wantsVideo = () => eligible && adFree === false;
  function start() {
    if (!eligible) return Promise.resolve(false);
    starting ||= native("init_ads")
      .then((state) => {
        ready = Boolean(state?.available && state.initialized && state.canRequestAds);
        privacyRequired = Boolean(state?.privacyOptionsRequired);
        testAds = Boolean(state?.testAds);
        if (ready) {
          native("load_rewarded").catch(() => {});
          if (wantsVideo()) native("load_interstitial").catch(() => {});
        } else starting = null;
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
    get adFree() {
      return adFree === true;
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
    setAdFree(value) {
      adFree = Boolean(value);
      if (ready && wantsVideo()) native("load_interstitial").catch(() => {});
    },
    /** Video mientras la IA trabaja. Nunca en el primer plan ni más de uno cada 5 minutos. */
    async aiVideo({ firstTime = false } = {}) {
      if (!wantsVideo() || firstTime) return false;
      const last = readLast();
      if (last && now() - last < AI_VIDEO_INTERVAL_MS) return false;
      if (!(await start())) return false;
      const result = await native("show_interstitial").catch(() => null);
      if (result?.shown) writeLast(now());
      return Boolean(result?.shown);
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
