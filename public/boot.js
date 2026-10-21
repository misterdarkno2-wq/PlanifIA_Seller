// Elige el esqueleto de carga antes de pintar: el de la app si hay una sesión guardada, si no el
// de la portada. ES5 y sin módulos para que corra de inmediato. La clave es la de src/cloud.js.
(function () {
  try {
    // También al volver de Google con la sesión en el enlace (#access_token=…).
    if (localStorage.getItem("planifia-seller-auth") || /[#&]access_token=/.test(location.hash))
      document.documentElement.setAttribute("data-boot", "app");
  } catch (error) {
    // Sin acceso a localStorage se muestra el esqueleto de la portada.
  }
})();
