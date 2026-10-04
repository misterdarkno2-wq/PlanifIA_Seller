export const LUMI_BEHAVIOR = Object.freeze({
  pauseMs: [8000, 20000],
  flipCooldownMs: 60000,
  maxTravel: 18,
  actions: {
    walk: { weight: 4, duration: [1900, 3100] },
    look: { weight: 4, duration: [1600, 2600] },
    jump: { weight: 2, duration: [850, 1250] },
    stretch: { weight: 3, duration: [1600, 2300] },
    turn: { weight: 2, duration: [1400, 2100] },
    flip: { weight: 0.35, duration: [1500, 1900] },
  },
});
const REACTION_PRIORITY = { happy: 1, level: 2, evolve: 3 };

export function chooseLumiAction({
  lastAction,
  elapsedSinceFlip,
  random = Math.random,
  config = LUMI_BEHAVIOR,
}) {
  const choices = Object.entries(config.actions).filter(
    ([name]) =>
      name !== lastAction &&
      (name !== "flip" || elapsedSinceFlip >= config.flipCooldownMs),
  );
  let pick =
    random() * choices.reduce((sum, [, action]) => sum + action.weight, 0);
  for (const [name, action] of choices) {
    pick -= action.weight;
    if (pick < 0) return name;
  }
  return choices.at(-1)[0];
}

