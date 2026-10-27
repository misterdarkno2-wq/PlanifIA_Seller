// "Hablar con Lumi": chat con la mascota. Cada mensaje cuesta créditos que cobra y devuelve el
// servidor (función lumi-chat); el teléfono sólo muestra el saldo. Los saludos locales son gratis.
import { cloud, checked } from "./cloud.js";
import { portrait } from "./pet-art.js";
import { createLumiUtterance, lumiMouthFrames } from "./lumi-speech.js";
import { getPetMotionSettings } from "./pet-motion.js";
import { aiSourceLabel } from "./ai-source.js";
import { crisisHelp, detectCrisis } from "./crisis-help.js";
import { crisisText } from "../supabase/functions/_shared/crisis.js";
import { reportControl } from "./ai-report.js";
import { aiLanguage, lang, tr } from "./i18n.js";
import { serverText } from "./server-messages.js";

export const LUMI_CHAT_MAX = 500;

/** Llamadas a la nube; se pueden reemplazar en pruebas. */
export const lumiChatApi = {
  async load() {
    const { data, error } = await cloud
      .from("lumi_chat_messages")
      .select("id,role,content,created_at")
      .order("id", { ascending: false })
      .limit(100);
    if (error) throw new Error(tr("No pudimos cargar la conversación con Lumi.", "We couldn't load the conversation with Lumi."));
    return (data || []).reverse();
  },
  async send(text, requestId) {
    const { data, error } = await cloud.functions.invoke("lumi-chat", {
      // Lumi responde en el idioma de la app (el servidor acepta "es" o "en").
      body: { request_id: requestId, text, language: aiLanguage() },
    });
    if (error) {
      let detail;
      try {
        detail = await error.context?.json();
      } catch {}
      throw new Error(detail?.error || unconfirmed());
    }
    return data;
  },
  clear: () => checked(cloud.rpc("lumi_chat_clear")),
  /** El servidor comprueba que Lumi le haya dicho ese texto a esta cuenta y guarda su propia copia. */
  report: ({ id = null, content, reason, details }) =>
    checked(
      cloud.rpc("report_ai_content", {
        p_kind: "chat",
        p_ref: id == null ? null : String(id),
        p_content: content,
        p_reason: reason,
        p_details: details,
      }),
    ),
};

const unconfirmed = () =>
  tr(
    "No pudimos confirmar la respuesta. Revisa la conversación y tu saldo antes de volver a enviar.",
    "We couldn't confirm the reply. Check the conversation and your balance before sending again.",
  );
const greeting = (name) =>
  name
    ? tr(`¡Hola, ${name}! ¿De qué quieres conversar hoy?`, `Hi, ${name}! What would you like to talk about today?`)
    : tr("¡Hola! ¿De qué quieres conversar hoy?", "Hi! What would you like to talk about today?");

