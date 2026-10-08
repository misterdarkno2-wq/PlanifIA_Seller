import { createClient } from "npm:@supabase/supabase-js@2.58.0";

// Verificación del lado del servidor (SSV) de AdMob: Google firma cada recompensa con ECDSA P-256.
// https://developers.google.com/admob/android/ssv
const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let keyCache: { keys: Map<string, CryptoKey>; until: number } | null = null;

const fromBase64 = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );

// AdMob entrega la firma en DER; WebCrypto espera r||s de 32 bytes cada uno.
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let offset = 0;
  const read = () => der[offset++];
  if (read() !== 0x30) throw new Error("firma inválida");
  let length = read();
  if (length & 0x80) offset += length & 0x7f;
  const integer = () => {
    if (read() !== 0x02) throw new Error("firma inválida");
    const size = read();
    let bytes: Uint8Array = der.slice(offset, offset + size);
    offset += size;
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.slice(1);
    if (bytes.length > 32) throw new Error("firma inválida");
    const padded = new Uint8Array(32);
    padded.set(bytes, 32 - bytes.length);
    return padded;
  };
  const raw = new Uint8Array(64);
  raw.set(integer(), 0);
  raw.set(integer(), 32);
  return raw;
}

export async function verifierKeys(fetcher: typeof fetch = fetch) {
  if (keyCache && keyCache.until > Date.now()) return keyCache.keys;
  const response = await fetcher(KEYS_URL, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("No se pudieron obtener las claves de AdMob.");
  const body = await response.json();
  const keys = new Map<string, CryptoKey>();
  for (const key of body.keys || []) {
    keys.set(
      String(key.keyId),
      await crypto.subtle.importKey(
        "spki",
        fromBase64(key.base64),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      ),
    );
  }
  keyCache = { keys, until: Date.now() + 12 * 3600 * 1000 };
  return keys;
}
export function resetAdmobKeyCache() {
  keyCache = null;
}

// Devuelve los parámetros sólo si la firma es auténtica.
export async function verifyAdmobCallback(rawQuery: string, keys: Map<string, CryptoKey>) {
  const at = rawQuery.indexOf("&signature=");
  if (at < 0) return null;
  const message = rawQuery.slice(0, at);
  const params = new URLSearchParams(rawQuery);
  const signature = params.get("signature"), keyId = params.get("key_id");
  const key = keyId ? keys.get(keyId) : undefined;
  if (!signature || !key) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      derToRaw(fromBase64(signature)),
      new TextEncoder().encode(message),
    );
  } catch {
    return null;
  }
  return valid ? params : null;
}

export async function handleAdmobSsv(req: Request) {
  if (req.method !== "GET") return new Response("Método no permitido.", { status: 405 });
  // Se firma la consulta tal como la envía Google; no se normaliza con URL().
  const rawQuery = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1).split("#")[0] : "";
  let params: URLSearchParams | null;
  try {
    params = await verifyAdmobCallback(rawQuery, await verifierKeys());
  } catch (error) {
    console.error("admob-ssv keys", error instanceof Error ? error.message : "unknown");
    return new Response("Reintentar.", { status: 503 });
  }
  if (!params) return new Response("Firma inválida.", { status: 400 });
  const expectedUnit = Deno.env.get("ADMOB_REWARDED_AD_UNIT");
  const userId = params.get("user_id") || "", transaction = params.get("transaction_id") || "";
  // La prueba de "Verificar URL" de la consola de AdMob llega firmada pero sin usuario.
  if (!UUID.test(userId) || !transaction) return Response.json({ ok: true, ignored: true });
  if (expectedUnit && params.get("ad_unit") !== expectedUnit.split("/").pop()) {
    return Response.json({ ok: true, ignored: "ad_unit" });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc("admob_reward", {
    p_user: userId.toLowerCase(),
    p_transaction: transaction,
  });
  if (error) {
    console.error("admob-ssv reward", error.code);
    return new Response("Reintentar.", { status: 503 });
  }
  return Response.json({ ok: true, ...data });
}
