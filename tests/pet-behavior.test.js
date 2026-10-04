import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LUMI_BEHAVIOR,
  chooseLumiAction,
  createPetBehavior,
} from "../src/pet-behavior.js";

const actions = ["walk", "look", "jump", "stretch", "turn", "flip"];

test("Lumi intercala pausas de 8 a 20 segundos y reserva las piruetas", () => {
  assert.deepEqual(LUMI_BEHAVIOR.pauseMs, [8000, 20000]);
  assert.equal(LUMI_BEHAVIOR.flipCooldownMs, 60000);
  const counts = Object.fromEntries(actions.map((action) => [action, 0]));
  for (let index = 0; index < 1000; index++) {
    const action = chooseLumiAction({
      elapsedSinceFlip: Infinity,
      random: () => (index + 0.5) / 1000,
    });
    assert.ok(actions.includes(action));
    counts[action]++;
  }
  for (const action of actions) assert.ok(counts[action] > 0, action);
  assert.ok(counts.flip < counts.walk);
  assert.ok(counts.flip < counts.look);
  assert.ok(counts.flip <= 50, "las piruetas deben seguir siendo ocasionales");
});

test("El comportamiento varía sin repetir la última acción ni saltarse el descanso de piruetas", () => {
  for (const lastAction of actions) {
    const selected = new Set();
    for (let index = 0; index < 100; index++) {
      const action = chooseLumiAction({
        lastAction,
        elapsedSinceFlip: Infinity,
        random: () => index / 100,
      });
      assert.notEqual(action, lastAction);
      selected.add(action);
    }
    assert.ok(selected.size >= 4, "debe conservar alternativas espontáneas");
  }
  for (let index = 0; index < 100; index++) {
    assert.notEqual(
      chooseLumiAction({
        elapsedSinceFlip: LUMI_BEHAVIOR.flipCooldownMs - 1,
        random: () => index / 100,
      }),
      "flip",
    );
  }
});

function fakeClock() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: time + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    pending: () => timers.size,
    async advance(milliseconds) {
      const target = time + milliseconds;
      for (let guard = 0; guard < 10000; guard++) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        time = timer.at;
        timer.callback();
        for (let flush = 0; flush < 4; flush++) await Promise.resolve();
      }
      time = target;
      for (let flush = 0; flush < 4; flush++) await Promise.resolve();
    },
  };
}

class TrackedEventTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options) {
    const set = this.listeners.get(type) || new Set();
    set.add(listener);
    this.listeners.set(type, set);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

function petFixture({ reduced = false } = {}) {
  const clock = fakeClock();
  const document = new TrackedEventTarget();
  document.hidden = false;
  document.visibilityState = "visible";
  const motionQuery = new TrackedEventTarget();
  motionQuery.matches = reduced;
  document.defaultView = {
    matchMedia: () => motionQuery,
    getComputedStyle: (element) => {
      const call = element.animationCalls?.findLast(({ animation }) =>
        ["running", "paused", "finished"].includes(animation.playState),
      );
      if (!call) return element.style;
      const first = /^translateX\((-?[\d.]+)px\)$/.exec(
        call.keyframes[0].transform,
      );
      const last = /^translateX\((-?[\d.]+)px\)$/.exec(
        call.keyframes.at(-1).transform,
      );
      if (!first || !last) return element.style;
      const progress = Math.min(
        1,
        call.animation.currentTime / call.options.duration,
      );
      const position =
        Number(first[1]) + (Number(last[1]) - Number(first[1])) * progress;
      return {
        ...element.style,
        transform: `matrix(1, 0, 0, 1, ${position}, 0)`,
      };
    },
  };
  const calls = [];
  const elements = new Map();
  function element(selector) {
    const target = new TrackedEventTarget();
    const attributes = new Map();
    const classes = new Set();
    target.dataset = {};
    target.style = {
      transform: "",
      setProperty(name, value) {
        this[name] = value;
      },
      removeProperty(name) {
        delete this[name];
      },
    };
    target.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force ?? !classes.has(name)) classes.add(name);
        else classes.delete(name);
      },
    };
    target.setAttribute = (name, value) => attributes.set(name, String(value));
    target.getAttribute = (name) => attributes.get(name) ?? null;
    target.removeAttribute = (name) => attributes.delete(name);
    target.getBoundingClientRect = () => ({ width: 260, height: 220 });
    target.ownerDocument = document;
    target.animationCalls = [];
    target.animate = (keyframes, options) => {
      const duration = options.duration;
      const animation = new TrackedEventTarget();
      let timer;
      let elapsed = 0;
      let started = clock.now();
      let resolve, reject;
      animation.finished = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      animation.finished.catch(() => {});
      animation.playState = "running";
      animation.effect = {
        getTiming: () => options,
        getComputedTiming: () => ({
          duration,
          progress: animation.currentTime / duration,
        }),
      };
      Object.defineProperty(animation, "currentTime", {
        get: () =>
          elapsed +
          (animation.playState === "running" ? clock.now() - started : 0),
      });
      function finish() {
        elapsed = duration;
        animation.playState = "finished";
        animation.onfinish?.();
        animation.dispatchEvent(new Event("finish"));
        resolve(animation);
      }
      animation.pause = () => {
        if (animation.playState !== "running") return;
        elapsed += clock.now() - started;
        clock.clearTimeout(timer);
        animation.playState = "paused";
      };
      animation.play = () => {
        if (animation.playState !== "paused") return;
        started = clock.now();
        animation.playState = "running";
        timer = clock.setTimeout(finish, Math.max(0, duration - elapsed));
      };
      animation.cancel = () => {
        clock.clearTimeout(timer);
        animation.playState = "idle";
        animation.oncancel?.();
        reject(new Error("Animation canceled"));
      };
      animation.commitStyles = () => {};
      timer = clock.setTimeout(finish, duration);
      const call = { selector, at: clock.now(), keyframes, options, animation };
      calls.push(call);
      target.animationCalls.push(call);
      return animation;
    };
    target.querySelector = (name) => elements.get(name) || null;
    target.querySelectorAll = () => [...elements.values()];
    return target;
  }
  for (const selector of [
    ".lumi-position",
    ".lumi-shadow-position",
    ".lumi-action",
    ".lumi-pupils",
    ".lumi-foot-left",
    ".lumi-foot-right",
    ".lumi-rest-arm",
    ".lumi-wave-arm",
  ])
    elements.set(selector, element(selector));
  const svg = element("svg");
  return {
    svg,
    clock,
    document,
    motionQuery,
    calls,
    async visibility(hidden) {
      document.hidden = hidden;
      document.visibilityState = hidden ? "hidden" : "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await clock.advance(0);
    },
    async reduce(matches) {
      motionQuery.matches = matches;
      motionQuery.dispatchEvent(new Event("change"));
      await clock.advance(0);
    },
  };
}

function startBehavior(fixture, options = {}) {
  return createPetBehavior(fixture.svg, {
    clock: fixture.clock,
    motionQuery: fixture.motionQuery,
    random: () => 0,
    ...options,
  });
}

async function finishAction(fixture) {
  const remaining = fixture.calls
    .filter(({ animation }) => animation.playState === "running")
    .map(({ animation, options }) => options.duration - animation.currentTime);
  assert.ok(remaining.length > 0, "la acción debe tener una animación activa");
  await fixture.clock.advance(Math.max(...remaining) + 1);
}

test("Lumi comienza a moverse sola y los clics no provocan reacciones", async () => {
  const fixture = petFixture();
  const behavior = startBehavior(fixture);
  assert.equal(behavior.getState().state, "idle");
  assert.equal(fixture.svg.listenerCount(), 0);
  await fixture.clock.advance(7999);
  assert.equal(fixture.calls.length, 0);
  await fixture.clock.advance(1);
  assert.equal(behavior.getState().state, "walk");
  const beforeClick = behavior.getState();
  const beforeCalls = fixture.calls.length;
  fixture.svg.dispatchEvent(new Event("click"));
  fixture.svg.dispatchEvent(new Event("pointerenter"));
  await fixture.clock.advance(0);
  assert.deepEqual(behavior.getState(), beforeClick);
  assert.equal(fixture.calls.length, beforeCalls);
  await finishAction(fixture);
  assert.equal(behavior.getState().state, "idle");
  assert.ok(Math.abs(behavior.getState().position) <= LUMI_BEHAVIOR.maxTravel);
  behavior.dispose();
});

