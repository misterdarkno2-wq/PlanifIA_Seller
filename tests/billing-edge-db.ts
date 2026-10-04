import { handleBilling } from "../supabase/functions/billing/handler.ts";
import { handleBillingReturn } from "../supabase/functions/billing-return/handler.ts";
import { handleBillingRenew } from "../supabase/functions/billing-renew/handler.ts";
import { INTEGRATION } from "../supabase/functions/_shared/transbank.ts";

function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
}
const port = Deno.env.get("BILLING_FIXTURE_PORT"),
  base = "http://127.0.0.1:" + port,
  nativeFetch = globalThis.fetch;
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  C = "33333333-3333-4333-8333-333333333333";
for (
  const [key, value] of Object.entries({
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_ANON_KEY: "fixture-public",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    TRANSBANK_ENV: "integration",
    TRANSBANK_ONECLICK_ENABLED: "false",
    BILLING_SITE_URL: "https://planifia.cl/",
    ALLOWED_ORIGINS: "https://planifia.cl",
    BILLING_CRON_SECRET: "fixture-secret-with-at-least-32-characters",
  })
) Deno.env.set(key, value);
let status: "AUTHORIZED" | "FAILED" | "INITIALIZED" = "AUTHORIZED",
  timeout = false,
  cancellationRace = false,
  enrollmentRevocationRace = false,
  crashBeforeOrder = false;
let charges = 0, inscriptionFinishes = 0;
let createFailure = false,
  enrollmentStartFailure = false,
  losePersistedResponse: string | null = null,
  checkoutCreates = 0;
const transactions = new Map<string, any>(),
  inscriptions = new Map<string, any>();
const adminSql = async (sql: string, params: any[] = []) =>
  (await nativeFetch(base + "/fixture/admin", {
    method: "POST",
    body: JSON.stringify({ sql, params }),
  })).json();
globalThis.fetch = async (input, options) => {
  const url = String(input), method = options?.method || "GET";
  if (url.startsWith("https://supabase.example.test")) {
    if (url.includes("/rpc/billing_admin") && options?.body) {
      const request = JSON.parse(String(options.body));
      if (request.p_action === losePersistedResponse) {
        losePersistedResponse = null;
        await nativeFetch(
          base + new URL(url).pathname + new URL(url).search,
          options,
        );
        return Response.json({
          code: "fixture_lost_response",
          message: "Fixture response lost after commit",
        }, { status: 503 });
      }
      if (
        crashBeforeOrder && request.p_action === "create_order" &&
        request.p_payload.user_id === C
      ) {
        crashBeforeOrder = false;
        return Response.json({
          code: "fixture_crash",
          message: "Fixture interrupted after enrollment",
        }, { status: 503 });
      }
      if (enrollmentRevocationRace && request.p_action === "enroll_finish") {
        enrollmentRevocationRace = false;
        await nativeFetch(base + "/rest/v1/rpc/billing_admin", {
          method: "POST",
          headers: { Authorization: "Bearer fixture-service" },
          body: JSON.stringify({
            p_action: "remove_method",
            p_payload: { user_id: A, environment: "integration" },
          }),
        });
      }
      if (cancellationRace && request.p_action === "charge_started") {
        cancellationRace = false;
        await adminSql(
          "update private.billing_methods set active=false where user_id=$1",
          [A],
        );
        await adminSql(
          "update public.subscriptions set auto_renew=false,cancel_at_period_end=true where user_id=$1",
          [A],
        );
      }
    }
    return nativeFetch(
      base + new URL(url).pathname + new URL(url).search,
      options,
    );
  }
  if (!url.startsWith("https://webpay3gint.transbank.cl")) {
    throw new Error("Unexpected external request");
  }
  const path = new URL(url).pathname,
    body = options?.body ? JSON.parse(String(options.body)) : {};
  if (path.includes("/inscriptions")) {
    if (method === "POST") {
      if (enrollmentStartFailure) {
        enrollmentStartFailure = false;
        throw new TypeError("Fixture enrollment start timeout");
      }
      const token = "enrollment-" + crypto.randomUUID();
      inscriptions.set(token, body);
      return Response.json({
        token,
        url_webpay:
          "https://webpay3gint.transbank.cl/webpayserver/initTransaction",
      });
    }
    if (method === "PUT") {
      inscriptionFinishes++;
      return Response.json({
        response_code: 0,
        tbk_user: "private-tbk-reference",
        card_type: "Visa",
        card_number: "6623",
      });
    }
    return new Response(null, { status: 204 });
  }
  if (method === "POST" && !body.details) {
    checkoutCreates++;
    if (createFailure) {
      createFailure = false;
      throw new TypeError("Fixture checkout creation timeout");
    }
    const token = "webpay-" + crypto.randomUUID();
    transactions.set(token, { ...body, status: "INITIALIZED" });
    return Response.json({
      token,
      url: "https://webpay3gint.transbank.cl/webpayserver/initTransaction",
    });
  }
  let transaction;
  if (method === "POST") {
    charges++;
    transaction = {
      buy_order: body.buy_order,
      details: [{
        ...body.details[0],
        status,
        response_code: status === "AUTHORIZED" ? 0 : -1,
        authorization_code: "123456",
      }],
    };
    transactions.set(body.buy_order, transaction);
  } else {
    transaction = transactions.get(decodeURIComponent(path.split("/").pop()!));
    if (!transaction) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (method === "PUT") {
      charges++;
      transaction.status = status;
      transaction.response_code = status === "AUTHORIZED" ? 0 : -1;
    }
  }
  if (timeout && method !== "GET") {
    throw new TypeError("Fixture uncertain response after charge");
  }
  return Response.json(transaction);
};
async function billing(action: string, payload: any = {}, user = "a") {
  // Modela el resumen que el usuario revisa antes de autorizar cada contratación.
  if (action === "checkout" && payload.expected_amount_clp === undefined) {
    const quote = await billing("quote", payload, user);
    assert(quote.status === 200, "Fixture needs a valid reviewed quote");
    payload = { ...payload, expected_amount_clp: quote.data.quote.amount_clp };
  }
  const result = await handleBilling(
    new Request("https://supabase.example.test/functions/v1/billing", {
      method: "POST",
      headers: {
        Origin: "https://planifia.cl",
        Authorization: "Bearer fixture-user-" + user,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, ...payload }),
    }),
  );
  return { status: result.status, data: await result.json() };
}
async function returned(token: string, field = "token_ws", extra: any = {}) {
  return handleBillingReturn(
    new Request("https://supabase.example.test/functions/v1/billing-return", {
      method: "POST",
      body: new URLSearchParams({ [field]: token, ...extra }),
    }),
  );
}
const cron = () =>
  handleBillingRenew(
    new Request("https://supabase.example.test/functions/v1/billing-renew", {
      method: "POST",
      headers: {
        "x-billing-cron-secret": Deno.env.get("BILLING_CRON_SECRET")!,
      },
    }),
  );

