# Entrar con Google (web y Android)

«Continuar con Google» está en los formularios de **Iniciar sesión** y **Crear cuenta**, encima del formulario de correo, que sigue igual. Sirve para que las personas entren sin esperar un correo de confirmación: con el SMTP de Supabase sólo salen 2 correos por hora (`supabase/config.toml`, `email_sent = 2`), compartidos entre confirmaciones y recuperaciones de contraseña.

## Cómo funciona

| Dónde | Cómo | Archivos |
| --- | --- | --- |
| Web (planifia.cl) | `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: authRedirect() } })`. Google vuelve a `https://planifia.cl/#access_token=…` y supabase-js recupera la sesión (`detectSessionInUrl`) y borra el token de la dirección. | `src/google-auth.js`, `src/main.js` |
| Android | Google bloquea OAuth dentro de un WebView (`disallowed_useragent`). El plugin `planifia-auth` usa **Credential Manager** (`GetSignInWithGoogleOption`) con el ID de cliente **Web** como `serverClientId` y devuelve el ID token. La app llama a `signInWithIdToken({ provider: "google", token, nonce })`. | `src-tauri/plugins/planifia-auth/`, `src/google-auth.js` |
| Escritorio | No se ofrece: el comando responde `{ available: false }`. | `src-tauri/plugins/planifia-auth/src/lib.rs` |

- **Nonce**: la app genera 32 bytes aleatorios. Google recibe su SHA-256 en hexadecimal y Supabase el original, y Supabase comprueba que coincidan. **No actives «Skip nonce check»**.
- **El botón sólo aparece si Google está activo en Supabase** (la app lo consulta en `/auth/v1/settings`). Mientras no completes los pasos de abajo, nadie lo ve. Desactivar Google en el panel también lo quita.
- **En Android** además hace falta `VITE_GOOGLE_WEB_CLIENT_ID` al compilar (ver el paso 6). Sin esa variable el botón no aparece en la app.
- **Permisos de Android**: ninguno que se pida en pantalla. `ACCESS_NETWORK_STATE` (normal) ya estaba por el SDK de anuncios. El plugin quita `USE_BIOMETRIC` y `USE_FINGERPRINT`, que Credential Manager 1.6 trae para una confirmación biométrica que no se usa. Versión release: la regla de R8 de Credential Manager está en `consumer-rules.pro` del plugin.
- **Errores en Android**, todos en español y sin cerrar la app: canceló (vuelve al formulario sin mensaje), teléfono sin cuenta de Google, sin Google Play Services o desactualizado, sin red, interrumpido y error genérico. El detalle técnico queda en logcat con la etiqueta `PlanifiaAuth`.
- **Errores al volver a la web** (por ejemplo «Database error saving new user» o un enlace de correo vencido): se explican en el formulario de inicio de sesión y se limpian de la dirección.

### Aceptación de los términos

Google no envía la casilla del registro, así que el trigger `private.record_signup_acceptance` no registra nada para esas cuentas. El trigger **no falla** cuando `legal` es nulo (`jsonb_typeof(null)` no es `'object'`, y además tiene `exception when others`): lo prueba `tests/google-database.test.js`.

La primera vez que una cuenta con identidad de Google entra sin ninguna aceptación registrada, la app muestra **sólo** la pantalla «Antes de empezar» con la casilla «Tengo 18 años o más y acepto los Términos de uso y la Política de privacidad». No se ve nada de la app (metas, IA, Lumi, compras ni ajustes) y no se consultan créditos ni solicitudes de IA. Al aceptar se guarda con la función existente `public.accept_legal` (`src/cloud.js`). Si no acepta, se cierra la sesión. Desde esa pantalla también puede eliminar la cuenta recién creada. Si no se puede comprobar la aceptación (sin red), la pantalla pide reintentar o cerrar sesión: nunca deja pasar.

Limitaciones:
- `accept_legal` guarda esa primera aceptación con `source = 'update'` (la función existente no distingue el caso). Se reconoce porque es la primera fila de una cuenta cuya identidad es de Google.
- Como el resto de la aceptación, se exige en la app y no en el servidor (recomendación R4 de `docs/auditoria-legal-seguridad-2026-10-18.md`).
- Una cuenta de correo antigua sin ninguna aceptación que entra por primera vez con Google también ve la pantalla obligatoria. Si entra con correo, sigue viendo el aviso de siempre.

### Cuentas que ya existen (mismo correo)

Supabase vincula automáticamente identidades con el mismo correo **verificado** a un solo usuario (`auth.users` no cambia de `id`). Comprobado en el código de Supabase Auth (`internal/models/linking.go`, `internal/api/external.go` y `internal/models/user.go`) y reproducido en `tests/google-database.test.js`:

- **Cuenta de correo confirmada**: se agrega la identidad de Google a la misma cuenta. Puede seguir entrando con su contraseña. Sus metas, créditos, XP y aceptación no cambian.
- **Cuenta de correo sin confirmar** (frecuente con el límite de 2 correos por hora): Supabase borra la identidad de correo sin confirmar y **la contraseña**, confirma el correo y deja la identidad de Google en el mismo `id`. La aceptación ya se había guardado al registrarse. Si quiere volver a usar contraseña, usa «Olvidé mi contraseña».
- **Créditos de bienvenida y recompensas**: dependen del `id` de la cuenta (`private.credit_accounts`, `credit_events` con `unique(reason, ref)`, `referrals.invitee_id`), y sólo hay triggers `after insert` en `auth.users`. Como la vinculación no crea otro usuario, no se duplican.
- **Cuenta creada con Google y después registro con correo**: Supabase no crea otra cuenta ni manda correo (responde como si nada, para no revelar qué correos existen). Esa persona debe usar «Continuar con Google» o «Olvidé mi contraseña».

### Datos que llegan de Google

Nombre, correo, enlace a la foto de perfil e identificador de la cuenta de Google (alcances `openid`, `email` y `profile`). Quedan en Supabase Auth (`raw_user_meta_data` y `auth.identities`). El nombre llena `profiles.name` sólo al crear la cuenta. La app no muestra ni usa la foto. Están declarados en `public/privacidad.html` (versión del 21 de octubre de 2026), en `docs/google-play.md` (Seguridad de los datos) y en `docs/registro-tratamientos.md`.

## Lo que tienes que hacer tú, en orden

Ningún paso está hecho. No pegues en el repositorio, en un chat ni en un issue el **secreto del cliente** (`GOCSPX-…`): sólo va en el panel de Supabase. Los ID de cliente sí son públicos.

### 1. Google Cloud Console: proyecto

1. Entra en <https://console.cloud.google.com/> con la cuenta dueña de PlanifIA y elige el proyecto que ya usas para Google Play (el de la API de Google Play Developer) o crea uno llamado `PlanifIA`.
2. Abre **Google Auth Platform** (menú → APIs y servicios → Pantalla de consentimiento de OAuth). Si es la primera vez, pulsa **Comenzar**.

### 2. Pantalla de consentimiento (Branding o Marca)

1. **Nombre de la app**: `PlanifIA`.
2. **Correo de asistencia**: `planifiaprivacity@gmail.com`.
3. **Logotipo**: una imagen cuadrada de 120×120 px (puedes usar `src-tauri/icons/128x128.png` redimensionado). Subir un logotipo obliga a verificar la marca.
4. **Página principal**: `https://planifia.cl/`.
5. **Política de privacidad**: `https://planifia.cl/privacidad.html`.
6. **Condiciones del servicio**: `https://planifia.cl/terminos.html`.
7. **Dominios autorizados**: `planifia.cl`. Si al guardar el cliente Web (paso 4) Google pide autorizar también `hlnzxgpdxgadbdcqavcd.supabase.co`, agrégalo: es el dominio de la dirección de retorno.
8. **Contacto del desarrollador**: tu correo.
9. **Público** (Audience): **Externo**. Pulsa **Publicar la app** para pasarla a **En producción**. En «Prueba» sólo pueden entrar los usuarios de prueba que agregues.
10. **Acceso a los datos** (Data Access): agrega sólo `openid`, `.../auth/userinfo.email` y `.../auth/userinfo.profile`. No agregues otros alcances. Estos tres no son sensibles: no requieren revisión de Google.
11. **Verificación de la marca**: pídela en **Centro de verificación**. `planifia.cl` ya está verificado en Google Search Console (`public/googlec7631e6f7815975d.html`), con la misma cuenta. Tarda unos días hábiles. Mientras tanto, el inicio de sesión funciona, pero la pantalla de Google muestra el dominio en vez del nombre y el logotipo.

> **Advertencia**: sin un dominio propio en Supabase (complemento de pago, plan Pro), la pantalla de Google en la **web** dice «Ir a hlnzxgpdxgadbdcqavcd.supabase.co». En Android se muestra el nombre de la app.

### 3. Cliente OAuth de tipo Web

