// Los textos legales deben decir lo que el código hace, y la configuración de seguridad no debe
// retroceder sin que una prueba lo note. Ver docs/auditoria-legal-seguridad-2026-10-18.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { LEGAL_URLS, LEGAL_VERSION } from "../src/legal.js";
import { setLang } from "../src/i18n.js";
import { REFERRER_POLICY, STATIC_PAGE_CSP, webCsp } from "../scripts/web-csp.js";
import { CRISIS_LINES } from "../supabase/functions/_shared/crisis.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => access(new URL(`../${path}`, import.meta.url)).then(() => true, () => false);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
// Cada página en español (la que rige) y su traducción al inglés.
const ENGLISH = {
  "public/privacidad.html": "public/privacy.html",
  "public/terminos.html": "public/terms.html",
  "public/eliminar-cuenta.html": "public/delete-account.html",
};
const PAGES = [...Object.keys(ENGLISH), ...Object.values(ENGLISH)];

test("La versión vigente está en un solo lugar y coincide con las páginas publicadas", async () => {
  for (const [kind, page] of [["privacy", "public/privacidad.html"], ["terms", "public/terminos.html"]]) {
    const html = await read(page);
    assert.match(html, new RegExp(`data-legal-version="${LEGAL_VERSION[kind]}"`), page);
    assert.equal(new URL(LEGAL_URLS[kind]).pathname, "/" + page.split("/").pop());
    // Cada versión anterior del historial está archivada, marcada como no vigente y sin indexar.
    for (const [, archived] of html.matchAll(/href="(legal\/[a-z]+-\d{4}-\d{2}-\d{2}\.html)"/g)) {
      const old = await read(`public/${archived}`);
      assert.match(old, /data-legal-archive="\d{4}-\d{2}-\d{2}"/, archived);
      assert.match(old, /<meta name="robots" content="noindex">/, archived);
      assert.match(old, new RegExp(`href="\\.\\./${page.split("/").pop()}"`), archived);
    }
    assert.ok([...html.matchAll(/href="legal\//g)].length >= 1, `${page} enlaza sus versiones anteriores`);
  }
});

test("Cada página legal tiene su traducción al inglés, de la misma versión y enlazada en ambos sentidos", async () => {
  const name = (page) => page.split("/").pop();
  for (const [es, en] of Object.entries(ENGLISH)) {
    const [spanish, english] = await Promise.all([read(es), read(en)]);
    const version = (html) => html.match(/data-legal-version="([^"]+)"/)?.[1];
    assert.equal(version(english), version(spanish), `${en} traduce la versión vigente de ${es}`);
    assert.match(spanish, new RegExp(`href="${name(en)}"`), `${es} enlaza la traducción`);
    assert.match(english, new RegExp(`href="${name(es)}"`), `${en} enlaza el original`);
    assert.match(english, /<html lang="en">/, en);
  }
  // Con la app en inglés, los enlaces legales llevan a la traducción.
  setLang("en", { remember: false });
  try {
    assert.equal(new URL(LEGAL_URLS.terms).pathname, "/terms.html");
    assert.equal(new URL(LEGAL_URLS.privacy).pathname, "/privacy.html");
  } finally {
    setLang("es", { remember: false });
  }
});

test("Las páginas publicadas no tienen datos [PENDIENTE]", async () => {
  for (const page of PAGES) assert.doesNotMatch(await read(page), /\[PENDIENTE/, page);
});

test("Las páginas legales tienen CSP sin scripts y política de referencia", async () => {
  const pages = [...PAGES, ...(await readdir(new URL("../public/legal/", import.meta.url))).map((f) => `public/legal/${f}`)];
  for (const page of pages) {
    const html = await read(page);
    assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${STATIC_PAGE_CSP}">`), page);
    assert.ok(html.includes(`<meta name="referrer" content="${REFERRER_POLICY}">`), page);
    assert.doesNotMatch(html, /<script/i, `${page} no necesita JavaScript`);
  }
});

test("Los enlaces externos llevan rel=noopener noreferrer", async () => {
  const sources = [...PAGES, "index.html"];
  for (const file of await readdir(new URL("../src/", import.meta.url))) if (file.endsWith(".js")) sources.push(`src/${file}`);
  for (const file of await readdir(new URL("../public/legal/", import.meta.url))) sources.push(`public/legal/${file}`);
  for (const source of sources) {
    const code = await read(source);
    for (const [tag] of code.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g))
      assert.match(tag, /rel="noopener noreferrer"/, `${source}: ${tag}`);
    if (source.startsWith("public/"))
      for (const [tag] of code.matchAll(/<a\b[^>]*href="https:\/\/[^"]+"[^>]*>/g))
        assert.match(tag, /rel="noopener noreferrer"/, `${source}: ${tag}`);
    assert.doesNotMatch(code, /window\.open\([^)]*"noopener"\)/, `${source} usa noopener,noreferrer`);
  }
});

test("La CSP de la web equivale a la de Tauri, con el proyecto de Supabase y sin scripts en línea", async () => {
  const parse = (csp) => new Map(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name, values];
  }));
  const tauri = parse(JSON.parse(await read("src-tauri/tauri.conf.json")).app.security.csp);
  const web = parse(webCsp("https://abc.supabase.co"));
  for (const [name, values] of tauri) {
    if (name === "connect-src") continue;
    assert.deepEqual(web.get(name), values, name);
  }
  assert.deepEqual(web.get("script-src"), ["'self'"]);
  assert.deepEqual(web.get("connect-src"), ["'self'", "https://abc.supabase.co", "wss://abc.supabase.co"]);
  assert.ok(web.has("upgrade-insecure-requests"));
  assert.deepEqual(parse(webCsp("")).get("connect-src"), ["'self'"], "Sin URL de Supabase no abre conexiones");
  assert.deepEqual(parse(webCsp("http://inseguro.example")).get("connect-src"), ["'self'"]);
});

