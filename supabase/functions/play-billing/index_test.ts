import { handlePlayBilling } from "./handler.ts";
import { handlePlayRtdn } from "../play-rtdn/handler.ts";
import { resetPlayAuthCache } from "../_shared/google-play.ts";

function assert(value: unknown, message = "Assertion failed") {
  if (!value) throw new Error(message);
}
const USER = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  SUB_TOKEN = "sub-token-aaaaaaaaaaaa",
  PACK_TOKEN = "pack-token-bbbbbbbbbbb",
  SECRET = "fixture-rtdn-secret-with-32-characters!";

async function setup() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----\n`;
  for (
    const [key, value] of Object.entries({
      SUPABASE_URL: "https://supabase.example.test",
      SUPABASE_ANON_KEY: "fixture-public",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-admin",
      ALLOWED_ORIGINS: "https://tauri.localhost",
      GOOGLE_PLAY_PACKAGE_NAME: "cl.planifia.app",
      PLAY_RTDN_SECRET: SECRET,
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "verifier@example.iam.gserviceaccount.com",
        private_key: pem,
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    })
  ) Deno.env.set(key, value);
  resetPlayAuthCache();
  const state = {
    accountId: USER as string | null,
    subState: "SUBSCRIPTION_STATE_ACTIVE",
    ack: "ACKNOWLEDGEMENT_STATE_PENDING",
    owner: null as string | null,
    calls: [] as { url: string; method: string; body: any }[],
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, options?: RequestInit) => {
    const url = String(input), method = options?.method || "GET";
    const body = options?.body && typeof options.body === "string" ? (() => {
      try {
        return JSON.parse(options.body as string);
      } catch {
        return options.body;
      }
    })() : options?.body;
    state.calls.push({ url, method, body });
    if (url.includes("/auth/v1/user")) {
      return new Headers(options?.headers).get("authorization") === "Bearer fixture-valid"
        ? Response.json({ id: USER, aud: "authenticated" })
        : Response.json({ msg: "Expired" }, { status: 401 });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      const assertion = (options?.body as URLSearchParams).get("assertion")!;
      assert(assertion.split(".").length === 3, "JWT firmado");
      return Response.json({ access_token: "google-access", expires_in: 3600 });
    }
    if (url.includes("androidpublisher.googleapis.com")) {
      assert(new Headers(options?.headers).get("authorization") === "Bearer google-access");
      assert(url.includes("/applications/cl.planifia.app/"));
      if (url.includes(`/subscriptionsv2/tokens/${SUB_TOKEN}`)) {
        return Response.json({
          subscriptionState: state.subState,
          acknowledgementState: state.ack,
          latestOrderId: "GPA.1",
          ...(state.accountId ? { externalAccountIdentifiers: { obfuscatedExternalAccountId: state.accountId } } : {}),
          lineItems: [{
            productId: "planifia_plus",
            expiryTime: new Date(Date.now() + 86400000).toISOString(),
            autoRenewingPlan: { autoRenewEnabled: true },
            offerDetails: { basePlanId: "mensual", offerId: "primer-mes" },
          }],
        });
      }
      if (url.endsWith(":acknowledge") || url.endsWith(":consume")) return new Response("", { status: 200 });
      if (url.includes(`/purchases/products/creditos_300/tokens/${PACK_TOKEN}`)) {
        return Response.json({
          purchaseState: 0,
          consumptionState: 0,
          orderId: "GPA.2",
          obfuscatedExternalAccountId: state.accountId,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }
    if (url.includes("/rpc/play_product_kind")) {
      return Response.json(body.p_product.startsWith("creditos_") ? "credits" : body.p_product.startsWith("planifia_") ? "subscription" : null);
    }
    if (url.includes("/rpc/play_token_owner")) return Response.json(state.owner);
    if (url.includes("/rpc/play_apply_subscription")) return Response.json({ plan: "plus" });
    if (url.includes("/rpc/play_grant_credits")) return Response.json({ granted: true, credits: 300 });
    if (url.includes("/rpc/play_revoke_credits") || url.includes("/rpc/play_revoke_subscription")) return Response.json(true);
    if (url.includes("/rpc/monetization_state")) return Response.json({ plan: { id: "plus" } });
    return new Response("unexpected " + url, { status: 500 });
  }) as typeof fetch;
  return { state, restore: () => (globalThis.fetch = oldFetch) };
}
const verify = (purchases: unknown[], token = "fixture-valid") =>
  handlePlayBilling(
    new Request("https://x.test/functions/v1/play-billing", {
      method: "POST",
      headers: { origin: "https://tauri.localhost", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "verify", purchases }),
    }),
  );
const rtdn = (payload: Record<string, unknown>, token = SECRET) =>
  handlePlayRtdn(
    new Request(`https://x.test/functions/v1/play-rtdn?token=${encodeURIComponent(token)}`, {
      method: "POST",
      body: JSON.stringify({ message: { data: btoa(JSON.stringify({ packageName: "cl.planifia.app", ...payload })) } }),
    }),
  );

