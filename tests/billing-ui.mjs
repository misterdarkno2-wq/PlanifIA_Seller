// Fixtures explícitas: no usa cuentas, credenciales ni cobros reales.
// La web no cobra: sólo lee los planes (plan_catalog) y el plan vigente (billing_state).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { LEGAL_VERSION } from "../src/legal.js";

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
const periodStart = "2030-01-31T15:00:00Z",
  periodEnd = "2030-02-28T15:00:00Z";
const orderId = "12000000-0000-4000-8000-000000000012";
const enrollmentId = "22000000-0000-4000-8000-000000000022";
const initial = () => ({
  plans: catalog,
  effective_plan: catalog[0],
  subscription: null,
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
});
// Restos de las pruebas de Transbank en integración: billing_state aún puede devolverlos.
const legacy = (channel = "oneclick") => ({
  ...initial(),
  effective_plan: catalog[1],
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
  pending_order: { id: orderId, status: "pending" },
  pending_enrollment: { id: enrollmentId, status: "pending" },
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
  import {renderBilling,mountBilling,consumeBillingIntent} from '/src/billing.js';
  const root=document.querySelector('#fixture'),user=${user ? '{id:"fixture-user"}' : "null"};
  root.innerHTML=renderBilling({view:${JSON.stringify(view)},user});
  const call=async(action)=>{const response=await fetch('/fixture-billing-api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;};
  window.fixtureNotifications=[];
  window.fixtureDispose=mountBilling(root,{user,loadState:()=>call('state'),loadCatalog:()=>call('catalog'),onLogin:()=>{location.hash='login'},notify:(message)=>window.fixtureNotifications.push(message)});
  window.consumeFixtureIntent=consumeBillingIntent;
</script></html>`;

let browser;
const errors = [];
const captures = [];
async function fixture({
  user = true,
  view = "subscription",
  hash = "",
  state = initial(),
  failState = false,
} = {}) {
  const page = await browser.newPage({ locale: "es-CL",
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
    // Como plan_catalog en Supabase: una lista de planes, sin capacidades ni campañas de pago.
    if (body.action === "catalog") result = current.plans;
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
  const path = `artifacts/qa/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  captures.push(path);
};

async function mainFixture(hash = "") {
  const page = await browser.newPage({ locale: "es-CL",
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
    calls.push(url.pathname);
    let result;
    if (url.pathname === "/auth/v1/token") result = session;
    else if (url.pathname === "/auth/v1/user") result = user;
    // La portada consulta si «Continuar con Google» está activo (aquí no).
    else if (url.pathname === "/auth/v1/settings") result = { external: { google: false } };
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
    else if (url.pathname === "/rest/v1/plan_catalog") {
      assert.equal(url.searchParams.get("enabled"), "eq.true");
      result = catalog;
    } else if (url.pathname === "/rest/v1/rpc/billing_state") {
      assert.equal(request.headers().authorization, `Bearer ${token}`);
      result = initial();
    } else if (url.pathname === "/rest/v1/legal_acceptances")
      result = [{ terms_version: LEGAL_VERSION.terms, privacy_version: LEGAL_VERSION.privacy, platform: "web" }];
    else if (url.pathname.startsWith("/rest/v1/")) result = [];
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
  await mkdir("artifacts/qa", { recursive: true });
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const readOnly = (calls) =>
    assert.deepEqual(
      calls.filter((call) => !["catalog", "state"].includes(call.action)),
      [],
      "La web sólo consulta planes y el plan vigente: no cobra, verifica ni cancela pagos",
    );
  const noPaymentControls = async (page) => {
    assert.equal(
      await page
        .locator(
          '[data-billing-checkout], [data-billing-channel], [data-billing-consent-action], [data-confirm-change], [data-verify-order], [data-billing-action="renew"], [data-billing-action="resume"], [data-billing-action="update-card"], [data-billing-action="cancel"], [data-billing-action="verify-return"], .billing-history, .billing-result, .billing-pending',
        )
        .count(),
      0,
    );
    assert.doesNotMatch(
      await page.locator("[data-billing-root]").innerText(),
      /Webpay|Oneclick|Transbank|pagos de prueba|Inscribir y pagar|Historial de pagos|Cancelar futuros cobros|pago anterior|Visa|6623/i,
    );
    assert.equal(
      await page.locator('a[href*="play.google.com/store/apps"]').count(),
      0,
      "No inventar un enlace para una app aún no publicada",
    );
    await noOverflow(page);
  };

  // Planes públicos: precios de referencia y el aviso de Google Play; contratar lleva al aviso.
  {
    const { page, calls } = await fixture({ user: false, view: "plans" });
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
      "La antigua campaña de Transbank no se anuncia como una oferta",
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
    assert.deepEqual(calls, [{ action: "catalog" }]);
    await capture(page, "google-play-plans-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await noPaymentControls(page);
    await capture(page, "google-play-plans-mobile");
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
    readOnly(calls);
    await page.close();
  }
  {
    const { page, calls } = await fixture({ view: "plans" });
    await page
      .getByRole("button", { name: "Continuar con Gratis", exact: true })
      .click();
    assert.equal(new URL(page.url()).hash, "#today");
    readOnly(calls);
    await page.close();
  }

  // Enlaces guardados, retornos antiguos de pago y botones antiguos inyectados no hacen nada.
  for (const hash of [
    "#subscription?plan=plus",
    "#subscription?plan=pro",
    `#subscription?order=${orderId}&status=approved`,
    `#subscription?enrollment=${enrollmentId}`,
  ]) {
    const { page, calls } = await fixture({ hash, state: legacy() });
    if (hash.includes("plan="))
      await page.locator("#google-play-title:focus").waitFor();
    await page.evaluate((orderId) => {
      const root = document.querySelector("[data-billing-root]");
      for (const data of [
        { billingPlan: "plus" },
        { billingAction: "renew" },
        { billingAction: "resume" },
        { billingAction: "update-card" },
        { billingAction: "cancel" },
        { billingAction: "confirm-cancel" },
        { billingAction: "verify-return" },
        { verifyOrder: orderId },
        { confirmChange: "pro" },
      ]) {
        const button = document.createElement("button");
        Object.assign(button.dataset, data);
        root.append(button);
        button.click();
        button.remove();
      }
    }, orderId);
    await page.waitForTimeout(300);
    await noPaymentControls(page);
    assert.deepEqual(calls, [{ action: "state" }]);
    assert.equal(await page.locator("[data-billing-review]").innerText(), "");
    await page.close();
  }

  // Mi plan con datos de Transbank en integración: muestra el plan y el uso, nunca pagos ni cobros.
  for (const channel of ["webpay", "oneclick"]) {
    const { page, calls } = await fixture({ state: legacy(channel) });
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      "Plus",
    );
    assert.match(
      await page.locator(".billing-subscription").innerText(),
      /Activo · sin cobros en la web[\s\S]*Google Play/,
    );
    assert.match(
      await page.locator(".billing-usage").innerText(),
      /10\s*\/\s*15/,
    );
    await noPaymentControls(page);
    readOnly(calls);
    if (channel === "oneclick") {
      await capture(page, "google-play-subscription-legacy-desktop");
      await page.setViewportSize({ width: 390, height: 844 });
      await capture(page, "google-play-subscription-legacy-mobile");
    }
    await page.close();
  }
  {
    const { page, calls } = await fixture();
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      "Gratis",
    );
    assert.match(
      await page.locator(".billing-subscription").innerText(),
      /Tu cuenta no tiene cobros programados/,
    );
    await page.getByRole("link", { name: "Ver Plus y Pro", exact: true }).waitFor();
    await noPaymentControls(page);
    readOnly(calls);
    await capture(page, "google-play-subscription-free-desktop");
    await page.close();
  }

  // Vencimiento, protección de datos y errores de red.
  {
    const state = legacy("webpay");
    state.effective_plan = catalog[0];
    state.subscription.access_active = false;
    state.subscription.effective_status = "expired";
    const { page } = await fixture({ state });
    assert.equal(
      await page.locator(".billing-subscription h2").innerText(),
      "Gratis",
    );
    assert.match(
      await page.locator(".billing-usage").innerText(),
      /Tu información sigue disponible/,
    );
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
    readOnly(calls);
    await page.close();
  }

  // Montaje real de main.js: planes públicos, inicio de sesión, Mi plan y retorno antiguo.
  // Supabase se lee directo (plan_catalog y billing_state); la Edge Function billing ya no existe.
  const noEdgeBilling = (calls) =>
    assert.equal(
      calls.some((path) => path.startsWith("/functions/v1/billing")),
      false,
      "La web no llama a la Edge Function billing retirada",
    );
  {
    const { page, calls } = await mainFixture("#plans");
    await page.locator('[data-google-play-plan="plus"]').click();
    assert.equal(new URL(page.url()).hash, "#plans");
    assert.equal(calls.includes("/rest/v1/plan_catalog"), true);
    await page
      .getByRole("button", { name: "Empezar gratis", exact: true })
      .click();
    await page.waitForURL(/#login$/);
    await loginMain(page);
    await page.waitForURL(/#today$/);
    await page.getByRole("link", { name: "Mi plan", exact: true }).click();
    await page.locator(".billing-subscription").waitFor();
    assert.equal(calls.includes("/rest/v1/rpc/billing_state"), true);
    await noPaymentControls(page);
    await capture(page, "google-play-main-subscription-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "google-play-main-subscription-mobile");
    noEdgeBilling(calls);
    await page.close();
  }
  {
    // Un enlace de retorno de Transbank guardado ya no consulta ni anuncia el resultado de un pago.
    const { page, calls } = await mainFixture(
      `#subscription?order=${orderId}&status=approved`,
    );
    await page.locator(".billing-plans").waitFor();
    await page
      .getByRole("link", { name: "Iniciar sesión", exact: true })
      .first()
      .click();
    await loginMain(page);
    await page.waitForURL(/#today$/);
    assert.equal(await page.getByRole("heading", { name: /Pago|pago/ }).count(), 0);
    noEdgeBilling(calls);
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
        { product_id: "sin_anuncios", kind: "ad_free", plan_id: null, credits: null },
      ],
      ad_free: false,
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
      { productId: "sin_anuncios", type: "inapp", oneTime: { formattedPrice: "$2.900" } },
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
    if(list[0].productId==='sin_anuncios')m={...m,ad_free:true};
    return {results:list.map((p)=>({kind:p.productId.startsWith('creditos')?'credits':p.productId==='sin_anuncios'?'ad_free':'subscription',purchaseToken:p.purchaseToken,active:true,acknowledged:true,granted:true,credits:100,consumed:true})),state:m};}});
  const ads={ready:true,setEligible(){},setAdFree(v){window.adFree=v;},rewarded:async(userId)=>{window.adCalls.push(userId);m={...m,ads:{...m.ads,today:1},credits:{...m.credits,balance:70,bonus:70}};return {shown:true,earned:true};}};
  root.innerHTML=renderBilling({view:${JSON.stringify(view)},user});
  mountBilling(root,{user,loadState:async()=>(${JSON.stringify(initial())}),notify:(n)=>window.notes.push(n),
    monetization:{load:async()=>m,redeem:async(code)=>{window.redeemed=code;return {ok:true,invitee_reward:20};},store,ads,userId:user.id}});
</script></html>`;
    const playPage = async (view, plan = "free") => {
      const page = await browser.newPage({ locale: "es-CL", viewport: { width: 1366, height: 1024 } });
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

      assert.match(await page.locator("[data-ad-free-offer]").innerText(), /Quitar anuncios por \$2\.900/);
      assert.match(await page.locator('[data-plan-card="free"]').innerText(), /Video de anuncio al usar la IA/);
      await page.locator('[data-play-buy="planifia_plus"]').click();
      // Antes de abrir Google Play se muestra qué se compra, el precio, la renovación y cómo cancelar.
      const summary = page.locator("[data-purchase-summary]");
      await summary.waitFor();
      const summaryText = await summary.innerText();
      assert.match(summaryText, /Suscripción mensual Plus/);
      assert.match(summaryText, /\$900 el primer mes; luego \$2\.700 al mes/);
      assert.match(summaryText, /Se renueva automáticamente cada mes/);
      assert.match(summaryText, /Puedes cancelar cuando quieras/);
      assert.match(summaryText, /Términos de uso/);
      assert.equal(
        (await page.evaluate(() => window.playCalls)).some(([c]) => c === "purchase"),
        false,
        "Google Play no se abre antes de confirmar el resumen",
      );
      await capture(page, "google-play-purchase-summary-mobile");
      await page.locator('[data-play-confirm="planifia_plus"]').click();
      await page.waitForFunction(() => window.notes.some((n) => /activo/.test(n)));
      const purchase = (await page.evaluate(() => window.playCalls)).find(([c]) => c === "purchase")[1];
      assert.equal(purchase.accountId, "user-fixture", "La compra se liga a la cuenta de Supabase");
      assert.equal(purchase.offerId, "primer-mes");
      assert.equal(purchase.basePlanId, "mensual");
      assert.equal(purchase.type, "subs");
      await page.locator('[data-plan-card="plus"] [data-play-manage]').waitFor();
      assert.equal(await page.locator("[data-rewarded-ad]").count(), 0, "Plus no ve anuncios recompensados");
      assert.equal(await page.locator("[data-ad-free-offer]").count(), 0, "Plus ya no tiene anuncios que quitar");
      await page.close();
    }
    {
      const page = await playPage("plans");
      await page.locator("[data-ad-free-offer]").waitFor();
      await page.locator('[data-play-buy="sin_anuncios"]').click();
      assert.match(await page.locator("[data-purchase-summary]").innerText(), /Quitar anuncios[\s\S]*\$2\.900, pago único[\s\S]*sin renovación/);
      await page.locator('[data-play-confirm="sin_anuncios"]').click();
      await page.waitForFunction(() => window.notes.some((n) => /quitamos los videos/.test(n)));
      const purchase = (await page.evaluate(() => window.playCalls)).find(([c]) => c === "purchase")[1];
      assert.equal(purchase.type, "inapp", "Quitar anuncios es una compra única");
      assert.equal(purchase.productId, "sin_anuncios");
      await page.locator("[data-ad-free]").waitFor();
      assert.equal(await page.evaluate(() => window.adFree), true);
      assert.equal(await page.locator("[data-ad-free-offer]").count(), 0);
      await capture(page, "google-play-ad-free-desktop");
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
    `Billing UI: aviso Google Play, la web sólo consulta (sin cobros, verificación ni cancelación de Transbank), Gratis, plan/consumo, retornos antiguos y errores. ${captures.length} capturas escritorio/móvil; sin desbordamiento ni errores JS.`,
  );
} finally {
  await browser?.close();
  server.kill();
}
