import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  Json,
  normalizePayment,
  Transbank,
  transbankConfig,
} from "./transbank.ts";

export class BillingError extends Error {
  constructor(
    message: string,
    public status = 422,
    public code = "billing_error",
  ) {
    super(message);
  }
}
export function billingClients(token?: string) {
  const url = Deno.env.get("SUPABASE_URL"),
    anon = Deno.env.get("SUPABASE_ANON_KEY"),
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    throw new BillingError(
      "Los pagos todavía no están disponibles.",
      503,
      "not_configured",
    );
  }
  return {
    user: createClient(url, anon, {
      auth: { persistSession: false },
      ...(token
        ? { global: { headers: { Authorization: `Bearer ${token}` } } }
        : {}),
    }),
    admin: createClient(url, service, { auth: { persistSession: false } }),
  };
}
export async function adminAction(
  admin: any,
  action: string,
  payload: Json = {},
) {
  const result = await admin.rpc("billing_admin", {
    p_action: action,
    p_payload: {
      ...payload,
      environment: Deno.env.get("TRANSBANK_ENV") || "disabled",
    },
  });
  if (result.error) {
    throw new BillingError(
      result.error.code === "P0001"
        ? result.error.message
        : "No pudimos actualizar tu suscripción. Inténtalo de nuevo.",
      result.error.code === "P0001" ? 409 : 503,
      "subscription_conflict",
    );
  }
  return result.data;
}
export function provider() {
  return new Transbank(transbankConfig((name) => Deno.env.get(name)));
}
export function validateUuid(id: unknown) {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(id)
  ) {
    throw new BillingError("La referencia de pago no es válida.");
  }
  return id;
}
export function channelFor(
  payment: Transbank,
  requested?: unknown,
): "webpay" | "oneclick" {
  const channel = requested || payment.config.capabilities.preferred_channel;
  if (
    (channel !== "webpay" && channel !== "oneclick") || !payment.config[channel]
  ) {
    throw new BillingError(
      "Esta modalidad de pago todavía no está disponible.",
      503,
      "payments_unavailable",
    );
  }
  return channel;
}
export function safeOrder(order: Json | null) {
  if (!order) return null;
  const {
    id,
    plan_id,
    amount,
    period_start,
    period_end,
    promo_applied,
    status,
    channel,
  } = order;
  return {
    id,
    plan_id,
    amount,
    period_start,
    period_end,
    promo_applied,
    status,
    channel,
  };
}
async function applyResult(
  admin: any,
  payment: Transbank,
  order: Json,
  result: Json,
  reconciled = false,
) {
  const normalized = normalizePayment(order, result, payment.config);
  if (normalized.approved) {
    return await adminAction(admin, "confirm_order", {
      order_id: order.id,
      provider_result: normalized,
    });
  }
  if (
    normalized.status === "FAILED" && normalized.response_code !== null &&
    normalized.response_code !== 0
  ) {
    return await adminAction(admin, "fail_order", {
      order_id: order.id,
      status: "rejected",
      provider_result: normalized,
      reconciled,
    });
  }
  return null;
}
// After an uncertain POST, this function only queries the existing transaction.
export async function reconcileOrder(
  admin: any,
  payment: Transbank,
  order: Json,
) {
  if (["approved", "cancelled", "abandoned"].includes(order.status)) {
    return order;
  }
  try {
    const applied = await applyResult(
      admin,
      payment,
      order,
      await payment.status(order),
      true,
    );
    return applied || order;
  } catch {
    // A 404 or network error does not prove that Transbank never charged it.
    return order;
  }
}
export async function chargeOneclick(
  admin: any,
  payment: Transbank,
  order: Json,
) {
  if (
    ["unknown", "processing"].includes(order.status) ||
    (order.charge_started_at && order.status !== "rejected")
  ) {
    return await reconcileOrder(admin, payment, order);
  }
  const claimed = await adminAction(admin, "claim_order", {
    order_id: order.id,
  });
  if (!claimed.claimed) return claimed.order || order;
  order = claimed.order;
  const method = await adminAction(admin, "get_method", {
    user_id: order.user_id,
  });
  if (!method?.active || !method.tbk_user || !method.username) {
    await adminAction(admin, "fail_order", {
      order_id: order.id,
      status: "cancelled",
    });
    throw new BillingError(
      "Actualiza tu medio de pago para renovar la suscripción.",
      409,
      "payment_method_required",
    );
  }
  // The database rechecks current consent and a valid lease under a user lock.
  const started = await adminAction(admin, "charge_started", {
    order_id: order.id,
  });
  if (started.status !== "processing" || !started.charge_started_at) {
    return started;
  }
  order = started;
  try {
    const result = await payment.authorize(order, method);
    const applied = await applyResult(admin, payment, order, result);
    if (applied) return applied;
  } catch {
    /* Treat a timeout, malformed result or database failure as uncertain. */
  }
  await adminAction(admin, "fail_order", {
    order_id: order.id,
    status: "unknown",
  });
  return await reconcileOrder(admin, payment, { ...order, status: "unknown" });
}
export async function confirmWebpay(
  admin: any,
  payment: Transbank,
  order: Json,
  allowCommit = false,
  cancellation?: "cancelled" | "abandoned",
) {
  if (["approved", "cancelled", "abandoned"].includes(order.status)) {
    return order;
  }
  const claimed = await adminAction(admin, "claim_order", {
    order_id: order.id,
  });
  if (!claimed.claimed) {
    return await reconcileOrder(admin, payment, claimed.order || order);
  }
  order = claimed.order;
  let status: Json;
  try {
    status = await payment.status(order);
    const applied = await applyResult(admin, payment, order, status);
    if (applied) return applied;
  } catch {
    await adminAction(admin, "fail_order", {
      order_id: order.id,
      status: "unknown",
    });
    return { ...order, status: "unknown" };
  }
  if (
    cancellation && status.status === "INITIALIZED" && !order.charge_started_at
  ) {
    return await adminAction(admin, "fail_order", {
      order_id: order.id,
      status: cancellation,
    });
  }
  if (
    !allowCommit || status.status !== "INITIALIZED" || order.charge_started_at
  ) {
    await adminAction(admin, "fail_order", {
      order_id: order.id,
      status: "unknown",
    });
    return { ...order, status: "unknown" };
  }
  const started = await adminAction(admin, "charge_started", {
    order_id: order.id,
  });
  if (started.status !== "processing" || !started.charge_started_at) {
    return started;
  }
  order = started;
  try {
    const applied = await applyResult(
      admin,
      payment,
      order,
      await payment.commit(order),
    );
    if (applied) return applied;
  } catch { /* Query the same token; never create a replacement charge. */ }
  await adminAction(admin, "fail_order", {
    order_id: order.id,
    status: "unknown",
  });
  return await reconcileOrder(admin, payment, { ...order, status: "unknown" });
}
export async function completeEnrollment(
  admin: any,
  payment: Transbank,
  enrollment: Json,
): Promise<{ enrollment: Json; order?: Json }> {
  const claim = await adminAction(admin, "enroll_claim", {
    enrollment_id: enrollment.id,
  });
  enrollment = claim.enrollment || enrollment;
  if (!claim.claimed) {
    if (enrollment.status === "enrolled" && enrollment.purpose === "checkout") {
      return await recoverEnrollmentOrder(admin, payment, enrollment);
    }
    return { enrollment };
  }
  let finished: Json;
  try {
    finished = await payment.finish(enrollment.provider_token);
  } catch {
    await adminAction(admin, "enroll_cancel", {
      enrollment_id: enrollment.id,
      status: "unknown",
    });
    return { enrollment: { ...enrollment, status: "unknown" } };
  }
  if (
    finished.response_code !== 0 || typeof finished.tbk_user !== "string" ||
    !finished.tbk_user
  ) {
    await adminAction(admin, "enroll_cancel", {
      enrollment_id: enrollment.id,
      status: "rejected",
    });
    return { enrollment: { ...enrollment, status: "rejected" } };
  }
  const last4 = String(finished.card_number || "").replace(/\D/g, "").slice(-4);
  const persisted = await adminAction(admin, "enroll_finish", {
    enrollment_id: enrollment.id,
    tbk_user: finished.tbk_user,
    username: enrollment.username,
    card_type: finished.card_type || null,
    last4: /^\d{4}$/.test(last4) ? last4 : null,
    response_code: 0,
  });
  if (persisted?.status !== "enrolled") {
    return { enrollment: persisted || enrollment };
  }
  enrollment = persisted;
  // Enrollment alone never calls confirm_order or grants paid access.
  if (enrollment.purpose === "update_card") {
    return { enrollment: { ...enrollment, status: "enrolled" } };
  }
  return await recoverEnrollmentOrder(admin, payment, {
    ...enrollment,
    status: "enrolled",
  });
}
export async function recoverEnrollmentOrder(
  admin: any,
  payment: Transbank,
  enrollment: Json,
) {
  const existing = await adminAction(admin, "get_order", {
    request_id: enrollment.id,
    user_id: enrollment.user_id,
  });
  const order = existing || await adminAction(admin, "create_order", {
    user_id: enrollment.user_id,
    plan_id: enrollment.plan_id,
    channel: "oneclick",
    recurring_consent: true,
    request_id: enrollment.id,
  });
  return { enrollment, order: await chargeOneclick(admin, payment, order) };
}
