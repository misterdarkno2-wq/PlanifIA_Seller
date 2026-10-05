/** Original short oscillator syllables. No recordings or third party characters. */
export function createLumiVoice({
  contextFactory = () =>
    new (window.AudioContext || window.webkitAudioContext)(),
  random = Math.random,
} = {}) {
  let context,
    unlocked = false,
    unlocking,
    nodes = [];
  function stop() {
    for (const node of nodes) {
      try {
        node.stop?.();
      } catch {}
      try {
        node.disconnect();
      } catch {}
    }
    nodes = [];
  }
  return {
    async unlock() {
      if (unlocked && context?.state === "running") return true;
      if (unlocking) return unlocking;
      // resume() is invoked synchronously within the user's gesture.
      try {
        context ||= contextFactory();
        const current = context;
        unlocking = Promise.resolve(current.resume()).then(
          () => (unlocked = context === current && current.state === "running"),
          () => false,
        ).finally(() => { unlocking = null; });
        return await unlocking;
      } catch {
        unlocked = false;
        return false;
      }
    },
    get ready() { return unlocked && context?.state === "running"; },
    speak(volume) {
      stop();
      if (!unlocked || context?.state !== "running" || volume <= 0)
        return false;
      const start = context.currentTime;
      for (let i = 0; i < 6; i++) {
        const oscillator = context.createOscillator(),
          envelope = context.createGain(),
          filter = context.createBiquadFilter();
        const at = start + i * 0.15,
          length = 0.065 + random() * 0.045;
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(390 + random() * 210, at);
        oscillator.frequency.exponentialRampToValueAtTime(
          330 + random() * 260,
          at + length,
        );
        filter.type = "lowpass";
        filter.frequency.value = 1400;
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(volume * 0.42, at + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.001, at + length);
        oscillator.connect(filter);
        filter.connect(envelope);
        envelope.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + length + 0.01);
        nodes.push(oscillator, filter, envelope);
      }
      return true;
    },
    stop,
    dispose() {
      stop();
      context?.close();
      context = null;
      unlocked = false;
    },
  };
}
