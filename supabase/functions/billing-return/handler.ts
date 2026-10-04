import {
  adminAction,
  billingClients,
  completeEnrollment,
  confirmWebpay,
  provider,
} from "../_shared/billing.ts";

// Public endpoint: authorization is the opaque token correlated with a server order.
// Return query parameters are never evidence of an approved payment.
export async function handleBillingReturn(req: Request) {
  if (!["GET", "POST"].includes(req.method)) {
    return new Response("Método no permitido.", { status: 405 });
  }
  const payment = provider();
  let orderId: string | undefined, enrollmentId: string | undefined;
  try {
    const url = new URL(req.url);
    const raw = req.method === "POST" ? await req.text() : "";
    if (raw.length > 4000) throw new Error("Invalid return");
    const input = req.method === "POST"
      ? new URLSearchParams(raw)
      : url.searchParams;
    const token = input.get("token_ws") || input.get("TBK_TOKEN") || "";
    const timedOut = !token && input.has("TBK_ID_SESION") &&
      input.has("TBK_ORDEN_COMPRA");
    if (!timedOut && !/^[A-Za-z0-9_-]{10,128}$/.test(token)) {
      throw new Error("Invalid token");
    }
    const { admin } = billingClients();
    if (
      input.has("token_ws") || input.has("TBK_ID_SESION") ||
      input.has("TBK_ORDEN_COMPRA")
    ) {
      const order = await adminAction(
        admin,
        "get_order",
        timedOut
          ? {
            buy_order: input.get("TBK_ORDEN_COMPRA"),
            session_id: input.get("TBK_ID_SESION"),
          }
          : { provider_token: token },
      );
      if (
        !order || order.channel !== "webpay" ||
        (!timedOut && order.provider_token !== token) || !order.provider_token
      ) throw new Error("Uncorrelated return");
      // Cancellation parameters must also match the original persisted session/order.
      if (
        input.has("TBK_ID_SESION") &&
        input.get("TBK_ID_SESION") !== order.session_id
      ) throw new Error("Session mismatch");
      if (
        input.has("TBK_ORDEN_COMPRA") &&
        input.get("TBK_ORDEN_COMPRA") !== order.buy_order
      ) throw new Error("Order mismatch");
      orderId = order.id;
      await confirmWebpay(
        admin,
        payment,
        order,
        input.has("token_ws"),
        input.has("token_ws")
          ? undefined
          : timedOut
          ? "abandoned"
          : "cancelled",
      );
    } else {
      const enrollment = await adminAction(admin, "enroll_get", {
        provider_token: token,
      });
      if (!enrollment || enrollment.provider_token !== token) {
        throw new Error("Uncorrelated enrollment");
      }
      enrollmentId = enrollment.id;
      const result = await completeEnrollment(admin, payment, enrollment);
      orderId = result.order?.id;
    }
  } catch {
    /* Keep errors and private payment references out of the public response. */
  }
  const destination = new URL(payment.config.site);
  destination.hash = "subscription" +
    (orderId
      ? "?order=" + encodeURIComponent(orderId)
      : enrollmentId
      ? "?enrollment=" + encodeURIComponent(enrollmentId)
      : "?verification=pending");
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
