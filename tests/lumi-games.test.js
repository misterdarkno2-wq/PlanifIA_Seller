import { test } from "node:test";
import assert from "node:assert/strict";
import { gameLogic, spriteSvg, LUMI_GAMES } from "../src/lumi-games.js";

const DT = 1 / 60;
function run(logic, seconds, bot = () => false) {
  const game = { score: 0 };
  logic.reset();
  for (let i = 0; i < seconds / DT; i++) {
    if (bot(logic.snapshot())) logic.action();
    if (!logic.step(DT, game)) return { alive: false, score: game.score, t: i * DT };
  }
  return { alive: true, score: game.score };
}
const flapBot = ({ lumi, pipes, gap }) => {
  const next = pipes.find((p) => p.x + 26 > lumi.x - 15);
  const target = next ? next.top + gap / 2 + 12 : 110;
  return lumi.vy > 0 && lumi.y > target;
};
const runBot = ({ lumi, obstacles, speed, ground }) =>
  lumi.y === ground &&
  obstacles.some((o) => o.x > lumi.x && o.x - lumi.x < 34 + speed * 0.12);

for (const stage of [1, 2, 3, 4, 5]) {
  test(`Vuelo de Lumi (etapa ${stage}): sin jugar se pierde y jugando bien se puede avanzar`, () => {
    assert.equal(run(gameLogic("flap", stage), 5).alive, false);
    const played = run(gameLogic("flap", stage), 45, flapBot);
    assert.ok(played.score >= 20, `puntaje ${played.score}`);
  });
  test(`Carrera de Lumi (etapa ${stage}): sin saltar se choca y saltando a tiempo se sobrevive a velocidad máxima`, () => {
    assert.equal(run(gameLogic("run", stage), 10).alive, false);
    const played = run(gameLogic("run", stage), 70, runBot);
    assert.ok(played.alive, `perdió en ${played.t?.toFixed(1)} s`);
    assert.ok(played.score > 300);
  });
}

test("Las alas (etapa 4+) dan doble salto en la carrera", () => {
  for (const [stage, jumps] of [[3, 1], [4, 2], [5, 2]]) {
    const logic = gameLogic("run", stage);
    logic.reset();
    logic.action();
    logic.step(DT, { score: 0 });
    const vy = logic.snapshot().lumi.vy;
    logic.action();
    assert.equal(logic.snapshot().lumi.vy !== vy, jumps === 2, `etapa ${stage}`);
  }
});

test("El sprite usa la etapa de Lumi sin fondo ni capas ocultas por CSS", () => {
  const egg = spriteSvg(1), crowned = spriteSvg(5);
  assert.match(egg, /lumi-shell/);
  assert.doesNotMatch(crowned, /lumi-shell/);
  assert.match(crowned, /#f2c568/);
  for (const svg of [egg, crowned]) {
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.doesNotMatch(svg, /lumi-shadow-position|lumi-sparks|r="87"/);
    assert.match(svg, /\.lumi-delighted-eyes,\.lumi-talking-mouth\{display:none\}/);
  }
  assert.deepEqual(LUMI_GAMES.map((g) => g.id), ["flap", "run"]);
  for (const g of LUMI_GAMES) assert.match(g.thumb(3), /^data:image\/svg\+xml/);
});
