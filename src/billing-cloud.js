import { cloud, checked } from "./cloud.js";

export async function loadBillingCatalog() {
  return invokeBilling("catalog");
}

export async function invokeBilling(action, payload = {}) {
  if (!cloud) throw new Error("Los pagos todavía no están disponibles.");
  const { data, error } = await cloud.functions.invoke("billing", {
    body: { ...payload, action },
  });
  if (!error) return data;
  let detail;
  try {
    detail = await error.context?.json();
  } catch {}
  throw new Error(
    detail?.error ||
      "No pudimos consultar tu suscripción. Inténtalo de nuevo en unos momentos.",
  );
}

// Créditos, plan vigente (incluido Google Play), anuncios del día e invitaciones.
export async function loadMonetization() {
  if (!cloud) throw new Error("Los créditos todavía no están disponibles.");
  return checked(cloud.rpc("monetization_state"));
}

export async function redeemReferral(code) {
  if (!cloud) throw new Error("Las invitaciones todavía no están disponibles.");
  return checked(cloud.rpc("redeem_referral", { p_code: code }));
}

// El servidor valida cada compra con Google Play antes de activar el plan o sumar créditos.
export async function verifyPlayPurchases(purchases) {
  if (!cloud) throw new Error("Las compras todavía no están disponibles.");
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
      "Tu compra quedó registrada en Google Play, pero no pudimos confirmarla. Toca «Restaurar compras» en unos minutos.",
  );
}