/** One controller per SVG. It owns its timers, animations and environmental listeners. */
export function createPetBehavior(svg, options = {}) {
  const doc = svg.ownerDocument;
  const view = doc.defaultView;
  const config = options.config || LUMI_BEHAVIOR;
  const random = options.random || Math.random;
  const clock = options.clock || {
    now: () => performance.now(),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
  };
  const motion =
    options.motionQuery || view.matchMedia("(prefers-reduced-motion: reduce)");
  const position = svg.querySelector(".lumi-position");
  const shadow = svg.querySelector(".lumi-shadow-position");
  const actor = svg.querySelector(".lumi-action");
  const pupils = svg.querySelector(".lumi-pupils");
  // The final crown needs more clearance at the top of the same SVG canvas.
  const crowned = Number(svg.dataset.lumiStage) === 5;
  const animations = new Set();
  let x = Math.max(
    -config.maxTravel,
    Math.min(config.maxTravel, options.initialPosition || 0),
  );
  let state = "idle";
  let lastAction = null;
  let lastFlipAt = options.lastFlipAt ?? clock.now();
  let pendingReaction = REACTION_PRIORITY[options.initialReaction]
    ? options.initialReaction
    : null;
  let timer = null;
  let dueAt = 0;
  let remaining = null;
  let running = false;
  let generation = 0;
  let disposed = false;
  let paused = doc.hidden;
  let reduced = motion.matches;

  const between = ([minimum, maximum]) =>
    minimum + random() * (maximum - minimum);
  const translation = (value) => `translateX(${value}px)`;
  function setState(next, reaction) {
    state = next;
    svg.dataset.lumiState = next;
    if (reaction) svg.dataset.lumiReaction = reaction;
    else delete svg.dataset.lumiReaction;
  }
  function readTransform(element) {
    return view.getComputedStyle(element).transform || "none";
  }
  function readPosition() {
    const transform = readTransform(position);
    const values = transform
      .slice(transform.indexOf("(") + 1, -1)
      .split(",")
      .map(Number);
    if (transform.startsWith("matrix3d(")) return values[12];
    if (transform.startsWith("matrix(")) return values[4];
    const translated = /^translateX\((-?[\d.]+)px\)$/.exec(transform);
    return translated ? Number(translated[1]) : x;
  }
  function place(value) {
    x = value;
    position.style.transform = translation(x);
    shadow.style.transform = translation(x);
  }
  function animate(element, frames, duration, easing = "ease-in-out") {
    const animation = element.animate(frames, {
      duration,
      easing,
      fill: "forwards",
    });
    animations.add(animation);
    if (paused) animation.pause();
    return animation.finished.catch(() => {});
  }
  function clearTimer() {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }
  function schedule(delay = between(config.pauseMs)) {
    clearTimer();
    if (disposed || paused || reduced || running) return;
    dueAt = clock.now() + delay;
    timer = clock.setTimeout(() => {
      timer = null;
      if (disposed || paused || reduced) return;
      const action = chooseLumiAction({
        lastAction,
        elapsedSinceFlip: clock.now() - lastFlipAt,
        random,
        config,
      });
      run(action);
    }, delay);
  }
  async function perform(action, duration, reaction) {
    const direction = random() < 0.5 ? -1 : 1;
    const neutral = "translateY(0px) rotate(0deg) scale(1)";
    if (action === "walk") {
      const distance = between([12, 24]);
      let target = Math.max(
        -config.maxTravel,
        Math.min(config.maxTravel, x + direction * distance),
      );
      if (Math.abs(target - x) < 5)
        target = Math.max(
          -config.maxTravel,
          Math.min(config.maxTravel, x - direction * distance),
        );
      await Promise.all([
        animate(
          position,
          [{ transform: translation(x) }, { transform: translation(target) }],
          duration,
          "ease-in-out",
        ),
        animate(
          shadow,
          [{ transform: translation(x) }, { transform: translation(target) }],
          duration,
          "ease-in-out",
        ),
        animate(
          actor,
          Array.from({ length: 9 }, (_, i) => ({
            transform:
              i % 2
                ? `translateY(-2px) rotate(${direction * (i % 4 === 1 ? -2 : 2)}deg)`
                : neutral,
          })),
          duration,
        ),
      ]);
      return target;
    } else if (action === "look") {
      await animate(
        pupils,
        [
          { transform: "translate(0,0)" },
          { transform: `translate(${direction * 4}px,-1px)`, offset: 0.25 },
          { transform: `translate(${direction * 4}px,-1px)`, offset: 0.5 },
          { transform: `translate(${-direction * 3}px,1px)`, offset: 0.78 },
          { transform: "translate(0,0)" },
        ],
        duration,
      );
    } else if (action === "jump") {
      await animate(
        actor,
        [
          { transform: neutral },
          { transform: "translateY(3px) scale(1.025,0.96)", offset: 0.2 },
          {
            transform: `translateY(${crowned ? -6 : -12}px) rotate(${crowned ? 0 : direction * 3}deg)`,
            offset: 0.48,
          },
          { transform: "translateY(2px) scale(1.025,0.97)", offset: 0.78 },
          { transform: neutral },
        ],
        duration,
      );
    } else if (action === "stretch") {
      await animate(
        actor,
        [
          { transform: neutral },
          {
            transform: crowned
              ? `rotate(${direction}deg) scale(0.98,1.008)`
              : `rotate(${direction * 4}deg) scale(0.97,1.025)`,
            offset: 0.4,
          },
          {
            transform: crowned
              ? `rotate(${-direction}deg) scale(1.015,0.985)`
              : `rotate(${-direction * 3}deg) scale(1.025,0.98)`,
            offset: 0.72,
          },
          { transform: neutral },
        ],
        duration,
      );
    } else if (action === "turn") {
      await animate(
        actor,
        [
          { transform: neutral },
          {
            transform: `rotate(${direction * (crowned ? 4 : 7)}deg) scaleX(0.72)`,
            offset: 0.32,
          },
          {
            transform: `rotate(${-direction * (crowned ? 3 : 5)}deg) scaleX(0.82)`,
            offset: 0.65,
          },
          { transform: neutral },
        ],
        duration,
      );
    } else if (action === "flip") {
      lastFlipAt = clock.now();
      await animate(
        actor,
        [
          { transform: neutral },
          { transform: "translateY(2px) scale(0.9)", offset: 0.12 },
          {
            transform: "translateY(-5px) rotate(0deg) scale(0.66)",
            offset: 0.22,
          },
          {
            transform: `translateY(-9px) rotate(${direction * 90}deg) scale(0.66)`,
            offset: 0.38,
          },
          {
            transform: `translateY(-12px) rotate(${direction * 180}deg) scale(0.66)`,
            offset: 0.52,
          },
          {
            transform: `translateY(-9px) rotate(${direction * 270}deg) scale(0.66)`,
            offset: 0.66,
          },
          {
            transform: `translateY(-5px) rotate(${direction * 360}deg) scale(0.66)`,
            offset: 0.8,
          },
          {
            transform: `translateY(1px) rotate(${direction * 360}deg) scale(0.92)`,
            offset: 0.88,
          },
          {
            transform: `translateY(0px) rotate(${direction * 360}deg) scale(1)`,
          },
        ],
        duration,
        "cubic-bezier(.35,0,.65,1)",
      );
    } else if (action === "celebrate") {
      await animate(
        actor,
        [
          { transform: neutral },
          {
            transform: `translateY(${crowned ? -3 : -9}px) rotate(${crowned ? 0 : -4}deg)`,
            offset: 0.22,
          },
          { transform: neutral, offset: 0.4 },
          {
            transform: `translateY(${crowned ? -4 : -11}px) rotate(${crowned ? 0 : 4}deg)`,
            offset: 0.62,
          },
          { transform: neutral },
        ],
        duration,
      );
    } else if (action === "settle") {
      await animate(
        actor,
        [{ transform: options.initialPose }, { transform: neutral }],
        duration,
      );
    }
  }
  async function run(action, reaction) {
    if (disposed || running || paused || reduced) return;
    clearTimer();
    running = true;
    const version = ++generation;
    setState(action === "settle" ? "idle" : action, reaction);
    const duration =
      action === "celebrate"
        ? reaction === "evolve"
          ? 2000
          : 1500
        : action === "settle"
          ? 300
          : between(config.actions[action].duration);
    const nextPosition = await perform(action, duration, reaction);
    if (disposed || version !== generation) return;
    if (typeof nextPosition === "number") place(nextPosition);
    actor.style.transform = "";
    pupils.style.transform = "";
    for (const animation of animations) animation.cancel();
    animations.clear();
    running = false;
    if (action !== "celebrate" && action !== "settle") lastAction = action;
    setState("idle");
    if (!paused && !reduced) {
      if (pendingReaction) {
        const next = pendingReaction;
        pendingReaction = null;
        run("celebrate", next);
      } else schedule();
    }
  }
  function celebrate(kind = "happy") {
    if (disposed) return;
    if (!REACTION_PRIORITY[kind]) kind = "happy";
    if (paused || running) {
      if (REACTION_PRIORITY[kind] > (REACTION_PRIORITY[pendingReaction] || 0))
        pendingReaction = kind;
    } else if (reduced) {
      // Calm expression only; there is no positional or rotation animation.
      setState("celebrate", kind);
      clearTimer();
      dueAt = clock.now() + 1500;
      timer = clock.setTimeout(() => {
        timer = null;
        if (!disposed) setState("idle");
      }, 1500);
    } else run("celebrate", kind);
  }
  function visibility() {
    if (disposed) return;
    paused = doc.hidden;
    svg.classList.toggle("lumi-paused", paused);
    if (paused) {
      if (timer !== null) remaining = Math.max(0, dueAt - clock.now());
      clearTimer();
      if (reduced) {
        setState("idle");
        remaining = null;
      }
      for (const animation of animations) animation.pause();
    } else {
      for (const animation of animations) animation.play();
      if (!running) {
        if (pendingReaction) {
          const next = pendingReaction;
          pendingReaction = null;
          celebrate(next);
        } else if (!reduced) schedule(remaining ?? between(config.pauseMs));
      }
      remaining = null;
    }
  }
  function motionChange() {
    if (disposed) return;
    reduced = motion.matches;
    clearTimer();
    if (reduced) {
      ++generation;
      x = readPosition();
      for (const animation of animations) animation.cancel();
      animations.clear();
      place(x);
      actor.style.transform = "";
      pupils.style.transform = "";
      running = false;
      setState("idle");
      if (pendingReaction && !paused) {
        const next = pendingReaction;
        pendingReaction = null;
        celebrate(next);
      }
    } else if (!paused) {
      setState("idle");
      if (pendingReaction) {
        const next = pendingReaction;
        pendingReaction = null;
        celebrate(next);
      } else schedule();
    }
  }
  function getState() {
    const activeReaction = svg.dataset.lumiReaction;
    return {
      state,
      position: readPosition(),
      pose: readTransform(actor),
      pendingReaction,
      resumeReaction:
        (REACTION_PRIORITY[pendingReaction] || 0) >
        (REACTION_PRIORITY[activeReaction] || 0)
          ? pendingReaction
          : activeReaction || null,
      paused,
      reduced,
      disposed,
      lastFlipAt,
    };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    ++generation;
    clearTimer();
    for (const animation of animations) animation.cancel();
    animations.clear();
    doc.removeEventListener("visibilitychange", visibility);
    motion.removeEventListener("change", motionChange);
  }
  place(x);
  setState("idle");
  svg.classList.toggle("lumi-paused", paused);
  doc.addEventListener("visibilitychange", visibility);
  motion.addEventListener("change", motionChange);
  if (options.initialPose && options.initialPose !== "none" && !reduced)
    run("settle");
  else if (pendingReaction && !paused) {
    const next = pendingReaction;
    pendingReaction = null;
    celebrate(next);
  } else schedule();
  return { celebrate, getState, dispose };
}
