import "./compat.js";
import "./style.css";
import { authRedirect, downloadJson, hasStoredSession, installNativeBack, isNative, watchSafeArea } from "./platform.js";
import "./pet.css";
import "./lumi-conversation.css";
import "./lumi-chat.css";
import { lumiChatPage, mountLumiChat } from "./lumi-chat.js";
import { createLumiCompanion } from "./lumi-messages.js";
import { createLumiVoice } from "./lumi-voice.js";
import {
  lumiConversationMarkup,
  lumiConversationSettings,
  mountLumiConversation,
} from "./lumi-conversation.js";
import {
  createAiJobMonitor,
  JOB_LABELS,
  jobDescription,
  terminalJob,
} from "./ai-jobs.js";
import {
  AUTH_STORAGE_KEY,
  GOOGLE_WEB_CLIENT_ID,
  cloud,
  missing,
  checked,
  loadAuthSettings,
  loadState,
  rpc,
  generatePlan,
  listAiJobs,
  cancelAiJob,
  releaseAiRequest,
  requestCloudFallback,
  loadLegalStatus,
  acceptLegal,
  reportAiPlan,
  loadExportExtras,
} from "./cloud.js";
import {
  LEGAL_PAGES,
  LEGAL_URLS,
  LEGAL_VERSION,
  legalDateLabel,
  legalConsentMarkup,
  legalCurrent,
  legalUpdateCard,
  newerVersion,
  signupLegal,
} from "./legal.js";
import {
  authReturnError,
  authReturnMessage,
  googleSignInMode,
  signInWithGoogleNative,
  signInWithGoogleWeb,
  usesGoogle,
} from "./google-auth.js";
import { crisisHelp, detectCrisis } from "./crisis-help.js";
import { reportControl } from "./ai-report.js";
import { createCloudFallback } from "./ai-source.js";
import {
  CATEGORIES,
  PRIORITIES,
  STAGES,
  progress,
  today,
  dateLabel,
  normalizeLegacy,
} from "./domain.js";
import { portrait } from "./pet-art.js";
import { createPetBehavior } from "./pet-behavior.js";
import { getPetMotionSettings } from "./pet-motion.js";
import { petMotionControls, bindPetMotionControls } from "./pet-motion-ui.js";
import { startPlanLoading } from "./plan-loading.js";
import {
  renderBilling,
  mountBilling,
  rememberBillingIntent,
  consumeBillingIntent,
} from "./billing.js";
import {
  loadBillingState,
  loadBillingCatalog,
  loadMonetization,
  redeemReferral,
  verifyPlayPurchases,
} from "./billing-cloud.js";
import {
  createAdManager,
  isAndroidApp,
} from "./native-ads.js";
import {
  AD_FREE_FALLBACK_PRICE,
  adFreeProduct,
  adFreePurchaseOutcome,
  mountAdFreeOffer,
} from "./ad-free-offer.js";
import {
  createPlayStore,
  getPremiumStatus,
  onPurchasesUpdated,
  rememberPlan,
} from "./native-billing.js";
import { createUpdateChecker } from "./app-update.js";
import { createReminders, reminderTime } from "./reminders.js";
import { validateProposal } from "../supabase/functions/_shared/plan.js";
import { aiLanguage, bindLangToggle, lang, langToggle, onLangChange, tr } from "./i18n.js";
import { serverText } from "./server-messages.js";

const app = document.querySelector("#app"),
  e = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const $ = (selector, root = document) => root.querySelector(selector);
let user = null,
  state = null,
  loading = false,
  loadVersion = 0,
  toastTimer,
  dialog;
// Con una sesión guardada no se muestra la portada mientras Supabase la recupera: sigue el esqueleto.
// Lo mismo al volver de Google con la sesión en el enlace (#access_token=…).
let restoring = Boolean(cloud) && (hasStoredSession(AUTH_STORAGE_KEY) || /[#&]access_token=/.test(location.hash));
// Al volver de Google con un error (o de un enlace de correo vencido) Supabase lo deja en el enlace.
// authNotice lo muestra el formulario de inicio de sesión hasta que la persona navega o lo usa.
let authReturn = authReturnError(location.hash),
  authNotice = "";
// Día para el que se dibujó la vista de la cuenta (para redibujar al volver después de medianoche).
let renderedDay = null;
const petControllers = new Map();
let petPose = null;
let disposePetMotionControls = null;
let disposeBilling = null;
const companion = createLumiCompanion({
  storage: localStorage,
  session: sessionStorage,
});
const companionVoice = createLumiVoice();
// Login, keyboard navigation or any normal control can enable browser audio.
// This does not control Lumi's autonomous actions.
const activateCompanionAudio = () => {
  if (companion.preferences.sound && !document.hidden) companionVoice.unlock();
};
document.addEventListener("pointerdown", activateCompanionAudio, { passive: true });
document.addEventListener("keydown", activateCompanionAudio);
let disposeConversation = null;
const aiJobs = createAiJobMonitor({
  list: listAiJobs,
  cancel: cancelAiJob,
  notify: toast,
});
aiJobs.subscribe(() => updateAiBadge());
// Con el PC apagado, las propuestas en cola las prepara la IA en la nube (respaldo).
const cloudFallback = createCloudFallback({
  request: requestCloudFallback,
  onStarted: () => aiJobs.refresh(),
});
aiJobs.subscribe((jobs) => cloudFallback.consider(jobs));

let lumiChat = null;
// Última aceptación de los términos de la cuenta abierta: { owner, available, latest }.
let legal = null,
  legalPrompted = false,
  legalLoading = null;
const platformName = () => (isAndroidApp() ? "android" : isNative() ? "desktop" : "web");
const needsLegal = () =>
  Boolean(user && legal?.owner === user.id && legal.available && !legalCurrent(legal.latest));
// Quien entra con Google no pasó por la casilla del registro (Google no envía la aceptación). Hasta
// que acepte, o mientras no se pueda comprobar, no ve nada de la app: ni metas, ni IA, ni compras.
const needsSignupConsent = () =>
  Boolean(user && usesGoogle(user) && !(legal?.owner === user.id && legal.available && legal.latest));
async function checkLegal() {
  if (!user || legal?.owner === user.id) return;
  const owner = user.id;
  // La pantalla de Google y la carga de datos lo piden a la vez: una sola consulta.
  if (legalLoading?.owner === owner) return legalLoading.promise;
  const promise = loadLegalStatus().catch(() => ({ available: false }));
  legalLoading = { owner, promise };
  const status = await promise;
  if (legalLoading?.promise === promise) legalLoading = null;
  if (user?.id !== owner) return;
  legal = { owner, ...status };
  // Una vez por sesión se avisa al entrar; la IA y las compras lo vuelven a pedir hasta aceptar.
  if (needsLegal() && !needsSignupConsent() && !legalPrompted && !dialog) {
    legalPrompted = true;
    legalModal();
  }
}
async function acceptCurrentLegal() {
  const owner = user.id;
  const latest = await acceptLegal(LEGAL_VERSION, platformName());
  if (user?.id === owner) legal = { owner, available: true, latest };
  toast(tr("Gracias. Guardamos tu aceptación de los términos vigentes.", "Thank you. We saved your acceptance of the current terms."));
  return latest;
}
/**
 * Antes de usar la IA o comprar con una versión anterior aceptada, muestra la tarjeta para aceptar
 * la vigente donde la persona estaba (place la inserta) para no perder lo escrito.
 * true = puede seguir; false = eligió "Ahora no".
 */
function legalGate(place) {
  if (!needsLegal()) return Promise.resolve(true);
  return new Promise((resolve) => {
    document.querySelector("[data-legal-update]")?.remove();
    const card = legalUpdateCard({
      accept: acceptCurrentLegal,
      onAccepted: () => resolve(true),
      onLater: () => resolve(false),
      onExport: () => exportData().catch((error) => toast(errorMessage(error))),
      onDelete: deleteAccountForm,
    });
    place(card);
    card.scrollIntoView?.({ block: "nearest" });
    card.querySelector("h2").focus({ preventScroll: true });
  });
}
function legalModal() {
  const host = modal(tr("Un aviso antes de seguir", "A notice before you continue"), "<div data-legal-slot></div>");
  const card = legalUpdateCard({
    accept: acceptCurrentLegal,
    onAccepted: closeModal,
    onLater: closeModal,
    onExport: () => exportData().catch((error) => toast(errorMessage(error))),
    onDelete: deleteAccountForm,
  });
  $("[data-legal-slot]", host).replaceChildren(card);
}
/** Pantalla completa en lugar de la app hasta aceptar (cuentas que entraron con Google). */
function signupConsentPage() {
  const owner = user.id;
  const phase = legal?.owner !== owner ? "checking" : legal.available ? "consent" : "failed";
  // Redibujar la vista (por ejemplo, al terminar de cargar las metas) no debe desmarcar la casilla.
  const current = $("[data-signup-consent]", app);
  if (current?.dataset.owner === owner && current.dataset.phase === phase && current.dataset.langShown === lang()) return;
  app.innerHTML = `<header class="landing-header"><span>${logo()}</span><div>${langToggle()}</div></header><main id="main"><section class="panel signup-consent" data-signup-consent data-owner="${e(owner)}" data-phase="${phase}" data-lang-shown="${lang()}" aria-labelledby="signup-consent-title"><h1 id="signup-consent-title" tabindex="-1">${tr("Antes de empezar", "Before you start")}</h1>${
    phase === "checking"
      ? `<p role="status">${tr("Comprobando tu cuenta…", "Checking your account…")}</p>`
      : phase === "failed"
        ? `<p class="error" role="alert">${tr("No pudimos comprobar tu cuenta. Revisa tu conexión y vuelve a intentarlo.", "We couldn't check your account. Check your connection and try again.")}</p><div class="actions"><button data-consent-retry>${tr("Reintentar", "Try again")}</button><button type="button" class="secondary" data-consent-decline>${tr("Cerrar sesión", "Sign out")}</button></div>`
        : `<p>${tr(`Entraste con Google como <strong>${e(user.email)}</strong>. Para usar PlanifIA confirma tu edad y acepta los términos. Te lo pedimos sólo esta vez.`, `You signed in with Google as <strong>${e(user.email)}</strong>. To use PlanifIA, confirm your age and accept the terms. We only ask you this once.`)}</p><form data-consent-form>${legalConsentMarkup("google_consent")}${alert()}<div class="actions"><button data-consent-accept disabled>${tr("Aceptar y continuar", "Accept and continue")}</button><button type="button" class="secondary" data-consent-decline>${tr("No acepto, cerrar sesión", "I don't accept, sign out")}</button></div></form><p class="fine">${tr("Si no aceptas, cerramos la sesión y no usamos tu cuenta. Si prefieres que no quede registrada, puedes", "If you don't accept, we sign you out and don't use your account. If you'd rather it not stay registered, you can")} <button type="button" class="text-button" data-consent-delete>${tr("eliminarla", "delete it")}</button>.</p>`
  }</section></main>`;
  $("#signup-consent-title", app).focus({ preventScroll: true });
  if (phase === "checking") void checkLegal().then(() => user?.id === owner && render());
  $("[data-consent-retry]", app)?.addEventListener("click", () => {
    legal = null;
    render();
  });
  $("[data-consent-decline]", app)?.addEventListener("click", (event) => declineSignupConsent(event.currentTarget));
  $("[data-consent-delete]", app)?.addEventListener("click", deleteAccountForm);
  const form = $("[data-consent-form]", app);
  if (!form) return;
  const box = $("[data-legal-consent]", form),
    accept = $("[data-consent-accept]", form);
  box.addEventListener("change", () => (accept.disabled = !box.checked));
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!box.checked) return;
    busy(accept, async () => {
      await acceptCurrentLegal();
      render();
    });
  };
}
// Sin aceptar no se usa la cuenta: se cierra la sesión (también en el servidor si hay conexión).
async function declineSignupConsent(button) {
  button.disabled = true;
  try {
    const { error } = await cloud.auth.signOut();
    if (error) await cloud.auth.signOut({ scope: "local" });
  } catch {
    await cloud.auth.signOut({ scope: "local" }).catch(() => {});
  }
  user = null;
  state = null;
  legal = null;
  legalPrompted = false;
  loadVersion++;
  location.hash = "home";
  render();
  toast(tr("Cerramos la sesión. Para usar PlanifIA tienes que aceptar los Términos y la Política de privacidad.", "We signed you out. To use PlanifIA you need to accept the Terms and the Privacy Policy."));
}
// Respaldo completo de la cuenta (derecho de acceso y portabilidad), también antes de eliminarla.
async function exportData() {
  const extras = await loadExportExtras();
  return downloadJson(tr("planifia-seller-respaldo.json", "planifia-seller-backup.json"), {
    version: 3,
    exported_at: new Date().toISOString(),
    sourceId: "seller:" + user.id,
    account: { id: user.id, email: user.email, created_at: user.created_at || null },
    ...state,
    ...extras,
  });
}
// Enlaces legales: en la web se abren en otra pestaña; en Android, en el navegador del teléfono.
document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[data-external-link]");
  if (!link || !playStore) return;
  event.preventDefault();
  playStore.openExternal(link.href).catch(() => toast(tr("No pudimos abrir el enlace. Visita planifia.cl.", "We couldn't open the link. Visit planifia.cl.")));
});
// Créditos y plan vigente. En Android, además, anuncios (sólo plan Gratis) y Google Play.
let monetization = null,
  monetizationUser = null,
  lastStoreCheck = 0;
const ads = createAdManager();
// Recordatorio diario con notificaciones locales (sólo Android, apagado hasta que la persona lo encienda).
const reminders = createReminders();
const playStore = isAndroidApp()
  ? createPlayStore({ verify: verifyPlayPurchases, onState: applyMonetization })
  : null;