Deno.test("play-billing valida con Google, guarda la suscripción y hace acknowledge", async () => {
  const { state, restore } = await setup();
  try {
    const response = await verify([{ productId: "planifia_plus", purchaseToken: SUB_TOKEN }]);
    assert(response.status === 200);
    const body = await response.json();
    assert(body.results[0].active === true && body.results[0].acknowledged === true, JSON.stringify(body));
    assert(body.state.plan.id === "plus");
    const apply = state.calls.find((c) => c.url.includes("/rpc/play_apply_subscription"))!;
    assert(apply.body.p_user === USER && apply.body.p_product === "planifia_plus" && apply.body.p_order === "GPA.1");
    assert(state.calls.some((c) => c.url.endsWith(`/purchases/subscriptions/planifia_plus/tokens/${SUB_TOKEN}:acknowledge`) && c.method === "POST"));
  } finally {
    restore();
  }
});

Deno.test("play-billing rechaza compras de otra cuenta, tokens inválidos y sesiones vencidas", async () => {
  const { state, restore } = await setup();
  try {
    state.accountId = OTHER;
    const body = await (await verify([{ productId: "planifia_plus", purchaseToken: SUB_TOKEN }])).json();
    assert(/otra cuenta/.test(body.results[0].error));
    assert(!state.calls.some((c) => c.url.includes("/rpc/play_apply_subscription")));
    assert((await verify([{ productId: "planifia_plus", purchaseToken: "x" }])).status === 422);
    assert((await verify([{ productId: "Plus!", purchaseToken: SUB_TOKEN }])).status === 422);
    assert((await verify([], "expired")).status === 401);
    const foreign = await handlePlayBilling(
      new Request("https://x.test/", { method: "POST", headers: { origin: "https://evil.test" }, body: "{}" }),
    );
    assert(foreign.status === 403);
  } finally {
    restore();
  }
});

Deno.test("play-billing acredita paquetes una vez y los consume", async () => {
  const { state, restore } = await setup();
  try {
    const body = await (await verify([{ productId: "creditos_300", purchaseToken: PACK_TOKEN }])).json();
    assert(body.results[0].granted === true && body.results[0].consumed === true, JSON.stringify(body));
    const grant = state.calls.find((c) => c.url.includes("/rpc/play_grant_credits"))!;
    assert(grant.body.p_user === USER && grant.body.p_token === PACK_TOKEN);
    assert(state.calls.some((c) => c.url.endsWith(`/purchases/products/creditos_300/tokens/${PACK_TOKEN}:consume`)));
  } finally {
    restore();
  }
});

Deno.test("play-rtdn exige el secreto, vuelve a consultar Google y registra reembolsos", async () => {
  const { state, restore } = await setup();
  try {
    assert((await rtdn({}, "wrong")).status === 401);
    state.accountId = null;
    state.owner = USER;
    state.subState = "SUBSCRIPTION_STATE_CANCELED";
    state.ack = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
    const renewed = await rtdn({ subscriptionNotification: { notificationType: 3, purchaseToken: SUB_TOKEN, subscriptionId: "planifia_plus" } });
    assert(renewed.status === 200);
    const apply = state.calls.find((c) => c.url.includes("/rpc/play_apply_subscription"))!;
    assert(apply.body.p_user === USER && apply.body.p_state === "SUBSCRIPTION_STATE_CANCELED");
    assert(!state.calls.some((c) => c.url.endsWith(":acknowledge")), "Ya estaba reconocida");
    await rtdn({ voidedPurchaseNotification: { purchaseToken: PACK_TOKEN, productType: 2 } });
    assert(state.calls.some((c) => c.url.includes("/rpc/play_revoke_credits") && c.body.p_token === PACK_TOKEN));
    await rtdn({ voidedPurchaseNotification: { purchaseToken: SUB_TOKEN, productType: 1 } });
    assert(state.calls.some((c) => c.url.includes("/rpc/play_revoke_subscription")));
    const ignored = await rtdn({ subscriptionNotification: { purchaseToken: "unknown-token-cccccccc" } });
    assert(ignored.status === 200, "Un token que Google no reconoce no se reintenta");
  } finally {
    restore();
  }
});
