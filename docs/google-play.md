# Publicar PlanifIA en Google Play (prueba cerrada)

Respuestas para completar las 11 tareas del **Panel** de Play Console y lanzar la prueba cerrada. Paquete: `cl.planifia.app` (definido en `src-tauri/tauri.conf.json`; queda fijo con el primer AAB que subas y no se puede cambiar después).

Antes de empezar, publica la web (merge a `main`) para que existan estas URL:

- Política de privacidad: `https://planifia.cl/privacidad.html`
- Eliminación de cuenta: `https://planifia.cl/eliminar-cuenta.html`

Y aplica la migración de eliminación de cuenta en Supabase:

```powershell
npx.cmd supabase db push
```

## 1. Política de privacidad

URL: `https://planifia.cl/privacidad.html`. El correo de contacto de la política y de la página de eliminación es `planifiaprivacity@gmail.com`; usa el mismo como correo de contacto en Play Console y revísalo con frecuencia, porque ahí llegarán solicitudes de eliminación (plazo comprometido: 7 días).

Opcional, si más adelante quieres una dirección con tu dominio sin pagar Google Workspace: **Cloudflare Email Routing** (gratis; `planifia.cl` usa los DNS de Cloudflare). En Cloudflare abre `planifia.cl` → **Email** → **Email Routing**, crea `privacidad@planifia.cl` con destino `planifiaprivacity@gmail.com` y cambia la dirección en `public/privacidad.html` y `public/eliminar-cuenta.html`.

## 2. Detalles de acceso

Selecciona **Todas o algunas funciones están restringidas** y entrega una cuenta de prueba para los revisores de Google:

1. Crea en `https://planifia.cl/` una cuenta dedicada (por ejemplo `revision-play@tu-dominio`), confírmala por correo y crea una meta de ejemplo.
2. En Play Console indica el correo, la contraseña y esta nota: *"Inicia sesión con el correo y la contraseña. La generación de planes con IA puede tardar hasta 1 minuto; todas las demás funciones son inmediatas."*

No uses tu cuenta personal. Mantén el servicio de IA encendido durante la revisión o indica que la IA puede no estar disponible fuera de horario.

## 3. Anuncios

Desde la versión 2.2.0 el plan Gratis muestra anuncios de AdMob: cambia la respuesta a **Sí, mi app contiene anuncios** y declara el **ID de publicidad**. Los pasos completos (AdMob, productos de Play, cuentas de prueba, Seguridad de los datos y app-ads.txt) están en [monetización](monetizacion.md).

## 4. Clasificación de contenido

Categoría: **Utilidad, productividad, comunicación u otro**. Responde **No** a violencia, sexualidad, lenguaje, sustancias, apuestas, y a "¿los usuarios interactúan o comparten contenido?" (no hay chat entre personas ni contenido público). Para "¿la app comparte la ubicación?" responde **No**. Resultado esperado: clasificación para todos / PEGI 3.

## 5. Público objetivo

Selecciona únicamente **18 años o más**. Responde **No** a "¿podría atraer a niños?". Así la app no entra en el programa Familias. La política de privacidad lo indica.

## 6. Seguridad de los datos

Esta sección debe coincidir con `public/privacidad.html` (versión del 22 de octubre de 2026, que agrega el recordatorio diario de la app para Android; la del 21 agregó el inicio de sesión con Google). Si cambias una, cambia la otra. `tests/legal-security.test.js` comprueba que la política nombre a cada proveedor de IA y cada dato guardado en el teléfono.

- ¿Recopila o comparte datos? **Sí recopila** y **sí comparte**: el SDK de Google AdMob recoge y comparte datos de anuncios en el plan Gratis (ver [monetización](monetizacion.md)). Supabase, Cloudflare y Groq (la IA de respaldo en la nube) son proveedores que tratan datos en nombre de PlanifIA, y Google no lo considera "compartir". Groq sólo cuenta como proveedor si aceptaste su DPA y activaste Zero Data Retention (ver [respaldo en la nube](respaldo-nube.md)); si no, declara el nombre y el contenido generado por el usuario como **compartidos** y corrige la política antes de publicarla.
- ¿Datos cifrados en tránsito? **Sí**.
- ¿Las personas pueden pedir que se eliminen sus datos? **Sí**. URL: `https://planifia.cl/eliminar-cuenta.html`.
- Métodos para crear cuentas: marca **Nombre de usuario y contraseña** (correo y contraseña) y **OAuth** (Continuar con Google). Si Play Console sólo deja elegir uno, elige **Nombre de usuario, contraseña y otro método de autenticación**.
- La URL para eliminar la cuenta sirve igual para las cuentas creadas con Google: `https://planifia.cl/eliminar-cuenta.html`.
- ¿Sigue la política de Familias? **No aplica**: público objetivo de 18 años o más (sección 5).

