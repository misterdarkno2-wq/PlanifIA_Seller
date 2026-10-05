/** Original short oscillator syllables. No recordings or third party characters. */
export function createLumiVoice({
  contextFactory = () =>
    new (window.AudioContext || window.webkitAudioContext)(),
  random = Math.random,
} = {}) {
  let context,
    unlocked = false,
    nodes = [];
  function stop() {
    for (const node of nodes) {
      try {
        node.stop?.();
        node.disconnect();
      } catch {}
    }
    nodes = [];
  }
  return {
    async unlock() {
      try {
        context ||= contextFactory();
        await context.resume();
        unlocked = context.state === "running";
      } catch {
        unlocked = false;
      }
    },
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
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(270 + random() * 150, at);
        oscillator.frequency.exponentialRampToValueAtTime(
          360 + random() * 170,
          at + length,
        );
        filter.type = "lowpass";
        filter.frequency.value = 1100;
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(volume * 0.22, at + 0.012);
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