test("Los desplazamientos sucesivos empiezan donde terminó el anterior y permanecen en su espacio", async () => {
  const fixture = petFixture();
  const behavior = startBehavior(fixture, { initialPosition: 17 });
  let walkCount = 0;
  for (let action = 0; action < 12; action++) {
    const before = behavior.getState().position;
    const callCount = fixture.calls.length;
    await fixture.clock.advance(8000);
    const positionCall = fixture.calls
      .slice(callCount)
      .find(({ selector }) => selector === ".lumi-position");
    if (positionCall) {
      walkCount++;
      assert.equal(
        positionCall.keyframes[0].transform,
        `translateX(${before}px)`,
      );
    }
    await finishAction(fixture);
    const after = behavior.getState().position;
    assert.ok(Math.abs(after) <= LUMI_BEHAVIOR.maxTravel);
    if (positionCall)
      assert.equal(
        positionCall.keyframes.at(-1).transform,
        `translateX(${after}px)`,
      );
    else assert.equal(after, before);
  }
  assert.ok(walkCount >= 4);
  assert.ok(fixture.calls.every(({ selector }) => selector !== "svg"));
  behavior.dispose();
});

test("Los intervalos espontáneos se pueden configurar sin alterar el controlador", async () => {
  const fixture = petFixture();
  const behavior = startBehavior(fixture, {
    random: () => 0.75,
    config: { ...LUMI_BEHAVIOR, pauseMs: [100, 200] },
  });
  await fixture.clock.advance(174);
  assert.equal(fixture.calls.length, 0);
  await fixture.clock.advance(1);
  assert.notEqual(behavior.getState().state, "idle");
  assert.ok(fixture.calls.length > 0);
  behavior.dispose();
});

test("La celebración espera la acción en curso y conserva la reacción de mayor prioridad", async () => {
  const fixture = petFixture();
  const behavior = startBehavior(fixture, { initialPosition: 10 });
  await fixture.clock.advance(8000);
  assert.equal(behavior.getState().state, "walk");
  await fixture.clock.advance(350);
  const beforeReaction = behavior.getState();
  const beforeCalls = fixture.calls.length;
  behavior.celebrate("happy");
  behavior.celebrate("level");
  behavior.celebrate("evolve");
  behavior.celebrate("happy");
  assert.equal(behavior.getState().state, "walk");
  assert.equal(behavior.getState().pendingReaction, "evolve");
  assert.equal(behavior.getState().position, beforeReaction.position);
  assert.equal(fixture.calls.length, beforeCalls);
  await finishAction(fixture);
  assert.equal(behavior.getState().state, "celebrate");
  assert.equal(fixture.svg.dataset.lumiReaction, "evolve");
  assert.equal(behavior.getState().pendingReaction, null);
  const celebrationPosition = behavior.getState().position;
  await finishAction(fixture);
  assert.equal(behavior.getState().state, "idle");
  assert.equal(behavior.getState().position, celebrationPosition);
  const callsAfterCelebration = fixture.calls.length;
  await fixture.clock.advance(7998);
  assert.equal(fixture.calls.length, callsAfterCelebration);
  behavior.dispose();
});

