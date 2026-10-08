// Google Play Developer API con una cuenta de servicio, sin dependencias externas.
// Secretos: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (JSON completo) y GOOGLE_PLAY_PACKAGE_NAME.
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const ACCESS_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_CANCELED",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
]);

export class PlayError extends Error {
  constructor(message: string, public status = 502, public retry = false) {
    super(message);
  }
}

export interface SubscriptionRecord {
  productId: string;
  state: string;
  expiry: string | null;
  autoRenewing: boolean;
  orderId: string | null;
  linkedPurchaseToken: string | null;
  accountId: string | null;
  acknowledged: boolean;
  test: boolean;
  active: boolean;
  raw: Record<string, unknown>;
}
export interface ProductRecord {
  productId: string;
  purchased: boolean;
  pending: boolean;
  consumed: boolean;
  acknowledged: boolean;
  orderId: string | null;
  accountId: string | null;
  test: boolean;
}

export const packageName = () =>
  Deno.env.get("GOOGLE_PLAY_PACKAGE_NAME") || "cl.planifia.app";

const base64url = (bytes: Uint8Array | string) =>
  btoa(
    typeof bytes === "string"
      ? bytes
      : String.fromCharCode(...bytes),
  ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let cached: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  let account: { client_email?: string; private_key?: string; token_uri?: string };
  try {
    account = JSON.parse(Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON") || "");
  } catch {
    throw new PlayError("La verificación de Google Play no está configurada.", 503);
  }
  if (!account.client_email || !account.private_key) {
    throw new PlayError("La verificación de Google Play no está configurada.", 503);
  }
  const der = Uint8Array.from(
    atob(account.private_key.replace(/-----[^-]+-----|\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) +
    "." +
    base64url(
      JSON.stringify({
        iss: account.client_email,
        scope: SCOPE,
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsigned),
    ),
  );
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + base64url(signature),
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new PlayError("No pudimos conectar con Google Play.", 503, true);
  }
  cached = {
    token: body.access_token,
    until: Date.now() + Number(body.expires_in || 3600) * 1000,
  };
  return cached.token;
}

async function play(path: string, method = "GET") {
  const response = await fetch(
    `${API}/applications/${encodeURIComponent(packageName())}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      body: method === "POST" ? "{}" : undefined,
      signal: AbortSignal.timeout(15000),
    },
  );
  if (response.status === 400 || response.status === 404 || response.status === 410) {
    throw new PlayError("Google Play no reconoce esta compra.", 422);
  }
  if (!response.ok) {
    throw new PlayError(
      "Google Play no respondió. Inténtalo de nuevo en unos minutos.",
      503,
      true,
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

const tokenPath = (token: string) => encodeURIComponent(token);

export async function getSubscription(token: string): Promise<SubscriptionRecord> {
  const v2 = await play(`/purchases/subscriptionsv2/tokens/${tokenPath(token)}`);
  const item = Array.isArray(v2.lineItems) ? v2.lineItems[0] : null;
  if (!item?.productId) throw new PlayError("Google Play no reconoce esta compra.", 422);
  const expiry = item.expiryTime ? new Date(item.expiryTime).toISOString() : null;
  const state = String(v2.subscriptionState || "SUBSCRIPTION_STATE_UNSPECIFIED");
  return {
    productId: item.productId,
    state,
    expiry,
    autoRenewing: item.autoRenewingPlan?.autoRenewEnabled === true,
    orderId: item.latestSuccessfulOrderId || v2.latestOrderId || null,
    linkedPurchaseToken: v2.linkedPurchaseToken || null,
    accountId: v2.externalAccountIdentifiers?.obfuscatedExternalAccountId || null,
    acknowledged: v2.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    test: v2.testPurchase != null,
    active: ACCESS_STATES.has(state) && !!expiry && Date.parse(expiry) > Date.now(),
    raw: {
      subscriptionState: state,
      basePlanId: item.offerDetails?.basePlanId ?? null,
      offerId: item.offerDetails?.offerId ?? null,
      regionCode: v2.regionCode ?? null,
      startTime: v2.startTime ?? null,
    },
  };
}

export const acknowledgeSubscription = (productId: string, token: string) =>
  play(
    `/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${tokenPath(token)}:acknowledge`,
    "POST",
  );

export async function getProduct(productId: string, token: string): Promise<ProductRecord> {
  const p = await play(
    `/purchases/products/${encodeURIComponent(productId)}/tokens/${tokenPath(token)}`,
  );
  return {
    productId: p.productId || productId,
    purchased: p.purchaseState === 0,
    pending: p.purchaseState === 2,
    consumed: p.consumptionState === 1,
    acknowledged: p.acknowledgementState === 1,
    orderId: p.orderId || null,
    accountId: p.obfuscatedExternalAccountId || null,
    test: p.purchaseType === 0,
  };
}

export const consumeProduct = (productId: string, token: string) =>
  play(
    `/purchases/products/${encodeURIComponent(productId)}/tokens/${tokenPath(token)}:consume`,
    "POST",
  );

// Compras únicas que no se consumen (p. ej., quitar anuncios): sin acknowledge Google las reembolsa.
export const acknowledgeProduct = (productId: string, token: string) =>
  play(
    `/purchases/products/${encodeURIComponent(productId)}/tokens/${tokenPath(token)}:acknowledge`,
    "POST",
  );

export function resetPlayAuthCache() {
  cached = null;
}
