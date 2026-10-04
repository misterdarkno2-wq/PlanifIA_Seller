// No card is submitted and no payment is authorized. Integration only.
import {
  Transbank,
  transbankConfig,
} from "../supabase/functions/_shared/transbank.ts";
const payment = new Transbank(transbankConfig((name) =>
  ({
    TRANSBANK_ENV: "integration",
    SUPABASE_URL: "https://example.supabase.co",
    BILLING_SITE_URL: "https://planifia.cl/",
  })[name]
));
for (const [plan, amount] of [["plus", 990], ["pro", 1990]] as const) {
  const buyOrder = "qa" + crypto.randomUUID().replaceAll("-", "").slice(0, 20);
  const session = crypto.randomUUID();
  const created = await payment.create({
    buy_order: buyOrder,
    session_id: session,
    amount,
  });
  const redirect = payment.redirect(created, "webpay");
  const status = await payment.status({
    channel: "webpay",
    provider_token: redirect.token,
  });
  if (
    status.amount !== amount || status.buy_order !== buyOrder ||
    status.session_id !== session || status.status !== "INITIALIZED"
  ) {
    throw new Error(
      "La respuesta de integración no coincidió con la orden de prueba.",
    );
  }
  console.log(
    JSON.stringify({
      environment: "integration",
      plan,
      amount_clp: amount,
      status: status.status,
      host: new URL(redirect.url).host,
      card_submitted: false,
    }),
  );
}
