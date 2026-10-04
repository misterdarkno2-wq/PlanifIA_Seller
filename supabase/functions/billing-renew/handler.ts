import {
  adminAction,
  billingClients,
  chargeOneclick,
  completeEnrollment,
  confirmWebpay,
  provider,
  reconcileOrder,
} from "../_shared/billing.ts";

async function equalSecret(actual: string, expected: string) {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  return a.reduce((different, byte, i) => different | (byte ^ b[i]), 0) === 0;
}
export async function handleBillingRenew(req: Request) {
  const secret = Deno.env.get("BILLING_CRON_SECRET");
  if (
    !secret || secret.length < 32 ||
    !(await equalSecret(req.headers.get("x-billing-cron-secret") || "", secret))
  ) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  if (req.method !== "POST") {
    return Response.json({ error: "Método no permitido." }, { status: 405 });
  }
  try {
    const payment = provider(), { admin } = billingClients();
    const due = await adminAction(admin, "renewal_due", { limit: 25 });
    const deadline = Date.now() + 85000;
    let reconciled = 0, processed = 0, failed = 0;
    for (const order of due.reconcile || []) {
      if (Date.now() >= deadline) break;
      try {
        const result = await reconcileOrder(admin, payment, order);
        if (["approved", "rejected"].includes(result?.status)) reconciled++;
      } catch {
        failed++;
      }
    }
    const checkoutMinutes = Math.min(
      120,
      Math.max(10, Number(Deno.env.get("BILLING_CHECKOUT_TTL_MINUTES")) || 30),
    );
    for (const order of due.webpay_pending || []) {
      if (Date.now() >= deadline) break;
      if (
        Date.now() - Date.parse(order.created_at) >= checkoutMinutes * 60000
      ) {
        try {
          await confirmWebpay(admin, payment, order, false, "abandoned");
        } catch {
          failed++;
        }
      }
    }
    if (payment.config.oneclick) {
      for (const enrollment of due.enrollments || []) {
        if (Date.now() >= deadline) break;
        try {
          await completeEnrollment(admin, payment, enrollment);
        } catch {
          failed++;
        }
      }
      for (const order of due.pending || []) {
        if (Date.now() >= deadline) break;
        try {
          await chargeOneclick(admin, payment, order);
          processed++;
        } catch {
          failed++;
        }
      }
      for (const userId of due.users || []) {
        if (Date.now() >= deadline) break;
        try {
          const order = await adminAction(admin, "create_renewal", {
            user_id: userId,
          });
          if (!order) continue;
          await chargeOneclick(admin, payment, order);
          processed++;
        } catch {
          failed++;
        }
      }
    }
    return Response.json({ processed, reconciled, failed }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({
      error: "No pudimos completar la revisión de renovaciones.",
    }, { status: 503 });
  }
}
