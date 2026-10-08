import "./billing.css";
import { describeSubscription } from "./native-billing.js";
import { LEGAL } from "./monetization-config.js";

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
  new Intl.NumberFormat("es-CL", {
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
    : new Intl.DateTimeFormat("es-CL", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "America/Santiago",
      }).format(parsed);
};
const resetLabel = (value) => {
  const parsed = new Date(value);
  return !value || Number.isNaN(parsed.valueOf())
    ? "inicio del próximo mes"
    : new Intl.DateTimeFormat("es-CL", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Santiago",
      }).format(parsed);
};

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
    <div><p class="eyebrow">PLANIFIA EN ANDROID</p><h2 id="google-play-title">Las suscripciones se contratan desde la app de Google Play</h2>
    <p>Los pagos de Plus y Pro se realizan en la app de PlanifIA distribuida en Google Play. Usa la misma cuenta de PlanifIA para acceder a tu plan en el PC.</p>
    <p class="billing-app-availability">La app para Google Play está en preparación. Aquí encontrarás el enlace cuando esté disponible.</p></div>
  </section>`;
}
export function renderBilling({
  view = "plans",
  user = null,
  escape = escapeText,
} = {}) {
  return `<section class="billing-page" data-billing-root data-view="${view === "subscription" ? "subscription" : "plans"}">
    <div class="page-heading"><div><p class="eyebrow">UN PLAN PARA TU RITMO</p><h1>${view === "subscription" ? "Mi suscripción" : "Elige cuánto quieres avanzar"}</h1><p class="muted">${view === "subscription" ? "Consulta tu plan, tu período y el uso de tu cuenta." : "Empieza gratis. Conoce el espacio y la ayuda con IA que incluye cada plan."}</p></div>${user ? '<a class="button secondary" href="#today">Volver a mis metas</a>' : '<a class="button secondary" href="#login">Iniciar sesión</a>'}</div>
    ${appNotice()}
    <div class="billing-body" data-billing-body aria-live="polite"><div class="billing-loading panel" role="status"><span class="billing-spinner" aria-hidden="true"></span><p>${escape("Consultando los planes…")}</p></div></div>
  </section>`;
}

const paymentLabels = {
  approved: "Aprobado",
  paid: "Aprobado",
  declined: "Rechazado",
  rejected: "Rechazado",
  failed: "Rechazado",
  cancelled: "Cancelado",
  canceled: "Cancelado",
  abandoned: "Abandonado",
  expired: "Abandonado",
  pending: "En verificación",
  created: "Pendiente",
  initiated: "En verificación",
  unknown: "En verificación",
  verifying: "En verificación",
  uncertain: "En verificación",
  processing: "En verificación",
  enrolling: "En verificación",
};
const pendingStatuses = new Set([
  "pending",
  "created",
  "initiated",
  "unknown",
  "verifying",
  "uncertain",
  "processing",
  "enrolling",
]);
const approvedStatuses = new Set(["approved", "paid"]);
const limits = (plan) => ({
  goals: plan.max_active_goals,
  generations: plan.ai_generations,
  adjustments: plan.ai_adjustments,
});
const number = (value) =>
  new Intl.NumberFormat("es-CL").format(Number(value) || 0);
// Con créditos, cada plan muestra créditos mensuales en lugar de generaciones y ajustes.
function benefitRows(plan, escape) {
  const count = limits(plan);
  if (plan.monthly_credits == null)
    return `<li><strong>${escape(count.goals)}</strong> metas activas</li><li><strong>${escape(count.generations)}</strong> generaciones con IA al mes</li><li><strong>${escape(count.adjustments)}</strong> ${Number(count.adjustments) === 1 ? "ajuste" : "ajustes"} con IA al mes</li>`;
  return `<li><strong>${escape(count.goals)}</strong> metas activas</li>${
    Number(plan.monthly_credits) > 0
      ? `<li><strong>${number(plan.monthly_credits)}</strong> créditos de IA cada mes</li><li>Sin anuncios</li>`
      : "<li><strong>60</strong> créditos de bienvenida</li><li>Gana créditos con anuncios o invitando</li>"
  }`;
}

export function paymentResult(order) {
  const status = String(order?.status || "pending");
  if (approvedStatuses.has(status))
    return {
      kind: "success",
      title: "Pago aprobado",
      message: "Se confirmó el pago. Tu período contratado ya está disponible.",
      terminal: true,
    };
  if (["declined", "rejected", "failed"].includes(status))
    return {
      kind: "error",
      title: "El pago fue rechazado",
      message:
        "No se activó un período nuevo. Tus metas y tu progreso siguen guardados.",
      terminal: true,
    };
  if (["cancelled", "canceled"].includes(status))
    return {
      kind: "neutral",
      title: "Pago cancelado",
      message:
        "La operación quedó cancelada. Tus metas, acciones y progreso de Lumi siguen guardados.",
      terminal: true,
    };
  if (["abandoned", "expired"].includes(status))
    return {
      kind: "neutral",
      title: "El pago no se completó",
      message: "No se confirmó un nuevo período. Tus datos siguen disponibles.",
      terminal: true,
    };
  return {
    kind: "pending",
    title: "Estamos verificando el resultado",
    message:
      "Estamos consultando el estado confirmado del pago anterior. Espera la verificación.",
    terminal: false,
  };
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
      <div class="billing-plan-top"><h2>${escape(plan.name)}</h2>${current === plan.id && user ? '<span class="tag">Tu plan actual</span>' : plan.id === "plus" ? '<span class="tag">Más espacio para tus metas</span>' : ""}</div>
      <div class="billing-plan-pricing"><p class="billing-price-before billing-price-label">${paid ? "Precio de referencia" : "Empieza a tu ritmo"}</p>
      <p class="billing-price"><strong>${money(plan.price_clp)}</strong><span>${paid ? "al mes" : "siempre"}</span></p>
      <p class="billing-price-note">${paid ? "La contratación y el precio final se confirmarán en la app de Google Play." : "Tu punto de partida, sin un medio de pago."}</p></div>
      <ul class="billing-benefits">${benefitRows(plan, escape)}${(Array.isArray(plan.benefits) ? plan.benefits : []).map((benefit) => `<li>${escape(benefit)}</li>`).join("")}</ul>
      ${paid ? (current === plan.id && user ? '<a class="button secondary" href="#subscription">Consultar mi plan</a>' : `<button class="${plan.id === "plus" ? "" : "secondary"}" data-google-play-plan="${escape(plan.id)}">Cómo suscribirme</button>`) : `<button class="secondary" data-billing-plan="free">${user ? (current === "free" ? "Continuar con Gratis" : "Volver a mis metas") : "Empezar gratis"}</button>`}
    </article>`;
    })
    .join(
      "",
    )}</div><p class="billing-promo-rule fine">Los precios de Plus y Pro son de referencia, en pesos chilenos (CLP). Las ofertas y las condiciones de la suscripción se confirmarán en Google Play cuando la app esté disponible.</p></div>`;
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
    ["Metas activas", usage.active_goals || 0, count.goals],
    // Con créditos, el uso de IA se muestra en «Tus créditos».
    ...(credits
      ? []
      : [
          ["Generaciones con IA", usage.generations || 0, count.generations],
          ["Ajustes con IA", usage.adjustments || 0, count.adjustments],
        ]),
  ];
  return `<section class="billing-usage panel"><h2>Tu espacio este mes</h2><div class="billing-usage-grid">${rows.map(([label, used, limit]) => `<div><p>${label}</p><strong>${escape(used)} <span>/ ${escape(limit)}</span></strong><progress value="${Number(used)}" max="${Math.max(1, Number(limit))}" aria-label="${label}"></progress>${Number(used) >= Number(limit) ? "<small>Límite alcanzado</small>" : "<small>Disponible para tus próximos pasos</small>"}</div>`).join("")}</div><p class="fine">${credits ? "Cada uso de IA se paga con créditos." : `El uso de IA sigue meses calendario UTC y se reinicia el ${resetLabel(usage.reset_at)} (hora de Chile).`} Las metas activas se cuentan al momento de crear o reactivar una meta.</p>${rows.some(([, used, limit]) => Number(used) > Number(limit)) ? `<p class="notice">Tu información sigue disponible. Para crear nuevas metas, archiva las que ya terminaste.${credits ? "" : " La IA vuelve a estar disponible al reiniciar tu consumo."}</p>` : ""}</section>`;
}

const creditReasons = {
  welcome: "Bienvenida",
  ai_use: "Uso de IA",
  ai_refund: "Devolución: la IA no entregó la propuesta",
  rewarded_ad: "Anuncio visto",
  referral_inviter: "Invitaste a alguien",
  referral_invitee: "Llegaste con una invitación",
  purchase: "Compra de créditos",
  purchase_refund: "Reembolso de compra",
  admin: "Ajuste de soporte",
};
const referralText = (referral) =>
  `Te invito a PlanifIA, el planificador de metas con IA. Crea tu cuenta en https://planifia.cl/ o en la app de Android y usa mi código ${referral.code} para recibir ${referral.invitee_reward} créditos extra.`;