function applyMonetization(next) {
  if (!next || !user) return;
  monetization = next;
  rememberPlan(user.id, next.plan.id);
  void ads.setEligible(next.plan.id === "free");
  ads.setAdFree(next.ad_free === true);
  for (const hint of document.querySelectorAll("[data-credit-hint]"))
    hint.textContent = creditHint();
  lumiChat?.refreshCredits();
}
async function refreshMonetization() {
  if (!user) return null;
  const owner = user.id;
  const next = await loadMonetization();
  if (user?.id === owner) applyMonetization(next);
  return next;
}
// Al abrir la app: el plan guardado en el teléfono evita mostrar anuncios a quien paga
// mientras el servidor y Google Play vuelven a verificar el estado real.
function startMonetization() {
  if (!user || monetizationUser === user.id) return;
  monetizationUser = user.id;
  const cached = getPremiumStatus(user.id);
  if (cached.plan === "free") void ads.setEligible(true);
  refreshMonetization()
    .then(() => checkStore())
    .catch(() => {});
}
async function checkStore(force = false) {
  if (!playStore || !user || (!force && Date.now() - lastStoreCheck < 60000)) return;
  lastStoreCheck = Date.now();
  try {
    const restored = await playStore.restore();
    if (!restored.state) await refreshMonetization();
  } catch {}
}
// Al cerrar un video de AdMob se ofrece la compra única "Quitar anuncios".
async function offerAdFree() {
  const product = adFreeProduct(monetization);
  if (!playStore || !product || !user) return;
  const accountId = user.id;
  const info = await playStore.products([], [product.product_id]).catch(() => null);
  const price =
    info?.products?.find((p) => p.productId === product.product_id)?.oneTime?.formattedPrice ||
    AD_FREE_FALLBACK_PRICE;
  if (user?.id !== accountId || !adFreeProduct(monetization)) return;
  mountAdFreeOffer({
    price,
    async onBuy() {
      const outcome = adFreePurchaseOutcome(
        await playStore.purchase(product, { accountId }).catch(() => null),
      );
      if (outcome.done) {
        toast(outcome.message);
        void refreshMonetization().catch(() => {});
      }
      return outcome;
    },
  });
}
function stopMonetization() {
  monetization = null;
  monetizationUser = null;
  void ads.setEligible(false);
}
function creditHint() {
  const cost = monetization?.credits?.cost_per_use ?? 20;
  return monetization
    ? tr(`Usar la IA cuesta ${cost} créditos. Tienes ${monetization.credits.balance}.`, `Using the AI costs ${cost} credits. You have ${monetization.credits.balance}.`)
    : tr(`Usar la IA cuesta ${cost} créditos.`, `Using the AI costs ${cost} credits.`);
}
onPurchasesUpdated((payload) => {
  // Compras completadas fuera del flujo (p. ej., un pago pendiente que se confirmó después).
  if (user && payload?.purchases?.length)
    playStore
      ?.sync(payload.purchases, { skipRecent: true })
      .then((result) => {
        if (result.results?.some((r) => !r.error && (r.granted || r.active)))
          toast(tr("Google Play confirmó tu compra. Tu cuenta ya está al día.", "Google Play confirmed your purchase. Your account is up to date."));
      })
      .catch(() => {});
}).catch(() => {});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && user) {
    void checkStore();
    // Recalcula los avisos: el de hoy pudo quedar atrás o la persona avanzó en otro dispositivo.
    if (state) void reminders.sync(user.id, state);
    // Volver a la app otro día: "Hoy", los hábitos y el calendario se vuelven a dibujar y cargar.
    if (state && renderedDay && renderedDay !== day()) {
      render();
      void refresh();
    }
  }
  if (document.visibilityState === "visible") void offerUpdate();
});
// Versión nueva en Google Play (sólo la app de Android). Se revisa al abrir y al volver a la app,
// como máximo cada 6 horas, salvo si la actualización es obligatoria o quedó a medias.
const appUpdate = createUpdateChecker();
let updateCheckedAt = 0;
let updatePending = false;
async function offerUpdate() {
  if (!isAndroidApp() || (!updatePending && Date.now() - updateCheckedAt < 6 * 60 * 60 * 1000)) return;
  updateCheckedAt = Date.now();
  const { action } = await appUpdate.check();
  updatePending = action === "required" || action === "resume";
  if (action === "none") return;
  if (action === "resume") {
    await appUpdate.start().catch(() => {});
    return;
  }
  // No interrumpe un formulario abierto: se vuelve a revisar al regresar a la app.
  if (dialog) {
    updateCheckedAt = 0;
    return;
  }
  const required = action === "required";
  const host = modal(
    tr("Hay una versión nueva de PlanifIA", "A new version of PlanifIA is available"),
    `<p>${required ? tr("Esta versión ya no recibe correcciones. Actualiza para seguir usando PlanifIA sin problemas.", "This version no longer gets fixes. Update to keep using PlanifIA without problems.") : tr("Actualiza para tener las últimas correcciones y mejoras.", "Update to get the latest fixes and improvements.")} ${tr("Google Play la descarga y la app se vuelve a abrir sola.", "Google Play downloads it and the app reopens by itself.")}</p>${alert()}<div class="actions"><button id="update-now">${tr("Actualizar ahora", "Update now")}</button>${required ? "" : `<button class="secondary" id="update-later">${tr("Más tarde", "Later")}</button>`}</div>`,
  );
  if (!required) host.addEventListener("close", () => appUpdate.later(), { once: true });
  $("#update-later", host)?.addEventListener("click", closeModal);
  const button = $("#update-now", host);
  button.onclick = async () => {
    button.disabled = true;
    // Si la persona sale de la app durante la instalación, al volver se consulta otra vez a Play
    // (aunque no hayan pasado 6 horas) para retomarla, como exige el flujo inmediato.
    updatePending = true;
    const result = await appUpdate.start().catch(() => null);
    if (result?.status === "cancelled") updatePending = required;
    if (!button.isConnected) return;
    button.disabled = false;
    // "started": Google Play instala y reinicia la app. "cancelled": la persona salió de Play.
    if (result?.status === "started") return;
    if (result?.status === "cancelled") closeModal();
    else formError(host, new Error(tr("No pudimos abrir Google Play. Inténtalo de nuevo en un momento.", "We couldn't open Google Play. Try again in a moment.")));
  };
}
function updateAiBadge() {
  const button = document.querySelector("#ai-jobs");
  if (!button) return;
  const pending = aiJobs.jobs.filter((j) =>
    ["queued", "processing"].includes(j.status),
  ).length;
  const ready = aiJobs.jobs.filter((j) => j.status === "completed").length;
  button.textContent = pending
    ? tr(`IA · ${pending} en preparación`, `AI · ${pending} in progress`)
    : ready
      ? tr("IA · propuestas para revisar", "AI · proposals to review")
      : tr("Mis solicitudes de IA", "My AI requests");
}
function aiJobsDialog() {
  const host = modal(
    tr("Mis solicitudes de IA", "My AI requests"),
    `<p class="muted">${tr("Tu trabajo continúa aunque cierres la página. Las propuestas sólo cambian tus metas cuando las confirmas.", "Your work continues even if you close the page. Proposals only change your goals when you confirm them.")}</p><div data-job-list></div>`,
  );
  let previous = "";
  const unsubscribe = aiJobs.subscribe((jobs, error) => {
    if (!host.isConnected || !host.open) return;
    const markup =
      (error ? '<p role="alert">' + e(serverText(error)) + "</p>" : "") +
      (jobs
        .map(
          (job) =>
            '<article class="panel ai-job-card"><h3>' +
            e(JOB_LABELS[job.status]) +
            "</h3><p>" +
            e(jobDescription(job)) +
            "</p>" +
            (job.status === "completed"
              ? '<button data-review-job="' +
                job.id +
                '">' +
                tr("Revisar propuesta", "Review proposal") +
                "</button>"
              : "") +
            (["queued", "processing"].includes(job.status) &&
            !job.cancel_requested
              ? '<button class="secondary" data-cancel-job="' +
                job.id +
                '">' +
                (job.status === "processing"
                  ? tr("Solicitar interrupción", "Ask to stop")
                  : tr("Cancelar solicitud", "Cancel request")) +
                "</button>"
              : "") +
            "</article>",
        )
        .join("") ||
        `<p class="muted">${tr("Todavía no hay solicitudes. Crea una meta para pedir tu primera propuesta.", "No requests yet. Create a goal to ask for your first proposal.")}</p>`);
    if (markup === previous) return;
    previous = markup;
    const focus = document.activeElement?.dataset;
    $("[data-job-list]", host).innerHTML = markup;
    host.querySelectorAll("[data-review-job]").forEach(
      (button) =>
        (button.onclick = () => {
          const job = aiJobs.jobs.find(
            (j) => j.id === button.dataset.reviewJob,
          );
          if (job?.result) {
            releaseAiRequest(job.request_id);
            proposalEditor({ ...job.result, job_id: job.id });
          }
        }),
    );
    host.querySelectorAll("[data-cancel-job]").forEach(
      (button) =>
        (button.onclick = () =>
          busy(button, async () => {
            const job = await aiJobs.cancel(button.dataset.cancelJob);
            if (terminalJob(job)) releaseAiRequest(job.request_id);
          })),
    );
    const focusId = focus?.reviewJob || focus?.cancelJob;
    if (focusId)
      host
        .querySelector(
          '[data-review-job="' +
            focusId +
            '"], [data-cancel-job="' +
            focusId +
            '"]',
        )
        ?.focus();
  });
  host.addEventListener("close", unsubscribe, { once: true });
  aiJobs.refresh();
}
function mountBillingView() {
  const root = $("[data-billing-root]");
  if (!root || disposeBilling) return;
  disposeBilling = mountBilling(root, {
    user,
    loadState: loadBillingState,
    loadCatalog: loadBillingCatalog,
    onLogin: (planId) => {
      rememberBillingIntent(planId);
      location.hash = "login";
    },
    notify: toast,
    monetization: user
      ? {
          load: refreshMonetization,
          redeem: redeemReferral,
          store: playStore,
          ads: isAndroidApp() ? ads : null,
          userId: user.id,
          beforePurchase: () => legalGate((card) => $("[data-billing-review]")?.replaceChildren(card)),
        }
      : null,
  });
}
function billingDestination() {
  const planId = consumeBillingIntent();
  return planId ? `subscription?plan=${planId}` : "today";
}
function disposePets() {
  disposeConversation?.();
  disposeConversation = null;
  for (const [svg, controller] of petControllers) {
    if (svg.closest("#pet")) petPose = controller.getState();
    controller.dispose();
  }
  petControllers.clear();
  disposePetMotionControls?.();
  disposePetMotionControls = null;
}
function mountPets() {
  if (user && state && !disposeConversation) {
    companion.start(user.id);
    disposeConversation = mountLumiConversation(app, companion, {
      voice: companionVoice,
    });
  }
  if (
    !disposePetMotionControls &&
    app.querySelector("[data-lumi-motion-select]")
  )
    disposePetMotionControls = bindPetMotionControls(app);
  for (const svg of app.querySelectorAll(".lumi-art")) {
    if (petControllers.has(svg)) continue;
    const previous = svg.closest("#pet") ? petPose : null;
    petControllers.set(
      svg,
      createPetBehavior(svg, {
        motionQuery: getPetMotionSettings(),
        ...(previous
          ? {
              initialPosition: previous.position,
              initialPose: previous.pose,
              initialReaction: previous.resumeReaction,
              lastFlipAt: previous.lastFlipAt,
            }
          : {}),
      }),
    );
  }
}
function celebratePet(kind = "happy") {
  const svg = $("#pet .lumi-art");
  petControllers.get(svg)?.celebrate(kind);
}
const uuid = () => crypto.randomUUID();
const requestId = (form) => (form.dataset.requestId ||= uuid());
document.addEventListener("input", (event) => {
  const form = event.target.closest("form");
  if (form) delete form.dataset.requestId;
});
const logo = () =>
  '<img class="brand" src="./assets/planifia-logo.png" alt="PlanifIA" width="166" height="55">';
const options = (values, value) =>
  Object.entries(values)
    .map(
      ([k, label]) =>
        `<option value="${k}" ${k === value ? "selected" : ""}>${label}</option>`,
    )
    .join("");