1. **Clientes → Crear cliente → Aplicación web**. Nombre: `PlanifIA Web`.
2. **Orígenes de JavaScript autorizados**: `https://planifia.cl`.
3. **URI de redireccionamiento autorizados**: `https://hlnzxgpdxgadbdcqavcd.supabase.co/auth/v1/callback`.
4. Guarda. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`; es público) y el **secreto del cliente** (`GOCSPX-…`; es secreto). Guarda el secreto en tu gestor de contraseñas.

### 4. Clientes OAuth de tipo Android

Credential Manager comprueba que la app que pide el token esté firmada con una huella registrada. Cada cliente Android lleva un paquete y **una** huella SHA-1, así que necesitas tres:

| Nombre sugerido | Paquete | SHA-1 | Dónde está la huella |
| --- | --- | --- | --- |
| `PlanifIA Android (Google Play)` | `cl.planifia.app` | Clave de firma de apps de Google Play | Play Console → PlanifIA → **Probar y publicar → Configuración → Integridad de la app → Firma de apps** → «Certificado de la clave de firma de apps» |
| `PlanifIA Android (subida)` | `cl.planifia.app` | Clave de subida (la de `planifia-release.keystore`) | La misma página, «Certificado de la clave de subida». Sirve para el APK release que compilas tú |
| `PlanifIA Android (depuración)` | `cl.planifia.app.debug` | Clave de depuración del PC | En este PC es `0D:8E:7B:54:B2:F8:43:85:D3:84:A6:E6:65:F5:08:9F:E8:5D:6E:03`. En otro PC: `keytool -J-Duser.language=en -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android` |

Para cada uno: **Clientes → Crear cliente → Android**, el paquete y la SHA-1. Los clientes Android no tienen secreto. Copia sus ID.

### 5. Supabase

1. **Authentication → Sign In / Providers → Google**: activa **Enable Sign in with Google**.
2. **Client IDs**: el ID del cliente **Web primero** y, separados por comas, los tres de Android: `WEB,ANDROID_PLAY,ANDROID_SUBIDA,ANDROID_DEPURACION`. Supabase usa el primero para la web. Los tokens de Android llevan como audiencia el ID Web, y los demás no estorban.
3. **Client Secret (for OAuth)**: el secreto del cliente Web.
4. **Skip nonce check**: **desactivado**.
5. **Allow users without an email**: desactivado.
6. Guarda. La dirección de retorno que muestra el panel debe ser la del paso 3.
7. **Authentication → URL Configuration**: comprueba que **Site URL** sea `https://planifia.cl/` y que **Redirect URLs** incluya `https://planifia.cl/` y `https://www.planifia.cl/` (ya estaban; `supabase/config.toml` lo documenta).

Si algún día usas `npx.cmd supabase config push`: define antes `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` (la lista del punto 2) y `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` en la sesión de PowerShell, y revisa la diferencia que muestra el comando antes de confirmar. Sin ellas reemplazaría la configuración de Google del panel.

### 6. App de Android

1. En `.env.local` (no se sube a Git) agrega el ID de cliente **Web**:
   ```powershell
   VITE_GOOGLE_WEB_CLIENT_ID=TU_ID_WEB.apps.googleusercontent.com
   ```
   `npm run build` rechaza la compilación si ahí pones el secreto (`GOCSPX-…`).
2. Compila e instala el APK de depuración (`npm.cmd run android:apk`) en un teléfono con una cuenta de Google, y prueba la lista del paso 8.
3. Si aparece «No pudimos iniciar sesión con Google» y logcat muestra `PlanifiaAuth` con `[28444] Developer console is not set up correctly` o `[10]`, el paquete o la SHA-1 no coinciden con un cliente Android del paso 4.
4. Para Play: sube `versionCode`, compila el AAB (`scripts/android-aab.ps1`) y súbelo a la prueba cerrada. Lo instalado desde Play usa la clave de firma de apps de Google.

### 7. Correo propio (SMTP) y límite de correos

Con un SMTP propio, la confirmación y la recuperación de contraseña de quienes usan correo dejan de depender del cupo de 2 por hora.

1. Elige un proveedor y crea una cuenta: **Resend** (`smtp.resend.com`, puerto 465, usuario `resend`, la contraseña es una API key) o **Brevo** (`smtp-relay.brevo.com`, puerto 587, usuario y clave SMTP de su panel). Revisa sus límites gratuitos al día de hoy en sus páginas de precios.
2. Verifica el dominio `planifia.cl` en el proveedor: agrega en **Cloudflare → DNS** los registros que te indique (SPF, DKIM y, si lo pide, DMARC). Espera a que aparezca como verificado.
3. En Supabase, **Authentication → Emails → SMTP Settings**: activa **Enable Custom SMTP** con remitente `no-responder@planifia.cl`, nombre `PlanifIA`, y el host, puerto, usuario y contraseña del proveedor. La contraseña sólo va ahí.
4. **Authentication → Rate Limits**: sube **Rate limit for sending emails** de 2 a un valor acorde a tu plan del proveedor (por ejemplo 60 por hora). Supabase sólo permite subirlo con un SMTP propio. Cambia también `email_sent` en `supabase/config.toml` para que el archivo siga describiendo producción.
5. Prueba: crea una cuenta con correo nuevo y pide «Olvidé mi contraseña». Revisa que los correos lleguen y no vayan a spam.
6. Opcional: traduce las plantillas en **Authentication → Emails → Templates**.

