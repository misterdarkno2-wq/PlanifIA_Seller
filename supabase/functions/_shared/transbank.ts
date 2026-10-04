// REST schemas and integration credentials: official TransbankDevelopers SDK.
// Card data is entered only on Transbank's hosted form.
export type Json = Record<string, any>;
export type ReadEnv = (name: string) => string | undefined;
export const INTEGRATION = {
  apiKey: "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C",
  webpay: "597055555532",
  oneclick: "597055555541",
  child: "597055555542",
};
export function transbankConfig(env: ReadEnv) {
  const mode = env("TRANSBANK_ENV") || "disabled";
  if (!["integration", "production", "disabled"].includes(mode)) {
    throw new Error("Ambiente de pagos no válido.");
  }
  const test = mode === "integration";
  const webpayCode = test
    ? INTEGRATION.webpay
    : env("TRANSBANK_WEBPAY_COMMERCE_CODE");
  const webpayKey = test ? INTEGRATION.apiKey : env("TRANSBANK_WEBPAY_API_KEY");
  const oneclickCode = test
    ? INTEGRATION.oneclick
    : env("TRANSBANK_ONECLICK_COMMERCE_CODE");
  const oneclickKey = test
    ? INTEGRATION.apiKey
    : env("TRANSBANK_ONECLICK_API_KEY");
  const childCode = test
    ? INTEGRATION.child
    : env("TRANSBANK_ONECLICK_CHILD_CODE");
  // Oneclick must be explicitly enabled even in integration: it implies consent.
  const oneclick = mode !== "disabled" &&
    env("TRANSBANK_ONECLICK_ENABLED") === "true" &&
    !!(oneclickCode && oneclickKey && childCode);
  const webpay = mode !== "disabled" && !!(webpayCode && webpayKey);
  if (
    !test && mode === "production" &&
    [webpayCode, oneclickCode, childCode, webpayKey, oneclickKey].some(
      (code) => code && Object.values(INTEGRATION).includes(code),
    )
  ) {
    throw new Error(
      "No se permiten credenciales de integración en producción.",
    );
  }
  const site = new URL(env("BILLING_SITE_URL") || "https://planifia.cl/");
  if (
    site.protocol !== "https:" || site.username || site.password || site.hash ||
    site.search
  ) {
    throw new Error("La dirección de retorno debe ser HTTPS.");
  }
  const supabase = new URL(
    env("SUPABASE_URL") || "https://unconfigured.invalid",
  );
  if (
    supabase.protocol !== "https:" || supabase.username || supabase.password
  ) {
    throw new Error("Supabase debe usar HTTPS.");
  }
  return {
    mode,
    webpay,
    oneclick,
    webpayCode,
    webpayKey,
    oneclickCode,
    oneclickKey,
    childCode,
    host: test
      ? "https://webpay3gint.transbank.cl"
      : "https://webpay3g.transbank.cl",
    site: site.href,
    returnUrl: supabase.origin + "/functions/v1/billing-return",
    capabilities: {
      environment: mode,
      webpay,
      oneclick,
      preferred_channel: oneclick ? "oneclick" : webpay ? "webpay" : null,
      simulation: test,
    },
  };
}
export type TransbankConfig = ReturnType<typeof transbankConfig>;
export class ProviderError extends Error {
  constructor(public status = 0) {
    super("No pudimos confirmar la respuesta del medio de pago.");
  }
}
export class Transbank {
  constructor(
    public config: TransbankConfig,
    private fetcher: typeof fetch = fetch,
  ) {}
  async request(
    channel: "webpay" | "oneclick",
    path: string,
    method: string,
    body?: Json,
  ) {
    if (!this.config[channel]) {
      throw new Error("Esta modalidad de pago todavía no está habilitada.");
    }
    const base = channel === "webpay"
      ? "/rswebpaytransaction/api/webpay/v1.2"
      : "/rswebpaytransaction/api/oneclick/v1.2";
    let response: Response;
    try {
      response = await this.fetcher(this.config.host + base + path, {
        method,
        headers: {
          "Tbk-Api-Key-Id": String(
            channel === "webpay"
              ? this.config.webpayCode
              : this.config.oneclickCode,
          ),
          "Tbk-Api-Key-Secret": String(
            channel === "webpay"
              ? this.config.webpayKey
              : this.config.oneclickKey,
          ),
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25000),
        redirect: "error",
      });
    } catch {
      throw new ProviderError();
    }
    if (!response.ok) throw new ProviderError(response.status);
    if (response.status === 204) return {};
    try {
      return await response.json() as Json;
    } catch {
      throw new ProviderError(response.status);
    }
  }
  create(order: Json) {
    return this.request("webpay", "/transactions", "POST", {
      buy_order: order.buy_order,
      session_id: order.session_id,
      amount: order.amount,
      return_url: this.config.returnUrl,
    });
  }
  status(order: Json) {
    return this.request(
      order.channel,
      "/transactions/" + encodeURIComponent(
        order.channel === "webpay" ? order.provider_token : order.buy_order,
      ),
      "GET",
    );
  }
  commit(order: Json) {
    return this.request(
      "webpay",
      "/transactions/" + encodeURIComponent(order.provider_token),
      "PUT",
    );
  }
  start(enrollment: Json) {
    return this.request("oneclick", "/inscriptions", "POST", {
      username: enrollment.username,
      email: enrollment.email,
      response_url: this.config.returnUrl,
    });
  }
  finish(token: string) {
    return this.request(
      "oneclick",
      "/inscriptions/" + encodeURIComponent(token),
      "PUT",
    );
  }
  authorize(order: Json, method: Json) {
    return this.request("oneclick", "/transactions", "POST", {
      username: method.username,
      tbk_user: method.tbk_user,
      buy_order: order.buy_order,
      details: [{
        commerce_code: this.config.childCode,
        buy_order: order.buy_order,
        amount: order.amount,
        installments_number: 1,
      }],
    });
  }
  remove(method: Json) {
    return this.request("oneclick", "/inscriptions", "DELETE", {
      tbk_user: method.tbk_user,
      username: method.username,
    });
  }
  redirect(result: Json, channel: "webpay" | "oneclick") {
    const url = new URL(channel === "webpay" ? result.url : result.url_webpay);
    if (url.origin !== this.config.host || url.username || url.password) {
      throw new Error("El formulario de pago recibido no es válido.");
    }
    const token = String(result.token || "");
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(token)) {
      throw new Error("El token de pago recibido no es válido.");
    }
    return {
      url: url.href,
      token,
      field: channel === "webpay" ? "token_ws" : "TBK_TOKEN",
    };
  }
}
export function normalizePayment(
  order: Json,
  result: Json,
  config: TransbankConfig,
) {
  const detail = order.channel === "webpay"
    ? result
    : Array.isArray(result.details) && result.details.length === 1
    ? result.details[0]
    : null;
  if (
    !detail || result.buy_order !== order.buy_order ||
    detail.amount !== order.amount ||
    (order.channel === "webpay" && result.session_id !== order.session_id) ||
    (order.channel === "oneclick" &&
      (detail.commerce_code !== config.childCode ||
        detail.buy_order !== order.buy_order))
  ) {
    throw new Error("La respuesta de pago no corresponde a la orden guardada.");
  }
  if (
    !Number.isInteger(detail.amount) || !Number.isInteger(detail.response_code)
  ) {
    // INITIALIZED is a status to reconcile, not a rejection.
    if (detail.status !== "INITIALIZED") {
      throw new Error("Respuesta de pago incompleta.");
    }
  }
  return {
    approved: detail.status === "AUTHORIZED" && detail.response_code === 0,
    status: detail.status,
    amount: detail.amount,
    buy_order: result.buy_order,
    ...(order.channel === "webpay" ? { session_id: result.session_id } : {
      commerce_code: detail.commerce_code,
      child_buy_order: detail.buy_order,
    }),
    response_code: detail.response_code ?? null,
    authorization_code: detail.authorization_code || null,
  };
}
