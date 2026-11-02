import { tr } from "./i18n.js";

export const LUMI_SKIN_STORAGE_KEY = "planifia-lumi-skin";
export const DEFAULT_LUMI_SKIN = "menta";

/** Colores de la Lumi de siempre; cada skin cambia sólo los que necesita. */
const CLASSIC = Object.freeze({
  halo: "#e2f4e9",
  shadow: "#c3e2d5",
  spark: "#e7b354",
  body: "#77cdb0",
  adult: "#2e9b85",
  line: "#247c6a",
  ears: "#53b39c",
  wings: "#56b59b",
  belly: "#d8f3d8",
  check: "#278773",
  cheek: "#ecaaa2",
  ink: "#163e3b",
  eye: "#f9fffb",
  tongue: "#f0a7a3",
  crown: "#f2c568",
  crownLine: "#b67e26",
  gem: "#fff3ca",
  leaf: "#b0db7e",
  leafLine: "#4b8d57",
  shell: "#fff4db",
  shellLine: "#ceb98b",
  crack: "#dbc79e",
});

// `level` es el nivel de Lumi con que se desbloquea. Los nombres se leen al dibujar, en el idioma actual.
const CATALOG = [
  ["menta", 1, ["Menta", "Mint"], ["La Lumi de siempre.", "The original Lumi."], {}],
  ["durazno", 1, ["Durazno", "Peach"], ["Corazones que flotan a su alrededor.", "Hearts floating around her."], {
    halo: "#fde9df", shadow: "#f3d2c4", spark: "#f07f86", body: "#f6a98f", adult: "#ec8467", line: "#b5583f",
    ears: "#f29a80", wings: "#f4a58c", belly: "#fff0e6", check: "#c9654a", cheek: "#f27f86", ink: "#4a2620",
  }],
  ["oceano", 3, ["Océano", "Ocean"], ["Burbujas y una estrella de mar.", "Bubbles and a starfish."], {
    halo: "#dff0fb", shadow: "#c2dcef", spark: "#5fb3e6", body: "#6fb6e8", adult: "#3d8fcf", line: "#24609a",
    ears: "#5aa6dc", wings: "#63afe2", belly: "#e3f4ff", check: "#2a6fae", cheek: "#f1a7b5", ink: "#12304d",
  }],
  ["sakura", 5, ["Sakura", "Sakura"], ["Pétalos de cerezo que caen.", "Falling cherry blossom petals."], {
    halo: "#fde7ef", shadow: "#f2cddb", spark: "#f08db3", body: "#f4a7c3", adult: "#e57ea6", line: "#b24d7a",
    ears: "#ef94b6", wings: "#f2a0bf", belly: "#fff0f5", check: "#c0507f", cheek: "#ee7fa0", ink: "#4a1f33",
  }],
  ["galaxia", 7, ["Galaxia", "Galaxy"], ["Estrellas que giran en órbita.", "Stars spinning in orbit."], {
    halo: "#ece6fb", shadow: "#d6cdee", spark: "#9b7be8", body: "#a78bdf", adult: "#8061c9", line: "#563a99",
    ears: "#9b7fd8", wings: "#a389de", belly: "#f1ebff", check: "#6545b0", cheek: "#f0a6c6", ink: "#2b1d4f",
  }],
  ["medianoche", 10, ["Medianoche", "Midnight"], ["Cielo estrellado y estrellas fugaces.", "A starry sky and shooting stars."], {
    halo: "#26336e", shadow: "#c5cbe6", spark: "#ffe28a", body: "#34448c", adult: "#2a387a", line: "#9aa8f0",
    ears: "#3c4c96", wings: "#43539e", belly: "#dfe4ff", check: "#34448c", cheek: "#e89ab8", ink: "#141b3d",
    eye: "#ffffff",
  }],
  ["volcan", 13, ["Volcán", "Volcano"], ["Chispas que suben y un brillo cálido.", "Rising sparks and a warm glow."], {
    halo: "#fde4d6", shadow: "#f0c9b4", spark: "#ff8a3d", body: "#e8623f", adult: "#cc4527", line: "#8a2a17",
    ears: "#e0583a", wings: "#e86a44", belly: "#ffd98a", check: "#b8461f", cheek: "#ffb08a", ink: "#3d140b",
  }],
  ["arcoiris", 16, ["Arcoíris", "Rainbow"], ["Cambia de color sin parar.", "Never stops changing color."], {
    halo: "#f4f1fb", shadow: "#ddd6ee", spark: "#f2b84b", body: "#f49ac1", adult: "#f49ac1", line: "#5a4e8c",
    ears: "#b79cf2", wings: "#6fc3e8", belly: "#fffaf0", check: "#5a4e8c", cheek: "#f48fb1", ink: "#2d2440",
  }],
  ["dorada", 20, ["Dorada", "Golden"], ["Brillo de oro para la evolución final.", "Golden shine for the final evolution."], {
    halo: "#fbf1d6", shadow: "#ecdcb0", spark: "#e8a91c", body: "#f2c94c", adult: "#e0ae2a", line: "#9a6b12",
    ears: "#ebbd3e", wings: "#f0c548", belly: "#fff6d8", check: "#b07d14", cheek: "#f3a28c", ink: "#3d2a07",
    crown: "#ffe9a3", crownLine: "#9a6b12", gem: "#e8505b",
  }],
];