Tipos de datos. Salvo que se indique otra cosa: *recopilado*, *no compartido*, *no efímero*, *obligatorio*, propósitos **Funcionalidad de la app** y **Administración de la cuenta**.

| Sección de Play | Dato | Notas |
| --- | --- | --- |
| Información personal → Nombre | Nombre del perfil, escrito por la persona o entregado por Google al entrar con Google | Opcional. Groq lo recibe como proveedor con cada mensaje a Lumi que responde la IA de respaldo |
| Información personal → Dirección de correo | Correo de la cuenta (lo escribe la persona o lo entrega Google) | Obligatorio |
| Información personal → ID de usuario | Identificador de la cuenta de PlanifIA y, si entra con Google, el identificador de su cuenta de Google | Obligatorio. El de PlanifIA también se **comparte** con AdMob en los anuncios recompensados (verificación SSV), propósito **Prevención de fraudes, seguridad y cumplimiento**: la política ya lo dice en la tabla de proveedores. Faltaba en esta tabla (revisión del 21 de octubre) |
| Información personal → Otra información | Enlace a la foto de perfil de Google | Sólo si entra con Google. Supabase guarda el enlace con los datos de la cuenta; la app no descarga ni muestra la imagen. Por eso no se declara en **Fotos y videos** |
| Actividad en apps → Otro contenido generado por el usuario | Metas, acciones, hábitos, texto enviado a la IA, mensajes de **Hablar con Lumi**, reportes de contenido de la IA y la hora del recordatorio diario | Obligatorio. La hora del recordatorio es opcional: sólo si la persona la elige en **Ajustes → Recordatorios**. Groq lo recibe como proveedor (planes y chat cuando responde la IA de respaldo). Los reportes también tienen el propósito **Seguridad, cumplimiento y prevención de fraudes** |
| Actividad en apps → Interacciones con la app | Progreso de Lumi, XP, uso de IA, créditos y aceptación de los términos | Obligatorio. Propósitos: Funcionalidad de la app y **Prevención de fraudes, seguridad y cumplimiento**. También **compartido** con AdMob (plan Gratis), para **Publicidad o marketing** y **Estadísticas** |
| Información financiera → Historial de compras | Compras y suscripciones de Google Play | Sólo si compras algo |
| Identificadores del dispositivo u otros → ID de dispositivo o de publicidad | ID de publicidad | Sólo plan Gratis en Android. **Recopilado y compartido** con AdMob, propósitos **Publicidad o marketing** y **Prevención de fraudes**. Sin consentimiento de UMP (en Chile, siempre) la app pide anuncios no personalizados (`npa=1`). Igual se declara así: Google sigue usando el ID para limitar la frecuencia y medir los anuncios |
| Información de la app y rendimiento → Registros de fallas y Diagnóstico | Datos técnicos que recoge el SDK de anuncios | Sólo plan Gratis en Android. **Recopilados y compartidos** con AdMob, propósito **Estadísticas** |
| Ubicación → Ubicación aproximada | Dirección IP que usa el SDK de anuncios | Sólo plan Gratis en Android. Confírmalo en la guía oficial "Google Mobile Ads SDK – Seguridad de los datos" antes de enviar |

Antes de enviar, compara la tabla con la guía oficial "Google Mobile Ads SDK – Seguridad de los datos" y con la versión vigente de `public/privacidad.html`.

No marques contactos, fotos, audio, salud, mensajes ni ubicación precisa: la app no los recopila (la voz de Lumi se sintetiza en el dispositivo y no usa el micrófono). La revisión automática de mensajes de crisis no guarda nada.

### Permisos de Android

Desde la versión 2.3.8 el plugin `planifia-reminders` agrega dos permisos para el recordatorio diario (`Ajustes → Recordatorios`, apagado por defecto):

- `POST_NOTIFICATIONS`: Android 13 o posterior lo pide en pantalla sólo cuando la persona enciende el interruptor. Es un permiso de ejecución normal: Play Console no pide declararlo.
- `RECEIVE_BOOT_COMPLETED`: permiso normal, sin diálogo. Vuelve a programar los avisos pendientes después de reiniciar el teléfono.

