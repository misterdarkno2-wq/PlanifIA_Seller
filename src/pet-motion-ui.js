import { getPetMotionSettings } from "./pet-motion.js";

function motionStatus(settings) {
  if (settings.mode === "animated")
    return "Lumi se mueve automáticamente. Las acciones espontáneas tienen pausas de 8–20 segundos.";
  if (settings.mode === "calm")
    return "Lumi está en modo tranquilo, sin desplazamientos, saltos ni giros.";
  if (settings.systemReduced)
    return "Lumi sigue la preferencia de movimiento reducido de tu dispositivo y permanece tranquila.";
  return "Lumi se mueve automáticamente y respeta la preferencia de movimiento de tu dispositivo.";
}

/** A separate control; interacting with the character never changes its movement. */
export function petMotionControls() {
  return `<div class="pet-motion-settings"><label>Animaciones de Lumi<select data-lumi-motion-select><option value="auto">Según dispositivo</option><option value="animated">Animadas</option><option value="calm">Tranquilas</option></select></label><p class="pet-motion-status" data-lumi-motion-status role="status" aria-live="polite"></p><p class="pet-motion-note">Esta preferencia se guarda solo en este navegador.</p></div>`;
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
