import "./style.css";
import { authRedirect, downloadJson, installNativeBack, watchSafeArea } from "./platform.js";
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
  cloud,
  missing,
  checked,
  loadState,
  rpc,
  generatePlan,
  listAiJobs,
  cancelAiJob,
  releaseAiRequest,
} from "./cloud.js";
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
  invokeBilling,
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
  createPlayStore,
  getPremiumStatus,
  onPurchasesUpdated,
  rememberPlan,
} from "./native-billing.js";
import { validateProposal } from "../supabase/functions/_shared/plan.js";

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
const petControllers = new Map();
let petPose = null;
let disposePetMotionControls = null;
let disposeBilling = null;
let paymentReturn = null;
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

let lumiChat = null;
// Créditos y plan vigente. En Android, además, anuncios (sólo plan Gratis) y Google Play.
let monetization = null,
  monetizationUser = null,
  lastStoreCheck = 0;
const ads = createAdManager();
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
function stopMonetization() {
  monetization = null;
  monetizationUser = null;
  void ads.setEligible(false);
}
function creditHint() {
  const cost = monetization?.credits?.cost_per_use ?? 20;
  return monetization
    ? `Usar la IA cuesta ${cost} créditos. Tienes ${monetization.credits.balance}.`
    : `Usar la IA cuesta ${cost} créditos.`;
}
onPurchasesUpdated((payload) => {
  // Compras completadas fuera del flujo (p. ej., un pago pendiente que se confirmó después).
  if (user && payload?.purchases?.length)
    playStore
      ?.sync(payload.purchases, { skipRecent: true })
      .then((result) => {
        if (result.results?.some((r) => !r.error && (r.granted || r.active)))
          toast("Google Play confirmó tu compra. Tu cuenta ya está al día.");
      })
      .catch(() => {});
}).catch(() => {});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && user) {
    void checkStore();
  }
});
function updateAiBadge() {
  const button = document.querySelector("#ai-jobs");
  if (!button) return;
  const pending = aiJobs.jobs.filter((j) =>
    ["queued", "processing"].includes(j.status),
  ).length;
  const ready = aiJobs.jobs.filter((j) => j.status === "completed").length;
  button.textContent = pending
    ? "IA · " + pending + " en preparación"
    : ready
      ? "IA · propuestas para revisar"
      : "Mis solicitudes de IA";
}
function aiJobsDialog() {
  const host = modal(
    "Mis solicitudes de IA",
    '<p class="muted">Tu trabajo continúa aunque cierres la página. Las propuestas sólo cambian tus metas cuando las confirmas.</p><div data-job-list></div>',
  );
  let previous = "";
  const unsubscribe = aiJobs.subscribe((jobs, error) => {
    if (!host.isConnected || !host.open) return;
    const markup =
      (error ? '<p role="alert">' + e(error) + "</p>" : "") +
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
                '">Revisar propuesta</button>'
              : "") +
            (["queued", "processing"].includes(job.status) &&
            !job.cancel_requested
              ? '<button class="secondary" data-cancel-job="' +
                job.id +
                '">' +
                (job.status === "processing"
                  ? "Solicitar interrupción"
                  : "Cancelar solicitud") +
                "</button>"
              : "") +
            "</article>",
        )
        .join("") ||
        '<p class="muted">Todavía no hay solicitudes. Crea una meta para pedir tu primera propuesta.</p>');
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
    billing: invokeBilling,
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
        }
      : null,
  });
}
function billingDestination() {
  const planId = consumeBillingIntent();
  if (paymentReturn) {
    const route = paymentReturn;
    paymentReturn = null;
    return route;
  }
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
    ? "No pudimos conectar. Revisa Internet y vuelve a intentarlo."
    : error.message || "No pudimos guardar el cambio. Inténtalo nuevamente.";
}
function formError(form, error) {
  const el = $("[role=alert]", form);
  if (el) {
    el.textContent = errorMessage(error);
    el.hidden = false;
    // Sin créditos: lleva a Mi plan, donde se ganan (anuncios, invitaciones) o se compran.
    if (/créditos suficientes/.test(el.textContent)) {
      const link = document.createElement("a");
      link.href = "#subscription";
      link.textContent = " Conseguir créditos →";
      link.addEventListener("click", closeModal);
      el.append(link);
    }
  } else toast(errorMessage(error));
}
async function busy(button, action) {
  if (button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Guardando…";
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
  else toast("El cambio se guardó, pero no pudimos actualizar la vista. Vuelve a cargar tus datos.");
}
function modal(title, content) {
  closeModal();
  dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.setAttribute("aria-labelledby", "dialog-title");
  dialog.innerHTML = `<div class="modal-head"><h2 id="dialog-title">${e(title)}</h2><button class="icon-button" data-close aria-label="Cerrar">×</button></div>${content}`;
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
  return `<aside class="pet-card featured" id="pet" aria-labelledby="pet-name"><div class="pet-portrait">${portrait(p.stage)}</div><div class="pet-info">${lumiConversationMarkup()}<div class="pet-progress-summary"><p class="eyebrow">TU COMPAÑERA DE CADA PASO</p><div class="pet-title"><h2 id="pet-name">${e(p.name)}</h2><span class="pet-level">Nivel ${p.level}</span></div><p class="pet-stage">${STAGES[p.stage - 1]} · ${p.total_xp} XP</p><progress aria-label="Experiencia de Lumi" value="${p.next_xp === null ? 1 : p.level_xp}" max="${p.next_xp ?? 1}"></progress><p class="pet-xp-label">${p.next_xp === null ? "Evolución final alcanzada" : `${p.level_xp} / ${p.next_xp} XP para el siguiente nivel`}</p></div></div></aside>`;
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
        ? `¡Lumi evolucionó! ${STAGES[p.stage - 1]}, nivel ${p.level}.`
        : levelled
          ? `¡Nivel ${p.level}! Cada paso cuenta.`
          : `¡Bien hecho! +${result.xp_delta} XP.`,
    );
  } else if (result.xp_delta < 0)
    toast(
      `Acción reabierta. Se ajustaron ${-result.xp_delta} XP; puedes retomarla a tu ritmo.`,
    );
}
const activeTask = (t) =>
  !t.goal_id ||
  state.goals.some((g) => g.id === t.goal_id && g.status === "active");
