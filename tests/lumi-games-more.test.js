import { test } from "node:test";
import assert from "node:assert/strict";
import { MORE_GAMES } from "../src/lumi-games-more.js";

const DT = 1 / 60;
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const logic = (id, stage, seed = 7) =>
  MORE_GAMES.find((g) => g.id === id).logic(stage, seeded(seed));
function play(game, seconds, bot = () => {}) {
  const state = { score: 0 };
  game.reset();
  for (let i = 0; i < seconds / DT; i++) {
    bot(game, state);
    if (!game.step(DT, state)) return { over: true, score: state.score, t: i * DT };
  }
  return { over: false, score: state.score };
}

for (const stage of [1, 3, 5]) {
  test(`Lluvia de estrellas (etapa ${stage}): las piedras quitan vidas y moverse bien da puntos`, () => {
    // Una Lumi quieta bajo una lluvia de piedras termina perdiendo.
    const idle = play(logic("catch", stage, 3), 600);
    assert.equal(idle.over, true);
    const played = play(logic("catch", stage, 3), 60, (g) => {
      const { lumi, items, ground } = g.snapshot();
      const rock = items.find((i) => i.kind === "rock" && i.y > ground - 70 && Math.abs(i.x - lumi.x) < 40);
      const goal = rock
        ? { x: lumi.x + (rock.x > lumi.x ? -90 : 90) }
        : items.filter((i) => i.kind !== "rock").sort((a, b) => b.y - a.y)[0];
      g.action({ type: "move", x: goal ? goal.x : lumi.x });
    });
    assert.ok(played.score >= 30, `puntaje ${played.score}`);
  });
}

test("Lluvia de estrellas: el teclado mueve a Lumi y suelta la tecla la detiene", () => {
  const g = logic("catch", 2);
  g.reset();
  g.action({ type: "key", key: "ArrowLeft", down: true });
  for (let i = 0; i < 30; i++) g.step(DT, { score: 0 });
  const moved = g.snapshot().lumi.x;
  assert.ok(moved < 180);
  g.action({ type: "key", key: "ArrowLeft", down: false });
  g.step(DT, { score: 0 });
  assert.equal(g.snapshot().lumi.x, moved);
});

test("¿Dónde está Lumi?: dura 30 s, tocar a Lumi suma y tocar nubes resta", () => {
  const good = play(logic("peek", 3), 40, (g, s) => {
    for (const p of g.snapshot().pops)
      if (!p.hit && p.kind === "lumi" && p.age > 0.15) g.action({ type: "down", x: p.x, y: p.y - 18 }, s);
  });
  assert.equal(good.over, true);
  assert.ok(Math.abs(good.t - 30) < 0.1);
  assert.ok(good.score >= 20, `puntaje ${good.score}`);
  const clouds = play(logic("peek", 3), 40, (g, s) => {
    for (const p of g.snapshot().pops)
      if (!p.hit && p.age > 0.15) g.action({ type: "down", x: p.x, y: p.y - 18 }, s);
  });
  assert.ok(clouds.score < good.score, "tocar también las nubes da menos puntos");
  const keys = logic("peek", 3);
  const s = { score: 0 };
  keys.reset();
  while (!keys.snapshot().pops.some((p) => p.kind === "lumi")) keys.step(DT, s);
  const pop = keys.snapshot().pops.find((p) => p.kind === "lumi");
  keys.action({ type: "key", key: String(pop.hole + 1), down: true }, s);
  assert.equal(s.score, 1, "las teclas 1-6 tocan el agujero correspondiente");
});

test("Memoria de Lumi: las parejas suman, los errores restan y termina con las seis", () => {
  const g = logic("memory", 4);
  const s = { score: 0 };
  g.reset();
  const { cards } = g.snapshot();
  assert.equal(cards.length, 12);
  // Un error: dos cartas distintas se dan vuelta solas.
  const a = 0,
    b = cards.findIndex((c) => c.icon !== cards[0].icon);
  for (const i of [a, b]) g.action({ type: "down", ...g.cardCenter(i) }, s);
  assert.equal(s.score, 0);
  assert.equal(g.snapshot().misses, 1);
  for (let i = 0; i < 60; i++) g.step(DT, s);
  assert.ok(g.snapshot().cards.every((c) => !c.up));
  // Resolver todo con el teclado: flechas para mover el cursor, Espacio para girar.
  let over = false;
  for (const icon of new Set(cards.map((c) => c.icon)))
    for (const index of cards.flatMap((c, i) => (c.icon === icon ? [i] : []))) {
      while (g.snapshot().cursor !== index) g.action({ type: "key", key: "ArrowRight", down: true }, s);
      g.action({ type: "key", key: " ", down: true }, s);
      over = !g.step(DT, s);
    }
  assert.equal(over, true);
  assert.equal(g.snapshot().pairs, 6);
  assert.equal(s.score, 58);
  assert.match(g.overTitle(s), /1 error/);
});

test("Cada juego nuevo tiene nombre, instrucciones y su miniatura con la Lumi de la etapa", () => {
  for (const g of MORE_GAMES) {
    assert.ok(g.name && g.hint);
    const thumb = decodeURIComponent(g.thumb(5));
    assert.match(thumb, /^data:image\/svg\+xml/);
    assert.match(thumb, /#f2c568" stroke="#b67e26" stroke-width="3"/, "corona de la etapa 5");
  }
});
