// Fixtures explícitas: no usa cuentas, credenciales ni cobros reales.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const origin = "http://127.0.0.1:5186";
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5186",
    "--strictPort",
  ],
  {
    stdio: "pipe",
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "https://supabase.example.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_billing_fixture",
    },
  },
);
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});
const catalog = [
  {
    id: "free",
    name: "Gratis",
    price_clp: 0,
    first_month_clp: 0,
    max_active_goals: 3,
    ai_generations: 3,
    ai_adjustments: 1,
    benefits: ["Calendario y hábitos", "Lumi y progreso de tus metas"],
    enabled: true,
    position: 0,
  },
  {
    id: "plus",
    name: "Plus",
    price_clp: 2750,
    first_month_clp: 990,
    max_active_goals: 15,
    ai_generations: 30,
    ai_adjustments: 15,
    benefits: ["Calendario y hábitos", "Lumi y progreso de tus metas"],
    enabled: true,
    position: 1,
  },
  {
    id: "pro",
    name: "Pro",
    price_clp: 4990,
    first_month_clp: 1990,
    max_active_goals: 50,
    ai_generations: 100,
    ai_adjustments: 50,
    benefits: ["Calendario y hábitos", "Lumi y progreso de tus metas"],
    enabled: true,
    position: 2,
  },
];
const capabilities = {
  environment: "integration",
  webpay: true,
  oneclick: true,
  preferred_channel: "oneclick",
  simulation: true,
};
const periodStart = "2030-01-31T15:00:00Z",
  periodEnd = "2030-02-28T15:00:00Z";
