import { portrait } from "./pet-art.js";

const W = 360,
  H = 220;

/** Lumi estática para canvas e imágenes: sin fondo, sombra ni capas que oculta el CSS. */
export function spriteSvg(stage, attributes = "") {
  return portrait(stage)
    .replace(
      /^<svg[^>]*>/,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 10 220 185" ${attributes}><style>.lumi-delighted-eyes,.lumi-talking-mouth{display:none}</style>`,
    )
    .replace(/<g class="lumi-shadow-position">.*?<\/g>/, "")
    .replace(/<circle cx="130" cy="105" r="87"[^>]*\/>/, "")
    .replace(/<g class="lumi-sparks"[^>]*>.*?<\/g>/, "");
}
const dataUrl = (svg) =>
  "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

function flapThumb(stage) {
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<rect width="96" height="96" rx="22" fill="#cfeef3"/><circle cx="74" cy="20" r="9" fill="#fff4cf"/>
<path d="M8 30q6-7 13 0q7-5 11 2H8Z" fill="#fff"/>
<rect x="64" y="-4" width="18" height="34" rx="4" fill="#53b39c" stroke="#247c6a" stroke-width="2.5"/>
<rect x="64" y="62" width="18" height="40" rx="4" fill="#53b39c" stroke="#247c6a" stroke-width="2.5"/>
<g transform="rotate(-12 36 50)">${spriteSvg(stage, 'x="12" y="30" width="48" height="40"')}</g>
<rect y="86" width="96" height="10" fill="#bfe0a6"/></svg>`);
}
function runThumb(stage) {
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<rect width="96" height="96" rx="22" fill="#fbf1dc"/><circle cx="20" cy="20" r="9" fill="#f2c568"/>
<path d="M0 74h96v22H0Z" fill="#e8d5ad"/><path d="M0 74h96" stroke="#b9996a" stroke-width="2.5"/>
<path d="M72 74V52q0-5 5-5t5 5v22M66 62q-4 0-4-5v-4M88 60q4 0 4-5v-4" fill="#77cdb0" stroke="#247c6a" stroke-width="2.5" stroke-linecap="round"/>
${spriteSvg(stage, 'x="10" y="22" width="50" height="42"')}
<path d="M14 70q8 4 16 0" fill="none" stroke="#b9996a" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>`);
}

export const LUMI_GAMES = [
  {
    id: "flap",
    name: "Vuelo de Lumi",
    hint: "Toca o pulsa Espacio para aletear entre los tubos.",
    thumb: flapThumb,
  },
  {
    id: "run",
    name: "Carrera de Lumi",
    hint: "Toca o pulsa Espacio para saltar los obstáculos.",
    thumb: runThumb,
  },
];

const readBest = (id) => {
  try {
    return Number(localStorage.getItem("planifia.game." + id)) || 0;
  } catch {
    return 0;
  }
};
const saveBest = (id, score) => {
  try {
    localStorage.setItem("planifia.game." + id, String(score));
  } catch {
    // Sin almacenamiento el récord dura sólo esta partida.
  }
};

function flapGame(stage) {
  const lumi = { x: 92, y: H / 2, vy: 0, r: 15 };
  let pipes = [],
    spawn = 0;
  const gap = stage >= 4 ? 112 : 102;
  return {
    reset() {
      Object.assign(lumi, { y: H / 2, vy: 0 });
      pipes = [];
      spawn = 0.4;
    },
    action() {
      lumi.vy = -330;
    },
    step(dt, game) {
      lumi.vy = Math.min(lumi.vy + 1350 * dt, 520);
      lumi.y += lumi.vy * dt;
      spawn -= dt;
      if (spawn <= 0) {
        spawn = 1.45;
        pipes.push({ x: W + 30, top: 30 + Math.random() * (H - 78 - gap), passed: false });
      }
      for (const p of pipes) {
        p.x -= 135 * dt;
        if (!p.passed && p.x + 26 < lumi.x) {
          p.passed = true;
          game.score++;
        }
        const nearX = Math.max(p.x - 26, Math.min(lumi.x, p.x + 26));
        for (const [top, bottom] of [
          [-50, p.top],
          [p.top + gap, H],
        ]) {
          const nearY = Math.max(top, Math.min(lumi.y, bottom));
          if ((lumi.x - nearX) ** 2 + (lumi.y - nearY) ** 2 < lumi.r ** 2) return false;
        }
      }
      pipes = pipes.filter((p) => p.x > -40);
      return lumi.y > 12 && lumi.y < H - 22;
    },
    snapshot: () => ({ lumi: { ...lumi }, pipes: pipes.map((p) => ({ ...p })), gap }),
    draw(ctx, sprite, time) {
      ctx.fillStyle = "#d8f1f4";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 3; i++) {
        const x = (((i * 140 - time * 18) % (W + 80)) + W + 80) % (W + 80) - 40;
        ctx.beginPath();
        ctx.ellipse(x, 40 + i * 24, 26, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const p of pipes)
        for (const [y, h] of [
          [-10, p.top + 10],
          [p.top + gap, H - p.top - gap],
        ]) {
          ctx.fillStyle = "#53b39c";
          ctx.strokeStyle = "#247c6a";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.roundRect(p.x - 26, y, 52, h, 6);
          ctx.fill();
          ctx.stroke();
        }
      ctx.fillStyle = "#bfe0a6";
      ctx.fillRect(0, H - 14, W, 14);
      ctx.save();
      ctx.translate(lumi.x, lumi.y);
      ctx.rotate(Math.max(-0.45, Math.min(0.9, lumi.vy / 600)));
      drawSprite(ctx, sprite, 52);
      ctx.restore();
    },
  };
}

