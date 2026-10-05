/** One local rhythm shared by the mouth and the original synthesized syllables. */
export function createLumiUtterance(text, random = Math.random) {
  const durationMs = Math.max(2400, Math.min(5200, String(text).length * 32));
  const syllables = [];
  let at = 80;
  while (at + 160 < durationMs) {
    syllables.push({
      at,
      duration: 75 + random() * 45,
      shape: ["wide", "round", "small"][Math.floor(random() * 3)],
    });
    // Small pauses between groups keep the babble from sounding mechanical.
    at += 155 + random() * 45 + (syllables.length % 4 === 0 ? 150 : 0);
  }
  return { durationMs, syllables };
}

export function lumiMouthFrames({ durationMs, syllables }) {
  const closed = "scale(0.88, 0.12)";
  const shapes = {
    wide: "scale(1.08, 1)",
    round: "scale(0.65, 1.06)",
    small: "scale(0.94, 0.55)",
  };
  const frames = [{ offset: 0, transform: closed }];
  for (const syllable of syllables) {
    const offset = (ms) => ms / durationMs;
    frames.push(
      { offset: offset(syllable.at), transform: closed },
      { offset: offset(syllable.at + 20), transform: shapes[syllable.shape] },
      { offset: offset(syllable.at + syllable.duration), transform: shapes[syllable.shape] },
      { offset: offset(syllable.at + syllable.duration + 25), transform: closed },
    );
  }
  frames.push({ offset: 1, transform: closed });
  return frames;
}
