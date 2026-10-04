import { handleBilling } from "./handler.ts";
import { handleBillingReturn } from "../billing-return/handler.ts";
import { handleBillingRenew } from "../billing-renew/handler.ts";
import {
  INTEGRATION,
  normalizePayment,
  Transbank,
  transbankConfig,
} from "../_shared/transbank.ts";

function assert(value: unknown, message = "Assertion failed") {
  if (!value) throw new Error(message);
}
function equal(a: unknown, b: unknown) {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
  );
}
const USER = "11111111-1111-4111-8111-111111111111",
  ORDER = "22222222-2222-4222-8222-222222222222",
  ENROLL = "33333333-3333-4333-8333-333333333333",
  TOKEN = "fixture-transbank-token-1234567890";
function setup() {
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TRANSBANK_ENV",
    "TRANSBANK_ONECLICK_ENABLED",
    "BILLING_SITE_URL",
    "ALLOWED_ORIGINS",
    "BILLING_CRON_SECRET",
  ];
  const saved = new Map(keys.map((key) => [key, Deno.env.get(key)])),
    oldFetch = globalThis.fetch;
  for (
    const [key, value] of Object.entries({
      SUPABASE_URL: "https://supabase.example.test",
      SUPABASE_ANON_KEY: "fixture-public",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-admin",
      TRANSBANK_ENV: "integration",
      TRANSBANK_ONECLICK_ENABLED: "false",
      BILLING_SITE_URL: "https://planifia.cl/",
      ALLOWED_ORIGINS: "https://planifia.cl",
      BILLING_CRON_SECRET: "fixture-secret-with-at-least-32-characters",
    })
  ) Deno.env.set(key, value);
  const order: any = {
    id: ORDER,
    user_id: USER,
    buy_order: "seller00001",
    session_id: ORDER,
    amount: 990,
    plan_id: "plus",
    channel: "webpay",
    status: "pending",
    promo_applied: true,
    provider_token: TOKEN,
    provider_url:
      "https://webpay3gint.transbank.cl/webpayserver/initTransaction",
    charge_started_at: null,
    environment: "integration",
  };
  const enrollment: any = {
    id: ENROLL,
    user_id: USER,
    username: "user0001",
    email: "fixture@example.test",
    plan_id: "plus",
    purpose: "checkout",
    provider_token: TOKEN,
    status: "pending",
  };
  let providerStatus = "INITIALIZED",
    responseCode = 0,
    providerPosts = 0,
    providerGets = 0,
    unknown = false,
    mismatch = false,
    enrollFinished = false,
    methodActive = true,
    confirmed = 0,
    declined = false;
  globalThis.fetch = async (input, options) => {
    const url = String(input), method = options?.method || "GET";
    if (url.includes("/auth/v1/user")) {
      if (
        new Headers(options?.headers).get("authorization") !==
          "Bearer fixture-valid"
      ) return Response.json({ msg: "Expired" }, { status: 401 });
      return Response.json({
        id: USER,
        email: "fixture@example.test",
        aud: "authenticated",
      });
    }
    if (url.includes("/rest/v1/plan_catalog")) {
      return Response.json([{ id: "free" }, {
        id: "plus",
        price_clp: 2750,
        first_month_clp: 990,
      }]);
    }
    if (url.includes("/rpc/billing_state")) {
      return Response.json({
        plans: [],
        subscription: {},
        effective_plan: {},
        usage: {},
        payments: [],
      });
    }
    if (url.includes("/rpc/manage_subscription")) {
      return Response.json({ updated: true });
    }
    if (url.includes("/rpc/billing_admin")) {
      const { p_action: action, p_payload: p } = JSON.parse(
        String(options?.body),
      );
      assert(
        p.environment === "integration",
        "Every operation must include its server environment",
      );
      if (action === "get_order") {
        return Response.json(
          (p.order_id === ORDER || p.provider_token === TOKEN ||
              p.request_id === ENROLL)
            ? order
            : null,
        );
      }
      if (action === "create_order" || action === "create_renewal") {
        return Response.json(order);
      }
      if (action === "quote") {
        return Response.json({
          amount_clp: order.amount,
          promotion_applied: true,
          regular_price_clp: 2750,
        });
      }
      if (action === "claim_order") {
        return Response.json({
          claimed: ![
            "approved",
            "cancelled",
            "rejected",
            "unknown",
            "processing",
          ].includes(order.status),
          order,
        });
      }
      if (action === "provider_started") {
        Object.assign(order, {
          provider_token: p.token,
          provider_url: p.url,
          status: "pending",
        });
        return Response.json(order);
      }
      if (action === "charge_started") {
        order.status = "processing";
        order.charge_started_at = "2026-10-04T00:00:00Z";
        return Response.json(order);
      }
      if (action === "confirm_order") {
        confirmed++;
        assert(p.provider_result.approved);
        order.status = "approved";
        return Response.json(order);
      }
      if (action === "fail_order") {
        order.status = p.status;
        return Response.json(order);
      }
      if (action === "get_method") {
        return Response.json({
          active: methodActive,
          tbk_user: "fixture-private-reference",
          username: enrollment.username,
        });
      }
      if (action === "remove_method") {
        methodActive = false;
        return Response.json({ removed: true });
      }
      if (action === "enroll_create" || action === "enroll_get") {
        return Response.json(enrollment);
      }
      if (action === "enroll_started") {
        enrollment.provider_token = p.token;
        return Response.json(enrollment);
      }
      if (action === "enroll_claim" || action === "enroll_start_claim") {
        return Response.json({ claimed: !enrollFinished, enrollment });
      }
      if (action === "enroll_finish") {
        enrollFinished = true;
        enrollment.status = "enrolled";
        return Response.json(enrollment);
      }
      if (action === "enroll_cancel") {
        enrollment.status = p.status;
        enrollFinished = true;
        return Response.json(enrollment);
      }
      if (action === "renewal_due") {
        return Response.json({
          users: [USER],
          reconcile: order.status === "unknown" ? [order] : [],
        });
      }
      throw new Error("Unexpected RPC action " + action);
    }
    if (url.startsWith("https://webpay3gint.transbank.cl")) {
      equal(
        new Headers(options?.headers).get("Tbk-Api-Key-Secret"),
        INTEGRATION.apiKey,
      );
      if (method === "GET") providerGets++;
      else providerPosts++;
      if (unknown && method !== "GET" && !url.includes("/inscriptions")) {
        throw new TypeError("Fixture timeout after provider charge");
      }
      if (url.includes("/inscriptions")) {
        if (method === "POST") {
          return Response.json({
            token: TOKEN,
            url_webpay:
              "https://webpay3gint.transbank.cl/webpayserver/initTransaction",
          });
        }
        if (method === "DELETE") return new Response(null, { status: 204 });
        return Response.json({
          response_code: declined ? -1 : 0,
          tbk_user: "fixture-private-reference",
          card_type: "Visa",
          card_number: "6623",
        });
      }
      if (method === "POST" && order.channel === "webpay") {
        return Response.json({
          token: TOKEN,
          url: "https://webpay3gint.transbank.cl/webpayserver/initTransaction",
        });
      }
      if (method !== "GET") providerStatus = declined ? "FAILED" : "AUTHORIZED";
      const detail = {
        status: providerStatus,
        response_code: declined ? -1 : responseCode,
        amount: mismatch ? order.amount + 1 : order.amount,
        buy_order: order.buy_order,
        commerce_code: INTEGRATION.child,
        authorization_code: "fixture-authorization",
      };
      return Response.json(
        order.channel === "webpay"
          ? { ...detail, session_id: order.session_id }
          : { buy_order: order.buy_order, details: [detail] },
      );
    }
    throw new Error("Unexpected fixture URL " + url);
  };
  return {
    order,
    enrollment,
    posts: () => providerPosts,
    gets: () => providerGets,
    confirmed: () => confirmed,
    setUnknown: () => {
      unknown = true;
    },
    setApproved: () => {
      providerStatus = "AUTHORIZED";
    },
    setMismatch: () => {
      mismatch = true;
    },
    setDeclined: () => {
      declined = true;
    },
    close: () => {
      globalThis.fetch = oldFetch;
      for (const [key, value] of saved) {
        value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
      }
    },
  };
}
const request = (
  action: string,
  body: any = {},
  token: string | null = "fixture-valid",
  origin = "https://planifia.cl",
) =>
  new Request("https://supabase.example.test/functions/v1/billing", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify({ action, ...body }),
  });
