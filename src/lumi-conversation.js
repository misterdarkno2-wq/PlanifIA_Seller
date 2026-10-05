import { LUMI_FREQUENCY } from "./lumi-messages.js";
import { createLumiVoice } from "./lumi-voice.js";
const MOODS = {
  energy: "Con energía",
  well: "Bien",
  tired: "Cansado",
  discouraged: "Desanimado",
  skip: "Omitir",
};
const presented = new WeakMap();

export const lumiConversationMarkup =
  () => `<section class="lumi-conversation" aria-label="Mensajes de Lumi">
  <div class="lumi-speech-bubble"><span class="lumi-speaker" aria-hidden="true">Lumi dice</span><p class="lumi-message-text" role="status" aria-live="polite"></p><svg class="lumi-bubble-tail" viewBox="0 0 32 36" aria-hidden="true"><path d="M31 2C20 5 18 19 3 32C21 32 30 24 31 21"/></svg></div><div class="lumi-moods" aria-label="Cómo te sientes" hidden>${Object.entries(
    MOODS,
  )
    .map(
      ([id, title]) =>
        `<button type="button" class="secondary" data-lumi-mood="${id}">${title}</button>`,
    )
    .join("")}</div>
  <div class="lumi-message-tools"><button class="text-button" data-lumi-mute type="button">Silenciar</button><button class="text-button" data-lumi-reveal type="button">Mostrar texto completo</button><button class="text-button" data-lumi-dismiss type="button">Cerrar mensaje</button></div>
  <small class="muted lumi-audio-status" data-lumi-audio-status></small>
  <small class="muted">Lumi es tu compañera virtual con IA. Tu respuesta de ánimo no se guarda en tu cuenta.</small></section>`;

