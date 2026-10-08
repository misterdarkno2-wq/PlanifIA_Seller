// Ejecuta en el WebView de la app (vía DevTools) los comandos nativos que la app usa al iniciar
// sesión: anuncios y compras. Uso: node scripts/android-cdp.mjs 9222
const port = process.argv[2] || "9222";
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page") || targets[0];
if (!page) throw new Error("El WebView no expone ninguna página.");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
ws.onclose = () => console.log("[cdp] conexión cerrada (la app pudo haberse cerrado)");
let next = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
};
const send = (method, params) =>
  new Promise((resolve) => {
    const id = ++next;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

async function run(label, expression, timeoutMs = 30000) {
  const code = `(async () => {
    const limit = new Promise((_, fail) => setTimeout(() => fail(new Error("sin respuesta en ${timeoutMs} ms")), ${timeoutMs}));
    try { return JSON.stringify(await Promise.race([${expression}, limit])); }
    catch (error) { return "ERROR: " + (error?.message || error); }
  })()`;
  const reply = await Promise.race([
    send("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true }),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs + 5000)),
  ]);
  const value = reply?.result?.result?.value ?? JSON.stringify(reply?.result?.exceptionDetails ?? reply?.error);
  console.log(`[cdp] ${label}: ${reply ? value : "SIN RESPUESTA (¿la app se cerró?)"}`);
}
const invoke = (command, args = {}) =>
  `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await run("página", "Promise.resolve(location.href)");
await run("márgenes", 'Promise.resolve(window.PlanifiaInsets ? window.PlanifiaInsets.get() : "sin puente")');
await run("ads init_ads", invoke("plugin:planifia-ads|init_ads"), 60000);
await run("ads get_ads_state", invoke("plugin:planifia-ads|get_ads_state"));
await run("ads show_banner", invoke("plugin:planifia-ads|show_banner", { position: "bottom" }), 45000);
await wait(3000);
await run("ads hide_banner", invoke("plugin:planifia-ads|hide_banner"));
await run("ads load_interstitial", invoke("plugin:planifia-ads|load_interstitial"), 45000);
await run("ads load_rewarded", invoke("plugin:planifia-ads|load_rewarded"), 45000);
await run("billing restore_purchases", invoke("plugin:planifia-billing|restore_purchases"), 45000);
await run(
  "billing get_products",
  invoke("plugin:planifia-billing|get_products", { subscriptions: ["planifia_plus"], products: ["creditos_100"] }),
  45000,
);
await wait(3000);
await run("app sigue respondiendo", "Promise.resolve(document.title)");
ws.close();
