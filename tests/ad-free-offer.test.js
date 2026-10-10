import { test } from "node:test";
import assert from "node:assert/strict";
import { adFreeProduct, adFreePurchaseOutcome } from "../src/ad-free-offer.js";

const noAds = { product_id: "sin_anuncios", kind: "ad_free" };
const state = (overrides = {}) => ({
  plan: { id: "free" },
  ad_free: false,
  products: [{ product_id: "creditos_100", kind: "credits" }, noAds],
  ...overrides,
});

test("Quitar anuncios se ofrece sólo en el plan Gratis y si todavía no se compró", () => {
  assert.deepEqual(adFreeProduct(state()), noAds);
  assert.equal(adFreeProduct(state({ ad_free: true })), null);
  assert.equal(adFreeProduct(state({ plan: { id: "plus" } })), null);
  assert.equal(adFreeProduct(state({ products: [] })), null);
  assert.equal(adFreeProduct(null), null, "Sin estado del servidor no se ofrece nada");
});

test("La oferta se cierra sólo cuando Google Play registra la compra", () => {
  const granted = adFreePurchaseOutcome({
    status: "purchased",
    sync: { results: [{ kind: "ad_free", granted: true }] },
  });
  assert.equal(granted.done, true);
  assert.match(granted.message, /para siempre/);

  assert.deepEqual(adFreePurchaseOutcome({ status: "cancelled" }), { done: false, message: "" });
  assert.equal(adFreePurchaseOutcome({ status: "pending" }).done, true);

  const failed = adFreePurchaseOutcome({
    status: "purchased",
    sync: { results: [{ kind: "ad_free", error: "No pudimos verificar la compra." }] },
  });
  assert.deepEqual(failed, { done: false, message: "No pudimos verificar la compra." });

  assert.match(adFreePurchaseOutcome({ status: "error", code: 3 }).message, /no está disponible/);
  assert.equal(adFreePurchaseOutcome(null).done, false, "Un fallo del plugin no cierra la oferta");
});
