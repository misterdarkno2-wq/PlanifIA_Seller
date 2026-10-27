// Elige el esqueleto de carga antes de pintar: el de la app si hay una sesión guardada, si no el
// de la portada. ES5 y sin módulos para que corra de inmediato. La clave es la de src/cloud.js.
// También fija el idioma (misma regla y clave que src/i18n.js) para que el esqueleto y el título
// no aparezcan en español a quien usa la app en inglés.
(function () {
  var lang = "es";
  try {
    var stored = localStorage.getItem("planifia-lang");
    var tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    if (stored === "es" || stored === "en") lang = stored;
    else if (tags[0]) {
      lang = "en";
      for (var i = 0; i < tags.length; i++) {
        var base = String(tags[i] || "").toLowerCase().split("-")[0];
        if (base === "es" || base === "en") {
          lang = base;
          break;
        }
      }
    }
  } catch (error) {
    // Sin acceso a localStorage se usa el idioma del navegador o español.
  }
  document.documentElement.lang = lang;
  if (lang === "en") {
    document.title = "PlanifIA · Your goals, step by step";
    document.addEventListener("DOMContentLoaded", function () {
      var skip = document.querySelector(".skip-link");
      var boot = document.getElementById("boot");
      if (skip) skip.textContent = "Skip to content";
      if (boot) boot.setAttribute("aria-label", "Loading PlanifIA");
    });
  }
  try {
    // También al volver de Google con la sesión en el enlace (#access_token=…).
    if (localStorage.getItem("planifia-seller-auth") || /[#&]access_token=/.test(location.hash))
      document.documentElement.setAttribute("data-boot", "app");
  } catch (error) {
    // Sin acceso a localStorage se muestra el esqueleto de la portada.
  }
})();