export const LUMI_SKINS = Object.freeze(
  CATALOG.map(([id, level, [es, en], [descEs, descEn], colors]) =>
    Object.freeze({
      id,
      level,
      get name() {
        return tr(es, en);
      },
      get description() {
        return tr(descEs, descEn);
      },
      colors: Object.freeze({ ...CLASSIC, ...colors }),
    }),
  ),
);
const BY_ID = new Map(LUMI_SKINS.map((skin) => [skin.id, skin]));

/** Una skin por su clave; cualquier otro valor es la Lumi de siempre. */
export const lumiSkin = (id) =>
  (typeof id === "string" && BY_ID.get(id)) || BY_ID.get(DEFAULT_LUMI_SKIN);

/** Skins que se desbloquean al pasar de un nivel a otro, para avisarlo al subir. */
export const skinsUnlockedBetween = (before, after) =>
  LUMI_SKINS.filter((skin) => skin.level > before && skin.level <= after);

/** La skin elegida se guarda en el navegador, como el movimiento de Lumi. */
export function createLumiSkins({ storage } = {}) {
  let level = 1;
  let memory = null;
  const read = () => {
    try {
      const saved = storage?.getItem(LUMI_SKIN_STORAGE_KEY);
      if (BY_ID.has(saved)) return saved;
    } catch {
      // Sin almacenamiento la elección vale mientras la página siga abierta.
    }
    return memory ?? DEFAULT_LUMI_SKIN;
  };
  return {
    get level() {
      return level;
    },
    setLevel(next) {
      level = Math.max(1, Math.floor(Number(next)) || 1);
    },
    unlocked(skin) {
      return level >= lumiSkin(skin?.id ?? skin).level;
    },
    get chosen() {
      return read();
    },
    /** La elegida mientras el nivel la permita; si Lumi bajó de nivel vuelve la de siempre, sin olvidar la elección. */
    get active() {
      const chosen = lumiSkin(read());
      return this.unlocked(chosen) ? chosen : lumiSkin(DEFAULT_LUMI_SKIN);
    },
    choose(id) {
      if (!BY_ID.has(id)) throw new RangeError("Unknown Lumi skin");
      if (!this.unlocked(id)) return false;
      memory = id;
      try {
        storage?.setItem(LUMI_SKIN_STORAGE_KEY, id);
      } catch {
        // La skin cambia ahora aunque el navegador no pueda guardarla.
      }
      return true;
    },
  };
}

let browserSkins;
/** Se crea al usarla, así importar el módulo también funciona en las pruebas de Node. */
export function getLumiSkins() {
  if (!browserSkins) {
    let storage = null;
    try {
      storage = typeof window === "undefined" ? null : window.localStorage;
    } catch {
      // Un almacenamiento bloqueado deja elegir skin sólo durante esta sesión.
    }
    browserSkins = createLumiSkins({ storage });
  }
  return browserSkins;
}