const day = () => today(state?.profile.timezone);
function toast(message) {
  const el = $("#toast");
  clearTimeout(toastTimer);
  el.textContent = message;
  el.hidden = false;
  toastTimer = setTimeout(() => (el.hidden = true), 6500);
}
function errorMessage(error) {
  return /fetch|timeout|network/i.test(error.message)
    ? tr("No pudimos conectar. Revisa Internet y vuelve a intentarlo.", "We couldn't connect. Check your Internet connection and try again.")
    : serverText(error.message) || tr("No pudimos guardar el cambio. Inténtalo nuevamente.", "We couldn't save the change. Please try again.");
}
function formError(form, error) {
  const el = $("[role=alert]", form);
  if (el) {
    el.textContent = errorMessage(error);
    el.hidden = false;
    // Sin créditos: lleva a Mi plan, donde se ganan (anuncios, invitaciones) o se compran.
    if (/créditos suficientes/.test(error.message)) {
      const link = document.createElement("a");
      link.href = "#subscription";
      link.textContent = tr(" Conseguir créditos →", " Get credits →");
      link.addEventListener("click", closeModal);
      el.append(link);
    }
  } else toast(errorMessage(error));
}
async function busy(button, action) {
  if (button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = tr("Guardando…", "Saving…");
  try {
    await action();
  } catch (error) {
    formError(button.closest("form") || button.parentElement, error);
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}
async function refresh() {
  const version = ++loadVersion;
  loading = true;
  if (!state) render();
  try {
    const next = await loadState();
    if (version !== loadVersion) return;
    state = next;
    loading = false;
    render();
    void checkLegal();
    void reminders.sync(user?.id, state);
    return true;
  } catch (error) {
    if (version !== loadVersion) return;
    loading = false;
    render();
    const panel = $("#page-error");
    if (panel) {
      panel.hidden = false;
      $("p", panel).textContent = errorMessage(error);
    }
    return false;
  }
}
async function saved(message) {
  closeModal();
  if (await refresh()) toast(message);
  else toast(tr("El cambio se guardó, pero no pudimos actualizar la vista. Vuelve a cargar tus datos.", "The change was saved, but we couldn't refresh the view. Reload your data."));
}
function modal(title, content) {
  closeModal();
  dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.setAttribute("aria-labelledby", "dialog-title");
  dialog.innerHTML = `<div class="modal-head"><h2 id="dialog-title">${e(title)}</h2><button class="icon-button" data-close aria-label="${tr("Cerrar", "Close")}">×</button></div>${content}`;
  document.body.append(dialog);
  $("[data-close]", dialog).onclick = closeModal;
  dialog.showModal();
  const current = dialog;
  dialog.addEventListener(
    "close",
    () => {
      current.remove();
      if (dialog === current) dialog = null;
    },
    { once: true },
  );
  return dialog;
}
function closeModal() {
  if (dialog) {
    const old = dialog;
    dialog = null;
    old.close();
    old.remove();
  }
}
const alert = () => '<p class="error" role="alert" hidden></p>';
function petCard() {
  const p = state.pet;
  return `<aside class="pet-card featured" id="pet" aria-labelledby="pet-name"><div class="pet-portrait">${portrait(p.stage)}</div><div class="pet-info">${lumiConversationMarkup()}<div class="pet-progress-summary"><p class="eyebrow">${tr("TU COMPAÑERA DE CADA PASO", "YOUR COMPANION FOR EVERY STEP")}</p><div class="pet-title"><h2 id="pet-name">${e(p.name)}</h2><span class="pet-level">${tr("Nivel", "Level")} ${p.level}</span></div><p class="pet-stage">${STAGES[p.stage - 1]} · ${p.total_xp} XP</p><progress aria-label="${tr("Experiencia de Lumi", "Lumi's experience")}" value="${p.next_xp === null ? 1 : p.level_xp}" max="${p.next_xp ?? 1}"></progress><p class="pet-xp-label">${p.next_xp === null ? tr("Evolución final alcanzada", "Final evolution reached") : tr(`${p.level_xp} / ${p.next_xp} XP para el siguiente nivel`, `${p.level_xp} / ${p.next_xp} XP to the next level`)}</p></div></div></aside>`;
}
function celebrate(result, before) {
  const p = result.pet;
  if (result.xp_delta > 0) {
    const evolved = p.stage > before.stage,
      levelled = p.level > before.level;
    companion.say(evolved ? "evolve" : levelled ? "level" : "completed");
    celebratePet(evolved ? "evolve" : levelled ? "level" : "happy");
    toast(
      evolved
        ? tr(`¡Lumi evolucionó! ${STAGES[p.stage - 1]}, nivel ${p.level}.`, `Lumi evolved! ${STAGES[p.stage - 1]}, level ${p.level}.`)
        : levelled
          ? tr(`¡Nivel ${p.level}! Cada paso cuenta.`, `Level ${p.level}! Every step counts.`)
          : tr(`¡Bien hecho! +${result.xp_delta} XP.`, `Well done! +${result.xp_delta} XP.`),
    );
  } else if (result.xp_delta < 0)
    toast(
      tr(`Acción reabierta. Se ajustaron ${-result.xp_delta} XP; puedes retomarla a tu ritmo.`, `Action reopened. ${-result.xp_delta} XP were adjusted; pick it up again at your own pace.`),
    );
}
const activeTask = (t) =>
  !t.goal_id ||
  state.goals.some((g) => g.id === t.goal_id && g.status === "active");
const liveTasks = () => state.tasks.filter((t) => t.status !== "cancelled");
function taskRow(t) {
  const goal = state.goals.find((g) => g.id === t.goal_id);
  return `<article class="task-row ${t.status === "completed" ? "done" : ""}"><button class="task-check" data-toggle-task="${t.id}" aria-label="${t.status === "completed" ? tr("Volver a pendiente", "Mark as pending") : tr("Completar", "Complete")}: ${e(t.title)}" aria-pressed="${t.status === "completed"}">${t.status === "completed" ? "✓" : ""}</button><div class="task-content"><strong>${e(t.title)}</strong><p>${e(goal?.title || t.area || tr("Acción independiente", "Standalone action"))} · ${t.minutes} min <span class="priority ${t.priority}">${PRIORITIES[t.priority]}</span></p>${t.deadline ? `<small>${tr("Fecha límite", "Deadline")}: ${dateLabel(t.deadline)}</small>` : ""}</div><button class="text-button" data-edit-task="${t.id}">${tr("Reprogramar / editar", "Reschedule / edit")}</button></article>`;
}
function goalCard(g) {
  const p = progress(liveTasks().filter((t) => t.goal_id === g.id));
  return `<article class="goal-card"><div class="card-top"><span class="tag">${CATEGORIES[g.category]}</span><span class="muted">${{ active: tr("Activa", "Active"), paused: tr("En pausa", "Paused"), achieved: tr("Alcanzada", "Achieved"), archived: tr("Archivada", "Archived") }[g.status]}</span></div><h3><button class="title-button" data-goal="${g.id}">${e(g.title)}</button></h3><p>${e(g.outcome || g.description)}</p><div class="progress-label"><span>${tr(`${p.done} de ${p.total} acciones`, `${p.done} of ${p.total} actions`)}</span><strong>${p.percent}%</strong></div><progress value="${p.percent}" max="100" aria-label="${tr("Acciones completadas de", "Completed actions of")} ${e(g.title)}"></progress><div class="card-foot"><span>${g.target_date ? `${tr("Objetivo", "Target")}: ${dateLabel(g.target_date)}` : tr("A tu ritmo", "At your own pace")}</span><button class="text-button" data-goal="${g.id}">${tr("Ver plan →", "View plan →")}</button></div></article>`;
}
function dashboard() {
  const goals = state.goals.filter((g) => g.status === "active"),
    tasks = liveTasks().filter(
      (t) => activeTask(t) && t.scheduled_date && t.scheduled_date <= day(),
    );
  const pending = tasks.filter((t) => t.status === "pending");
  return `<div class="page-heading"><div><p class="eyebrow">${tr("TU CAMINO", "YOUR PATH")}</p><h1>${tr(`Un paso a la vez, ${e(state.profile.name.split(" ")[0] || "a tu ritmo")}.`, `One step at a time, ${e(state.profile.name.split(" ")[0] || "at your own pace")}.`)}</h1><p class="muted">${tr("Tus metas tienen espacio aquí. Elige lo que puedes hacer hoy.", "Your goals have room here. Choose what you can do today.")}</p></div><button data-new-goal>${tr("+ Crear una meta", "+ Create a goal")}</button></div>${petCard()}<div class="overview"><div class="stat"><strong>${goals.length}</strong><span>${tr("metas activas", "active goals")}</span></div><div class="stat"><strong>${pending.length}</strong><span>${tr("acciones para hoy y por retomar", "actions for today and to catch up on")}</span></div><div class="stat"><strong>${liveTasks().filter((t) => t.status === "completed").length}</strong><span>${tr("pasos completados", "steps completed")}</span></div></div><section><div class="section-heading"><div><p class="eyebrow">${tr("¿QUÉ QUIERO LOGRAR?", "WHAT DO I WANT TO ACHIEVE?")}</p><h2>${tr("Mis metas", "My goals")}</h2></div><a href="#goals">${tr("Ver todas →", "See all →")}</a></div>${goals.length ? `<div class="goal-grid">${goals.slice(0, 4).map(goalCard).join("")}</div>` : `<div class="welcome"><h3>${tr("Tu primera meta puede empezar con una idea.", "Your first goal can start with an idea.")}</h3><p>${tr("Aprender un idioma, crear tu proyecto, preparar una carrera o encontrar un hábito que te haga bien.", "Learning a language, building your project, training for a race or finding a habit that does you good.")}</p><button data-new-goal>${tr("Crear mi primera meta", "Create my first goal")}</button></div>`}</section><div class="today-grid"><section class="panel"><div class="section-heading"><div><p class="eyebrow">${tr("¿QUÉ PUEDO HACER HOY?", "WHAT CAN I DO TODAY?")}</p><h2>${tr("Hoy", "Today")}</h2></div><button class="text-button" data-new-task>${tr("+ Acción", "+ Action")}</button></div>${
    tasks.length
      ? tasks
          .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
          .map(taskRow)
          .join("")
      : `<div class="empty"><p>${tr("Hoy hay espacio para elegir tu siguiente paso.", "Today there's room to choose your next step.")}</p><a href="#calendar">${tr("Organizar mi calendario →", "Organize my calendar →")}</a></div>`
  }${liveTasks().some((t) => t.status === "pending" && !t.scheduled_date) ? `<p class="muted">${tr(`Hay ${liveTasks().filter((t) => t.status === "pending" && !t.scheduled_date).length} acciones sin fecha. Puedes organizarlas desde <a href="#tasks">Acciones</a>.`, `There are ${liveTasks().filter((t) => t.status === "pending" && !t.scheduled_date).length} actions without a date. You can organize them from <a href="#tasks">Actions</a>.`)}</p>` : ""}</section><aside class="note"><h3>${tr("El progreso también es encontrar tu ritmo.", "Progress is also about finding your pace.")}</h3><p>${tr("La barra de cada meta cuenta sus acciones completadas. Tú decides cuándo el resultado que buscabas está alcanzado.", "Each goal's bar counts its completed actions. You decide when the result you wanted has been reached.")}</p><a href="#habits">${tr("Ver mis hábitos →", "See my habits →")}</a></aside></div>`;
}
function goalsPage() {
  return `<div class="page-heading"><div><p class="eyebrow">${tr("¿QUÉ QUIERO LOGRAR?", "WHAT DO I WANT TO ACHIEVE?")}</p><h1>${tr("Mis metas", "My goals")}</h1><p class="muted">${tr("Cada camino puede cambiar de ritmo.", "Every path can change its pace.")}</p></div><button data-new-goal>${tr("+ Crear una meta", "+ Create a goal")}</button></div>${
    ["active", "paused", "achieved", "archived"]
      .map((status) => {
        const items = state.goals.filter((g) => g.status === status);
        return items.length
          ? `<section><h2>${{ active: tr("En camino", "In progress"), paused: tr("En pausa", "Paused"), achieved: tr("Metas alcanzadas", "Achieved goals"), archived: tr("Archivo", "Archive") }[status]}</h2><div class="goal-grid">${items.map(goalCard).join("")}</div></section>`
          : "";
      })
      .join("") ||
    `<div class="welcome"><h2>${tr("¿Qué te gustaría lograr?", "What would you like to achieve?")}</h2><p>${tr("Empieza con una idea pequeña. Puedes organizarla tú o pedir ayuda a la IA.", "Start with a small idea. You can organize it yourself or ask the AI for help.")}</p><button data-new-goal>${tr("Crear una meta", "Create a goal")}</button></div>`
  }`;
}
function tasksPage() {
  return `<div class="page-heading"><div><h1>${tr("Mis acciones", "My actions")}</h1><p class="muted">${tr("Pequeños pasos, con una meta o por sí solos.", "Small steps, part of a goal or on their own.")}</p></div><button data-new-task>${tr("+ Crear acción", "+ Create action")}</button></div><section class="panel">${
    liveTasks()
      .sort((a, b) =>
        (a.scheduled_date || "9999").localeCompare(b.scheduled_date || "9999"),
      )
      .map(taskRow)
      .join("") ||
    `<p class="empty">${tr("Todavía no hay acciones. Añade una o crea un plan para tu meta.", "No actions yet. Add one or create a plan for your goal.")}</p>`
  }</section>`;
}
function calendarPage() {
  let start =
    new URLSearchParams(location.hash.split("?")[1]).get("date") || day();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) start = day();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start + "T12:00:00");
    d.setDate(d.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  return `<div class="page-heading"><div><h1>${tr("Un calendario con espacio", "A calendar with room to breathe")}</h1><p class="muted">${tr("La IA tiene en cuenta tus acciones y hábitos al proponer un plan.", "The AI takes your actions and habits into account when it proposes a plan.")}</p></div><button data-new-task>${tr("+ Acción", "+ Action")}</button></div><label class="date-picker">${tr("Ver desde", "Show from")} <input type="date" id="calendar-date" value="${start}"></label><div class="calendar-grid">${dates
    .map((date) => {
      const tasks = liveTasks().filter(
        (t) => t.scheduled_date === date && activeTask(t),
      );
      return `<section class="panel"><h2>${dateLabel(date)}</h2><p class="muted">${tasks.reduce((sum, t) => sum + t.minutes, 0)} ${tr("minutos en acciones", "minutes of actions")}</p>${tasks.map(taskRow).join("") || `<p class="empty">${tr("Espacio libre", "Free time")}</p>`}</section>`;
    })
    .join("")}</div>`;
}
function habitsPage() {
  const dow = new Date(day() + "T12:00:00").getDay();
  return `<div class="page-heading"><div><h1>${tr("Hábitos a tu ritmo", "Habits at your own pace")}</h1><p class="muted">${tr("Cada cumplimiento queda registrado por separado.", "Each time you do it is recorded separately.")}</p></div><button data-new-habit>${tr("+ Crear hábito", "+ Create habit")}</button></div>${
    state.habits
      .map((h) => {
        const done = state.completions.some(
          (c) => c.habit_id === h.id && c.day === day() && c.completed,
        );
        const history = state.completions
          .filter((c) => c.habit_id === h.id)
          .sort((a, b) => b.day.localeCompare(a.day));
        return `<section class="panel habit-card"><div class="section-heading"><div><h2>${e(h.title)}</h2><p class="muted">${h.minutes} min · ${h.days.map((d) => weekdays()[d]).join(", ")}${h.active ? "" : tr(" · En pausa", " · Paused")}</p></div><button class="secondary" data-edit-habit="${h.id}">${tr("Editar", "Edit")}</button></div>${h.active && h.days.includes(dow) ? `<button data-habit="${h.id}" data-completed="${!done}">${done ? tr("✓ Hecho hoy · deshacer", "✓ Done today · undo") : tr("Marcar hoy como hecho", "Mark today as done")}</button>` : ""}<details><summary>${tr("Historial", "History")} · ${history.filter((c) => c.completed).length} ${tr("cumplimientos", "times done")}</summary><ul>${history.map((c) => `<li>${dateLabel(c.day)} · ${c.completed ? tr("Completado", "Completed") : tr("Reabierto", "Reopened")}</li>`).join("") || `<li>${tr("Aquí aparecerán tus próximos pasos.", "Your next steps will show up here.")}</li>`}</ul></details></section>`;
      })
      .join("") ||
    `<div class="welcome"><h2>${tr("Lo pequeño también suma.", "Small things add up too.")}</h2><p>${tr("Leer diez minutos, practicar un idioma o reservar un rato para tu proyecto.", "Reading for ten minutes, practicing a language or setting aside time for your project.")}</p><button data-new-habit>${tr("Crear mi primer hábito", "Create my first habit")}</button></div>`
  }`;
}
// Abreviaturas de los días, de domingo (0) a sábado (6), como Date.getDay().
const weekdays = () =>
  tr("Dom Lun Mar Mié Jue Vie Sáb", "Sun Mon Tue Wed Thu Fri Sat").split(" ");
function daysInputs(selected, prefix = "days") {
  return `<fieldset><legend>${tr("Días disponibles", "Available days")}</legend><div class="days">${weekdays().map((label, i) => `<label><input type="checkbox" name="${prefix}" value="${i}" ${selected.includes(i) ? "checked" : ""}>${label}</label>`).join("")}</div></fieldset>`;
}
// Panel «Recordatorios» de Ajustes (sólo Android). El permiso se pide al encender el interruptor.
const remindersOff = () =>
  tr("Está apagado. Al encenderlo, el teléfono te pedirá permiso para mostrar avisos.", "It's off. When you turn it on, your phone will ask for permission to show notifications.");
function remindersPanel() {
  const on = reminders.isOn(user.id);
  return `<section class="panel" data-reminders><h2>${tr("Recordatorios", "Reminders")}</h2><p>${tr("Un aviso al día, a la hora que elijas, sólo los días en que tienes acciones o hábitos pendientes. El aviso dice cuántos pasos tienes, nunca los nombres de tus metas.", "One notification a day, at the time you choose, only on days when you have pending actions or habits. It says how many steps you have, never the names of your goals.")}</p><label><input type="checkbox" id="reminders-on" ${on ? "checked" : ""}> ${tr("Recordarme mis pasos del día", "Remind me of my steps for the day")}</label><form id="reminder-form"><label>${tr("Hora del aviso", "Notification time")}<input name="time" type="time" value="${reminderTime(state.profile.reminder_time)}" required></label><button class="secondary">${tr("Guardar hora", "Save time")}</button></form><p class="muted" data-reminders-note role="status">${on ? "" : remindersOff()}</p></section>`;
}
function remindersNote(status) {
  const note = $("[data-reminders-note]");
  if (!note) return;
  const on = reminders.isOn(user?.id);
  note.replaceChildren();
  // Permiso negado (o notificaciones apagadas en el teléfono): sólo se pueden volver a permitir allá.
  if (status?.available && status.permission === "denied") {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "text-button";
    open.textContent = tr("Abrir los ajustes del teléfono", "Open phone settings");
    open.onclick = () => void reminders.openSettings();
    note.append(
      on
        ? tr("Los recordatorios están encendidos, pero el teléfono no deja mostrarlos. ", "Reminders are on, but your phone isn't letting them show. ")
        : tr("Tu teléfono no está dejando que PlanifIA muestre avisos. ", "Your phone isn't letting PlanifIA show notifications. "),
      open,
    );
  } else if (status?.error)
    note.textContent = tr("No pudimos programar el aviso en este teléfono. Vuelve a intentarlo más tarde.", "We couldn't schedule the notification on this phone. Try again later.");
  else
    note.textContent = on
      ? tr("Encendido. El aviso puede llegar unos minutos después de la hora elegida.", "On. The notification may arrive a few minutes after the chosen time.")
      : status?.permission === "granted"
        ? tr("Está apagado.", "It's off.")
        : remindersOff();
}
function bindReminders() {
  const toggle = $("#reminders-on");
  if (!toggle) return;
  // El estado inicial puede llegar después de que la persona use el interruptor: entonces ya no vale.
  let changed = false;
  void reminders.status().then((status) => changed || remindersNote(status));
  toggle.addEventListener("change", async () => {
    changed = true;
    toggle.disabled = true;
    try {
      if (toggle.checked) {
        const status = await reminders.enable(user.id, state);
        toggle.checked = reminders.isOn(user.id);
        remindersNote(status);
        if (toggle.checked) toast(tr("Listo. Te avisaremos los días con pasos pendientes.", "Done. We'll remind you on days with pending steps."));
      } else {
        await reminders.disable(user.id);
        remindersNote(null);
      }
    } finally {
      if (toggle.isConnected) toggle.disabled = false;
    }
  });
  $("#reminder-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    busy($("button", form), async () => {
      await rpc("save_reminder_time", { p_time: form.time.value });
      await saved(tr("Hora del recordatorio guardada.", "Reminder time saved."));
    });
  });
}
function settingsPage() {
  const p = state.profile;
  return `<div class="page-heading"><div><h1>${tr("Tu ritmo y tus datos", "Your pace and your data")}</h1><p class="muted">${tr("Los cambios se guardan en tu cuenta y se recuperan en otros dispositivos.", "Changes are saved to your account and available on your other devices.")}</p></div></div><div class="settings-grid"><section class="panel" data-language-panel><h2>${tr("Idioma", "Language")}</h2><p>${tr("Elige el idioma de PlanifIA en este dispositivo. Lumi y las propuestas de la IA te responderán en ese idioma. Lo que ya escribiste o guardaste no se traduce.", "Choose PlanifIA's language on this device. Lumi and the AI proposals will answer you in that language. What you've already written or saved isn't translated.")}</p>${langToggle("lang-toggle-large")}</section><section class="panel pet-motion-panel"><h2>${tr("Lumi a tu ritmo", "Lumi at your pace")}</h2><p>${tr("Elige cómo te acompaña mientras organizas tus metas.", "Choose how Lumi keeps you company while you organize your goals.")}</p>${petMotionControls()}${lumiConversationSettings(companion)}</section><section class="panel"><h2>${tr("Disponibilidad", "Availability")}</h2><form id="profile-form"><label>${tr("Tu nombre", "Your name")}<input name="name" value="${e(p.name)}" maxlength="80" required></label><label>${tr("Zona horaria", "Time zone")}<input name="timezone" value="${e(p.timezone)}" required placeholder="America/Santiago"></label><label>${tr("Minutos totales por semana", "Total minutes per week")}<input name="minutes" type="number" min="30" max="3360" value="${p.weekly_minutes}" required></label>${daysInputs(p.available_days)}<p class="muted">${tr("La IA reparte este tiempo entre tus días disponibles, contando acciones y hábitos existentes.", "The AI spreads this time across your available days, counting your existing actions and habits.")}</p>${alert()}<button>${tr("Guardar disponibilidad", "Save availability")}</button></form></section>${reminders.available() ? remindersPanel() : ""}<section class="panel"><h2>${tr("Conservar lo que ya hiciste", "Keep what you've already done")}</h2><p>${tr("Importa un archivo JSON de PlanifIA anterior. Verás el destino y el contenido antes de confirmar.", "Import a JSON file from the previous PlanifIA. You'll see the destination and the content before confirming.")}</p><label class="file-label">${tr("Seleccionar exportación", "Choose export file")}<input type="file" id="import-file" accept="application/json,.json"></label><button class="secondary" id="import-local">${tr("Buscar tareas guardadas en este navegador", "Look for tasks saved in this browser")}</button><p class="muted">${tr("Los archivos originales se conservan. Repetir la importación no crea actividades duplicadas. La XP histórica se conserva en el respaldo original, sin asignar recompensas nuevas.", "Original files are kept. Importing again doesn't create duplicate activities. Past XP stays in the original backup, without granting new rewards.")}</p><h3>${tr("Importaciones guardadas", "Saved imports")}</h3>${state.imports.map((i) => `<p>${e(i.source)} <button class="text-button" data-export-import="${i.id}">${tr("Descargar original", "Download original")}</button></p>`).join("") || `<p class="muted">${tr("Todavía no hay importaciones.", "No imports yet.")}</p>`}<button class="secondary" id="export-data">${tr("Exportar mis datos", "Export my data")}</button></section>${isAndroidApp() ? `<section class="panel"><h2>${tr("Anuncios y privacidad", "Ads and privacy")}</h2><p>${tr('En el plan Gratis se muestra un video de Google AdMob al usar la IA (máximo uno cada 5 minutos). Plus, Pro y la compra "Quitar anuncios" no muestran videos.', 'On the Free plan, a Google AdMob video is shown when you use the AI (at most one every 5 minutes). Plus, Pro and the "Remove ads" purchase show no videos.')}</p>${ads.privacyRequired ? `<button class="secondary" id="ad-privacy">${tr("Opciones de privacidad de anuncios", "Ad privacy options")}</button>` : `<p class="muted">${tr("Puedes revisar tu consentimiento de anuncios aquí cuando tu región lo requiera.", "You can review your ad consent here when your region requires it.")}</p>`}</section>` : ""}<section class="panel" data-rights><h2>${tr("Tus derechos sobre tus datos", "Your rights over your data")}</h2><p>${tr("Puedes pedir acceso, rectificación, supresión, oposición, portabilidad o bloqueo de tus datos, y oponerte a decisiones tomadas sólo de forma automatizada. Aquí mismo puedes corregir tu perfil, exportar tus datos o eliminar tu cuenta; para lo demás escribe a", "You can request access, correction, deletion, objection, portability or blocking of your data, and object to decisions made solely by automated means. Right here you can correct your profile, export your data or delete your account; for anything else write to")} <a href="mailto:planifiaprivacity@gmail.com">planifiaprivacity@gmail.com</a>.</p>${legal?.owner === user.id && legal.latest ? `<p class="muted">${tr(`Aceptaste la versión del ${e(legalDateLabel(newerVersion(legal.latest.terms_version, legal.latest.privacy_version)))} de los Términos de uso y la Política de privacidad.`, `You accepted the ${e(legalDateLabel(newerVersion(legal.latest.terms_version, legal.latest.privacy_version)))} version of the Terms of Use and the Privacy Policy.`)}</p>` : ""}<p><a href="${LEGAL_URLS.terms}" target="_blank" rel="noopener noreferrer" data-external-link>${tr("Términos de uso", "Terms of Use")}</a> · <a href="${LEGAL_URLS.privacy}" target="_blank" rel="noopener noreferrer" data-external-link>${tr("Política de privacidad", "Privacy Policy")}</a></p></section><section class="panel danger-zone"><h2>${tr("Eliminar cuenta", "Delete account")}</h2><p>${tr("Borra de forma permanente tu cuenta y todos sus datos: metas, acciones, hábitos, Lumi, solicitudes de IA e importaciones. No se puede deshacer. Los registros técnicos que aún los contengan se borran solos en los plazos de la política de privacidad.", "Permanently deletes your account and all its data: goals, actions, habits, Lumi, AI requests and imports. This can't be undone. Technical logs that still contain them are deleted automatically within the periods set out in the privacy policy.")}</p><p class="muted">${tr("Te recomendamos exportar tus datos antes. Consulta la", "We recommend exporting your data first. See the")} <a href="${LEGAL_URLS.privacy}" target="_blank" rel="noopener noreferrer" data-external-link>${tr("política de privacidad", "privacy policy")}</a>.</p><button class="danger" id="delete-account">${tr("Eliminar mi cuenta", "Delete my account")}</button></section></div>`;
}
function shell(content) {
  const tab = location.hash.slice(1).split("?")[0] || "today";
  return `<div class="app-shell"><aside class="sidebar"><a href="#today">${logo()}</a><nav aria-label="${tr("Navegación principal", "Main navigation")}">${[
    ["today", tr("Hoy", "Today"), "☀"],
    ["goals", tr("Metas", "Goals"), "◎"],
    ["tasks", tr("Acciones", "Actions"), "✓"],
    ["calendar", tr("Calendario", "Calendar"), "▦", tr("Agenda", "Agenda")],
    ["habits", tr("Hábitos", "Habits"), "↻"],
    ["lumi", "Lumi", "✦"],
    ["subscription", tr("Mi plan", "My plan"), "◇"],
    ["settings", tr("Ajustes", "Settings"), "⚙"],
  ]
    .map(
      ([id, label, icon, short]) =>
        // En teléfonos angostos algunas pestañas usan un nombre corto para que quepan las 8.
        `<a href="#${id}" ${tab === id ? 'aria-current="page"' : ""} ${short ? `aria-label="${label}"` : ""}><span aria-hidden="true">${icon}</span>${short ? `<span class="nav-long">${label}</span><span class="nav-short" aria-hidden="true">${short}</span>` : label}</a>`,
    )
    .join(
      "",
    )}</nav><p>${tr("Tus metas, un plan claro<br>y un paso a la vez.", "Your goals, a clear plan<br>and one step at a time.")}</p></aside><div class="app-body"><header class="app-header"><span class="cloud-state">● ${tr("Tu espacio en la nube", "Your space in the cloud")}</span><div><button class="text-button" id="ai-jobs">${tr("Mis solicitudes de IA", "My AI requests")}</button>${langToggle()}<span>${e(state?.profile.name || user.email)}</span><button class="text-button" id="logout">${tr("Cerrar sesión", "Sign out")}</button></div></header><main id="main"><div class="error panel" id="page-error" role="alert" hidden><p></p><button id="retry-load">${tr("Volver a cargar", "Reload")}</button></div>${content}</main></div></div>`;
}
// Mismas piezas que el esqueleto de index.html (src/boot.css) mientras llegan las metas.
function loadingSkeleton() {
  const card =
    '<div class="boot-card"><span class="sk sk-tag"></span><span class="sk sk-name"></span><span class="sk sk-bar"></span><span class="sk sk-meta"></span></div>';
  return `<div class="boot" role="status"><span class="sr-only">${tr("Recuperando tus metas y tu progreso…", "Loading your goals and your progress…")}</span><div class="boot-lines" aria-hidden="true"><span class="sk sk-eyebrow"></span><span class="sk sk-title"></span><span class="sk sk-lead"></span><div class="boot-cards">${card.repeat(3)}</div></div></div>`;
}
function render() {
  disposeBilling?.();
  disposeBilling = null;
  disposePets();
  // El esqueleto de index.html pasa a #app mientras se recupera la sesión; al dibujar se descarta.
  const boot = document.getElementById("boot");
  if (!user && restoring) {
    if (boot && boot.parentElement !== app) app.replaceChildren(boot);
    return;
  }
  boot?.remove();
  if (!user) {
    landing();
    mountPets();
    return;
  }
  if (needsSignupConsent()) {
    signupConsentPage();
    return;
  }
  if (!state) {
    app.innerHTML = shell(
      loading
        ? loadingSkeleton()
        : `<div class="empty">${tr("No pudimos cargar tus datos.", "We couldn't load your data.")}</div>`,
    );
    bindShell();
    return;
  }
  renderedDay = day();
  // La dirección sólo elige una de estas vistas; cualquier otro valor muestra «Hoy». Un Map no hereda
  // propiedades: "#constructor" o "#toString" no llaman a nada inesperado (CodeQL).
  const views = new Map([
    ["today", dashboard],
    ["goals", goalsPage],
    ["tasks", tasksPage],
    ["calendar", calendarPage],
    ["habits", habitsPage],
    ["settings", settingsPage],
    ["lumi", () => lumiChatPage({ stage: state.pet.stage, name: state.profile.name, escape: e })],
    ["plans", () => renderBilling({ view: "plans", user, escape: e })],
    ["subscription", () => renderBilling({ view: "subscription", user, escape: e })],
  ]);
  const view = views.get(location.hash.slice(1).split("?")[0]);
  app.innerHTML = shell(typeof view === "function" ? view() : dashboard());
  aiJobs.start(user.id);
  bindShell();
  $("#ai-jobs").onclick = aiJobsDialog;
  updateAiBadge();
  bindActions();
  bindAdPrivacy();
  mountPets();
  mountBillingView();
  mountLumiChatView();
  startMonetization();
}
// Chat con Lumi: el saldo lo informa el servidor; los saludos y animaciones locales siguen gratis.
function mountLumiChatView() {
  lumiChat?.dispose();
  lumiChat = mountLumiChat(app, {
    companion,
    voice: companionVoice,
    credits: () =>
      monetization ? { balance: monetization.credits.balance, chat_cost: monetization.credits.chat_cost } : null,
    onCredits: (balance) => {
      if (monetization) monetization = { ...monetization, credits: { ...monetization.credits, balance } };
      void refreshMonetization().catch(() => {});
    },
    beforeSend: () => legalGate((card) => $("[data-lumi-chat-form]")?.before(card)),
  });
}
function bindAdPrivacy() {
  const button = $("#ad-privacy");
  if (button)
    button.onclick = () =>
      busy(button, () =>
        ads.privacyOptions().then(() => toast(tr("Tus preferencias de anuncios quedaron guardadas.", "Your ad preferences were saved."))),
      );
}
function landing() {
  const billingRoute = location.hash.slice(1).split("?")[0];
  if (["plans", "subscription"].includes(billingRoute)) {
    app.innerHTML = `<header class="landing-header"><a href="#home">${logo()}</a><div>${langToggle()}<a href="#home">${tr("Inicio", "Home")}</a><a class="button" href="#login">${tr("Iniciar sesión", "Sign in")}</a></div></header><main id="main">${renderBilling({ view: "plans", user, escape: e })}</main>`;
    mountBillingView();
    return;
  }
  app.innerHTML = `<header class="landing-header"><a href="#home">${logo()}</a><div>${langToggle()}<a href="#plans">${tr("Planes", "Plans")}</a><a href="#login">${tr("Iniciar sesión", "Sign in")}</a><a class="button" href="#register">${tr("Empezar", "Get started")}</a></div></header><main id="main"><section class="hero"><div><p class="eyebrow">${tr("DALE FORMA A LO QUE TE IMPORTA", "GIVE SHAPE TO WHAT MATTERS TO YOU")}</p><h1>${tr("Tus metas.<br>Un plan claro.<br><em>Un paso a la vez.</em>", "Your goals.<br>A clear plan.<br><em>One step at a time.</em>")}</h1><p>${tr("Convierte lo que quieres lograr en acciones que caben en tu vida. La IA te ayuda a dividir el camino; tú eliges el ritmo.", "Turn what you want to achieve into actions that fit your life. AI helps you break down the path; you choose the pace.")}</p><div class="hero-actions"><a class="button" href="#register">${tr("Crear mi primera meta →", "Create my first goal →")}</a><a href="#how">${tr("Cómo funciona", "How it works")}</a></div><p class="fine">${tr("Para proyectos, aprendizaje, bienestar y todo lo que empieza con una idea.", "For projects, learning, wellbeing and everything that starts with an idea.")}</p></div><div class="hero-example"><span class="example-label">${tr("UN EJEMPLO DE TU PRÓXIMO PASO", "AN EXAMPLE OF YOUR NEXT STEP")}</span><div class="example-goal"><span class="tag">${CATEGORIES.learning}</span><h2>${tr("Hablar inglés con más confianza", "Speak Spanish with more confidence")}</h2><p>${tr("Un camino en acciones pequeñas.", "A path made of small actions.")}</p><div class="example-action"><span>✓</span><div><strong>${tr("Practicar una presentación de 2 minutos", "Practice a 2-minute introduction")}</strong><p>${tr("Hoy · 15 minutos · A mi ritmo", "Today · 15 minutes · At my own pace")}</p></div></div></div><div class="hero-pet">${portrait(2)}<div><strong>${tr("Lumi crece contigo", "Lumi grows with you")}</strong><p>${tr("Cada acción completada suma experiencia.", "Every completed action adds experience.")}</p></div></div></div></section><section class="how" id="how"><p class="eyebrow">${tr("DEL «ALGÚN DÍA» AL SIGUIENTE PASO", "FROM “SOMEDAY” TO THE NEXT STEP")}</p><h2>${tr("Una idea tiene por dónde empezar.", "Every idea has somewhere to start.")}</h2><div class="three-columns"><article><span>01</span><h3>${tr("Cuenta qué quieres lograr", "Tell us what you want to achieve")}</h3><p>${tr("Tu punto de partida, el resultado que buscas y el tiempo que tienes.", "Where you're starting from, the result you're after and the time you have.")}</p></article><article><span>02</span><h3>${tr("Revisa un plan a tu medida", "Review a plan made for you")}</h3><p>${tr("La IA propone hitos, prioridades y acciones. Puedes editarlos antes de guardar.", "The AI suggests milestones, priorities and actions. You can edit them before saving.")}</p></article><article><span>03</span><h3>${tr("Avanza y ajusta el camino", "Move forward and adjust the path")}</h3><p>${tr("Organiza tu calendario, registra lo que haces y cambia el plan cuando lo necesites.", "Organize your calendar, track what you do and change the plan whenever you need to.")}</p></article></div></section><section class="examples"><h2>${tr("Un lugar para distintas metas.", "One place for all kinds of goals.")}</h2><div>${(lang() === "en" ? ["Learn a language", "Launch my project", "Train for a race", "Build a reading habit"] : ["Aprender un idioma", "Lanzar mi proyecto", "Preparar una carrera", "Crear un hábito de lectura"]).map((t) => `<button class="secondary" data-example="${e(t)}">${e(t)} ↗</button>`).join("")}</div></section>${missing.length ? `<section class="setup-note" role="status"><h2>${tr("La conexión con la nube está pendiente.", "The cloud connection is pending.")}</h2><p>${tr(`Falta configurar ${missing.map((x) => `<code>${x}</code>`).join(" y ")} y aplicar las migraciones de Supabase. El registro, tus datos y la IA se habilitarán al conectar el proyecto.`, `${missing.map((x) => `<code>${x}</code>`).join(" and ")} still need to be configured and the Supabase migrations applied. Sign-up, your data and the AI will be enabled once the project is connected.`)}</p></section>` : ""}<footer class="landing-footer"><p>${tr("PlanifIA · Un paso posible vale más que un plan imposible.", "PlanifIA · One possible step is worth more than an impossible plan.")}</p><nav aria-label="${tr("Información legal", "Legal information")}"><a href="${LEGAL_PAGES.privacy}">${tr("Privacidad", "Privacy")}</a><a href="${LEGAL_PAGES.terms}">${tr("Términos", "Terms")}</a><a href="${LEGAL_PAGES.deletion}">${tr("Eliminar cuenta", "Delete account")}</a></nav></footer></main>`;
  document.querySelectorAll("[data-example]").forEach(
    (b) =>
      (b.onclick = () => {
        location.hash = "register";
      }),
  );
  // Se consulta antes de abrir el formulario para que el botón de Google no aparezca con un salto.
  if (cloud && googleSignInMode(GOOGLE_WEB_CLIENT_ID)) void loadAuthSettings();
  const form = AUTH_FORMS.get(location.hash.slice(1));
  if (form) authModal(form);
}
// Formularios de acceso. La dirección sólo elige cuál se muestra (#login, #register o #reset); qué
// hace cada uno lo fija esta tabla, no una comparación con la dirección. Supabase valida cada acción.
const AUTH_FORMS = new Map([
  ["login", { register: false, reset: false }],
  ["register", { register: true, reset: false }],
  ["reset", { register: false, reset: true }],
]);
/** Muestra el error que Supabase dejó en el enlace al volver, y lo quita de la dirección. */
function showAuthReturn(signedIn) {
  if (!authReturn) return;
  const message = authReturnMessage(authReturn);
  authReturn = null;
  history.replaceState(history.state, "", `${location.pathname}${location.search}${signedIn ? "" : "#login"}`);
  if (signedIn) {
    toast(message);
    return;
  }
  authNotice = message;
  render();
}
function authModal(form) {
  const { register, reset } = form;
  const host = modal(
    reset
      ? tr("Una nueva contraseña", "A new password")
      : register
        ? tr("Empieza tu camino", "Start your journey")
        : tr("Qué bueno verte", "Good to see you"),
    `<p class="muted">${reset ? tr("Escribe tu nueva contraseña.", "Type your new password.") : register ? tr("Tus metas y Lumi te esperan en cualquier dispositivo.", "Your goals and Lumi are waiting for you on any device.") : tr("Vuelve a tu siguiente paso.", "Get back to your next step.")}</p>${reset ? "" : googleBlock(register)}<form id="auth-form">${register ? `<label>${tr("Tu nombre", "Your name")}<input name="name" autocomplete="name" maxlength="80" required></label>` : ""}${!reset ? `<label>${tr("Correo electrónico", "Email")}<input name="email" type="email" autocomplete="email" required></label>` : ""}<label>${tr("Contraseña", "Password")}<input name="password" type="password" autocomplete="${register || reset ? "new-password" : "current-password"}" ${register || reset ? `minlength="10" pattern="(?=.*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])(?=.*[0-9]).{10,}" title="${tr("Al menos 10 caracteres, con letras y números.", "At least 10 characters, with letters and numbers.")}" aria-describedby="password-hint"` : `minlength="8"`} required></label>${register || reset ? `<p class="fine" id="password-hint">${tr("Al menos 10 caracteres, con letras y números.", "At least 10 characters, with letters and numbers.")}</p>` : ""}${register ? legalConsentMarkup() : ""}${alert()}<button>${reset ? tr("Guardar contraseña", "Save password") : register ? tr("Crear cuenta", "Create account") : tr("Iniciar sesión", "Sign in")}</button></form>${!register && !reset ? `<button class="text-button" id="forgot">${tr("Olvidé mi contraseña", "I forgot my password")}</button>` : ""}<p>${register ? `<a href="#login">${tr("Ya tengo una cuenta", "I already have an account")}</a>` : `<a href="#register">${tr("Crear una cuenta", "Create an account")}</a>`}</p>`,
  );
  bindGoogleSignIn(host);
  if (authNotice && !reset) {
    const problem = $("#auth-form [role=alert]", host);
    problem.textContent = authNotice;
    problem.hidden = false;
  }
  // Crear cuenta queda deshabilitado hasta marcar la casilla de edad y aceptación (sin marcar al abrir).
  const consent = $("[data-legal-consent]", host);
  if (consent) {
    const submit = $("#auth-form button", host);
    submit.disabled = true;
    consent.addEventListener("change", () => (submit.disabled = !consent.checked));
  }
  $("#auth-form", host).onsubmit = (event) => {
    event.preventDefault();
    authNotice = "";
    const form = event.currentTarget;
    if (consent && !consent.checked) return;
    busy($("button", form), async () => {
      if (!cloud)
        throw new Error(tr(`Falta conectar Supabase: ${missing.join(", ")}.`, `Supabase isn't connected yet: ${missing.join(", ")}.`));
      const fields = Object.fromEntries(new FormData(form));
      if (reset) {
        await checked(cloud.auth.updateUser({ password: fields.password }));
        await saved(tr("Contraseña actualizada.", "Password updated."));
        return;
      }
      if (register) {
        const data = await checked(
          cloud.auth.signUp({
            email: fields.email,
            password: fields.password,
            options: {
              // El servidor registra la aceptación con su propia fecha y hora (trigger de signup).
              data: { name: fields.name, legal: signupLegal(platformName()) },
              emailRedirectTo: authRedirect(),
            },
          }),
        );
        if (!data.session) {
          closeModal();
          toast(
            tr("Revisa tu correo para confirmar la cuenta. Después podrás iniciar sesión.", "Check your email to confirm your account. Then you'll be able to sign in."),
          );
          return;
        }
      } else
        await checked(
          cloud.auth.signInWithPassword({
            email: fields.email,
            password: fields.password,
          }),
        );
      closeModal();
      const session = await checked(cloud.auth.getSession());
      user = session.session?.user;
      location.hash = billingDestination();
      await refresh();
    });
  };
  $("#forgot", host)?.addEventListener("click", () => {
    const email = $("[name=email]", host).value;
    if (!email) {
      toast(tr("Escribe tu correo para recibir el enlace.", "Type your email to get the link."));
      return;
    }
    busy($("#forgot", host), async () => {
      if (!cloud) throw new Error(tr("Falta conectar Supabase.", "Supabase isn't connected yet."));
      await checked(
        cloud.auth.resetPasswordForEmail(email, {
          // Sin "#reset": Supabase agrega su propio fragmento (type=recovery) y supabase-js avisa con
          // PASSWORD_RECOVERY, que abre el formulario de la contraseña nueva.
          redirectTo: authRedirect(),
        }),
      );
      toast(
        tr("Si existe la cuenta, recibirás un enlace para cambiar la contraseña.", "If the account exists, you'll get a link to change your password."),
      );
    });
  });
}
// Logotipo «G» de Google, como piden sus pautas para el botón de inicio de sesión.
const GOOGLE_ICON =
  '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
