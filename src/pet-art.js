import { getLumiSkins, lumiSkin } from "./lumi-skins.js";

const BODY =
  "M73 138C67 90 90 65 130 65S193 90 187 138L180 161C175 189 85 189 80 161Z";
const round = (n) => Math.round(n * 10) / 10;
const each = (items, draw) => items.map(draw).join("");
function starPath(x, y, outer, inner, points = 5) {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points,
      r = i % 2 ? inner : outer;
    d += `${i ? "L" : "M"}${round(x + Math.cos(a) * r)} ${round(y + Math.sin(a) * r)}`;
  }
  return d + "Z";
}
function heart(x, y, s) {
  const p = (dx, dy) => `${round(x + dx * s)} ${round(y + dy * s)}`;
  return `M${p(0, 4)}C${p(-7, -1)} ${p(-6, -8)} ${p(0, -4)}C${p(6, -8)} ${p(7, -1)} ${p(0, 4)}Z`;
}
const sparkle = (x, y, r, fill, cls = "lumi-fx-p") =>
  `<path class="${cls}" d="${starPath(x, y, r, r * 0.3, 4)}" fill="${fill}"/>`;
// Los efectos van detrás de Lumi y entre comentarios, así los sprites estáticos de los juegos los quitan.
const fx = (name, content) =>
  `<!--fx--><g class="lumi-fx lumi-fx-${name}">${content}</g><!--/fx-->`;

/** Lo que cada skin agrega: `back` detrás de Lumi, `body` sobre la panza y `head` sobre la cara (se mueve al hablar). */
const ART = {
  durazno: {
    back: (c) =>
      fx("hearts", each([[52, 150, 1], [207, 140, 0.8], [62, 96, 0.7], [199, 84, 0.9]], ([x, y, s]) =>
        `<path class="lumi-fx-p" d="${heart(x, y, s)}" fill="${c.spark}"/>`)),
    head: (c) =>
      `<path d="M156 73l-11-7v14ZM156 73l11-7v14Z" fill="${c.spark}" stroke="${c.line}" stroke-width="2" stroke-linejoin="round"/><circle cx="156" cy="73" r="3.5" fill="${c.cheek}" stroke="${c.line}" stroke-width="2"/>`,
  },
  oceano: {
    back: (c) =>
      fx("bubbles", each([[55, 170, 5], [70, 122, 3.5], [205, 160, 6], [195, 104, 4], [216, 130, 3], [48, 82, 4]], ([x, y, r]) =>
        `<circle class="lumi-fx-p" cx="${x}" cy="${y}" r="${r}" fill="#ffffff" fill-opacity=".5" stroke="${c.spark}" stroke-width="1.5"/>`)),
    head: () =>
      `<path d="${starPath(158, 75, 8.5, 3.6)}" fill="#f6a35c" stroke="#c96d2c" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  sakura: {
    back: (c) =>
      fx("petals", each([[58, 40], [198, 34], [214, 92], [44, 112], [188, 152], [72, 162]], ([x, y], i) =>
        `<path class="lumi-fx-p" d="M${x} ${y}q5-5 10 0q-5 5-10 0Z" fill="${i % 2 ? "#ffd6e5" : c.spark}"/>`)),
    head: (c) =>
      each([0, 72, 144, 216, 288], (deg) => {
        const a = ((deg - 90) * Math.PI) / 180;
        return `<circle cx="${round(101 + Math.cos(a) * 4.2)}" cy="${round(76 + Math.sin(a) * 4.2)}" r="3.6" fill="#ffffff" stroke="${c.spark}" stroke-width="1.2"/>`;
      }) + '<circle cx="101" cy="76" r="2.4" fill="#f6cf5a"/>',
  },
  galaxia: {
    back: (c) =>
      fx("orbit", `<g class="lumi-fx-ring">${each([[218, 110, 7], [130, 20, 5], [42, 110, 7], [130, 200, 5]], ([x, y, r]) => sparkle(x, y, r, c.spark))}</g>${each([[70, 52], [192, 60], [58, 150], [204, 160]], ([x, y]) => `<circle class="lumi-fx-p" cx="${x}" cy="${y}" r="2" fill="${c.spark}"/>`)}`),
    head: () => sparkle(130, 79, 6.5, "#fff4c2", "lumi-fx-gem"),
  },
  medianoche: {
    back: (c) =>
      fx("stars", each([[58, 58, 4], [204, 52, 5], [46, 124, 3.5], [215, 118, 4], [82, 30, 3], [186, 172, 3.5], [64, 172, 3]], ([x, y, r]) => sparkle(x, y, r, c.spark)) +
        '<path class="lumi-fx-shooting" d="M48 38L112 66" fill="none" stroke="#fff6cf" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="16 140"/>'),
    body: () =>
      `<g class="lumi-fx-specks">${each([[98, 80, 1.6], [161, 78, 2], [85, 111, 1.4], [177, 109, 1.8], [146, 72, 1.2], [112, 72, 1.1]], ([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#e8ecff"/>`)}</g>`,
    head: (c) => `<path d="M131 69A7 7 0 0 0 131 83A9.5 9.5 0 0 1 131 69Z" fill="${c.spark}"/>`,
  },
  volcan: {
    back: (c) =>
      fx("embers", each([[55, 176, 3], [72, 160, 2.2], [201, 172, 3], [214, 150, 2.4], [47, 138, 2], [190, 128, 2.2], [209, 100, 1.8]], ([x, y, r], i) =>
        `<circle class="lumi-fx-p" cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? "#ffc857" : c.spark}"/>`)),
  },
  arcoiris: {
    back: () =>
      fx("rainbow", each(["#f49ac1", "#f7c46c", "#9ad77f", "#6fc3e8", "#b79cf2"], (color, i) => {
        const r = 98 - i * 6;
        return `<path class="lumi-fx-p" d="M${130 - r} 150A${r} ${r} 0 0 1 ${130 + r} 150" fill="none" stroke="${color}" stroke-width="6.5"/>`;
      })),
  },
  dorada: {
    back: (c) =>
      fx("glitter", each([[56, 62, 5], [206, 58, 6], [44, 130, 4], [216, 126, 4.5], [74, 176, 3.5], [190, 178, 4]], ([x, y, r]) => sparkle(x, y, r, c.spark))),
    body: () =>
      `<defs><clipPath id="lumi-gold-clip"><path d="${BODY}"/></clipPath></defs><g clip-path="url(#lumi-gold-clip)"><path class="lumi-fx-shine" d="M40 40h16l-44 170h-16Z" fill="#ffffff" opacity=".55"/></g>`,
  },
};

