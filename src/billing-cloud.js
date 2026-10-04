import { cloud } from "./cloud.js";

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
