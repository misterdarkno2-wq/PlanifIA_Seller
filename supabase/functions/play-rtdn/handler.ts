import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { packageName, PlayError } from "../_shared/google-play.ts";
import { PRODUCT_ID, PURCHASE_TOKEN, syncCredits, syncSubscription } from "../_shared/play-sync.ts";

// Avisos en tiempo real de Google Play (Pub/Sub push). El contenido del aviso no se cree:
// sólo indica qué token volver a consultar en Google.
function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handlePlayRtdn(req: Request) {
  const secret = Deno.env.get("PLAY_RTDN_SECRET") || "";
  const url = new URL(req.url);
  if (req.method !== "POST") return new Response("Método no permitido.", { status: 405 });
  if (secret.length < 32 || !sameSecret(url.searchParams.get("token") || "", secret)) {
    return new Response("No autorizado.", { status: 401 });
  }
  let notification: any;
  try {
    const body = await req.json();
    notification = JSON.parse(atob(body?.message?.data || ""));
  } catch {
    // Un mensaje ilegible no mejora con reintentos.
    return new Response("Ignorado.", { status: 200 });
  }
  if (notification?.packageName !== packageName()) return new Response("Ignorado.", { status: 200 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  try {
    const subscription = notification.subscriptionNotification;
    const oneTime = notification.oneTimeProductNotification;
    const voided = notification.voidedPurchaseNotification;
    if (subscription && PURCHASE_TOKEN.test(subscription.purchaseToken || "")) {
      await syncSubscription(admin, subscription.purchaseToken);
    } else if (
      oneTime && oneTime.notificationType === 1 &&
      PURCHASE_TOKEN.test(oneTime.purchaseToken || "") && PRODUCT_ID.test(oneTime.sku || "")
    ) {
      await syncCredits(admin, oneTime.sku, oneTime.purchaseToken);
    } else if (voided && PURCHASE_TOKEN.test(voided.purchaseToken || "")) {
      const rpc = voided.productType === 1 ? "play_revoke_subscription" : "play_revoke_credits";
      const { error } = await admin.rpc(rpc, { p_token: voided.purchaseToken });
      if (error) throw new PlayError("No pudimos registrar el reembolso.", 503, true);
    }
    return new Response("OK", { status: 200 });
  } catch (error) {
    const retry = !(error instanceof PlayError) || error.retry;
    console.error("play-rtdn", error instanceof Error ? error.message : "unknown");
    // 5xx hace que Pub/Sub reintente; un token que Google no reconoce se descarta.
    return new Response(retry ? "Reintentar." : "Ignorado.", { status: retry ? 503 : 200 });
  }
}