const callback = (data: Record<string, string>) =>
  new Request("https://supabase.example.test/functions/v1/billing-return", {
    method: "POST",
    body: new URLSearchParams(data),
  });

Deno.test("Billing auth, CORS and public integration catalog", async () => {
  const f = setup();
  try {
    equal((await handleBilling(request("state", {}, null))).status, 401);
    equal((await handleBilling(request("state", {}, "expired"))).status, 401);
    equal(
      (await handleBilling(
        request("state", {}, "fixture-valid", "https://attacker.test"),
      )).status,
      403,
    );
    const catalog = await handleBilling(request("catalog", {}, null));
    equal(catalog.status, 200);
    assert((await catalog.json()).capabilities.simulation);
    equal(f.posts(), 0);
  } finally {
    f.close();
  }
});
Deno.test("Checkout ignores browser amounts and returns the saved provider token", async () => {
  const f = setup();
  try {
    const result = await handleBilling(
      request("checkout", {
        plan_id: "plus",
        amount: 1,
        promotion_applied: false,
      }),
    );
    equal(result.status, 200);
    const body = await result.json();
    equal(body.order_id, ORDER);
    equal(body.redirect.field, "token_ws");
    equal(f.order.amount, 990);
    equal(f.confirmed(), 0);
    const state = await handleBilling(request("state"));
    assert(!(await state.text()).includes("fixture-private-reference"));
  } finally {
    f.close();
  }
});
Deno.test("Webpay approved callback commits once and repeated callbacks query without charging", async () => {
  const f = setup();
  try {
    const result = await handleBillingReturn(callback({ token_ws: TOKEN }));
    equal(result.status, 303);
    equal(
      result.headers.get("location"),
      "https://planifia.cl/#subscription?order=" + ORDER,
    );
    equal(f.order.status, "approved");
    equal(f.posts(), 1);
    equal(f.confirmed(), 1);
    await handleBillingReturn(callback({ token_ws: TOKEN }));
    equal(f.posts(), 1);
    equal(f.confirmed(), 1);
  } finally {
    f.close();
  }
});
Deno.test("Rejected Webpay does not activate access", async () => {
  const f = setup();
  try {
    f.setDeclined();
    await handleBillingReturn(callback({ token_ws: TOKEN }));
    equal(f.order.status, "rejected");
    equal(f.confirmed(), 0);
  } finally {
    f.close();
  }
});
Deno.test("Cancelled Webpay validates token, original buy order and session", async () => {
  const f = setup();
  try {
    await handleBillingReturn(
      callback({
        TBK_TOKEN: TOKEN,
        TBK_ORDEN_COMPRA: "wrong",
        TBK_ID_SESION: ORDER,
      }),
    );
    equal(f.order.status, "pending");
    equal(f.gets(), 0);
    await handleBillingReturn(
      callback({
        TBK_TOKEN: TOKEN,
        TBK_ORDEN_COMPRA: f.order.buy_order,
        TBK_ID_SESION: ORDER,
      }),
    );
    equal(f.order.status, "cancelled");
    equal(f.posts(), 0);
    equal(f.confirmed(), 0);
  } finally {
    f.close();
  }
});
Deno.test("Unknown callback tokens and forged approved URLs never reach provider", async () => {
  const f = setup();
  try {
    await handleBillingReturn(
      new Request(
        "https://supabase.example.test/functions/v1/billing-return?order=" +
          ORDER + "&approved=true",
      ),
    );
    await handleBillingReturn(
      callback({ token_ws: "unknown-token-123456789" }),
    );
    equal(f.posts(), 0);
    equal(f.gets(), 0);
    equal(f.confirmed(), 0);
  } finally {
    f.close();
  }
});
Deno.test("Uncertain Webpay is reconciled without a second PUT", async () => {
  const f = setup();
  try {
    f.setUnknown();
    await handleBillingReturn(callback({ token_ws: TOKEN }));
    equal(f.order.status, "unknown");
    equal(f.posts(), 1);
    f.setApproved();
    const verification = await handleBilling(
      request("verify", { order_id: ORDER }),
    );
    equal((await verification.json()).order.status, "approved");
    equal(f.posts(), 1);
    equal(f.confirmed(), 1);
  } finally {
    f.close();
  }
});
Deno.test("Mismatched provider amount remains unconfirmed", async () => {
  const f = setup();
  try {
    f.setMismatch();
    await handleBillingReturn(callback({ token_ws: TOKEN }));
    equal(f.confirmed(), 0);
    equal(f.posts(), 0);
    equal(f.order.status, "unknown");
  } finally {
    f.close();
  }
});
Deno.test("Verification rejects references belonging to another account", async () => {
  const f = setup();
  try {
    f.order.user_id = "44444444-4444-4444-8444-444444444444";
    equal(
      (await handleBilling(request("verify", { order_id: ORDER }))).status,
      404,
    );
    equal(f.gets(), 0);
  } finally {
    f.close();
  }
});
Deno.test("Oneclick requires explicit recurring consent before enrollment", async () => {
  const f = setup();
  try {
    Deno.env.set("TRANSBANK_ONECLICK_ENABLED", "true");
    equal(
      (await handleBilling(request("checkout", { plan_id: "plus" }))).status,
      422,
    );
    equal(f.posts(), 0);
    const ok = await handleBilling(
      request("checkout", { plan_id: "plus", recurring_consent: true }),
    );
    equal(ok.status, 200);
    equal((await ok.json()).redirect.field, "TBK_TOKEN");
    equal(f.confirmed(), 0);
  } finally {
    f.close();
  }
});
Deno.test("Oneclick enrollment is followed by a validated first charge", async () => {
  const f = setup();
  try {
    Deno.env.set("TRANSBANK_ONECLICK_ENABLED", "true");
    f.order.channel = "oneclick";
    await handleBillingReturn(callback({ TBK_TOKEN: TOKEN }));
    equal(f.order.status, "approved");
    equal(f.posts(), 2);
    equal(f.confirmed(), 1);
    await handleBillingReturn(callback({ TBK_TOKEN: TOKEN }));
    equal(f.posts(), 2);
  } finally {
    f.close();
  }
});
Deno.test("Successful update-card enrollment alone never grants a paid plan", async () => {
  const f = setup();
  try {
    Deno.env.set("TRANSBANK_ONECLICK_ENABLED", "true");
    f.enrollment.purpose = "update_card";
    await handleBillingReturn(callback({ TBK_TOKEN: TOKEN }));
    equal(f.posts(), 1);
    equal(f.confirmed(), 0);
    equal(f.order.status, "pending");
  } finally {
    f.close();
  }
});
Deno.test("Declined enrollment does not authorize any charge", async () => {
  const f = setup();
  try {
    Deno.env.set("TRANSBANK_ONECLICK_ENABLED", "true");
    f.setDeclined();
    await handleBillingReturn(callback({ TBK_TOKEN: TOKEN }));
    equal(f.enrollment.status, "rejected");
    equal(f.posts(), 1);
    equal(f.confirmed(), 0);
  } finally {
    f.close();
  }
});
Deno.test("Cron authorization and durable state prevent repeated renewal charges", async () => {
  const f = setup();
  try {
    Deno.env.set("TRANSBANK_ONECLICK_ENABLED", "true");
    f.order.channel = "oneclick";
    equal(
      (await handleBillingRenew(
        new Request("https://cron.test", { method: "POST" }),
      )).status,
      401,
    );
    equal(f.posts(), 0);
    const run = () =>
      handleBillingRenew(
        new Request("https://cron.test", {
          method: "POST",
          headers: {
            "x-billing-cron-secret": Deno.env.get("BILLING_CRON_SECRET")!,
          },
        }),
      );
    equal((await run()).status, 200);
    equal(f.posts(), 1);
    equal(f.confirmed(), 1);
    await run();
    equal(f.posts(), 1);
  } finally {
    f.close();
  }
});
Deno.test("Production fails closed for missing credentials and integration credentials", () => {
  const missing = transbankConfig((name) =>
    name === "TRANSBANK_ENV" ? "production" : undefined
  );
  assert(!missing.webpay && !missing.oneclick);
  equal(missing.host, "https://webpay3g.transbank.cl");
  let rejected = false;
  try {
    transbankConfig((name) =>
      ({
        TRANSBANK_ENV: "production",
        TRANSBANK_WEBPAY_COMMERCE_CODE: INTEGRATION.webpay,
        TRANSBANK_WEBPAY_API_KEY: INTEGRATION.apiKey,
      })[name]
    );
  } catch {
    rejected = true;
  }
  assert(rejected);
});
Deno.test("Oneclick rejects mismatched child commerce, child order and amount", () => {
  const config = transbankConfig((name) =>
    ({ TRANSBANK_ENV: "integration", TRANSBANK_ONECLICK_ENABLED: "true" })[name]
  );
  const order = { channel: "oneclick", buy_order: "parent", amount: 990 };
  for (
    const detail of [
      { commerce_code: "wrong", buy_order: "parent", amount: 990 },
      { commerce_code: config.childCode, buy_order: "other", amount: 990 },
      { commerce_code: config.childCode, buy_order: "parent", amount: 1990 },
    ]
  ) {
    let rejected = false;
    try {
      normalizePayment(order, {
        buy_order: "parent",
        details: [{ ...detail, status: "AUTHORIZED", response_code: 0 }],
      }, config);
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});
Deno.test("Provider form rejects external host and never disables certificate validation", () => {
  const payment = new Transbank(
    transbankConfig((name) =>
      name === "TRANSBANK_ENV" ? "integration" : undefined
    ),
  );
  let rejected = false;
  try {
    payment.redirect({ url: "https://attacker.test", token: TOKEN }, "webpay");
  } catch {
    rejected = true;
  }
  assert(rejected);
});
Deno.test("Oneclick unknown result never repeats authorize before confirmation", async () => {
  const f = setup();
  try {
    Deno.env.set("TRANSBANK_ONECLICK_ENABLED", "true");
    f.order.channel = "oneclick";
    f.setUnknown();
    await handleBillingReturn(callback({ TBK_TOKEN: TOKEN }));
    equal(f.order.status, "unknown");
    equal(f.confirmed(), 0);
    const before = f.posts();
    await handleBilling(request("verify", { order_id: ORDER }));
    equal(f.posts(), before);
    f.setApproved();
    await handleBilling(request("verify", { order_id: ORDER }));
    equal(f.order.status, "approved");
    equal(f.posts(), before);
  } finally {
    f.close();
  }
});
Deno.test("Resume requires fresh consent and unknown checkout cannot reopen a form", async () => {
  const f = setup();
  try {
    equal((await handleBilling(request("resume"))).status, 422);
    equal(
      (await handleBilling(request("resume", { recurring_consent: true })))
        .status,
      200,
    );
    f.order.status = "unknown";
    equal(
      (await handleBilling(request("checkout", { plan_id: "plus" }))).status,
      409,
    );
    equal(f.posts(), 0);
  } finally {
    f.close();
  }
});
