// Aplica en Supabase lo que Google Play confirma. Lo usan la app (play-billing) y los avisos RTDN (play-rtdn).
import {
  acknowledgeSubscription,
  consumeProduct,
  getProduct,
  getSubscription,
  PlayError,
} from "./google-play.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PRODUCT_ID = /^[a-z0-9][a-z0-9_.]{0,39}$/;
export const PURCHASE_TOKEN = /^[A-Za-z0-9._\-]{10,4096}$/;

async function rpc(admin: any, name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    throw new PlayError(
      error.code === "P0001" ? error.message : "No pudimos guardar la compra. Inténtalo de nuevo.",
      error.code === "P0001" ? 409 : 503,
      error.code !== "P0001",
    );
  }
  return data;
}

// Decide a qué cuenta pertenece la compra. Si la app la inició, Google trae el ID ofuscado (UUID de Supabase).
async function resolveOwner(
  admin: any,
  accountId: string | null,
  tokens: (string | null)[],
  expectedUser?: string,
) {
  const fromGoogle = accountId && UUID.test(accountId) ? accountId.toLowerCase() : null;
  if (expectedUser) {
    if (fromGoogle && fromGoogle !== expectedUser) {
      throw new PlayError("Esta compra pertenece a otra cuenta de PlanifIA.", 409);
    }
    return expectedUser;
  }
  if (fromGoogle) return fromGoogle;
  for (const token of tokens) {
    if (!token) continue;
    const owner = await rpc(admin, "play_token_owner", { p_token: token });
    if (owner) return owner as string;
  }
  return null;
}

export async function syncSubscription(admin: any, token: string, expectedUser?: string) {
  const sub = await getSubscription(token);
  const user = await resolveOwner(admin, sub.accountId, [token, sub.linkedPurchaseToken], expectedUser);
  if (!user) return { kind: "subscription", productId: sub.productId, skipped: true };
  if ((await rpc(admin, "play_product_kind", { p_product: sub.productId })) !== "subscription") {
    throw new PlayError("Esta suscripción no pertenece a PlanifIA.", 422);
  }
  await rpc(admin, "play_apply_subscription", {
    p_user: user,
    p_token: token,
    p_product: sub.productId,
    p_state: sub.state,
    p_expiry: sub.expiry,
    p_auto_renewing: sub.autoRenewing,
    p_order: sub.orderId,
    p_linked: sub.linkedPurchaseToken,
    p_test: sub.test,
    p_raw: sub.raw,
  });
  let acknowledged = sub.acknowledged;
  // Sin acknowledge en 3 días Google reembolsa la compra; el servidor lo hace apenas la valida.
  if (!acknowledged && sub.active) {
    try {
      await acknowledgeSubscription(sub.productId, token);
      acknowledged = true;
    } catch (error) {
      console.error("play acknowledge failed", error instanceof Error ? error.message : error);
    }
  }
  return {
    kind: "subscription",
    productId: sub.productId,
    state: sub.state,
    active: sub.active,
    pending: sub.state === "SUBSCRIPTION_STATE_PENDING",
    acknowledged,
  };
}

export async function syncCredits(admin: any, productId: string, token: string, expectedUser?: string) {
  if ((await rpc(admin, "play_product_kind", { p_product: productId })) !== "credits") {
    throw new PlayError("Este paquete no pertenece a PlanifIA.", 422);
  }
  const purchase = await getProduct(productId, token);
  const user = await resolveOwner(admin, purchase.accountId, [token], expectedUser);
  if (!user) return { kind: "credits", productId, skipped: true };
  if (purchase.pending) return { kind: "credits", productId, pending: true, consumed: false };
  if (!purchase.purchased) return { kind: "credits", productId, cancelled: true, consumed: purchase.consumed };
  const granted = await rpc(admin, "play_grant_credits", {
    p_user: user,
    p_token: token,
    p_product: productId,
    p_order: purchase.orderId,
    p_test: purchase.test,
  });
  let consumed = purchase.consumed;
  // Consumir permite volver a comprar el mismo paquete; los créditos ya quedaron guardados.
  if (!consumed) {
    try {
      await consumeProduct(productId, token);
      consumed = true;
    } catch (error) {
      console.error("play consume failed", error instanceof Error ? error.message : error);
    }
  }
  return { kind: "credits", productId, granted: granted?.granted === true, credits: granted?.credits, consumed };
}
