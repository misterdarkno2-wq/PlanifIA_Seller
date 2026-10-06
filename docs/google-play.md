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

Ya completado: **No, la app no contiene anuncios**.

## 4. Clasificación de contenido

Categoría: **Utilidad, productividad, comunicación u otro**. Responde **No** a violencia, sexualidad, lenguaje, sustancias, apuestas, y a "¿los usuarios interactúan o comparten contenido?" (no hay chat entre personas ni contenido público). Para "¿la app comparte la ubicación?" responde **No**. Resultado esperado: clasificación para todos / PEGI 3.

## 5. Público objetivo

Selecciona únicamente **18 años o más**. Responde **No** a "¿podría atraer a niños?". Así la app no entra en el programa Familias. La política de privacidad lo indica.

## 6. Seguridad de los datos

- ¿Recopila o comparte datos? **Sí recopila**. ¿Comparte con terceros? **No** (Supabase y Cloudflare son proveedores que tratan datos en nombre de PlanifIA; Google no lo considera "compartir").
- ¿Datos cifrados en tránsito? **Sí**.
- ¿Las personas pueden pedir que se eliminen sus datos? **Sí**. URL: `https://planifia.cl/eliminar-cuenta.html`.
- Las cuentas se crean **con nombre de usuario (correo) y contraseña**.

Tipos de datos (todos: *recopilados*, *no compartidos*, *no efímeros*, *obligatorios* salvo que se indique, propósito **Funcionalidad de la app** y **Administración de la cuenta**):

| Sección de Play | Dato | Notas |
| --- | --- | --- |
| Información personal → Nombre | Nombre del perfil | Opcional |
| Información personal → Dirección de correo | Correo de la cuenta | Obligatorio |
| Actividad en apps → Otro contenido generado por el usuario | Metas, acciones, hábitos y texto enviado a la IA | Obligatorio |
| Actividad en apps → Interacciones con la app | Progreso de Lumi, XP y uso mensual de IA | Obligatorio |
| Información financiera → Historial de compras | Plan y periodos de suscripción | Sólo si contratas un plan |

No marques ubicación, contactos, fotos, audio, salud, mensajes, identificadores de dispositivo, diagnósticos ni analítica: la app no los recopila (la voz de Lumi se sintetiza en el dispositivo y no usa el micrófono).

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

La contraseña de la clave de carga **no** se guarda en el repositorio. En PowerShell, en la misma sesión:

```powershell
cd C:\Users\Admin\Downloads\PlanifIA_Seller
$env:PLANIFIA_ANDROID_KEYSTORE = "C:\Users\Admin\Downloads\PlanifIA_Seller\planifia-release.keystore"
$env:PLANIFIA_ANDROID_KEY_ALIAS = "planifia"
$env:PLANIFIA_ANDROID_STORE_PASSWORD = Read-Host "Contraseña del almacén"
$env:PLANIFIA_ANDROID_KEY_PASSWORD = Read-Host "Contraseña de la clave"
npm.cmd run android:aab
```

El archivo queda en `src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`. Guarda una copia del `.keystore` fuera del PC (y su contraseña en un gestor de contraseñas): sin él no podrás publicar actualizaciones, salvo que pidas a Google restablecer la clave de carga.

Para cada nueva subida incrementa `version` en `src-tauri/tauri.conf.json` y `bundle.android.versionCode` (Play rechaza un `versionCode` repetido).

### Crear la versión

1. **Prueba y lanza → Pruebas → Prueba cerrada → Alpha → Administrar pista**.
2. Pestaña **Verificadores**: crea una lista de correo con las cuentas Google de tus probadores y guarda. Copia el enlace de participación.
3. **Crear versión**: acepta **Firma de apps de Google Play**, sube el `.aab`, nombre `2.1.0` y notas de la versión.
4. **Países/regiones**: Chile (y los que quieras).
5. **Revisar versión → Iniciar lanzamiento a Alpha**. Se envía a revisión (habitualmente de horas a pocos días).
6. Envía el enlace de participación a los probadores; deben aceptarlo con la misma cuenta Google de la lista.

### Requisito para cuentas personales nuevas

Si tu cuenta de desarrollador es **personal** y se creó después de noviembre de 2023, para pedir acceso a producción necesitas una prueba cerrada con **al menos 12 probadores que permanezcan inscritos 14 días seguidos**. Invita a más de 12 por si alguno se retira. Después aparece **Solicitar acceso a producción** en el Panel.
