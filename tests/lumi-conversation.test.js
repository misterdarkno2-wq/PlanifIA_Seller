import { test } from "node:test";
import assert from "node:assert/strict";
import { createLumiCompanion } from "../src/lumi-messages.js";
import { createLumiVoice } from "../src/lumi-voice.js";
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
        start() {
          this.started = true;
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
  voice.dispose();
  assert.equal(closed, true);
});
