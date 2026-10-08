import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdManager } from "../src/native-ads.js";
import {
  createPlayStore,
  describeSubscription,
  getPremiumStatus,
} from "../src/native-billing.js";

function fakeNative(overrides = {}) {
  const calls = [];
  const native = async (command, args) => {
    calls.push([command, args]);
    if (overrides[command]) return overrides[command](args);
    if (command === "init_ads")
      return { available: true, initialized: true, canRequestAds: true, privacyOptionsRequired: false };
    if (command === "show_rewarded") return { shown: true, earned: true };
    return { loaded: true };
  };
  return { native, calls, names: () => calls.map(([c]) => c) };
}
const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
};

test("Sin plan Gratis confirmado no se inicializa AdMob ni se muestra ningún anuncio", async () => {
  const { native, names } = fakeNative();
  const ads = createAdManager({ native });
  assert.deepEqual((await ads.rewarded("u")).reason, "not_eligible");
  assert.deepEqual(names(), []);
});

test("Sólo anuncios recompensados: nunca banner ni intersticial", async () => {
  const { native, names } = fakeNative();
  const ads = createAdManager({ native });
  await ads.setEligible(true);
  assert.deepEqual(names().slice(0, 1), ["init_ads"], "El consentimiento UMP va antes que cualquier anuncio");
  await ads.rewarded("user-1");
  await ads.setEligible(false);
  assert.ok(!names().some((n) => /banner|interstitial/.test(n)), names().join(","));
  assert.equal("setRoute" in ads || "naturalPause" in ads, false);
});

test("Sin consentimiento (canRequestAds=false) no se piden anuncios", async () => {
  const { native, names } = fakeNative({
    init_ads: () => ({ available: true, initialized: false, canRequestAds: false }),
  });
  const ads = createAdManager({ native });
  await ads.setEligible(true);
  assert.equal((await ads.rewarded("u")).reason, "not_ready");
  assert.ok(!names().some((n) => /show_|load_/.test(n)));
});

test("Recompensado: carga y reintenta si no estaba listo, enviando el usuario para SSV", async () => {
  let loaded = false;
  const { native, calls } = fakeNative({
    show_rewarded: () => (loaded ? { shown: true, earned: true } : { shown: false, reason: "not_loaded" }),
    load_rewarded: () => ((loaded = true), { loaded: true }),
  });
  const ads = createAdManager({ native });
  await ads.setEligible(true);
  loaded = false;
  assert.deepEqual(await ads.rewarded("user-1"), { shown: true, earned: true });
  assert.ok(calls.filter(([c]) => c === "show_rewarded").every(([, a]) => a.userId === "user-1"));
});

test("Precios de Play: oferta de primer mes y precio regular vienen de Google, no escritos a mano", () => {
  const product = {
    offers: [
      { basePlanId: "mensual", offerId: null, phases: [{ formattedPrice: "$2.750", priceMicros: 2750e6, recurrence: 1 }] },
      {
        basePlanId: "mensual",
        offerId: "primer-mes",
        phases: [
          { formattedPrice: "$990", priceMicros: 990e6, recurrence: 2, cycles: 1 },
          { formattedPrice: "$2.750", priceMicros: 2750e6, recurrence: 1 },
        ],
      },
    ],
  };
  assert.deepEqual(describeSubscription(product), {
    available: true,
    regularPrice: "$2.750",
    regularMicros: 2750e6,
    introPrice: "$990",
    offerId: "primer-mes",
    basePlanId: "mensual",
  });
  const notEligible = describeSubscription({ offers: [product.offers[0]] });
  assert.equal(notEligible.introPrice, null);
  assert.equal(notEligible.offerId, null);
  assert.equal(describeSubscription(undefined).available, false);
});

test("Tienda: verifica en el servidor y completa acknowledge/consumo sólo si el servidor no pudo", async () => {
  const calls = [];
  const native = async (command, args) => {
    calls.push([command, args]);
    if (command === "purchase")
      return {
        status: "purchased",
        purchases: [
          { productId: "creditos_100", purchaseToken: "t-pack", state: "purchased", acknowledged: false },
          { productId: "planifia_plus", purchaseToken: "t-sub", state: "purchased", acknowledged: false },
          { productId: "planifia_pro", purchaseToken: "t-pending", state: "pending" },
        ],
      };
    return { ok: true };
  };
  const verified = [];
  let shared = null;
  const store = createPlayStore({
    native,
    verify: async (list) => {
      verified.push(list);
      return {
        results: [
          { kind: "credits", purchaseToken: "t-pack", granted: true, credits: 100, consumed: false },
          { kind: "subscription", purchaseToken: "t-sub", active: true, acknowledged: false },
        ],
        state: { plan: { id: "plus" } },
      };
    },
    onState: (s) => (shared = s),
  });
  const result = await store.purchase(
    { product_id: "creditos_100", kind: "credits" },
    { accountId: "user-1" },
  );
  assert.equal(result.status, "purchased");
  assert.deepEqual(verified[0].map((p) => p.purchaseToken), ["t-pack", "t-sub"], "Las compras pendientes no se verifican aún");
  assert.deepEqual(
    calls.filter(([c]) => c === "finish_purchase").map(([, a]) => a),
    [
      { purchaseToken: "t-pack", consumable: true },
      { purchaseToken: "t-sub", consumable: false },
    ],
  );
  assert.equal(calls[0][1].accountId, "user-1");
  assert.equal(calls[0][1].type, "inapp");
  assert.equal(shared.plan.id, "plus");
  // El aviso de Google que llega justo después no vuelve a verificar las mismas compras.
  await store.sync([{ productId: "creditos_100", purchaseToken: "t-pack", state: "purchased" }], { skipRecent: true });
  assert.equal(verified.length, 1);
});

test("Estado premium: el servidor manda y el teléfono recuerda el último plan", () => {
  const storage = memory();
  assert.equal(getPremiumStatus("u", null, storage).source, "unknown");
  assert.deepEqual(getPremiumStatus("u", { plan: { id: "pro" } }, storage), {
    plan: "pro",
    premium: true,
    source: "server",
  });
  const cached = getPremiumStatus("u", null, storage);
  assert.equal(cached.plan, "pro");
  assert.equal(cached.source, "cache");
});