const liveTasks = () => state.tasks.filter((t) => t.status !== "cancelled");
function taskRow(t) {
  const goal = state.goals.find((g) => g.id === t.goal_id);
  return `<article class="task-row ${t.status === "completed" ? "done" : ""}"><button class="task-check" data-toggle-task="${t.id}" aria-label="${t.status === "completed" ? "Volver a pendiente" : "Completar"}: ${e(t.title)}" aria-pressed="${t.status === "completed"}">${t.status === "completed" ? "✓" : ""}</button><div class="task-content"><strong>${e(t.title)}</strong><p>${e(goal?.title || t.area || "Acción independiente")} · ${t.minutes} min <span class="priority ${t.priority}">${PRIORITIES[t.priority]}</span></p>${t.deadline ? `<small>Fecha límite: ${dateLabel(t.deadline)}</small>` : ""}</div><button class="text-button" data-edit-task="${t.id}">Reprogramar / editar</button></article>`;
}
function goalCard(g) {
  const p = progress(liveTasks().filter((t) => t.goal_id === g.id));
  return `<article class="goal-card"><div class="card-top"><span class="tag">${CATEGORIES[g.category]}</span><span class="muted">${{ active: "Activa", paused: "En pausa", achieved: "Alcanzada", archived: "Archivada" }[g.status]}</span></div><h3><button class="title-button" data-goal="${g.id}">${e(g.title)}</button></h3><p>${e(g.outcome || g.description)}</p><div class="progress-label"><span>${p.done} de ${p.total} acciones</span><strong>${p.percent}%</strong></div><progress value="${p.percent}" max="100" aria-label="Acciones completadas de ${e(g.title)}"></progress><div class="card-foot"><span>${g.target_date ? `Objetivo: ${dateLabel(g.target_date)}` : "A tu ritmo"}</span><button class="text-button" data-goal="${g.id}">Ver plan →</button></div></article>`;
}
function dashboard() {
  const goals = state.goals.filter((g) => g.status === "active"),
    tasks = liveTasks().filter(
      (t) => activeTask(t) && t.scheduled_date && t.scheduled_date <= day(),
    );
  const pending = tasks.filter((t) => t.status === "pending");
  return `<div class="page-heading"><div><p class="eyebrow">TU CAMINO</p><h1>Un paso a la vez, ${e(state.profile.name.split(" ")[0] || "a tu ritmo")}.</h1><p class="muted">Tus metas tienen espacio aquí. Elige lo que puedes hacer hoy.</p></div><button data-new-goal>+ Crear una meta</button></div>${petCard()}<div class="overview"><div class="stat"><strong>${goals.length}</strong><span>metas activas</span></div><div class="stat"><strong>${pending.length}</strong><span>acciones para hoy y por retomar</span></div><div class="stat"><strong>${liveTasks().filter((t) => t.status === "completed").length}</strong><span>pasos completados</span></div></div><section><div class="section-heading"><div><p class="eyebrow">¿QUÉ QUIERO LOGRAR?</p><h2>Mis metas</h2></div><a href="#goals">Ver todas →</a></div>${goals.length ? `<div class="goal-grid">${goals.slice(0, 4).map(goalCard).join("")}</div>` : `<div class="welcome"><h3>Tu primera meta puede empezar con una idea.</h3><p>Aprender un idioma, crear tu proyecto, preparar una carrera o encontrar un hábito que te haga bien.</p><button data-new-goal>Crear mi primera meta</button></div>`}</section><div class="today-grid"><section class="panel"><div class="section-heading"><div><p class="eyebrow">¿QUÉ PUEDO HACER HOY?</p><h2>Hoy</h2></div><button class="text-button" data-new-task>+ Acción</button></div>${
    tasks.length
      ? tasks
          .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
          .map(taskRow)
          .join("")
      : '<div class="empty"><p>Hoy hay espacio para elegir tu siguiente paso.</p><a href="#calendar">Organizar mi calendario →</a></div>'
  }${liveTasks().some((t) => t.status === "pending" && !t.scheduled_date) ? `<p class="muted">Hay ${liveTasks().filter((t) => t.status === "pending" && !t.scheduled_date).length} acciones sin fecha. Puedes organizarlas desde <a href="#tasks">Acciones</a>.</p>` : ""}</section><aside class="note"><h3>El progreso también es encontrar tu ritmo.</h3><p>La barra de cada meta cuenta sus acciones completadas. Tú decides cuándo el resultado que buscabas está alcanzado.</p><a href="#habits">Ver mis hábitos →</a></aside></div>`;
}
function goalsPage() {
  return `<div class="page-heading"><div><p class="eyebrow">¿QUÉ QUIERO LOGRAR?</p><h1>Mis metas</h1><p class="muted">Cada camino puede cambiar de ritmo.</p></div><button data-new-goal>+ Crear una meta</button></div>${
    ["active", "paused", "achieved", "archived"]
      .map((status) => {
        const items = state.goals.filter((g) => g.status === status);
        return items.length
          ? `<section><h2>${{ active: "En camino", paused: "En pausa", achieved: "Metas alcanzadas", archived: "Archivo" }[status]}</h2><div class="goal-grid">${items.map(goalCard).join("")}</div></section>`
          : "";
      })
      .join("") ||
    '<div class="welcome"><h2>¿Qué te gustaría lograr?</h2><p>Empieza con una idea pequeña. Puedes organizarla tú o pedir ayuda a la IA.</p><button data-new-goal>Crear una meta</button></div>'
  }`;
}
function tasksPage() {
  return `<div class="page-heading"><div><h1>Mis acciones</h1><p class="muted">Pequeños pasos, con una meta o por sí solos.</p></div><button data-new-task>+ Crear acción</button></div><section class="panel">${
    liveTasks()
      .sort((a, b) =>
        (a.scheduled_date || "9999").localeCompare(b.scheduled_date || "9999"),
      )
      .map(taskRow)
      .join("") ||
    '<p class="empty">Todavía no hay acciones. Añade una o crea un plan para tu meta.</p>'
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
  return `<div class="page-heading"><div><h1>Un calendario con espacio</h1><p class="muted">La IA tiene en cuenta tus acciones y hábitos al proponer un plan.</p></div><button data-new-task>+ Acción</button></div><label class="date-picker">Ver desde <input type="date" id="calendar-date" value="${start}"></label><div class="calendar-grid">${dates
    .map((date) => {
      const tasks = liveTasks().filter(
        (t) => t.scheduled_date === date && activeTask(t),
      );
      return `<section class="panel"><h2>${dateLabel(date)}</h2><p class="muted">${tasks.reduce((sum, t) => sum + t.minutes, 0)} minutos en acciones</p>${tasks.map(taskRow).join("") || '<p class="empty">Espacio libre</p>'}</section>`;
    })
    .join("")}</div>`;
}
function habitsPage() {
  const dow = new Date(day() + "T12:00:00").getDay();
  return `<div class="page-heading"><div><h1>Hábitos a tu ritmo</h1><p class="muted">Cada cumplimiento queda registrado por separado.</p></div><button data-new-habit>+ Crear hábito</button></div>${
    state.habits
      .map((h) => {
        const done = state.completions.some(
          (c) => c.habit_id === h.id && c.day === day() && c.completed,
        );
        const history = state.completions
          .filter((c) => c.habit_id === h.id)
          .sort((a, b) => b.day.localeCompare(a.day));
        return `<section class="panel habit-card"><div class="section-heading"><div><h2>${e(h.title)}</h2><p class="muted">${h.minutes} min · ${h.days.map((d) => ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][d]).join(", ")}${h.active ? "" : " · En pausa"}</p></div><button class="secondary" data-edit-habit="${h.id}">Editar</button></div>${h.active && h.days.includes(dow) ? `<button data-habit="${h.id}" data-completed="${!done}">${done ? "✓ Hecho hoy · deshacer" : "Marcar hoy como hecho"}</button>` : ""}<details><summary>Historial · ${history.filter((c) => c.completed).length} cumplimientos</summary><ul>${history.map((c) => `<li>${dateLabel(c.day)} · ${c.completed ? "Completado" : "Reabierto"}</li>`).join("") || "<li>Aquí aparecerán tus próximos pasos.</li>"}</ul></details></section>`;
      })
      .join("") ||
    '<div class="welcome"><h2>Lo pequeño también suma.</h2><p>Leer diez minutos, practicar un idioma o reservar un rato para tu proyecto.</p><button data-new-habit>Crear mi primer hábito</button></div>'
  }`;
}
function daysInputs(selected, prefix = "days") {
  return `<fieldset><legend>Días disponibles</legend><div class="days">${["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((label, i) => `<label><input type="checkbox" name="${prefix}" value="${i}" ${selected.includes(i) ? "checked" : ""}>${label}</label>`).join("")}</div></fieldset>`;
}
function settingsPage() {
  const p = state.profile;
  return `<div class="page-heading"><div><h1>Tu ritmo y tus datos</h1><p class="muted">Los cambios se guardan en tu cuenta y se recuperan en otros dispositivos.</p></div></div><div class="settings-grid"><section class="panel pet-motion-panel"><h2>Lumi a tu ritmo</h2><p>Elige cómo te acompaña mientras organizas tus metas.</p>${petMotionControls()}${lumiConversationSettings(companion)}</section><section class="panel"><h2>Disponibilidad</h2><form id="profile-form"><label>Tu nombre<input name="name" value="${e(p.name)}" maxlength="80" required></label><label>Zona horaria<input name="timezone" value="${e(p.timezone)}" required placeholder="America/Santiago"></label><label>Minutos totales por semana<input name="minutes" type="number" min="30" max="3360" value="${p.weekly_minutes}" required></label>${daysInputs(p.available_days)}<p class="muted">La IA reparte este tiempo entre tus días disponibles, contando acciones y hábitos existentes.</p>${alert()}<button>Guardar disponibilidad</button></form></section><section class="panel"><h2>Conservar lo que ya hiciste</h2><p>Importa un archivo JSON de PlanifIA anterior. Verás el destino y el contenido antes de confirmar.</p><label class="file-label">Seleccionar exportación<input type="file" id="import-file" accept="application/json,.json"></label><button class="secondary" id="import-local">Buscar tareas guardadas en este navegador</button><p class="muted">Los archivos originales se conservan. Repetir la importación no crea actividades duplicadas. La XP histórica se conserva en el respaldo original, sin asignar recompensas nuevas.</p><h3>Importaciones guardadas</h3>${state.imports.map((i) => `<p>${e(i.source)} <button class="text-button" data-export-import="${i.id}">Descargar original</button></p>`).join("") || '<p class="muted">Todavía no hay importaciones.</p>'}<button class="secondary" id="export-data">Exportar mis datos</button></section>${isAndroidApp() ? `<section class="panel"><h2>Anuncios y privacidad</h2><p>En el plan Gratis se muestra un video de Google AdMob al usar la IA (máximo uno cada 5 minutos). Plus, Pro y la compra "Quitar anuncios" no muestran videos.</p>${ads.privacyRequired ? '<button class="secondary" id="ad-privacy">Opciones de privacidad de anuncios</button>' : '<p class="muted">Puedes revisar tu consentimiento de anuncios aquí cuando tu región lo requiera.</p>'}</section>` : ""}<section class="panel danger-zone"><h2>Eliminar cuenta</h2><p>Borra de forma permanente tu cuenta y todos sus datos: metas, acciones, hábitos, Lumi, solicitudes de IA e importaciones. No se puede deshacer.</p><p class="muted">Te recomendamos exportar tus datos antes. Consulta la <a href="https://planifia.cl/privacidad.html" target="_blank" rel="noopener">política de privacidad</a>.</p><button class="danger" id="delete-account">Eliminar mi cuenta</button></section></div>`;
}
function shell(content) {
  const tab = location.hash.slice(1).split("?")[0] || "today";
  return `<div class="app-shell"><aside class="sidebar"><a href="#today">${logo()}</a><nav aria-label="Navegación principal">${[
    ["today", "Hoy", "☀"],
    ["goals", "Metas", "◎"],
    ["tasks", "Acciones", "✓"],
    ["calendar", "Calendario", "▦", "Agenda"],
    ["habits", "Hábitos", "↻"],
    ["lumi", "Lumi", "✦"],
    ["subscription", "Mi plan", "◇"],
    ["settings", "Ajustes", "⚙"],
  ]
    .map(
      ([id, label, icon, short]) =>
        // En teléfonos angostos algunas pestañas usan un nombre corto para que quepan las 8.
        `<a href="#${id}" ${tab === id ? 'aria-current="page"' : ""} ${short ? `aria-label="${label}"` : ""}><span aria-hidden="true">${icon}</span>${short ? `<span class="nav-long">${label}</span><span class="nav-short" aria-hidden="true">${short}</span>` : label}</a>`,
    )
    .join(
      "",
    )}</nav><p>Tus metas, un plan claro<br>y un paso a la vez.</p></aside><div class="app-body"><header class="app-header"><span class="cloud-state">● Tu espacio en la nube</span><div><button class="text-button" id="ai-jobs">Mis solicitudes de IA</button><span>${e(state?.profile.name || user.email)}</span><button class="text-button" id="logout">Cerrar sesión</button></div></header><main id="main"><div class="error panel" id="page-error" role="alert" hidden><p></p><button id="retry-load">Volver a cargar</button></div>${content}</main></div></div>`;
}
function render() {
  disposeBilling?.();
  disposeBilling = null;
  disposePets();
  if (!user) {
    landing();
    mountPets();
    return;
  }
  if (!state) {
    app.innerHTML = shell(
      loading
        ? '<div class="loading-state" role="status">Recuperando tus metas y tu progreso…</div>'
        : '<div class="empty">No pudimos cargar tus datos.</div>',
    );
    bindShell();
    return;
  }
  const route = location.hash.slice(1).split("?")[0] || "today";
  app.innerHTML = shell(
    (
      {
        today: dashboard,
        goals: goalsPage,
        tasks: tasksPage,
        calendar: calendarPage,
        habits: habitsPage,
        settings: settingsPage,
        lumi: () => lumiChatPage({ stage: state.pet.stage, name: state.profile.name, escape: e }),
        plans: () => renderBilling({ view: "plans", user, escape: e }),
        subscription: () =>
          renderBilling({ view: "subscription", user, escape: e }),
      }[route] || dashboard
    )(),
  );
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
  });
}
function bindAdPrivacy() {
  const button = $("#ad-privacy");
  if (button)
    button.onclick = () =>
      busy(button, () =>
        ads.privacyOptions().then(() => toast("Tus preferencias de anuncios quedaron guardadas.")),
      );
}
function landing() {
  const billingRoute = location.hash.slice(1).split("?")[0];
  if (["plans", "subscription"].includes(billingRoute)) {
    const paymentParams = new URLSearchParams(location.hash.split("?")[1]);
    for (const key of ["order", "enrollment"]) {
      const reference = paymentParams.get(key);
      if (
        billingRoute === "subscription" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          reference || "",
        )
      )
        paymentReturn = `subscription?${key}=${reference}`;
    }
    app.innerHTML = `<header class="landing-header"><a href="#home">${logo()}</a><div><a href="#home">Inicio</a><a class="button" href="#login">Iniciar sesión</a></div></header><main id="main">${renderBilling({ view: "plans", user, escape: e })}</main>`;
    mountBillingView();
    return;
  }
  app.innerHTML = `<header class="landing-header"><a href="#home">${logo()}</a><div><a href="#plans">Planes</a><a href="#login">Iniciar sesión</a><a class="button" href="#register">Empezar</a></div></header><main id="main"><section class="hero"><div><p class="eyebrow">DALE FORMA A LO QUE TE IMPORTA</p><h1>Tus metas.<br>Un plan claro.<br><em>Un paso a la vez.</em></h1><p>Convierte lo que quieres lograr en acciones que caben en tu vida. La IA te ayuda a dividir el camino; tú eliges el ritmo.</p><div class="hero-actions"><a class="button" href="#register">Crear mi primera meta →</a><a href="#how">Cómo funciona</a></div><p class="fine">Para proyectos, aprendizaje, bienestar y todo lo que empieza con una idea.</p></div><div class="hero-example"><span class="example-label">UN EJEMPLO DE TU PRÓXIMO PASO</span><div class="example-goal"><span class="tag">Aprendizaje</span><h2>Hablar inglés con más confianza</h2><p>Un camino en acciones pequeñas.</p><div class="example-action"><span>✓</span><div><strong>Practicar una presentación de 2 minutos</strong><p>Hoy · 15 minutos · A mi ritmo</p></div></div></div><div class="hero-pet">${portrait(2)}<div><strong>Lumi crece contigo</strong><p>Cada acción completada suma experiencia.</p></div></div></div></section><section class="how" id="how"><p class="eyebrow">DEL «ALGÚN DÍA» AL SIGUIENTE PASO</p><h2>Una idea tiene por dónde empezar.</h2><div class="three-columns"><article><span>01</span><h3>Cuenta qué quieres lograr</h3><p>Tu punto de partida, el resultado que buscas y el tiempo que tienes.</p></article><article><span>02</span><h3>Revisa un plan a tu medida</h3><p>La IA propone hitos, prioridades y acciones. Puedes editarlos antes de guardar.</p></article><article><span>03</span><h3>Avanza y ajusta el camino</h3><p>Organiza tu calendario, registra lo que haces y cambia el plan cuando lo necesites.</p></article></div></section><section class="examples"><h2>Un lugar para distintas metas.</h2><div>${["Aprender un idioma", "Lanzar mi proyecto", "Preparar una carrera", "Crear un hábito de lectura"].map((t) => `<button class="secondary" data-example="${e(t)}">${e(t)} ↗</button>`).join("")}</div></section>${missing.length ? `<section class="setup-note" role="status"><h2>La conexión con la nube está pendiente.</h2><p>Falta configurar ${missing.map((x) => `<code>${x}</code>`).join(" y ")} y aplicar las migraciones de Supabase. El registro, tus datos y la IA se habilitarán al conectar el proyecto.</p></section>` : ""}<footer class="landing-footer"><p>PlanifIA · Un paso posible vale más que un plan imposible.</p><nav aria-label="Información legal"><a href="./privacidad.html">Privacidad</a><a href="./terminos.html">Términos</a><a href="./eliminar-cuenta.html">Eliminar cuenta</a></nav></footer></main>`;
  document.querySelectorAll("[data-example]").forEach(
    (b) =>
      (b.onclick = () => {
        location.hash = "register";
      }),
  );
  if (["login", "register", "reset"].includes(location.hash.slice(1)))
    authModal(location.hash.slice(1));
}
function authModal(mode) {
  const register = mode === "register",
    reset = mode === "reset";
  const host = modal(
    reset
      ? "Una nueva contraseña"
      : register
        ? "Empieza tu camino"
        : "Qué bueno verte",
    `<p class="muted">${reset ? "Escribe tu nueva contraseña." : register ? "Tus metas y Lumi te esperan en cualquier dispositivo." : "Vuelve a tu siguiente paso."}</p><form id="auth-form">${register ? '<label>Tu nombre<input name="name" autocomplete="name" maxlength="80" required></label>' : ""}${!reset ? '<label>Correo electrónico<input name="email" type="email" autocomplete="email" required></label>' : ""}<label>Contraseña<input name="password" type="password" autocomplete="${register || reset ? "new-password" : "current-password"}" minlength="8" required></label>${alert()}<button>${reset ? "Guardar contraseña" : register ? "Crear cuenta" : "Iniciar sesión"}</button></form>${!register && !reset ? '<button class="text-button" id="forgot">Olvidé mi contraseña</button>' : ""}<p>${register ? '<a href="#login">Ya tengo una cuenta</a>' : '<a href="#register">Crear una cuenta</a>'}</p>`,
  );
  $("#auth-form", host).onsubmit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    busy($("button", form), async () => {
      if (!cloud)
        throw new Error(`Falta conectar Supabase: ${missing.join(", ")}.`);
      const fields = Object.fromEntries(new FormData(form));
      if (reset) {
        await checked(cloud.auth.updateUser({ password: fields.password }));
        await saved("Contraseña actualizada.");
        return;
      }
      if (register) {
        const data = await checked(
          cloud.auth.signUp({
            email: fields.email,
            password: fields.password,
            options: {
              data: { name: fields.name },
              emailRedirectTo: authRedirect(),
            },
          }),
        );
        if (!data.session) {
          closeModal();
          toast(
            "Revisa tu correo para confirmar la cuenta. Después podrás iniciar sesión.",
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
      toast("Escribe tu correo para recibir el enlace.");
      return;
    }
    busy($("#forgot", host), async () => {
      if (!cloud) throw new Error("Falta conectar Supabase.");
      await checked(
        cloud.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirect("#reset"),
        }),
      );
      toast(
        "Si existe la cuenta, recibirás un enlace para cambiar la contraseña.",
      );
    });
  });
}
function deleteAccountForm() {
  const form = $(
    "form",
    modal(
      "Eliminar tu cuenta",
      `<form><p>Se borrarán permanentemente tu cuenta (${e(user.email)}) y todos tus datos de PlanifIA. Esta acción no se puede deshacer.</p><label>Escribe ELIMINAR para confirmar<input name="confirm" autocomplete="off" required pattern="ELIMINAR"></label><p class="error" role="alert" hidden></p><div class="actions"><button type="button" class="secondary" data-cancel>Cancelar</button><button class="danger">Eliminar definitivamente</button></div></form>`,
    ),
  );
  $("[data-cancel]", form).onclick = closeModal;
  form.onsubmit = (event) => {
    event.preventDefault();
    busy($("button.danger", form), async () => {
      await rpc("delete_my_account", { p_confirm: form.confirm.value.trim() });
      await cloud.auth.signOut({ scope: "local" }).catch(() => {});
      user = null;
      state = null;
      loadVersion++;
      closeModal();
      location.hash = "home";
      render();
      toast("Tu cuenta y tus datos fueron eliminados.");
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
            toast(`¡Hito completado: ${m.title}! Un paso más en tu camino.`);
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
          const result = await rpc("set_habit_completion", {
            p_id: b.dataset.habit,
            p_day: day(),
            p_completed: b.dataset.completed === "true",
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
        "Disponibilidad guardada. Puedes pedir un ajuste de tus metas cuando quieras.",
      );
    });
  });
  $("#import-file")?.addEventListener("change", async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 5000000)
        throw new Error("El archivo debe ocupar menos de 5 MB.");
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
          " Los datos de otros dominios se importan con un archivo exportado.",
      );
    }
  });
  $("#delete-account")?.addEventListener("click", deleteAccountForm);
  $("#export-data")?.addEventListener("click", (event) =>
    busy(event.currentTarget, async () => downloadJson("planifia-seller-respaldo.json", {
      version: 2,
      sourceId: "seller:" + user.id,
      ...state,
    })),
  );
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
    goal ? "Editar mi meta" : "¿Qué quieres lograr?",
    `<form id="goal-form"><label>Mi idea o meta<textarea name="title" rows="2" maxlength="160" required placeholder="Quiero hablar inglés con más confianza">${e(g.title)}</textarea></label><label>Mi punto de partida<textarea name="current_situation" maxlength="2000" placeholder="Qué haces ahora y qué te cuesta">${e(g.current_situation)}</textarea></label><label>El resultado que quiero ver<textarea name="outcome" maxlength="1000" placeholder="Por ejemplo, mantener una conversación de 10 minutos">${e(g.outcome)}</textarea></label><label>Área<select name="category">${options(CATEGORIES, g.category)}</select></label><div class="form-grid"><label>Minutos por semana para esta meta<input name="weekly_minutes" type="number" min="30" max="${state.profile.weekly_minutes}" value="${g.weekly_minutes}" required></label><label>Fecha objetivo · opcional<input name="target_date" type="date" value="${g.target_date || ""}"></label></div>${goal ? `<label>Descripción de la meta<textarea name="description" maxlength="3000">${e(g.description)}</textarea></label>` : ""}${goal ? '<label>¿Qué cambió para ajustar el plan?<textarea name="reason" maxlength="1000" placeholder="Tengo menos tiempo o quiero cambiar el enfoque"></textarea></label>' : ""}<p class="muted">La IA tendrá en cuenta tus ${state.profile.weekly_minutes} minutos semanales y las acciones que ya tienes. Revisarás la propuesta antes de guardarla.</p>${alert()}<div class="actions"><button type="button" id="ai-plan">✦ Proponer un plan con IA</button><button class="secondary">${goal ? "Guardar meta" : "Crear sin IA"}</button></div><p class="fine credit-hint" data-credit-hint>${e(creditHint())}</p></form>`,
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
          ? "Meta actualizada."
          : "Meta creada. Puedes añadir tus primeras acciones.",
      );
    });
  };
  $("#ai-plan", host).onclick = () => {
    if (host.classList.contains("is-generating")) return;
    if (!form.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(form));
    const button = $("#ai-plan", host);
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
        });
        aiJobs.refresh();
        void refreshMonetization().catch(() => {});
        // Plan Gratis: un video mientras la IA trabaja (máx. uno cada 5 min; nunca en el primer plan).
        void ads.aiVideo({ firstTime: !goal?.id && state.goals.length === 0 }).catch(() => {});
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
    `<p>${e(goal.description)}</p><p><strong>El resultado que busco:</strong> ${e(goal.outcome || "Puedes concretarlo al editar la meta.")}</p><p class="muted">${p.done} de ${p.total} acciones completadas (${p.percent}%). Completar acciones y alcanzar el resultado son dos cosas que tú puedes comprobar.</p><div class="actions"><button id="adjust">✦ Revisar / ajustar con IA</button><button class="secondary" id="edit-goal">Editar meta</button></div>${state.milestones
      .filter((m) => m.goal_id === id)
      .sort((a, b) => a.position - b.position)
      .map((m) => {
        const children = tasks.filter((t) => t.milestone_id === m.id);
        return `<section class="milestone"><h3>${e(m.title)}</h3>${children.map(taskRow).join("") || '<p class="muted">Hito del historial, sin acciones activas.</p>'}</section>`;
      })
      .join("")}${tasks
      .filter((t) => !t.milestone_id)
      .map(taskRow)
      .join(
        "",
      )}<div class="actions"><button class="secondary" id="add-goal-task">+ Acción para esta meta</button><button class="secondary" id="add-milestone">+ Crear hito</button></div><div class="actions goal-status"><button id="achieve">Confirmar que logré mi meta</button><button class="secondary" id="pause">${goal.status !== "active" ? "Retomar meta" : "Pausar meta"}</button><button class="text-button" id="archive">Archivar</button></div>`,
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
      await saved("El ritmo de tu meta se actualizó.");
    });
  $("#archive", host).onclick = () =>
    confirmStatus(
      goal,
      "archived",
      "Archivar conserva la meta y su historial. Podrás consultarla y retomarla desde el archivo.",
    );
  $("#achieve", host).onclick = () =>
    confirmStatus(
      goal,
      "achieved",
      "Tú decides si alcanzaste el resultado que buscabas, aunque todavía queden acciones. ¿Quieres marcar esta meta como alcanzada?",
    );
  bindActions();
}
function confirmStatus(goal, status, message) {
  const host = modal(
    status === "achieved"
      ? "Reconoce lo que lograste"
      : "Conservar en el archivo",
    `<p>${e(message)}</p>${alert()}<button id="confirm-status">${status === "achieved" ? "Sí, alcancé mi meta" : "Archivar meta"}</button>`,
  );
  $("#confirm-status", host).onclick = (event) =>
    busy(event.currentTarget, async () => {
      await rpc("set_goal_status", { p_id: goal.id, p_status: status });
      await saved(
        status === "achieved"
          ? "¡Meta alcanzada! Date un momento para reconocer este paso."
          : "Meta archivada. Su historial sigue contigo.",
      );
      if (status === "achieved") {
        celebratePet();
        companion.say("goal");
      }
    });
}
function milestoneForm(goal) {
  const host = modal(
    "Un hito en tu camino",
    `<form><label>Qué quiero completar en esta etapa<input name="title" maxlength="160" required placeholder="Por ejemplo, mi primer prototipo"></label>${alert()}<button>Guardar hito</button></form>`,
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
      await saved("Hito guardado. Puedes vincularle tus próximas acciones.");
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
    task ? "Una acción que encaje mejor" : "Mi siguiente acción",
    `<form id="task-form"><label>Acción<input name="title" maxlength="160" value="${e(t.title)}" required></label><label>Detalles<textarea name="description" maxlength="3000">${e(t.description)}</textarea></label><label>Meta<select name="goal_id"><option value="">Acción independiente</option>${state.goals.map((g) => `<option value="${g.id}" ${g.id === t.goal_id ? "selected" : ""}>${e(g.title)}</option>`).join("")}</select></label><label>Hito · opcional<select name="milestone_id"><option value="">Sin hito</option>${state.milestones
      .filter((m) => m.goal_id === t.goal_id)
      .map(
        (m) =>
          `<option value="${m.id}" ${m.id === t.milestone_id ? "selected" : ""}>${e(m.title)}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Área · opcional<input name="area" value="${e(t.area)}" maxlength="80"></label><div class="form-grid"><label>Hacer el<input name="scheduled_date" type="date" value="${t.scheduled_date || ""}"></label><label>Fecha límite · opcional<input name="deadline" type="date" value="${t.deadline || ""}"></label><label>Minutos<input name="minutes" type="number" min="5" max="${Math.max(480, t.minutes)}" value="${t.minutes}" required></label><label>Prioridad<select name="priority">${options(PRIORITIES, t.priority)}</select></label></div>${alert()}<div class="actions"><button>Guardar acción</button>${task ? '<button type="button" class="text-button" id="cancel-task">Retirar del plan</button>' : ""}</div></form>`,
  );
  const form = $("#task-form", host);
  $("[name=goal_id]", form).onchange = (event) => {
    $("[name=milestone_id]", form).innerHTML =
      '<option value="">Sin hito</option>' +
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
      await saved("Acción guardada.");
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
      await saved("Acción retirada. Su historial queda conservado.");
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
    habit ? "Ajustar hábito" : "Un hábito pequeño",
    `<form id="habit-form"><label>Qué quiero repetir<input name="title" value="${e(h.title)}" maxlength="160" required></label>${daysInputs(h.days)}<div class="form-grid"><label>Minutos<input name="minutes" type="number" min="5" max="120" value="${h.minutes}" required></label><label>Prioridad<select name="priority">${options(PRIORITIES, h.priority)}</select></label></div><label><input name="active" type="checkbox" ${h.active ? "checked" : ""}> Hábito activo</label>${alert()}<button>Guardar hábito</button></form>`,
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
      await saved("Hábito guardado.");
    });
  };
}
function proposalEditor(response) {
  const plan = response.proposal,
    requestId = response.job_id || uuid();
  const host = modal(
    response.goal_id ? "Revisar el ajuste" : "Tu propuesta, antes de guardar",
    `<p class="notice">${response.goal_id ? "Este ajuste reemplazará únicamente las acciones pendientes. Las completadas y sus recompensas se conservan." : "Esta propuesta todavía no está guardada. Puedes editar sus acciones y fechas antes de confirmar."}</p><p>${e(plan.summary)}</p><p><strong>Primera acción:</strong> ${e(plan.first_action)}</p><form id="proposal-form"><label>Meta<input name="title" value="${e(plan.title)}" maxlength="160" required></label><label>Descripción<textarea name="description" maxlength="3000">${e(plan.description)}</textarea></label><label>Resultado esperado<textarea name="outcome" maxlength="1000" required>${e(plan.outcome)}</textarea></label><label>Área<select name="category">${options(CATEGORIES, plan.category)}</select></label>${plan.milestones
      .map(
        (m, i) =>
          `<fieldset class="proposal-milestone"><legend>Hito ${i + 1}</legend><input aria-label="Título del hito ${i + 1}" data-milestone="${i}" value="${e(m.title)}" maxlength="160" required>${m.tasks
            .map((t, j) => {
              const d = new Date(plan.start_date + "T12:00:00Z");
              d.setUTCDate(d.getUTCDate() + t.day_offset);
              return `<div class="proposal-task" data-proposal-task="${i}:${j}"><label>Acción<input data-field="title" value="${e(t.title)}" maxlength="160" required></label><label>Detalles<textarea data-field="description" maxlength="3000">${e(t.description)}</textarea></label><div class="form-grid"><label>Hacer el<input data-field="date" type="date" value="${d.toISOString().slice(0, 10)}" required></label><label>Fecha límite<input data-field="deadline" type="date" value="${t.deadline || ""}"></label><label>Minutos<input data-field="minutes" type="number" min="5" max="120" value="${t.minutes}" required></label><label>Prioridad<select data-field="priority">${options(PRIORITIES, t.priority)}</select></label></div><button type="button" class="text-button" data-remove-proposal>Retirar acción</button></div>`;
            })
            .join("")}</fieldset>`,
      )
      .join("")}${alert()}<button>Confirmar y guardar el plan</button></form>`,
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
      await saved("Plan guardado. Tu siguiente paso ya tiene un lugar.");
    });
  };
}
function importPreview(data) {
  const host = modal(
    "Revisar antes de importar",
    `<p>Destino: <strong>${e(user.email)}</strong>. Solo se importará a esta cuenta.</p><p>${data.items.length} actividades de <strong>${e(data.source)}</strong>, con sus títulos, áreas, fechas y estados. No se borrarán los originales.</p><ul class="import-list">${data.items
      .slice(0, 30)
      .map(
        (t) =>
          `<li>${e(t.title)} · ${e(t.area)} · ${dateLabel(t.deadline)} · ${t.status === "completed" ? "Completada" : "Pendiente"}</li>`,
      )
      .join(
        "",
      )}</ul>${data.items.length > 30 ? "<p>Se muestran las primeras 30 actividades.</p>" : ""}<label><input type="checkbox" id="confirm-import"> Confirmo que estos datos son míos y quiero guardarlos en esta cuenta.</label>${alert()}<button id="import-confirm">Confirmar importación</button>`,
  );
  const requestId = uuid();
  $("#import-confirm", host).onclick = (event) =>
    busy(event.currentTarget, async () => {
      if (!$("#confirm-import", host).checked)
        throw new Error("Confirma primero la cuenta de destino.");
      const result = await rpc("import_legacy", {
        p_data: data,
        p_request_id: requestId,
      });
      await saved(
        `Importación guardada: ${result.added} actividades nuevas y ${result.skipped} ya existentes.`,
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
  closeModal();
  if (location.hash === "#reset") {
    authModal("reset");
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
render();
if (cloud) {
  cloud.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") {
        user = session?.user || null;
        authModal("reset");
        return;
      }
      if (!session) {
        companion.end();
        companionVoice.dispose();
        aiJobs.stop();
        stopMonetization();
        user = null;
        state = null;
        loadVersion++;
        render();
      } else if (session.user.id !== user?.id) {
        user = session.user;
        state = null;
        refresh();
      }
    }, 0);
  });
  checked(cloud.auth.getSession())
    .then((data) => {
      if (data.session) {
        user = data.session.user;
        const selectedPlan = consumeBillingIntent();
        if (selectedPlan) location.hash = `subscription?plan=${selectedPlan}`;
        refresh();
      }
    })
    .catch((error) => toast(errorMessage(error)));
}
