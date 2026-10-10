// "Hablar con Lumi": chat con la mascota. Cada mensaje cuesta créditos que cobra y devuelve el
// servidor (función lumi-chat); el teléfono sólo muestra el saldo. Los saludos locales son gratis.
import { cloud, checked } from "./cloud.js";
import { portrait } from "./pet-art.js";
import { createLumiUtterance, lumiMouthFrames } from "./lumi-speech.js";
import { getPetMotionSettings } from "./pet-motion.js";

export const LUMI_CHAT_MAX = 500;

/** Llamadas a la nube; se pueden reemplazar en pruebas. */
export const lumiChatApi = {
  async load() {
    const { data, error } = await cloud
      .from("lumi_chat_messages")
      .select("id,role,content,created_at")
      .order("id", { ascending: false })
      .limit(100);
    if (error) throw new Error("No pudimos cargar la conversación con Lumi.");
    return (data || []).reverse();
  },
  async send(text, requestId) {
    const { data, error } = await cloud.functions.invoke("lumi-chat", {
      body: { request_id: requestId, text },
    });
    if (error) {
      let detail;
      try {
        detail = await error.context?.json();
      } catch {}
      throw new Error(detail?.error || "No pudimos confirmar la respuesta. Revisa la conversación y tu saldo antes de volver a enviar.");
    }
    return data;
  },
  clear: () => checked(cloud.rpc("lumi_chat_clear")),
};

const greeting = (name) =>
  name ? `¡Hola, ${name}! ¿De qué quieres conversar hoy?` : "¡Hola! ¿De qué quieres conversar hoy?";

export function lumiChatPage({ stage = 1, name = "", escape }) {
  return `<section class="lumi-chat" data-lumi-chat aria-labelledby="lumi-chat-title">
    <div class="lumi-chat-stage" data-lumi-chat-stage>
      <div class="lumi-chat-portrait">${portrait(stage)}</div>
      <div class="lumi-chat-bubble"><span class="lumi-speaker" aria-hidden="true">Lumi dice</span>
        <p data-lumi-chat-say role="status" aria-live="polite">${escape(greeting(name))}</p></div>
    </div>
    <div class="lumi-chat-head"><h1 id="lumi-chat-title">Hablar con Lumi</h1>
      <button type="button" class="text-button" data-lumi-chat-clear>Borrar conversación</button></div>
    <ol class="lumi-chat-log" data-lumi-chat-log aria-label="Conversación con Lumi" aria-live="polite"></ol>
    <form class="lumi-chat-form" data-lumi-chat-form>
      <label class="sr-only" for="lumi-chat-input">Mensaje para Lumi</label>
      <textarea id="lumi-chat-input" name="text" rows="2" maxlength="${LUMI_CHAT_MAX}" enterkeyhint="send" autocomplete="off" placeholder="Escríbele a Lumi…" required></textarea>
      <button data-lumi-chat-send>Enviar</button>
      <p class="error" role="alert" hidden></p>
      <p class="fine" data-lumi-chat-cost></p>
    </form>
    <p class="muted fine lumi-chat-note">Lumi es una IA: puede equivocarse. Tus mensajes se envían a la IA de PlanifIA y se guardan los últimos 100. No compartas datos sensibles.</p>
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
    clearArmed;

  function updateControls() {
    send.disabled = loading || clearing || sending;
    clear.disabled = loading || clearing || sending;
    input.readOnly = loading || clearing || sending;
    send.textContent = loading ? "Cargando…" : sending ? "Lumi piensa…" : "Enviar";
    log.setAttribute("aria-busy", String(loading || clearing || sending));
  }

  function refreshCredits() {
    const c = credits();
    cost.textContent = c
      ? `Cada mensaje usa ${c.chat_cost ?? 5} créditos · Tienes ${c.balance}`
      : "Cada mensaje usa 5 créditos";
  }
  function item(role, text) {
    const li = document.createElement("li");
    li.className = `lumi-chat-message lumi-chat-${role}`;
    const who = document.createElement("span");
    who.className = "sr-only";
    who.textContent = role === "lumi" ? "Lumi: " : "Tú: ";
    const body = document.createElement("p");
    body.textContent = text;
    li.append(who, body);
    log.append(li);
    li.scrollIntoView?.({ block: "end", behavior: textMotion.matches ? "auto" : "smooth" });
    return body;
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
    alert.textContent = message;
    alert.hidden = false;
    // Sin créditos: lleva a Mi plan, donde se ganan con anuncios o invitaciones, o se compran.
    if (/créditos suficientes/.test(message)) {
      const link = document.createElement("a");
      link.href = "#subscription";
      link.textContent = " Conseguir créditos →";
      alert.append(link);
    }
  }
  async function submit() {
    const text = input.value.trim();
    if (loading || clearing || sending || disposed) return;
    if (!text) return input.focus();
    if (text.length > LUMI_CHAT_MAX) return showError(`Escribe un mensaje de hasta ${LUMI_CHAT_MAX} caracteres.`);
    voice?.unlock?.();
    sending = true;
    alert.hidden = true;
    updateControls();
    const mine = item("user", text).closest("li");
    mine.classList.add("is-pending");
    thinking(true);
    stopTalking();
    say.removeAttribute("aria-label");
    say.textContent = "Lumi está pensando…";
    try {
      const result = await api.send(text, uuid());
      if (disposed) return;
      mine.classList.remove("is-pending");
      input.value = "";
      thinking(false);
      const reply = String(result?.reply || "");
      speak(reply, [say, item("lumi", "")]);
      if (Number.isFinite(result?.credits)) onCredits(result.credits);
    } catch (error) {
      if (disposed) return;
      mine.remove();
      thinking(false);
      say.textContent = "Aquí sigo. Puedes intentarlo de nuevo cuando quieras.";
      showError(error.message || "No pudimos confirmar la respuesta. Revisa la conversación y tu saldo antes de volver a enviar.");
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
        clear.textContent = "Borrar conversación";
      }, 4000);
      clear.textContent = "¿Borrar todo? Toca otra vez";
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = null;
    clear.textContent = "Borrar conversación";
    clearing = true;
    updateControls();
    try {
      await api.clear();
      if (disposed) return;
      stopTalking();
      log.replaceChildren();
      say.removeAttribute("aria-label");
      say.textContent = "Listo, empezamos de nuevo. ¿Qué tienes en mente?";
    } catch (error) {
      if (!disposed) showError(error.message || "No pudimos borrar la conversación.");
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
      for (const m of messages) item(m.role === "lumi" ? "lumi" : "user", m.content);
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