export function lumiChatPage({ stage = 1, name = "", escape }) {
  return `<section class="lumi-chat" data-lumi-chat aria-labelledby="lumi-chat-title">
    <div class="lumi-chat-stage" data-lumi-chat-stage>
      <div class="lumi-chat-portrait">${portrait(stage)}</div>
      <div class="lumi-chat-bubble"><span class="lumi-speaker" aria-hidden="true">${tr("Lumi dice", "Lumi says")}</span>
        <p data-lumi-chat-say role="status" aria-live="polite">${escape(greeting(name))}</p></div>
    </div>
    <div class="lumi-chat-head"><h1 id="lumi-chat-title">${tr("Hablar con Lumi", "Talk with Lumi")}</h1>
      <button type="button" class="text-button" data-lumi-chat-clear>${tr("Borrar conversación", "Delete conversation")}</button></div>
    <ol class="lumi-chat-log" data-lumi-chat-log aria-label="${tr("Conversación con Lumi", "Conversation with Lumi")}" aria-live="polite"></ol>
    <form class="lumi-chat-form" data-lumi-chat-form>
      <label class="sr-only" for="lumi-chat-input">${tr("Mensaje para Lumi", "Message for Lumi")}</label>
      <textarea id="lumi-chat-input" name="text" rows="2" maxlength="${LUMI_CHAT_MAX}" enterkeyhint="send" autocomplete="off" placeholder="${tr("Escríbele a Lumi…", "Write to Lumi…")}" required></textarea>
      <button data-lumi-chat-send>${tr("Enviar", "Send")}</button>
      <p class="error" role="alert" hidden></p>
      <p class="fine" data-lumi-chat-cost></p>
      <p class="fine lumi-chat-source" data-lumi-chat-source hidden></p>
    </form>
    <p class="muted fine lumi-chat-note">${tr("Lumi es una IA: puede equivocarse y no da consejos médicos, psicológicos, legales ni financieros. Tus mensajes se envían a la IA de PlanifIA o, si no está disponible, a la de respaldo de Groq, y se guardan los últimos 100. No compartas datos sensibles. Si una respuesta te parece ofensiva o peligrosa, usa «Reportar respuesta».", "Lumi is an AI: it can be wrong and doesn't give medical, psychological, legal or financial advice. Your messages are sent to PlanifIA's AI or, if it isn't available, to Groq's backup AI, and the last 100 are saved. Don't share sensitive data. If a reply seems offensive or dangerous, use “Report reply”.")}</p>
  </section>`;
}

/**
 * Monta el chat. `credits()` entrega { balance, chat_cost } desde el estado de monetización y
 * `onCredits(balance)` avisa el nuevo saldo que devolvió el servidor.
 */
