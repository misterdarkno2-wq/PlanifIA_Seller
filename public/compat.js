// Script clásico en ES5: corre aunque el WebView no entienda el paquete moderno de la app.
// Si la interfaz no aparece, explica qué actualizar en vez de dejar la pantalla en blanco.
(function () {
  var MIN_CHROME = 107; // build.target de vite.config.js
  var match = /Chrome\/(\d+)/.exec(navigator.userAgent);
  var version = match ? Number(match[1]) : 0;

  function show() {
    var app = document.getElementById("app");
    if (!app || app.children.length) return;
    var android = /Android/i.test(navigator.userAgent);
    app.innerHTML =
      '<main style="max-width:420px;margin:15vh auto 0;padding:24px;font:16px/1.5 system-ui,sans-serif;color:#1d2b26;text-align:center">' +
      '<h1 style="font-size:22px">No se pudo abrir PlanifIA</h1>' +
      (android
        ? "<p>Tu teléfono usa una versión antigua de <strong>Android System WebView</strong>" +
          (version ? " (" + version + ")" : "") +
          ". Actualízala desde Google Play (también <strong>Google Chrome</strong>) y vuelve a abrir la app.</p>"
        : "<p>Tu navegador es demasiado antiguo para PlanifIA. Actualízalo y vuelve a intentarlo.</p>") +
      "</main>";
  }

  if (version && version < MIN_CHROME) window.addEventListener("load", function () { setTimeout(show, 1500); });
  // Cualquier otro error que impida dibujar la interfaz.
  window.addEventListener("load", function () { setTimeout(show, 8000); });
})();