/** Lumi en su etapa con la skin elegida (o la indicada: una clave o una skin del catálogo). */
export function portrait(stage, skin = getLumiSkins().active) {
  const s = Math.max(1, Math.min(5, Number(stage) || 1));
  const k = typeof skin === "object" && skin ? skin : lumiSkin(skin);
  const c = k.colors,
    art = ART[k.id] || {};
  return `<svg viewBox="0 0 260 220" aria-hidden="true" class="lumi-art" data-lumi-stage="${s}" data-lumi-skin="${k.id}">
 <g class="lumi-shadow-position"><ellipse class="lumi-shadow" cx="130" cy="192" rx="76" ry="12" fill="${c.shadow}"/></g>
 <circle cx="130" cy="105" r="87" fill="${c.halo}"/>
 ${art.back?.(c) ?? ""}
 <g class="lumi-sparks" fill="${c.spark}"><path d="m44 65 3-9 3 9 9 3-9 3-3 9-3-9-9-3Z"/><path d="m213 131 2-7 2 7 7 2-7 2-2 7-2-7-7-2Z"/></g>
 <g class="lumi-position"><g class="lumi-action"><g class="lumi-sway"><g class="lumi-body">
 ${s >= 4 ? `<g class="lumi-wing-left"><path class="lumi-skin-wing" d="M88 130Q22 70 38 157Q48 180 87 164" fill="${c.wings}" stroke="${c.line}" stroke-width="3"/></g><g class="lumi-wing-right"><path class="lumi-skin-wing" d="M172 130Q238 70 222 157Q212 180 173 164" fill="${c.wings}" stroke="${c.line}" stroke-width="3"/></g>` : ""}
 ${s >= 2 ? `<path class="lumi-skin-ears" d="M83 98Q${s >= 3 ? "44 20 101 65" : "59 44 106 76"}L112 106M177 98Q${s >= 3 ? "216 20 159 65" : "201 44 154 76"}L148 106" fill="${c.ears}" stroke="${c.line}" stroke-width="3"/>` : ""}
 ${s === 5 ? `<path d="m98 51-8-24 25 12 15-23 15 23 25-12-8 24Z" fill="${c.crown}" stroke="${c.crownLine}" stroke-width="3"/><circle cx="130" cy="42" r="5" fill="${c.gem}"/>` : ""}
 <path class="lumi-skin-body" d="${BODY}" fill="${s >= 4 ? c.adult : c.body}" stroke="${c.line}" stroke-width="3"/>
 <g class="lumi-rest-arm"><g class="lumi-talk-left-arm"><path d="M78 137Q63 137 62 149" fill="none" stroke="${c.line}" stroke-width="10" stroke-linecap="round"/></g></g>
 <g class="lumi-wave-arm"><g class="lumi-talk-right-arm"><path d="M182 137Q198 138 201 125" fill="none" stroke="${c.line}" stroke-width="10" stroke-linecap="round"/></g></g>
 <ellipse class="lumi-belly" cx="130" cy="146" rx="38" ry="32" fill="${c.belly}"/>
 ${s >= 3 ? `<path d="M125 151l5 5 10-13" fill="none" stroke="${c.check}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
 ${art.body?.(c) ?? ""}
 <g class="lumi-talk-head"><g class="lumi-gaze"><g class="lumi-eyes"><ellipse cx="107" cy="104" rx="12.5" ry="16" fill="${c.eye}"/><ellipse cx="153" cy="104" rx="12.5" ry="16" fill="${c.eye}"/><g class="lumi-pupils" fill="${c.ink}"><ellipse cx="107" cy="105" rx="7.5" ry="10"/><ellipse cx="153" cy="105" rx="7.5" ry="10"/><circle cx="109" cy="100" r="2.5" fill="white"/><circle cx="155" cy="100" r="2.5" fill="white"/></g></g></g>
 <g class="lumi-delighted-eyes" fill="none" stroke="${c.ink}" stroke-width="3" stroke-linecap="round"><path d="M99 106q8-12 16 0M145 106q8-12 16 0"/></g>
 <ellipse cx="93" cy="123" rx="10" ry="5" fill="${c.cheek}"/><ellipse cx="167" cy="123" rx="10" ry="5" fill="${c.cheek}"/>
 <path class="lumi-smile" d="M118 120q12 12 24 0" fill="none" stroke="${c.ink}" stroke-width="3" stroke-linecap="round"/>
 <g class="lumi-talking-mouth"><path d="M116 119Q130 116 144 119Q143 133 130 133Q117 133 116 119Z" fill="${c.ink}"/><path d="M121 129Q130 122 139 129Q135 133 130 133Q125 133 121 129Z" fill="${c.tongue}"/></g>${art.head?.(c) ?? ""}</g>
 ${s === 1 ? `<path class="lumi-shell" d="m73 143 19-10 16 13 19-11 18 12 19-14 23 10-6 27q-8 33-51 28-43 5-51-28Z" fill="${c.shell}" stroke="${c.shellLine}" stroke-width="3"/><path d="m110 160 9 7-6 11" fill="none" stroke="${c.crack}" stroke-width="3"/>` : `<g class="lumi-foot-left"><ellipse cx="95" cy="179" rx="19" ry="10" fill="${c.line}"/></g><g class="lumi-foot-right"><ellipse cx="165" cy="179" rx="19" ry="10" fill="${c.line}"/></g>`}
 ${s >= 2 && s < 5 ? `<path class="lumi-sprout" d="M130 68V46M130 57Q102 56 110 35Q132 35 130 57${s >= 3 ? "M130 53Q151 26 159 43Q152 61 130 57" : ""}" fill="${c.leaf}" stroke="${c.leafLine}" stroke-width="3" stroke-linecap="round"/>` : ""}
 </g></g></g></g></svg>`;
}