Los avisos usan alarmas **inexactas** (`AlarmManager.setAndAllowWhileIdle`): la app **no** declara `SCHEDULE_EXACT_ALARM` ni `USE_EXACT_ALARM`, así que no corresponde la declaración de alarmas exactas de Play Console (si alguna vez aparece, responde que la app no usa alarmas exactas). Las notificaciones las genera el teléfono: no hay servidor de notificaciones push ni SDK de terceros. El texto sólo dice cuántos pasos hay ese día, nunca los títulos. `tests/reminders.test.js` comprueba que no aparezcan permisos de alarma exacta.

### Contenido generado por IA

La política de Google Play exige que la persona pueda reportar contenido ofensivo sin salir de la app. Cada respuesta de Lumi y cada plan propuesto tienen un botón **Reportar**, que guarda el reporte en `public.ai_content_reports`. Revisa los reportes como indica `docs/plan-incidentes.md` (sección "Reportes de contenido de IA"). Si Play Console pregunta por funciones de IA generativa, responde **Sí** y describe el botón de reporte y los filtros (crisis y reglas del sistema de Lumi).

### Países de distribución

La política de privacidad está pensada para la ley chilena. Hasta que un abogado la revise para otros países, distribuye la app **sólo en Chile** (**Producción → Países o regiones**). Si la distribuyes en la Unión Europea, el Reino Unido o Suiza, el RGPD exige además un representante en la UE y revisar las transferencias. En Estados Unidos, algunos estados (por ejemplo, California) tienen leyes propias.

## 7. Apps gubernamentales

**No**.

## 8. Funciones financieras

**Mi app no ofrece ninguna función financiera** (las suscripciones de Google Play no cuentan como función financiera).

## 9. Salud

**Mi app no tiene funciones de salud**. PlanifIA es un planificador de productividad; las metas de bienestar son texto libre del usuario, sin seguimiento médico, de actividad física ni sensores.

## 10. Categoría y contacto

- Tipo: **App**. Categoría: **Productividad**. Etiquetas: planificador, metas, hábitos.
- Correo de contacto: el mismo de la política. Sitio web: `https://planifia.cl/`.

## 11. Ficha de Play Store

- Nombre: `PlanifIA: metas y hábitos` (máx. 30 caracteres).
- Descripción breve (máx. 80): `Convierte tus metas en un plan claro, con IA, hábitos y a Lumi como compañera.`
- Descripción completa: describe meta → hitos → acciones, propuestas con IA que revisas antes de guardar, hábitos, calendario y Lumi. No prometas funciones de pago que aún no estén integradas.
- Gráficos obligatorios: icono 512×512 PNG, gráfico de funciones 1024×500 y al menos 2 capturas de teléfono (mínimo 320 px, proporción entre 16:9 y 9:16). Puedes sacarlas del emulador con `adb exec-out screencap -p > captura.png`.

## Prueba cerrada

### Compilar el AAB firmado

La contraseña de la clave de carga **no** se guarda en el repositorio. El script la pide oculta, compila y borra las variables al terminar:

```powershell
cd C:\Users\Admin\Downloads\PlanifIA_Seller
powershell -ExecutionPolicy RemoteSigned -File .\scripts\android-aab.ps1
```

El archivo queda en `src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`. Guarda una copia del `.keystore` fuera del PC (y su contraseña en un gestor de contraseñas): sin él no podrás publicar actualizaciones, salvo que pidas a Google restablecer la clave de carga.

Para cada nueva subida incrementa `version` en `src-tauri/tauri.conf.json` y `bundle.android.versionCode` (Play rechaza un `versionCode` repetido).

### Crear la versión

1. **Prueba y lanza → Pruebas → Prueba cerrada → Alpha → Administrar pista**.
2. Pestaña **Verificadores**: crea una lista de correo con las cuentas Google de tus probadores y guarda. Copia el enlace de participación.
3. **Crear versión**: acepta **Firma de apps de Google Play**, sube el `.aab`, nombre `2.1.0` y notas de la versión.
4. **Países/regiones**: sólo Chile, hasta que un abogado revise los textos legales para otros países (ver la sección 6).
5. **Revisar versión → Iniciar lanzamiento a Alpha**. Se envía a revisión (habitualmente de horas a pocos días).
6. Envía el enlace de participación a los probadores; deben aceptarlo con la misma cuenta Google de la lista.

### Requisito para cuentas personales nuevas

Si tu cuenta de desarrollador es **personal** y se creó después de noviembre de 2023, para pedir acceso a producción necesitas una prueba cerrada con **al menos 12 probadores que permanezcan inscritos 14 días seguidos**. Invita a más de 12 por si alguno se retira. Después aparece **Solicitar acceso a producción** en el Panel.
