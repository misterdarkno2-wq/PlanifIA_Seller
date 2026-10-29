import { getPetMotionSettings } from "./pet-motion.js";
import { tr } from "./i18n.js";

function motionStatus(settings) {
  if (settings.mode === "animated")
    return tr(
      "Lumi se mueve automáticamente. Las acciones espontáneas tienen pausas de 8–20 segundos.",
      "Lumi moves on her own. Spontaneous actions have 8–20 second pauses.",
    );
  if (settings.mode === "calm")
    return tr("Lumi está en modo tranquilo, sin desplazamientos, saltos ni giros.", "Lumi is in calm mode, with no walking, jumping or spinning.");
  if (settings.systemReduced)
    return tr(
      "Lumi sigue la preferencia de movimiento reducido de tu dispositivo y permanece tranquila.",
      "Lumi follows your device's reduced motion setting and stays calm.",
    );
  return tr(
    "Lumi se mueve automáticamente y respeta la preferencia de movimiento de tu dispositivo.",
    "Lumi moves on her own and respects your device's motion setting.",
  );
}

/** A separate control; interacting with the character never changes its movement. */
export function petMotionControls() {
  return `<div class="pet-motion-settings"><label>${tr("Animaciones de Lumi", "Lumi's animations")}<select data-lumi-motion-select><option value="auto">${tr("Según dispositivo", "Follow device")}</option><option value="animated">${tr("Animadas", "Animated")}</option><option value="calm">${tr("Tranquilas", "Calm")}</option></select></label><p class="pet-motion-status" data-lumi-motion-status role="status" aria-live="polite"></p><p class="pet-motion-note">${tr("Esta preferencia se guarda solo en este navegador.", "This preference is saved only in this browser.")}</p></div>`;
}

/** Updates existing controls without replacing forms or interrupting a pending plan. */
export function bindPetMotionControls(root) {
  const settings = getPetMotionSettings();
  const controls = [...root.querySelectorAll("[data-lumi-motion-select]")];
  const statuses = [...root.querySelectorAll("[data-lumi-motion-status]")];
  const update = () => {
    for (const control of controls) control.value = settings.mode;
    for (const status of statuses) status.textContent = motionStatus(settings);
  };
  const change = (event) => settings.setMode(event.currentTarget.value);
  for (const control of controls) control.addEventListener("change", change);
  settings.addEventListener("change", update);
  update();
  return () => {
    for (const control of controls)
      control.removeEventListener("change", change);
    settings.removeEventListener("change", update);
  };
}
