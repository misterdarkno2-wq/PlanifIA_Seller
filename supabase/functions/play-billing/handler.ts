import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { PlayError } from "../_shared/google-play.ts";
import {
  PRODUCT_ID,
  PURCHASE_TOKEN,
  syncCredits,
  syncSubscription,
} from "../_shared/play-sync.ts";

// La app envía las compras que Google Play le entregó; aquí se validan con Google antes de dar beneficios.
export async function handlePlayBilling(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((x) => x.trim());
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  if (!origin || !allowed.includes(origin)) {
    return Response.json({ error: "Origen no autorizado." }, { status: 403 });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") {
    return Response.json({ error: "Método no permitido." }, { status: 405, headers });
  }
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  try {
    const url = Deno.env.get("SUPABASE_URL"),
      anon = Deno.env.get("SUPABASE_ANON_KEY"),
      service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return fail("Los pagos todavía no están disponibles.", 503);
    const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return fail("Inicia sesión para continuar.", 401);
    const client = createClient(url, anon, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await client.auth.getUser(token);
    if (authError || !user) return fail("Tu sesión terminó. Vuelve a iniciar sesión.", 401);
    const raw = await req.text();
    if (raw.length > 60000) return fail("La solicitud es demasiado larga.", 413);
    let input: any;
    try {
      input = JSON.parse(raw);
    } catch {
      return fail("La solicitud no es válida.", 422);
    }
    if (input?.action !== "verify") return fail("Acción no válida.", 422);
    const purchases = Array.isArray(input.purchases) ? input.purchases : [];
    if (purchases.length > 10) return fail("Demasiadas compras en una sola solicitud.", 422);
    for (const p of purchases) {
      if (!PRODUCT_ID.test(String(p?.productId)) || !PURCHASE_TOKEN.test(String(p?.purchaseToken))) {
        return fail("Una de las compras no es válida.", 422);
      }
    }
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const results = [];
    for (const p of purchases) {
      try {
        const kind = (await admin.rpc("play_product_kind", { p_product: p.productId })).data;
        results.push(
          kind === "credits"
            ? await syncCredits(admin, p.productId, p.purchaseToken, user.id)
            : await syncSubscription(admin, p.purchaseToken, user.id),
        );
      } catch (error) {
        results.push({
          productId: p.productId,
          purchaseToken: p.purchaseToken,
          error: error instanceof PlayError ? error.message : "No pudimos verificar la compra.",
          retry: error instanceof PlayError ? error.retry : true,
        });
        if (!(error instanceof PlayError)) console.error("play verify", error);
      }
    }
    const state = await client.rpc("monetization_state");
    return Response.json(
      {
        results: results.map((r: any, i: number) => ({ ...r, purchaseToken: purchases[i].purchaseToken })),
        state: state.error ? null : state.data,
      },
      { headers },
    );
  } catch (error) {
    console.error("play-billing", error instanceof Error ? error.name : "unknown");
    return fail("No pudimos verificar tus compras. Inténtalo de nuevo.", 503);
  }
}
