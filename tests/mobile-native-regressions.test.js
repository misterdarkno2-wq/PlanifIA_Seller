import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdManager } from "../src/native-ads.js";
import { createPlayStore } from "../src/native-billing.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const purchase = { productId: "creditos_100", purchaseToken: "fixture-token", state: "purchased" };

// docs/monetizacion.md: Plus/Pro y Quitar anuncios no muestran videos. Se investiga
// la coordinación JS real; el SDK externo ya tiene consentimiento y un video cargado.
for (const transition of ["logout", "ad_free"]) {
  test(`un video pendiente no se solicita después de ${transition}`, async () => {
    const calls = [];
    const ads = createAdManager({
      storage: { getItem: () => null, setItem: () => {} },
      native: async (command) => {
        calls.push(command);
        if (command === "init_ads") return { available: true, initialized: true, canRequestAds: true };
        if (command === "show_interstitial") return { shown: true };
        return { loaded: true };
      },
    });
    await ads.setEligible(true);
    ads.setAdFree(false);
    assert.ok(calls.includes("load_interstitial"), "precondición: el video estaba preparado antes del cambio");
    // aiVideo cede control incluso con start() ya resuelto; el cambio llega antes de show.
    const video = ads.aiVideo();
    if (transition === "logout") await ads.setEligible(false);
    else ads.setAdFree(true);
    const shown = await video;
    assert.equal(calls.includes("show_interstitial"), false,
      "el SDK no conoce el plan ni la sesión: JS debe volver a validar antes de pedir el video");
    assert.equal(shown, false);
  });
}

// native-billing.js promete verificar una vez una compra recibida tanto por el
// resultado del comando como por purchasesUpdated. El servidor sigue siendo quien
// acredita: este test NO afirma que se dupliquen créditos.
test("una compra y su evento fuera de orden comparten una sola verificación en curso", async () => {
  const nativePurchase = deferred();
  const verification = deferred();
  const verified = [];
  const store = createPlayStore({
    native: async (command) => command === "purchase" ? nativePurchase.promise : { ok: true },
    verify: async (list) => {
      verified.push(list);
      return verification.promise;
    },
  });
  const buying = store.purchase({ product_id: "creditos_100", kind: "credits" }, { accountId: "user-a" });
  const event = store.sync([purchase], { skipRecent: true });
  nativePurchase.resolve({ status: "purchased", purchases: [purchase] });
  verification.resolve({ results: [], state: null });
  await Promise.all([buying, event]);
  assert.equal(verified.length, 1, "la respuesta de compra no debe ignorar la deduplicación del evento");
});

test("control: no se inicializa AdMob si ya se conoce la sesión cerrada", async () => {
  const calls = [];
  const ads = createAdManager({ native: async (command) => { calls.push(command); return {}; } });
  await ads.setEligible(false);
  ads.setAdFree(false);
  assert.equal(await ads.aiVideo(), false);
  assert.deepEqual(calls, []);
});