const campaign = {
  starts_at: periodStart,
  ends_at: "2030-02-07T15:00:00Z",
  server_now: periodStart,
  active: true,
};
const orderId = "12000000-0000-4000-8000-000000000012";
const enrollmentId = "22000000-0000-4000-8000-000000000022";
const initial = () => ({
  plans: catalog,
  effective_plan: catalog[0],
  subscription: null,
  promotion_available: true,
  promotion: { ...campaign },
  payments: [],
  pending_order: null,
  usage: {
    active_goals: 2,
    generations: 1,
    adjustments: 0,
    generation_limit: 3,
    adjustment_limit: 1,
    max_active_goals: 3,
    month: "2030-01-01",
    reset_at: "2030-02-01T00:00:00Z",
  },
  settings: {
    usage_timezone: "UTC",
    currency: "CLP",
    environment: "integration",
  },
  capabilities,
});
const paid = (channel = "oneclick") => ({
  ...initial(),
  effective_plan: catalog[1],
  promotion_available: false,
  subscription: {
    plan_id: "plus",
    next_plan_id: null,
    status: "active",
    effective_status: "active",
    channel,
    period_start: periodStart,
    period_end: periodEnd,
    paid_until: periodEnd,
    auto_renew: channel === "oneclick",
    access_active: true,
    next_amount: 2750,
    next_plan: catalog[1],
    payment_method: { card_type: "Visa", last4: "6623", active: true },
  },
  payments: [
    {
      id: orderId,
      plan_id: "plus",
      amount: 990,
      promo_applied: true,
      status: "approved",
      channel,
      period_start: periodStart,
      period_end: periodEnd,
      created_at: periodStart,
    },
  ],
  usage: {
    ...initial().usage,
    active_goals: 10,
    generations: 4,
    adjustments: 2,
  },
});
const html = ({
  user = true,
  view = "subscription",
}) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba de suscripciones PlanifIA</title><div id="fixture" style="max-width:1220px;margin:auto;padding:28px 18px"></div><script type="module">
  import '/src/style.css';
  import {renderBilling,mountBilling,consumeBillingIntent,paymentResult} from '/src/billing.js';
  const root=document.querySelector('#fixture'),user=${user ? '{id:"fixture-user"}' : "null"};
  root.innerHTML=renderBilling({view:${JSON.stringify(view)},user});
  const call=async(action,payload={})=>{const response=await fetch('/fixture-billing-api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;};
  window.fixtureNotifications=[];
  window.fixtureDispose=mountBilling(root,{user,billing:call,loadCatalog:()=>call('catalog'),onLogin:()=>{location.hash='login'},notify:(message)=>window.fixtureNotifications.push(message)});
  window.consumeFixtureIntent=consumeBillingIntent;
  window.fixturePaymentResult=paymentResult;
</script></html>`;

let browser;
const errors = [];
const captures = [];
async function fixture({
  user = true,
  view = "subscription",
  hash = "",
  state = initial(),
  verified = { order: { id: orderId, amount: 990, status: "unknown" } },
  failState = false,
  clock = false,
} = {}) {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 1024 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const calls = [];
  const current = structuredClone(state);
  await page.route("**/billing-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: html({ user, view }) }),
  );
  await page.route("**/fixture-billing-api", async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    let result;
    if (body.action === "catalog")
      result = {
        plans: current.plans,
        capabilities,
        promotion: current.promotion,
        promotion_available: current.promotion_available,
      };
    else if (body.action === "state") {
      if (failState) {
        await route.fulfill({
          status: 503,
          json: {
            error: "La conexión está en preparación. Vuelve a consultar.",
          },
        });
        return;
      }
      result = current;
    } else if (body.action === "verify") result = verified;
    else if (body.action === "cancel") {
      current.subscription.auto_renew = false;
      current.subscription.cancel_at_period_end = true;
      result = current;
    } else
      throw new Error(`La web no debe solicitar esta acción: ${body.action}`);
    await route.fulfill({ json: result });
  });
  await page.goto(`${origin}/billing-fixture${hash}`);
  await page
    .locator(
      failState
        ? "[data-billing-error]"
        : user && view === "subscription"
          ? ".billing-subscription"
          : ".billing-plans",
    )
    .waitFor({ state: "visible" });
  return {
    page,
    calls,
  };
}
const noOverflow = async (page) =>
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "La pantalla no debe producir desplazamiento horizontal",
  );
const capture = async (page, name) => {
  await noOverflow(page);
  const path = `dist/qa/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  captures.push(path);
};

async function mainFixture(hash = "") {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 1024 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const uid = randomUUID(),
    now = Math.floor(Date.now() / 1000);
  const user = {
    id: uid,
    email: "ana@example.test",
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { name: "Ana" },
  };
  const token =
    "eyJhbGciOiJIUzI1NiJ9." +
    Buffer.from(
      JSON.stringify({ sub: uid, exp: now + 7200, aud: "authenticated" }),
    ).toString("base64url") +
    ".fixture";
  const session = {
    access_token: token,
    token_type: "bearer",
    refresh_token: "fixture",
    expires_in: 7200,
    expires_at: now + 7200,
    user,
  };
  const profile = {
    user_id: uid,
    name: "Ana",
    timezone: "America/Santiago",
    weekly_minutes: 700,
    available_days: [0, 1, 2, 3, 4, 5, 6],
  };
  const calls = [];
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  await page.route("https://supabase.example.test/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    let result;
    if (url.pathname === "/auth/v1/token") result = session;
    else if (url.pathname === "/auth/v1/user") result = user;
    else if (url.pathname === "/rest/v1/profiles") result = profile;
    else if (url.pathname === "/rest/v1/rpc/pet_state")
      result = {
        name: "Lumi",
        total_xp: 0,
        level: 1,
        stage: 1,
        level_xp: 0,
        next_xp: 100,
      };
    else if (url.pathname === "/functions/v1/billing") {
      const body = request.postDataJSON();
      calls.push(body);
      if (body.action === "catalog")
        result = {
          plans: catalog,
          capabilities,
          promotion: { ...campaign },
          promotion_available: true,
        };
      else if (body.action === "state") result = initial();
      else if (body.action === "verify") {
        assert.equal(body.order_id, orderId);
        assert.equal(request.headers().authorization, `Bearer ${token}`);
        result = {
          order: {
            id: orderId,
            plan_id: "plus",
            amount: 990,
            status: "rejected",
          },
        };
      } else
        throw new Error(
          `Acción del montaje principal no prevista: ${body.action}`,
        );
    } else if (url.pathname.startsWith("/rest/v1/")) result = [];
    else
      throw new Error(
        `Solicitud de fixture no prevista: ${request.method()} ${url.pathname}`,
      );
    await route.fulfill({ json: result, headers });
  });
  await page.goto(`${origin}/${hash}`);
  return { page, calls };
}
async function loginMain(page) {
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill("ana@example.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("Fixture1234");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
}

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await mkdir("dist/qa", { recursive: true });
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const noPurchase = (calls) =>
    assert.equal(
      calls.some((call) =>
        ["quote", "checkout", "resume", "update_card", "change_plan"].includes(
          call.action,
        ),
      ),
      false,
      "La web no debe iniciar contrataciones ni autorizaciones de cobro",
    );
  const noPaymentControls = async (page) => {
    assert.equal(
      await page
        .locator(
          '[data-billing-checkout], [data-billing-channel], [data-billing-consent-action], [data-confirm-change], [data-billing-action="renew"], [data-billing-action="resume"], [data-billing-action="update-card"]',
        )
        .count(),
      0,
    );
    assert.doesNotMatch(
      await page.locator("[data-billing-root]").innerText(),
      /Webpay|Oneclick|Transbank|pagos de prueba|Inscribir y pagar/i,
    );
    assert.equal(
      await page.locator('a[href*="play.google.com/store/apps"]').count(),
      0,
      "No inventar un enlace para una app aún no publicada",
    );
    await noOverflow(page);
  };

  // Las capacidades antiguas del servidor nunca vuelven a habilitar pagos en la web.
  for (const environment of ["integration", "production", "disabled"]) {
    const state = initial();
    state.capabilities.environment = environment;
    const { page, calls } = await fixture({
      user: false,
      view: "plans",
      state,
    });
    await page.locator("[data-google-play-notice]").waitFor();
    assert.match(
      await page.locator("[data-google-play-notice]").innerText(),
      /Las suscripciones se contratan desde la app de Google Play/,
    );
    assert.match(
      await page.locator("[data-google-play-notice]").innerText(),
      /en preparación/,
    );
    assert.equal(
      await page
        .locator('[data-plan-card="plus"] .billing-price strong')
        .innerText(),
      "$2.750",
    );
    assert.equal(
      await page
        .locator('[data-plan-card="pro"] .billing-price strong')
        .innerText(),
      "$4.990",
    );
    assert.match(
      await page.locator('[data-plan-card="plus"]').innerText(),
      /Precio de referencia/,
    );
    assert.equal(
      await page.locator("[data-billing-offer]").count(),
      0,
      "La campaña de Transbank no se anuncia como una oferta activa de Play",
    );
    for (const id of ["plus", "pro"]) {
      await page.locator(`[data-google-play-plan="${id}"]`).click();
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "google-play-title",
      );
      assert.equal(new URL(page.url()).hash, "");
      assert.equal(
        await page.evaluate(() => window.consumeFixtureIntent()),
        null,
      );
    }
    await noPaymentControls(page);
    noPurchase(calls);
    if (environment === "integration") {
      await capture(page, "google-play-plans-desktop");
      await page.setViewportSize({ width: 390, height: 844 });
      await noPaymentControls(page);
      await capture(page, "google-play-plans-mobile");
    }
    await page.close();
  }

  // La opción gratuita conserva su recorrido y no lleva a una compra.
  {
    const { page, calls } = await fixture({ user: false, view: "plans" });
    await page
      .getByRole("button", { name: "Empezar gratis", exact: true })
      .click();
    assert.equal(new URL(page.url()).hash, "#login");
    assert.equal(
      await page.evaluate(() => window.consumeFixtureIntent()),
      "free",
    );
    assert.equal(
      await page.evaluate(() => window.consumeFixtureIntent()),
      null,
    );
    noPurchase(calls);
    await page.close();
  }
  {
    const { page, calls } = await fixture({ view: "plans" });
    await page
      .getByRole("button", { name: "Continuar con Gratis", exact: true })
      .click();
    assert.equal(new URL(page.url()).hash, "#today");
    noPurchase(calls);
    await page.close();
  }

  // Enlaces guardados y un botón antiguo inyectado no permiten cotizar ni pagar.
  for (const id of ["plus", "pro"]) {
    const { page, calls } = await fixture({ hash: `#subscription?plan=${id}` });
    await page.locator("#google-play-title:focus").waitFor();
    await page.evaluate(() => {
      const root = document.querySelector("[data-billing-root]");
      for (const data of [
        { billingPlan: "plus" },
        { billingAction: "renew" },
        { billingAction: "resume" },
        { billingAction: "update-card" },
        { confirmChange: "pro" },
      ]) {
        const button = document.createElement("button");
        Object.assign(button.dataset, data);
        root.append(button);
        button.click();
        button.remove();
      }
    });
    await noPaymentControls(page);
    noPurchase(calls);
    assert.equal(await page.locator("[data-billing-review]").innerText(), "");
    await page.close();
  }

  // Consultas del plan, consumo e historial, sin renovación Webpay ni alta de tarjetas.
  for (const channel of ["webpay", "oneclick"]) {
    const { page, calls } = await fixture({ state: paid(channel) });
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      "Plus",
    );
    assert.equal(await page.locator(".billing-history tbody tr").count(), 1);
    assert.match(
      await page.locator(".billing-usage").innerText(),
      /10\s*\/\s*15/,
    );
    await noPaymentControls(page);
    await capture(page, `google-play-subscription-${channel}-desktop`);
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, `google-play-subscription-${channel}-mobile`);
    if (channel === "oneclick") {
      // Retirar una autorización anterior sigue siendo posible. No crea nuevos cobros.
      await page
        .getByRole("button", { name: "Cancelar futuros cobros", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Confirmar cancelación de futuros cobros",
          exact: true,
        })
        .click();
      await page
        .getByText("Activo · sin cobros automáticos", { exact: true })
        .waitFor();
      assert.equal(calls.filter((call) => call.action === "cancel").length, 1);
      assert.equal(await page.locator(".billing-history tbody tr").count(), 1);
      assert.equal(
        await page.locator(".billing-subscription h2").innerText(),
        "Plus",
      );
    } else
      assert.equal(
        await page.locator('[data-billing-action="cancel"]').count(),
        0,
      );
    noPurchase(calls);
    await page.close();
  }

  // Resultados de pagos anteriores: sólo la respuesta del servidor decide el estado.
  for (const [status, title] of [
    ["approved", "Pago aprobado"],
    ["rejected", "El pago fue rechazado"],
    ["cancelled", "Pago cancelado"],
    ["abandoned", "El pago no se completó"],
    ["unknown", "Estamos verificando el resultado"],
  ]) {
    const { page, calls } = await fixture({
      hash: `#subscription?order=${orderId}&status=approved`,
      verified: { order: { id: orderId, status, amount: 990 } },
    });
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    if (status !== "approved")
      assert.equal(
        await page
          .getByRole("heading", { name: "Pago aprobado", exact: true })
          .count(),
        0,
      );
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      "Gratis",
    );
    await noPaymentControls(page);
    noPurchase(calls);
    await page.evaluate(() => window.fixtureDispose());
    const count = calls.length;
    await page.waitForTimeout(2700);
    assert.equal(
      calls.length,
      count,
      "Desmontar la vista cancela la consulta automática",
    );
    await page.close();
  }
  {
    const state = initial();
    state.pending_order = { id: orderId, status: "pending" };
    const { page, calls } = await fixture({
      state,
      verified: { order: { id: orderId, status: "rejected" } },
    });
    await page
      .getByRole("button", { name: "Consultar pago pendiente", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "El pago fue rechazado", exact: true })
      .waitFor();
    assert.equal(
      calls.some((call) => call.action === "verify"),
      true,
    );
    noPurchase(calls);
    await page.close();
  }
  {
    const state = initial();
    state.pending_enrollment = { id: enrollmentId, status: "pending" };
    const { page, calls } = await fixture({
      state,
      hash: `#subscription?enrollment=${enrollmentId}`,
    });
    assert.equal(
      calls.some((call) => call.action === "verify"),
      false,
      "No completar inscripciones de tarjetas desde la web",
    );
    await noPaymentControls(page);
    await page.close();
  }

  // Vencimiento, protección de datos y errores de red.
  {
    const state = paid("webpay");
    state.effective_plan = catalog[0];
    state.subscription.access_active = false;
    state.subscription.effective_status = "expired";
    const { page } = await fixture({ state });
    assert.match(
      await page.locator(".billing-subscription").innerText(),
      /Período vencido · acceso Gratis/,
    );
    assert.match(
      await page.locator(".billing-usage").innerText(),
      /Tu información sigue disponible/,
    );
    assert.equal(await page.locator(".billing-history tbody tr").count(), 1);
    await noPaymentControls(page);
    await page.close();
  }
  {
    const { page, calls } = await fixture({ failState: true });
    await page
      .getByRole("button", { name: "Volver a consultar", exact: true })
      .click();
    await page.getByRole("alert").waitFor();
    assert.match(
      await page.getByRole("alert").innerText(),
      /conexión está en preparación/,
    );
    assert.equal(
      await page.locator("[data-google-play-notice]").isVisible(),
      true,
    );
    await noPaymentControls(page);
    noPurchase(calls);
    await page.close();
  }

  // Montaje real de main.js: planes públicos, inicio de sesión, Mi plan y retorno antiguo.
  {
    const { page, calls } = await mainFixture("#plans");
    await page.locator('[data-google-play-plan="plus"]').click();
    assert.equal(new URL(page.url()).hash, "#plans");
    await page
      .getByRole("button", { name: "Empezar gratis", exact: true })
      .click();
    await page.waitForURL(/#login$/);
    await loginMain(page);
    await page.waitForURL(/#today$/);
    await page.getByRole("link", { name: "Mi plan", exact: true }).click();
    await page.locator(".billing-subscription").waitFor();
    await noPaymentControls(page);
    await capture(page, "google-play-main-subscription-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "google-play-main-subscription-mobile");
    noPurchase(calls);
    await page.close();
  }
  {
    const { page, calls } = await mainFixture(
      `#subscription?order=${orderId}&status=approved`,
    );
    await page
      .getByRole("link", { name: "Iniciar sesión", exact: true })
      .first()
      .click();
    await loginMain(page);
    await page
      .getByRole("heading", { name: "El pago fue rechazado", exact: true })
      .waitFor();
    assert.equal(
      calls.find((call) => call.action === "verify").order_id,
      orderId,
    );
    await noPaymentControls(page);
    noPurchase(calls);
    await page.close();
  }
  // App Android: precios de Google Play, compra, créditos, anuncio recompensado e invitación.
  // Tienda y AdMob simulados; no hay cobros ni anuncios reales.
  {
    const credits = (plan = "free") => ({
      plan:
        plan === "plus"
          ? { id: "plus", name: "Plus", monthly_credits: 1000, max_active_goals: 15 }
          : { id: "free", name: "Gratis", monthly_credits: 0, max_active_goals: 3 },
      plans: catalog.map((p) => ({ ...p, monthly_credits: { free: 0, plus: 1000, pro: 2500 }[p.id] })),
      credits:
        plan === "plus"
          ? { balance: 1060, plan_available: 1000, plan_allowance: 1000, bonus: 60, cost_per_use: 20, renews_at: "2030-02-28T15:00:00Z" }
          : { balance: 60, plan_available: 0, plan_allowance: 0, bonus: 60, cost_per_use: 20 },
      ads: { reward: 10, today: 0, daily_limit: 5 },
      referral: { code: "ABCD2345", inviter_reward: 40, invitee_reward: 20, monthly_limit: 10, rewarded_this_month: 1, can_redeem: plan === "free", invited: false },
      play_subscription:
        plan === "plus"
          ? { product_id: "planifia_plus", plan_id: "plus", state: "SUBSCRIPTION_STATE_ACTIVE", expiry_time: "2030-02-28T15:00:00Z", auto_renewing: true, active: true }
          : null,
      products: [
        { product_id: "planifia_plus", kind: "subscription", plan_id: "plus", credits: null },
        { product_id: "planifia_pro", kind: "subscription", plan_id: "pro", credits: null },
        { product_id: "creditos_100", kind: "credits", plan_id: null, credits: 100 },
        { product_id: "creditos_300", kind: "credits", plan_id: null, credits: 300 },
        { product_id: "creditos_1000", kind: "credits", plan_id: null, credits: 1000 },
      ],
      recent: [{ reason: "welcome", delta: 60, created_at: periodStart }],
    });
    const offer = (regular, intro) => [
      { basePlanId: "mensual", offerId: null, offerToken: "base", phases: [{ formattedPrice: regular, priceMicros: 1, recurrence: 1 }] },
      { basePlanId: "mensual", offerId: "primer-mes", offerToken: "intro", phases: [{ formattedPrice: intro, priceMicros: 0, recurrence: 2, cycles: 1 }, { formattedPrice: regular, priceMicros: 1, recurrence: 1 }] },
    ];
    const products = [
      { productId: "planifia_plus", type: "subs", offers: offer("$2.700", "$900") },
      { productId: "planifia_pro", type: "subs", offers: offer("$4.900", "$1.900") },
      { productId: "creditos_100", type: "inapp", oneTime: { formattedPrice: "$900" } },
      { productId: "creditos_300", type: "inapp", oneTime: { formattedPrice: "$2.400" } },
      { productId: "creditos_1000", type: "inapp", oneTime: { formattedPrice: "$6.900" } },
    ];
    const playHtml = (view, plan) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Planes en Google Play</title><div id="fixture" style="max-width:1220px;margin:auto;padding:28px 18px"></div><script type="module">
  import '/src/style.css';
  import {renderBilling,mountBilling} from '/src/billing.js';
  import {createPlayStore} from '/src/native-billing.js';
  const root=document.querySelector('#fixture'),user={id:"user-fixture"};
  let m=${JSON.stringify(credits(plan))};
  const plus=${JSON.stringify(credits("plus"))};
  window.playCalls=[];window.notes=[];window.adCalls=[];
  const native=async(command,args)=>{window.playCalls.push([command,args]);
    if(command==='get_products')return {available:true,products:${JSON.stringify(products)}};
    if(command==='purchase')return {status:'purchased',purchases:[{productId:args.productId,purchaseToken:'token-'+args.productId+'-0001',state:'purchased',acknowledged:false}]};
    if(command==='restore_purchases')return {available:true,purchases:[]};
    return {ok:true};};
  const store=createPlayStore({native,verify:async(list)=>{if(list[0].productId==='planifia_plus')m=plus;
    return {results:list.map((p)=>({kind:p.productId.startsWith('creditos')?'credits':'subscription',purchaseToken:p.purchaseToken,active:true,acknowledged:true,granted:true,credits:100,consumed:true})),state:m};}});
  const ads={ready:true,setEligible(){},rewarded:async(userId)=>{window.adCalls.push(userId);m={...m,ads:{...m.ads,today:1},credits:{...m.credits,balance:70,bonus:70}};return {shown:true,earned:true};}};
  root.innerHTML=renderBilling({view:${JSON.stringify(view)},user});
  mountBilling(root,{user,billing:async()=>(${JSON.stringify(initial())}),notify:(n)=>window.notes.push(n),
    monetization:{load:async()=>m,redeem:async(code)=>{window.redeemed=code;return {ok:true,invitee_reward:20};},store,ads,userId:user.id}});
</script></html>`;
    const playPage = async (view, plan = "free") => {
      const page = await browser.newPage({ viewport: { width: 1366, height: 1024 } });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/play-fixture", (route) =>
        route.fulfill({ contentType: "text/html", body: playHtml(view, plan) }),
      );
      await page.goto(`${origin}/play-fixture`);
      return page;
    };
    const notes = (page) => page.evaluate(() => window.notes.join("\n"));
    {
      const page = await playPage("plans");
      await page.locator("[data-play-paywall]").waitFor();
      assert.equal(await page.locator("[data-google-play-notice]").isHidden(), true);
      const plusCard = await page.locator('[data-plan-card="plus"]').innerText();
      assert.match(plusCard, /\$900\s*el primer mes/);
      assert.match(plusCard, /Luego \$2\.700 al mes/);
      assert.match(plusCard, /1\.000 créditos de IA cada mes/);
      assert.match(plusCard, /Sin anuncios/);
      assert.match(await page.locator('[data-plan-card="pro"]').innerText(), /\$1\.900\s*el primer mes/);
      assert.match(await page.locator(".billing-packs").innerText(), /300 créditos\s*\$2\.400/);
      assert.match(await page.locator("[data-credits]").innerText(), /60\s*créditos/);
      assert.match(await page.locator(".billing-legal").innerText(), /Términos de uso[\s\S]*Política de privacidad/);
      await capture(page, "google-play-paywall-desktop");
      await page.setViewportSize({ width: 390, height: 844 });
      await capture(page, "google-play-paywall-mobile");

      await page.locator('[data-play-buy="planifia_plus"]').click();
      await page.waitForFunction(() => window.notes.some((n) => /activo/.test(n)));
      const purchase = (await page.evaluate(() => window.playCalls)).find(([c]) => c === "purchase")[1];
      assert.equal(purchase.accountId, "user-fixture", "La compra se liga a la cuenta de Supabase");
      assert.equal(purchase.offerId, "primer-mes");
      assert.equal(purchase.basePlanId, "mensual");
      assert.equal(purchase.type, "subs");
      await page.locator('[data-plan-card="plus"] [data-play-manage]').waitFor();
      assert.equal(await page.locator("[data-rewarded-ad]").count(), 0, "Plus no ve anuncios recompensados");
      await page.close();
    }
    {
      const page = await playPage("subscription");
      await page.locator("[data-credits]").waitFor();
      await page.locator("[data-rewarded-ad]").click();
      await page.waitForFunction(() => window.notes.some((n) => /\+10 créditos/.test(n)), null, { timeout: 15000 });
      assert.deepEqual(await page.evaluate(() => window.adCalls), ["user-fixture"]);
      assert.match(await page.locator("[data-credits]").innerText(), /70\s*créditos/);
      await page.locator("[data-redeem-form] input").fill("abcd2345");
      await page.locator("[data-redeem-form] button").click();
      await page.waitForFunction(() => window.notes.some((n) => /Código aplicado/.test(n)));
      assert.equal(await page.evaluate(() => window.redeemed), "abcd2345");
      await page.setViewportSize({ width: 390, height: 844 });
      await capture(page, "credits-free-mobile");
      await page.close();
    }
    {
      const page = await playPage("subscription", "plus");
      await page.locator("[data-play-subscription]").waitFor();
      const text = await page.locator("[data-play-subscription]").innerText();
      assert.match(text, /Plus/);
      assert.match(text, /Próxima renovación/);
      assert.match(text, /Gestionar o cancelar en Google Play/);
      await page.locator("[data-play-subscription] [data-play-manage]").click();
      await page.waitForFunction(() => window.playCalls.some(([c]) => c === "manage_subscriptions"));
      await capture(page, "google-play-subscription-plus-desktop");
      await page.close();
    }
  }
  assert.deepEqual(
    errors,
    [],
    "Sin errores JavaScript en las vistas de planes",
  );
  console.log(
    `Billing UI: aviso Google Play, sin compras web, Gratis, plan/consumo/historial, cancelación anterior, retornos y errores. ${captures.length} capturas escritorio/móvil; sin desbordamiento ni errores JS.`,
  );
} finally {
  await browser?.close();
  server.kill();
}
