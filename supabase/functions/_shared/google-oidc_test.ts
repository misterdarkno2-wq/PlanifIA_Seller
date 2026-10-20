// JWT OIDC de Pub/Sub: claves RSA generadas en la prueba, nunca claves reales de Google.
import { googleKeys, resetGoogleKeyCache, verifyGoogleOidc } from "./google-oidc.ts";
import { handlePlayRtdn } from "../play-rtdn/handler.ts";

function assert(condition: unknown, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}
const AUDIENCE = "https://supabase.example.test/functions/v1/play-rtdn";
const ACCOUNT = "pubsub-push@planifia-test.iam.gserviceaccount.com";
const encode = (value: unknown) =>
  btoa(typeof value === "string" ? value : JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function signer() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "test-kid", typ: "JWT" }) => {
    const body = `${encode(header)}.${encode(claims)}`;
    const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body)));
    return `${body}.${encode(String.fromCharCode(...signature))}`;
  };
  return { jwks: { keys: [{ ...jwk, kid: "test-kid", alg: "RS256", use: "sig" }] }, sign };
}
const now = Math.floor(Date.now() / 1000);
const valid = { iss: "https://accounts.google.com", aud: AUDIENCE, email: ACCOUNT, email_verified: true, iat: now, exp: now + 3600 };

Deno.test("Acepta sólo tokens firmados por la clave de Google con la audiencia y la cuenta esperadas", async () => {
  const { jwks, sign } = await signer();
  resetGoogleKeyCache();
  const keys = await googleKeys(async () => Response.json(jwks));
  const check = async (token: string) => await verifyGoogleOidc(token, { audience: AUDIENCE, email: ACCOUNT, keys });
  assert((await check(await sign(valid)))?.email === ACCOUNT, "Token válido");
  assert(!(await check(await sign({ ...valid, aud: "https://otra.example.test" }))), "Otra audiencia");
  assert(!(await check(await sign({ ...valid, email: "otra@example.test" }))), "Otra cuenta de servicio");
  assert(!(await check(await sign({ ...valid, email_verified: false }))), "Correo sin verificar");
  assert(!(await check(await sign({ ...valid, iss: "https://evil.example.test" }))), "Otro emisor");
  assert(!(await check(await sign({ ...valid, exp: now - 3600 }))), "Vencido");
  assert(!(await check(await sign(valid, { alg: "none", kid: "test-kid" }))), "alg none");
  assert(!(await check(await sign(valid, { alg: "RS256", kid: "otra" }))), "kid desconocido");
  const token = await sign(valid);
  const tampered = token.split(".");
  tampered[1] = encode({ ...valid, email: "otra@example.test" });
  assert(!(await check(tampered.join("."))), "Contenido alterado");
  assert(!(await check("no-es-un-jwt")));
  resetGoogleKeyCache();
});

Deno.test("play-rtdn con la autenticación activada exige el JWT además del secreto de la URL", async () => {
  const { jwks, sign } = await signer();
  resetGoogleKeyCache();
  const savedFetch = globalThis.fetch;
  const keys = ["PLAY_RTDN_SECRET", "PLAY_RTDN_AUDIENCE", "PLAY_RTDN_SERVICE_ACCOUNT", "GOOGLE_PLAY_PACKAGE_NAME"];
  const saved = new Map(keys.map((key) => [key, Deno.env.get(key)]));
  const secret = "s".repeat(40);
  Deno.env.set("PLAY_RTDN_SECRET", secret);
  Deno.env.set("PLAY_RTDN_AUDIENCE", AUDIENCE);
  Deno.env.set("PLAY_RTDN_SERVICE_ACCOUNT", ACCOUNT);
  Deno.env.set("GOOGLE_PLAY_PACKAGE_NAME", "cl.planifia.app");
  globalThis.fetch = async (input) => {
    if (String(input) === "https://www.googleapis.com/oauth2/v3/certs") return Response.json(jwks);
    throw new Error("Unexpected fixture URL " + String(input));
  };
  // Un aviso de otra app se ignora con 200 después de pasar la autenticación: no consulta a Google Play.
  const notice = { message: { data: btoa(JSON.stringify({ packageName: "otra.app" })) } };
  const send = (token: string | null, query = secret) =>
    handlePlayRtdn(new Request(`https://function.example.test/play-rtdn?token=${query}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(notice),
    }));
  try {
    assert((await send(null)).status === 401, "Sin JWT");
    assert((await send(await sign({ ...valid, aud: "https://otra.example.test" }))).status === 401, "JWT de otra audiencia");
    assert((await send(await sign(valid), "x".repeat(40))).status === 401, "JWT válido pero secreto incorrecto");
    const ok = await send(await sign(valid));
    assert(ok.status === 200 && (await ok.text()) === "Ignorado.", "JWT y secreto válidos");
  } finally {
    globalThis.fetch = savedFetch;
    resetGoogleKeyCache();
    for (const [key, value] of saved) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
});