const publicCatalogResponse = await handleBilling(
  new Request(
    "https://supabase.example.test/functions/v1/billing",
    {
      method: "POST",
      headers: {
        Origin: "https://planifia.cl",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "catalog" }),
    },
  ),
);
const publicCatalog = await publicCatalogResponse.json();
assert(
  publicCatalogResponse.status === 200 && publicCatalog.promotion.active,
  "Anonymous catalog receives the real campaign through the public RPC",
);
assert(
  Date.parse(publicCatalog.promotion.ends_at) -
      Date.parse(publicCatalog.promotion.starts_at) === 7 * 86400000,
  "Published offer is seven days long and fixed by the database",
);
const staleQuote = await billing("quote", {
  plan_id: "plus",
  channel: "webpay",
}, "b");
assert(
  staleQuote.data.quote.amount_clp === 990,
  "Quote before campaign closes",
);
await adminSql(
  "update private.billing_campaign set starts_at=now()-interval '7 days',ends_at=now()-interval '1 second' where id='welcome'",
);
const createsBeforeExpiry = checkoutCreates;
const staleCheckout = await billing("checkout", {
  plan_id: "plus",
  channel: "webpay",
  expected_amount_clp: 990,
}, "b");
assert(
  staleCheckout.status === 409 && checkoutCreates === createsBeforeExpiry,
  "Expired Webpay quote is rejected before calling Transbank",
);
Deno.env.set("TRANSBANK_ONECLICK_ENABLED", "true");
const staleEnrollment = await billing("checkout", {
  plan_id: "plus",
  channel: "oneclick",
  recurring_consent: true,
  expected_amount_clp: 990,
}, "b");
assert(
  staleEnrollment.status === 409 && inscriptions.size === 0,
  "Expired Oneclick quote is rejected before inscription",
);
assert(
  (await adminSql("select count(*)::integer n from public.payment_orders"))[0]
    .n === 0,
  "Rejected stale quote leaves no payment order",
);
await adminSql(
  "update private.billing_campaign set starts_at=$1,ends_at=$2 where id='welcome'",
  [publicCatalog.promotion.starts_at, publicCatalog.promotion.ends_at],
);
Deno.env.set("TRANSBANK_ONECLICK_ENABLED", "false");