test("La política de privacidad nombra a cada proveedor de IA que usa el servidor", async () => {
  for (const page of ["public/privacidad.html", "public/privacy.html"]) {
    const policy = text(await read(page));
    const fallback = await read("supabase/functions/_shared/ai-fallback.ts");
    const hosts = [...fallback.matchAll(/https:\/\/(?:api\.|integrate\.api\.)?([a-z0-9-]+)\.(?:com|ai|io)\b/g)].map((m) => m[1]);
    assert.ok(hosts.length, "ai-fallback.ts declara la URL de su proveedor");
    for (const provider of new Set(hosts))
      assert.match(policy, new RegExp(provider, "i"), `${page} debe mencionar a ${provider}`);
    for (const provider of ["Supabase", "Cloudflare", "GitHub", "Google Play", "AdMob", "Brevo"])
      assert.ok(policy.includes(provider), `${page}: ${provider}`);
  }
});

test("La política dice qué datos llegan al entrar con Google, y la app no pide más permisos", async () => {
  const policy = text(await read("public/privacidad.html"));
  assert.match(policy, /Continuar con Google/);
  for (const data of ["nombre", "correo", "foto de perfil", "identificador de tu cuenta de Google", "openid", "email", "profile"])
    assert.ok(policy.includes(data), data);
  // Sin alcances adicionales: Supabase pide a Google sólo openid, email y profile.
  assert.doesNotMatch(await read("src/google-auth.js"), /scopes\s*:/);
  const plugin = await read("src-tauri/plugins/planifia-auth/android/src/main/java/AuthPlugin.kt");
  assert.doesNotMatch(plugin, /requestScopes|Scope\(/);
  // Credential Manager trae permisos biométricos que «Continuar con Google» no usa.
  const manifest = await read("src-tauri/plugins/planifia-auth/android/src/main/AndroidManifest.xml");
  for (const permission of ["USE_BIOMETRIC", "USE_FINGERPRINT"])
    assert.match(manifest, new RegExp(`android\\.permission\\.${permission}" tools:node="remove"`), permission);
});

test("Cada dato que la app guarda en el navegador o el teléfono aparece en la política", async () => {
  const [policy, english] = await Promise.all([read("public/privacidad.html"), read("public/privacy.html")]);
  const keys = new Set();
  // Constantes *_KEY, llamadas a get/set/removeItem, read/write de lumi-messages.js y la clave de
  // solicitudes de IA de cloud.js. Se compara el prefijo fijo: "planifia-plan:" + cuenta, etc.
  const patterns =
    /(?:KEY|Key)\s*=\s*["'`]([^"'`$]+)|(?:getItem|setItem|removeItem)\(\s*["'`]([^"'`$]+)|(?:read|write)\(\s*(?:storage|session)\s*,\s*["'`]([^"'`$]+)|const key = `([^`$]+)/g;
  for (const file of await readdir(new URL("../src/", import.meta.url))) {
    if (!file.endsWith(".js")) continue;
    for (const match of (await read(`src/${file}`)).matchAll(patterns)) keys.add(match.slice(1).find(Boolean));
  }
  assert.ok(keys.size >= 12, `Se encontraron ${keys.size} claves`);
  for (const key of keys) assert.ok(policy.includes(key), `La política no menciona ${key}`);
  for (const key of keys) assert.ok(english.includes(key), `La traducción de la política no menciona ${key}`);
  assert.ok(policy.includes("planifia-seller-auth"));
});

test("Los términos muestran las mismas líneas de ayuda que el aviso de crisis", async () => {
  const terms = text(await read("public/terminos.html"));
  for (const line of CRISIS_LINES.filter((l) => ["*4141", "600 360 7777", "131", "133"].includes(l.phone)))
    assert.ok(terms.includes(line.phone), line.phone);
  assert.match(terms, /No son consejo médico, psicológico, legal ni financiero/);
  assert.match(terms, /Derecho de retracto/);
});

test("Android no respalda la sesión en la nube ni la copia a otro teléfono", async () => {
  const manifest = await read("src-tauri/gen/android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/);
  const rules = await read("src-tauri/gen/android/app/src/main/res/xml/data_extraction_rules.xml");
  for (const section of ["cloud-backup", "device-transfer"]) {
    const block = rules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1] || "";
    for (const domain of ["root", "file", "database", "sharedpref"])
      assert.match(block, new RegExp(`<exclude domain="${domain}" path="\\." />`), `${section}: ${domain}`);
  }
  const gradle = await read("src-tauri/gen/android/app/build.gradle.kts");
  assert.match(gradle, /manifestPlaceholders\["usesCleartextTraffic"\] = "false"/, "Release sin tráfico en texto plano");
});

test("Ninguna Edge Function responde CORS con comodín y todas las acciones de CI están fijadas por SHA", async () => {
  const functions = new URL("../supabase/functions/", import.meta.url);
  for (const dir of await readdir(functions)) {
    if (!(await exists(`supabase/functions/${dir}/handler.ts`))) continue;
    const code = await read(`supabase/functions/${dir}/handler.ts`);
    assert.doesNotMatch(code, /Access-Control-Allow-Origin["']?\s*:\s*["']\*/, dir);
  }
  for (const file of await readdir(new URL("../.github/workflows/", import.meta.url))) {
    const workflow = await read(`.github/workflows/${file}`);
    for (const [, action] of workflow.matchAll(/uses:\s*([^\s#]+)/g))
      assert.match(action, /@[0-9a-f]{40}$/, `${file}: ${action}`);
  }
});
