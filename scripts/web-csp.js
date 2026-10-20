// Política de seguridad de contenido (CSP) de la web publicada en GitHub Pages.
// GitHub Pages no permite cabeceras propias, así que va en <meta http-equiv>. Es equivalente a la de
// src-tauri/tauri.conf.json sin los orígenes ipc: de Tauri. frame-ancestors no tiene efecto en una
// etiqueta <meta>: para impedir que otra web incruste planifia.cl hace falta una cabecera (Cloudflare).

/** Orígenes https y wss del proyecto de Supabase, o [] si la URL falta o no es https. */
export function supabaseOrigins(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    if (parsed.protocol !== "https:") return [];
    return [parsed.origin, `wss://${parsed.host}`];
  } catch {
    return [];
  }
}

export function webCsp(supabaseUrl) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Los atributos style de los SVG de Lumi y de las páginas legales necesitan 'unsafe-inline'.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    ["connect-src 'self'", ...supabaseOrigins(supabaseUrl)].join(" "),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** CSP de las páginas estáticas de public/ (políticas y eliminación de cuenta): sin scripts. */
export const STATIC_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'";

export const REFERRER_POLICY = "strict-origin-when-cross-origin";

/** Etiquetas que se insertan justo después de <meta charset> en index.html. */
export function webSecurityMeta(supabaseUrl) {
  return (
    `<meta http-equiv="Content-Security-Policy" content="${webCsp(supabaseUrl)}" />\n` +
    `    <meta name="referrer" content="${REFERRER_POLICY}" />`
  );
}
