import {
  adminAction,
  billingClients,
  BillingError,
  channelFor,
  chargeOneclick,
  provider,
  reconcileOrder,
  recoverEnrollmentOrder,
  safeOrder,
  validateUuid,
} from "../_shared/billing.ts";

export async function handleBilling(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((x) =>
    x.trim()
  );
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  if (!origin || !allowed.includes(origin)) {
    return Response.json({ error: "Origen no autorizado." }, { status: 403 });
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") {
    return Response.json({ error: "Método no permitido." }, {
      status: 405,
      headers,
    });
  }
  try {
    const raw = await req.text();
    if (raw.length > 4000) {
      throw new BillingError("La solicitud es demasiado larga.", 413);
    }
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new BillingError("La solicitud no es válida.");
    }
    const payment = provider();
    const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)
      ?.[1];
    const { user: client, admin } = billingClients(token);
    if (input.action === "catalog") {
      const [result, campaign] = await Promise.all([
        client.from("plan_catalog").select("*").eq("enabled", true).order(
          "position",
        ),
        client.rpc("billing_promotion"),
      ]);
      if (result.error || campaign.error) {
        throw new BillingError("No pudimos cargar los planes.", 503);
      }
      return Response.json({
        plans: result.data,
        promotion: campaign.data,
        promotion_available: campaign.data?.active === true,
        capabilities: payment.config.capabilities,
      }, { headers });
    }
    if (!token) {
      throw new BillingError(
        "Inicia sesión para gestionar tu suscripción.",
        401,
        "unauthorized",
      );
    }
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) {
      throw new BillingError(
        "Tu sesión terminó. Vuelve a iniciar sesión.",
        401,
        "unauthorized",
      );
    }
    let result: any;
    if (input.action === "state") {
      const response = await client.rpc("billing_state");
      if (response.error) {
        throw new BillingError("No pudimos consultar tu suscripción.", 503);
      }
      result = { ...response.data, capabilities: payment.config.capabilities };
    } else if (input.action === "quote") {
      result = {
        quote: await adminAction(admin, "quote", {
          user_id: user.id,
          plan_id: input.plan_id,
          channel: channelFor(payment, input.channel),
          for_change: input.for_change === true,
        }),
        capabilities: payment.config.capabilities,
      };
    } else if (["cancel", "resume", "change_plan"].includes(input.action)) {
      if (input.action === "resume" && input.recurring_consent !== true) {
        throw new BillingError(
          "Acepta expresamente los próximos cobros para reactivar la renovación automática.",
        );
      }
      const response = await client.rpc("manage_subscription", {
        p_action: input.action,
        p_plan_id: input.plan_id || null,
        p_recurring_consent: input.recurring_consent === true,
      });
      if (response.error) {
        throw new BillingError(
          response.error.code === "P0001"
            ? response.error.message
            : "No pudimos cambiar tu suscripción.",
          409,
        );
      }
      result = response.data;
    } else if (input.action === "checkout" || input.action === "update_card") {
      if (
        input.action === "checkout" &&
        (!Number.isSafeInteger(input.expected_amount_clp) ||
          input.expected_amount_clp <= 0)
      ) {
        throw new BillingError(
          "Actualiza la página y vuelve a consultar el precio antes de pagar.",
        );
      }
      const expectedAmount = input.action !== "checkout"
        ? {}
        : { expected_amount_clp: input.expected_amount_clp };
      const channel = input.action === "update_card"
        ? channelFor(payment, "oneclick")
        : channelFor(payment, input.channel);
      if (channel === "oneclick") {
        if (input.recurring_consent !== true) {
          throw new BillingError(
            "Acepta expresamente la renovación automática para continuar.",
          );
        }
        const enrollment = await adminAction(admin, "enroll_create", {
          user_id: user.id,
          email: user.email,
          plan_id: input.plan_id || null,
          purpose: input.action === "update_card" ? "update_card" : "checkout",
          recurring_consent: true,
          ...expectedAmount,
        });
        if (["unknown", "processing"].includes(enrollment.status)) {
          throw new BillingError(
            "Tu inscripción está pendiente de verificación. Revísala antes de iniciar otra.",
            409,
            "enrollment_pending",
          );
        }
        let redirect;
        if (enrollment.provider_token && enrollment.provider_url) {
          redirect = payment.redirect({
            token: enrollment.provider_token,
            url_webpay: enrollment.provider_url,
          }, channel);
        } else {
          const claim = await adminAction(admin, "enroll_start_claim", {
            enrollment_id: enrollment.id,
          });
          if (!claim.claimed) {
            throw new BillingError(
              "Ya hay una inscripción en curso. Revisa Mi suscripción antes de reintentar.",
              409,
            );
          }
          try {
            redirect = payment.redirect(
              await payment.start(claim.enrollment || enrollment),
              channel,
            );
            await adminAction(admin, "enroll_started", {
              enrollment_id: enrollment.id,
              token: redirect.token,
              url: redirect.url,
            });
          } catch {
            const failed = await adminAction(admin, "enroll_start_failed", {
              enrollment_id: enrollment.id,
            });
            throw new BillingError(
              failed?.status === "cancelled"
                ? "No pudimos abrir la inscripción. Puedes volver a intentarlo."
                : "No pudimos abrir la inscripción. Revisa su estado antes de reintentar.",
              503,
              "enrollment_pending",
            );
          }
        }
        result = {
          enrollment_id: enrollment.id,
          channel,
          redirect,
          environment: payment.config.mode,
        };
      } else {
        const order = await adminAction(admin, "create_order", {
          user_id: user.id,
          plan_id: input.plan_id,
          channel,
          ...expectedAmount,
          ...(input.request_id
            ? { request_id: validateUuid(input.request_id) }
            : {}),
        });
        if (
          [
            "unknown",
            "processing",
            "approved",
            "rejected",
            "cancelled",
            "abandoned",
          ].includes(order.status)
        ) {
          throw new BillingError(
            "Revisa el estado de este pago en Mi suscripción antes de iniciar otro.",
            409,
            "payment_pending",
          );
        }
        if (order.provider_token && order.provider_url) {
          result = {
            order_id: order.id,
            channel,
            redirect: payment.redirect({
              url: order.provider_url,
              token: order.provider_token,
            }, channel),
            environment: payment.config.mode,
          };
        } else {
          const claim = await adminAction(admin, "claim_order", {
            order_id: order.id,
          });
          if (!claim.claimed) {
            throw new BillingError(
              "Ya hay un pago en curso. Revisa Mi suscripción antes de reintentar.",
              409,
            );
          }
          try {
            const redirect = payment.redirect(
              await payment.create(order),
              channel,
            );
            await adminAction(admin, "provider_started", {
              order_id: order.id,
              token: redirect.token,
              url: redirect.url,
            });
            result = {
              order_id: order.id,
              channel,
              redirect,
              environment: payment.config.mode,
            };
          } catch {
            const failed = await adminAction(admin, "initial_creation_failed", {
              order_id: order.id,
            });
            throw new BillingError(
              failed?.status === "abandoned"
                ? "No pudimos abrir el formulario de pago. Puedes volver a intentarlo."
                : "No pudimos abrir el pago. Revisa su estado antes de reintentar.",
              503,
              "payment_pending",
            );
          }
        }
      }
    } else if (input.action === "verify") {
      if (input.enrollment_id) {
        const enrollment = await adminAction(admin, "enroll_get", {
          enrollment_id: validateUuid(input.enrollment_id),
        });
        if (!enrollment || enrollment.user_id !== user.id) {
          throw new BillingError(
            "No encontramos ese registro en tu cuenta.",
            404,
          );
        }
        const recovered =
          enrollment.status === "enrolled" && enrollment.purpose === "checkout"
            ? await recoverEnrollmentOrder(admin, payment, enrollment)
            : null;
        result = {
          enrollment: {
            id: enrollment.id,
            status: enrollment.status,
            purpose: enrollment.purpose,
          },
          ...(recovered?.order ? { order: safeOrder(recovered.order) } : {}),
        };
      } else {
        const order = await adminAction(admin, "get_order", {
          order_id: validateUuid(input.order_id),
        });
        if (!order || order.user_id !== user.id) {
          throw new BillingError("No encontramos ese pago en tu cuenta.", 404);
        }
        const checked = order.channel === "oneclick" &&
            ["created", "pending"].includes(order.status)
          ? await chargeOneclick(admin, payment, order)
          : await reconcileOrder(admin, payment, order);
        result = { order: safeOrder(checked) };
      }
    } else if (input.action === "remove_method") {
      const method = await adminAction(admin, "get_method", {
        user_id: user.id,
      });
      // Stop future charges before contacting the provider.
      await adminAction(admin, "remove_method", { user_id: user.id });
      if (method?.tbk_user) {
        try {
          await payment.remove(method);
        } catch {
          throw new BillingError(
            "Se cancelaron los cobros futuros. No pudimos confirmar la eliminación en Transbank; puedes reintentarlo.",
            409,
          );
        }
      }
      result = { removed: true };
    } else throw new BillingError("La operación solicitada no es válida.");
    return Response.json(result, { headers });
  } catch (error) {
    const known = error instanceof BillingError;
    return Response.json({
      error: known
        ? error.message
        : "No pudimos procesar la solicitud. Inténtalo de nuevo.",
      code: known ? error.code : "billing_error",
    }, { status: known ? error.status : 503, headers });
  }
}
