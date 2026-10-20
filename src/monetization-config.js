// Configuración de anuncios y compras de la app Android.
// Los IDs de AdMob se editan en src-tauri/gen/android/app/src/main/res/values/admob.xml.
// Los IDs de productos de Google Play (planifia_plus, planifia_pro, creditos_100…) vienen del servidor
// (tabla private.play_products) y deben crearse con el mismo ID en Play Console.

export const PLAY = {
  // Plan base mensual de cada suscripción en Play Console.
  basePlanId: "mensual",
  // Oferta de introducción (primer mes $900 Plus / $1.900 Pro). Google la muestra sólo a quien es elegible.
  introOfferId: "primer-mes",
  packageName: "cl.planifia.app",
};

// Las direcciones de los textos legales se definen junto a su versión vigente, en src/legal.js.
export { LEGAL_URLS as LEGAL } from "./legal.js";
