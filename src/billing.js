import "./billing.css";
import { describeSubscription } from "./native-billing.js";
import { LEGAL } from "./monetization-config.js";
import { locale, tr } from "./i18n.js";
import { serverText } from "./server-messages.js";

const escapeText = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const intentKey = "planifia-billing-intent";
const validPlan = (value) => /^(free|plus|pro)$/.test(String(value));
const money = (amount) =>
  new Intl.NumberFormat(locale(), {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number.isSafeInteger(Number(amount)) ? Number(amount) : 0);
const date = (value) => {
  if (!value) return "—";
  const parsed = new Date(
    value.length === 10 ? `${value}T12:00:00-03:00` : value,
  );
  return Number.isNaN(parsed.valueOf())
    ? "—"
    : new Intl.DateTimeFormat(locale(), {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "America/Santiago",
      }).format(parsed);
};
const resetLabel = (value) => {
  const parsed = new Date(value);
  return !value || Number.isNaN(parsed.valueOf())
    ? tr("inicio del próximo mes", "start of next month")
    : new Intl.DateTimeFormat(locale(), {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Santiago",
      }).format(parsed);
};

// El nombre y los beneficios de cada plan vienen de la base (plan_catalog), en español.
const planName = (plan) => (plan?.id === "free" ? tr("Gratis", "Free") : plan?.name);
const BENEFITS_EN = {
  "Calendario y hábitos": "Calendar and habits",
  "Lumi y progreso de tus metas": "Lumi and your goals' progress",
};
const benefitText = (benefit) => tr(benefit, BENEFITS_EN[benefit] || benefit);

export function rememberBillingIntent(planId) {
  if (!validPlan(planId)) return;
  try {
    sessionStorage.setItem(intentKey, planId);
  } catch {}
}
export function consumeBillingIntent() {
  try {
    const planId = sessionStorage.getItem(intentKey);
    sessionStorage.removeItem(intentKey);
    return validPlan(planId) ? planId : null;
  } catch {
    return null;
  }
}

function appNotice() {
  return `<section class="billing-app-notice panel" data-google-play-notice aria-labelledby="google-play-title">
    <span class="billing-app-symbol" aria-hidden="true">▷</span>
    <div><p class="eyebrow">${tr("PLANIFIA EN ANDROID", "PLANIFIA ON ANDROID")}</p><h2 id="google-play-title">${tr("Las suscripciones se contratan desde la app de Google Play", "Subscriptions are purchased in the Google Play app")}</h2>
    <p>${tr("Los pagos de Plus y Pro se realizan en la app de PlanifIA distribuida en Google Play. Usa la misma cuenta de PlanifIA para acceder a tu plan en el PC.", "Plus and Pro payments are made in the PlanifIA app on Google Play. Use the same PlanifIA account to access your plan on your computer.")}</p>
    <p class="billing-app-availability">${tr("La app para Google Play está en preparación. Aquí encontrarás el enlace cuando esté disponible.", "The Google Play app is being prepared. You'll find the link here when it's available.")}</p></div>
  </section>`;
}
export function renderBilling({
  view = "plans",
  user = null,
  escape = escapeText,
} = {}) {
  return `<section class="billing-page" data-billing-root data-view="${view === "subscription" ? "subscription" : "plans"}">
    <div class="page-heading"><div><p class="eyebrow">${tr("UN PLAN PARA TU RITMO", "A PLAN FOR YOUR PACE")}</p><h1>${view === "subscription" ? tr("Mi suscripción", "My subscription") : tr("Elige cuánto quieres avanzar", "Choose how far you want to go")}</h1><p class="muted">${view === "subscription" ? tr("Consulta tu plan, tu período y el uso de tu cuenta.", "Check your plan, your period and your account's usage.") : tr("Empieza gratis. Conoce el espacio y la ayuda con IA que incluye cada plan.", "Start for free. See the space and AI help each plan includes.")}</p></div>${user ? `<a class="button secondary" href="#today">${tr("Volver a mis metas", "Back to my goals")}</a>` : `<a class="button secondary" href="#login">${tr("Iniciar sesión", "Sign in")}</a>`}</div>
    ${appNotice()}
    <div class="billing-body" data-billing-body aria-live="polite"><div class="billing-loading panel" role="status"><span class="billing-spinner" aria-hidden="true"></span><p>${escape(tr("Consultando los planes…", "Loading plans…"))}</p></div></div>
  </section>`;
}

const limits = (plan) => ({
  goals: plan.max_active_goals,
  generations: plan.ai_generations,
  adjustments: plan.ai_adjustments,
});
const number = (value) =>
  new Intl.NumberFormat(locale()).format(Number(value) || 0);
// Con créditos, cada plan muestra créditos mensuales en lugar de generaciones y ajustes.
function benefitRows(plan, escape) {
  const count = limits(plan);
  if (plan.monthly_credits == null)
    return `<li><strong>${escape(count.goals)}</strong> ${tr("metas activas", "active goals")}</li><li><strong>${escape(count.generations)}</strong> ${tr("generaciones con IA al mes", "AI generations per month")}</li><li><strong>${escape(count.adjustments)}</strong> ${Number(count.adjustments) === 1 ? tr("ajuste con IA al mes", "AI adjustment per month") : tr("ajustes con IA al mes", "AI adjustments per month")}</li>`;
  return `<li><strong>${escape(count.goals)}</strong> ${tr("metas activas", "active goals")}</li>${
    Number(plan.monthly_credits) > 0
      ? `<li><strong>${number(plan.monthly_credits)}</strong> ${tr("créditos de IA cada mes", "AI credits every month")}</li><li>${tr("Sin anuncios", "No ads")}</li>`
      : `<li><strong>60</strong> ${tr("créditos de bienvenida", "welcome credits")}</li><li>${tr("Gana créditos con anuncios o invitando", "Earn credits with ads or by inviting")}</li><li>${tr("Video de anuncio al usar la IA", "Ad video when using the AI")}</li>`
  }`;
}

function cards(state, user, escape) {
  const current =
    typeof state.effective_plan === "string"
      ? state.effective_plan
      : state.effective_plan?.id;
  return `<div data-billing-plan-options><div class="billing-plans">${state.plans
    .map((plan) => {
      const paid = plan.price_clp > 0;
      return `<article class="billing-plan panel ${plan.id === "plus" ? "billing-plan-featured" : ""}" data-plan-card="${escape(plan.id)}">
      <div class="billing-plan-top"><h2>${escape(planName(plan))}</h2>${current === plan.id && user ? `<span class="tag">${tr("Tu plan actual", "Your current plan")}</span>` : plan.id === "plus" ? `<span class="tag">${tr("Más espacio para tus metas", "More room for your goals")}</span>` : ""}</div>
      <div class="billing-plan-pricing"><p class="billing-price-before billing-price-label">${paid ? tr("Precio de referencia", "Reference price") : tr("Empieza a tu ritmo", "Start at your own pace")}</p>
      <p class="billing-price"><strong>${money(plan.price_clp)}</strong><span>${paid ? tr("al mes", "per month") : tr("siempre", "forever")}</span></p>
      <p class="billing-price-note">${paid ? tr("La contratación y el precio final se confirmarán en la app de Google Play.", "The subscription and final price will be confirmed in the Google Play app.") : tr("Tu punto de partida, sin un medio de pago.", "Your starting point, with no payment method.")}</p></div>
      <ul class="billing-benefits">${benefitRows(plan, escape)}${(Array.isArray(plan.benefits) ? plan.benefits : []).map((benefit) => `<li>${escape(benefitText(benefit))}</li>`).join("")}</ul>
      ${paid ? (current === plan.id && user ? `<a class="button secondary" href="#subscription">${tr("Consultar mi plan", "View my plan")}</a>` : `<button class="${plan.id === "plus" ? "" : "secondary"}" data-google-play-plan="${escape(plan.id)}">${tr("Cómo suscribirme", "How to subscribe")}</button>`) : `<button class="secondary" data-billing-plan="free">${user ? (current === "free" ? tr("Continuar con Gratis", "Continue with Free") : tr("Volver a mis metas", "Back to my goals")) : tr("Empezar gratis", "Start for free")}</button>`}
    </article>`;
    })
    .join(
      "",
    )}</div><p class="billing-promo-rule fine">${tr("Los precios de Plus y Pro son de referencia, en pesos chilenos (CLP). Las ofertas y las condiciones de la suscripción se confirmarán en Google Play cuando la app esté disponible.", "Plus and Pro prices are for reference, in Chilean pesos (CLP). Offers and subscription terms will be confirmed in Google Play when the app is available.")}</p></div>`;
}

function usageView(state, escape, credits = null) {
  const usage = state.usage || {};
  const plan =
    typeof state.effective_plan === "object"
      ? state.effective_plan
      : state.plans.find((p) => p.id === state.effective_plan);
  if (!plan) return "";
  const count = limits(plan);
  const rows = [
    [tr("Metas activas", "Active goals"), usage.active_goals || 0, count.goals],
    // Con créditos, el uso de IA se muestra en «Tus créditos».
    ...(credits
      ? []
      : [
          [tr("Generaciones con IA", "AI generations"), usage.generations || 0, count.generations],
          [tr("Ajustes con IA", "AI adjustments"), usage.adjustments || 0, count.adjustments],
        ]),
  ];
  return `<section class="billing-usage panel"><h2>${tr("Tu espacio este mes", "Your space this month")}</h2><div class="billing-usage-grid">${rows.map(([label, used, limit]) => `<div><p>${label}</p><strong>${escape(used)} <span>/ ${escape(limit)}</span></strong><progress value="${Number(used)}" max="${Math.max(1, Number(limit))}" aria-label="${label}"></progress>${Number(used) >= Number(limit) ? `<small>${tr("Límite alcanzado", "Limit reached")}</small>` : `<small>${tr("Disponible para tus próximos pasos", "Available for your next steps")}</small>`}</div>`).join("")}</div><p class="fine">${credits ? tr("Cada uso de IA se paga con créditos.", "Each AI use is paid with credits.") : tr(`El uso de IA sigue meses calendario UTC y se reinicia el ${resetLabel(usage.reset_at)} (hora de Chile).`, `AI usage follows UTC calendar months and resets on ${resetLabel(usage.reset_at)} (Chile time).`)} ${tr("Las metas activas se cuentan al momento de crear o reactivar una meta.", "Active goals are counted when you create or reactivate a goal.")}</p>${rows.some(([, used, limit]) => Number(used) > Number(limit)) ? `<p class="notice">${tr("Tu información sigue disponible. Para crear nuevas metas, archiva las que ya terminaste.", "Your information is still available. To create new goals, archive the ones you've finished.")}${credits ? "" : tr(" La IA vuelve a estar disponible al reiniciar tu consumo.", " The AI becomes available again when your usage resets.")}</p>` : ""}</section>`;
}

const creditReasons = () => ({
  welcome: tr("Bienvenida", "Welcome"),
  ai_use: tr("Uso de IA", "AI use"),
  ai_refund: tr("Devolución: la IA no entregó la propuesta", "Refund: the AI didn't deliver the proposal"),
  rewarded_ad: tr("Anuncio visto", "Ad watched"),
  referral_inviter: tr("Invitaste a alguien", "You invited someone"),
  referral_invitee: tr("Llegaste con una invitación", "You joined with an invitation"),
  purchase: tr("Compra de créditos", "Credit purchase"),
  purchase_refund: tr("Reembolso de compra", "Purchase refund"),
  admin: tr("Ajuste de soporte", "Support adjustment"),
  lumi_chat: tr("Mensaje a Lumi", "Message to Lumi"),
  lumi_chat_refund: tr("Devolución: Lumi no respondió", "Refund: Lumi didn't answer"),
});
const referralText = (referral) =>
  tr(
    `Te invito a PlanifIA, el planificador de metas con IA. Crea tu cuenta en https://planifia.cl/ o en la app de Android y usa mi código ${referral.code} para recibir ${referral.invitee_reward} créditos extra.`,
    `Join me on PlanifIA, the AI goal planner. Create your account at https://planifia.cl/ or in the Android app and use my code ${referral.code} to get ${referral.invitee_reward} extra credits.`,
  );

/** Créditos de IA: saldo, cómo ganar más (anuncios, invitaciones) y últimos movimientos. */
function creditsView(m, escape, { app = false, adsReady = false } = {}) {
  const c = m.credits || {},
    ads = m.ads || {},
    referral = m.referral || {};
  const paid = Number(c.plan_allowance) > 0;
  const adsLeft = Math.max(0, Number(ads.daily_limit) - Number(ads.today));
  const adOption = paid
    ? ""
    : `<div class="credit-way"><h3>${tr("Mira un anuncio", "Watch an ad")}</h3><p>${tr(`+${escape(ads.reward)} créditos por anuncio completo. Hoy: ${escape(ads.today)} de ${escape(ads.daily_limit)}.`, `+${escape(ads.reward)} credits per completed ad. Today: ${escape(ads.today)} of ${escape(ads.daily_limit)}.`)}</p>${
        app
          ? adsLeft > 0
            ? `<button data-rewarded-ad ${adsReady ? "" : "disabled"}>${tr(`Ver anuncio (+${escape(ads.reward)} créditos)`, `Watch ad (+${escape(ads.reward)} credits)`)}</button>${adsReady ? "" : `<small class="fine">${tr("Los anuncios se están preparando…", "Ads are getting ready…")}</small>`}`
            : `<p class="fine">${tr("Volverás a tener anuncios disponibles mañana.", "You'll have ads available again tomorrow.")}</p>`
          : `<p class="fine">${tr("Disponible en la app de PlanifIA para Android.", "Available in the PlanifIA app for Android.")}</p>`
      }</div>`;
  const reasons = creditReasons();
  return `<section class="billing-credits panel" data-credits aria-labelledby="credits-title">
    <div class="credits-head"><div><p class="eyebrow">${tr("TUS CRÉDITOS DE IA", "YOUR AI CREDITS")}</p><h2 id="credits-title"><strong data-credit-balance>${number(c.balance)}</strong> ${tr("créditos", "credits")}</h2>
    <p class="muted">${tr(`Cada uso de IA (crear o ajustar un plan) cuesta ${escape(c.cost_per_use)} créditos. Si la IA no entrega la propuesta, te los devolvemos.`, `Each AI use (creating or adjusting a plan) costs ${escape(c.cost_per_use)} credits. If the AI doesn't deliver the proposal, we give them back.`)}</p></div>
    <dl class="credit-split"><div><dt>${tr("De tu plan", "From your plan")}</dt><dd>${paid ? `${tr(`${number(c.plan_available)} de ${number(c.plan_allowance)}`, `${number(c.plan_available)} of ${number(c.plan_allowance)}`)}<small>${tr(`Se renuevan el ${date(c.renews_at)}; no se acumulan.`, `They renew on ${date(c.renews_at)}; they don't roll over.`)}</small>` : `—<small>${tr("Plus y Pro incluyen créditos cada mes.", "Plus and Pro include credits every month.")}</small>`}</dd></div>
    <div><dt>${tr("Extra", "Extra")}</dt><dd>${number(c.bonus)}<small>${tr("No vencen. Se usan después de los del plan.", "They don't expire. They're used after your plan's credits.")}</small></dd></div></dl></div>
    <div class="credit-ways">${adOption}
    <div class="credit-way"><h3>${tr("Invita a alguien", "Invite someone")}</h3><p>${tr(`+${escape(referral.inviter_reward)} créditos para ti y +${escape(referral.invitee_reward)} para quien invites, cuando confirme su correo y use la IA por primera vez. Este mes: ${escape(referral.rewarded_this_month)} de ${escape(referral.monthly_limit)}.`, `+${escape(referral.inviter_reward)} credits for you and +${escape(referral.invitee_reward)} for the person you invite, once they confirm their email and use the AI for the first time. This month: ${escape(referral.rewarded_this_month)} of ${escape(referral.monthly_limit)}.`)}</p>
    <p class="referral-code">${tr("Tu código", "Your code")}: <strong data-referral-code>${escape(referral.code)}</strong></p><button class="secondary" data-copy-referral>${tr("Copiar invitación", "Copy invitation")}</button></div>
    ${
      referral.can_redeem
        ? `<form class="credit-way" data-redeem-form><h3>${tr("¿Te invitaron?", "Were you invited?")}</h3><label>${tr("Código de invitación", "Invitation code")}<input name="code" maxlength="8" autocomplete="off" autocapitalize="characters" pattern="[A-Za-z2-9]{8}" required></label><button class="secondary">${tr("Usar código", "Use code")}</button></form>`
        : referral.invited
          ? `<div class="credit-way"><h3>${tr("Llegaste con una invitación", "You joined with an invitation")}</h3><p>${referral.invite_rewarded ? tr("Ya recibiste tus créditos de invitación.", "You already received your invitation credits.") : tr("Recibirás tus créditos al usar la IA por primera vez.", "You'll get your credits when you use the AI for the first time.")}</p></div>`
          : ""
    }</div>
    ${
      (m.recent || []).length
        ? `<details class="credit-history"><summary>${tr("Últimos movimientos", "Recent activity")}</summary><ul>${m.recent.map((r) => `<li><span>${escape(reasons[r.reason] || r.reason)}<small>${date(r.created_at)}</small></span><strong class="${Number(r.delta) < 0 ? "minus" : "plus"}">${Number(r.delta) > 0 ? "+" : ""}${number(r.delta)}</strong></li>`).join("")}</ul></details>`
        : ""
    }
  </section>`;
}

/** Plan contratado en Google Play: estado, renovación y gestión en la tienda. */
function playSubscriptionView(m, escape) {
  const sub = m.play_subscription;
  const plan = (m.plans || []).find((p) => p.id === sub.plan_id);
  const states = {
    SUBSCRIPTION_STATE_ACTIVE: sub.auto_renewing ? tr("Activa · se renueva automáticamente", "Active · renews automatically") : tr("Activa", "Active"),
    SUBSCRIPTION_STATE_CANCELED: tr("Cancelada · conservas el acceso hasta el vencimiento", "Cancelled · you keep access until it expires"),
    SUBSCRIPTION_STATE_IN_GRACE_PERIOD: tr("Problema con el pago · Google Play lo está reintentando", "Payment problem · Google Play is retrying"),
    SUBSCRIPTION_STATE_ON_HOLD: tr("Suspendida por un problema con el pago", "Suspended due to a payment problem"),
    SUBSCRIPTION_STATE_PAUSED: tr("Pausada", "Paused"),
    SUBSCRIPTION_STATE_PENDING: tr("Pago pendiente de confirmación", "Payment pending confirmation"),
  };
  const label = sub.active ? states[sub.state] || tr("Activa", "Active") : states[sub.state] || tr("Vencida · acceso Gratis", "Expired · Free access");
  return `<section class="billing-subscription panel" data-play-subscription><div class="billing-subscription-heading"><div><p class="eyebrow">${tr("TU PLAN EN GOOGLE PLAY", "YOUR PLAN ON GOOGLE PLAY")}</p><h2>${escape(planName(plan) || sub.plan_id)}</h2><span class="billing-status">${escape(label)}</span></div><a href="#plans">${tr("Comparar planes ↗", "Compare plans ↗")}</a></div>
    <dl class="billing-details"><div><dt>${sub.active && sub.auto_renewing ? tr("Próxima renovación", "Next renewal") : tr("Acceso hasta", "Access until")}</dt><dd>${date(sub.expiry_time)}</dd></div><div><dt>${tr("Créditos de IA del plan", "Plan AI credits")}</dt><dd>${number(plan?.monthly_credits)} ${tr("al mes", "per month")}</dd></div></dl>
    ${["SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_ON_HOLD"].includes(sub.state) ? `<p class="notice">${tr("Actualiza tu medio de pago en Google Play para no perder los beneficios.", "Update your payment method in Google Play so you don't lose the benefits.")}</p>` : ""}
    <div class="billing-actions"><button class="secondary" data-play-manage="${escape(sub.product_id)}">${tr("Gestionar o cancelar en Google Play", "Manage or cancel in Google Play")}</button></div></section>`;
}

/** Pantalla de planes en la app: precios y ofertas tal como los entrega Google Play. */
function playPlans(state, m, catalog, escape) {
  const active = m.play_subscription?.active ? m.play_subscription : null;
  const plans = m.plans || state.plans;
  const subs = (m.products || []).filter((p) => p.kind === "subscription");
  const packs = (m.products || []).filter((p) => p.kind === "credits");
  const noAds = (m.products || []).find((p) => p.kind === "ad_free");
  const free = plans.find((p) => p.id === "free");
  const card = (plan, product) => {
    const info = product ? describeSubscription(catalog[product.product_id]) : null;
    const current = m.plan?.id === plan.id;
    const price = !product
      ? `<p class="billing-price"><strong>${money(0)}</strong><span>${tr("siempre", "forever")}</span></p><p class="billing-price-note">${tr("Con anuncios en video al usar la IA. Sin medio de pago.", "With video ads when using the AI. No payment method.")}</p>`
      : info.available
        ? info.introPrice
          ? `<p class="billing-price"><strong>${escape(info.introPrice)}</strong><span>${tr("el primer mes", "the first month")}</span></p><p class="billing-price-note">${tr(`Luego ${escape(info.regularPrice)} al mes. Cancela cuando quieras.`, `Then ${escape(info.regularPrice)} per month. Cancel anytime.`)}</p>`
          : `<p class="billing-price"><strong>${escape(info.regularPrice)}</strong><span>${tr("al mes", "per month")}</span></p><p class="billing-price-note">${tr("Se renueva cada mes. Cancela cuando quieras.", "Renews every month. Cancel anytime.")}</p>`
        : `<p class="billing-price-note">${tr("Google Play no informó el precio. Revisa tu conexión y vuelve a intentarlo.", "Google Play didn't report the price. Check your connection and try again.")}</p>`;
    const action = !product
      ? current
        ? `<span class="tag">${tr("Tu plan actual", "Your current plan")}</span>`
        : ""
      : active?.product_id === product.product_id
        ? `<button class="secondary" data-play-manage="${escape(product.product_id)}">${tr("Gestionar en Google Play", "Manage in Google Play")}</button>`
        : `<button class="${plan.id === "plus" ? "" : "secondary"}" data-play-buy="${escape(product.product_id)}" ${info.available ? "" : "disabled"}>${active ? tr(`Cambiar a ${escape(planName(plan))}`, `Switch to ${escape(planName(plan))}`) : tr(`Suscribirme a ${escape(planName(plan))}`, `Subscribe to ${escape(planName(plan))}`)}</button>`;
    return `<article class="billing-plan panel ${plan.id === "plus" ? "billing-plan-featured" : ""}" data-plan-card="${escape(plan.id)}"><div class="billing-plan-top"><h2>${escape(planName(plan))}</h2>${current ? `<span class="tag">${tr("Tu plan actual", "Your current plan")}</span>` : plan.id === "plus" ? `<span class="tag">${tr("Más espacio para tus metas", "More room for your goals")}</span>` : ""}</div>
      <div class="billing-plan-pricing">${price}</div><ul class="billing-benefits">${benefitRows(plan, escape)}</ul>${current && !product ? "" : action}</article>`;
  };
  return `<div data-play-paywall><div class="billing-plans">${free ? card(free, null) : ""}${subs
    .map((product) => {
      const plan = plans.find((p) => p.id === product.plan_id);
      return plan ? card(plan, product) : "";
    })
    .join("")}</div>
    ${
      packs.length
        ? `<section class="billing-packs panel"><h2>${tr("Paquetes de créditos", "Credit packs")}</h2><p class="muted">${tr("Pago único. Los créditos no vencen y se usan después de los de tu plan.", "One-time payment. Credits don't expire and are used after your plan's credits.")}</p><div class="billing-pack-grid">${packs
            .map((pack) => {
              const price = catalog[pack.product_id]?.oneTime?.formattedPrice;
              return `<button class="secondary" data-play-buy="${escape(pack.product_id)}" ${price ? "" : "disabled"}><strong>${number(pack.credits)} ${tr("créditos", "credits")}</strong><span>${price ? escape(price) : tr("Precio no disponible", "Price not available")}</span></button>`;
            })
            .join("")}</div></section>`
        : ""
    }
    ${
      noAds && !active
        ? m.ad_free
          ? `<section class="billing-noads panel" data-ad-free><h2>${tr("Sin anuncios para siempre ✓", "No ads, for good ✓")}</h2><p class="muted">${tr('Ya compraste "Quitar anuncios": la IA no muestra videos en tu cuenta. El anuncio voluntario para ganar créditos sigue disponible si lo quieres.', 'You already bought "Remove ads": the AI shows no videos on your account. The optional ad to earn credits is still available if you want it.')}</p></section>`
          : (() => {
              const price = catalog[noAds.product_id]?.oneTime?.formattedPrice;
              return `<section class="billing-noads panel" data-ad-free-offer><h2>${tr("Quitar anuncios", "Remove ads")}</h2><p class="muted">${tr("Pago único, para siempre y sin suscripción. Quita los videos al usar la IA; puedes seguir viendo anuncios voluntarios para ganar créditos.", "One-time payment, forever and with no subscription. Removes the videos when using the AI; you can still watch optional ads to earn credits.")}</p><button data-play-buy="${escape(noAds.product_id)}" ${price ? "" : "disabled"}>${price ? tr(`Quitar anuncios por ${escape(price)}`, `Remove ads for ${escape(price)}`) : tr("Precio no disponible", "Price not available")}</button></section>`;
            })()
        : ""
    }
    <section class="billing-legal"><div class="billing-actions"><button class="secondary" data-play-restore>${tr("Restaurar compras", "Restore purchases")}</button><button class="text-button" data-play-manage="${escape(active?.product_id || "")}">${tr("Gestionar o cancelar suscripción", "Manage or cancel subscription")}</button></div>
    <p class="fine">${tr("Los pagos los procesa Google Play con tu cuenta de Google. Las suscripciones se renuevan automáticamente cada mes hasta que las canceles en Google Play; al cancelar conservas el acceso hasta el final del período pagado. Precios en tu moneda local, impuestos incluidos.", "Payments are processed by Google Play with your Google account. Subscriptions renew automatically every month until you cancel them in Google Play; when you cancel, you keep access until the end of the paid period. Prices in your local currency, taxes included.")}</p>
    <p class="fine"><button class="text-button" data-open-external="${LEGAL.terms}">${tr("Términos de uso", "Terms of Use")}</button> · <button class="text-button" data-open-external="${LEGAL.privacy}">${tr("Política de privacidad", "Privacy Policy")}</button></p></section></div>`;
}

/**
 * Resumen visible antes de abrir Google Play: qué se compra, precio, renovación automática, cómo
 * cancelar y enlace a los términos (Ley 19.496, art. 12 A, y políticas de suscripciones de Play).
 */
export function purchaseSummary(product, m, catalog, escape) {
  const plans = m?.plans || [];
  let name, price, points;
  if (product.kind === "subscription") {
    const plan = plans.find((p) => p.id === product.plan_id);
    const info = describeSubscription(catalog[product.product_id]);
    name = tr(`Suscripción mensual ${planName(plan) || ""}`, `${planName(plan) || ""} monthly subscription`).trim();
    price = info.introPrice
      ? tr(`${info.introPrice} el primer mes; luego ${info.regularPrice} al mes`, `${info.introPrice} the first month; then ${info.regularPrice} per month`)
      : tr(`${info.regularPrice} al mes`, `${info.regularPrice} per month`);
    points = [
      tr("Se renueva automáticamente cada mes y Google Play cobra a tu cuenta de Google hasta que la canceles.", "It renews automatically every month and Google Play charges your Google account until you cancel it."),
      tr(
        "Puedes cancelar cuando quieras en Google Play (Pagos y suscripciones) o con «Gestionar o cancelar suscripción». Conservas el acceso hasta el final del período pagado.",
        "You can cancel anytime in Google Play (Payments & subscriptions) or with “Manage or cancel subscription”. You keep access until the end of the paid period.",
      ),
      tr("Cancelar detiene los próximos cobros; no devuelve automáticamente lo ya pagado.", "Cancelling stops future charges; it doesn't automatically refund what you've already paid."),
    ];
  } else if (product.kind === "credits") {
    name = tr(`Paquete de ${number(product.credits)} créditos de IA`, `Pack of ${number(product.credits)} AI credits`);
    price = tr(
      `${catalog[product.product_id]?.oneTime?.formattedPrice || "Precio informado por Google Play"}, pago único`,
      `${catalog[product.product_id]?.oneTime?.formattedPrice || "Price reported by Google Play"}, one-time payment`,
    );
    points = [
      tr("Los créditos se suman a tu cuenta apenas Google Play confirma el pago, sin renovación.", "The credits are added to your account as soon as Google Play confirms the payment, with no renewal."),
      tr("No vencen mientras tu cuenta exista, no tienen valor en dinero y se pierden si eliminas la cuenta.", "They don't expire while your account exists, have no cash value and are lost if you delete your account."),
    ];
  } else {
    name = tr("Quitar anuncios", "Remove ads");
    price = tr(
      `${catalog[product.product_id]?.oneTime?.formattedPrice || "Precio informado por Google Play"}, pago único`,
      `${catalog[product.product_id]?.oneTime?.formattedPrice || "Price reported by Google Play"}, one-time payment`,
    );
    points = [
      tr("Quita los videos al usar la IA en esta cuenta de PlanifIA, para siempre y sin renovación.", "Removes the videos when using the AI on this PlanifIA account, forever and with no renewal."),
      tr("Los anuncios voluntarios para ganar créditos siguen disponibles si los quieres ver.", "Optional ads to earn credits are still available if you want to watch them."),
    ];
  }
  points.push(
    tr(
      "Tienes 10 días desde la compra para retractarte y recibir la devolución completa (Términos de uso, sección 10).",
      "You have 10 days from the purchase to withdraw and get a full refund (Terms of Use, section 10).",
    ),
  );
  return `<section class="billing-review panel purchase-summary" data-purchase-summary aria-labelledby="purchase-summary-title">
    <h2 id="purchase-summary-title" tabindex="-1">${tr("Antes de pagar", "Before you pay")}</h2>
    <dl><dt>${tr("Compras", "You're buying")}</dt><dd>${escape(name)}</dd><dt>${tr("Precio", "Price")}</dt><dd>${escape(price)}</dd></dl>
    <ul>${points.map((point) => `<li>${escape(point)}</li>`).join("")}</ul>
    <p class="fine">${tr("Precio en tu moneda local con impuestos incluidos, tal como lo informa Google Play. Al continuar aceptas los", "Price in your local currency with taxes included, as reported by Google Play. By continuing you accept the")} <button type="button" class="text-button" data-open-external="${LEGAL.terms}">${tr("Términos de uso", "Terms of Use")}</button>${tr("; tus datos se tratan según la", "; your data is handled according to the")} <button type="button" class="text-button" data-open-external="${LEGAL.privacy}">${tr("Política de privacidad", "Privacy Policy")}</button>.</p>
    <div class="billing-actions"><button data-play-confirm="${escape(product.product_id)}">${tr("Continuar a Google Play", "Continue to Google Play")}</button><button class="text-button" data-billing-action="dismiss-review">${tr("Cancelar", "Cancel")}</button></div>
  </section>`;
}

function subscriptionView(state, escape, m = null) {
  if (m?.play_subscription)
    return `${playSubscriptionView(m, escape)}${usageView(state, escape, m)}`;
  const effective =
    typeof state.effective_plan === "object"
      ? state.effective_plan
      : state.plans.find((p) => p.id === state.effective_plan);
  const paid = Boolean(effective) && effective.id !== "free";
  return `<section class="billing-subscription panel"><div class="billing-subscription-heading"><div><p class="eyebrow">${tr("TU PLAN ACTUAL", "YOUR CURRENT PLAN")}</p><h2>${escape(planName(effective) || tr("Gratis", "Free"))}</h2><span class="billing-status">${paid ? tr("Activo · sin cobros en la web", "Active · no charges on the web") : tr("Gratis", "Free")}</span></div><a href="#plans">${tr("Comparar planes ↗", "Compare plans ↗")}</a></div>
    ${
      paid
        ? `<p class="muted">${tr("La web no realiza cobros. Las suscripciones se contratan y gestionan en la app de Google Play.", "The website doesn't charge anything. Subscriptions are purchased and managed in the Google Play app.")}</p>`
        : `<p>${tr(`Tu cuenta no tiene cobros programados. Tus metas, hábitos y Lumi pueden seguir avanzando en el plan Gratis${m ? " con tus créditos" : ""}.`, `Your account has no scheduled charges. Your goals, habits and Lumi can keep moving forward on the Free plan${m ? " with your credits" : ""}.`)}</p><a class="button" href="#plans">${tr("Ver Plus y Pro", "See Plus and Pro")}</a>`
    }
  </section>${usageView(state, escape, m)}`;
}

export function mountBilling(
  root,
  {
    user = null,
    // Plan vigente y uso del mes (billing_state). La web no cobra: sólo consulta.
    loadState,
    loadCatalog,
    onLogin,
    notify = () => {},
    // { load, redeem, store, ads }: créditos, invitaciones y, en Android, Google Play y AdMob.
    monetization = null,
  } = {},
) {
  const host = root.matches?.("[data-billing-root]")
    ? root
    : root.querySelector("[data-billing-root]");
  if (!host) return () => {};
  const body = host.querySelector("[data-billing-body]");
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  let state,
    disposed = false,
    busy = false;
  const showAppNotice = () => {
    const notice = host.querySelector("[data-google-play-notice]");
    if (notice.hidden) {
      host.querySelector("[data-play-paywall]")?.scrollIntoView({ block: "start" });
      return;
    }
    notice.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "center",
    });
    notice.querySelector("h2").setAttribute("tabindex", "-1");
    notice.querySelector("h2").focus({ preventScroll: true });
  };
  const showError = (error) => {
    if (disposed) return;
    let alert = host.querySelector("[data-billing-error]");
    if (!alert) {
      alert = document.createElement("div");
      alert.className = "error billing-error";
      alert.dataset.billingError = "";
      alert.setAttribute("role", "alert");
      body.prepend(alert);
    }
    alert.textContent = /fetch|timeout|network/i.test(error?.message || "")
      ? tr("No pudimos conectar. Revisa Internet y vuelve a consultar.", "We couldn't connect. Check your Internet connection and try again.")
      : serverText(error?.message) || tr("No pudimos consultar tu suscripción.", "We couldn't load your subscription.");
  };
  const readState = async () => {
    if (typeof loadState !== "function")
      throw new Error(tr("La consulta de tu plan todavía no está configurada.", "Loading your plan isn't configured yet."));
    return loadState();
  };
  const store = user ? monetization?.store || null : null;
  const ads = user ? monetization?.ads || null : null;
  // Antes de comprar (por ejemplo, aceptar una versión nueva de los términos). false = no seguir.
  const beforePurchase = monetization?.beforePurchase || (async () => true);
  let credits = null,
    catalog = {};
  const paint = () => {
    if (disposed || !state) return;
    const playMode = Boolean(store && credits);
    const notice = host.querySelector("[data-google-play-notice]");
    if (notice) notice.hidden = playMode;
    body.innerHTML = `${host.dataset.view === "subscription" && user ? subscriptionView(state, escapeText, credits) : playMode ? playPlans(state, credits, catalog, escapeText) : cards(state, user, escapeText)}${user && credits ? creditsView(credits, escapeText, { app: Boolean(store), adsReady: Boolean(ads?.ready) }) : ""}<div data-billing-review></div>`;
  };
  // Créditos y precios de Play son complementarios: si fallan, la vista de planes sigue funcionando.
  const loadCredits = async () => {
    if (!user || typeof monetization?.load !== "function") return;
    try {
      credits = await monetization.load();
    } catch {
      credits = null;
      return;
    }
    if (!store || Object.keys(catalog).length) return;
    const products = credits?.products || [];
    const result = await store
      .products(
        products.filter((p) => p.kind === "subscription").map((p) => p.product_id),
        products.filter((p) => p.kind !== "subscription").map((p) => p.product_id),
      )
      .catch(() => null);
    if (result?.available)
      for (const product of result.products || []) catalog[product.productId] = product;
  };
  const refresh = async () => {
    const [next] = await Promise.all([
      user ? readState() : loadCatalog?.(),
      loadCredits(),
    ]);
    if (disposed) return;
    state = Array.isArray(next) ? { plans: next } : next;
    if (!state || !Array.isArray(state.plans) || !state.plans.length)
      throw new Error(
        tr("No pudimos consultar los planes. Vuelve a intentarlo en unos momentos.", "We couldn't load the plans. Try again in a few moments."),
      );
    paint();
  };
  const reloadCredits = async () => {
    await loadCredits();
    if (!disposed) paint();
  };
  const purchaseMessage = (result) => {
    const results = result.sync?.results || [];
    const failed = results.find((r) => r.error);
    if (failed) throw new Error(failed.error);
    if (results.some((r) => r.kind === "ad_free" && r.granted))
      return tr("Listo: quitamos los videos de anuncios de tu cuenta para siempre.", "Done: we removed ad videos from your account for good.");
    const granted = results.find((r) => r.kind === "credits");
    if (granted) return tr(`Listo: sumamos ${number(granted.credits)} créditos a tu cuenta.`, `Done: we added ${number(granted.credits)} credits to your account.`);
    if (results.some((r) => r.kind === "subscription" && r.active))
      return tr(`¡Listo! Tu plan ${planName(credits?.plan) || ""} ya está activo y sin anuncios.`, `Done! Your ${planName(credits?.plan) || ""} plan is now active and ad-free.`);
    return tr("Compra registrada. Estamos confirmándola con Google Play.", "Purchase registered. We're confirming it with Google Play.");
  };
  // Primero el resumen de la compra; Google Play se abre sólo con "Continuar a Google Play".
  const review = async (productId) => {
    const product = (credits?.products || []).find((p) => p.product_id === productId);
    if (!store || !product) throw new Error(tr("Este producto no está disponible.", "This product isn't available."));
    if (!(await beforePurchase()) || disposed) return;
    const target = host.querySelector("[data-billing-review]");
    target.innerHTML = purchaseSummary(product, credits, catalog, escapeText);
    target.scrollIntoView?.({ block: "center" });
    target.querySelector("h2")?.focus({ preventScroll: true });
  };
  const buy = async (productId) => {
    const product = (credits?.products || []).find((p) => p.product_id === productId);
    if (!store || !product) throw new Error(tr("Este producto no está disponible.", "This product isn't available."));
    const options = { accountId: monetization.userId };
    if (product.kind === "subscription") {
      const info = describeSubscription(catalog[productId]);
      Object.assign(options, { basePlanId: info.basePlanId, offerId: info.offerId });
      const active = credits.play_subscription?.active ? credits.play_subscription : null;
      if (active && active.product_id !== productId) {
        // Cambiar entre Plus y Pro reemplaza la suscripción vigente en Google Play.
        const owned = await store.restore().catch(() => null);
        const old = owned?.purchases?.find((p) => p.productId === active.product_id);
        if (!old)
          throw new Error(
            tr(
              "Tu suscripción actual está en otra cuenta de Google. Gestiónala desde Google Play antes de cambiar de plan.",
              "Your current subscription is on another Google account. Manage it from Google Play before changing plans.",
            ),
          );
        Object.assign(options, {
          oldPurchaseToken: old.purchaseToken,
          oldProductId: active.product_id,
          replacement: product.plan_id === "pro" ? "upgrade" : "downgrade",
        });
      }
    }
    const result = await store.purchase(product, options);
    if (result.status === "cancelled") return;
    if (result.status === "pending") {
      notify(tr("Tu pago quedó pendiente. Activaremos tu compra cuando Google Play la confirme.", "Your payment is pending. We'll activate your purchase when Google Play confirms it."));
      return;
    }
    if (result.status === "error")
      throw new Error(
        result.code === 3
          ? tr("Google Play no está disponible en este dispositivo o cuenta.", "Google Play isn't available on this device or account.")
          : tr("Google Play no pudo completar la compra. Inténtalo de nuevo.", "Google Play couldn't complete the purchase. Try again."),
      );
    await reloadCredits();
    notify(purchaseMessage(result));
    if (credits?.plan?.id !== "free") ads?.setEligible(false);
    if (credits?.ad_free) ads?.setAdFree?.(true);
  };
  const restore = async () => {
    const result = await store.restore();
    if (!result.available) throw new Error(tr("Google Play no está disponible en este dispositivo.", "Google Play isn't available on this device."));
    const failed = (result.results || []).find((r) => r.error);
    await reloadCredits();
    if (failed) throw new Error(failed.error);
    notify(
      (result.results || []).length
        ? tr("Compras restauradas. Tu plan y tus créditos están al día.", "Purchases restored. Your plan and credits are up to date.")
        : tr("No encontramos compras vigentes en esta cuenta de Google.", "We found no active purchases on this Google account."),
    );
    if (credits?.plan?.id !== "free") ads?.setEligible(false);
    if (credits?.ad_free) ads?.setAdFree?.(true);
  };
  const watchAd = async () => {
    const before = Number(credits?.ads?.today) || 0;
    const result = await ads.rewarded(monetization.userId);
    if (!result?.shown)
      throw new Error(
        result?.reason === "not_loaded"
          ? tr("No hay anuncios disponibles en este momento. Inténtalo más tarde.", "There are no ads available right now. Try again later.")
          : tr("No pudimos mostrar el anuncio.", "We couldn't show the ad."),
      );
    if (!result.earned) {
      notify(tr("Mira el anuncio completo para ganar créditos.", "Watch the whole ad to earn credits."));
      return;
    }
    notify(tr("Sumando tus créditos…", "Adding your credits…"));
    // AdMob confirma la recompensa al servidor (SSV) unos segundos después.
    for (let attempt = 0; attempt < 8 && !disposed; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 3 ? 1500 : 3000));
      await reloadCredits();
      if (Number(credits?.ads?.today) > before) {
        notify(tr(`+${credits.ads.reward} créditos. ¡Gracias por mirar el anuncio!`, `+${credits.ads.reward} credits. Thanks for watching the ad!`));
        return;
      }
    }
    notify(tr("AdMob está confirmando tu recompensa; tus créditos aparecerán en unos minutos.", "AdMob is confirming your reward; your credits will show up in a few minutes."));
  };
  const copyReferral = async () => {
    const text = referralText(credits.referral);
    try {
      await navigator.clipboard.writeText(text);
      notify(tr("Invitación copiada. Pégala en un mensaje para compartirla.", "Invitation copied. Paste it in a message to share it."));
    } catch {
      host.querySelector("[data-referral-code]")?.focus();
      notify(tr(`Tu código es ${credits.referral.code}. Compártelo con quien quieras invitar.`, `Your code is ${credits.referral.code}. Share it with whoever you want to invite.`));
    }
  };
  const onSubmit = (event) => {
    const form = event.target.closest("[data-redeem-form]");
    if (!form || disposed) return;
    event.preventDefault();
    void operation(async () => {
      const code = new FormData(form).get("code");
      const result = await monetization.redeem(String(code || ""));
      await reloadCredits();
      notify(
        tr(
          `Código aplicado. Recibirás ${result?.invitee_reward ?? 20} créditos cuando uses la IA por primera vez.`,
          `Code applied. You'll get ${result?.invitee_reward ?? 20} credits when you use the AI for the first time.`,
        ),
      );
    });
  };
  const operation = async (work) => {
    if (busy || disposed) return;
    busy = true;
    host.querySelector("[data-billing-error]")?.remove();
    const buttons = new Map(
      [...host.querySelectorAll("button")].map((button) => [
        button,
        button.disabled,
      ]),
    );
    buttons.forEach((_, button) => (button.disabled = true));
    try {
      await work();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
      buttons.forEach((wasDisabled, button) => (button.disabled = wasDisabled));
    }
  };
  const onClick = (event) => {
    const button = event.target.closest("button");
    if (!button || !host.contains(button) || disposed) return;
    if (button.hasAttribute("data-open-external")) {
      const url = button.dataset.openExternal;
      if (store) void store.openExternal(url).catch(showError);
      else window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (button.hasAttribute("data-copy-referral") && credits?.referral) {
      void copyReferral();
      return;
    }
    if (button.hasAttribute("data-play-buy") && store) {
      void review(button.dataset.playBuy).catch(showError);
      return;
    }
    if (button.hasAttribute("data-play-confirm") && store) {
      void operation(() => buy(button.dataset.playConfirm));
      return;
    }
    if (button.hasAttribute("data-play-restore") && store) {
      void operation(restore);
      return;
    }
    if (button.hasAttribute("data-play-manage") && store) {
      void operation(() => store.manage(button.dataset.playManage));
      return;
    }
    if (button.hasAttribute("data-rewarded-ad") && ads) {
      void operation(watchAd);
      return;
    }
    if (button.hasAttribute("data-google-play-plan")) {
      showAppNotice();
      return;
    }
    if (button.dataset.billingPlan) {
      if (button.dataset.billingPlan !== "free") {
        showAppNotice();
        return;
      }
      if (user) location.hash = "today";
      else {
        rememberBillingIntent("free");
        onLogin?.("free");
      }
      return;
    }
    if (button.dataset.billingAction === "retry") void operation(refresh);
    else if (button.dataset.billingAction === "dismiss-review")
      host.querySelector("[data-billing-review]").innerHTML = "";
  };
  host.addEventListener("click", onClick);
  host.addEventListener("submit", onSubmit);
  void refresh()
    .then(async () => {
      if (disposed || !user) return;
      if (["plus", "pro"].includes(params.get("plan"))) showAppNotice();
      else if (params.get("plan") === "free") location.hash = "today";
    })
    .catch((error) => {
      if (disposed) return;
      body.innerHTML =
        `<section class="panel"><h2>${tr("No pudimos consultar los planes", "We couldn't load the plans")}</h2><p class="muted">${tr("Tus metas y tu progreso siguen guardados. Puedes volver a consultar en unos momentos.", "Your goals and progress are still saved. You can try again in a few moments.")}</p><button data-billing-action="retry">${tr("Volver a consultar", "Try again")}</button></section>`;
      showError(error);
    });
  return () => {
    disposed = true;
    host.removeEventListener("click", onClick);
    host.removeEventListener("submit", onSubmit);
  };
}