/** Créditos de IA: saldo, cómo ganar más (anuncios, invitaciones) y últimos movimientos. */
function creditsView(m, escape, { app = false, adsReady = false } = {}) {
  const c = m.credits || {},
    ads = m.ads || {},
    referral = m.referral || {};
  const paid = Number(c.plan_allowance) > 0;
  const adsLeft = Math.max(0, Number(ads.daily_limit) - Number(ads.today));
  const adOption = paid
    ? ""
    : `<div class="credit-way"><h3>Mira un anuncio</h3><p>+${escape(ads.reward)} créditos por anuncio completo. Hoy: ${escape(ads.today)} de ${escape(ads.daily_limit)}.</p>${
        app
          ? adsLeft > 0
            ? `<button data-rewarded-ad ${adsReady ? "" : "disabled"}>Ver anuncio (+${escape(ads.reward)} créditos)</button>${adsReady ? "" : '<small class="fine">Los anuncios se están preparando…</small>'}`
            : `<p class="fine">Volverás a tener anuncios disponibles mañana.</p>`
          : '<p class="fine">Disponible en la app de PlanifIA para Android.</p>'
      }</div>`;
  return `<section class="billing-credits panel" data-credits aria-labelledby="credits-title">
    <div class="credits-head"><div><p class="eyebrow">TUS CRÉDITOS DE IA</p><h2 id="credits-title"><strong data-credit-balance>${number(c.balance)}</strong> créditos</h2>
    <p class="muted">Cada uso de IA (crear o ajustar un plan) cuesta ${escape(c.cost_per_use)} créditos. Si la IA no entrega la propuesta, te los devolvemos.</p></div>
    <dl class="credit-split"><div><dt>De tu plan</dt><dd>${paid ? `${number(c.plan_available)} de ${number(c.plan_allowance)}<small>Se renuevan el ${date(c.renews_at)}; no se acumulan.</small>` : "—<small>Plus y Pro incluyen créditos cada mes.</small>"}</dd></div>
    <div><dt>Extra</dt><dd>${number(c.bonus)}<small>No vencen. Se usan después de los del plan.</small></dd></div></dl></div>
    <div class="credit-ways">${adOption}
    <div class="credit-way"><h3>Invita a alguien</h3><p>+${escape(referral.inviter_reward)} créditos para ti y +${escape(referral.invitee_reward)} para quien invites, cuando confirme su correo y use la IA por primera vez. Este mes: ${escape(referral.rewarded_this_month)} de ${escape(referral.monthly_limit)}.</p>
    <p class="referral-code">Tu código: <strong data-referral-code>${escape(referral.code)}</strong></p><button class="secondary" data-copy-referral>Copiar invitación</button></div>
    ${
      referral.can_redeem
        ? `<form class="credit-way" data-redeem-form><h3>¿Te invitaron?</h3><label>Código de invitación<input name="code" maxlength="8" autocomplete="off" autocapitalize="characters" pattern="[A-Za-z2-9]{8}" required></label><button class="secondary">Usar código</button></form>`
        : referral.invited
          ? `<div class="credit-way"><h3>Llegaste con una invitación</h3><p>${referral.invite_rewarded ? "Ya recibiste tus créditos de invitación." : "Recibirás tus créditos al usar la IA por primera vez."}</p></div>`
          : ""
    }</div>
    ${
      (m.recent || []).length
        ? `<details class="credit-history"><summary>Últimos movimientos</summary><ul>${m.recent.map((r) => `<li><span>${escape(creditReasons[r.reason] || r.reason)}<small>${date(r.created_at)}</small></span><strong class="${Number(r.delta) < 0 ? "minus" : "plus"}">${Number(r.delta) > 0 ? "+" : ""}${number(r.delta)}</strong></li>`).join("")}</ul></details>`
        : ""
    }
  </section>`;
}