test("Recrear Lumi desde su estado conserva la evolución activa o pendiente y su prioridad", async () => {
  for (const scenario of ["pending-walk", "active-evolve", "pending-evolve"]) {
    const original = petFixture();
    const previous = startBehavior(original);
    if (scenario === "pending-walk") {
      await original.clock.advance(8350);
      previous.celebrate("evolve");
    } else {
      previous.celebrate(scenario === "active-evolve" ? "evolve" : "happy");
      await original.clock.advance(350);
      previous.celebrate(scenario === "active-evolve" ? "happy" : "evolve");
    }
    // Una pose expresiva capturada por getComputedStyle durante el movimiento.
    original.svg.querySelector(".lumi-action").style.transform =
      "matrix(1, 0, 0, 1, 0, -4)";
    const snapshot = previous.getState();
    assert.equal(snapshot.resumeReaction, "evolve", scenario);
    previous.dispose();
    assert.equal(original.clock.pending(), 0);

    const recreated = petFixture();
    const resumed = startBehavior(recreated, {
      initialPosition: snapshot.position,
      initialPose: snapshot.pose,
      initialReaction: snapshot.resumeReaction,
      lastFlipAt: snapshot.lastFlipAt,
    });
    assert.equal(resumed.getState().position, snapshot.position);
    assert.equal(resumed.getState().pendingReaction, "evolve");
    assert.equal(recreated.calls[0].keyframes[0].transform, snapshot.pose);
    await finishAction(recreated);
    assert.equal(resumed.getState().state, "celebrate");
    assert.equal(recreated.svg.dataset.lumiReaction, "evolve");
    assert.equal(resumed.getState().pendingReaction, null);
    await finishAction(recreated);
    assert.equal(resumed.getState().state, "idle");
    assert.equal(resumed.getState().position, snapshot.position);
    assert.equal(resumed.getState().resumeReaction, null);
    resumed.dispose();
  }
});

test("Las pausas conservan el tiempo pendiente al ocultar la pestaña", async () => {
  const fixture = petFixture();
  const behavior = startBehavior(fixture);
  await fixture.clock.advance(3000);
  await fixture.visibility(true);
  assert.equal(behavior.getState().paused, true);
  assert.equal(fixture.clock.pending(), 0);
  await fixture.clock.advance(30000);
  assert.equal(fixture.calls.length, 0);
  await fixture.visibility(false);
  assert.equal(behavior.getState().paused, false);
  await fixture.clock.advance(4999);
  assert.equal(fixture.calls.length, 0);
  await fixture.clock.advance(1);
  assert.equal(behavior.getState().state, "walk");
  behavior.dispose();
});

test("Ocultar la pestaña pausa la acción sin cambiar la posición y luego la reanuda", async () => {
  const fixture = petFixture();
  const behavior = startBehavior(fixture);
  await fixture.clock.advance(8300);
  await fixture.visibility(true);
  const pausedPosition = behavior.getState().position;
  const playing = fixture.calls.filter(
    ({ animation }) => animation.playState === "paused",
  );
  assert.ok(playing.length > 0);
  const times = playing.map(({ animation }) => animation.currentTime);
  await fixture.clock.advance(30000);
  assert.equal(behavior.getState().position, pausedPosition);
  assert.deepEqual(
    playing.map(({ animation }) => animation.currentTime),
    times,
  );
  await fixture.visibility(false);
  assert.ok(
    playing.every(({ animation }) => animation.playState === "running"),
  );
  await finishAction(fixture);
  assert.equal(behavior.getState().state, "idle");
  behavior.dispose();
});

test("Reducir movimiento mantiene una presentación tranquila, incluso ante el progreso", async () => {
  const fixture = petFixture({ reduced: true });
  const behavior = startBehavior(fixture);
  await fixture.clock.advance(120000);
  assert.equal(behavior.getState().reduced, true);
  assert.equal(behavior.getState().position, 0);
  assert.equal(fixture.calls.length, 0);
  behavior.celebrate("level");
  await fixture.clock.advance(10000);
  assert.equal(fixture.calls.length, 0);
  assert.equal(behavior.getState().position, 0);
  await fixture.reduce(false);
  await fixture.clock.advance(8000);
  assert.equal(behavior.getState().state, "walk");
  await fixture.clock.advance(350);
  const beforeReduction = behavior.getState().position;
  assert.notEqual(beforeReduction, 0);
  await fixture.reduce(true);
  assert.equal(behavior.getState().position, beforeReduction);
  const callsAfterReduction = fixture.calls.length;
  await fixture.clock.advance(120000);
  assert.equal(fixture.calls.length, callsAfterReduction);
  assert.equal(behavior.getState().reduced, true);
  behavior.dispose();
});

