import { test } from "node:test";
import assert from "node:assert/strict";
import { createLumiCompanion } from "../src/lumi-messages.js";
import { createLumiVoice } from "../src/lumi-voice.js";
import { createLumiUtterance, lumiMouthFrames } from "../src/lumi-speech.js";
const store = () => {
  const data = new Map();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
};

test("Sound starts enabled, migrates the old silent default once, and respects later mute choices", () => {
  const storage = store();
  const build = () => createLumiCompanion({ storage, session: store() });
  assert.equal(build().preferences.sound, true);
  storage.setItem("planifia-lumi-conversation", JSON.stringify({sound:false, volume:0.18, frequency:"quiet"}));
  const migrated = build();
  assert.equal(migrated.preferences.sound, true);
  assert.equal(migrated.preferences.volume, 0.28);
  assert.equal(migrated.preferences.frequency, "quiet");
  migrated.configure({ sound: false });
  assert.equal(build().preferences.sound, false);
  assert.equal(build().preferences.soundDefaultVersion, 2);
});

test("Greeting is session-scoped, optional, varied, and mood is never permanently stored", () => {
  const storage = store(),
    session = store();
  let time = 1000;
  const build = () =>
    createLumiCompanion({ storage, session, now: () => time, random: () => 0 });
  const lumi = build();
  assert.equal(lumi.start("a").askMood, true);
  const greeting = lumi.message;
  assert.equal(lumi.start("a").id, greeting.id);
  lumi.chooseMood("tired");
  assert.match(lumi.message.text, /cansado|pausa|ritmo/);
  assert.equal(lumi.message.askMood, false);
  assert.equal(
    [...storage.data.keys()].some((k) => /mood/.test(k)),
    false,
  );
  assert.equal(build().start("a").askMood, false);
  lumi.say("completed");
  const first = lumi.message.text;
  lumi.say("completed");
  assert.notEqual(lumi.message.text, first);
  lumi.configure({
    sound: true,
    volume: 99,
    immediate: true,
    frequency: "quiet",
    greetings: false,
  });
  assert.equal(build().preferences.sound, true);
  assert.equal(build().preferences.volume, 0.4);
  lumi.end();
  assert.equal(session.getItem("lumi-mood:a"), null);
  assert.equal(build().start("a").askMood, false);
  lumi.configure({ greetings: true });
  time += 5 * 86400000;
  assert.equal(build().start("a").kind, "return");
});

test("Synthesized voice needs user activation, never overlaps, and stops all oscillators on mute/dispose", async () => {
  const oscillators = [];
  let closed = false;
  const parameter = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  const node = () => ({
    connect() {},
    disconnect() {
      this.disconnected = true;
    },
    gain: parameter(),
    frequency: parameter(),
  });
  const context = {
    state: "suspended",
    currentTime: 0,
    destination: {},
    resume() {
      this.state = "running";
      return Promise.resolve();
    },
    close() {
      closed = true;
    },
    createGain: node,
    createBiquadFilter: node,
    createOscillator() {
      const osc = {
        ...node(),
        start(at) {
          this.started = true;
          this.at = at;
        },
        stop() {
          this.stops = (this.stops || 0) + 1;
        },
      };
      oscillators.push(osc);
      return osc;
    },
  };
  const voice = createLumiVoice({
    contextFactory: () => context,
    random: () => 0.5,
  });
  assert.equal(voice.speak(0.2), false);
  assert.equal(await voice.unlock(), true);
  assert.equal(voice.ready, true);
  assert.equal(voice.speak(0.2), true);
  assert.equal(oscillators.length, 6);
  assert.ok(oscillators.every((n) => n.type === "triangle"));
  voice.speak(0.1);
  assert.equal(oscillators.length, 12);
  assert.ok(
    oscillators.slice(0, 6).every((n) => n.stops === 2 && n.disconnected),
  );
  voice.stop();
  assert.ok(oscillators.every((n) => n.stops === 2 && n.disconnected));
  const phrase = createLumiUtterance("¡Hola! Soy Lumi. ¿Planificamos tu día juntos?", () => 0.5);
  const frames = lumiMouthFrames(phrase);
  context.currentTime = 10;
  voice.speak(0.2, phrase);
  const spoken = oscillators.slice(12);
  assert.ok(phrase.durationMs >= 2400 && phrase.durationMs <= 5200);
  assert.equal(spoken.length, phrase.syllables.length);
  assert.ok(spoken.length > 6, "The complete phrase is not truncated to the old six chirps");
  for (let i = 0; i < spoken.length; i++) {
    const syllable = phrase.syllables[i];
    assert.equal(spoken[i].at, 10 + syllable.at / 1000);
    const mouthOpensAt = frames[2 + i * 4].offset * phrase.durationMs;
    assert.ok(Math.abs(mouthOpensAt - syllable.at - 20) < 0.001, "The mouth opens with the same audio syllable");
  }
  assert.ok(frames.every((frame, i) => frame.offset >= 0 && frame.offset <= 1 && (!i || frame.offset >= frames[i-1].offset)));
  voice.dispose();
  assert.equal(closed, true);
});
