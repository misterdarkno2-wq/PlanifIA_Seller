# PlanifIA para Android con Tauri 2

El APK contiene el mismo frontend Vite que la web, con sus metas, acciones, hábitos, Lumi y propuestas de IA. Supabase sigue siendo el servidor de cuentas y datos. Ollama se ejecuta en el PC del servicio, **no en el teléfono**. La aplicación necesita Internet para leer o guardar cambios; una cola pendiente conserva su estado aunque cierres la app.

## Preparación en Windows

Instala Node, Rust con las herramientas C++ de Visual Studio, Android Studio, JDK 21 y, desde SDK Manager, Android SDK 37, Build Tools, Platform Tools y NDK. Los componentes instalados aquí son NDK 29.0.13846066, Rust 1.97.1 y JDK 21. `scripts/tauri.mjs` detecta el SDK de Android Studio, el JDK 17/21 en `.jdks` y el NDK instalado; también respeta `JAVA_HOME`, `ANDROID_HOME` y `NDK_HOME` si los defines tú. No modifica las variables globales del PC.

```powershell
cd C:\Users\Admin\Downloads\PlanifIA_Seller
npm.cmd ci
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
npm.cmd run build
npm.cmd run android:apk
```

El proyecto Android está incluido en Git. `npm.cmd run android:init` sirve para inicializarlo en un proyecto nuevo; **no lo repitas encima de los ajustes nativos existentes**.

`android:apk` compila Debug para arm64 (teléfonos actuales) y x86_64 (emulador), con firma de desarrollo y nombre de paquete `cl.planifia.app.debug`. Se instala separadamente de la aplicación antigua. Los archivos se generan debajo de `src-tauri/gen/android/app/build/outputs/apk/`.

Con un teléfono conectado y depuración USB autorizada:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
# Sustituye la ruta por el APK generado indicado al terminar la compilación.
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r "ruta-al-apk.apk"
```

Para escritorio: `npm.cmd run desktop:dev` o `npm.cmd run desktop:build` (ejecutable sin instalador). Para la web: `npm.cmd run dev`.

## Servicios y permisos

- `.env.local`: solo URL y clave pública publishable/anon de Supabase. Se comprueban antes de cada build; nunca incorporar `.env.gateway.local`, claves administrativas ni contraseñas al APK.
- En Supabase, `ALLOWED_ORIGINS` incluye exactamente `https://tauri.localhost`, además de los orígenes web existentes. Los enlaces de confirmación y recuperación abren `https://planifia.cl/`, porque el origen interno del APK no es accesible desde el correo.
- El único permiso Android del manifiesto principal es Internet. No se solicita cámara, micrófono ni almacenamiento completo. La exportación utiliza el selector de documentos y escribe únicamente en la ubicación elegida; cancelar no crea un respaldo. Los errores de escritura se muestran.
- CSP restringe scripts al paquete y conexiones al proyecto Supabase. No se habilita navegación remota con permisos nativos. Las conexiones de producción requieren HTTPS; no se omite validación de certificados.
- Atrás cierra primero un formulario; después recorre las vistas y, desde Hoy/inicio, cierra la actividad. La sesión persiste para el próximo inicio. El espacio útil se ajusta a barras del sistema, recortes de pantalla y teclado.
- No hay funciones de cámara o impresión en la web que requieran adaptación. Importar JSON conserva el selector de archivos del WebView.

## Release y Google Play

```powershell
npm.cmd run android:release
```

Sin clave privada de firma se genera un **Release sin firmar**, que no debe entregarse como instalable. Debug sí es instalable. Para firmar Release prepara una clave de carga de Google Play fuera del repositorio y define las cuatro variables siguientes en la sesión de compilación:

- `PLANIFIA_ANDROID_KEYSTORE`: ruta absoluta al archivo `.jks`.
- `PLANIFIA_ANDROID_STORE_PASSWORD`: contraseña del almacén.
- `PLANIFIA_ANDROID_KEY_ALIAS`: alias de la clave.
- `PLANIFIA_ANDROID_KEY_PASSWORD`: contraseña de la clave.

Si falta alguna de las cuatro, la compilación falla con una explicación. Guarda una copia segura de tu clave: futuras actualizaciones deben mantener la identidad de firma. Para Google Play genera el AAB con `npm.cmd run android:aab`, con la misma configuración de firma. El paquete de producción es `cl.planifia.app`. Los pasos de Play Console y la prueba cerrada están en [Google Play](google-play.md).

## Compatibilidad: por qué "no se podía abrir" (2.3.2)

Los betatesters reportaron que la app no abría. El workflow **Android en emulador** (`.github/workflows/android-smoke.yml`) compila el APK release (con R8, como el AAB) y lo abre en API 26, 29, 33, 35, 36 y 37.0, y en 36 y 37.2 con páginas de memoria de 16 KB. En cada uno comprueba que la interfaz se dibuje, ejecuta los comandos de anuncios y compras, cierra con Atrás y reabre, vuelve desde Inicio, recrea la actividad y hace caer el proceso del WebView. Las anotaciones públicas del run muestran el resultado de cada versión.