export function lumiConversationSettings(model) {
  const p = model.preferences;
  return `<fieldset class="lumi-conversation-settings"><legend>Mensajes y sonido</legend>
    <label><input type="checkbox" data-lumi-preference="greetings" ${p.greetings ? "checked" : ""}> Saludar y preguntar cómo estoy al iniciar una sesión</label>
    <label><input type="checkbox" data-lumi-preference="sound" ${p.sound ? "checked" : ""}> Sonido suave al conversar</label>
    <label>Volumen<input type="range" min="0" max="0.4" step="0.02" value="${p.volume}" data-lumi-preference="volume"></label>
    <label><input type="checkbox" data-lumi-preference="immediate" ${p.immediate ? "checked" : ""}> Mostrar el texto completo inmediatamente</label>
    <label>Mensajes espontáneos<select data-lumi-preference="frequency">${[
      ["normal", "De vez en cuando"],
      ["quiet", "Pocos mensajes"],
      ["off", "Sólo saludos y progreso"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${p.frequency === v ? "selected" : ""}>${t}</option>`,
      )
      .join("")}</select></label>
    <p class="muted">Preferencias guardadas en este navegador. El sonido necesita una primera interacción y se silencia al salir de la pestaña.</p></fieldset>`;
}

/** Conversation lifecycle is separate from autonomous movement; no pet click handler. */
export function mountLumiConversation(root, model, options = {}) {
  const voice = options.voice || createLumiVoice(),
    ownsVoice = !options.voice;
  const messageRoot = root.querySelector(".lumi-conversation"),
    svg = root.querySelector("#pet .lumi-art");
  let textTimer,
    talkTimer,
    idleTimer,
    pendingSpeech = null,
    lastId = null,
    dismissed = null,
    disposed = false;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  function stop() {
    clearInterval(textTimer);
    clearTimeout(talkTimer);
    voice.stop();
    pendingSpeech = null;
    svg?.classList.remove("lumi-speaking");
  }
  function speaking() {
    if (motion.matches) return;
    svg?.classList.add("lumi-speaking");
    clearTimeout(talkTimer);
    talkTimer = setTimeout(() => svg?.classList.remove("lumi-speaking"), 1000);
  }
  function audioStatus() {
    if (!messageRoot) return;
    const node = messageRoot.querySelector("[data-lumi-audio-status]");
    node.textContent = model.preferences.sound && !voice.ready
      ? "Sonido activado. Se habilita al usar un control de la página."
      : "";
    node.hidden = !node.textContent;
  }
  function speakPending() {
    if (disposed || document.hidden || !model.preferences.sound ||
        messageRoot?.hidden || pendingSpeech !== model.message?.id ||
        pendingSpeech == null) return;
    if (voice.speak(model.preferences.volume)) {
      pendingSpeech = null;
      speaking();
    }
    audioStatus();
  }
  function show(message, initial = false) {
    if (!messageRoot || !message || dismissed === message.id) return;
    const prefs = model.preferences,
      isNew = message.id !== lastId;
    stop();
    messageRoot.hidden = false;
    const node = messageRoot.querySelector(".lumi-message-text");
    messageRoot.querySelector(".lumi-moods").hidden = !message.askMood;
    messageRoot.querySelector("[data-lumi-mute]").textContent = prefs.sound
      ? "Silenciar"
      : "Activar sonido";
    messageRoot
      .querySelector("[data-lumi-mute]")
      .setAttribute("aria-pressed", String(prefs.sound));
    // Screen readers receive one complete message, not an announcement per letter.
    node.setAttribute("aria-label", message.text);
    node.innerHTML = '<span aria-hidden="true"></span>';
    const visual = node.firstElementChild;
    const immediate =
      initial || !isNew || prefs.immediate || motion.matches || document.hidden;
    visual.textContent = immediate ? message.text : "";
    if (!immediate) {
      let offset = 0;
      textTimer = setInterval(() => {
        visual.textContent = message.text.slice(0, ++offset * 2);
        if (offset * 2 >= message.text.length) {
          clearInterval(textTimer);
          svg?.classList.remove("lumi-speaking");
        }
      }, 26);
      speaking();
    }
    if (isNew && !initial && prefs.sound && !document.hidden) {
      pendingSpeech = message.id;
      speakPending();
    }
    audioStatus();
    lastId = message.id;
    presented.set(model, message.id);
  }
  function schedule() {
    clearTimeout(idleTimer);
    const interval = LUMI_FREQUENCY[model.preferences.frequency];
    if (!messageRoot || !Number.isFinite(interval)) return;
    idleTimer = setTimeout(
      () => {
        if (!document.hidden && !model.message?.askMood) model.say("small");
        schedule();
      },
      interval * (0.85 + Math.random() * 0.3),
    );
  }
  const unsubscribe = model.subscribe((message) => {
    show(message);
    schedule();
  });
  const unlock = async () => {
    if (!model.preferences.sound || document.hidden) return;
    await voice.unlock();
    if (disposed || document.hidden) return;
    speakPending();
    audioStatus();
  };
  const visibility = () => {
    stop();
    if (!document.hidden) {
      show(model.message, true);
      schedule();
    } else clearTimeout(idleTimer);
  };
  const changed = (event) => {
    const field = event.target.closest("[data-lumi-preference]");
    if (!field) return;
    const key = field.dataset.lumiPreference;
    model.configure({
      [key]: field.type === "checkbox" ? field.checked : field.value,
    });
    if (key === "sound" && field.checked) {
      if (messageRoot && !messageRoot.hidden) pendingSpeech = model.message?.id;
      unlock();
    }
  };
  const click = async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-lumi-mood"))
      model.chooseMood(button.dataset.lumiMood);
    if (button.hasAttribute("data-lumi-mute")) {
      model.configure({ sound: !model.preferences.sound });
      if (model.preferences.sound) {
        pendingSpeech = model.message?.id;
        await unlock();
      }
    }
    if (button.hasAttribute("data-lumi-reveal")) {
      stop();
      show(model.message, true);
    }
    if (button.hasAttribute("data-lumi-dismiss")) {
      dismissed = model.message?.id;
      stop();
      messageRoot.hidden = true;
    }
  };
  root.addEventListener("click", click);
  root.addEventListener("change", changed);
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);
  document.addEventListener("visibilitychange", visibility);
  motion.addEventListener("change", visibility);
  // Existing messages on navigation are immediate and silent; no new greeting.
  show(model.message, presented.get(model) === model.message?.id);
  schedule();
  return () => {
    if (disposed) return;
    disposed = true;
    stop();
    clearTimeout(idleTimer);
    unsubscribe();
    if (ownsVoice) voice.dispose();
    root.removeEventListener("click", click);
    root.removeEventListener("change", changed);
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
    document.removeEventListener("visibilitychange", visibility);
    motion.removeEventListener("change", visibility);
  };
}
