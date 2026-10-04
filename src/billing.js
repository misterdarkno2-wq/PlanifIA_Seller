import "./billing.css";

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
      const paid = plan.price_clp > 0,
        count = limits(plan);
      return `<article class="billing-plan panel ${plan.id === "plus" ? "billing-plan-featured" : ""}" data-plan-card="${escape(plan.id)}">
      <div class="billing-plan-top"><h2>${escape(plan.name)}</h2>${current === plan.id && user ? '<span class="tag">Tu plan actual</span>' : plan.id === "plus" ? '<span class="tag">Más espacio para tus metas</span>' : ""}</div>
      <div class="billing-plan-pricing"><p class="billing-price-before billing-price-label">${paid ? "Precio de referencia" : "Empieza a tu ritmo"}</p>
      <p class="billing-price"><strong>${money(plan.price_clp)}</strong><span>${paid ? "al mes" : "siempre"}</span></p>
      <p class="billing-price-note">${paid ? "La contratación y el precio final se confirmarán en la app de Google Play." : "Tu punto de partida, sin un medio de pago."}</p></div>
      <ul class="billing-benefits"><li><strong>${escape(count.goals)}</strong> metas activas</li><li><strong>${escape(count.generations)}</strong> generaciones con IA al mes</li><li><strong>${escape(count.adjustments)}</strong> ${Number(count.adjustments) === 1 ? "ajuste" : "ajustes"} con IA al mes</li>${(Array.isArray(plan.benefits) ? plan.benefits : []).map((benefit) => `<li>${escape(benefit)}</li>`).join("")}</ul>
      ${paid ? (current === plan.id && user ? '<a class="button secondary" href="#subscription">Consultar mi plan</a>' : `<button class="${plan.id === "plus" ? "" : "secondary"}" data-google-play-plan="${escape(plan.id)}">Cómo suscribirme</button>`) : `<button class="secondary" data-billing-plan="free">${user ? (current === "free" ? "Continuar con Gratis" : "Volver a mis metas") : "Empezar gratis"}</button>`}
    </article>`;
    })
    .join(
      "",
    )}</div><p class="billing-promo-rule fine">Los precios de Plus y Pro son de referencia, en pesos chilenos (CLP). Las ofertas y las condiciones de la suscripción se confirmarán en Google Play cuando la app esté disponible.</p></div>`;
}

function usageView(state, escape) {
  const usage = state.usage || {};
  const plan =
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
  return `<section class="billing-usage panel"><h2>Tu espacio este mes</h2><div class="billing-usage-grid">${rows.map(([label, used, limit]) => `<div><p>${label}</p><strong>${escape(used)} <span>/ ${escape(limit)}</span></strong><progress value="${Number(used)}" max="${Math.max(1, Number(limit))}" aria-label="${label}"></progress>${Number(used) >= Number(limit) ? "<small>Límite alcanzado</small>" : "<small>Disponible para tus próximos pasos</small>"}</div>`).join("")}</div><p class="fine">El uso de IA sigue meses calendario UTC y se reinicia el ${resetLabel(usage.reset_at)} (hora de Chile). Las metas activas se cuentan al momento de crear o reactivar una meta.</p>${rows.some(([, used, limit]) => Number(used) > Number(limit)) ? '<p class="notice">Tu información sigue disponible. Para crear nuevas metas, archiva las que ya terminaste. La IA vuelve a estar disponible al reiniciar tu consumo.</p>' : ""}</section>`;
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
        : '<p>Tu cuenta no tiene cobros programados. Tus metas, hábitos y Lumi pueden seguir avanzando en el plan Gratis.</p><a class="button" href="#plans">Ver Plus y Pro</a>'
    }
  </section>${usageView(state, escape)}${historyView(state, escape)}`;
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
  { user = null, billing, loadCatalog, onLogin, notify = () => {} } = {},
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
  const paint = () => {
    if (disposed || !state) return;
    body.innerHTML = `${outcome ? resultMarkup(outcome, escapeText, pollCount >= 5) : ""}${state.pending_order && !outcome ? `<section class="notice billing-pending"><strong>Hay un pago anterior pendiente de confirmación.</strong><p>Puedes consultar su resultado.</p><button class="secondary" data-verify-order="${escapeText(state.pending_order.id)}">Consultar pago pendiente</button></section>` : ""}${host.dataset.view === "subscription" && user ? subscriptionView(state, escapeText) : cards(state, user, escapeText)}<div data-billing-review></div>`;
  };
  const refresh = async () => {
    const next = user ? await call("state") : await loadCatalog?.();
    if (disposed) return;
    state = Array.isArray(next) ? { plans: next } : next;
    if (!state || !Array.isArray(state.plans) || !state.plans.length)
      throw new Error(
        "No pudimos consultar los planes. Vuelve a intentarlo en unos momentos.",
      );
    paint();
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
  };
}
