import { isNative } from "./platform.js";
import { ADS } from "./monetization-config.js";

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

const LAST_KEY = "planifia-ads-last-interstitial";

/**
 * Reglas de anuncios: sólo plan Gratis, consentimiento UMP antes de cargar nada, banner fuera de
 * pagos y formularios, y como máximo un intersticial cada 5 minutos en pausas naturales.
 */
export function createAdManager({
  native = adsCommand,
  now = () => Date.now(),
  storage = globalThis.localStorage,
  config = ADS,
  onBannerHeight = () => {},
  onError = () => {},
} = {}) {
  let eligible = false,
    ready = false,
    starting = null,
    route = null,
    modalOpen = false,
    bannerShown = false,
    bannerBusy = Promise.resolve(),
    privacyRequired = false,
    testAds = false;
  const routes = new Set(config.bannerRoutes);
  const pauses = new Set(config.interstitialPauses);
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
  function start() {
    if (!eligible) return Promise.resolve(false);
    starting ||= native("init_ads")
      .then((state) => {
        ready = Boolean(state?.available && state.initialized && state.canRequestAds);
        privacyRequired = Boolean(state?.privacyOptionsRequired);
        testAds = Boolean(state?.testAds);
        if (ready) {
          native("load_interstitial").catch(() => {});
          native("load_rewarded").catch(() => {});
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
  // Las llamadas al banner se encadenan para que mostrar/ocultar nunca se crucen.
  function syncBanner() {
    bannerBusy = bannerBusy.then(async () => {
      const want = eligible && ready && routes.has(route) && !modalOpen;
      if (want === bannerShown) return;
      bannerShown = want;
      try {
        if (want) await native("show_banner", { position: "bottom" });
        else {
          await native("hide_banner");
          onBannerHeight(0);
        }
      } catch (error) {
        onError(error);
      }
    });
    return bannerBusy;
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
      return syncBanner();
    },
    setRoute(name) {
      route = name;
      return syncBanner();
    },
    setModal(open) {
      modalOpen = Boolean(open);
      return syncBanner();
    },
    /** Pausa natural: plan guardado o día completado. Nunca en registro, pagos ni la primera vez. */
    async naturalPause(reason, { firstTime = false } = {}) {
      if (!eligible || firstTime || !pauses.has(reason)) return false;
      if (!(await start())) return false;
      const last = readLast();
      if (last && now() - last < config.interstitialIntervalMs) return false;
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

export function applyBannerHeight(height) {
  const value = Math.max(0, Math.round(Number(height) || 0));
  document.documentElement.style.setProperty("--ad-banner-height", `${value}px`);
  document.documentElement.classList.toggle("has-ad-banner", value > 0);
}
