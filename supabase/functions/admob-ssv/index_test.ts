import { derToRaw, handleAdmobSsv, resetAdmobKeyCache, verifyAdmobCallback } from "./handler.ts";

function assert(value: unknown, message = "Assertion failed") {
  if (!value) throw new Error(message);
}
const USER = "11111111-1111-4111-8111-111111111111";
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// WebCrypto firma en r||s; AdMob envía DER. Se construye DER para reproducir a Google.
function rawToDer(raw: Uint8Array) {
  const int = (bytes: Uint8Array) => {
    let b = bytes;
    while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.slice(1);
    if (b[0] & 0x80) b = Uint8Array.from([0, ...b]);
    return [0x02, b.length, ...b];
  };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}
async function signed(query: string, key: CryptoKey) {
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(query)),
  );
  return `${query}&signature=${b64url(rawToDer(raw))}&key_id=3335741209`;
}

Deno.test("AdMob SSV: DER se convierte a r||s", () => {
  const raw = crypto.getRandomValues(new Uint8Array(64));
  raw[0] = 0x80;
  raw[32] = 0;
  const back = derToRaw(rawToDer(raw));
  assert(back.every((v, i) => v === raw[i]));
});

Deno.test("AdMob SSV: sólo una firma auténtica sobre la consulta exacta acredita al usuario", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const keys = new Map([["3335741209", pair.publicKey]]);
  const query =
    `ad_network=5450213213286189855&ad_unit=5224354917&reward_amount=10&reward_item=creditos&timestamp=1507770365237823&transaction_id=tx-1&user_id=${USER}`;
  const valid = await signed(query, pair.privateKey);
  assert((await verifyAdmobCallback(valid, keys))?.get("user_id") === USER);
  assert(await verifyAdmobCallback(valid.replace("tx-1", "tx-2"), keys) === null, "Alterar la consulta invalida");
  assert(await verifyAdmobCallback(valid.replace("key_id=3335741209", "key_id=1"), keys) === null);
  assert(await verifyAdmobCallback(query, keys) === null, "Sin firma no hay recompensa");
  const withoutUser = await signed(query.split("&user_id=")[0], pair.privateKey);
  assert(await verifyAdmobCallback(`${withoutUser}&user_id=${USER}`, keys) === null,
    "Un usuario añadido fuera de la firma no puede recibir créditos");
  assert(await verifyAdmobCallback(`${valid}&transaction_id=another`, keys) === null,
    "No acepta parámetros de recompensa fuera de la firma");
  assert(await verifyAdmobCallback(`${valid}&key_id=3335741209`, keys) === null,
    "No acepta claves duplicadas");
  assert(await verifyAdmobCallback(await signed(`${query}&user_id=${USER}`, pair.privateKey), keys) === null,
    "Tampoco acepta datos firmados ambiguos");

  const exported = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  Deno.env.set("SUPABASE_URL", "https://supabase.example.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-admin");
  Deno.env.delete("ADMOB_REWARDED_AD_UNIT");
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.includes("verifier-keys")) {
      return Response.json({ keys: [{ keyId: 3335741209, base64: btoa(String.fromCharCode(...exported)) }] });
    }
    if (url.includes("/rpc/admob_reward")) {
      const body = JSON.parse(String(init?.body ?? (input as Request).body ?? "{}"));
      assert(body.p_user === USER && body.p_transaction === "tx-1");
      return Response.json({ granted: true, credits: 10 });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  try {
    resetAdmobKeyCache();
    const ok = await handleAdmobSsv(new Request(`https://x.test/functions/v1/admob-ssv?${valid}`));
    assert(ok.status === 200);
    assert((await ok.json()).granted === true);
    const forged = await handleAdmobSsv(new Request(`https://x.test/functions/v1/admob-ssv?${valid.replace("tx-1", "tx-9")}`));
    assert(forged.status === 400);
    const unsignedUser = await handleAdmobSsv(new Request(`https://x.test/functions/v1/admob-ssv?${withoutUser}&user_id=${USER}`));
    assert(unsignedUser.status === 400, "El controlador tampoco acredita campos no firmados");
    const consoleCheck = await handleAdmobSsv(
      new Request(`https://x.test/functions/v1/admob-ssv?${await signed("ad_network=1&ad_unit=2&timestamp=3&transaction_id=t", pair.privateKey)}`),
    );
    assert((await consoleCheck.json()).ignored === true, "La verificación de la consola responde 200 sin acreditar");
    assert(calls.filter((c) => c.includes("/rpc/admob_reward")).length === 1);
  } finally {
    globalThis.fetch = oldFetch;
    resetAdmobKeyCache();
  }
});