function runGame(stage) {
  const ground = H - 30;
  const lumi = { x: 64, y: ground, vy: 0, jumps: 0 };
  const maxJumps = stage >= 4 ? 2 : 1;
  let obstacles = [],
    spawn = 0,
    speed = 230,
    distance = 0;
  return {
    reset() {
      Object.assign(lumi, { y: ground, vy: 0, jumps: 0 });
      obstacles = [];
      spawn = 1;
      speed = 230;
      distance = 0;
    },
    action() {
      if (lumi.jumps >= maxJumps) return;
      lumi.vy = lumi.jumps ? -520 : -610;
      lumi.jumps++;
    },
    step(dt, game) {
      speed = Math.min(speed + 9 * dt, 540);
      distance += speed * dt;
      game.score = Math.floor(distance / 40);
      lumi.vy += 2000 * dt;
      lumi.y = Math.min(ground, lumi.y + lumi.vy * dt);
      if (lumi.y === ground) {
        lumi.vy = 0;
        lumi.jumps = 0;
      }
      spawn -= dt;
      if (spawn <= 0) {
        spawn = (0.75 + Math.random() * 0.9) * (300 / speed) + 0.35;
        const tall = Math.random() < 0.4;
        obstacles.push({ x: W + 20, w: tall ? 18 : 26, h: tall ? 42 : 24, kind: tall ? "plant" : "rock" });
      }
      for (const o of obstacles) {
        o.x -= speed * dt;
        // Caja de colisión reducida para que los roces no cuenten.
        if (o.x < lumi.x + 15 && o.x + o.w > lumi.x - 15 && lumi.y - 6 > ground - o.h)
          return false;
      }
      obstacles = obstacles.filter((o) => o.x > -40);
      return true;
    },
    snapshot: () => ({ lumi: { ...lumi }, obstacles: obstacles.map((o) => ({ ...o })), speed, ground, maxJumps }),
    draw(ctx, sprite, time) {
      ctx.fillStyle = "#fbf4e4";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#f2c568";
      ctx.beginPath();
      ctx.arc(W - 46, 40, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e8d5ad";
      ctx.fillRect(0, ground, W, H - ground);
      ctx.strokeStyle = "#b9996a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, ground);
      ctx.lineTo(W, ground);
      for (let i = 0; i < 8; i++) {
        const x = (((i * 57 - distance * 0.9) % W) + W) % W;
        ctx.moveTo(x, ground + 10 + (i % 3) * 5);
        ctx.lineTo(x + 8, ground + 10 + (i % 3) * 5);
      }
      ctx.stroke();
      for (const o of obstacles) {
        ctx.fillStyle = o.kind === "plant" ? "#77cdb0" : "#c9b48b";
        ctx.strokeStyle = o.kind === "plant" ? "#247c6a" : "#8e7650";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(o.x, ground - o.h, o.w, o.h + 2, o.kind === "plant" ? 8 : 10);
        ctx.fill();
        ctx.stroke();
      }
      ctx.save();
      const bounce = lumi.y === ground ? Math.abs(Math.sin(time * 14)) * 3 : 0;
      ctx.translate(lumi.x, lumi.y - 23 - bounce);
      drawSprite(ctx, sprite, 58);
      ctx.restore();
    },
  };
}

/** Lógica sin dibujo, usada por el canvas y por las pruebas de jugabilidad. */
export const gameLogic = (id, stage) =>
  id === "flap" ? flapGame(stage) : runGame(stage);

function drawSprite(ctx, sprite, width) {
  const height = width * (185 / 220);
  if (sprite.complete && sprite.naturalWidth)
    ctx.drawImage(sprite, -width / 2, -height / 2, width, height);
  else {
    ctx.fillStyle = "#77cdb0";
    ctx.beginPath();
    ctx.arc(0, 0, width / 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Partida en un canvas; devuelve dispose para liberar el bucle y los eventos. */
export function playGame(host, gameId, stage, onExit) {
  const info = LUMI_GAMES.find((g) => g.id === gameId);
  const logic = gameLogic(gameId, stage);
  host.innerHTML = `<div class="lumi-game-bar"><button type="button" class="text-button" data-game-exit>← Juegos</button><strong>${info.name}</strong><span data-game-score aria-live="off">0</span></div>
    <canvas class="lumi-game-canvas" tabindex="0" role="img" aria-label="${info.name}. ${info.hint}"></canvas>
    <p class="lumi-game-hint">${info.hint}${stage >= 4 && gameId === "run" ? " Con tus alas puedes saltar dos veces." : ""}</p>`;
  const canvas = host.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const scoreLabel = host.querySelector("[data-game-score]");
  const sprite = new Image();
  sprite.src = dataUrl(spriteSvg(stage));
  const game = { state: "ready", score: 0, best: readBest(gameId) };
  let frame = 0,
    last = 0,
    time = 0,
    disposed = false;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || W;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(width * (H / W) * ratio);
  }
  function overlay(title, detail) {
    ctx.fillStyle = "rgba(23, 61, 58, 0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "700 22px Inter, 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(title, W / 2, H / 2 - 6);
    ctx.font = "500 13px Inter, 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(detail, W / 2, H / 2 + 20);
  }
  function render() {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    logic.draw(ctx, sprite, time);
    if (game.state === "ready") overlay("¡A jugar!", "Toca para empezar");
    else if (game.state === "paused") overlay("En pausa", "Toca para continuar");
    else if (game.state === "over")
      overlay(`Puntaje: ${game.score}`, `Récord: ${game.best} · Toca para reintentar`);
  }
  function loop(now) {
    frame = 0;
    if (disposed || game.state !== "playing") return;
    // Limitar dt evita atravesar obstáculos tras un tirón del navegador.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    time += dt;
    if (!logic.step(dt, game)) {
      game.state = "over";
      if (game.score > game.best) {
        game.best = game.score;
        saveBest(gameId, game.score);
      }
    }
    scoreLabel.textContent = String(game.score);
    render();
    if (game.state === "playing") frame = requestAnimationFrame(loop);
  }
  function press(event) {
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    if (game.state === "ready" || game.state === "over") {
      logic.reset();
      game.score = 0;
      scoreLabel.textContent = "0";
    }
    if (game.state !== "playing") {
      game.state = "playing";
      last = performance.now();
      frame = requestAnimationFrame(loop);
    }
    logic.action();
  }
  function key(event) {
    if ([" ", "Spacebar", "ArrowUp", "w", "W"].includes(event.key)) press(event);
  }
  function visibility() {
    if (document.hidden && game.state === "playing") {
      game.state = "paused";
      cancelAnimationFrame(frame);
      render();
    }
  }
  const onResize = () => {
    resize();
    render();
  };
  canvas.addEventListener("pointerdown", press);
  canvas.addEventListener("keydown", key);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("resize", onResize);
  sprite.addEventListener("load", render, { once: true });
  host.querySelector("[data-game-exit]").onclick = () => {
    dispose();
    onExit();
  };
  logic.reset();
  resize();
  render();
  canvas.focus({ preventScroll: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    canvas.removeEventListener("pointerdown", press);
    canvas.removeEventListener("keydown", key);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("resize", onResize);
  }
  return { dispose, state: () => ({ ...game }) };
}

/** Invitación de Lumi con los juegos disponibles durante la espera de la IA. */
export function mountLumiGames(host, { stage, onPlayingChange = () => {} }) {
  let active = null;
  function menu() {
    active = null;
    onPlayingChange(false);
    host.innerHTML = `<div class="lumi-speech-bubble lumi-games-bubble"><span class="lumi-speaker">Lumi</span><p>¿Quieres jugar conmigo mientras esperas? Te aviso apenas tu plan esté listo.</p></div>
      <div class="lumi-games-list">${LUMI_GAMES.map(
        (g) => `<button type="button" class="lumi-game-card" data-game="${g.id}"><img src="${g.thumb(stage)}" alt="" width="64" height="64"><span><strong>${g.name}</strong><small>Récord: ${readBest(g.id)}</small></span></button>`,
      ).join("")}</div>`;
    host.querySelectorAll("[data-game]").forEach(
      (button) =>
        (button.onclick = () => {
          onPlayingChange(true);
          active = playGame(host, button.dataset.game, stage, menu);
        }),
    );
  }
  menu();
  return {
    dispose() {
      active?.dispose();
      host.replaceChildren();
    },
  };
}