// Webpay: first promotional payment, duplicate callback and data isolation.
let checkout = await billing("checkout", {
  plan_id: "plus",
  request_id: crypto.randomUUID(),
});
assert(checkout.status === 200, "First checkout: " + JSON.stringify(checkout));
await returned(checkout.data.redirect.token);
await returned(checkout.data.redirect.token);
let state = await billing("state");
assert(state.data.effective_plan.id === "plus", "Server payment grants Plus");
assert(state.data.payments[0].amount === 990, "Plus first price");
assert(charges === 1, "Callback cannot charge twice");
assert(
  (await billing("verify", { order_id: checkout.data.order_id }, "b"))
    .status === 404,
  "Other user cannot verify order",
);
assert(
  !(JSON.stringify(state.data).includes(checkout.data.redirect.token)),
  "State never exposes provider token",
);
await billing("change_plan", { plan_id: "pro" });
const quote = await billing("quote", { plan_id: "pro", for_change: true });
assert(
  quote.status === 200 && quote.data.quote.amount_clp === 4990,
  "Scheduled plan switch is regular Pro price",
);
checkout = await billing("checkout", {
  plan_id: "pro",
  request_id: crypto.randomUUID(),
});
assert(checkout.status === 200, "Anticipated renewal");
await returned(checkout.data.redirect.token);
state = await billing("state");
assert(
  state.data.effective_plan.id === "plus",
  "Early paid Pro waits for next period",
);
assert(
  state.data.payments.find((p: any) => p.id === checkout.data.order_id)
    .amount === 4990,
  "Changing plan cannot repeat promotion",
);

// Other user: Oneclick duplicate enrollment start keeps exact persisted token.
Deno.env.set("TRANSBANK_ONECLICK_ENABLED", "true");
let enrollment = await billing("checkout", {
  plan_id: "pro",
  recurring_consent: true,
}, "b");
assert(enrollment.status === 200, "Oneclick checkout");
const duplicate = await billing("checkout", {
  plan_id: "pro",
  recurring_consent: true,
}, "b");
assert(
  duplicate.data.redirect.token === enrollment.data.redirect.token,
  "Double click preserves enrollment token",
);
await returned(enrollment.data.redirect.token, "TBK_TOKEN");
await returned(enrollment.data.redirect.token, "TBK_TOKEN");
state = await billing("state", {}, "b");
assert(state.data.effective_plan.id === "pro", "Oneclick charge grants Pro");
assert(state.data.payments[0].amount === 1990, "Pro first price");
assert(
  inscriptionFinishes === 1,
  "Repeated callback never finishes enrollment twice",
);
assert(
  (await billing(
    "verify",
    { enrollment_id: enrollment.data.enrollment_id },
    "b",
  )).data.order.status === "approved",
  "Enrollment polling returns the confirmed order",
);

// Recovery is driven by the server cron even if the app closes after inscription.
enrollment = await billing("checkout", {
  plan_id: "plus",
  recurring_consent: true,
}, "c");
crashBeforeOrder = true;
const beforeRecovery = charges;
await returned(enrollment.data.redirect.token, "TBK_TOKEN");
assert(
  charges === beforeRecovery,
  "A crash before creating the payment order cannot charge",
);
await cron();
const recoveredState = await billing("state", {}, "c");
assert(
  recoveredState.data.effective_plan.id === "plus" &&
    charges === beforeRecovery + 1,
  "Cron recovers enrolled checkout exactly once without app",
);
await cron();
assert(
  charges === beforeRecovery + 1,
  "Repeated cron cannot charge the recovered checkout twice",
);
enrollment = await billing("checkout", {
  plan_id: "plus",
  recurring_consent: true,
}, "c");
crashBeforeOrder = true;
await returned(enrollment.data.redirect.token, "TBK_TOKEN");
const conflictingCheckout = await billing("checkout", {
  plan_id: "plus",
  channel: "webpay",
  request_id: crypto.randomUUID(),
}, "c");
assert(
  conflictingCheckout.status === 200,
  "Prepare another pending checkout for the recovered enrollment conflict",
);

