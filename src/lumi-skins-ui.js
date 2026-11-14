import { portrait } from "./pet-art.js";
import { getPetMotionSettings } from "./pet-motion.js";
import { LUMI_SKINS, lumiSkin, getLumiSkins } from "./lumi-skins.js";
import { tr } from "./i18n.js";

const caption = (skin) => `<strong>${skin.name}</strong>${skin.description}`;
const status = (skin, skins, active) =>
  !skins.unlocked(skin)
    ? `<span aria-hidden="true">🔒 </span>${tr(`Nivel ${skin.level}`, `Level ${skin.level}`)}`
    : skin.id === active.id
      ? tr("En uso", "In use")
      : tr("Disponible", "Unlocked");

/** Una vista previa grande y una ficha animada por skin; las bloqueadas muestran el nivel que falta. */
export function lumiSkinPicker(stage, skins = getLumiSkins()) {
  const active = skins.active;
  return `<div class="lumi-skins"><div class="lumi-skins-stage"><div class="lumi-skins-preview" data-lumi-skin-preview>${portrait(stage, active)}</div><p class="lumi-skins-caption" data-lumi-skin-caption aria-live="polite">${caption(active)}</p></div><fieldset class="lumi-skins-grid"><legend class="sr-only">${tr("Elige la skin de Lumi", "Choose Lumi's skin")}</legend>${LUMI_SKINS.map(
    (skin) =>
      `<label class="lumi-skin-option${skins.unlocked(skin) ? "" : " is-locked"}"><input type="radio" name="lumi-skin" value="${skin.id}"${skin.id === active.id ? " checked" : ""}${skins.unlocked(skin) ? "" : " disabled"}><span class="lumi-skin-thumb">${portrait(stage, skin)}</span><span>${skin.name}</span><small data-lumi-skin-status="${skin.id}">${status(skin, skins, active)}</small></label>`,
  ).join("")}</fieldset><p class="muted">${
    LUMI_SKINS.every((skin) => skins.unlocked(skin))
      ? tr(
          `Lumi está en el nivel ${skins.level} y tiene todas las skins. Tu elección se guarda en este dispositivo.`,
          `Lumi is at level ${skins.level} and has every skin. Your choice is saved on this device.`,
        )
      : tr(
          `Lumi está en el nivel ${skins.level}. Desbloqueas más skins al subir de nivel; tu elección se guarda en este dispositivo.`,
          `Lumi is at level ${skins.level}. You unlock more skins as she levels up; your choice is saved on this device.`,
        )
  }</p><form method="dialog" class="lumi-skins-actions"><button>${tr("Listo", "Done")}</button></form></div>`;
}

/** Guarda la skin al elegirla y la estrena en la vista previa con un pequeño festejo. */
export function bindLumiSkinPicker(root, { stage, skins = getLumiSkins() }) {
  const preview = root.querySelector("[data-lumi-skin-preview]"),
    text = root.querySelector("[data-lumi-skin-caption]"),
    motion = getPetMotionSettings();
  // Fuera de la página principal no hay controlador de Lumi: la preferencia de movimiento se aplica aquí.
  for (const svg of root.querySelectorAll(".lumi-art"))
    svg.dataset.lumiMotion = motion.mode;
  let cheer = null;
  root.addEventListener("change", (event) => {
    const input = event.target.closest?.('input[name="lumi-skin"]');
    if (!input || !skins.choose(input.value)) return;
    const skin = lumiSkin(input.value);
    preview.innerHTML = portrait(stage, skin);
    const svg = preview.querySelector(".lumi-art");
    svg.dataset.lumiMotion = motion.mode;
    svg.dataset.lumiState = "celebrate";
    clearTimeout(cheer);
    cheer = setTimeout(() => (svg.dataset.lumiState = "idle"), 1300);
    text.innerHTML = caption(skin);
    for (const other of LUMI_SKINS)
      root.querySelector(`[data-lumi-skin-status="${other.id}"]`).innerHTML =
        status(other, skins, skin);
  });
}