/** Plan contratado en Google Play: estado, renovación y gestión en la tienda. */
function playSubscriptionView(m, escape) {
  const sub = m.play_subscription;
  const plan = (m.plans || []).find((p) => p.id === sub.plan_id);
  const states = {
    SUBSCRIPTION_STATE_ACTIVE: sub.auto_renewing ? "Activa · se renueva automáticamente" : "Activa",
    SUBSCRIPTION_STATE_CANCELED: "Cancelada · conservas el acceso hasta el vencimiento",
    SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "Problema con el pago · Google Play lo está reintentando",
    SUBSCRIPTION_STATE_ON_HOLD: "Suspendida por un problema con el pago",
    SUBSCRIPTION_STATE_PAUSED: "Pausada",
    SUBSCRIPTION_STATE_PENDING: "Pago pendiente de confirmación",
  };
  const label = sub.active ? states[sub.state] || "Activa" : states[sub.state] || "Vencida · acceso Gratis";
  return `<section class="billing-subscription panel" data-play-subscription><div class="billing-subscription-heading"><div><p class="eyebrow">TU PLAN EN GOOGLE PLAY</p><h2>${escape(plan?.name || sub.plan_id)}</h2><span class="billing-status">${escape(label)}</span></div><a href="#plans">Comparar planes ↗</a></div>
    <dl class="billing-details"><div><dt>${sub.active && sub.auto_renewing ? "Próxima renovación" : "Acceso hasta"}</dt><dd>${date(sub.expiry_time)}</dd></div><div><dt>Créditos de IA del plan</dt><dd>${number(plan?.monthly_credits)} al mes</dd></div></dl>
    ${["SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_ON_HOLD"].includes(sub.state) ? '<p class="notice">Actualiza tu medio de pago en Google Play para no perder los beneficios.</p>' : ""}
    <div class="billing-actions"><button class="secondary" data-play-manage="${escape(sub.product_id)}">Gestionar o cancelar en Google Play</button></div></section>`;
}