`supabase/config.toml` tiene la sección `[auth.email.smtp]` comentada, con la contraseña en `env(SUPABASE_AUTH_SMTP_PASS)`. Descoméntala sólo si vas a usar `config push`, y define antes la variable: si no, se enviaría el texto `env(...)` como contraseña y dejarían de llegar todos los correos.

### 8. Pruebas en producción, antes de anunciarlo

Con una cuenta de Google de prueba (no la personal):

1. **Web, cuenta nueva**: «Continuar con Google» → aparece «Antes de empezar» y nada más. «No acepto, cerrar sesión» → vuelve a la portada. Entra otra vez, marca la casilla y acepta → ves la app. Recarga: no se vuelve a pedir.
2. En **SQL Editor** de Supabase (reemplaza el correo):
   ```sql
   select u.id, i.provider, a.terms_version, a.platform, a.source
   from auth.users u
   join auth.identities i on i.user_id = u.id
   left join public.legal_acceptances a on a.user_id = u.id
   where u.email = 'correo-de-prueba@gmail.com';
   ```
3. **Cuenta de correo existente**: con una cuenta de prueba creada con correo y confirmada, entra con Google con el mismo correo. La consulta anterior debe mostrar un solo `id` con `email` y `google`. Y los créditos de bienvenida, una sola vez:
   ```sql
   select reason, count(*) from private.credit_events
   where user_id = 'ID-DE-LA-CUENTA' group by reason;
   ```
4. **Android** (APK de depuración y después la versión de Play): cancelar en la ventana de Google, modo avión, un teléfono o emulador sin cuenta de Google, y uno sin Google Play (emulador con imagen «Google APIs» sin Play Store o sin cuenta). En ningún caso debe cerrarse la app.
5. **Correo** (si hiciste el paso 7): registro con correo y recuperación de contraseña.

### 9. Publicar

1. Haz que el abogado revise los cambios de la política y los términos del 21 de octubre de 2026 (sección 2 de la política, secciones 2 y 5 de los términos).
2. Publica la web (merge a `main`). Al subir `LEGAL_VERSION` a `2026-10-21`, **todas las cuentas** verán el aviso para aceptar de nuevo antes de usar la IA o comprar.
3. Play Console → **Seguridad de los datos**: actualízala con la tabla de `docs/google-play.md`, sección 6 (métodos de creación de cuentas: correo y contraseña, y OAuth; ID de usuario; enlace a la foto).
4. Sube la versión de Android con el plugin nuevo.

## Pruebas automáticas

| Comando | Qué cubre |
| --- | --- |
| `node --test tests/google-auth.test.js` | Nonce (SHA-256 en hexadecimal a Google, original a Supabase), cada estado del plugin en español, errores de Supabase, OAuth web, errores al volver |
| `node --test tests/google-database.test.js` | Alta con Google sin `legal` (sin error), vinculación a una cuenta confirmada y a una sin confirmar, sin duplicar créditos |
| `npm run test:google-ui` | La app real con Supabase y Google simulados: botón sólo con Google activo, ida y vuelta de OAuth, pantalla obligatoria, rechazo, aceptación, cuenta vinculada, errores, Android (Tauri simulado) y escritorio |
| `node --test tests/legal-security.test.js` | La política declara los datos de Google y la app no pide más alcances |

Nada de esto usa Google ni Supabase reales.

En el emulador (21 de octubre de 2026, Android 16 con Google Play Services y sin cuenta de Google, APK de depuración), el comando nativo respondió `config` con un ID de cliente inválido. Con un ID con formato válido abrió la ventana de Google, y al cancelar con Atrás devolvió `cancelled`. Sin red devolvió `offline`, y con Google Play Services desactivado, `no_play_services`. En todos los casos la app siguió abierta, con el mismo proceso. El APK release con R8 abrió sin errores y con el formulario de correo igual.

Sin las credenciales de Google **no** se pudo probar: obtener un ID token real, el inicio de sesión real en la web o en Android, la pantalla de consentimiento ni la vinculación en el Supabase real.