| Causa encontrada | Síntoma | Corrección |
| --- | --- | --- |
| WebView sin actualizar (Android 8 trae Chrome 69 de fábrica y Android 10, Chrome 74). El paquete exigía Chrome 107+ y cada consulta a Supabase usaba `AbortSignal.any` (Chrome 116+). | Pantalla en blanco o sin conexión. | Sintaxis traducida a Chrome 87+ (`vite.config.js`), funciones faltantes en `src/compat.js` y `requestSignal` (`src/platform.js`). Si aun así no inicia, `public/compat.js` muestra un aviso con un botón a «Android System WebView» en Google Play (`PlanifiaSystem.openWebViewUpdate()` en `MainActivity.kt`). |
| Se cae el proceso del WebView (poca memoria, actualización del WebView; se reprodujo en Android 16 con páginas de 16 KB). | La app se cierra sola unos segundos después de abrir. | `onRenderProcessGone` (`scripts/android-webview-client.kt`, que `scripts/tauri.mjs` inserta en el `RustWebViewClient` de wry) reabre la pantalla en vez de cerrar la app. |
| Tauri crea los plugins una vez por proceso. Al recrear la actividad seguían usando la anterior y Billing un cliente cerrado. | El banner dejaba de responder y las compras fallaban tras volver a la app. | `PluginManager.activity` en `AdsPlugin.kt` y `BillingPlugin.kt`; Billing crea un cliente nuevo cuando hace falta. |
| El APK release era sólo arm64. | Un teléfono de 32 bits no podía instalar el APK directo. | `android:release` y `android:aab` compilan arm64, armv7 y x86_64. |

Resultado del 10 de octubre de 2026 (APK release x86_64): API 26, 29, 33, 35, 36 y 36 con 16 KB pasan todas las etapas; en 26 y 29, con el WebView de fábrica (69 y 74), se muestra el aviso de actualización. Android 17 (37.0 y 37.2) no pudo verificarse en el emulador de GitHub, porque esa imagen se reinicia sola durante la prueba; queda como prueba informativa y debe comprobarse en un teléfono con Android 17. Las pruebas usan emulador x86_64; arm64 y armv7 sólo se compilan.

Prueba local del 11 de octubre de 2026 (emulador de Android Studio en Windows, APK release x86_64 con bloques de prueba de AdMob y sin iniciar sesión):

| Emulador | 2.3.1 (la de los testers) | 2.3.2 |
| --- | --- | --- |
| Android 16, páginas de 4 KB, WebView 133 | Abre en 0,5 s; Atrás y reabrir, Inicio, rotar y tamaño de letra sin errores | — |
| Android 16, páginas de 16 KB | Abre en 2,2 s; 65 s abierta sin caída del WebView; todas las etapas sin errores | Igual, y tras forzar la caída del WebView (`Page.crash`) la app sigue abierta y vuelve a dibujarse |
| Android 17 (37.0) | No arranca: `surfaceflinger` se cae en `RegionSampling` cada 5–12 s, con GPU AMD y con `swiftshader` | — |

En local la 2.3.1 no se cae con páginas de 16 KB: la caída del WebView del emulador de GitHub probablemente se debió a la falta de memoria del runner, que es justo el caso que cubre `onRenderProcessGone`. La pantalla en blanco reportada en un Pixel **no se reprodujo**; falta probar con sesión iniciada y en Android 17. Para el emulador local hace falta el controlador AEHD (`sc query aehd` en `RUNNING`) o la Plataforma del hipervisor de Windows.

La 2.3.2 también muestra un esqueleto de carga (`index.html`, `src/boot.css`, `public/boot.js`) en vez de la pantalla en blanco mientras llega el JavaScript y Supabase recupera la sesión.

La alineación de 16 KB de `libapp_lib.so` se comprueba en cada compilación del workflow. Antes de subir una versión, revisa también **Android vitals → Fallos y ANR** y el **informe previo al lanzamiento** en Play Console.

**Límites externos:** Google Play Billing y AdMob están integrados con plugins propios (`src-tauri/plugins/`); para vender y mostrar anuncios reales debes completar la configuración de AdMob, Play Console, Google Cloud y Supabase descrita en [monetización](monetizacion.md). El SMTP propio de Supabase requiere un dominio de correo verificado para registros públicos; las pruebas administrativas no acreditan entrega de correos. La IA requiere que el servicio del PC esté encendido.

Documentación oficial: [requisitos de Tauri](https://v2.tauri.app/start/prerequisites/), [distribución Android](https://v2.tauri.app/distribute/google-play/).
