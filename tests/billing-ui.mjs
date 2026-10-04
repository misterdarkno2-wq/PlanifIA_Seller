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
const defaultQuote = (body, state) => {
  const plan = state.plans.find((p) => p.id === body.plan_id);
  return {
    quote: {
      plan_id: plan.id,
      amount_clp:
        body.for_change || !state.promotion_available
          ? plan.price_clp
          : plan.first_month_clp,
      promotion_applied: !body.for_change && state.promotion_available,
      regular_price_clp: plan.price_clp,
      period_start:
        state.subscription?.paid_until ||
        state.subscription?.period_end ||
        periodStart,
      period_end: state.subscription ? "2030-03-31T15:00:00Z" : periodEnd,
      channel: body.channel || "oneclick",
      next_amount_clp: plan.price_clp,
      next_date: state.subscription ? "2030-03-31T15:00:00Z" : periodEnd,
      recurring_consent_required: (body.channel || "oneclick") === "oneclick",
    },
    capabilities,
  };
};
const html = ({
  user = true,
  view = "subscription",
}) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba de suscripciones PlanifIA</title><div id="fixture" style="max-width:1220px;margin:auto;padding:28px 18px"></div><script type="module">
  import '/src/style.css';
  import {renderBilling,mountBilling,consumeBillingIntent,validatePaymentRedirect,paymentResult} from '/src/billing.js';
  const root=document.querySelector('#fixture'),user=${user ? '{id:"fixture-user"}' : "null"};
  root.innerHTML=renderBilling({view:${JSON.stringify(view)},user});
  const call=async(action,payload={})=>{const response=await fetch('/fixture-billing-api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;};
  window.fixtureNotifications=[];
  window.fixtureDispose=mountBilling(root,{user,billing:call,loadCatalog:()=>call('catalog'),onLogin:()=>{location.hash='login'},notify:(message)=>window.fixtureNotifications.push(message)});
  window.consumeFixtureIntent=consumeBillingIntent;
  window.validateFixtureRedirect=validatePaymentRedirect;
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
  if (clock)
    await page.clock.install(
      typeof clock === "string" ? { time: new Date(clock) } : {},
    );
  const calls = [];
  let current = structuredClone(state);
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
    } else if (body.action === "quote") result = defaultQuote(body, current);
    else if (body.action === "verify") result = verified;
    else if (body.action === "cancel") {
      current.subscription.auto_renew = false;
      current.subscription.cancel_at_period_end = true;
      result = current;
    } else if (body.action === "resume") {
      assert.equal(body.recurring_consent, true);
      current.subscription.auto_renew = true;
      current.subscription.cancel_at_period_end = false;
      result = current;
    } else if (body.action === "change_plan") {
      current.subscription.next_plan_id = body.plan_id;
      current.subscription.next_plan = catalog.find(
        (p) => p.id === body.plan_id,
      );
      current.subscription.next_amount =
        current.subscription.next_plan.price_clp;
      result = current;
    } else if (body.action === "checkout") {
      assert.equal(Object.hasOwn(body, "amount"), false);
      assert.equal(Object.hasOwn(body, "amount_clp"), false);
      const price = defaultQuote(body, current).quote.amount_clp;
      if (body.expected_amount_clp !== price) {
        await route.fulfill({
          status: 409,
          json: {
            error:
              "El precio cambió al terminar la oferta. Vuelve a revisar el resumen antes de pagar.",
          },
        });
        return;
      }
      result = {
        order_id: orderId,
        channel: body.channel,
        environment: "integration",
        redirect: {
          url: "https://webpay3gint.transbank.cl/webpayserver/init",
          field: body.channel === "oneclick" ? "TBK_TOKEN" : "token_ws",
          token: "fixture-only-token",
        },
      };
    } else throw new Error(`Acción de fixture no prevista: ${body.action}`);
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
    setVerified: (result) => (verified = result),
    setPromotion: (promotion, available) => {
      current.promotion = promotion;
      current.promotion_available = available;
    },
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
      else if (body.action === "quote") result = defaultQuote(body, initial());
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

  // Catálogo público: precio inicial, posterior, límites y solo beneficios existentes.
  {
    const { page, calls } = await fixture({ user: false, view: "plans" });
    assert.match(
      await page.locator('[data-plan-card="plus"]').innerText(),
      /Primer mes por \$990; luego \$2\.750 al mes/,
    );
    assert.match(
      await page.locator('[data-plan-card="pro"]').innerText(),
      /Primer mes por \$1\.990; luego \$4\.990 al mes/,
    );
    assert.match(
      await page.locator(".billing-environment").innerText(),
      /pagos de prueba/,
    );
    await page.locator("[data-billing-offer]").waitFor();
    assert.match(
      await page.locator("[data-billing-offer]").innerText(),
      /SOLO 7 DÍAS/,
    );
    assert.match(
      await page
        .locator('[data-plan-card="plus"] .billing-discount')
        .innerText(),
      /64\s*%/,
    );
    assert.match(
      await page
        .locator('[data-plan-card="pro"] .billing-discount')
        .innerText(),
      /60\s*%/,
    );
    assert.equal(
      await page
        .locator('[data-plan-card="plus"] .billing-regular-price del')
        .innerText(),
      "$2.750",
    );
    assert.equal(
      await page
        .locator('[data-plan-card="pro"] .billing-regular-price del')
        .innerText(),
      "$4.990",
    );
    assert.match(
      await page
        .locator('[data-plan-card="plus"] .billing-savings')
        .innerText(),
      /1\.760/,
    );
    assert.match(
      await page.locator('[data-plan-card="pro"] .billing-savings').innerText(),
      /3\.000/,
    );
    await capture(page, "billing-plans-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "billing-plans-mobile");
    await page
      .getByRole("button", { name: "Elegir Plus", exact: true })
      .click();
    assert.equal(new URL(page.url()).hash, "#login");
    assert.equal(
      await page.evaluate(() => window.consumeFixtureIntent()),
      "plus",
    );
    assert.equal(
      await page.evaluate(() => window.consumeFixtureIntent()),
      null,
    );
    assert.equal(
      calls.some((call) => call.action === "checkout"),
      false,
      "Elegir un plan público no crea un pago sin iniciar sesión",
    );
    await page.close();
  }

  // La promoción consumida no muestra una oferta personal que ya no se puede contratar.
  {
    const { page } = await fixture({ view: "plans", state: paid() });
    assert.equal(await page.locator("[data-billing-offer]").count(), 0);
    assert.equal(await page.locator(".billing-discount").count(), 0);
    assert.equal(await page.locator(".billing-regular-price del").count(), 0);
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
    await page.close();
  }

  // Los porcentajes y ahorros se derivan del catálogo editable, no del nombre del plan.
  {
    const state = initial();
    state.plans = structuredClone(catalog);
    state.plans[1].price_clp = 3000;
    state.plans[1].first_month_clp = 1500;
    const { page } = await fixture({ view: "plans", state });
    assert.match(
      await page
        .locator('[data-plan-card="plus"] .billing-discount')
        .innerText(),
      /50\s*%/,
    );
    assert.equal(
      await page
        .locator('[data-plan-card="plus"] .billing-regular-price del')
        .innerText(),
      "$3.000",
    );
    assert.match(
      await page
        .locator('[data-plan-card="plus"] .billing-savings')
        .innerText(),
      /1\.500/,
    );
    await page.close();
  }

  // Fechas futuras y vencidas del servidor invalidan la oferta incluso ante un flag desactualizado.
  for (const window of ["future", "closed"]) {
    const state = initial();
    state.promotion = {
      ...campaign,
      active: true,
      server_now:
        window === "future" ? "2030-01-30T15:00:00Z" : "2030-02-08T15:00:00Z",
    };
    const { page } = await fixture({
      user: false,
      view: "plans",
      state,
      clock: "2020-01-01T00:00:00Z",
    });
    assert.equal(await page.locator("[data-billing-offer]").count(), 0);
    assert.equal(await page.locator(".billing-discount").count(), 0);
    assert.equal(
      await page
        .locator('[data-plan-card="plus"] .billing-price strong')
        .innerText(),
      "$2.750",
    );
    if (window === "closed")
      assert.match(
        await page.locator(".billing-offer-closed").innerText(),
        /La oferta de bienvenida terminó/,
      );
    else assert.equal(await page.locator(".billing-offer-closed").count(), 0);
    await page.close();
  }

  // La cuenta atrás usa la hora del servidor y se actualiza al cerrar una campaña con la página abierta.
  {
    const state = initial();
    state.promotion = { ...campaign, ends_at: "2030-01-31T15:00:05Z" };
    const { page, calls, setPromotion } = await fixture({
      view: "plans",
      state,
      clock: "2020-01-01T00:00:00Z",
    });
    await page.locator("[data-billing-offer]").waitFor();
    assert.equal(
      Number(await page.locator("[data-offer-days]").innerText()),
      0,
    );
    assert.equal(
      Number(await page.locator("[data-offer-hours]").innerText()),
      0,
    );
    const remainingMinutes = Number(
      await page.locator("[data-offer-minutes]").innerText(),
    );
    assert.ok(
      remainingMinutes >= 0 && remainingMinutes <= 1,
      "Una campaña que cierra en cinco segundos muestra menos de un minuto restante, incluso con la fecha del dispositivo equivocada",
    );
    await page
      .getByRole("button", { name: "Elegir Plus", exact: true })
      .click();
    await page.locator('[data-billing-checkout="plus"]').waitFor();
    await page.locator('[name="recurring-consent"]').check();
    setPromotion(
      { ...state.promotion, server_now: "2030-01-31T15:00:16Z", active: false },
      false,
    );
    await page.clock.fastForward(16000);
    await page.locator(".billing-offer-closed").waitFor();
    assert.equal(await page.locator("[data-billing-offer]").count(), 0);
    assert.equal(await page.locator(".billing-discount").count(), 0);
    assert.equal(
      await page
        .locator('[data-plan-card="plus"] .billing-price strong')
        .innerText(),
      "$2.750",
    );
    assert.equal(
      await page.locator('[name="recurring-consent"]').isChecked(),
      true,
      "Cerrar la oferta no debe borrar la revisión ni el consentimiento sin terminar",
    );
    assert.match(await page.locator(".billing-review").innerText(), /\$990/);
    await page.getByRole("button", { name: /Inscribir y pagar/ }).click();
    await page.getByRole("alert").waitFor();
    assert.match(
      await page.getByRole("alert").innerText(),
      /precio cambió al terminar la oferta/,
    );
    assert.equal(
      calls.find((call) => call.action === "checkout").expected_amount_clp,
      990,
      "Una cotización caducada no autoriza el precio regular sin una revisión nueva",
    );
    assert.equal(new URL(page.url()).hostname, "127.0.0.1");
    await page.close();
  }

  // Quote del servidor + consentimiento explícito + formulario POST correcto.
  {
    const { page, calls } = await fixture({ view: "plans" });
    await page.getByRole("button", { name: "Elegir Pro", exact: true }).click();
    await page.locator("[data-billing-checkout]").waitFor();
    assert.match(await page.locator(".billing-review").innerText(), /\$1\.990/);
    assert.match(await page.locator(".billing-review").innerText(), /\$4\.990/);
    assert.equal(
      await page.locator('[name="recurring-consent"]').isChecked(),
      false,
    );
    await page.getByRole("button", { name: /Inscribir y pagar/ }).click();
    assert.equal(
      calls.filter((call) => call.action === "checkout").length,
      0,
      "Sin consentimiento no se contrata renovación automática",
    );
    await capture(page, "billing-checkout-oneclick-desktop");
    await page.locator('[name="recurring-consent"]').check();
    let providerPost;
    await page.route("https://webpay3gint.transbank.cl/**", async (route) => {
      providerPost = {
        method: route.request().method(),
        data: new URLSearchParams(route.request().postData()),
      };
      await route.fulfill({
        contentType: "text/html",
        body: "<h1>Formulario de prueba interceptado</h1>",
      });
    });
    await page.getByRole("button", { name: /Inscribir y pagar/ }).click();
    await page
      .getByRole("heading", { name: "Formulario de prueba interceptado" })
      .waitFor();
    assert.equal(providerPost.method, "POST");
    assert.equal(providerPost.data.get("TBK_TOKEN"), "fixture-only-token");
    const checkout = calls.find((call) => call.action === "checkout");
    assert.equal(checkout.recurring_consent, true);
    assert.equal(checkout.plan_id, "pro");
    assert.match(checkout.request_id, /^[0-9a-f-]{36}$/);
    await page.close();
  }

  // Webpay paga un mes y nunca promete cobros automáticos.
  {
    const { page } = await fixture({ view: "plans" });
    await page
      .getByRole("button", { name: "Elegir Plus", exact: true })
      .click();
    await page.locator("[data-billing-channel]").selectOption("webpay");
    await page.getByRole("button", { name: /Ir a Webpay Plus/ }).waitFor();
    assert.equal(await page.locator('[name="recurring-consent"]').count(), 0);
    assert.match(
      await page.locator(".billing-review").innerText(),
      /renovación manual/,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "billing-checkout-webpay-mobile");
    await page.close();
  }

  // Mi suscripción: cancelación al final del período y cambio al siguiente sin cobrar.
  {
    const { page, calls } = await fixture({ state: paid() });
    assert.match(
      await page.locator(".billing-subscription").innerText(),
      /\$990/,
    );
    assert.match(
      await page.locator(".billing-subscription").innerText(),
      /\$2\.750/,
    );
    await capture(page, "billing-subscription-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "billing-subscription-mobile");
    await page
      .getByRole("button", { name: "Cancelar futuros cobros", exact: true })
      .click();
    assert.match(
      await page.locator(".billing-review").innerText(),
      /no devuelve automáticamente/,
    );
    await page
      .getByRole("button", { name: "Confirmar cancelación de futuros cobros" })
      .click();
    await page
      .getByRole("button", { name: "Autorizar renovación automática" })
      .waitFor();
    assert.match(
      await page.locator(".billing-subscription").innerText(),
      /Conservas el acceso/,
    );
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      "Plus",
    );
    await page
      .getByRole("button", { name: "Autorizar renovación automática" })
      .click();
    assert.equal(
      await page.locator('[name="recurring-consent"]').isChecked(),
      false,
    );
    await page.locator('[name="recurring-consent"]').check();
    await page
      .getByRole("button", { name: "Autorizar próximos cobros" })
      .click();
    await page
      .getByRole("button", { name: "Cancelar futuros cobros", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Cambiar plan para el siguiente período" })
      .click();
    await page.getByRole("button", { name: "Elegir Pro", exact: true }).click();
    await page
      .getByRole("button", { name: "Aplicar en la próxima renovación" })
      .waitFor();
    assert.equal(
      calls.findLast((call) => call.action === "quote").for_change,
      true,
    );
    assert.match(await page.locator(".billing-review").innerText(), /\$4\.990/);
    await page
      .getByRole("button", { name: "Aplicar en la próxima renovación" })
      .click();
    await page.locator(".billing-subscription .notice").waitFor();
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      "Plus",
    );
    assert.equal(
      calls.some((call) => call.action === "checkout"),
      false,
      "Cambiar plan y cancelar no deben crear cargos",
    );
    assert.match(
      await page.locator(".billing-subscription .notice").innerText(),
      /Pro por \$4\.990/,
    );
    await page.close();
  }

  // Resultados exclusivamente confirmados por el servidor; se ignora status de la URL.
  for (const status of [
    "approved",
    "rejected",
    "cancelled",
    "abandoned",
    "unknown",
  ]) {
    const resultState = status === "approved" ? paid() : initial();
    const { page, calls } = await fixture({
      hash: `#subscription?order=${orderId}&status=approved`,
      state: resultState,
      verified: {
        order: { id: orderId, plan_id: "plus", amount: 990, status },
      },
    });
    await page.locator(".billing-result").waitFor();
    const expected = {
      approved: "Pago aprobado",
      rejected: "El pago fue rechazado",
      cancelled: "Pago cancelado",
      abandoned: "El pago no se completó",
      unknown: "Estamos verificando el resultado",
    }[status];
    assert.equal(
      await page.locator(".billing-result h2").innerText(),
      expected,
    );
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      status === "approved" ? "Plus" : "Gratis",
    );
    assert.equal(
      calls.some((call) => call.action === "checkout"),
      false,
    );
    if (status === "unknown") {
      await page.setViewportSize({ width: 390, height: 844 });
      await capture(page, "billing-pending-mobile");
      const prior = calls.filter((call) => call.action === "verify").length;
      await page.evaluate(() => window.fixtureDispose());
      await page.waitForTimeout(2800);
      assert.equal(
        calls.filter((call) => call.action === "verify").length,
        prior,
        "Desmontar limpia el temporizador de verificación",
      );
    }
    await page.close();
  }

  // La consulta automática tiene un límite, incluso si el estado sigue incierto.
  {
    const { page, calls } = await fixture({
      hash: `#subscription?order=${orderId}`,
      clock: true,
    });
    await page.locator(".billing-result").waitFor();
    for (let count = 1; count < 5; count++) {
      const received = page.waitForResponse(
        (response) =>
          response.url().endsWith("/fixture-billing-api") &&
          response.request().postDataJSON().action === "state",
      );
      await page.clock.fastForward(2600);
      await received;
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
      );
    }
    await page
      .getByText("La confirmación está tardando.", { exact: false })
      .waitFor();
    await page.clock.fastForward(30000);
    assert.equal(
      calls.filter((call) => call.action === "verify").length,
      5,
      "Se detiene después de cinco consultas automáticas",
    );
    await page.close();
  }

  // Una inscripción pendiente se puede recuperar sin el enlace de retorno.
  {
    const pending = initial();
    pending.pending_enrollment = {
      id: enrollmentId,
      status: "pending",
      purpose: "checkout",
    };
    const { page, calls } = await fixture({
      state: pending,
      verified: {
        enrollment: {
          id: enrollmentId,
          status: "pending",
          purpose: "checkout",
        },
      },
    });
    await page
      .getByRole("button", {
        name: "Consultar inscripción pendiente",
        exact: true,
      })
      .click();
    await page.locator(".billing-result").waitFor();
    assert.equal(
      calls.find((call) => call.action === "verify").enrollment_id,
      enrollmentId,
    );
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      "Gratis",
    );
    assert.equal(
      calls.some((call) => call.action === "checkout"),
      false,
    );
    await page.close();
  }

  // La inscripción de Oneclick nunca presenta un pago como aprobado.
  {
    const { page } = await fixture({
      hash: `#subscription?enrollment=${enrollmentId}`,
      verified: {
        enrollment: {
          id: enrollmentId,
          status: "enrolled",
          purpose: "update_card",
        },
      },
    });
    await page
      .getByRole("heading", { name: "Medio de pago inscrito" })
      .waitFor();
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      "Gratis",
    );
    assert.equal(
      await page
        .getByRole("heading", { name: "Pago aprobado", exact: true })
        .count(),
      0,
    );
    const rejected = await page.evaluate(() => {
      const invalid = [
        { url: "https://evil.example/pay", field: "token_ws", token: "fake" },
        {
          url: "http://webpay3gint.transbank.cl/pay",
          field: "token_ws",
          token: "fake",
        },
        {
          url: "https://webpay3g.transbank.cl/pay",
          field: "token_ws",
          token: "fake",
        },
        {
          url: "https://webpay3gint.transbank.cl/pay",
          field: "amount",
          token: "fake",
        },
      ];
      return invalid.map((redirect) => {
        try {
          window.validateFixtureRedirect(redirect, "integration");
          return false;
        } catch {
          return true;
        }
      });
    });
    assert.deepEqual(rejected, [true, true, true, true]);
    await page.close();
  }

  // Vencimiento y conservación de datos por encima del plan gratuito.
  {
    const expired = paid("webpay");
    expired.effective_plan = catalog[0];
    expired.subscription.access_active = false;
    expired.subscription.effective_status = "expired";
    expired.usage.active_goals = 10;
    const { page } = await fixture({ state: expired });
    assert.match(
      await page.locator(".billing-subscription").innerText(),
      /Período vencido · acceso Gratis/,
    );
    assert.match(
      await page.locator(".billing-usage").innerText(),
      /Tu información sigue disponible/,
    );
    assert.equal(await page.locator(".billing-history tbody tr").count(), 1);
    await page.close();
  }

  // Fallo de configuración: error claro y acción de volver a consultar.
  {
    const { page } = await fixture({ failState: true });
    await page
      .getByRole("button", { name: "Volver a consultar", exact: true })
      .waitFor();
    assert.match(
      await page.getByRole("alert").innerText(),
      /conexión está en preparación/,
    );
    await page.close();
  }

  // Montaje real de main.js: intención pública → Auth → resumen del servidor.
  {
    const { page, calls } = await mainFixture("#plans");
    await page
      .getByRole("button", { name: "Elegir Plus", exact: true })
      .click();
    await page.waitForURL(/#login$/);
    await loginMain(page);
    await page.waitForURL(/#subscription\?plan=plus$/);
    await page.locator('[data-billing-checkout="plus"]').waitFor();
    assert.match(await page.locator(".billing-review").innerText(), /\$990/);
    assert.match(await page.locator(".billing-review").innerText(), /\$2\.750/);
    await capture(page, "billing-main-checkout-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("link", { name: "Mi plan", exact: true }).click();
    await page.waitForURL(/#subscription$/);
    await page.locator(".billing-subscription").waitFor();
    await capture(page, "billing-main-subscription-mobile");
    assert.equal(
      calls.some((call) => call.action === "checkout"),
      false,
    );
    await page.close();
  }

  // Retorno con sesión caducada: el login conserva la referencia y verifica el propio pago.
  {
    const { page, calls } = await mainFixture(
      `#subscription?order=${orderId}&status=approved`,
    );
    await page
      .getByRole("link", { name: "Iniciar sesión", exact: true })
      .first()
      .click();
    await loginMain(page);
    await page.waitForURL(new RegExp(`#subscription\\?order=${orderId}$`));
    await page
      .getByRole("heading", { name: "El pago fue rechazado" })
      .waitFor();
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      "Gratis",
    );
    assert.equal(
      calls.find((call) => call.action === "verify").order_id,
      orderId,
    );
    assert.equal(
      calls.some((call) => call.action === "checkout"),
      false,
    );
    await page.close();
  }

  // Fechas de reintentos y fin de gracia proceden del servidor.
  {
    const state = paid();
    state.subscription.status = "past_due";
    state.subscription.effective_status = "expired";
    state.subscription.access_active = false;
    state.subscription.next_retry_at = "2030-03-01T15:00:00Z";
    state.subscription.renewal_grace_until = "2030-03-03T15:00:00Z";
    state.effective_plan = catalog[0];
    const { page } = await fixture({ state });
    assert.match(
      await page.locator(".billing-subscription").innerText(),
      /Renovación pendiente/,
    );
    assert.match(
      await page.locator(".billing-subscription .notice").innerText(),
      /próximo intento autorizado/,
    );
    assert.match(
      await page.locator(".billing-subscription .notice").innerText(),
      /Los reintentos terminan/,
    );
    await page.close();
  }
  assert.deepEqual(
    errors,
    [],
    "Las pantallas de suscripción no deben producir errores de JavaScript",
  );
  console.log(
    `Billing UI: catálogo, consentimiento, POST Transbank, Webpay manual, cancelación, cambios, 5 resultados, inscripción, vencimiento y errores correctos. ${captures.length} capturas desktop/móvil; sin errores JS ni desbordamiento.`,
  );
} finally {
  await browser?.close();
  server.kill();
}
