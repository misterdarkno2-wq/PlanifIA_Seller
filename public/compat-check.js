// Se carga antes que la app y sólo usa JavaScript antiguo (ES5) para funcionar en cualquier
// WebView. Si el WebView del teléfono es demasiado antiguo, la app no puede iniciarse y antes
// quedaba una pantalla en blanco: aquí se explica cómo actualizarlo.
(function () {
  var MIN_CHROME = 87;
  var android = /Android/i.test(navigator.userAgent);
  var match = navigator.userAgent.match(/Chrome\/(\d+)/);
  var version = match ? Number(match[1]) : 0;

  function started() {
    var app = document.getElementById("app");
    return Boolean(app && app.childElementCount > 0);
  }

  function warn() {
    if (started() || document.getElementById("compat-warning")) return;
    var box = document.createElement("div");
    box.id = "compat-warning";
    box.setAttribute("role", "alert");
    box.style.cssText =
      "max-width:28rem;margin:15vh auto 0;padding:24px;font:16px/1.5 sans-serif;color:#1d2b27;text-align:center";
    var title = document.createElement("h1");
    title.style.cssText = "font-size:1.3rem;margin:0 0 12px";
    title.textContent = "PlanifIA necesita una actualización del sistema";
    var text = document.createElement("p");
    var old = version && version < MIN_CHROME;
    if (!old) title.textContent = "PlanifIA no pudo iniciarse";
    text.textContent = android
      ? (old
          ? "Tu teléfono usa una versión antigua de «Android System WebView» (" + version + "). "
          : "Puede faltar una actualización de «Android System WebView». ") +
        "Actualízala desde Google Play y vuelve a abrir PlanifIA."
      : old
        ? "Tu navegador es demasiado antiguo para PlanifIA. Actualízalo y vuelve a abrir la página."
        : "Recarga la página. Si sigue sin abrir, actualiza tu navegador.";
    box.appendChild(title);
    box.appendChild(text);
    if (android) {
      var link = document.createElement("a");
      link.href = "https://play.google.com/store/apps/details?id=com.google.android.webview";
      link.textContent = "Abrir Android System WebView en Google Play";
      link.style.cssText =
        "display:inline-block;margin-top:12px;padding:12px 18px;border-radius:10px;background:#10796c;color:#fff;text-decoration:none";
      if (window.PlanifiaSystem && window.PlanifiaSystem.openWebViewUpdate) {
        // Dentro de la app el enlace se abriría en el propio WebView: se abre Google Play.
        link.addEventListener("click", function (event) {
          event.preventDefault();
          window.PlanifiaSystem.openWebViewUpdate();
        });
      }
      box.appendChild(link);
    }
    document.body.appendChild(box);
  }

  if (version && version < MIN_CHROME) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", warn);
    else warn();
  }
  // Cualquier otro motivo que impida iniciar la app también deja un mensaje en vez de nada.
  window.addEventListener("load", function () {
    setTimeout(warn, 10000);
  });
})();