// Va fuera del formulario de correo, que sigue igual. Oculto hasta confirmar que Google está activo.
function googleBlock(register) {
  return `<div class="google-auth" data-google-auth hidden><button type="button" class="google-button" data-google-signin>${GOOGLE_ICON}<span>${tr("Continuar con Google", "Continue with Google")}</span></button>${register ? `<p class="fine">${tr("Si es tu primera vez, antes de empezar te pediremos confirmar tu edad y aceptar los términos.", "If it's your first time, before you start we'll ask you to confirm your age and accept the terms.")}</p>` : ""}${alert()}<p class="auth-divider">${tr("o con tu correo", "or with your email")}</p></div>`;
}
function bindGoogleSignIn(host) {
  const box = $("[data-google-auth]", host);
  const mode = cloud ? googleSignInMode(GOOGLE_WEB_CLIENT_ID) : null;
  if (!box || !mode) return;
  void loadAuthSettings().then((settings) => {
    if (settings?.external?.google === true && box.isConnected) box.hidden = false;
  });
  const button = $("[data-google-signin]", box),
    problem = $("[role=alert]", box);
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    authNotice = "";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    problem.hidden = true;
    try {
      if (mode === "web") {
        // Lleva a Google; al volver, la sesión llega en el enlace y la recupera supabase-js.
        await signInWithGoogleWeb({ auth: cloud.auth, redirectTo: authRedirect() });
        return;
      }
      const session = await signInWithGoogleNative({ auth: cloud.auth, clientId: GOOGLE_WEB_CLIENT_ID });
      // Canceló en la ventana de Google: sigue en el formulario, sin mensaje de error.
      if (!session) return;
      closeModal();
      user = session.user;
      location.hash = billingDestination();
      await refresh();
    } catch (error) {
      problem.textContent = errorMessage(error);
      problem.hidden = false;
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    }
  });
}
const confirmWord = () => tr("ELIMINAR", "DELETE");
function deleteAccountForm() {
  const form = $(
    "form",
    modal(
      tr("Eliminar tu cuenta", "Delete your account"),
      `<form><p>${tr(`Se borrarán permanentemente tu cuenta (${e(user.email)}) y todos tus datos de PlanifIA. Esta acción no se puede deshacer.`, `Your account (${e(user.email)}) and all your PlanifIA data will be permanently deleted. This can't be undone.`)}</p><p class="muted">${tr("Perderás tus créditos. Si tienes una suscripción de Google Play, cancélala también en Google Play para que no se renueve. Puedes exportar tus datos antes desde Ajustes.", "You'll lose your credits. If you have a Google Play subscription, also cancel it in Google Play so it doesn't renew. You can export your data first from Settings.")}</p><label>${tr(`Escribe ${confirmWord()} para confirmar`, `Type ${confirmWord()} to confirm`)}<input name="confirm" autocomplete="off" required pattern="${confirmWord()}"></label><p class="error" role="alert" hidden></p><div class="actions"><button type="button" class="secondary" data-cancel>${tr("Cancelar", "Cancel")}</button><button class="danger">${tr("Eliminar definitivamente", "Delete permanently")}</button></div></form>`,
    ),
  );
  $("[data-cancel]", form).onclick = closeModal;
  form.onsubmit = (event) => {
    event.preventDefault();
    busy($("button.danger", form), async () => {
      // El servidor exige la palabra en español; en inglés se escribe DELETE y se envía su equivalente.
      const typed = form.confirm.value.trim();
      await rpc("delete_my_account", { p_confirm: typed === confirmWord() ? "ELIMINAR" : typed });
      reminders.forget(user.id);
      await reminders.stop();
      await cloud.auth.signOut({ scope: "local" }).catch(() => {});
      user = null;
      state = null;
      loadVersion++;
      closeModal();
      location.hash = "home";
      render();
      toast(tr("Tu cuenta y tus datos fueron eliminados.", "Your account and your data were deleted."));
    });
  };
}
function bindShell() {
  $("#logout")?.addEventListener("click", (event) =>
    busy(event.currentTarget, async () => {
      await checked(cloud.auth.signOut());
      user = null;
      state = null;
      loadVersion++;
      closeModal();
      location.hash = "home";
      render();
    }),
  );
  $("#retry-load")?.addEventListener("click", refresh);
}
function bindActions() {
  document
    .querySelectorAll("[data-new-goal]")
    .forEach((b) => (b.onclick = () => goalForm()));
  document
    .querySelectorAll("[data-new-task]")
    .forEach((b) => (b.onclick = () => taskForm()));
  document
    .querySelectorAll("[data-goal]")
    .forEach((b) => (b.onclick = () => goalDetail(b.dataset.goal)));
  document
    .querySelectorAll("[data-edit-task]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          taskForm(state.tasks.find((t) => t.id === b.dataset.editTask))),
    );
  document.querySelectorAll("[data-toggle-task]").forEach(
    (b) =>
      (b.onclick = () =>
        busy(b, async () => {
          const task = state.tasks.find((t) => t.id === b.dataset.toggleTask),
            before = state.pet,
            m = state.milestones.find((m) => m.id === task.milestone_id);
          const oldMilestone = m
            ? progress(liveTasks().filter((t) => t.milestone_id === m.id))
                .percent
            : 0;
          b.dataset.requestId ||= uuid();
          const result = await rpc("set_task_status", {
            p_id: task.id,
            p_status: task.status === "completed" ? "pending" : "completed",
            p_request_id: b.dataset.requestId,
          });
          const openGoal = dialog?.dataset.goalId;
          await refresh();
          if (openGoal) goalDetail(openGoal);
          celebrate(result, before);
          if (
            m &&
            oldMilestone < 100 &&
            progress(liveTasks().filter((t) => t.milestone_id === m.id))
              .percent === 100
          ) {
            celebratePet();
            companion.say("milestone");
            toast(tr(`¡Hito completado: ${m.title}! Un paso más en tu camino.`, `Milestone completed: ${m.title}! One more step on your path.`));
          }
        })),
  );
  $("#calendar-date")?.addEventListener(
    "change",
    (event) => (location.hash = "calendar?date=" + event.target.value),
  );
  document
    .querySelectorAll("[data-new-habit]")
    .forEach((b) => (b.onclick = () => habitForm()));
  document
    .querySelectorAll("[data-edit-habit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          habitForm(state.habits.find((h) => h.id === b.dataset.editHabit))),
    );
  document.querySelectorAll("[data-habit]").forEach(
    (b) =>
      (b.onclick = () =>
        busy(b, async () => {
          const before = state.pet;
          b.dataset.requestId ||= uuid();
          // Se calcula al tocar, no al dibujar: si pasó la medianoche, "hecho" se refiere a ayer.
          const today = day();
          const done = state.completions.some(
            (c) => c.habit_id === b.dataset.habit && c.day === today && c.completed,
          );
          const result = await rpc("set_habit_completion", {
            p_id: b.dataset.habit,
            p_day: today,
            p_completed: !done,
            p_request_id: b.dataset.requestId,
          });
          await refresh();
          celebrate(result, before);
        })),
  );
  $("#profile-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      fields = new FormData(form);
    busy($("button", form), async () => {
      await rpc("save_profile", {
        p_name: fields.get("name"),
        p_timezone: fields.get("timezone"),
        p_minutes: Number(fields.get("minutes")),
        p_days: fields.getAll("days").map(Number),
      });
      await saved(
        tr("Disponibilidad guardada. Puedes pedir un ajuste de tus metas cuando quieras.", "Availability saved. You can ask for an adjustment to your goals whenever you want."),
      );
    });
  });
  $("#import-file")?.addEventListener("change", async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 5000000)
        throw new Error(tr("El archivo debe ocupar menos de 5 MB.", "The file must be smaller than 5 MB."));
      importPreview(normalizeLegacy(JSON.parse(await file.text())));
    } catch (error) {
      toast(errorMessage(error));
    }
  });
  $("#import-local")?.addEventListener("click", () => {
    try {
      const data = {
        sourceId: "browser:" + location.origin,
        tareas: JSON.parse(
          localStorage.getItem("planifia-tareas") ||
            localStorage.getItem("planifia-tasks") ||
            "[]",
        ),
        evaluaciones: JSON.parse(
          localStorage.getItem("planifia-evaluaciones") || "[]",
        ),
      };
      importPreview(normalizeLegacy(data));
    } catch (error) {
      toast(
        error.message +
          tr(" Los datos de otros dominios se importan con un archivo exportado.", " Data from other websites is imported with an exported file."),
      );
    }
  });
  $("#delete-account")?.addEventListener("click", deleteAccountForm);
  bindReminders();
  $("#export-data")?.addEventListener("click", (event) => busy(event.currentTarget, exportData));
  document.querySelectorAll("[data-export-import]").forEach(
    (b) =>
      (b.onclick = () =>
        busy(b, async () => {
          const data = await checked(
            cloud
              .from("imports")
              .select("original")
              .eq("id", b.dataset.exportImport)
              .single(),
          );
          await downloadJson("planifia-original.json", data.original);
        })),
  );
}
function goalForm(goal = null) {
  const g = goal || {
    title: "",
    current_situation: "",
    outcome: "",
    description: "",
    category: "personal",
    weekly_minutes: Math.min(180, state.profile.weekly_minutes),
    target_date: "",
  };
  const host = modal(
    goal ? tr("Editar mi meta", "Edit my goal") : tr("¿Qué quieres lograr?", "What do you want to achieve?"),
    `<form id="goal-form"><label>${tr("Mi idea o meta", "My idea or goal")}<textarea name="title" rows="2" maxlength="160" required placeholder="${tr("Quiero hablar inglés con más confianza", "I want to speak Spanish with more confidence")}">${e(g.title)}</textarea></label><label>${tr("Mi punto de partida", "Where I'm starting from")}<textarea name="current_situation" maxlength="2000" placeholder="${tr("Qué haces ahora y qué te cuesta", "What you do now and what you find hard")}">${e(g.current_situation)}</textarea></label><label>${tr("El resultado que quiero ver", "The result I want to see")}<textarea name="outcome" maxlength="1000" placeholder="${tr("Por ejemplo, mantener una conversación de 10 minutos", "For example, holding a 10-minute conversation")}">${e(g.outcome)}</textarea></label><label>${tr("Área", "Area")}<select name="category">${options(CATEGORIES, g.category)}</select></label><div class="form-grid"><label>${tr("Minutos por semana para esta meta", "Minutes per week for this goal")}<input name="weekly_minutes" type="number" min="30" max="${state.profile.weekly_minutes}" value="${g.weekly_minutes}" required></label><label>${tr("Fecha objetivo · opcional", "Target date · optional")}<input name="target_date" type="date" value="${g.target_date || ""}"></label></div>${goal ? `<label>${tr("Descripción de la meta", "Goal description")}<textarea name="description" maxlength="3000">${e(g.description)}</textarea></label>` : ""}${goal ? `<label>${tr("¿Qué cambió para ajustar el plan?", "What changed that you want to adjust the plan?")}<textarea name="reason" maxlength="1000" placeholder="${tr("Tengo menos tiempo o quiero cambiar el enfoque", "I have less time or I want to change the focus")}"></textarea></label>` : ""}<p class="muted">${tr(`La IA tendrá en cuenta tus ${state.profile.weekly_minutes} minutos semanales y las acciones que ya tienes. Revisarás la propuesta antes de guardarla. Es una sugerencia automática: puede equivocarse y no reemplaza consejo médico, psicológico, legal ni financiero.`, `The AI will take into account your ${state.profile.weekly_minutes} weekly minutes and the actions you already have. You'll review the proposal before saving it. It's an automatic suggestion: it can be wrong and it doesn't replace medical, psychological, legal or financial advice.`)}</p>${alert()}<div class="actions"><button type="button" id="ai-plan">${tr("✦ Proponer un plan con IA", "✦ Suggest a plan with AI")}</button><button class="secondary">${goal ? tr("Guardar meta", "Save goal") : tr("Crear sin IA", "Create without AI")}</button></div><p class="fine credit-hint" data-credit-hint>${e(creditHint())}</p></form>`,
  );
  const form = $("#goal-form", host);
  form.onsubmit = (event) => {
    event.preventDefault();
    if (host.classList.contains("is-generating")) return;
    busy($("button[type=submit],button.secondary", form), async () => {
      const fields = Object.fromEntries(new FormData(form));
      fields.weekly_minutes = Number(fields.weekly_minutes);
      delete fields.reason;
      await rpc("save_goal", {
        p_data: { ...fields, description: fields.description ?? g.description },
        p_id: goal?.id || null,
        p_request_id: requestId(form),
      });
      await saved(
        goal
          ? tr("Meta actualizada.", "Goal updated.")
          : tr("Meta creada. Puedes añadir tus primeras acciones.", "Goal created. You can add your first actions."),
      );
    });
  };
  const showCrisis = () => {
    form.querySelector("[data-crisis-help]")?.remove();
    const help = crisisHelp();
    $(".actions", form).before(help);
    help.scrollIntoView?.({ block: "nearest" });
  };
  $("#ai-plan", host).onclick = () => {
    if (host.classList.contains("is-generating")) return;
    if (!form.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(form));
    const button = $("#ai-plan", host);
    form.querySelector("[data-crisis-help]")?.remove();
    // Una meta que describe una crisis no se envía a la IA: se muestran líneas de ayuda.
    if (detectCrisis(fields.title, fields.current_situation, fields.outcome, fields.description, fields.reason)) {
      showCrisis();
      return;
    }
    if (needsLegal()) {
      void legalGate((card) => form.before(card)).then((ok) => ok && host.isConnected && button.click());
      return;
    }
    const accountId = user.id;
    busy(button, async () => {
      const previousError = $("[role=alert]", form);
      previousError.hidden = true;
      previousError.textContent = "";
      const waiting = startPlanLoading(host, form, state.pet.stage);
      let unsubscribe, finishView;
      host.addEventListener(
        "close",
        () => {
          unsubscribe?.();
          waiting.dispose();
          finishView?.();
        },
        { once: true },
      );
      try {
        const response = await generatePlan({
          ...fields,
          idea: fields.title,
          weekly_minutes: Number(fields.weekly_minutes),
          goal_id: goal?.id || null,
          // La propuesta llega en el idioma de la app (el servidor acepta "es" o "en").
          language: aiLanguage(),
        });
        aiJobs.refresh();
        void refreshMonetization().catch(() => {});
        // Plan Gratis: un video mientras la IA trabaja (máx. uno cada 5 min; nunca en el primer plan).
        // Al cerrarlo se ofrece quitar los videos para siempre.
        void ads
          .aiVideo({ firstTime: !goal?.id && state.goals.length === 0 })
          .then((shown) => shown && offerAdFree())
          .catch(() => {});
        if (!waiting.isActive() || user?.id !== accountId) return;
        await new Promise((resolve) => {
          finishView = resolve;
          unsubscribe = aiJobs.watch(response.job.id, (job) => {
            if (!waiting.isActive() || user?.id !== accountId) {
              unsubscribe?.();
              resolve();
              return;
            }
            waiting.update(job, (id) => aiJobs.cancel(id));
            if (terminalJob(job)) {
              unsubscribe?.();
              waiting.dispose();
              resolve();
              // Un error o una cancelación devuelve los créditos: se actualiza el saldo.
              if (job.status !== "completed") void refreshMonetization().catch(() => {});
              if (job.status === "completed") {
                releaseAiRequest(job.request_id);
                proposalEditor({ ...job.result, job_id: job.id });
              } else {
                releaseAiRequest(job.request_id);
                formError(form, new Error(jobDescription(job)));
              }
            }
          });
        });
        unsubscribe?.();
      } catch (error) {
        waiting.dispose();
        if (error.crisis && host.isConnected) {
          showCrisis();
          return;
        }
        if (host.isConnected && host.open && user?.id === accountId)
          throw error;
      }
    });
  };
}
function goalDetail(id) {
  const goal = state.goals.find((g) => g.id === id),
    tasks = liveTasks().filter((t) => t.goal_id === id),
    p = progress(tasks);
  const host = modal(
    goal.title,
    `<p>${e(goal.description)}</p><p><strong>${tr("El resultado que busco:", "The result I'm after:")}</strong> ${e(goal.outcome || tr("Puedes concretarlo al editar la meta.", "You can define it when you edit the goal."))}</p><p class="muted">${tr(`${p.done} de ${p.total} acciones completadas (${p.percent}%). Completar acciones y alcanzar el resultado son dos cosas que tú puedes comprobar.`, `${p.done} of ${p.total} actions completed (${p.percent}%). Completing actions and reaching the result are two things you can check for yourself.`)}</p><div class="actions"><button id="adjust">${tr("✦ Revisar / ajustar con IA", "✦ Review / adjust with AI")}</button><button class="secondary" id="edit-goal">${tr("Editar meta", "Edit goal")}</button></div>${state.milestones
      .filter((m) => m.goal_id === id)
      .sort((a, b) => a.position - b.position)
      .map((m) => {
        const children = tasks.filter((t) => t.milestone_id === m.id);
        return `<section class="milestone"><h3>${e(m.title)}</h3>${children.map(taskRow).join("") || `<p class="muted">${tr("Hito del historial, sin acciones activas.", "Milestone from your history, with no active actions.")}</p>`}</section>`;
      })
      .join("")}${tasks
      .filter((t) => !t.milestone_id)
      .map(taskRow)
      .join(
        "",
      )}<div class="actions"><button class="secondary" id="add-goal-task">${tr("+ Acción para esta meta", "+ Action for this goal")}</button><button class="secondary" id="add-milestone">${tr("+ Crear hito", "+ Create milestone")}</button></div><div class="actions goal-status"><button id="achieve">${tr("Confirmar que logré mi meta", "Confirm I reached my goal")}</button><button class="secondary" id="pause">${goal.status !== "active" ? tr("Retomar meta", "Resume goal") : tr("Pausar meta", "Pause goal")}</button><button class="text-button" id="archive">${tr("Archivar", "Archive")}</button></div>`,
  );
  host.dataset.goalId = id;
  $("#add-milestone", host).onclick = () => milestoneForm(goal);
  $("#adjust", host).onclick = () => goalForm(goal);
  $("#edit-goal", host).onclick = () => goalForm(goal);
  $("#add-goal-task", host).onclick = () => taskForm(null, id);
  $("#pause", host).onclick = (event) =>
    busy(event.currentTarget, async () => {
      await rpc("set_goal_status", {
        p_id: id,
        p_status: goal.status !== "active" ? "active" : "paused",
      });
      await saved(tr("El ritmo de tu meta se actualizó.", "Your goal's pace was updated."));
    });
  $("#archive", host).onclick = () =>
    confirmStatus(
      goal,
      "archived",
      tr("Archivar conserva la meta y su historial. Podrás consultarla y retomarla desde el archivo.", "Archiving keeps the goal and its history. You can look at it and resume it from the archive."),
    );
  $("#achieve", host).onclick = () =>
    confirmStatus(
      goal,
      "achieved",
      tr("Tú decides si alcanzaste el resultado que buscabas, aunque todavía queden acciones. ¿Quieres marcar esta meta como alcanzada?", "You decide whether you reached the result you wanted, even if there are actions left. Do you want to mark this goal as achieved?"),
    );
  bindActions();
}
function confirmStatus(goal, status, message) {
  const host = modal(
    status === "achieved"
      ? tr("Reconoce lo que lograste", "Recognize what you achieved")
      : tr("Conservar en el archivo", "Keep it in the archive"),
    `<p>${e(message)}</p>${alert()}<button id="confirm-status">${status === "achieved" ? tr("Sí, alcancé mi meta", "Yes, I reached my goal") : tr("Archivar meta", "Archive goal")}</button>`,
  );
  $("#confirm-status", host).onclick = (event) =>
    busy(event.currentTarget, async () => {
      await rpc("set_goal_status", { p_id: goal.id, p_status: status });
      await saved(
        status === "achieved"
          ? tr("¡Meta alcanzada! Date un momento para reconocer este paso.", "Goal achieved! Take a moment to recognize this step.")
          : tr("Meta archivada. Su historial sigue contigo.", "Goal archived. Its history stays with you."),
      );
      if (status === "achieved") {
        celebratePet();
        companion.say("goal");
      }
    });
}
function milestoneForm(goal) {
  const host = modal(
    tr("Un hito en tu camino", "A milestone on your path"),
    `<form><label>${tr("Qué quiero completar en esta etapa", "What I want to complete in this stage")}<input name="title" maxlength="160" required placeholder="${tr("Por ejemplo, mi primer prototipo", "For example, my first prototype")}"></label>${alert()}<button>${tr("Guardar hito", "Save milestone")}</button></form>`,
  );
  $("form", host).onsubmit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    busy($("button", form), async () => {
      await rpc("save_milestone", {
        p_goal_id: goal.id,
        p_title: $("[name=title]", form).value,
        p_id: null,
        p_request_id: requestId(form),
      });
      await saved(tr("Hito guardado. Puedes vincularle tus próximas acciones.", "Milestone saved. You can link your next actions to it."));
      goalDetail(goal.id);
    });
  };
}
function taskForm(task = null, goalId = null) {
  const t = task || {
    title: "",
    description: "",
    area: "",
    priority: "medium",
    goal_id: goalId,
    scheduled_date: day(),
    deadline: null,
    minutes: 30,
  };
  const host = modal(
    task ? tr("Una acción que encaje mejor", "An action that fits better") : tr("Mi siguiente acción", "My next action"),
    `<form id="task-form"><label>${tr("Acción", "Action")}<input name="title" maxlength="160" value="${e(t.title)}" required></label><label>${tr("Detalles", "Details")}<textarea name="description" maxlength="3000">${e(t.description)}</textarea></label><label>${tr("Meta", "Goal")}<select name="goal_id"><option value="">${tr("Acción independiente", "Standalone action")}</option>${state.goals.map((g) => `<option value="${g.id}" ${g.id === t.goal_id ? "selected" : ""}>${e(g.title)}</option>`).join("")}</select></label><label>${tr("Hito · opcional", "Milestone · optional")}<select name="milestone_id"><option value="">${tr("Sin hito", "No milestone")}</option>${state.milestones
      .filter((m) => m.goal_id === t.goal_id)
      .map(
        (m) =>
          `<option value="${m.id}" ${m.id === t.milestone_id ? "selected" : ""}>${e(m.title)}</option>`,
      )
      .join(
        "",
      )}</select></label><label>${tr("Área · opcional", "Area · optional")}<input name="area" value="${e(t.area)}" maxlength="80"></label><div class="form-grid"><label>${tr("Hacer el", "Do it on")}<input name="scheduled_date" type="date" value="${t.scheduled_date || ""}"></label><label>${tr("Fecha límite · opcional", "Deadline · optional")}<input name="deadline" type="date" value="${t.deadline || ""}"></label><label>${tr("Minutos", "Minutes")}<input name="minutes" type="number" min="5" max="${Math.max(480, t.minutes)}" value="${t.minutes}" required></label><label>${tr("Prioridad", "Priority")}<select name="priority">${options(PRIORITIES, t.priority)}</select></label></div>${alert()}<div class="actions"><button>${tr("Guardar acción", "Save action")}</button>${task ? `<button type="button" class="text-button" id="cancel-task">${tr("Retirar del plan", "Remove from plan")}</button>` : ""}</div></form>`,
  );
  const form = $("#task-form", host);
  $("[name=goal_id]", form).onchange = (event) => {
    $("[name=milestone_id]", form).innerHTML =
      `<option value="">${tr("Sin hito", "No milestone")}</option>` +
      state.milestones
        .filter((m) => m.goal_id === event.target.value)
        .map((m) => `<option value="${m.id}">${e(m.title)}</option>`)
        .join("");
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    busy($("button", form), async () => {
      const fields = Object.fromEntries(new FormData(form));
      fields.minutes = Number(fields.minutes);
      fields.milestone_id = fields.milestone_id || null;
      await rpc("save_task", {
        p_data: fields,
        p_id: task?.id || null,
        p_request_id: requestId(form),
      });
      await saved(tr("Acción guardada.", "Action saved."));
    });
  };
  $("#cancel-task", host)?.addEventListener("click", (event) =>
    busy(event.currentTarget, async () => {
      event.currentTarget.dataset.requestId ||= uuid();
      await rpc("set_task_status", {
        p_id: task.id,
        p_status: "cancelled",
        p_request_id: event.currentTarget.dataset.requestId,
      });
      await saved(tr("Acción retirada. Su historial queda conservado.", "Action removed. Its history is kept."));
    }),
  );
}
function habitForm(habit = null) {
  const h = habit || {
    title: "",
    days: [1, 2, 3, 4, 5],
    minutes: 10,
    priority: "low",
    active: true,
  };
  const host = modal(
    habit ? tr("Ajustar hábito", "Adjust habit") : tr("Un hábito pequeño", "A small habit"),
    `<form id="habit-form"><label>${tr("Qué quiero repetir", "What I want to repeat")}<input name="title" value="${e(h.title)}" maxlength="160" required></label>${daysInputs(h.days)}<div class="form-grid"><label>${tr("Minutos", "Minutes")}<input name="minutes" type="number" min="5" max="120" value="${h.minutes}" required></label><label>${tr("Prioridad", "Priority")}<select name="priority">${options(PRIORITIES, h.priority)}</select></label></div><label><input name="active" type="checkbox" ${h.active ? "checked" : ""}> ${tr("Hábito activo", "Active habit")}</label>${alert()}<button>${tr("Guardar hábito", "Save habit")}</button></form>`,
  );
  const form = $("#habit-form", host);
  form.onsubmit = (event) => {
    event.preventDefault();
    busy($("button", form), async () => {
      const f = new FormData(form);
      await rpc("save_habit", {
        p_id: habit?.id || null,
        p_request_id: requestId(form),
        p_data: {
          title: f.get("title"),
          minutes: Number(f.get("minutes")),
          priority: f.get("priority"),
          active: f.has("active"),
          days: f.getAll("days").map(Number),
          goal_id: habit?.goal_id || null,
        },
      });
      await saved(tr("Hábito guardado.", "Habit saved."));
    });
  };
}
function proposalEditor(response) {
  const plan = response.proposal,
    requestId = response.job_id || uuid();
  const host = modal(
    response.goal_id ? tr("Revisar el ajuste", "Review the adjustment") : tr("Tu propuesta, antes de guardar", "Your proposal, before saving"),
    `<p class="notice">${response.goal_id ? tr("Este ajuste reemplazará únicamente las acciones pendientes. Las completadas y sus recompensas se conservan.", "This adjustment only replaces pending actions. Completed ones and their rewards are kept.") : tr("Esta propuesta todavía no está guardada. Puedes editar sus acciones y fechas antes de confirmar.", "This proposal isn't saved yet. You can edit its actions and dates before confirming.")}</p><p class="fine">${tr("La preparó una IA: revísala antes de guardarla. Puede equivocarse y no reemplaza consejo médico, psicológico, legal ni financiero.", "An AI prepared it: review it before saving. It can be wrong and it doesn't replace medical, psychological, legal or financial advice.")}</p><p data-proposal-summary>${e(plan.summary)}</p><p><strong>${tr("Primera acción:", "First action:")}</strong> ${e(plan.first_action)}</p><form id="proposal-form"><label>${tr("Meta", "Goal")}<input name="title" value="${e(plan.title)}" maxlength="160" required></label><label>${tr("Descripción", "Description")}<textarea name="description" maxlength="3000">${e(plan.description)}</textarea></label><label>${tr("Resultado esperado", "Expected result")}<textarea name="outcome" maxlength="1000" required>${e(plan.outcome)}</textarea></label><label>${tr("Área", "Area")}<select name="category">${options(CATEGORIES, plan.category)}</select></label>${plan.milestones
      .map(
        (m, i) =>
          `<fieldset class="proposal-milestone"><legend>${tr("Hito", "Milestone")} ${i + 1}</legend><input aria-label="${tr("Título del hito", "Milestone title")} ${i + 1}" data-milestone="${i}" value="${e(m.title)}" maxlength="160" required>${m.tasks
            .map((t, j) => {
              const d = new Date(plan.start_date + "T12:00:00Z");
              d.setUTCDate(d.getUTCDate() + t.day_offset);
              return `<div class="proposal-task" data-proposal-task="${i}:${j}"><label>${tr("Acción", "Action")}<input data-field="title" value="${e(t.title)}" maxlength="160" required></label><label>${tr("Detalles", "Details")}<textarea data-field="description" maxlength="3000">${e(t.description)}</textarea></label><div class="form-grid"><label>${tr("Hacer el", "Do it on")}<input data-field="date" type="date" value="${d.toISOString().slice(0, 10)}" required></label><label>${tr("Fecha límite", "Deadline")}<input data-field="deadline" type="date" value="${t.deadline || ""}"></label><label>${tr("Minutos", "Minutes")}<input data-field="minutes" type="number" min="5" max="120" value="${t.minutes}" required></label><label>${tr("Prioridad", "Priority")}<select data-field="priority">${options(PRIORITIES, t.priority)}</select></label></div><button type="button" class="text-button" data-remove-proposal>${tr("Retirar acción", "Remove action")}</button></div>`;
            })
            .join("")}</fieldset>`,
      )
      .join("")}${alert()}<button>${tr("Confirmar y guardar el plan", "Confirm and save the plan")}</button></form>`,
  );
  // Reportar la propuesta sin salir de la app (contenido generado por IA, Google Play).
  if (response.job_id)
    $("[data-proposal-summary]", host).after(
      reportControl({
        label: tr("Reportar esta propuesta", "Report this proposal"),
        submit: (input) => reportAiPlan(response.job_id, input),
      }),
    );
  host
    .querySelectorAll("[data-remove-proposal]")
    .forEach(
      (b) => (b.onclick = () => b.closest("[data-proposal-task]").remove()),
    );
  const form = $("#proposal-form", host);
  form.onsubmit = (event) => {
    event.preventDefault();
    busy($("button:not([type=button])", form), async () => {
      const fields = Object.fromEntries(new FormData(form));
      const edited = {
        ...plan,
        ...fields,
        milestones: plan.milestones.map((m, i) => ({
          title: $(`[data-milestone="${i}"]`, form).value,
          tasks: [
            ...form.querySelectorAll(`[data-proposal-task^="${i}:"]`),
          ].map((el) => {
            const values = {};
            for (const input of el.querySelectorAll("[data-field]"))
              values[input.dataset.field] = input.value;
            return {
              title: values.title,
              description: values.description,
              priority: values.priority,
              minutes: Number(values.minutes),
              deadline: values.deadline || null,
              day_offset: Math.round(
                (Date.parse(values.date) - Date.parse(plan.start_date)) /
                  86400000,
              ),
            };
          }),
        })),
      };
      const fallbackDaily = {};
      for (let offset = 0; offset < 28; offset++) {
        const date = new Date(plan.start_date + "T12:00:00Z");
        date.setUTCDate(date.getUTCDate() + offset);
        fallbackDaily[date.toISOString().slice(0, 10)] = Math.ceil(
          state.profile.weekly_minutes / state.profile.available_days.length,
        );
      }
      validateProposal(edited, {
        weeklyMinutes: plan.weekly_minutes,
        startDate: plan.start_date,
        targetDate: plan.target_date,
        availableDays: state.profile.available_days,
        remainingDaily: fallbackDaily,
        ...response.constraints,
      });
      await rpc("apply_goal_plan", {
        p_goal_id: response.goal_id,
        p_expected_version: response.expected_version,
        p_plan: edited,
        p_request_id: requestId,
      });
      await saved(tr("Plan guardado. Tu siguiente paso ya tiene un lugar.", "Plan saved. Your next step now has a place."));
    });
  };
}
function importPreview(data) {
  const host = modal(
    tr("Revisar antes de importar", "Review before importing"),
    `<p>${tr(`Destino: <strong>${e(user.email)}</strong>. Solo se importará a esta cuenta.`, `Destination: <strong>${e(user.email)}</strong>. It will only be imported into this account.`)}</p><p>${tr(`${data.items.length} actividades de <strong>${e(data.source)}</strong>, con sus títulos, áreas, fechas y estados. No se borrarán los originales.`, `${data.items.length} activities from <strong>${e(data.source)}</strong>, with their titles, areas, dates and statuses. The originals won't be deleted.`)}</p><ul class="import-list">${data.items
      .slice(0, 30)
      .map(
        (t) =>
          `<li>${e(t.title)} · ${e(t.area)} · ${dateLabel(t.deadline)} · ${t.status === "completed" ? tr("Completada", "Completed") : tr("Pendiente", "Pending")}</li>`,
      )
      .join(
        "",
      )}</ul>${data.items.length > 30 ? `<p>${tr("Se muestran las primeras 30 actividades.", "Showing the first 30 activities.")}</p>` : ""}<label><input type="checkbox" id="confirm-import"> ${tr("Confirmo que estos datos son míos y quiero guardarlos en esta cuenta.", "I confirm this data is mine and I want to save it in this account.")}</label>${alert()}<button id="import-confirm">${tr("Confirmar importación", "Confirm import")}</button>`,
  );
  const requestId = uuid();
  $("#import-confirm", host).onclick = (event) =>
    busy(event.currentTarget, async () => {
      if (!$("#confirm-import", host).checked)
        throw new Error(tr("Confirma primero la cuenta de destino.", "First confirm the destination account."));
      const result = await rpc("import_legacy", {
        p_data: data,
        p_request_id: requestId,
      });
      await saved(
        tr(`Importación guardada: ${result.added} actividades nuevas y ${result.skipped} ya existentes.`, `Import saved: ${result.added} new activities and ${result.skipped} that already existed.`),
      );
    });
}
watchSafeArea();
installNativeBack({
  modalOpen: () => Boolean(dialog?.open),
  closeModal,
  goHome: () => { location.hash = user ? "today" : "home"; },
  onError: (error) => toast(errorMessage(error)),
}).catch((error) => toast(errorMessage(error)));
window.addEventListener("hashchange", () => {
  // Page anchors are not routes: keep the current view and keyboard position.
  if (["#main", "#how"].includes(location.hash)) return;
  authNotice = "";
  closeModal();
  const form = AUTH_FORMS.get(location.hash.slice(1));
  if (form?.reset) {
    authModal(form);
    return;
  }
  render();
});
document.querySelector(".skip-link")?.addEventListener("click", (event) => {
  const main = document.querySelector("#main");
  if (!main) return;
  event.preventDefault();
  main.setAttribute("tabindex", "-1");
  main.focus();
  main.scrollIntoView({ block: "start" });
});
window.addEventListener("pagehide", () => {
  disposePets();
  disposeBilling?.();
  disposeBilling = null;
});
window.addEventListener("pageshow", () => {
  mountPets();
  mountBillingView();
});
// Título y descripción de la pestaña en el idioma actual (index.html trae los de español).
function translateDocument() {
  document.title = tr("PlanifIA · Tus metas, paso a paso", "PlanifIA · Your goals, step by step");
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      "content",
      tr(
        "Tus metas, un plan claro y un paso a la vez. Organiza acciones, ajusta tu ritmo y crece con Lumi.",
        "Your goals, a clear plan and one step at a time. Organize actions, adjust your pace and grow with Lumi.",
      ),
    );
  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = tr("Saltar al contenido", "Skip to content");
}
// Botón ES/EN: redibuja la vista en el otro idioma. Un formulario abierto se cierra (el botón queda
// detrás del diálogo, así que sólo pasa si se cambia desde fuera, p. ej. con otra pestaña).
bindLangToggle();
onLangChange(() => {
  translateDocument();
  closeModal();
  // Lumi repite lo que estaba diciendo (otra frase del mismo tipo) en el idioma nuevo.
  const said = companion.message;
  if (user && state && said) companion.say(said.kind, said.askMood);
  render();
  // Los avisos del día se vuelven a programar con el texto en el idioma nuevo.
  if (user && state) void reminders.sync(user.id, state);
  document.querySelector(`[data-lang="${lang()}"]`)?.focus({ preventScroll: true });
});
translateDocument();
render();
void offerUpdate();
if (cloud) {
  cloud.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      const wasRestoring = restoring;
      restoring = false;
      if (event === "PASSWORD_RECOVERY") {
        // Igual que antes del esqueleto: la portada queda detrás del formulario.
        if (wasRestoring) {
          document.getElementById("boot")?.remove();
          landing();
          mountPets();
        }
        user = session?.user || null;
        authModal(AUTH_FORMS.get("reset"));
        return;
      }
      // Al terminar la sesión o cambiar de cuenta se cierra cualquier diálogo abierto: un borrador o
      // formulario de la cuenta anterior no debe quedar visible ni enviarse con la sesión nueva.
      if (!session) {
        if (user) closeModal();
        companion.end();
        companionVoice.dispose();
        aiJobs.stop();
        cloudFallback.reset();
        stopMonetization();
        void reminders.stop();
        legal = null;
        legalPrompted = false;
        user = null;
        state = null;
        loadVersion++;
        render();
      } else if (session.user.id !== user?.id) {
        if (user) closeModal();
        // Los avisos de la cuenta anterior no siguen en este teléfono; refresh() programa los de la nueva.
        if (user) void reminders.stop();
        legal = null;
        legalPrompted = false;
        user = session.user;
        state = null;
        refresh();
      }
    }, 0);
  });
  // Sólo se vuelve a dibujar si el esqueleto seguía esperando esta respuesta.
  const stopRestoring = () => {
    const was = restoring;
    restoring = false;
    return was;
  };
  checked(cloud.auth.getSession())
    .then((data) => {
      const waiting = stopRestoring();
      if (data.session) {
        showAuthReturn(true);
        user = data.session.user;
        const selectedPlan = consumeBillingIntent();
        if (selectedPlan) location.hash = `subscription?plan=${selectedPlan}`;
        refresh();
      } else {
        if (waiting) render();
        showAuthReturn(false);
      }
    })
    .catch((error) => {
      if (stopRestoring()) render();
      if (authReturn) showAuthReturn(false);
      else toast(errorMessage(error));
    });
}