test("El progreso durante una pestaña oculta se conserva sin animación al reducir movimiento", async () => {
  const fixture = petFixture({ reduced: true });
  const behavior = startBehavior(fixture);
  behavior.celebrate("happy");
  await fixture.clock.advance(500);
  assert.equal(behavior.getState().state, "celebrate");
  await fixture.visibility(true);
  assert.equal(behavior.getState().state, "idle");
  assert.equal(fixture.clock.pending(), 0);

  behavior.celebrate("level");
  behavior.celebrate("evolve");
  behavior.celebrate("happy");
  await fixture.reduce(false);
  await fixture.reduce(true);
  await fixture.clock.advance(30000);
  assert.equal(behavior.getState().pendingReaction, "evolve");
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.clock.pending(), 0);

  await fixture.visibility(false);
  assert.equal(behavior.getState().state, "celebrate");
  assert.equal(fixture.svg.dataset.lumiReaction, "evolve");
  assert.equal(behavior.getState().pendingReaction, null);
  await fixture.clock.advance(1499);
  assert.equal(behavior.getState().state, "celebrate");
  await fixture.clock.advance(1);
  assert.equal(behavior.getState().state, "idle");
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.clock.pending(), 0);
  behavior.dispose();
});

test("Alternar rápido movimiento reducido no deja que una caminata cancelada cambie la posición", async () => {
  const fixture = petFixture();
  const behavior = startBehavior(fixture);
  await fixture.clock.advance(8300);
  const stoppedPosition = behavior.getState().position;
  const firstWalk = fixture.calls.find(
    ({ selector }) => selector === ".lumi-position",
  );
  assert.notEqual(
    firstWalk.keyframes.at(-1).transform,
    `translateX(${stoppedPosition}px)`,
  );

  // Ambas preferencias cambian en el mismo turno, antes de resolver finished.
  fixture.motionQuery.matches = true;
  fixture.motionQuery.dispatchEvent(new Event("change"));
  fixture.motionQuery.matches = false;
  fixture.motionQuery.dispatchEvent(new Event("change"));
  await fixture.clock.advance(0);
  assert.equal(behavior.getState().state, "idle");
  assert.equal(behavior.getState().position, stoppedPosition);
  assert.equal(fixture.clock.pending(), 1);

  await fixture.clock.advance(8000);
  const nextWalk = fixture.calls.findLast(
    ({ selector }) => selector === ".lumi-position",
  );
  assert.notEqual(nextWalk, firstWalk);
  assert.equal(
    nextWalk.keyframes[0].transform,
    `translateX(${stoppedPosition}px)`,
  );
  behavior.dispose();
});

test("Desmontar cancela las animaciones, temporizadores y listeners sin reactivarlos", async () => {
  const fixture = petFixture();
  const behavior = startBehavior(fixture);
  await fixture.clock.advance(8000);
  assert.ok(fixture.clock.pending() > 0);
  assert.ok(fixture.document.listenerCount() > 0);
  assert.ok(fixture.motionQuery.listenerCount() > 0);
  behavior.dispose();
  behavior.dispose();
  assert.equal(behavior.getState().disposed, true);
  assert.equal(fixture.clock.pending(), 0);
  assert.equal(fixture.document.listenerCount(), 0);
  assert.equal(fixture.motionQuery.listenerCount(), 0);
  assert.ok(
    fixture.calls.every(({ animation }) => animation.playState === "idle"),
  );
  const callsAfterDisposal = fixture.calls.length;
  behavior.celebrate("evolve");
  await fixture.visibility(true);
  await fixture.visibility(false);
  await fixture.reduce(false);
  await fixture.clock.advance(120000);
  assert.equal(fixture.clock.pending(), 0);
  assert.equal(fixture.calls.length, callsAfterDisposal);
});
