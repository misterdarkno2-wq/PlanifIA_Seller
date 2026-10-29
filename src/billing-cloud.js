import { cloud, checked } from "./cloud.js";
import { tr } from "./i18n.js";

// Planes públicos: cualquier visitante puede leer plan_catalog. La web no cobra.
export async function loadBillingCatalog() {
  if (!cloud) throw new Error(tr("Los planes todavía no están disponibles.", "Plans aren't available yet."));
  return checked(
    cloud.from("plan_catalog").select("*").eq("enabled", true).order("position"),
  );
}

// Plan vigente (incluido Google Play) y uso del mes de la cuenta con sesión.
export async function loadBillingState() {
  if (!cloud) throw new Error(tr("Tu plan todavía no está disponible.", "Your plan isn't available yet."));
  return checked(cloud.rpc("billing_state"));
}

// Créditos, plan vigente (incluido Google Play), anuncios del día e invitaciones.
export async function loadMonetization() {
  if (!cloud) throw new Error(tr("Los créditos todavía no están disponibles.", "Credits aren't available yet."));
  return checked(cloud.rpc("monetization_state"));
}

export async function redeemReferral(code) {
  if (!cloud) throw new Error(tr("Las invitaciones todavía no están disponibles.", "Invitations aren't available yet."));
  return checked(cloud.rpc("redeem_referral", { p_code: code }));
}

// El servidor valida cada compra con Google Play antes de activar el plan o sumar créditos.
export async function verifyPlayPurchases(purchases) {
  if (!cloud) throw new Error(tr("Las compras todavía no están disponibles.", "Purchases aren't available yet."));
  const { data, error } = await cloud.functions.invoke("play-billing", {
    body: { action: "verify", purchases },
  });
  if (!error) return data;
  let detail;
  try {
    detail = await error.context?.json();
  } catch {}
  throw new Error(
    detail?.error ||
      tr(
        "Tu compra quedó registrada en Google Play, pero no pudimos confirmarla. Toca «Restaurar compras» en unos minutos.",
        "Your purchase was registered in Google Play, but we couldn't confirm it. Tap “Restore purchases” in a few minutes.",
      ),
  );
}