export function mountLumiChat(root, {
  companion,
  voice,
  credits = () => null,
  onCredits = () => {},
  // Antes de enviar a la IA (por ejemplo, aceptar una versión nueva de los términos). false = no enviar.
  beforeSend = async () => true,
  api = lumiChatApi,
  uuid = () => crypto.randomUUID(),
} = {}) {
  const host = root.querySelector("[data-lumi-chat]");
  if (!host) return { dispose() {}, refreshCredits() {} };
  const stage = host.querySelector("[data-lumi-chat-stage]"),
    say = host.querySelector("[data-lumi-chat-say]"),
    log = host.querySelector("[data-lumi-chat-log]"),
    form = host.querySelector("[data-lumi-chat-form]"),
    input = form.querySelector("textarea"),
    send = form.querySelector("[data-lumi-chat-send]"),
    alert = form.querySelector("[role=alert]"),
    cost = form.querySelector("[data-lumi-chat-cost]"),
    sourceNote = form.querySelector("[data-lumi-chat-source]"),
    clear = host.querySelector("[data-lumi-chat-clear]");
  const svg = () => stage.querySelector(".lumi-art");
  const textMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const petMotion = getPetMotionSettings();
  let disposed = false,
    loading = true,
    clearing = false,
    sending = false,
    textTimer,
    talkTimer,
    mouth,
    clearArmed,
    consenting = false;

  function updateControls() {
    send.disabled = loading || clearing || sending;
    clear.disabled = loading || clearing || sending;
    input.readOnly = loading || clearing || sending;
    send.textContent = loading ? tr("Cargando…", "Loading…") : sending ? tr("Lumi piensa…", "Lumi is thinking…") : tr("Enviar", "Send");
    log.setAttribute("aria-busy", String(loading || clearing || sending));
  }

  function refreshCredits() {
    const c = credits();
    cost.textContent = c
      ? tr(`Cada mensaje usa ${c.chat_cost ?? 5} créditos · Tienes ${c.balance}`, `Each message uses ${c.chat_cost ?? 5} credits · You have ${c.balance}`)
      : tr("Cada mensaje usa 5 créditos", "Each message uses 5 credits");
  }
  // `report`: texto completo de una respuesta de la IA, que se puede reportar (id si ya está guardada).
  function item(role, text, report = null) {
    const li = document.createElement("li");
    li.className = `lumi-chat-message lumi-chat-${role}`;
    const who = document.createElement("span");
    who.className = "sr-only";
    who.textContent = role === "lumi" ? "Lumi: " : tr("Tú: ", "You: ");
    const body = document.createElement("p");
    body.textContent = text;
    li.append(who, body);
    if (report?.content)
      li.append(reportControl({ submit: (input) => api.report({ ...input, id: report.id, content: report.content }) }));
    log.append(li);
    li.scrollIntoView?.({ block: "end", behavior: textMotion.matches ? "auto" : "smooth" });
    return body;
  }
  // Aviso fijo de crisis: no lo escribe la IA, no se guarda y no se puede reportar.
  function safety(refunded = true) {
    const li = document.createElement("li");
    li.className = "lumi-chat-message lumi-chat-safety";
    li.append(crisisHelp({ refunded }));
    log.append(li);
    li.scrollIntoView?.({ block: "end", behavior: textMotion.matches ? "auto" : "smooth" });
    stopTalking();
    say.removeAttribute("aria-label");
    say.textContent = crisisText(lang()).title;
  }
  function stopTalking() {
    clearInterval(textTimer);
    clearTimeout(talkTimer);
    mouth?.cancel();
    mouth = null;
    voice?.stop?.();
    svg()?.classList.remove("lumi-speaking");
  }
  function thinking(on) {
    stage.classList.toggle("is-thinking", on);
    svg()?.classList.toggle("lumi-thinking", on);
  }
  // La respuesta aparece de a poco con la voz de sílabas y la boca, igual que los mensajes de Lumi.
  function speak(reply, targets) {
    stopTalking();
    const prefs = companion?.preferences || {};
    const utterance = createLumiUtterance(reply);
    const immediate = prefs.immediate || textMotion.matches || document.hidden;
    for (const node of targets) {
      node.setAttribute("aria-label", reply);
      node.textContent = immediate ? reply : "";
    }
    if (!immediate) {
      const startedAt = performance.now();
      textTimer = setInterval(() => {
        const fraction = Math.min(1, (performance.now() - startedAt) / (utterance.durationMs - 150));
        const shown = reply.slice(0, Math.ceil(reply.length * fraction));
        for (const node of targets) node.textContent = shown;
        if (fraction >= 1) clearInterval(textTimer);
      }, 26);
    }
    if (!petMotion.matches && !document.hidden) {
      svg()?.classList.add("lumi-speaking");
      mouth = svg()?.querySelector(".lumi-talking-mouth")?.animate(lumiMouthFrames(utterance), {
        duration: utterance.durationMs,
        easing: "linear",
      });
      talkTimer = setTimeout(() => {
        svg()?.classList.remove("lumi-speaking");
        mouth?.cancel();
        mouth = null;
      }, utterance.durationMs);
    }
    if (prefs.sound && !document.hidden) voice?.speak?.(Number(prefs.volume) || 0, utterance);
  }
  function showError(message) {
    alert.textContent = serverText(message);
    alert.hidden = false;
    // Sin créditos: lleva a Mi plan, donde se ganan con anuncios o invitaciones, o se compran.
    if (/créditos suficientes/.test(message)) {
      const link = document.createElement("a");
      link.href = "#subscription";
      link.textContent = tr(" Conseguir créditos →", " Get credits →");
      alert.append(link);
    }
  }
  async function submit() {
    const text = input.value.trim();
    if (loading || clearing || sending || disposed) return;
    if (!text) return input.focus();
    if (text.length > LUMI_CHAT_MAX)
      return showError(tr(`Escribe un mensaje de hasta ${LUMI_CHAT_MAX} caracteres.`, `Write a message of up to ${LUMI_CHAT_MAX} characters.`));
    alert.hidden = true;
    // Una crisis no se envía a la IA ni se cobra: se muestran líneas de ayuda de inmediato.
    if (detectCrisis(text)) {
      item("user", text);
      safety(true);
      input.value = "";
      return;
    }
    if (consenting) return;
    consenting = true;
    let allowed = false;
    try {
      allowed = await beforeSend();
    } catch {
    } finally {
      consenting = false;
    }
    if (!allowed || disposed) return;
    voice?.unlock?.();
    sending = true;
    alert.hidden = true;
    updateControls();
    const mine = item("user", text).closest("li");
    mine.classList.add("is-pending");
    thinking(true);
    stopTalking();
    say.removeAttribute("aria-label");
    say.textContent = tr("Lumi está pensando…", "Lumi is thinking…");
    try {
      const result = await api.send(text, uuid());
      if (disposed) return;
      mine.classList.remove("is-pending");
      input.value = "";
      thinking(false);
      const reply = String(result?.reply || "");
      if (result?.crisis) {
        safety(result.refunded !== false);
        return;
      }
      speak(reply, [say, item("lumi", "", { content: reply })]);
      if (Number.isFinite(result?.credits)) onCredits(result.credits);
      // Indicador discreto de qué IA respondió el último mensaje.
      const label = aiSourceLabel(result?.source);
      sourceNote.textContent = label ? tr(`Respondió: ${label}`, `Answered by: ${label}`) : "";
      sourceNote.hidden = !label;
      sourceNote.dataset.source = label ? result.source : "";
    } catch (error) {
      if (disposed) return;
      mine.remove();
      thinking(false);
      say.textContent = tr("Aquí sigo. Puedes intentarlo de nuevo cuando quieras.", "I'm still here. You can try again whenever you want.");
      showError(error.message || unconfirmed());
    } finally {
      if (!disposed) {
        sending = false;
        updateControls();
        refreshCredits();
        input.focus({ preventScroll: true });
      }
    }
  }
  const onSubmit = (event) => {
    event.preventDefault();
    submit();
  };
  // Enter envía; Shift+Enter hace un salto de línea.
  const onKey = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  // Borrar pide una segunda confirmación en el mismo botón (sin diálogos del sistema).
  const onClear = async () => {
    if (loading || clearing || sending || disposed) return;
    if (!clearArmed) {
      clearArmed = setTimeout(() => {
        clearArmed = null;
        clear.textContent = tr("Borrar conversación", "Delete conversation");
      }, 4000);
      clear.textContent = tr("¿Borrar todo? Toca otra vez", "Delete everything? Tap again");
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = null;
    clear.textContent = tr("Borrar conversación", "Delete conversation");
    clearing = true;
    updateControls();
    try {
      await api.clear();
      if (disposed) return;
      stopTalking();
      log.replaceChildren();
      say.removeAttribute("aria-label");
      say.textContent = tr("Listo, empezamos de nuevo. ¿Qué tienes en mente?", "Done, let's start over. What's on your mind?");
    } catch (error) {
      if (!disposed) showError(error.message || tr("No pudimos borrar la conversación.", "We couldn't delete the conversation."));
    } finally {
      clearing = false;
      if (!disposed) updateControls();
    }
  };
  form.addEventListener("submit", onSubmit);
  input.addEventListener("keydown", onKey);
  clear.addEventListener("click", onClear);
  refreshCredits();
  updateControls();
  api
    .load()
    .then((messages) => {
      if (disposed) return;
      for (const m of messages)
        m.role === "lumi" ? item("lumi", m.content, { id: m.id, content: m.content }) : item("user", m.content);
      const last = [...messages].reverse().find((m) => m.role === "lumi");
      if (last) say.textContent = last.content;
    })
    .catch((error) => !disposed && showError(error.message))
    .finally(() => {
      loading = false;
      if (!disposed) updateControls();
    });
  // En pantallas con teclado físico se enfoca el campo; en el teléfono no se abre el teclado solo.
  if (matchMedia("(pointer: fine)").matches) input.focus({ preventScroll: true });
  return {
    refreshCredits,
    dispose() {
      disposed = true;
      stopTalking();
      clearTimeout(clearArmed);
      form.removeEventListener("submit", onSubmit);
      input.removeEventListener("keydown", onKey);
      clear.removeEventListener("click", onClear);
    },
  };
}