/** Pantalla de planes en la app: precios y ofertas tal como los entrega Google Play. */
function playPlans(state, m, catalog, escape) {
  const active = m.play_subscription?.active ? m.play_subscription : null;
  const plans = m.plans || state.plans;
  const subs = (m.products || []).filter((p) => p.kind === "subscription");
  const packs = (m.products || []).filter((p) => p.kind === "credits");
  const free = plans.find((p) => p.id === "free");
  const card = (plan, product) => {
    const info = product ? describeSubscription(catalog[product.product_id]) : null;
    const current = m.plan?.id === plan.id;
    const price = !product
      ? `<p class="billing-price"><strong>${money(0)}</strong><span>siempre</span></p><p class="billing-price-note">Con anuncios. Sin medio de pago.</p>`
      : info.available
        ? info.introPrice
          ? `<p class="billing-price"><strong>${escape(info.introPrice)}</strong><span>el primer mes</span></p><p class="billing-price-note">Luego ${escape(info.regularPrice)} al mes. Cancela cuando quieras.</p>`
          : `<p class="billing-price"><strong>${escape(info.regularPrice)}</strong><span>al mes</span></p><p class="billing-price-note">Se renueva cada mes. Cancela cuando quieras.</p>`
        : '<p class="billing-price-note">Google Play no informó el precio. Revisa tu conexión y vuelve a intentarlo.</p>';
    const action = !product
      ? current
        ? '<span class="tag">Tu plan actual</span>'
        : ""
      : active?.product_id === product.product_id
        ? `<button class="secondary" data-play-manage="${escape(product.product_id)}">Gestionar en Google Play</button>`
        : `<button class="${plan.id === "plus" ? "" : "secondary"}" data-play-buy="${escape(product.product_id)}" ${info.available ? "" : "disabled"}>${active ? `Cambiar a ${escape(plan.name)}` : `Suscribirme a ${escape(plan.name)}`}</button>`;
    return `<article class="billing-plan panel ${plan.id === "plus" ? "billing-plan-featured" : ""}" data-plan-card="${escape(plan.id)}"><div class="billing-plan-top"><h2>${escape(plan.name)}</h2>${current ? '<span class="tag">Tu plan actual</span>' : plan.id === "plus" ? '<span class="tag">Más espacio para tus metas</span>' : ""}</div>
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
        ? `<section class="billing-packs panel"><h2>Paquetes de créditos</h2><p class="muted">Pago único. Los créditos no vencen y se usan después de los de tu plan.</p><div class="billing-pack-grid">${packs
            .map((pack) => {
              const price = catalog[pack.product_id]?.oneTime?.formattedPrice;
              return `<button class="secondary" data-play-buy="${escape(pack.product_id)}" ${price ? "" : "disabled"}><strong>${number(pack.credits)} créditos</strong><span>${price ? escape(price) : "Precio no disponible"}</span></button>`;
            })
            .join("")}</div></section>`
        : ""
    }
    <section class="billing-legal"><div class="billing-actions"><button class="secondary" data-play-restore>Restaurar compras</button><button class="text-button" data-play-manage="${escape(active?.product_id || "")}">Gestionar o cancelar suscripción</button></div>
    <p class="fine">Los pagos los procesa Google Play con tu cuenta de Google. Las suscripciones se renuevan automáticamente cada mes hasta que las canceles en Google Play; al cancelar conservas el acceso hasta el final del período pagado. Precios en tu moneda local, impuestos incluidos.</p>
    <p class="fine"><button class="text-button" data-open-external="${LEGAL.terms}">Términos de uso</button> · <button class="text-button" data-open-external="${LEGAL.privacy}">Política de privacidad</button></p></section></div>`;
}

function subscriptionView(state, escape, m = null) {
  // Una suscripción de Google Play reemplaza el bloque de pagos anteriores (Transbank).
  if (m?.play_subscription && !state.subscription?.access_active)
    return `${playSubscriptionView(m, escape)}${usageView(state, escape, m)}${historyView(state, escape)}`;
  const subscription = state.subscription || {};
  const effective =
    typeof state.effective_plan === "object"
      ? state.effective_plan
      : state.plans.find((p) => p.id === state.effective_plan);
  const contracted = state.plans.find((p) => p.id === subscription.plan_id);
  const hasPeriod = contracted?.price_clp > 0 && subscription.period_end;
  const access = subscription.access_active === true;
  const legacyRenews =
    subscription.channel === "oneclick" && subscription.auto_renew === true;
  const renewalProblem =
    subscription.effective_status === "past_due" ||
    subscription.status === "past_due";
  const currentPayment = (state.payments || []).find(
    (p) =>
      approvedStatuses.has(p.status) &&
      p.period_start === subscription.period_start &&
      p.period_end === subscription.period_end,
  );
  const status = renewalProblem
    ? "Renovación pendiente"
    : hasPeriod && !access
      ? "Período vencido · acceso Gratis"
      : access
        ? legacyRenews
          ? "Activo · renovación anterior autorizada"
          : "Activo · sin cobros automáticos"
        : "Gratis";
  return `<section class="billing-subscription panel"><div class="billing-subscription-heading"><div><p class="eyebrow">TU PLAN ACTUAL</p><h2>${escape(effective?.name || "Gratis")}</h2><span class="billing-status">${status}</span></div><a href="#plans">Comparar planes ↗</a></div>
    ${
      hasPeriod
        ? `<dl class="billing-details"><div><dt>${access ? "Período contratado" : "Último período contratado"}</dt><dd>${date(subscription.period_start)} — ${date(subscription.period_end)}</dd></div><div><dt>Precio del período contratado</dt><dd>${currentPayment ? `${money(currentPayment.amount)} CLP` : "Consulta el pago en tu historial"}</dd></div><div><dt>Vencimiento del acceso pagado</dt><dd>${date(subscription.paid_until || subscription.period_end)}</dd></div>${legacyRenews ? `<div><dt>${subscription.next_retry_at ? "Próximo intento autorizado anteriormente" : "Próximo cobro autorizado anteriormente"}</dt><dd>${resetLabel(subscription.next_retry_at || subscription.next_date || subscription.paid_until || subscription.period_end)} (hora de Chile)${subscription.next_amount != null ? ` · ${money(subscription.next_amount)} CLP` : ""}</dd></div>` : ""}</dl>
    ${renewalProblem ? `<p class="notice">La renovación anterior está pendiente de confirmación. Consulta tu historial.${legacyRenews && subscription.next_retry_at ? ` El próximo intento autorizado es el ${resetLabel(subscription.next_retry_at)} (hora de Chile).` : ""}${legacyRenews && subscription.renewal_grace_until ? ` Los reintentos terminan el ${resetLabel(subscription.renewal_grace_until)}.` : ""}</p>` : ""}
    ${legacyRenews ? '<p class="notice">Tu cuenta conserva una renovación automática autorizada anteriormente. Puedes cancelar sus futuros cobros aquí; tu período pagado se conserva.</p><div class="billing-actions"><button class="secondary" data-billing-action="cancel">Cancelar futuros cobros</button></div>' : `<p class="muted">${access ? "Conservas el acceso hasta el final del período pagado." : "Tu período pagado terminó. Tus datos siguen disponibles con los límites del plan Gratis."}</p>`}`
        : `<p>Tu cuenta no tiene cobros programados. Tus metas, hábitos y Lumi pueden seguir avanzando en el plan Gratis${m ? " con tus créditos" : ""}.</p><a class="button" href="#plans">Ver Plus y Pro</a>`
    }
  </section>${usageView(state, escape, m)}${historyView(state, escape)}`;
}
function historyView(state, escape) {
  const rows = state.payments || [];
  return `<section class="billing-history panel"><h2>Historial de pagos</h2>${rows.length ? '<p class="fine billing-table-help">Desliza la tabla para ver el estado y todos los datos del pago.</p>' : ""}${rows.length ? `<div class="billing-table-scroll"><table><caption class="sr-only">Tus pagos y períodos de suscripción</caption><thead><tr><th scope="col">Fecha y plan</th><th scope="col">Período</th><th scope="col">Monto</th><th scope="col">Estado</th></tr></thead><tbody>${rows.map((payment) => `<tr><td><strong>${escape(state.plans.find((p) => p.id === payment.plan_id)?.name || payment.plan_id)}</strong><small>${date(payment.created_at)}</small></td><td>${date(payment.period_start)}<small>al ${date(payment.period_end)}</small></td><td>${money(payment.amount)}${payment.promo_applied ? "<small>Promoción inicial</small>" : ""}</td><td><span class="billing-payment-status">${escape(paymentLabels[payment.status] || "En verificación")}</span>${pendingStatuses.has(payment.status) ? `<button class="text-button" data-verify-order="${escape(payment.id)}">Consultar resultado</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">Todavía no hay pagos registrados en tu cuenta.</p>'}</section>`;
}
function resultMarkup(order, escape, finalCheck = false) {
  const result = paymentResult(order);
  return `<section class="billing-result billing-result-${result.kind} panel" role="status"><span class="billing-result-symbol" aria-hidden="true">${result.kind === "success" ? "✓" : result.kind === "pending" ? "◷" : "○"}</span><div><h2>${result.title}</h2><p>${result.message}</p>${order?.amount != null ? `<p class="fine">${money(order.amount)} CLP · ${escape(paymentLabels[order.status] || "En verificación")}</p>` : ""}${!result.terminal && finalCheck ? '<p class="fine">La confirmación está tardando. Puedes volver a consultar.</p>' : ""}${!result.terminal ? '<button class="secondary" data-billing-action="verify-return">Volver a consultar</button>' : ""}</div></section>`;
}

export function mountBilling(
  root,
  {
    user = null,
    billing,
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
    busy = false,
    verifying = false,
    outcome = null,
    pollTimer = null,
    pollCount = 0;
  let verifyReference = /^[0-9a-f-]{36}$/i.test(params.get("order") || "")
    ? { order_id: params.get("order") }
    : null;
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
      ? "No pudimos conectar. Revisa Internet y vuelve a consultar."
      : error?.message || "No pudimos consultar tu suscripción.";
  };
  // La web sólo consulta pagos anteriores y permite retirar una autorización vigente.
  const call = async (action, payload = {}) => {
    if (!["state", "verify", "cancel"].includes(action))
      throw new Error(
        "Las suscripciones se contratan desde la app de Google Play.",
      );
    if (typeof billing !== "function")
      throw new Error(
        "La consulta de suscripciones todavía no está configurada.",
      );
    return billing(action, payload);
  };
  const store = user ? monetization?.store || null : null;
  const ads = user ? monetization?.ads || null : null;
  let credits = null,
    catalog = {};
  const paint = () => {
    if (disposed || !state) return;
    const playMode = Boolean(store && credits);
    const notice = host.querySelector("[data-google-play-notice]");
    if (notice) notice.hidden = playMode;
    body.innerHTML = `${outcome ? resultMarkup(outcome, escapeText, pollCount >= 5) : ""}${state.pending_order && !outcome ? `<section class="notice billing-pending"><strong>Hay un pago anterior pendiente de confirmación.</strong><p>Puedes consultar su resultado.</p><button class="secondary" data-verify-order="${escapeText(state.pending_order.id)}">Consultar pago pendiente</button></section>` : ""}${host.dataset.view === "subscription" && user ? subscriptionView(state, escapeText, credits) : playMode ? playPlans(state, credits, catalog, escapeText) : cards(state, user, escapeText)}${user && credits ? creditsView(credits, escapeText, { app: Boolean(store), adsReady: Boolean(ads?.ready) }) : ""}<div data-billing-review></div>`;
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
        products.filter((p) => p.kind === "credits").map((p) => p.product_id),
      )
      .catch(() => null);
    if (result?.available)
      for (const product of result.products || []) catalog[product.productId] = product;
  };
  const refresh = async () => {
    const [next] = await Promise.all([
      user ? call("state") : loadCatalog?.(),
      loadCredits(),
    ]);
    if (disposed) return;
    state = Array.isArray(next) ? { plans: next } : next;
    if (!state || !Array.isArray(state.plans) || !state.plans.length)
      throw new Error(
        "No pudimos consultar los planes. Vuelve a intentarlo en unos momentos.",
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
    const granted = results.find((r) => r.kind === "credits");
    if (granted) return `Listo: sumamos ${number(granted.credits)} créditos a tu cuenta.`;
    if (results.some((r) => r.kind === "subscription" && r.active))
      return `¡Listo! Tu plan ${credits?.plan?.name || ""} ya está activo y sin anuncios.`;
    return "Compra registrada. Estamos confirmándola con Google Play.";
  };
  const buy = async (productId) => {
    const product = (credits?.products || []).find((p) => p.product_id === productId);
    if (!store || !product) throw new Error("Este producto no está disponible.");
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
            "Tu suscripción actual está en otra cuenta de Google. Gestiónala desde Google Play antes de cambiar de plan.",
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
      notify("Tu pago quedó pendiente. Activaremos tu compra cuando Google Play la confirme.");
      return;
    }
    if (result.status === "error")
      throw new Error(
        result.code === 3
          ? "Google Play no está disponible en este dispositivo o cuenta."
          : "Google Play no pudo completar la compra. Inténtalo de nuevo.",
      );
    await reloadCredits();
    notify(purchaseMessage(result));
    if (credits?.plan?.id !== "free") ads?.setEligible(false);
  };
  const restore = async () => {
    const result = await store.restore();
    if (!result.available) throw new Error("Google Play no está disponible en este dispositivo.");
    const failed = (result.results || []).find((r) => r.error);
    await reloadCredits();
    if (failed) throw new Error(failed.error);
    notify(
      (result.results || []).length
        ? "Compras restauradas. Tu plan y tus créditos están al día."
        : "No encontramos compras vigentes en esta cuenta de Google.",
    );
    if (credits?.plan?.id !== "free") ads?.setEligible(false);
  };
  const watchAd = async () => {
    const before = Number(credits?.ads?.today) || 0;
    const result = await ads.rewarded(monetization.userId);
    if (!result?.shown)
      throw new Error(
        result?.reason === "not_loaded"
          ? "No hay anuncios disponibles en este momento. Inténtalo más tarde."
          : "No pudimos mostrar el anuncio.",
      );
    if (!result.earned) {
      notify("Mira el anuncio completo para ganar créditos.");
      return;
    }
    notify("Sumando tus créditos…");
    // AdMob confirma la recompensa al servidor (SSV) unos segundos después.
    for (let attempt = 0; attempt < 8 && !disposed; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 3 ? 1500 : 3000));
      await reloadCredits();
      if (Number(credits?.ads?.today) > before) {
        notify(`+${credits.ads.reward} créditos. ¡Gracias por mirar el anuncio!`);
        return;
      }
    }
    notify("AdMob está confirmando tu recompensa; tus créditos aparecerán en unos minutos.");
  };
  const copyReferral = async () => {
    const text = referralText(credits.referral);
    try {
      await navigator.clipboard.writeText(text);
      notify("Invitación copiada. Pégala en un mensaje para compartirla.");
    } catch {
      host.querySelector("[data-referral-code]")?.focus();
      notify(`Tu código es ${credits.referral.code}. Compártelo con quien quieras invitar.`);
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
        `Código aplicado. Recibirás ${result?.invitee_reward ?? 20} créditos cuando uses la IA por primera vez.`,
      );
    });
  };
  const verify = async (reference, automatic = false) => {
    if (disposed || verifying) return;
    verifyReference = reference || verifyReference;
    if (!verifyReference?.order_id) return;
    verifying = true;
    clearTimeout(pollTimer);
    try {
      const result = await call("verify", verifyReference);
      if (disposed) return;
      await refresh();
      if (disposed) return;
      outcome = result.order ||
        state.payments?.find((item) => item.id === verifyReference.order_id) ||
        state.pending_order || {
          id: verifyReference.order_id,
          status: "pending",
        };
      if (automatic) pollCount++;
      paint();
      if (!paymentResult(outcome).terminal && pollCount < 5)
        pollTimer = setTimeout(() => verify(verifyReference, true), 2500);
    } catch (error) {
      if (disposed) return;
      clearTimeout(pollTimer);
      pollCount = 5;
      outcome ||= { id: verifyReference.order_id, status: "pending" };
      if (state) paint();
      showError(error);
    } finally {
      verifying = false;
    }
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
      else window.open(url, "_blank", "noopener");
      return;
    }
    if (button.hasAttribute("data-copy-referral") && credits?.referral) {
      void copyReferral();
      return;
    }
    if (button.hasAttribute("data-play-buy") && store) {
      void operation(() => buy(button.dataset.playBuy));
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
    if (button.hasAttribute("data-verify-order")) {
      pollCount = 0;
      void operation(() => verify({ order_id: button.dataset.verifyOrder }));
    } else if (button.dataset.billingAction === "verify-return") {
      pollCount = 0;
      void operation(() => verify(verifyReference));
    } else if (button.dataset.billingAction === "retry")
      void operation(refresh);
    else if (
      button.dataset.billingAction === "cancel" &&
      state?.subscription?.channel === "oneclick" &&
      state.subscription.auto_renew
    ) {
      const target = host.querySelector("[data-billing-review]");
      target.innerHTML = `<section class="billing-review panel"><h2>Cancelar futuros cobros</h2><p>Conservas el acceso pagado hasta el ${date(state.subscription.paid_until || state.subscription.period_end)}. Cancelar la renovación no devuelve automáticamente pagos anteriores.</p><button data-billing-action="confirm-cancel">Confirmar cancelación de futuros cobros</button><button class="text-button" data-billing-action="dismiss-review">Conservar la renovación</button></section>`;
      target.scrollIntoView({ block: "center" });
    } else if (button.dataset.billingAction === "dismiss-review")
      host.querySelector("[data-billing-review]").innerHTML = "";
    else if (
      button.dataset.billingAction === "confirm-cancel" &&
      state?.subscription?.channel === "oneclick" &&
      state.subscription.auto_renew
    ) {
      void operation(async () => {
        await call("cancel");
        if (disposed) return;
        await refresh();
        if (!disposed)
          notify(
            "Los futuros cobros quedaron cancelados. Tu período pagado se conserva.",
          );
      });
    }
  };
  host.addEventListener("click", onClick);
  host.addEventListener("submit", onSubmit);
  void refresh()
    .then(async () => {
      if (disposed || !user) return;
      if (verifyReference) await verify(verifyReference, true);
      else if (["plus", "pro"].includes(params.get("plan"))) showAppNotice();
      else if (params.get("plan") === "free") location.hash = "today";
    })
    .catch((error) => {
      if (disposed) return;
      body.innerHTML =
        '<section class="panel"><h2>No pudimos consultar los planes</h2><p class="muted">Tus metas y tu progreso siguen guardados. Puedes volver a consultar en unos momentos.</p><button data-billing-action="retry">Volver a consultar</button></section>';
      showError(error);
    });
  return () => {
    disposed = true;
    clearTimeout(pollTimer);
    host.removeEventListener("click", onClick);
    host.removeEventListener("submit", onSubmit);
  };
}
