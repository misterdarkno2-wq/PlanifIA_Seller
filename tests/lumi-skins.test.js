import test from "node:test";
import assert from "node:assert/strict";
import {
  LUMI_SKINS,
  DEFAULT_LUMI_SKIN,
  LUMI_SKIN_STORAGE_KEY,
  createLumiSkins,
  getLumiSkins,
  lumiSkin,
  skinsUnlockedBetween,
} from "../src/lumi-skins.js";
import { portrait } from "../src/pet-art.js";
import { spriteSvg } from "../src/lumi-sprite.js";

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
};

test("El catálogo tiene skins únicas que se desbloquean entre los niveles 1 y 20", () => {
  const ids = LUMI_SKINS.map((skin) => skin.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], DEFAULT_LUMI_SKIN);
  assert.ok(LUMI_SKINS.filter((skin) => skin.level === 1).length >= 2, "Hay para elegir desde el comienzo");
  assert.ok(LUMI_SKINS.every((skin, i) => skin.level >= 1 && skin.level <= 20 && (!i || skin.level >= LUMI_SKINS[i - 1].level)));
  assert.equal(new Set(LUMI_SKINS.map((skin) => skin.colors.body)).size, LUMI_SKINS.length, "Cada skin tiene su color");
  assert.ok(LUMI_SKINS.every((skin) => skin.name && skin.description));
  assert.equal(lumiSkin("no-existe").id, DEFAULT_LUMI_SKIN);
  assert.equal(lumiSkin("constructor").id, DEFAULT_LUMI_SKIN);
});

test("Sólo se eligen skins desbloqueadas y la elección sobrevive a una baja de nivel", () => {
  const storage = memoryStorage();
  const skins = createLumiSkins({ storage });
  assert.equal(skins.active.id, DEFAULT_LUMI_SKIN);
  assert.equal(skins.choose("dorada"), false);
  assert.equal(storage.data.size, 0);
  assert.equal(skins.choose("durazno"), true);
  assert.equal(storage.data.get(LUMI_SKIN_STORAGE_KEY), "durazno");
  skins.setLevel(12);
  assert.equal(skins.choose("medianoche"), true);
  assert.equal(skins.active.id, "medianoche");
  skins.setLevel(9);
  assert.equal(skins.active.id, DEFAULT_LUMI_SKIN, "Al bajar de nivel vuelve la Lumi de siempre");
  assert.equal(skins.chosen, "medianoche", "La elección no se pierde");
  skins.setLevel(10);
  assert.equal(skins.active.id, "medianoche");
  assert.throws(() => skins.choose("inventada"), RangeError);
  skins.setLevel(undefined);
  assert.equal(skins.level, 1);
});

test("Sin almacenamiento la skin elegida vale para la sesión", () => {
  const broken = {
    getItem() {
      throw new Error("bloqueado");
    },
    setItem() {
      throw new Error("bloqueado");
    },
  };
  const skins = createLumiSkins({ storage: broken });
  assert.equal(skins.choose("durazno"), true);
  assert.equal(skins.active.id, "durazno");
  assert.equal(createLumiSkins({ storage: memoryStorage({ [LUMI_SKIN_STORAGE_KEY]: "rara" }) }).chosen, DEFAULT_LUMI_SKIN);
});

test("Al subir de nivel se anuncian las skins nuevas", () => {
  assert.deepEqual(skinsUnlockedBetween(2, 3).map((skin) => skin.id), ["oceano"]);
  assert.deepEqual(skinsUnlockedBetween(4, 4), []);
  assert.deepEqual(skinsUnlockedBetween(19, 20).map((skin) => skin.id), ["dorada"]);
  assert.equal(skinsUnlockedBetween(1, 20).length, LUMI_SKINS.filter((skin) => skin.level > 1).length);
});

test("La Lumi de siempre conserva sus colores y no agrega efectos", () => {
  const classic = portrait(3);
  assert.match(classic, /data-lumi-skin="menta"/);
  for (const color of ["#77cdb0", "#247c6a", "#d8f3d8", "#e2f4e9", "#163e3b"]) assert.ok(classic.includes(color), color);
  assert.doesNotMatch(classic, /lumi-fx/);
  assert.match(portrait(4), /#2e9b85/);
});

test("Cada skin se dibuja en todas las etapas, con su efecto animado, y el sprite de los juegos lo quita", () => {
  const skins = getLumiSkins();
  skins.setLevel(20);
  try {
    for (const skin of LUMI_SKINS) {
      skins.choose(skin.id);
      for (let stage = 1; stage <= 5; stage++) {
        const svg = portrait(stage, skin);
        assert.match(svg, new RegExp(`data-lumi-skin="${skin.id}"`));
        assert.ok(svg.includes(skin.colors.halo) && svg.includes(skin.colors.line), skin.id);
        assert.doesNotMatch(svg, /NaN|undefined/, `${skin.id} etapa ${stage}`);
        if (skin.id !== DEFAULT_LUMI_SKIN) assert.match(svg, /<!--fx--><g class="lumi-fx lumi-fx-\w+">/, skin.id);
        assert.equal(portrait(stage), svg, "Sin indicarla se usa la skin elegida");
        const sprite = spriteSvg(stage);
        assert.ok(sprite.includes(stage >= 4 ? skin.colors.adult : skin.colors.body), `${skin.id} etapa ${stage}`);
        assert.doesNotMatch(sprite, /lumi-fx |r="87"/);
      }
    }
  } finally {
    skins.choose(DEFAULT_LUMI_SKIN);
    skins.setLevel(1);
  }
  assert.equal(portrait(2, "oceano"), portrait(2, lumiSkin("oceano")));
});
