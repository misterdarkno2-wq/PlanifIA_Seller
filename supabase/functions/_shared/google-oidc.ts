// Verificación del JWT OIDC que Pub/Sub envía en "Authorization: Bearer" cuando la suscripción push
// tiene la autenticación activada (cuenta de servicio y audiencia). Firma RS256 de Google.
// https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SKEW_SECONDS = 300;
let keyCache: { keys: Map<string, CryptoKey>; until: number } | null = null;

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );
const decodeJson = (value: string) => JSON.parse(new TextDecoder().decode(fromBase64Url(value)));

export async function googleKeys(fetcher: typeof fetch = fetch) {
  if (keyCache && keyCache.until > Date.now()) return keyCache.keys;
  const response = await fetcher(CERTS_URL, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("No se pudieron obtener las claves de Google.");
  const body = await response.json();
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys || []) {
    if (jwk?.kty !== "RSA" || typeof jwk.kid !== "string") continue;
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]),
    );
  }
  keyCache = { keys, until: Date.now() + 6 * 3600 * 1000 };
  return keys;
}
export function resetGoogleKeyCache() {
  keyCache = null;
}

export type OidcClaims = { iss: string; aud: string; email: string; email_verified: boolean; exp: number; iat: number };

/** Los datos del token si la firma es de Google y coinciden la audiencia y la cuenta de servicio. */
export async function verifyGoogleOidc(
  token: string,
  { audience, email, keys, now = Date.now() }: { audience: string; email: string; keys: Map<string, CryptoKey>; now?: number },
): Promise<OidcClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || !audience || !email) return null;
  try {
    const header = decodeJson(parts[0]);
    if (header?.alg !== "RS256" || typeof header.kid !== "string") return null;
    const key = keys.get(header.kid);
    if (!key) return null;
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const claims = decodeJson(parts[1]) as OidcClaims;
    const seconds = now / 1000;
    if (!ISSUERS.has(claims.iss) || claims.aud !== audience) return null;
    if (claims.email !== email || claims.email_verified !== true) return null;
    if (!(claims.exp > seconds - SKEW_SECONDS) || !(claims.iat < seconds + SKEW_SECONDS)) return null;
    return claims;
  } catch {
    return null;
  }
}
