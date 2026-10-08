import { isAndroidApp } from "./native-ads.js";
import { PLAY } from "./monetization-config.js";

// Comandos del plugin planifia-billing. Fuera de Android responden "no disponible" sin error.
export async function billingCommand(command, args = {}) {
  if (!isAndroidApp()) return { available: false };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(`plugin:planifia-billing|${command}`, args);
}
export async function onPurchasesUpdated(handler) {
  if (!isAndroidApp()) return () => {};
  const { addPluginListener } = await import("@tauri-apps/api/core");
  const listener = await addPluginListener("planifia-billing", "purchasesUpdated", handler);
  return () => listener.unregister().catch(() => {});
}

const PREMIUM_KEY = "planifia-plan:";
// Estado premium guardado en el dispositivo: permite no mostrar anuncios a quien paga mientras
// se vuelve a consultar el servidor al abrir la app. El servidor siempre tiene la última palabra.
export function rememberPlan(userId, planId, storage = globalThis.localStorage) {
  try {
    storage?.setItem(PREMIUM_KEY + userId, JSON.stringify({ plan: planId, checkedAt: Date.now() }));
  } catch {}
}
export function getPremiumStatus(userId, serverState = null, storage = globalThis.localStorage) {
  if (serverState?.plan?.id) {
    rememberPlan(userId, serverState.plan.id, storage);
    return { plan: serverState.plan.id, premium: serverState.plan.id !== "free", source: "server" };
  }
  try {
    const cached = JSON.parse(storage?.getItem(PREMIUM_KEY + userId) || "null");
    if (cached?.plan) return { plan: cached.plan, premium: cached.plan !== "free", source: "cache", checkedAt: cached.checkedAt };
  } catch {}
  return { plan: null, premium: null, source: "unknown" };
}

/** Elige el precio a mostrar: oferta de introducción si Google la ofrece, y el precio regular. */
export function describeSubscription(product, config = PLAY) {
  const offers = (product?.offers || []).filter((o) => o.basePlanId === config.basePlanId);
  const base = offers.find((o) => !o.offerId) || offers[0];
  const intro = offers.find((o) => o.offerId === config.introOfferId);
  const recurring = (offer) => offer?.phases?.find((p) => p.recurrence === 1) || offer?.phases?.at(-1);
  const regular = recurring(base) || recurring(intro);
  const first = intro?.phases?.[0];
  return {
    available: Boolean(base || intro),
    regularPrice: regular?.formattedPrice || null,
    regularMicros: regular?.priceMicros ?? null,
    introPrice: first && first.priceMicros !== regular?.priceMicros ? first.formattedPrice : null,
    offerId: intro ? intro.offerId : null,
    basePlanId: config.basePlanId,
  };
}

/**
 * Tienda de Google Play: compra en el teléfono, verifica en el servidor y, si el servidor no pudo
 * hacer el acknowledge/consumo, lo completa desde el teléfono.
 */
export function createPlayStore({ native = billingCommand, verify, onState = () => {} }) {
  async function finishLocally(results, purchases) {
    for (const result of results || []) {
      if (result.error || result.skipped || result.pending) continue;
      const purchase = purchases.find((p) => p.purchaseToken === result.purchaseToken);
      if (result.kind === "credits" && !result.consumed && !result.cancelled) {
        await native("finish_purchase", { purchaseToken: result.purchaseToken, consumable: true }).catch(() => {});
      } else if (result.kind === "subscription" && result.active && !result.acknowledged && !purchase?.acknowledged) {
        await native("finish_purchase", { purchaseToken: result.purchaseToken, consumable: false }).catch(() => {});
      }
    }
  }
  // La misma compra llega por la respuesta de compra y por el aviso de Google: se verifica una vez.
  const recent = new Map();
  async function sync(purchases = [], { skipRecent = false } = {}) {
    const now = Date.now();
    const ready = purchases.filter(
      (p) =>
        p.state === "purchased" && p.productId && p.purchaseToken &&
        !(skipRecent && now - (recent.get(p.purchaseToken) || 0) < 30000),
    );
    if (!ready.length) return { results: [], state: null };
    for (const p of ready) recent.set(p.purchaseToken, now);
    const response = await verify(ready.map((p) => ({ productId: p.productId, purchaseToken: p.purchaseToken })));
    await finishLocally(response.results, ready);
    if (response.state) onState(response.state);
    return response;
  }
  return {
    products: (subscriptions, products) => native("get_products", { subscriptions, products }),
    async purchase(product, options) {
      const result = await native("purchase", {
        productId: product.product_id,
        type: product.kind === "credits" ? "inapp" : "subs",
        basePlanId: options.basePlanId ?? null,
        offerId: options.offerId ?? null,
        accountId: options.accountId,
        oldPurchaseToken: options.oldPurchaseToken ?? null,
        oldProductId: options.oldProductId ?? null,
        replacement: options.replacement ?? null,
      });
      if (result?.status === "purchased" || result?.status === "already_owned") {
        const owned = result.status === "already_owned"
          ? (await native("restore_purchases")).purchases || []
          : result.purchases || [];
        return { ...result, sync: await sync(owned) };
      }
      return result || { status: "error" };
    },
    async restore() {
      const owned = await native("restore_purchases");
      if (!owned?.available) return { available: false, results: [] };
      return { available: true, purchases: owned.purchases || [], ...(await sync(owned.purchases || [])) };
    },
    sync,
    manage: (productId) => native("manage_subscriptions", { productId: productId || null }),
    openExternal: (url) => native("open_external", { url }),
  };
}
