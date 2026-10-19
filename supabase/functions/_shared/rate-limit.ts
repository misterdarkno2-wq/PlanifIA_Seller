// Límite por dirección IP para las funciones que gastan IA o créditos (goal-plan, lumi-chat y
// ai-fallback). Complementa los límites por cuenta de la base de datos: frena a quien crea muchas
// cuentas desde un mismo equipo. La IP nunca llega a la base: se guarda un hash SHA-256 con secreto
// por ventanas de 10 minutos (public.rate_limit_take borra lo que tiene más de un día).
// Es generoso porque en Chile muchas redes móviles comparten una IP (CGNAT). Si la base no responde,
// deja pasar la solicitud: los límites por cuenta siguen aplicando.

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

export const IP_LIMIT = { bucket: "ai", limit: 120, windowSeconds: 600 };
export const IP_LIMITED = "Hay demasiadas solicitudes desde tu conexión. Espera unos minutos y vuelve a intentarlo. No se descontaron créditos.";

/**
 * IP del cliente según el proxy de Supabase. Una cabecera X-Forwarded-For enviada por el propio
 * cliente podría falsearla: por eso este límite es sólo una capa adicional.
 */
export function clientIp(req: Request) {
  const forwarded = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ip = forwarded || req.headers.get("x-real-ip")?.trim() || req.headers.get("cf-connecting-ip")?.trim() || "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : "";
}

export async function ipKey(ip: string, salt: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}

/** false si la IP superó el límite. Sin IP o sin secreto no limita. */
export async function allowIp(
  admin: RpcClient,
  req: Request,
  { salt = Deno.env.get("RATE_LIMIT_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", limit = IP_LIMIT } = {},
) {
  const ip = clientIp(req);
  if (!ip || !salt) return true;
  const { data, error } = await admin.rpc("rate_limit_take", {
    p_bucket: limit.bucket,
    p_key: await ipKey(ip, salt),
    p_limit: limit.limit,
    p_window_seconds: limit.windowSeconds,
  });
  if (error) {
    console.error("rate-limit", error.code || "unknown");
    return true;
  }
  return data !== false;
}