// Unknown outcome resolves to confirmed decline before a different reference retry.
await adminSql(
  "update public.subscriptions set period_start=now()-interval '2 months',period_end=now()-interval '1 second' where user_id=$1",
  [B],
);
await adminSql(
  "update public.subscription_periods set starts_at=now()-interval '2 months',ends_at=now()-interval '1 second' where user_id=$1",
  [B],
);
status = "FAILED";
timeout = true;
const beforeRetry = charges;
const unknownRun = await cron();
const unknownRunBody = await unknownRun.json();
timeout = false;
assert(
  unknownRun.status === 200 && unknownRunBody.failed >= 1,
  "One user's enrollment conflict is counted without aborting the batch",
);
state = await billing("state", {}, "b");
const rejected = state.data.payments.find((p: any) => p.renewal);
assert(
  rejected?.status === "rejected",
  "Uncertain result reconciles a confirmed decline: " +
    JSON.stringify({
      cron: unknownRunBody,
      payments: state.data.payments.map((p: any) => ({
        status: p.status,
        renewal: p.renewal,
        amount: p.amount,
      })),
      charges,
    }),
);
const firstReference = rejected.buy_order;
await cron();
assert(
  charges === beforeRetry + 1,
  "Rejected retry waits its configured delay",
);
await adminSql(
  "update public.payment_orders set retry_at=now()-interval '1 second' where id=$1",
  [rejected.id],
);
status = "AUTHORIZED";
await cron();
state = await billing("state", {}, "b");
const retried = state.data.payments.find((p: any) => p.id === rejected.id);
assert(
  retried.status === "approved" && retried.buy_order !== firstReference,
  "Confirmed retry uses a new durable Transbank order",
);
assert(retried.amount === 4990, "Pro renewal charges regular price");
assert(
  Date.parse(retried.period_start) >= Date.now() - 10000,
  "Late renewal starts a full month from confirmation",
);
assert(
  Date.parse(retried.period_end) - Date.parse(retried.period_start) >=
    28 * 86400000,
  "Late renewal retains at least a calendar month of access",
);
await adminSql(
  "update public.subscriptions set period_start=now()-interval '2 months',period_end=now()-interval '4 days' where user_id=$1",
  [B],
);
await adminSql(
  "update public.subscription_periods set starts_at=now()-interval '2 months',ends_at=now()-interval '4 days' where order_id=$1",
  [retried.id],
);
const beforeGrace = charges;
await cron();
assert(
  charges === beforeGrace &&
    (await billing("state", {}, "b")).data.subscription.auto_renew === false,
  "After the 72-hour grace window the server stops automatic charging",
);

// Enrollment complete before order creation: background job recovers without app.
enrollment = await billing("update_card", { recurring_consent: true }, "a");
assert(enrollment.status === 200, "Update card");
await returned(enrollment.data.redirect.token, "TBK_TOKEN");
state = await billing("state");
assert(state.data.payments.length === 2, "Update card does not charge");
await adminSql(
  "update public.subscriptions set channel='oneclick',auto_renew=true,cancel_at_period_end=false,cancelled_at=null,recurring_consent_at=now(),next_plan_id=null,period_start=now()-interval '2 months',period_end=now()-interval '1 second' where user_id=$1",
  [A],
);
await adminSql(
  "update public.subscription_periods set starts_at=now()-interval '2 months',ends_at=now()-interval '1 second' where user_id=$1 and starts_at<=now()",
  [A],
);
cancellationRace = true;
const beforeCancel = charges;
await cron();
assert(
  charges === beforeCancel,
  "Revocation between lease and charge prevents authorize",
);
const resume = await billing("resume");
assert(resume.status === 422, "Resume requires explicit fresh consent");
enrollment = await billing("update_card", { recurring_consent: true }, "a");
enrollmentRevocationRace = true;
const beforeEnrollmentRevocation = charges;
await returned(enrollment.data.redirect.token, "TBK_TOKEN");
assert(
  charges === beforeEnrollmentRevocation,
  "Revocation while enrollment finishes cannot charge",
);
assert(
  (await billing("verify", { enrollment_id: enrollment.data.enrollment_id }))
    .data.enrollment.status === "cancelled",
  "Handler preserves the database revocation outcome",
);

