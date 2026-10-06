import { spriteSvg, dataUrl, drawSprite, star } from "./lumi-sprite.js";

const W = 360,
  H = 220;
const LEFT = ["ArrowLeft", "a", "A"],
  RIGHT = ["ArrowRight", "d", "D"];

/** Lluvia de estrellas: Lumi se mueve abajo y atrapa estrellas; las piedras quitan vidas. */
function catchGame(stage, random) {
  const ground = H - 34;
  const reach = stage >= 4 ? 34 : 26;
  const lumi = { x: W / 2, target: W / 2, dir: 0 };
  let items = [],
    spawn = 0,
    elapsed = 0,
    lives = 3,
    flash = 0;
  return {
    startWithAction: false,
    reset() {
      Object.assign(lumi, { x: W / 2, target: W / 2, dir: 0 });
      items = [];
      spawn = 0.5;
      elapsed = 0;
      lives = 3;
      flash = 0;
    },
    action(input = {}) {
      if (input.type === "down" || input.type === "move") lumi.target = input.x;
      if (input.type === "key") {
        if (LEFT.includes(input.key)) lumi.dir = input.down ? -1 : lumi.dir === -1 ? 0 : lumi.dir;
        if (RIGHT.includes(input.key)) lumi.dir = input.down ? 1 : lumi.dir === 1 ? 0 : lumi.dir;
        if (input.down) lumi.target = null;
      }
    },
    step(dt, game) {
      elapsed += dt;
      flash = Math.max(0, flash - dt);
      if (lumi.dir) lumi.x += lumi.dir * 300 * dt;
      else if (lumi.target !== null)
        lumi.x += Math.sign(lumi.target - lumi.x) * Math.min(Math.abs(lumi.target - lumi.x), 420 * dt);
      lumi.x = Math.max(24, Math.min(W - 24, lumi.x));
      spawn -= dt;
      if (spawn <= 0) {
        spawn = Math.max(0.38, 0.8 - elapsed * 0.01);
        const roll = random();
        items.push({
          x: 20 + random() * (W - 40),
          y: -12,
          kind: roll < 0.25 ? "rock" : roll < 0.33 ? "big" : "star",
        });
      }
      const fall = Math.min(110 + elapsed * 3, 250);
      for (const item of items) {
        item.y += fall * dt * (item.kind === "rock" ? 1.15 : 1);
        if (Math.abs(item.y - ground) < 18 && Math.abs(item.x - lumi.x) < reach) {
          item.done = true;
          if (item.kind === "rock") {
            lives--;
            flash = 0.4;
          } else game.score += item.kind === "big" ? 3 : 1;
        }
      }
      items = items.filter((item) => !item.done && item.y < H + 20);
      return lives > 0;
    },
    snapshot: () => ({ lumi: { ...lumi }, items: items.map((i) => ({ ...i })), lives, ground, reach }),
    draw(ctx, sprite, time) {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#1f4f55");
      sky.addColorStop(1, "#2e7d73");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ffffff55";
      for (let i = 0; i < 14; i++) ctx.fillRect((i * 97) % W, (i * 53) % 140, 2, 2);
      for (const item of items)
        if (item.kind === "rock") {
          ctx.fillStyle = "#8e7650";
          ctx.strokeStyle = "#5d4b31";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(item.x, item.y, 11, 9, time * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else star(ctx, item.x, item.y, item.kind === "big" ? 13 : 9);
      ctx.fillStyle = "#cfe9c4";
      ctx.fillRect(0, H - 14, W, 14);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < lives ? "#ecaaa2" : "#ffffff33";
        ctx.beginPath();
        ctx.arc(20 + i * 18, 18, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(lumi.x, ground);
      ctx.globalAlpha = flash ? 0.5 + 0.5 * Math.sin(time * 40) : 1;
      drawSprite(ctx, sprite, 56);
      ctx.restore();
    },
  };
}

/** ¿Dónde está Lumi?: toca a Lumi cuando asome; las nubes de tormenta restan. 30 segundos. */
function peekGame(stage, random) {
  const holes = [75, 180, 285].flatMap((x) => [95, 178].map((y) => ({ x, y })));
  // Orden de lectura para el teclado: 1-2-3 arriba, 4-5-6 abajo.
  holes.sort((a, b) => a.y - b.y || a.x - b.x);
  const ROUND = 30;
  let pops = [],
    spawn = 0,
    left = ROUND,
    hits = [];
  function hit(index, game) {
    const pop = pops.find((p) => p.hole === index && !p.hit);
    if (!pop) return;
    pop.hit = true;
    pop.life = Math.min(pop.life, 0.18);
    game.score = Math.max(0, game.score + (pop.kind === "cloud" ? -1 : 1));
    hits.push({ x: holes[index].x, y: holes[index].y - 40, t: 0.5, good: pop.kind !== "cloud" });
  }
  return {
    startWithAction: false,
    reset() {
      pops = [];
      spawn = 0.4;
      left = ROUND;
      hits = [];
    },
    action(input = {}, game) {
      if (!game) return;
      if (input.type === "down") {
        const index = holes.findIndex((h) => Math.hypot(h.x - input.x, h.y - 18 - input.y) < 42);
        if (index >= 0) hit(index, game);
      }
      if (input.type === "key" && input.down && /^[1-6]$/.test(input.key)) hit(Number(input.key) - 1, game);
    },
    step(dt) {
      left -= dt;
      const pace = 1 - left / ROUND;
      spawn -= dt;
      if (spawn <= 0 && pops.length < 2) {
        spawn = 0.75 - pace * 0.35;
        const free = holes.map((_, i) => i).filter((i) => !pops.some((p) => p.hole === i));
        const hole = free[Math.floor(random() * free.length)];
        pops.push({ hole, life: 1.15 - pace * 0.5, age: 0, kind: random() < 0.22 ? "cloud" : "lumi" });
      }
      for (const p of pops) {
        p.age += dt;
        p.life -= dt;
      }
      pops = pops.filter((p) => p.life > 0);
      for (const h of hits) h.t -= dt;
      hits = hits.filter((h) => h.t > 0);
      return left > 0;
    },
    overTitle: (game) => `¡Encontraste a Lumi ${game.score} ${game.score === 1 ? "vez" : "veces"}!`,
    snapshot: () => ({ pops: pops.map((p) => ({ ...p, ...holes[p.hole] })), left, holes }),
    draw(ctx, sprite) {
      ctx.fillStyle = "#cfe9c4";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#e4f3dc";
      ctx.fillRect(0, 0, W, 34);
      ctx.fillStyle = "#53b39c";
      ctx.fillRect(12, 12, (W - 24) * Math.max(0, left / ROUND), 8);
      holes.forEach((h, index) => {
        const pop = pops.find((p) => p.hole === index);
        ctx.fillStyle = "#6b5a3e";
        ctx.beginPath();
        ctx.ellipse(h.x, h.y, 36, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        if (pop) {
          const rise = Math.min(1, pop.age * 6, pop.life * 6);
          ctx.save();
          ctx.beginPath();
          ctx.rect(h.x - 40, h.y - 70, 80, 70);
          ctx.clip();
          ctx.translate(h.x, h.y + 22 - rise * 44);
          if (pop.kind === "cloud") {
            ctx.fillStyle = pop.hit ? "#9aa5a8" : "#6f7c80";
            for (const [dx, dy, r] of [[-12, 4, 13], [4, -4, 16], [16, 6, 11]]) {
              ctx.beginPath();
              ctx.arc(dx, dy, r, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.fillStyle = "#f2c568";
            ctx.beginPath();
            ctx.moveTo(2, 14);
            ctx.lineTo(-6, 28);
            ctx.lineTo(4, 26);
            ctx.lineTo(-2, 38);
            ctx.lineTo(12, 22);
            ctx.lineTo(4, 23);
            ctx.closePath();
            ctx.fill();
          } else drawSprite(ctx, sprite, 62);
          ctx.restore();
        }
        ctx.strokeStyle = "#4f4029";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(h.x, h.y, 36, 11, 0, 0, Math.PI);
        ctx.stroke();
        ctx.fillStyle = "#4b8d57";
        ctx.font = "600 11px Inter, 'Segoe UI', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(index + 1), h.x, h.y + 26);
      });
      for (const h of hits) {
        ctx.fillStyle = h.good ? "#247c6a" : "#914329";
        ctx.font = "700 16px Inter, 'Segoe UI', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(h.good ? "+1" : "-1", h.x, h.y - (0.5 - h.t) * 30);
      }
    },
  };
}

const ICONS = ["lumi", "star", "leaf", "heart", "moon", "sun"];
const COLS = 4,
  ROWS = 3,
  CW = 70,
  CH = 60,
  GAP_X = 10,
  GAP_Y = 8;
const X0 = (W - (COLS * CW + (COLS - 1) * GAP_X)) / 2,
  Y0 = (H - (ROWS * CH + (ROWS - 1) * GAP_Y)) / 2;

function drawIcon(ctx, icon, sprite) {
  ctx.lineWidth = 2;
  if (icon === "lumi") drawSprite(ctx, sprite, 54);
  else if (icon === "star") star(ctx, 0, 0, 18);
  else if (icon === "leaf") {
    ctx.fillStyle = "#b0db7e";
    ctx.strokeStyle = "#4b8d57";
    ctx.beginPath();
    ctx.moveTo(-14, 14);
    ctx.quadraticCurveTo(-16, -16, 16, -16);
    ctx.quadraticCurveTo(16, 14, -14, 14);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14, 14);
    ctx.lineTo(8, -8);
    ctx.stroke();
  } else if (icon === "heart") {
    ctx.fillStyle = "#ecaaa2";
    ctx.strokeStyle = "#b65f55";
    ctx.beginPath();
    ctx.moveTo(0, 15);
    ctx.bezierCurveTo(-24, -2, -12, -22, 0, -8);
    ctx.bezierCurveTo(12, -22, 24, -2, 0, 15);
    ctx.fill();
    ctx.stroke();
  } else if (icon === "moon") {
    ctx.fillStyle = "#fff4cf";
    ctx.strokeStyle = "#b67e26";
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0.6, Math.PI * 2 - 0.6);
    ctx.arc(8, 0, 12, Math.PI * 2 - 1, 1, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = "#f2c568";
    ctx.strokeStyle = "#b67e26";
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 4);
      ctx.fillRect(-2, -20, 4, 7);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** Memoria de Lumi: encuentra las seis parejas. Cada pareja suma 10 y cada error resta 2. */
function memoryGame(stage, random) {
  let cards = [],
    open = [],
    wait = 0,
    cursor = 0,
    misses = 0,
    pairs = 0;
  const flip = (index, game) => {
    const card = cards[index];
    if (!card || card.up || wait > 0 || open.length >= 2) return;
    card.up = true;
    open.push(index);
    if (open.length === 2) {
      const [a, b] = open.map((i) => cards[i]);
      if (a.icon === b.icon) {
        a.found = b.found = true;
        open = [];
        pairs++;
        game.score = Math.max(0, pairs * 10 - misses * 2);
      } else {
        misses++;
        game.score = Math.max(0, pairs * 10 - misses * 2);
        wait = 0.75;
      }
    }
  };
  return {
    startWithAction: false,
    reset() {
      cards = [...ICONS, ...ICONS].map((icon) => ({ icon, up: false, found: false }));
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      open = [];
      wait = 0;
      cursor = 0;
      misses = 0;
      pairs = 0;
    },
    action(input = {}, game) {
      if (!game) return;
      if (input.type === "down") {
        const col = Math.floor((input.x - X0) / (CW + GAP_X)),
          row = Math.floor((input.y - Y0) / (CH + GAP_Y));
        const insideX = input.x - X0 - col * (CW + GAP_X) <= CW,
          insideY = input.y - Y0 - row * (CH + GAP_Y) <= CH;
        if (col >= 0 && col < COLS && row >= 0 && row < ROWS && insideX && insideY) {
          cursor = row * COLS + col;
          flip(cursor, game);
        }
      }
      if (input.type === "key" && input.down) {
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS };
        if (input.key in moves) cursor = (cursor + moves[input.key] + cards.length) % cards.length;
        if ([" ", "Enter", "Spacebar"].includes(input.key)) flip(cursor, game);
      }
    },
    step(dt) {
      if (wait > 0) {
        wait -= dt;
        if (wait <= 0) {
          for (const i of open) cards[i].up = false;
          open = [];
        }
      }
      return pairs < ICONS.length;
    },
    overTitle: () => `¡Memoria completa! ${misses} ${misses === 1 ? "error" : "errores"}`,
    snapshot: () => ({ cards: cards.map((c) => ({ ...c })), open: [...open], wait, misses, pairs, cursor }),
    cardCenter: (index) => ({
      x: X0 + (index % COLS) * (CW + GAP_X) + CW / 2,
      y: Y0 + Math.floor(index / COLS) * (CH + GAP_Y) + CH / 2,
    }),
    draw(ctx, sprite) {
      ctx.fillStyle = "#eef5e8";
      ctx.fillRect(0, 0, W, H);
      cards.forEach((card, index) => {
        const x = X0 + (index % COLS) * (CW + GAP_X),
          y = Y0 + Math.floor(index / COLS) * (CH + GAP_Y);
        ctx.beginPath();
        ctx.roundRect(x, y, CW, CH, 10);
        ctx.fillStyle = card.up ? (card.found ? "#e2f4e9" : "#ffffff") : "#2e9b85";
        ctx.fill();
        ctx.lineWidth = index === cursor ? 4 : 2;
        ctx.strokeStyle = index === cursor ? "#dcad56" : "#247c6a";
        ctx.stroke();
        ctx.save();
        ctx.translate(x + CW / 2, y + CH / 2);
        if (card.up) drawIcon(ctx, card.icon, sprite);
        else star(ctx, 0, 0, 10, "#77cdb0", "#e2f4e9");
        ctx.restore();
      });
    },
  };
}

function catchThumb(stage) {
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<rect width="96" height="96" rx="22" fill="#1f4f55"/>
<path d="m22 14 2.5 5.5 6 .8-4.4 4 1.2 6-5.3-3-5.3 3 1.2-6-4.4-4 6-.8Z" fill="#f2c568"/>
<path d="m66 26 2 4.4 4.8.6-3.5 3.3 1 4.8-4.3-2.4-4.3 2.4 1-4.8-3.5-3.3 4.8-.6Z" fill="#f2c568"/>
<ellipse cx="78" cy="10" rx="6" ry="5" fill="#8e7650"/>
<rect y="86" width="96" height="10" fill="#cfe9c4"/>
${spriteSvg(stage, 'x="24" y="44" width="50" height="42"')}</svg>`);
}
function peekThumb(stage) {
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<rect width="96" height="96" rx="22" fill="#cfe9c4"/>
<ellipse cx="22" cy="80" rx="15" ry="5" fill="#6b5a3e"/><ellipse cx="74" cy="80" rx="15" ry="5" fill="#6b5a3e"/>
<clipPath id="h"><rect x="20" y="20" width="56" height="58"/></clipPath>
<g clip-path="url(#h)">${spriteSvg(stage, 'x="22" y="30" width="52" height="48"')}</g>
<ellipse cx="48" cy="78" rx="24" ry="7" fill="none" stroke="#4f4029" stroke-width="3"/>
<path d="M28 78a20 6 0 0 0 40 0" fill="#6b5a3e"/></svg>`);
}
function memoryThumb(stage) {
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<rect width="96" height="96" rx="22" fill="#eef5e8"/>
<rect x="10" y="10" width="34" height="36" rx="7" fill="#fff" stroke="#247c6a" stroke-width="2.5"/>
${spriteSvg(stage, 'x="11" y="15" width="32" height="27"')}
<rect x="52" y="10" width="34" height="36" rx="7" fill="#2e9b85" stroke="#247c6a" stroke-width="2.5"/>
<rect x="10" y="52" width="34" height="36" rx="7" fill="#2e9b85" stroke="#247c6a" stroke-width="2.5"/>
<rect x="52" y="52" width="34" height="36" rx="7" fill="#fff" stroke="#247c6a" stroke-width="2.5"/>
<path d="m69 59 3 6.3 7 .9-5.1 4.8 1.3 6.9-6.2-3.4-6.2 3.4 1.3-6.9-5.1-4.8 7-.9Z" fill="#f2c568" stroke="#b67e26" stroke-width="1.5"/>
<path d="m69 22 2 4 4 .6-3 2.8.7 4-3.7-2-3.7 2 .7-4-3-2.8 4-.6Z" fill="#77cdb0"/>
<path d="m27 64 2 4 4 .6-3 2.8.7 4-3.7-2-3.7 2 .7-4-3-2.8 4-.6Z" fill="#77cdb0"/></svg>`);
}

export const MORE_GAMES = [
  {
    id: "catch",
    name: "Lluvia de estrellas",
    hint: "Mueve a Lumi con el dedo, el ratón o las flechas. Evita las piedras.",
    stageHint: "Con tus alas atrapas desde más lejos.",
    thumb: catchThumb,
    logic: catchGame,
  },
  {
    id: "peek",
    name: "¿Dónde está Lumi?",
    hint: "Toca a Lumi cuando asome (o pulsa 1-6). Las nubes de tormenta restan.",
    thumb: peekThumb,
    logic: peekGame,
  },
  {
    id: "memory",
    name: "Memoria de Lumi",
    hint: "Encuentra las parejas. Con teclado: flechas y Espacio.",
    thumb: memoryThumb,
    logic: memoryGame,
  },
];
