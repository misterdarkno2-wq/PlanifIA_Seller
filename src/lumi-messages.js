/** Local conversation only: none of these messages calls an AI provider. */
export const LUMI_MESSAGES = {
  welcome: [
    "¡Hola! Soy Lumi. ¿Planificamos tu día juntos? ¿Cómo estás hoy?",
    "¡Qué bueno verte! ¿Cómo estás hoy?",
    "Un nuevo rato para tus metas. ¿Cómo te sientes hoy?",
    "Hola, aquí tienes tu espacio para avanzar a tu ritmo. ¿Cómo estás?",
  ],
  small: [
    "Un paso pequeño también cuenta. Puedes elegir una acción que quepa en tu día.",
    "No hace falta resolverlo todo hoy. Un siguiente paso es suficiente.",
    "¿Tienes unos minutos? Una acción breve puede ser un buen comienzo.",
  ],
  completed: [
    "¡Una acción completada! Date un momento para reconocer ese paso.",
    "Lo que acabas de hacer suma. Puedes seguir a tu ritmo.",
    "¡Bien hecho! Ese esfuerzo ya es parte de tu camino.",
  ],
  milestone: [
    "¡Un hito alcanzado! Tu meta tiene una etapa más recorrida.",
    "Has completado una etapa. Puedes celebrar antes de elegir el siguiente paso.",
  ],
  goal: [
    "¡Meta alcanzada! Vale la pena reconocer todo el camino que hiciste.",
    "Has llegado al resultado que buscabas. Disfruta este logro a tu manera.",
  ],
  level: [
    "¡Lumi subió de nivel con tu progreso! Cada acción cuenta.",
    "¡Un nuevo nivel! Tus pasos van haciendo crecer este pequeño compañero virtual.",
  ],
  evolve: [
    "¡Lumi tiene una nueva forma! Tu progreso queda contigo.",
    "¡Una nueva etapa para Lumi! Puedes celebrarla sin apurar el siguiente paso.",
  ],
  return: [
    "Puedes retomar desde donde te resulte cómodo. No hay nada que compensar.",
    "Qué bueno que vuelvas a tu espacio. Podemos empezar por algo pequeño.",
  ],
  waiting: [
    "Tu propuesta está en preparación. Puedes seguir organizando tus metas.",
    "El trabajo sigue guardado aunque cierres esta ventana. Volverás a encontrarlo aquí.",
  ],
  energy: [
    "Con esa energía, puedes elegir una prioridad y reservarle un rato. Tú decides cuál.",
    "Puedes aprovechar este momento para un paso importante. Elige el que tenga sentido hoy.",
  ],
  well: [
    "Podemos ir paso a paso. Una acción manejable puede encajar bien hoy.",
    "Puedes elegir tu siguiente paso sin prisa. Tu plan está aquí para ayudarte.",
  ],
  tired: [
    "Si estás cansado, una acción breve o una pausa pueden ser buenas opciones. Tú eliges.",
    "Hoy puede ser un día para bajar el ritmo. Puedes escoger algo pequeño o descansar.",
  ],
  discouraged: [
    "Gracias por expresarlo. Si quieres, podemos empezar por un paso muy manejable.",
    "Si el plan se siente pesado, puedes revisarlo o hacer una pausa. No hace falta resolverlo todo ahora.",
  ],
};
export const LUMI_FREQUENCY = { normal: 120000, quiet: 300000, off: Infinity };

export function createLumiCompanion({
  storage,
  session,
  random = Math.random,
  now = Date.now,
} = {}) {
  const listeners = new Set(),
    history = [];
  let account = null,
    model = null,
    sequence = 0,
    mood = null;
  const read = (store, key, fallback) => {
    try {
      return JSON.parse(store?.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (store, key, value) => {
    try {
      store?.setItem(key, JSON.stringify(value));
    } catch {}
  };
  const saved = read(storage, "planifia-lumi-conversation", {});
  let preferences = {
    sound: true,
    volume: 0.28,
    immediate: false,
    greetings: true,
    frequency: "normal",
    ...saved,
  };
  // The first release saved its muted default even without an explicit choice.
  // Apply the requested audible default once; subsequent mute choices persist.
  if (saved.soundDefaultVersion !== 2) {
    preferences.sound = true;
    if (preferences.volume === 0.18) preferences.volume = 0.28;
  }
  preferences.soundDefaultVersion = 2;
  write(storage, "planifia-lumi-conversation", preferences);
  function say(kind, askMood = false) {
    if (!account) return;
    const library = LUMI_MESSAGES[kind] || LUMI_MESSAGES.small;
    const candidates = library.filter(
      (text) => !history.slice(-2).includes(text),
    );
    const texts = candidates.length ? candidates : library;
    const text = texts[Math.floor(random() * texts.length) % texts.length];
    history.push(text);
    model = { id: ++sequence, text, kind, askMood };
    listeners.forEach((listener) => listener(model));
    return model;
  }
  return {
    start(id) {
      if (account === id) return model;
      account = id;
      mood = read(session, `lumi-mood:${id}`, null);
      const greeted = read(session, `lumi-greeted:${id}`, false),
        last = read(storage, `lumi-seen:${id}`, 0);
      write(storage, `lumi-seen:${id}`, now());
      if (!greeted && preferences.greetings) {
        write(session, `lumi-greeted:${id}`, true);
        return say(
          last && now() - last > 3 * 86400000 ? "return" : "welcome",
          true,
        );
      }
      return say(mood || "small");
    },
    end() {
      try {
        session?.removeItem(`lumi-greeted:${account}`);
        session?.removeItem(`lumi-mood:${account}`);
      } catch {}
      account = null;
      mood = null;
      model = null;
    },
    chooseMood(value) {
      const allowed = ["energy", "well", "tired", "discouraged"];
      mood = allowed.includes(value) ? value : null;
      // Session-only storage: never sent to Supabase or written to localStorage.
      write(session, `lumi-mood:${account}`, mood);
      return say(mood || "small");
    },
    say,
    get message() {
      return model;
    },
    get preferences() {
      return { ...preferences };
    },
    configure(values) {
      preferences = { ...preferences, ...values };
      preferences.volume = Math.max(
        0,
        Math.min(0.4, Number(preferences.volume) || 0),
      );
      if (!Object.hasOwn(LUMI_FREQUENCY, preferences.frequency))
        preferences.frequency = "quiet";
      write(storage, "planifia-lumi-conversation", preferences);
      if (!preferences.greetings && model?.askMood) {
        say("small");
        return;
      }
      listeners.forEach((listener) => listener(model));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
