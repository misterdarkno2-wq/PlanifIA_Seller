import "./billing.css";
import { campaignStatus, discountFor, remainingTime } from "./billing-offer.js";

const escapeText = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
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

export function renderBilling({
  view = "plans",
  user = null,
  escape = escapeText,
} = {}) {
  return `<section class="billing-page" data-billing-root data-view="${view === "subscription" ? "subscription" : "plans"}">
    <div class="page-heading"><div><p class="eyebrow">UN PLAN PARA TU RITMO</p><h1>${view === "subscription" ? "Mi suscripción" : "Elige cuánto quieres avanzar"}</h1><p class="muted">${view === "subscription" ? "Tu período, tus próximos pagos y el uso de tu plan, en un solo lugar." : "Empieza gratis. Amplía el espacio para tus metas y tu ayuda con IA cuando lo necesites."}</p></div>${user ? '<a class="button secondary" href="#today">Volver a mis metas</a>' : '<a class="button secondary" href="#login">Iniciar sesión</a>'}</div>
    <div class="billing-body" data-billing-body aria-live="polite"><div class="billing-loading panel" role="status"><span class="billing-spinner" aria-hidden="true"></span><p>${escape("Consultando los planes y precios vigentes…")}</p></div></div>
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
const regularPrice = (plan) => plan.price_clp;
const promoPrice = (plan) => plan.first_month_clp;
const planId = (plan) => plan.id;
const limits = (plan) => ({
  goals: plan.max_active_goals,
  generations: plan.ai_generations,
  adjustments: plan.ai_adjustments,
});

export function paymentResult(order) {
  const status = String(order?.status || "pending");
  if (
    order?.type === "enrollment" &&
    ["completed", "enrolled"].includes(status)
  )
    return {
      kind: "neutral",
      title: "Medio de pago inscrito",
      message:
        "La inscripción quedó confirmada. Inscribir una tarjeta no equivale a un pago aprobado; el acceso depende del cobro confirmado de cada período.",
      terminal: true,
    };
  if (approvedStatuses.has(status))
    return {
      kind: "success",
      title: "Pago aprobado",
      message:
        "Transbank confirmó el pago. Tu período contratado ya está disponible.",
      terminal: true,
    };
  if (["declined", "rejected", "failed"].includes(status))
    return {
      kind: "error",
      title: "El pago fue rechazado",
      message:
        "No se activó un período nuevo. Puedes revisar el medio de pago y volver a intentarlo; un primer pago fallido conserva la promoción.",
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
      message:
        "No se confirmó un nuevo período. Puedes volver a elegir un plan cuando quieras.",
      terminal: true,
    };
  return {
    kind: "pending",
    title: "Estamos verificando el resultado",
    message:
      "Estamos consultando el estado confirmado del pago. Espera la verificación antes de iniciar otra operación.",
    terminal: false,
  };
}

export function validatePaymentRedirect(redirect, environment) {
  const allowedHost =
    environment === "production"
      ? "webpay3g.transbank.cl"
      : environment === "integration"
        ? "webpay3gint.transbank.cl"
        : null;
  let url;
  try {
    url = new URL(redirect?.url);
  } catch {}
  if (
    !allowedHost ||
    !url ||
    url.protocol !== "https:" ||
    url.hostname !== allowedHost ||
    url.port ||
    url.username ||
    url.password ||
    !["token_ws", "TBK_TOKEN"].includes(redirect?.field) ||
    typeof redirect?.token !== "string" ||
    !redirect.token ||
    redirect.token.length > 512
  ) {
    throw new Error(
      "No pudimos abrir el formulario de pago. Vuelve a consultar tu suscripción antes de intentarlo nuevamente.",
    );
  }
  return { url: url.href, field: redirect.field, token: redirect.token };
}

function environmentBadge(capabilities, escape) {
  if (capabilities?.environment === "integration")
    return '<div class="billing-environment" role="note"><span aria-hidden="true">◈</span><div><strong>Ambiente de integración · pagos de prueba</strong><p>Los pagos en este ambiente son simulados. No uses tarjetas reales.</p></div></div>';
  if (capabilities?.environment === "disabled")
    return '<div class="billing-environment" role="note"><span aria-hidden="true">◈</span><div><strong>Los pagos todavía no están disponibles</strong><p>Puedes consultar los planes. La contratación se habilitará cuando esté lista la conexión con Transbank.</p></div></div>';
  if (capabilities?.environment === "production")
    return '<p class="billing-provider muted">Pagos seguros con Transbank · montos en pesos chilenos.</p>';
  return `<p class="billing-provider muted">${escape("El precio y la modalidad de renovación se confirman antes de pagar.")}</p>`;
}

function offerBanner(state, escape, campaign) {
  const percent = Math.max(
    0,
    ...state.plans.map((plan) => discountFor(plan).percent),
  );
  if (!campaign.active || !percent) return "";
  const time = remainingTime(campaign.remaining);
  const deadline = new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santiago",
  }).format(new Date(campaign.ends));
  return `<section class="billing-offer" data-billing-offer aria-label="Oferta de bienvenida" aria-live="off">
    <div class="billing-offer-copy"><p class="billing-offer-eyebrow"><span aria-hidden="true">✦</span> OFERTA DE BIENVENIDA · SOLO ${escape(
      campaign.durationDays,
    )} DÍAS</p><h2>Tus metas merecen<br>un impulso.</h2><p>Estrena Plus o Pro con hasta <strong>${percent}% de descuento</strong> en tu primer mes.</p><span class="billing-offer-deadline">Hasta el ${escape(
      deadline,
    )} (hora de Chile).</span></div>
    <div class="billing-offer-highlight"><div class="billing-offer-stamp"><span>HASTA</span><strong>${percent}<small>%</small></strong><span>DE DESCUENTO</span></div><div class="billing-countdown"><p>La oferta termina en</p><div class="billing-countdown-units"><div><strong data-offer-days>${time.days}</strong><span>días</span></div><span aria-hidden="true">:</span><div><strong data-offer-hours>${time.hours}</strong><span>horas</span></div><span aria-hidden="true">:</span><div><strong data-offer-minutes>${time.minutes}</strong><span>min</span></div></div></div></div>
  </section>`;
}

function cards(state, user, escape, now) {
  const current =
    typeof state.effective_plan === "string"
      ? state.effective_plan
      : state.effective_plan?.id;
  const campaign = campaignStatus(state, now);
  return `<div data-billing-plan-options>${offerBanner(
    state,
    escape,
    campaign,
  )}${
    campaign.expired
      ? '<p class="notice billing-offer-closed">La oferta de bienvenida terminó. Estos son los precios vigentes.</p>'
      : ""
  }<div class="billing-plans">${state.plans
    .map((plan) => {
      const id = planId(plan),
        paid = regularPrice(plan) > 0;
      const discount = discountFor(plan);
      const available = campaign.active && discount.percent > 0;
      const used =
        state.promotion_available === false && state.promotion?.active === true;
      const count = limits(plan);
      return `<article class="billing-plan panel ${
        id === "plus" ? "billing-plan-featured" : ""
      } ${available ? "billing-plan-offer" : ""}" data-plan-card="${escape(
        id,
      )}">
        <div class="billing-plan-top"><h2>${escape(plan.name)}</h2>${
          current === id && user
            ? '<span class="tag">Tu plan actual</span>'
            : id === "plus"
              ? '<span class="tag">Más espacio para tus metas</span>'
              : ""
        }</div>
        <div class="billing-plan-pricing">${
          available
            ? `<div class="billing-price-before"><span class="billing-regular-price">Precio regular <del>${money(
                regularPrice(plan),
              )}</del></span><span class="billing-discount">−${discount.percent}%</span></div>`
            : `<p class="billing-price-before billing-price-label">${
                paid ? "Tu plan, mes a mes" : "Empieza a tu ritmo"
              }</p>`
        }
        <p class="billing-price"><strong>${money(
          available ? promoPrice(plan) : regularPrice(plan),
        )}</strong><span>${
          available ? "el primer mes" : paid ? "al mes" : "siempre"
        }</span></p>
        <p class="billing-price-note">${
          available
            ? `Primer mes por ${money(promoPrice(plan))}; luego ${money(
                regularPrice(plan),
              )} al mes`
            : paid
              ? `${money(
                  regularPrice(plan),
                )} al mes, renovación según la modalidad que elijas.`
              : "Tu punto de partida, sin un medio de pago."
        }</p>
        ${
          available
            ? `<p class="billing-savings">Ahorras <strong>${money(
                discount.savings,
              )}</strong> en tu primer mes</p>`
            : paid && used
              ? '<p class="fine">Tu promoción inicial ya se utilizó. Se aplica el precio regular.</p>'
              : ""
        }</div>
        <ul class="billing-benefits"><li><strong>${escape(
          count.goals,
        )}</strong> metas activas</li><li><strong>${escape(
          count.generations,
        )}</strong> generaciones con IA al mes</li><li><strong>${escape(
          count.adjustments,
        )}</strong> ${
          Number(count.adjustments) === 1 ? "ajuste" : "ajustes"
        } con IA al mes</li>${(Array.isArray(plan.benefits)
          ? plan.benefits
          : []
        )
          .map((benefit) => `<li>${escape(benefit)}</li>`)
          .join("")}</ul>
        <button class="${
          id === "plus" || (available && id === "pro") ? "" : "secondary"
        }" data-billing-plan="${escape(id)}">${
          current === id && user
            ? "Consultar mi plan"
            : paid
              ? `Elegir ${escape(plan.name)}`
              : user
                ? "Elegir Gratis"
                : "Empezar gratis"
        }</button>
      </article>`;
    })
    .join(
      "",
    )}</div><p class="billing-promo-rule fine">Descuento disponible al contratar durante la campaña, únicamente para el primer período pagado de tu cuenta, tanto en Plus como en Pro. Cancelar, volver a contratar o cambiar de plan no lo renueva. Precios en pesos chilenos (CLP).</p></div>`;
}

function usageView(state, escape) {
  const usage = state.usage || {},
    plan =
      typeof state.effective_plan === "object"
        ? state.effective_plan
        : state.plans.find((p) => p.id === state.effective_plan);
  if (!plan) return "";
  const count = limits(plan);
  const rows = [
    ["Metas activas", usage.active_goals || 0, count.goals],
    ["Generaciones con IA", usage.generations || 0, count.generations],
    ["Ajustes con IA", usage.adjustments || 0, count.adjustments],
  ];
  return `<section class="billing-usage panel"><h2>Tu espacio este mes</h2><div class="billing-usage-grid">${rows.map(([label, used, limit]) => `<div><p>${label}</p><strong>${escape(used)} <span>/ ${escape(limit)}</span></strong><progress value="${Number(used)}" max="${Math.max(1, Number(limit))}" aria-label="${label}"></progress>${Number(used) >= Number(limit) ? "<small>Límite alcanzado</small>" : "<small>Disponible para tus próximos pasos</small>"}</div>`).join("")}</div><p class="fine">El uso de IA sigue meses calendario UTC y se reinicia el ${resetLabel(usage.reset_at)} (hora de Chile). Las metas activas se cuentan al momento de crear o reactivar una meta.</p>${rows.some(([, used, limit]) => Number(used) > Number(limit)) ? '<p class="notice">Tu información sigue disponible. Para crear nuevas metas, archiva las que ya terminaste o elige un plan con más espacio. La IA vuelve a estar disponible al reiniciar tu consumo o ampliar el plan.</p>' : ""}</section>`;
}

function subscriptionView(state, escape) {
  const subscription = state.subscription || {};
  const effective =
    typeof state.effective_plan === "object"
      ? state.effective_plan
      : state.plans.find((p) => p.id === state.effective_plan);
  const contracted = state.plans.find((p) => p.id === subscription.plan_id);
  const hasPeriod = contracted?.price_clp > 0 && subscription.period_end;
  const access = subscription.access_active === true;
  const automatic = subscription.channel === "oneclick";
  const renews = automatic && subscription.auto_renew === true;
  const nextPlan =
    subscription.next_plan ||
    state.plans.find(
      (p) => p.id === (subscription.next_plan_id || subscription.plan_id),
    );
  const amount = subscription.next_amount;
  const paidUntil = subscription.paid_until || subscription.period_end;
  const nextDate =
    subscription.next_retry_at || subscription.next_date || paidUntil;
  const renewalProblem =
    subscription.effective_status === "past_due" ||
    subscription.status === "past_due";
  const renewalNotice = renewalProblem
    ? `<p class="notice">${renews && subscription.next_retry_at ? `La última renovación no fue aprobada. El próximo intento autorizado es el ${resetLabel(subscription.next_retry_at)} (hora de Chile).${subscription.renewal_grace_until ? ` Los reintentos terminan el ${resetLabel(subscription.renewal_grace_until)}.` : ""} Puedes cancelar los futuros cobros en cualquier momento.` : renews ? "La renovación está pendiente de confirmación. Consulta el resultado antes de iniciar otro pago; no se repetirá un cargo incierto a ciegas." : "La última renovación no fue aprobada y no hay nuevos cobros automáticos autorizados. Tus datos siguen disponibles; renueva manualmente o elige nuevamente un plan."} Revisa tu historial y el medio de pago.</p>`
    : "";
  const currentPayment = (state.payments || []).find(
    (p) =>
      approvedStatuses.has(p.status) &&
      p.period_start === subscription.period_start &&
      p.period_end === subscription.period_end,
  );
  const status =
    subscription.effective_status === "past_due" ||
    subscription.status === "past_due"
      ? "Renovación pendiente"
      : hasPeriod && !access
        ? "Período vencido · acceso Gratis"
        : access
          ? renews
            ? "Activo · renovación automática"
            : "Activo · sin cobros automáticos"
          : "Gratis";
  return `<section class="billing-subscription panel"><div class="billing-subscription-heading"><div><p class="eyebrow">TU PLAN ACTUAL</p><h2>${escape(effective?.name || "Gratis")}</h2><span class="billing-status">${status}</span></div><a href="#plans">Comparar planes ↗</a></div>${hasPeriod ? `<dl class="billing-details"><div><dt>${access ? "Período contratado" : "Último período contratado"}</dt><dd>${date(subscription.period_start)} — ${date(subscription.period_end)}</dd></div><div><dt>Precio del período contratado</dt><dd>${currentPayment ? `${money(currentPayment.amount)} CLP ${currentPayment.promo_applied ? '<span class="tag">Promoción inicial</span>' : ""}` : "Consulta el pago en tu historial"}</dd></div><div><dt>Modalidad</dt><dd>${automatic ? (renews ? "Oneclick · renovación automática autorizada" : "Oneclick · futuros cobros cancelados") : "Webpay Plus · renovación manual"}</dd></div><div><dt>${renews ? (subscription.next_retry_at ? "Próximo intento de renovación" : "Próximo cobro") : "Vencimiento del acceso pagado"}</dt><dd>${subscription.next_retry_at ? resetLabel(nextDate) + " (hora de Chile)" : date(nextDate)}</dd></div><div><dt>${renews ? "Monto del próximo cobro" : "Precio para renovar"}</dt><dd>${amount != null ? money(amount) + " CLP" : "Por confirmar antes de renovar"} ${nextPlan?.id === "free" ? "· cambio a Gratis" : ""}</dd></div></dl>${subscription.next_plan_id && subscription.next_plan_id !== contracted?.id ? `<p class="notice">En tu próxima renovación se aplicará ${escape(nextPlan?.name || subscription.next_plan_id)} por ${money(amount)} al mes. El cambio conserva tu período actual y tus datos.</p>` : ""}${renewalNotice}${!renews ? `<p class="muted">${access ? "Conservas el acceso hasta el final del período pagado. Después, tu cuenta pasa a Gratis si no renuevas." : "Tu período pagado terminó. Tus datos siguen disponibles con los límites del plan Gratis."}</p>` : ""}<div class="billing-actions">${!renews && state.capabilities?.webpay && nextPlan?.id !== "free" ? '<button data-billing-action="renew">Renovar un mes con Webpay Plus</button>' : ""}${renews ? '<button class="secondary" data-billing-action="cancel">Cancelar futuros cobros</button>' : automatic && access && state.capabilities?.oneclick && nextPlan?.id !== "free" ? '<button class="secondary" data-billing-action="resume">Autorizar renovación automática</button>' : ""}${automatic && state.capabilities?.oneclick ? '<button class="text-button" data-billing-action="update-card">Actualizar medio de pago</button>' : ""}<button class="text-button" data-billing-action="change">Cambiar plan para el siguiente período</button></div>` : '<p>Tu cuenta no tiene cobros programados. Tus metas, hábitos y Lumi pueden seguir avanzando en el plan Gratis.</p><a class="button" href="#plans">Ver Plus y Pro</a>'}<p class="fine billing-calendar-note">Los períodos duran un mes calendario. Si el mes no tiene tu día de inicio, termina en su último día. Al renovar antes del vencimiento, el nuevo mes empieza al terminar tu período vigente.</p></section>${usageView(state, escape)}${historyView(state, escape)}`;
}

function historyView(state, escape) {
  const rows = state.payments || [];
  return `<section class="billing-history panel"><h2>Historial de pagos</h2>${rows.length ? '<p class="fine billing-table-help">Desliza la tabla para ver el estado y todos los datos del pago.</p>' : ""}${rows.length ? `<div class="billing-table-scroll"><table><caption class="sr-only">Tus pagos y períodos de suscripción</caption><thead><tr><th scope="col">Fecha y plan</th><th scope="col">Período</th><th scope="col">Monto</th><th scope="col">Estado</th></tr></thead><tbody>${rows.map((payment) => `<tr><td><strong>${escape(state.plans.find((p) => p.id === payment.plan_id)?.name || payment.plan_id)}</strong><small>${date(payment.created_at)}</small></td><td>${date(payment.period_start)}<small>al ${date(payment.period_end)}</small></td><td>${money(payment.amount)}${payment.promo_applied ? "<small>Promoción inicial</small>" : ""}</td><td><span class="billing-payment-status">${escape(paymentLabels[payment.status] || "En verificación")}</span>${pendingStatuses.has(payment.status) ? `<button class="text-button" data-verify-order="${escape(payment.id)}">Consultar resultado</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">Todavía no hay pagos registrados en tu cuenta.</p>'}</section>`;
}

function resultMarkup(order, escape, finalCheck = false) {
  const result = paymentResult(order);
  return `<section class="billing-result billing-result-${result.kind} panel" role="status"><span class="billing-result-symbol" aria-hidden="true">${result.kind === "success" ? "✓" : result.kind === "pending" ? "◷" : "○"}</span><div><h2>${result.title}</h2><p>${result.message}</p>${order?.amount != null ? `<p class="fine">${money(order.amount)} CLP · ${escape(paymentLabels[order.status] || "En verificación")}</p>` : ""}${!result.terminal && finalCheck ? '<p class="fine">La confirmación está tardando. Puedes volver a consultar; no necesitas crear otro pago.</p>' : ""}${!result.terminal ? '<button class="secondary" data-billing-action="verify-return">Volver a consultar</button>' : ""}</div></section>`;
}

export function mountBilling(
  root,
  { user = null, billing, loadCatalog, onLogin, notify = () => {} } = {},
) {
  const host = root.matches?.("[data-billing-root]")
    ? root
    : root.querySelector("[data-billing-root]");
  if (!host) return () => {};
  const body = host.querySelector("[data-billing-body]"),
    escape = escapeText;
  let state,
    disposed = false,
    busy = false,
    verifying = false,
    quote,
    outcome = null,
    pollTimer = null,
    offerTimer = null,
    offerClock = null,
    pollCount = 0,
    requestId = null,
    selectionVersion = 0;
  const view = host.dataset.view;
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const returnReference = ["order", "enrollment"].find((key) =>
    /^[0-9a-f-]{36}$/i.test(params.get(key) || ""),
  );
  let verifyReference = returnReference
    ? { [`${returnReference}_id`]: params.get(returnReference) }
    : null;
  const errorMessage = (error) =>
    /fetch|timeout|network/i.test(error?.message || "")
      ? "No pudimos conectar. Revisa Internet y vuelve a consultar."
      : error?.message ||
        "No pudimos completar la operación. Vuelve a consultar tu suscripción.";
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
    alert.textContent = errorMessage(error);
  };
  const clearError = () => host.querySelector("[data-billing-error]")?.remove();
  const campaignNow = () =>
    offerClock
      ? offerClock.time + performance.now() - offerClock.receivedAt
      : Date.now();
  const updateOffer = () => {
    clearTimeout(offerTimer);
    if (disposed || !state || document.hidden) return;
    const campaign = campaignStatus(state, campaignNow());
    const banner = host.querySelector("[data-billing-offer]");
    if (banner && !campaign.active) {
      const options = host.querySelector("[data-billing-plan-options]");
      if (options) {
        options.outerHTML = cards(state, user, escape, campaignNow());
      }
    } else if (banner) {
      const time = remainingTime(campaign.remaining);
      for (const unit of ["days", "hours", "minutes"]) {
        banner.querySelector(`[data-offer-${unit}]`).textContent = time[unit];
      }
    }
    if (campaign.active && banner) {
      offerTimer = setTimeout(
        updateOffer,
        Math.min(15_000, campaign.remaining),
      );
    }
  };
  const call = async (action, payload = {}) => {
    if (typeof billing !== "function")
      throw new Error("La conexión con los pagos todavía no está configurada.");
    return billing(action, payload);
  };
  const paint = () => {
    if (disposed || !state) return;
    body.innerHTML = `${environmentBadge(state.capabilities, escape)}${outcome ? resultMarkup(outcome, escape, pollCount >= 5) : ""}${state.pending_order && (!outcome || outcome.type === "enrollment") ? `<section class="notice billing-pending"><strong>Hay una operación pendiente de confirmación.</strong><p>Consulta su resultado antes de iniciar otro pago.</p><button class="secondary" data-verify-order="${escape(state.pending_order.id)}">Consultar pago pendiente</button></section>` : ""}${state.pending_enrollment && !outcome ? `<section class="notice billing-pending"><strong>Hay una inscripción del medio de pago pendiente.</strong><p>Inscribir una tarjeta no activa el plan. Consulta el estado antes de volver a inscribirla.</p><button class="secondary" data-verify-enrollment="${escape(state.pending_enrollment.id)}">Consultar inscripción pendiente</button></section>` : ""}${view === "subscription" && user ? subscriptionView(state, escape) : ""}${view !== "subscription" || !user ? cards(state, user, escape, campaignNow()) : '<section class="billing-change-options" data-change-options hidden><h2>Plan para tu próximo período</h2><p class="muted">El cambio se aplica en la siguiente renovación. Tu período ya pagado y tus datos se conservan.</p>' + cards(state, user, escape, campaignNow()) + "</section>"}<div data-billing-review></div>`;
    updateOffer();
  };
  const refresh = async () => {
    const next = user ? await call("state") : await loadCatalog?.();
    if (disposed) return;
    state = Array.isArray(next) ? { plans: next } : next;
    if (!state || !Array.isArray(state.plans) || !state.plans.length)
      throw new Error(
        "No pudimos consultar los planes. Vuelve a intentarlo en unos momentos.",
      );
    const serverTime = Date.parse(state.promotion?.server_now);
    offerClock = Number.isFinite(serverTime)
      ? { time: serverTime, receivedAt: performance.now() }
      : null;
    paint();
  };
  const review = (html) => {
    const target = host.querySelector("[data-billing-review]");
    if (target) {
      target.innerHTML = html;
      target.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "center",
      });
    }
  };
  const recurringConsent = (nextAmount) =>
    `<label class="billing-consent"><input name="recurring-consent" type="checkbox" required><span>Autorizo a PlanifIA a cobrar mensualmente ${money(nextAmount)} CLP mediante Oneclick desde la próxima renovación, hasta que cancele los futuros cobros. Puedo cancelar desde Mi suscripción y conservar el acceso hasta terminar mi período pagado.</span></label>`;
  const selectPlan = async (id, channel) => {
    if (!validPlan(id)) return;
    if (!user) {
      rememberBillingIntent(id);
      onLogin?.(id);
      return;
    }
    if (state.pending_order || state.pending_enrollment) {
      throw new Error(
        "Primero consulta el resultado de la operación pendiente. No necesitas crear otro pago o inscripción.",
      );
    }
    const current =
      typeof state.effective_plan === "string"
        ? state.effective_plan
        : state.effective_plan?.id;
    if (current === id && !channel) {
      if (view !== "subscription") location.hash = "subscription";
      return;
    }
    if (id === "free" && current === "free") {
      location.hash = "today";
      return;
    }
    const activePaid =
      current !== "free" && state.subscription?.access_active === true;
    const changeOnly = Boolean(activePaid && id !== current && !channel);
    const version = ++selectionVersion;
    review(
      '<section class="billing-review panel" role="status"><span class="billing-spinner" aria-hidden="true"></span><p>Confirmando el precio y tu próximo período…</p></section>',
    );
    quote = null;
    try {
      const response = await call("quote", {
        plan_id: id,
        ...(channel ? { channel } : {}),
        ...(changeOnly ? { for_change: true } : {}),
      });
      if (disposed || version !== selectionVersion) return;
      quote = response.quote || response;
      if (
        quote.plan_id !== id ||
        !Number.isSafeInteger(quote.amount_clp) ||
        quote.amount_clp < 0 ||
        !Number.isSafeInteger(quote.regular_price_clp) ||
        !["webpay", "oneclick"].includes(quote.channel)
      )
        throw new Error(
          "No pudimos confirmar el precio de este plan. Vuelve a consultarlo antes de pagar.",
        );
      const plan = state.plans.find((p) => p.id === id);
      requestId = crypto.randomUUID();
      review(
        `<section class="billing-review panel" aria-labelledby="billing-review-title"><div class="billing-review-header"><div><p class="eyebrow">${changeOnly ? "TU PRÓXIMO PERÍODO" : "ANTES DE CONTINUAR"}</p><h2 id="billing-review-title">${changeOnly ? "Cambiar a" : "Contratar"} ${escape(plan?.name || id)}</h2></div><button type="button" class="text-button" data-billing-action="dismiss-review">Cerrar</button></div>${changeOnly ? `<p>Tu período actual se conserva hasta el ${date(state.subscription.paid_until || state.subscription.period_end)}. No hay prorrateos ni cargos adicionales por este cambio.</p><dl class="billing-details"><div><dt>Plan en la próxima renovación</dt><dd>${escape(plan?.name || id)}</dd></div><div><dt>Precio de la próxima renovación</dt><dd>${money(quote.amount_clp)} CLP</dd></div><div><dt>Fecha</dt><dd>${date(quote.period_start)}</dd></div></dl><button data-confirm-change="${escape(id)}">Aplicar en la próxima renovación</button>` : `<dl class="billing-details"><div><dt>Período contratado</dt><dd>${date(quote.period_start)} — ${date(quote.period_end)}</dd></div><div><dt>Total de este período</dt><dd class="billing-review-amount">${money(quote.amount_clp)} CLP ${quote.promotion_applied ? '<span class="tag">Promoción inicial</span>' : ""}</dd></div><div><dt>Precio desde el segundo período</dt><dd>${money(quote.regular_price_clp)} CLP al mes</dd></div><div><dt>${quote.channel === "oneclick" ? "Próximo cobro" : "Vencimiento y próxima renovación manual"}</dt><dd>${date(quote.next_date || quote.period_end)} · ${money(quote.next_amount_clp ?? quote.regular_price_clp)} CLP</dd></div></dl>${state.capabilities?.webpay && state.capabilities?.oneclick ? `<label class="billing-channel">Modalidad de renovación<select data-billing-channel="${escape(id)}"><option value="oneclick" ${quote.channel === "oneclick" ? "selected" : ""}>Automática con Oneclick</option><option value="webpay" ${quote.channel === "webpay" ? "selected" : ""}>Manual con Webpay Plus</option></select></label>` : `<p class="notice">${quote.channel === "oneclick" ? "Oneclick: inscribe tu medio de pago y autoriza las siguientes renovaciones mensuales." : "Webpay Plus: pagas un mes. Para el siguiente período debes renovar manualmente; no hay cobros automáticos."}</p>`}<p class="fine">Incluye ${escape(limits(plan).goals)} metas activas, ${escape(limits(plan).generations)} generaciones y ${escape(limits(plan).adjustments)} ajustes de IA al mes, calendario, hábitos y Lumi.</p><form data-billing-checkout="${escape(id)}">${quote.channel === "oneclick" ? recurringConsent(quote.next_amount_clp ?? quote.regular_price_clp) : ""}<p class="fine">${quote.channel === "oneclick" ? "Inscribir una tarjeta no activa la suscripción. Confirmaremos el cobro de este período antes de habilitar el plan." : "Tu suscripción se activa después de confirmar el pago con Transbank."}</p><button ${state.capabilities?.environment === "disabled" ? "disabled" : ""}>${quote.channel === "oneclick" ? "Inscribir y pagar" : "Ir a Webpay Plus"} · ${money(quote.amount_clp)}</button></form>`}</section>`,
      );
    } catch (error) {
      if (disposed || version !== selectionVersion) return;
      review(
        '<section class="billing-review panel"><p>No pudimos preparar la contratación. Vuelve a elegir el plan para consultar un resumen actualizado.</p></section>',
      );
      showError(error);
    }
  };
  const redirectToProvider = (response) => {
    const redirect = validatePaymentRedirect(
      response.redirect,
      response.environment || state.capabilities?.environment,
    );
    const form = document.createElement("form");
    form.method = "POST";
    form.action = redirect.url;
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = redirect.field;
    field.value = redirect.token;
    form.append(field);
    document.body.append(form);
    form.submit();
    form.remove();
  };
  const verify = async (reference, automatic = false) => {
    if (disposed || verifying) return;
    verifying = true;
    clearTimeout(pollTimer);
    verifyReference = reference || verifyReference;
    if (!verifyReference) {
      verifying = false;
      return;
    }
    try {
      const result = await call("verify", verifyReference);
      if (disposed) return;
      await refresh();
      if (disposed) return;
      outcome = result.order ||
        (result.enrollment
          ? { ...result.enrollment, type: "enrollment" }
          : null) ||
        state.payments?.find((item) => item.id === verifyReference.order_id) ||
        state.pending_order || {
          id: verifyReference.order_id,
          status: "pending",
        };
      if (result.order_id && !verifyReference.order_id)
        verifyReference = { order_id: result.order_id };
      if (automatic) pollCount++;
      paint();
      clearTimeout(pollTimer);
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
    clearError();
    const buttons = new Map(
      [...host.querySelectorAll("button")].map((button) => [
        button,
        button.disabled,
      ]),
    );
    buttons.forEach((wasDisabled, button) => (button.disabled = true));
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
    if (!button || !host.contains(button)) return;
    if (button.dataset.billingPlan) {
      void operation(() => selectPlan(button.dataset.billingPlan));
      return;
    }
    if (button.hasAttribute("data-verify-order")) {
      pollCount = 0;
      void operation(() =>
        verify(
          button.dataset.verifyOrder
            ? { order_id: button.dataset.verifyOrder }
            : verifyReference,
        ),
      );
      return;
    }
    if (button.hasAttribute("data-verify-enrollment")) {
      pollCount = 0;
      void operation(() =>
        verify({ enrollment_id: button.dataset.verifyEnrollment }),
      );
      return;
    }
    if (button.dataset.billingAction === "verify-return") {
      pollCount = 0;
      void operation(() => verify(verifyReference));
      return;
    }
    if (button.dataset.confirmChange) {
      void operation(async () => {
        await call("change_plan", { plan_id: button.dataset.confirmChange });
        await refresh();
        notify(
          "Tu próximo plan quedó guardado. Tu período actual se conserva.",
        );
      });
      return;
    }
    if (button.dataset.billingAction === "retry") {
      void operation(refresh);
      return;
    }
    if (button.dataset.billingAction === "change") {
      host.querySelector("[data-change-options]").hidden = false;
      host
        .querySelector("[data-change-options]")
        .scrollIntoView({ block: "start" });
      return;
    }
    if (button.dataset.billingAction === "dismiss-review") {
      selectionVersion++;
      quote = null;
      host.querySelector("[data-billing-review]").innerHTML = "";
      return;
    }
    if (button.dataset.billingAction === "renew") {
      const next =
        state.subscription?.next_plan_id ||
        state.subscription?.plan_id ||
        (typeof state.effective_plan === "string"
          ? state.effective_plan
          : state.effective_plan?.id);
      void operation(() => selectPlan(next, "webpay"));
      return;
    }
    if (button.dataset.billingAction === "cancel") {
      review(
        `<section class="billing-review panel"><h2>Cancelar futuros cobros</h2><p>Conservas el acceso pagado hasta el ${date(state.subscription.paid_until || state.subscription.period_end)}. Cancelar la renovación no devuelve automáticamente pagos anteriores.</p><button data-billing-action="confirm-cancel">Confirmar cancelación de futuros cobros</button><button class="text-button" data-billing-action="dismiss-review">Conservar la renovación</button></section>`,
      );
      return;
    }
    if (button.dataset.billingAction === "confirm-cancel") {
      void operation(async () => {
        await call("cancel");
        await refresh();
        notify(
          "Los futuros cobros quedaron cancelados. Tu período pagado se conserva.",
        );
      });
      return;
    }
    if (["resume", "update-card"].includes(button.dataset.billingAction)) {
      const update = button.dataset.billingAction === "update-card";
      const next = state.plans.find(
        (p) =>
          p.id ===
          (state.subscription.next_plan_id || state.subscription.plan_id),
      );
      review(
        `<section class="billing-review panel"><h2>${update ? "Actualizar tu medio de pago" : "Autorizar renovación automática"}</h2><p>${update ? "Inscribirás el medio de pago en Transbank. Tu acceso actual se conserva." : "Los próximos cobros se efectuarán al renovar tu período contratado."}</p><form data-billing-consent-action="${update ? "update_card" : "resume"}">${recurringConsent(state.subscription.next_amount ?? regularPrice(next))}<button>${update ? "Actualizar con Oneclick" : "Autorizar próximos cobros"}</button><button type="button" class="text-button" data-billing-action="dismiss-review">Volver</button></form></section>`,
      );
      return;
    }
  };
  const onChange = (event) => {
    if (event.target.matches("[data-billing-channel]"))
      void operation(() =>
        selectPlan(event.target.dataset.billingChannel, event.target.value),
      );
  };
  const onSubmit = (event) => {
    const form = event.target.closest("form");
    if (!form || !host.contains(form)) return;
    if (!form.matches("[data-billing-checkout], [data-billing-consent-action]"))
      return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const consent =
      form.querySelector('[name="recurring-consent"]')?.checked === true;
    void operation(async () => {
      if (form.dataset.billingCheckout) {
        if (!quote || quote.plan_id !== form.dataset.billingCheckout)
          throw new Error(
            "Vuelve a elegir el plan para actualizar el resumen de contratación.",
          );
        const response = await call("checkout", {
          plan_id: form.dataset.billingCheckout,
          channel: quote.channel,
          expected_amount_clp: quote.amount_clp,
          recurring_consent: consent,
          request_id: requestId,
        });
        if (!disposed) redirectToProvider(response);
      } else {
        const response = await call(form.dataset.billingConsentAction, {
          recurring_consent: consent,
        });
        if (disposed) return;
        if (response.redirect) redirectToProvider(response);
        else {
          await refresh();
          notify("Tu autorización de renovación quedó guardada.");
        }
      }
    });
  };
  host.addEventListener("click", onClick);
  host.addEventListener("change", onChange);
  host.addEventListener("submit", onSubmit);
  document.addEventListener("visibilitychange", updateOffer);
  void refresh()
    .then(async () => {
      if (disposed || !user) return;
      if (verifyReference) await verify(verifyReference, true);
      else if (validPlan(params.get("plan")))
        await selectPlan(params.get("plan"));
    })
    .catch((error) => {
      if (disposed) return;
      body.innerHTML =
        '<section class="panel"><h2>No pudimos consultar los planes</h2><p class="muted">Tus metas y tu progreso siguen guardados. Puedes volver a consultar en unos momentos.</p><button data-billing-action="retry">Volver a consultar</button></section>';
      showError(error);
    });
  return () => {
    disposed = true;
    selectionVersion++;
    clearTimeout(pollTimer);
    clearTimeout(offerTimer);
    host.removeEventListener("click", onClick);
    host.removeEventListener("change", onChange);
    host.removeEventListener("submit", onSubmit);
    document.removeEventListener("visibilitychange", updateOffer);
  };
}
