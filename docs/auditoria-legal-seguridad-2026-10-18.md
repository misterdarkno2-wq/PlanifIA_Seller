# Auditoría legal y de seguridad de PlanifIA (18 y 19 de octubre de 2026)

Revisión hecha con `docs/prompt-legal-seguridad.md` en la rama `feature/legal-seguridad`, creada desde `feature/respaldo-nube-nvidia` (`d99878d`). **Nada se subió (push), ni se aplicó en Supabase, ni se publicó.**

> Este informe no es asesoría legal y no afirma que PlanifIA cumpla una ley. Describe qué se cambió y qué falta revisar. Antes de publicar los textos, un abogado chileno debe revisarlos junto con las [preguntas](#6-preguntas-para-el-abogado) de la sección 6.

## Resumen

**Qué cambió (11 commits)**:
- Registro con casilla obligatoria de 18 años y aceptación, guardada en la base con fecha y versión.
- Pantalla para aceptar de nuevo antes de usar la IA o comprar.
- Botón **Reportar** en cada respuesta de Lumi y en cada plan.
- Líneas de ayuda de Chile ante mensajes de crisis, en la app y en el servidor.
- Resumen visible antes de cada compra de Google Play.
- Política de privacidad y términos reescritos, con las versiones anteriores archivadas.
- CSP en la web.
- Android sin respaldo en la nube.
- Límites por IP.
- Verificación opcional del JWT de Pub/Sub.
- Errores genéricos en `goal-plan`.
- CI con gitleaks, CodeQL, Dependabot y acciones fijadas por SHA.
- Plan de incidentes y registro de tratamientos.

Además se dejó en su propio commit el cambio del dueño de NVIDIA a Groq.

**Qué falta**:
- Los datos del responsable: nombre o razón social, RUT y domicilio. El dueño no tiene empresa y no quiere publicar sus datos personales; las opciones están en la [sección 5.1](#51-identificación-del-responsable-sin-publicar-datos-personales).
- Decisiones legales: retracto, anuncios en Chile, datos sensibles, transferencias, incidente NVIDIA.
- Los pasos manuales en Supabase, Groq, Play y GitHub ([sección 7](#7-pasos-manuales-en-orden)).

**Qué necesita tu aprobación**:
- Aplicar la migración `202610180001_legal_reports.sql` y desplegar las funciones.
- Cambiar la configuración de Auth.
- Publicar la web y subir una versión a Play.
- Decidir con el abogado si se avisa a las personas cuyos datos llegaron a NVIDIA (hallazgo C1).

## 1. Inventario (fase 1)

### 1.1 Datos personales, dónde viven y quién los recibe

| Dato | Dónde se guarda | Quién lo recibe | País |
| --- | --- | --- | --- |
| Correo, contraseña (hash), accesos (IP, navegador) | Supabase Auth | Supabase | EE. UU.: región `us-east-2` (East US, Ohio) del proyecto `hlnzxgpdxgadbdcqavcd`, plan Free |
| Nombre, zona horaria, disponibilidad, metas, hitos, acciones, hábitos, XP, importaciones | `public.*` (RLS) y `private.commands`, `private.import_items` | Supabase | Igual |
| Texto de planes y propuestas | `public.ai_jobs`, `private.ai_job_payloads` | Supabase; PC propio (Chile) por el túnel de Cloudflare; respaldo en la nube | Chile; EE. UU. (Cloudflare, Groq) |
| Mensajes del chat (últimos 100) y contexto (nombre, 3 metas) | `public.lumi_chat_messages` | Igual que planes | Igual |
| Créditos, anuncios recompensados, invitaciones | `private.credit_*`, `private.referral*` | Supabase; AdMob envía la confirmación (SSV) | EE. UU. |
| Compras de Google Play (token, pedido, estado, `raw`) | `private.play_*`, `public.subscriptions` | Google Play | EE. UU. y otros |
| ID de publicidad, IP, datos del dispositivo (plan Gratis) | SDK de AdMob | Google AdMob y UMP | EE. UU. y otros |
| Aceptación de términos, reportes de IA, hash de IP (nuevos) | `public.legal_acceptances`, `public.ai_content_reports`, `private.rate_limits` | Supabase | Igual que la base |
| Visitas a la web | GitHub Pages | GitHub | EE. UU. |
| Correos de soporte | Gmail `planifiaprivacity@gmail.com` | Google | EE. UU. |

Del 14 al 19 de octubre el respaldo en la nube fue **NVIDIA (API de prueba)**; ahora es **Groq** (hallazgo C1).

### 1.2 Almacenamiento en el dispositivo

- **Sin cookies**: la web no escribe cookies y GitHub Pages tampoco. La sesión de Supabase va en `localStorage`.
- **15 claves de almacenamiento local o de sesión**, todas esenciales o de preferencia. Están en la tabla de la política, sección 7, y `tests/legal-security.test.js` las compara con el código.
- **SDK de Google en Android**: UMP guarda el estado de consentimiento. AdMob y Play Billing guardan su propia caché.
- **Muro de cookies**: no corresponde, porque no hay nada no esencial en la web. Basta la sección de la política.

### 1.3 Permisos de Android (manifiesto final de release)

| Permiso | Lo agrega | Nivel |
| --- | --- | --- |
| `INTERNET` | App | Normal |
| `ACCESS_NETWORK_STATE`, `READ_BASIC_PHONE_STATE`, `com.google.android.gms.permission.AD_ID` | SDK de anuncios (`ads-mobile-sdk:1.5.0`) | Normal |
| `com.android.vending.BILLING` | Play Billing 9.1.0 | Normal |
| `WAKE_LOCK`, `FOREGROUND_SERVICE` | WorkManager 2.7.0 (dependencia de anuncios) | Normal |
| `cl.planifia.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX | Firma |

Ninguno se pide en pantalla. Release: `usesCleartextTraffic=false` (`build.gradle.kts:21`), R8 activo (`optimization { enable = true }`, línea 70) y depuración desactivada por defecto. Fuente: `app/build/intermediates/merged_manifests/universalRelease/...` (compilación 2.3.4).

### 1.4 Base de datos

Método: se aplicaron todas las migraciones en PostgreSQL (PGlite), emulando los privilegios por defecto de Supabase (`grant all` a `anon` y `authenticated` en tablas y funciones nuevas). Después se consultó el catálogo.

- **Tablas**: 18 en `public` (16 antes de esta rama), todas con RLS. Las políticas son de lectura y filtran por `user_id = (select auth.uid())`. `plan_catalog` es pública a propósito y muestra sólo planes activos. `ai_jobs` usa `auth.uid()` sin `select` (hallazgo B3).
- **Permisos**: `authenticated` sólo tiene `SELECT` y `anon` sólo puede leer `plan_catalog`. No hay `INSERT`, `UPDATE` ni `DELETE` directos.
- **Esquema `private`**: 28 tablas, sin uso para `anon` ni `authenticated`.
- **Funciones `SECURITY DEFINER`**: 53 (49 más 4 nuevas), todas con `search_path=''`.
  - Las de servicio (`play_*`, `admob_reward`, `claim_*`, `finish_ai_job`, `rate_limit_take`, etc.) sólo las ejecuta `service_role`.
  - `anon` sólo ejecuta `billing_promotion()`, que es información pública de la campaña.
  - Validan sus parámetros: estados, días, zona horaria, UUID, largos y límites.
- **Eliminación de cuenta**: `delete_my_account` borra `auth.users` y todo cae en cascada (33 tablas con FK `on delete cascade`).
  - Se verificó el riesgo de fraude al borrar los tokens de compra: cada compra lleva el id de cuenta ofuscado (`obfuscatedExternalAccountId`), y si otra cuenta reutiliza el token recibe un 409 (`play-sync.ts:36`).
- **Security Advisor de Supabase**: no se ejecutó en el proyecto real (sin acceso). Las reglas equivalentes se revisaron a mano con el método anterior. Paso manual 7.9.

### 1.5 Edge Functions

| Función | Autenticación | Validación y límites | CORS | Firma o idempotencia |
| --- | --- | --- | --- | --- |
| `goal-plan` | Sesión (`getUser`) | Cuerpo ≤ 20.000 car. (lectura acotada), UUID, largos, minutos, fecha; límites por cuenta en la cola; **nuevo**: límite por IP y crisis | Lista cerrada `ALLOWED_ORIGINS` | `request_id` |
| `lumi-chat` | Sesión | Cuerpo ≤ 16 KB, texto 1–500, UUID; límites por minuto y día; **nuevo**: IP y crisis | Lista cerrada | `request_id` |
| `ai-fallback` | Sesión | Cuerpo ≤ 2 KB, UUID; límites por cuenta y globales; **nuevo**: IP | Lista cerrada | Toma sólo solicitudes de la cuenta |
| `play-billing` | Sesión | **Nuevo**: lectura acotada a 60.000 bytes; ≤ 10 compras; regex de producto y token | Lista cerrada | Verificación con la API de Google; cuenta ofuscada |
| `play-rtdn` | Secreto ≥ 32 en la URL; **nuevo**: JWT OIDC de Pub/Sub opcional | El aviso sólo indica qué token volver a consultar | No aplica | Revalida en Google |
| `admob-ssv` | Firma ECDSA de Google (`handler.ts:65`) | Sólo campos firmados; unidad esperada | No aplica | Transacción única (`202610070001_play_credits.sql:444`) |
| `billing`, `billing-return`, `billing-renew` | Sesión; token de Transbank correlacionado; secreto del cron | **Nuevo**: lectura acotada en `billing-return` | Lista cerrada en `billing` | Estado de la orden (Transbank en integración) |

Ninguna función responde `Access-Control-Allow-Origin: *` (lo comprueba `tests/legal-security.test.js`).

### 1.6 Secretos

- **Archivos con secretos, ignorados por `.gitignore`** y nunca subidos según el historial:
  - `.env.local` y `.env.gateway.local`, que tiene la clave de servicio de la cola en el PC, como corresponde.
  - `planifia-release.keystore`.
  - `.cloudflared/` (credenciales del túnel y configuración que expone sólo `127.0.0.1:8012`).
- **Historial de Git** (90 commits): gitleaks y trufflehog no estaban instalados, así que se buscaron a mano los patrones `nvapi-`, `sb_secret_`, JWT, `AIza`, claves privadas PEM y `TunnelSecret`.
  - Sólo aparecen valores de prueba (`nvapi-test-only…`, `sb_secret_test…`, JWT `…fixture`, PEM generado en una prueba).
  - Desde ahora gitleaks corre en CI (`.github/workflows/security.yml`).
- **Logs `*.log` de la raíz** (21 archivos): sin correos, tokens, claves ni texto de usuarios. Sólo hay IP locales (`127.0.0.1`, `192.168.1.x`).
  - `seller-ollama.stderr.log` muestra `Ollama cloud disabled: false` (hallazgo B6).
- **Puertos del PC**: Ollama escucha en `127.0.0.1:11434` y el gateway en `127.0.0.1:8012`, ambos sólo locales.
  - El gateway exige un Bearer comparado en tiempo constante (`scripts/ollama-gateway.js:463`) y no registra el contenido.
- **Dependencias**:
  - `npm audit`: 0 vulnerabilidades.
  - `cargo audit` (439 crates): 0 vulnerabilidades. Hay 2 avisos de dependencias transitivas de Tauri: `proc-macro-error` sin mantención (RUSTSEC-2024-0370) y `glib` 0.18.5 con un iterador inseguro (RUSTSEC-2024-0429), que sólo afecta a Linux.

## 2. Hallazgos por gravedad

Las líneas indican dónde quedó cada corrección en la rama.

### Crítico

**C1. Del 14 al 19 de octubre el respaldo de IA envió datos de usuarios a NVIDIA con una clave de prueba, contradiciendo la política publicada.**
- **Archivos**: `supabase/functions/_shared/ai-fallback.ts` (antes de `294da4f`).
- **Riesgo**: la política vigente en planifia.cl (9 de octubre, verificada el 19 de octubre) dice que el texto «se procesa en un servidor propio de PlanifIA, no en servicios de IA de terceros». Los términos de prueba de NVIDIA prohíben el uso en producción y los datos personales, y permiten usar el contenido para mejorar sus modelos. Hubo tratamiento y transferencia internacional no informados (nombre del perfil y mensajes del chat; textos de planes), además de un incumplimiento contractual.
- **Hecho**:
  - El dueño apagó el respaldo en producción (`enabled=false`) el 19 de octubre.
  - El código pasó a Groq (`294da4f`).
  - La política nueva declara a Groq con su país.
  - El incidente quedó registrado en `docs/plan-incidentes.md` (registro, fila 1).
- **Falta**:
  - Revocar la clave de NVIDIA y borrar el secreto.
  - Pedir a NVIDIA la eliminación, si es posible.
  - Decidir con el abogado si se avisa a las personas afectadas. Los planes afectados se identifican con `ai_jobs.provider='cloud'`; los chats no se pueden identificar por completo.
  - Publicar la política nueva antes de volver a encender cualquier respaldo.

### Alto

**A1. El registro no pedía aceptar los términos ni confirmar los 18 años, y no se guardaba prueba de aceptación.**
- **Archivos**: `src/main.js` (casilla en el registro, línea 914; metadatos, línea 943) y `supabase/migrations/202610180001_legal_reports.sql` (tabla, línea 23; trigger del registro, línea 40).
- **Riesgo**: Ley 19.496, art. 12 A (consentimiento en contratos electrónicos). Google Play declara un público de 18 años o más.
- **Hecho**:
  - La casilla es obligatoria y empieza sin marcar. Los enlaces se abren aparte sin perder lo escrito y **Crear cuenta** sigue deshabilitado hasta marcarla.
  - El servidor guarda la versión, la fecha y hora y la plataforma, y la persona puede leer esa fila pero no modificarla.
  - La versión vigente está en un solo lugar: `src/legal.js:7`.
  - Pruebas: `tests/legal-database.test.js`, `tests/legal-ui.mjs` y `tests/ui.mjs`.

**A2. Las cuentas existentes no tenían cómo aceptar una versión nueva.**
- **Archivos**: `src/main.js` (`checkLegal`, línea 158; `legalGate`, línea 182) y `src/legal.js`.
- **Hecho**:
  - Al entrar se muestra un aviso una vez por sesión.
  - Antes de usar la IA (planes y chat) o comprar aparece una tarjeta dentro del formulario, del chat o de la compra, con salidas para exportar los datos o eliminar la cuenta.
  - Si la tabla aún no existe (migración pendiente), la app no bloquea nada.

**A3. Faltaba el botón para reportar contenido generado por IA, que exige Google Play.**
- **Archivos**: `src/ai-report.js`, `src/lumi-chat.js:141`, `src/main.js:1502` y `report_ai_content` en la migración (línea 80).
- **Hecho**:
  - El botón aparece en cada respuesta de Lumi y en cada plan.
  - El servidor guarda su propia copia del contenido, tomada de la base, con un máximo de 20 reportes al día y uno por elemento.
  - La revisión está en `docs/plan-incidentes.md`, sección 8.

**A4. El chat no manejaba las crisis: el modelo tenía instrucciones de no dar números de ayuda.**
- **Archivos**: `supabase/functions/_shared/crisis.js`, `lumi-chat/handler.ts` (antes del modelo, línea 133; sobre la respuesta, línea 200), `goal-plan/handler.ts:112`, `src/lumi-chat.js:220` y `src/main.js:1223`.
- **Hecho**:
  - Un aviso fijo con *4141, Salud Responde 600 360 7777, SAMU 131, Carabineros 133 y SernamEG 1455. Los números se verificaron el 18 de octubre en minsal.cl y chileatiende.gob.cl.
  - El aviso no se cobra, no se guarda y no llega a la IA.
  - Si la respuesta del modelo trata esos temas, se descarta y se devuelven los créditos.
  - Pruebas en Deno y de interfaz.
  - Es una lista de expresiones, no un clasificador, y puede tener falsos positivos y negativos. Se mejora con los reportes.

**A5. La política no identificaba al responsable, no daba bases legales ni transferencias, y los derechos y plazos de la Ley 21.719 estaban incompletos.**
- **Archivos**: `public/privacidad.html`.
- **Hecho**: se reescribió con 12 secciones y una tabla de almacenamiento local. Los datos que faltan quedan como `[PENDIENTE]`, resaltados en amarillo (14 en la política y 6 en los términos).

**A6. En Chile se cargan anuncios personalizados sin pedir consentimiento.** UMP sólo muestra el formulario en el EEE, el Reino Unido y Suiza.
- **Archivos**: `src-tauri/plugins/planifia-ads/android/src/main/java/AdsPlugin.kt:160`.
- **Riesgo**: la Ley 19.628 y la Ley 21.719 exigen una base legal para tratar el ID de publicidad.
- **Hecho**: la política lo declara con `[PENDIENTE]`.
- **Falta**: decisión del abogado (pregunta 2). Las opciones son pedir consentimiento con un mensaje propio de UMP («otras regulaciones») o solicitar anuncios no personalizados.

**A7. La política y `eliminar-cuenta.html` decían «No conservamos ningún dato tras la eliminación».**
- **Hecho**: la base sí se borra en cascada, pero quedan los registros de Auth y de las funciones, las copias de seguridad, los registros de Google y los correos. Los textos ahora lo dicen, con una tabla de plazos.

**A8. La web no tenía CSP.**
- **Archivos**: `vite.config.js:7` y `scripts/web-csp.js`.
- **Hecho**:
  - La compilación web inserta una CSP equivalente a la de `tauri.conf.json` (sin `ipc:`, con el proyecto de Supabase y `upgrade-insecure-requests`) y `referrer strict-origin-when-cross-origin`.
  - Las páginas legales tienen su propia CSP sin scripts.
  - `tests/csp-ui.mjs` compila la web y la recorre a 390 y 1366 px sin bloqueos, con un control negativo.

**A9. Android respaldaba la sesión de la WebView en Google Drive**, porque `allowBackup` no estaba declarado.
- **Archivos**: `AndroidManifest.xml:12` y `res/xml/data_extraction_rules.xml`.
- **Hecho**: se desactivó el respaldo en la nube y se excluye todo de la copia a otro teléfono.

**A10. Las compras se abrían en Google Play sin un resumen propio, y los términos no explicaban el retracto.**
- **Archivos**: `src/billing.js` (`purchaseSummary`, línea 352; `review`, línea 574) y `public/terminos.html`, sección 10.
- **Hecho**:
  - Antes de abrir Google Play se muestra qué se compra, el precio, la renovación, cómo cancelar y los enlaces a los términos.
  - Hay una sección de retracto destacada, con `[PENDIENTE: validar con abogado]`.

### Medio

- **M1. `goal-plan` devolvía mensajes técnicos al usuario** (por ejemplo, el error de `JSON.parse`) y pistas internas («Revisa la migración de la cola»).
  - **Archivo**: `goal-plan/handler.ts:84` y `302`.
  - **Hecho**: mensajes genéricos. Sólo los errores escritos para la persona (`PublicError`) se muestran tal cual.
- **M2. `play-rtdn` se autenticaba sólo con un secreto en la URL**, que puede quedar en los logs.
  - **Archivo**: `play-rtdn/handler.ts:22`.
  - **Hecho**: verificación opcional del JWT OIDC de Pub/Sub (RS256, audiencia, cuenta de servicio, emisor, vigencia), además del secreto.
  - **Falta**: configurarlo (paso manual 7.6).
- **M3. `play-billing` y `billing-return` leían el cuerpo completo antes de limitarlo.**
  - **Archivos**: `play-billing/handler.ts:45` y `billing-return/handler.ts:20`.
  - **Hecho**: ahora la lectura es acotada en streaming, y un error de verificación ya no se registra completo.
- **M4. No había límite por IP y el registro no tenía CAPTCHA.** Facilita crear cuentas falsas para acumular créditos de bienvenida.
  - **Hecho**:
    - Límite por IP con hash y secreto: 120 solicitudes en 10 minutos en `goal-plan` y `lumi-chat`, y 60 en `ai-fallback` (`_shared/rate-limit.ts`).
    - Límites de Auth propuestos en `supabase/config.toml`.
  - Límite del enfoque: si el cliente envía su propio `X-Forwarded-For` podría falsear la IP. Por eso es una capa adicional a los límites por cuenta.
  - **Falta**: CAPTCHA con Turnstile (recomendación R1).
- **M5. Auth aceptaba contraseñas de 8 caracteres sin requisitos**, y la lista de redirecciones incluye `localhost` y la dirección antigua de github.io.
  - **Archivo**: `supabase/config.toml:11`.
  - **Hecho**: la app exige 10 caracteres con letras y números, y se propone lo mismo en el servidor, junto con rotación de tokens, confirmación doble del correo y cambio de contraseña seguro.
  - **Falta**: aplicarlo en producción (paso 7.4).
- **M6. CI sin escaneo de secretos ni de código**, con acciones fijadas por etiquetas que se pueden mover.
  - **Hecho**: gitleaks, `npm audit`, `cargo audit`, CodeQL, Dependabot (npm, cargo, gradle y GitHub Actions) y todas las acciones fijadas por SHA. Una prueba lo verifica.
- **M7. Las solicitudes de IA se conservan sin plazo mientras exista la cuenta**, igual que la caché de idempotencia, que guarda copias de lo enviado.
  - **Archivos**: `public.ai_jobs` y `private.ai_job_payloads` (`202610050001_ai_queue.sql:17` y `40`) y `private.commands` (`202610030001_goals.sql:76`).
  - **Hecho**: la política lo declara.
  - **Recomendación**: un trabajo `pg_cron` que borre las solicitudes terminadas y los comandos después de, por ejemplo, 90 días. Es una decisión de producto que queda pendiente.
- **M8. «Exportar mis datos» no incluía el chat, las solicitudes de IA, los créditos, las compras ni las aceptaciones** (derecho de acceso y portabilidad).
  - **Archivo**: `src/main.js:210`.
  - **Hecho**: ahora sí los incluye.
- **M9. Groq no tiene DPA ni retención cero confirmados**, y la cuenta está en el plan Free.
  - **Hecho**: la política lo condiciona con `[PENDIENTE]`.
  - **Falta**: no encender el respaldo antes de completar el paso 7.2.
- **M10. La app se distribuye fuera de Chile sin revisión del RGPD.**
  - **Hecho**: `docs/google-play.md` recomienda distribuir sólo en Chile.
  - **Falta**: decisión en Play Console.
- **M12. El plan Free de Supabase no incluye copias de seguridad automáticas.**
  - **Riesgo**: si la base se daña o se borra por error, se pierden las cuentas, las metas y las compras de todas las personas. La Ley 21.719 incluye la disponibilidad en el deber de seguridad.
  - **Hecho**: la política dice que hoy no hay copias de seguridad automáticas (antes decía 30 días).
  - **Recomendación**:
    - Pasar al plan Pro, que guarda copias por 7 días, y actualizar la política.
    - O hacer copias manuales con `npx.cmd supabase db dump`, guardadas cifradas fuera del PC y con un plazo definido. En ese caso también hay que actualizar la política.
- **M11. La sección Seguridad de los datos de Play se contradecía con `monetizacion.md`**: decía «no marques identificadores ni diagnósticos».
  - **Hecho**: quedó una sola tabla, igual a la política, con los datos de AdMob.

### Bajo

- **B1.** Faltaba `noreferrer` en los enlaces externos (`src/billing.js:688` y `src/main.js`). **Hecho**, y una prueba lo verifica.
- **B2.** GitHub Pages no permite `frame-ancestors`, HSTS ni `X-Content-Type-Options` (en `<meta>` no tienen efecto).
  - **Recomendación**: poner Cloudflare como proxy delante de planifia.cl, que ya usa sus DNS, con una regla de cabeceras: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors 'none'` y `Permissions-Policy`.
- **B3.** La política RLS de `ai_jobs` usa `auth.uid()` sin `(select …)`, lo que la hace más lenta pero no menos segura (`202610050001_ai_queue.sql:46`). Recomendación: corregirla en una migración futura.
- **B4.** El SDK de anuncios agrega `READ_BASIC_PHONE_STATE`, un permiso normal. Recomendación: evaluar quitarlo con `tools:node="remove"`, probándolo en un teléfono.
- **B5.** El `FileProvider` de Tauri usa `external-path "."` (`file_paths.xml:3`). No está exportado. Recomendación: acotarlo si no se usa.
- **B6.** Ollama tiene activas sus funciones en la nube (`Ollama cloud disabled: false`). Recomendación: desactivarlas en su configuración para que ningún modelo `:cloud` envíe datos fuera del PC.
- **B7.** El keystore de carga está en la raíz del proyecto. Nunca se subió a Git y está en `.gitignore`.
  - Recomendación: moverlo fuera de la carpeta del repositorio, con una copia cifrada fuera del PC.
  - Confirmar en Play Console que Play App Signing está activo.
- **B8.** El correo de contacto es `planifiaprivacity@gmail.com`. Recomendación: usar una dirección del dominio (`privacidad@planifia.cl` con Cloudflare Email Routing, como explica `docs/google-play.md`).
- **B9.** En `src-tauri/capabilities/default.json`, `fs:allow-write-text-file` no tiene un alcance explícito: sólo escribe en la ruta que la persona elige con el diálogo. Ya es mínimo y no se cambió.
- **B10.** Hay 2 avisos de `cargo audit` en dependencias transitivas de Tauri, sin acción posible hasta que Tauri las actualice. Dependabot avisará.
- **B11.** Supabase puede guardar los registros de auditoría de Auth (fecha, `user_id`, IP, navegador) también en la tabla `auth.audit_log_entries` de la base. Ahí no vencen y no se borran al eliminar la cuenta.
  - **Recomendación**: en **Authentication → Audit Logs**, desactivar el guardado en la base de datos. Si la tabla ya tiene filas, borrar las antiguas (`delete from auth.audit_log_entries where created_at < now() - interval '30 days';`) y definir un plazo.
  - Mientras tanto, la política lo deja como `[PENDIENTE]`.

## 3. Cambios hechos (commits en `feature/legal-seguridad`)

| Commit | Qué hace |
| --- | --- |
| `a3aec19` | Trabajo en curso del dueño (NVIDIA en los textos), llevado a la rama |
| `3527035` | Android sin respaldo en la nube ni copia entre teléfonos |
| `0aed344` | CSP y referrer en la web; `noreferrer` |
| `25fa00d` | Migración: aceptación legal, reportes de IA, límite por IP |
| `8b9c8d8` | Edge Functions: crisis, errores genéricos, límite por IP |
| `f12b585` | App: casilla, nueva aceptación, reportes, crisis, resumen de compra, derechos, exportación completa |
| `9e71f2f` | JWT de Pub/Sub en `play-rtdn`; lectura acotada en pagos |
| `9908b61` | CI: SHA, gitleaks, CodeQL, auditoría de dependencias, Dependabot |
| `294da4f` | Trabajo del dueño del 19 de octubre: respaldo de Groq en lugar de NVIDIA |
| `e58590b` | Política, términos, versiones archivadas, `eliminar-cuenta.html`, ficha de Play y prueba de coherencia |
| `27082ae` | Propuesta de Auth en `supabase/config.toml` |
| `b7d26a2` | Prueba de la web compilada con CSP |

Además, en el commit de este informe: `docs/plan-incidentes.md`, `docs/registro-tratamientos.md` y este informe.

## 4. Pruebas

Todas pasaron el 19 de octubre de 2026, en Windows con Edge:

| Comando | Resultado |
| --- | --- |
| `npm test` | 181 pruebas, 0 fallas. Nuevas: `legal-database.test.js` (7) y `legal-security.test.js` (9) |
| `npm run test:edge` | 74 pruebas Deno, 0 fallas. Nuevas: crisis, IP, JWT OIDC, JSON inválido |
| `npm run check:edge` | OK |
| `npm run test:ui` | OK (registro con casilla y metadatos legales) |
| `npm run test:billing-ui` | OK (resumen antes de Google Play) |
| `npm run test:companion-ui`, `test:chat-ui`, `test:update-ui` | OK |
| `npm run test:mobile-regressions` | 27 pruebas, 0 fallas |
| `npm run test:legal-ui` (nueva) | OK: casilla, enlaces sin perder lo escrito, nueva aceptación, reportes, crisis y XSS en nombre, metas, acciones, hábitos y respuestas de Lumi, a 375 y 1366 px |
| `npm run test:csp-ui` (nueva) | OK: web compilada sin bloqueos de la CSP, sin errores y sin desborde a 390 y 1366 px |
| `npm run build` | OK |
| `npm audit` / `cargo audit` | 0 vulnerabilidades |

**Revisión de `innerHTML`**: todo dato de la persona y toda salida de la IA pasa por `e()` o `escapeText`, o se inserta con `textContent`. Los componentes nuevos (crisis, reporte, tarjeta legal) usan sólo nodos y `textContent`, o textos fijos. Las cargas XSS se probaron en la interfaz real.

**No probado**:
- La app de Android en un teléfono: manifiesto, flujo de compra nativo y apertura de enlaces externos.
- Las funciones contra el Supabase real.
- El JWT de Pub/Sub con Google.
- Groq con una clave real.

## 5. Pendientes que debe completar el dueño

| # | Pendiente | Dónde |
| --- | --- | --- |
| P1 | Nombre completo o razón social del responsable. **Decisión del dueño (19 de octubre):** no hay empresa y no quiere publicar su nombre ni su RUT personal. Queda abierto hasta elegir una de las opciones de la sección 5.1 | `privacidad.html` §1, `terminos.html` §1, `plan-incidentes.md`, `registro-tratamientos.md` |
| P2 | RUT (ver P1) | Igual |
| P3 | Domicilio en Chile (ver P1) | Igual |
| P4 | ~~País de la región del proyecto de Supabase~~. **Resuelto (19 de octubre):** `us-east-2`, East US (Ohio), Estados Unidos | — |
| P5 | ~~Plan de Supabase~~. **Resuelto (19 de octubre):** plan Free. Según supabase.com/pricing, los registros duran 1 día y no hay copias de seguridad automáticas; la política ya lo dice. Queda confirmar en **Authentication → Audit Logs** si los registros de auditoría también se guardan en la tabla `auth.audit_log_entries` (ver B11) | `privacidad.html` §6 |
| P6 | Aceptar los DPA de Supabase, Cloudflare y Groq, activar Zero Data Retention en Groq y archivarlos | `privacidad.html` §5, registro |
| P7 | Plazo de conservación de los correos de soporte | `privacidad.html` §6, registro |
| P8 | Plazo máximo de los reportes de contenido (por ejemplo, 12 meses) | `privacidad.html` §6 |
| P9 | Plazo de aviso previo de cambios en los términos (por ejemplo, 15 días) | `terminos.html` §14 |
| P10 | Plazo de respuesta a reclamos (por ejemplo, 10 días hábiles) | `terminos.html` §15 |
| P11 | Sitio y canal de reclamos de la Agencia de Protección de Datos Personales cuando esté operativa | `privacidad.html` §9, `plan-incidentes.md` |
| P12 | Contactos del plan de incidentes: persona de respaldo, teléfono y abogado | `plan-incidentes.md` §1 |
| P13 | ~~Confirmar si hubo pagos reales con Webpay u Oneclick~~. **Resuelto (19 de octubre):** no hubo pagos reales; Transbank sólo funcionó en integración, así que la política no lo menciona. Si algún día se activa en producción, hay que declararlo antes | — |
| P14 | Verificación en dos pasos en Gmail, GitHub, Google Play, AdMob, Supabase, Cloudflare y Groq | Registro |

Además quedan los `[PENDIENTE: validar con abogado]` de la sección 6.

### 5.1 Identificación del responsable sin publicar datos personales

La Ley 21.719 exige informar quién es el responsable de los datos, y la ley del consumidor exige identificar al proveedor en las ventas a distancia. Dejar esos datos en blanco mantiene abierto el hallazgo A5, y los textos nuevos **no deben publicarse con `[PENDIENTE]`**. La política publicada hoy (9 de octubre) tampoco identifica al responsable. Opciones, para decidir con el abogado (pregunta 9):

1. **Constituir una empresa (por ejemplo, una SpA)** en *Tu Empresa en un Día* (registrodeempresasysociedades.cl). La inscripción es gratuita y en línea con ClaveÚnica, y la empresa obtiene su propio RUT. Después hay que hacer el inicio de actividades en el SII. En los textos se publicarían la razón social, el RUT de la empresa y un domicilio comercial: por ejemplo, una oficina virtual, si el SII la acepta como domicilio (confírmalo con un contador). Es la opción que permite no publicar el nombre ni el RUT personales. Además separa las responsabilidades de la app de tu patrimonio personal.
2. **Seguir como persona natural** y publicar el nombre, el RUT y un domicilio. Preguntar al abogado si basta un domicilio comercial o una casilla en vez del domicilio particular.
3. **Publicar sólo la marca y el correo**, entregando la identidad cuando alguien la pida. No parece cumplir la exigencia de identificar al responsable: no se recomienda sin la opinión del abogado.

Revisa también qué datos tuyos muestra hoy Google Play en la ficha y en la página de desarrollador (Play Console → **Configuración → Detalles de la cuenta de desarrollador**): las apps con compras pueden mostrar información de contacto del vendedor.

## 6. Preguntas para el abogado

1. **Incidente NVIDIA (C1)**: entre el 14 y el 19 de octubre se enviaron a NVIDIA, bajo términos de prueba, mensajes del chat con el nombre del perfil y textos de planes, mientras la política publicada decía que no se usaban servicios de terceros. ¿Hay que avisar a las personas afectadas o a alguna autoridad, según la Ley 19.628 vigente? ¿Conviene pedir a NVIDIA que borre esos datos? ¿Cómo documentarlo?
2. **Anuncios en Chile (A6)**: ¿basta el interés legítimo para que el SDK de AdMob trate el ID de publicidad y muestre anuncios personalizados a usuarios en Chile, o hay que pedir consentimiento previo antes y después del 1 de diciembre de 2026? ¿O conviene mostrar sólo anuncios no personalizados?
3. **Retracto (art. 3 bis, Ley 19.496)**: ¿aplica a suscripciones y a paquetes de créditos que se entregan y se pueden usar de inmediato? ¿Se puede excluir para el contenido digital ya entregado, informándolo antes de la compra, y cómo debe destacarse? ¿El plazo de 10 días se cuenta desde la compra? ¿Es válido descontar los créditos ya usados?
4. **Cierre de cuentas por incumplimiento grave**: ¿qué pasa con el período de suscripción ya pagado y los créditos comprados? ¿La cláusula de la sección 11 de los términos puede considerarse abusiva (art. 16)?
5. **Datos sensibles**: las personas pueden escribir datos de salud en sus metas o en el chat, y la app revisa automáticamente los mensajes de crisis. ¿Qué base legal corresponde según la Ley 21.719 (consentimiento expreso, interés vital u otra)? ¿Hay que pedir un consentimiento específico?
6. **Transferencias internacionales**: con Supabase, Cloudflare, Groq y GitHub en EE. UU., ¿basta con «necesaria para ejecutar el contrato» más los DPA de cada proveedor, o se necesitan cláusulas contractuales tipo u otro mecanismo de la Ley 21.719?
7. **Conservación tras eliminar la cuenta**: ¿hay que conservar la prueba de aceptación de los términos, los registros de compras o los reportes de contenido después de que la persona elimina su cuenta (prueba ante reclamos, obligaciones tributarias)? Hoy todo se borra en cascada.
8. **Plazos de la Ley 21.719**: confirmar los 30 días corridos prorrogables para responder solicitudes, el plazo del bloqueo temporal y la fecha de vigencia, ya que hay un proyecto de aplazamiento (boletín 18.623-07).
9. **Identificación del responsable**: el dueño no tiene empresa y no quiere publicar su nombre ni su RUT personal. ¿Qué datos exigen exactamente la Ley 21.719 (información al titular) y la Ley 19.496 y su reglamento de comercio electrónico (identificación del proveedor)? Si es persona natural, ¿basta un domicilio comercial o una casilla? ¿Conviene constituir una SpA antes de publicar los textos y de seguir cobrando en Google Play? Ver opciones en la sección 5.1.
10. **Distribución fuera de Chile**: ¿conviene limitar la app a Chile en Play Console hasta revisar el RGPD y las leyes de EE. UU.?
11. **Revisión general**: revisar `public/privacidad.html` y `public/terminos.html` completos, sobre todo la limitación de responsabilidad (sección 13), los cambios a los términos (sección 14) y la jurisdicción (sección 15).

## 7. Pasos manuales, en orden

Ninguno se hizo. Cada uno necesita tu aprobación.

1. **Completar los pendientes** P1 a P14 y revisar los textos con el abogado. Después, actualizar `LEGAL_VERSION` en `src/legal.js` y la fecha de las páginas si los textos cambian antes de publicarse.
2. **NVIDIA y Groq** (ver `docs/respaldo-nube.md`):
   - Revocar la clave de NVIDIA en build.nvidia.com y ejecutar `npx.cmd supabase secrets unset NVIDIA_API_KEY`.
   - En Groq: aceptar el DPA, activar Zero Data Retention y, si es posible, pasar al plan Developer. Después `npx.cmd supabase secrets set GROQ_API_KEY=...`. La clave que se pegó en un chat debe rotarse.
   - No poner `enabled=true` hasta que la política nueva esté publicada.
3. **Migración** `supabase/migrations/202610180001_legal_reports.sql` en el Supabase real: `npx.cmd supabase db push`. Revisa antes la lista que muestra el comando.
4. **Auth en el panel de Supabase** (o `npx.cmd supabase config push`, que reemplaza la configuración remota completa):
   - Contraseña de al menos 10 caracteres con letras y números.
   - Protección contra contraseñas filtradas, si el plan la incluye.
   - Rotación de refresh tokens.
   - Límites de correos y de inicios de sesión.
   - Confirmación doble al cambiar el correo.
   - Redirecciones sólo a `https://planifia.cl/` y `https://www.planifia.cl/`, con y sin `#reset`.
5. **Secreto `RATE_LIMIT_SALT`**:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   npx.cmd supabase secrets set RATE_LIMIT_SALT=...
   ```
6. **JWT de Pub/Sub para `play-rtdn`**:
   - En Google Cloud, edita la suscripción push y activa la autenticación con una cuenta de servicio.
   - Usa como audiencia la URL de la función.
   - Configura `PLAY_RTDN_AUDIENCE` y `PLAY_RTDN_SERVICE_ACCOUNT` con `secrets set`.
   - Prueba con **Enviar notificación de prueba** en Play Console.
7. **Desplegar funciones**, después de la migración (dependen de `rate_limit_take`): `npx.cmd supabase functions deploy goal-plan lumi-chat ai-fallback play-billing play-rtdn billing-return`.
8. **Publicar la web** con un merge a `main`, después de los pasos 1, 3 y 7. Hay que resolver el conflicto de fechas con el PR de `feature/respaldo-groq`. La CSP se genera con `VITE_SUPABASE_URL` de las variables del repositorio.
9. **Revisión de seguridad en Supabase**: ejecuta **Advisors → Security Advisor** y **Performance Advisor** y corrige lo que aparezca (por ejemplo, la política de `ai_jobs`, B3).
10. **Android**:
    - Subir `versionCode` y compilar el AAB (`scripts/android-aab.ps1`).
    - Probar en un teléfono el registro, la casilla, los enlaces externos, el resumen de compra, el reporte y la crisis.
    - Confirmar Play App Signing.
    - Mover el keystore fuera del repositorio con una copia cifrada.
11. **Play Console**:
    - Actualizar **Seguridad de los datos** con la tabla de `docs/google-play.md`, sección 6.
    - Público objetivo 18+.
    - Responder sobre funciones de IA generativa.
    - **Países**: sólo Chile, según la decisión de la pregunta 10.
12. **GitHub**:
    - Activar **secret scanning** y **push protection** en Settings → Code security.
    - Revisar la primera ejecución de CodeQL y gitleaks.
    - Proteger `main` para exigir que pasen las pruebas.
13. **Cloudflare delante de planifia.cl** (B2), con cabeceras HSTS, `nosniff` y `frame-ancestors 'none'`. Opcional.
14. **CAPTCHA** (R1): hoy no se debe activar en Supabase porque bloquearía el ingreso.

## 8. Recomendaciones no implementadas

- **R1. CAPTCHA con Cloudflare Turnstile** en registro, inicio de sesión y recuperación:
  - Cargar el widget sólo en esos formularios.
  - Enviar `captchaToken` en `signUp`, `signInWithPassword` y `resetPasswordForEmail`.
  - Agregar `challenges.cloudflare.com` a `script-src` y `frame-src`, en la CSP de la web (`scripts/web-csp.js`) y en la de Tauri.
  - Probar en Android.
  - Recién entonces activar `[auth.captcha]`.
- **R2. Purga automática** de solicitudes de IA terminadas y de `private.commands` antigua (M7).
- **R3. Play Integrity API** para las compras y los anuncios recompensados.
  - Hoy las compras se verifican con la API de Google Play y los anuncios con la firma de AdMob, así que el riesgo residual es bajo.
  - Integrity agregaría la verificación del dispositivo y de la app contra emuladores y APK modificados.
  - Requiere cambios nativos y una cuenta de Google Cloud.
- **R4. Exigir la aceptación vigente en el servidor** (`goal-plan`, `lumi-chat`, `play-billing`), además de en la app.
  - Se dejó sólo en la app para no bloquear las versiones antiguas de Android mientras se actualizan.
  - Conviene activarlo cuando la versión mínima soportada incluya la pantalla de nueva aceptación.
- **R5. Revisar anualmente** los números de `CRISIS_LINES` y la lista de expresiones de crisis, con los reportes como fuente.