// Clean independent account state for terminal cancellation and abandoned flow.
await adminSql("delete from public.subscriptions where user_id=$1", [A]);
await adminSql("delete from public.subscription_periods where user_id=$1", [A]);
await adminSql("delete from public.payment_orders where user_id=$1", [A]);
checkout = await billing("checkout", {
  plan_id: "plus",
  channel: "webpay",
  request_id: crypto.randomUUID(),
});
const persisted =
  (await adminSql("select * from public.payment_orders where id=$1", [
    checkout.data.order_id,
  ]))[0];
await returned(checkout.data.redirect.token, "TBK_TOKEN", {
  TBK_ID_SESION: persisted.session_id,
  TBK_ORDEN_COMPRA: persisted.buy_order,
});
assert(
  (await billing("state")).data.payments[0].status === "cancelled",
  "Correlated cancellation is persisted without charge",
);
checkout = await billing("checkout", {
  plan_id: "plus",
  channel: "webpay",
  request_id: crypto.randomUUID(),
});
await adminSql(
  "update public.payment_orders set created_at=now()-interval '31 minutes' where id=$1",
  [checkout.data.order_id],
);
await cron();
assert(
  (await billing("state")).data.payments.find((p: any) =>
    p.id === checkout.data.order_id
  ).status === "abandoned",
  "Cron closes a confirmed INITIALIZED abandoned checkout",
);
checkout = await billing("checkout", {
  plan_id: "plus",
  channel: "webpay",
  request_id: crypto.randomUUID(),
});
const timedOutOrder =
  (await adminSql("select * from public.payment_orders where id=$1", [
    checkout.data.order_id,
  ]))[0];
await returned("", "TBK_TOKEN", {
  TBK_ID_SESION: timedOutOrder.session_id,
  TBK_ORDEN_COMPRA: timedOutOrder.buy_order,
});
assert(
  (await billing("state")).data.payments.find((p: any) =>
    p.id === checkout.data.order_id
  ).status === "abandoned",
  "Tokenless timeout matches both persisted references and provider status",
);
createFailure = true;
const failedCreation = await billing("checkout", {
  plan_id: "plus",
  channel: "webpay",
  request_id: crypto.randomUUID(),
});
assert(failedCreation.status === 503, "Creation timeout is reported clearly");
const failedCreationOrder = (await billing("state")).data.payments[0];
assert(
  failedCreationOrder.status === "abandoned",
  "Database closes creation failure only before persisting token or starting a charge",
);
checkout = await billing("checkout", {
  plan_id: "plus",
  channel: "webpay",
  request_id: crypto.randomUUID(),
});
assert(
  checkout.status === 200 && checkout.data.order_id !== failedCreationOrder.id,
  "A safe initial creation failure can be retried as a new order",
);
const retryCreationOrder =
  (await adminSql("select * from public.payment_orders where id=$1", [
    checkout.data.order_id,
  ]))[0];
await returned(checkout.data.redirect.token, "TBK_TOKEN", {
  TBK_ID_SESION: retryCreationOrder.session_id,
  TBK_ORDEN_COMPRA: retryCreationOrder.buy_order,
});
losePersistedResponse = "provider_started";
const creationCount = checkoutCreates;
assert(
  (await billing("checkout", {
    plan_id: "plus",
    channel: "webpay",
    request_id: crypto.randomUUID(),
  })).status === 503,
  "A lost persistence response is reported",
);
const persistedCreationOrder = (await billing("state")).data.pending_order;
assert(
  persistedCreationOrder?.status === "pending",
  "A persisted token is never abandoned based on stale captured data",
);
checkout = await billing("checkout", {
  plan_id: "plus",
  channel: "webpay",
  request_id: crypto.randomUUID(),
});
assert(
  checkout.status === 200 && checkoutCreates === creationCount + 1,
  "Retry resumes the same persisted provider form without creating another",
);

enrollmentStartFailure = true;
assert(
  (await billing("update_card", { recurring_consent: true })).status === 503,
  "Enrollment start failure is reported",
);
assert(
  (await billing("state")).data.pending_enrollment === null,
  "Unstarted enrollment failure is closed safely",
);
losePersistedResponse = "enroll_started";
assert(
  (await billing("update_card", { recurring_consent: true })).status === 503,
  "Enrollment persistence response lost",
);
const retainedEnrollment = (await billing("state")).data.pending_enrollment;
assert(
  retainedEnrollment?.status === "pending",
  "A persisted enrollment token is retained",
);
assert(
  (await billing("update_card", { recurring_consent: true })).data
    .enrollment_id === retainedEnrollment.id,
  "Enrollment retry resumes its original form",
);
console.log("billing-edge-db: verified");
