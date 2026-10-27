# PlanifIA Seller

Versión **2.3.6** · Android `versionCode=20306`.

**Tus metas, un plan claro y un paso a la vez.** Aplicación de metas, acciones, hábitos y progreso con Lumi. Comparte la misma interfaz entre web, escritorio y Android. Supabase guarda cuentas y datos; Ollama procesa la IA local y Groq es el respaldo opcional en la nube.

## Empezar en cinco minutos

Requisitos: **Node.js 22.18 o posterior** (24 recomendado) y npm. Ejecuta los comandos desde esta carpeta. En Windows puedes usar `npm.cmd` si PowerShell bloquea `npm.ps1`.

```powershell
npm.cmd ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
notepad .env.local
npm.cmd run dev
```

Completa `.env.local` con la URL de tu proyecto Supabase y su clave **publishable** o legacy **anon**. Abre la dirección de Vite, normalmente [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Reinicia Vite después de cambiar variables.

```dotenv
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA
VITE_BASE_PATH=./
```

Sin Supabase configurado la app indica lo que falta; no simula cuentas, datos ni IA. Para usar un proyecto remoto existente no necesitas Docker ni iniciar Supabase localmente.

Para compilar y revisar el resultado publicable:

```powershell
npm.cmd run build
npm.cmd run preview
```

`preview` abre normalmente el puerto 4173. Para probar IA con ese origen, añádelo a `ALLOWED_ORIGINS` en Supabase; para la demostración usa `dev` en 5173, que ya figura en el ejemplo.

## Configuración: qué va en cada lugar

| Archivo o servicio | Variables | Uso |
| --- | --- | --- |
| `.env.local` desde `.env.example` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; opcional `VITE_BASE_PATH` | Únicos valores que llegan al navegador. |
| `.env.gateway.local` desde `.env.gateway.example` | `GATEWAY_SECRET`, `OLLAMA_MODEL`, `OLLAMA_CHAT_MODEL`, `QUEUE_SUPABASE_URL`, `QUEUE_SERVICE_ROLE_KEY` | Trabajador privado de planes y chat local. |
| Secretos de Supabase; plantilla `supabase/functions/.env.example` | `ALLOWED_ORIGINS`, `AI_BASE_URL`, `AI_API_KEY` | Orígenes permitidos y conexión HTTPS al gateway. `AI_API_KEY` debe coincidir con `GATEWAY_SECRET`. |
| Secretos de Supabase | `GROQ_API_KEY`; opcionales `GROQ_MODEL`, `GROQ_CHAT_MODEL`, `GROQ_PLAN_FORMAT` | Respaldo Groq. Modelo predeterminado `openai/gpt-oss-20b`, formato `json_schema`. |

Nunca uses `VITE_` para claves de Groq, `service_role`, `sb_secret_…`, pagos ni contraseñas. Los archivos `.env*.local`, certificados, registros y exportaciones están excluidos de Git. El control de compilación rechaza secretos reconocibles en variables públicas. Las credenciales internas `SUPABASE_*` de las Edge Functions las proporciona Supabase.

`AI_MODEL` y `AI_DAILY_LIMIT` ya no se leen en las funciones: el modelo local lo decide el gateway y los límites se guardan en la base de datos. Las variables de pagos y anuncios sólo se necesitan para esas funciones; consulta [monetización](docs/monetizacion.md) y [pagos](docs/billing.md).

## Preparar un proyecto Supabase nuevo

1. Crea el proyecto, copia su URL/clave pública y configura los retornos exactos de Auth para tu web y `http://127.0.0.1:5173/` (incluido `#reset`). `supabase/config.toml` documenta los retornos de esta instalación.
2. Mantén la confirmación de correo. El SMTP predeterminado envía sólo 2 correos por hora; configura SMTP propio para registros y recuperación. «Continuar con Google» (web y Android) evita el correo de confirmación: pasos en [login con Google](docs/login-google.md).
3. Revisa las migraciones antes de aplicarlas, especialmente si el proyecto contiene datos ajenos. El proyecto original usa tablas nuevas y no modifica el MySQL anterior.
4. Configura los secretos desde la plantilla privada y despliega las tres funciones de IA:

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref TU_PROJECT_REF
npx.cmd supabase db push
if (-not (Test-Path supabase/functions/.env.local)) {
  Copy-Item supabase/functions/.env.example supabase/functions/.env.local
}
notepad supabase/functions/.env.local
npx.cmd supabase secrets set --env-file supabase/functions/.env.local
npx.cmd supabase functions deploy goal-plan
npx.cmd supabase functions deploy lumi-chat
npx.cmd supabase functions deploy ai-fallback
```

Los comandos anteriores cambian el proyecto remoto indicado. No son necesarios para instalar el frontend de un proyecto ya desplegado. Las funciones de compras/anuncios se documentan por separado en [Google Play](docs/google-play.md).

## IA local y Groq

Los planes pasan por `goal-plan` → cola persistente en PostgreSQL → trabajador del PC → Ollama. Las propuestas deben revisarse y aprobarse antes de modificar metas. El chat usa `lumi-chat` y la ruta rápida del gateway. La señal del trabajador permite decidir si recurrir a Groq.

En este PC los modelos instalados son `qwen3.5:9b` (planes) y `qwen3:4b-instruct` (chat). En otra instalación elige modelos disponibles en tu Ollama y adapta `.env.gateway.local`. Para arrancar los servicios configurados y la web en Windows:

```powershell
powershell -ExecutionPolicy RemoteSigned -File .\scripts\start-services.ps1 -LocalWeb
```

El script necesita Ollama, cloudflared y las credenciales locales del túnel; consulta [cola y gateway](docs/lumi-cola-ia.md). El gateway escucha en `127.0.0.1:8012`; Ollama en `127.0.0.1:11434`. Las metas y hábitos manuales no requieren ninguno de esos procesos.

**Estado comprobado el 20 de octubre de 2026:** faltaban `GROQ_API_KEY` y la activación del respaldo. Se guardó la clave en Supabase, se desplegó la corrección de `lumi-chat` y se activó el respaldo del **chat** con autorización del responsable. La API real de Groq y el manejador de Lumi con caída local simulada respondieron correctamente; se verificó cobro único, historial y rechazo de duplicados. El endpoint de producción también respondió con IA local.

Se mantienen 10 mensajes por persona/hora y 100 diarios para toda la app. **Los planes de Groq siguen desactivados (límites cero) y no se validaron con la API real**; los planes locales sí se generaron y aprobaron en la prueba. Para otra instalación, configura el secreto, el despliegue y `private.ai_fallback_settings`; agregar una clave al frontend o al gateway no lo habilita. Instrucciones: [respaldo en la nube](docs/respaldo-nube.md).

Prueba directa con datos sintéticos, sin imprimir claves ni respuestas:

```powershell
# Requiere GROQ_API_KEY en el entorno o en supabase/functions/.env.local (ignorado).
npm.cmd run check:groq
# Sólo si la cuenta permite el consumo de un plan:
npm.cmd run check:groq -- --plan
```

La prueba directa comprueba la API; no sustituye comprobar el cambio local/nube dentro de la app. Sin clave termina con error explícito.

## Mapa del proyecto

| Ruta | Qué contiene |
| --- | --- |
| `index.html`, `src/main.js` | Entrada y navegación de la interfaz. |
| `src/cloud.js`, `src/domain.js` | Acceso a Supabase y reglas del dominio. |
| `src/i18n.js`, `src/server-messages.js` | Idioma de la interfaz (español o inglés) y traducción de los mensajes del servidor. |
| `src/lumi-*`, `src/pet-*` | Chat, conversación, juegos y animación de Lumi. |
| `src/billing*`, `src/native-*` | Planes comerciales e integración móvil. |
| `public/` | Imágenes, páginas legales y archivos públicos del dominio. |
| `supabase/migrations/` | Esquema, permisos, funciones SQL y evolución de datos. |
| `supabase/functions/` | API del servidor; `_shared/` contiene validación y proveedores de IA. |
| `scripts/` | Gateway, trabajador, arranque, compilación y diagnósticos. |
| `tests/` | Pruebas de dominio, base de datos, funciones e interfaz. |
| `src-tauri/` | Aplicación nativa y plugins Android. `gen/android` contiene personalizaciones necesarias y se conserva en Git. |
| `docs/` | Arquitectura, operación y revisiones técnicas. |
| `artifacts/`, `dist/` | Evidencias locales y compilación, respectivamente; no se versionan. |

Se versionan código, migraciones, pruebas, documentación técnica, ejemplos sin secretos y archivos de bloqueo (`package-lock.json`, `Cargo.lock`). Se excluyen presentaciones, documentos personales, registros, cachés y permisos generados por los `build.rs` de los plugins. Los archivos retirados del seguimiento se conservan localmente. Los `permissions/default.toml` siguen versionados.

## Idiomas

La web y la app están en español y en inglés. La primera vez se elige el idioma del teléfono o del navegador (español si lo pide; inglés para cualquier otro idioma) y el botón **ES/EN** lo cambia al instante: en la portada, en la cabecera de la app (escritorio y tableta) y en **Ajustes → Idioma** (también en el teléfono). La elección queda en el dispositivo (`planifia-lang`).

- Los textos van en pares junto al código que los usa: `tr("Guardar", "Save")`. Las etiquetas que se leen al dibujar (categorías, prioridades, etapas de Lumi) usan getters, así que cambiar de idioma sólo vuelve a dibujar la vista.
- La IA responde en el idioma elegido: la app envía `language: "es" | "en"` a `goal-plan` (queda en la solicitud de la cola) y a `lumi-chat`. Las instrucciones del modelo, local y de respaldo, existen en los dos idiomas (`SYSTEM_EN` en `_shared/plan.js`, `LUMI_SYSTEM_EN` en `lumi-chat/handler.ts`). Lo ya guardado (metas, conversación) no se traduce.
- Los mensajes de error del servidor y de la base de datos siguen en español; `src/server-messages.js` los muestra en inglés. Al agregar un mensaje nuevo en el servidor, agrega también su traducción allí.
- Las páginas legales en inglés (`privacy.html`, `terms.html`, `delete-account.html`) son traducciones de cortesía: rige la versión en español. Al publicar una versión nueva de la política o los términos, actualiza también la traducción (lo comprueba `tests/legal-security.test.js`).

## Verificación

```powershell
npm.cmd test
npm.cmd run test:edge
npm.cmd run check:edge
npm.cmd run test:ui
npm.cmd run test:chat-ui
npm.cmd run test:companion-ui
npm.cmd run test:billing-ui
npm.cmd run test:legal-ui
npm.cmd run test:csp-ui
npm.cmd run test:i18n-ui
npm.cmd run build
```

Las pruebas SQL usan PostgreSQL embebido (PGlite); las de interfaz y proveedor usan respuestas simuladas. En Windows se usa Microsoft Edge; en Linux instala Chromium con `npx playwright install --with-deps chromium`. Deno se obtiene mediante los comandos de npm. Las capturas quedan en `artifacts/qa`, fuera de la carpeta publicada.

Para la prueba real, inicia primero `npm run dev`. Requiere `.env.local` y `.env.gateway.local` apuntando al mismo proyecto y una clave administrativa privada. Crea dos cuentas sintéticas, comprueba aislamiento, metas, XP, hábitos, generación/aprobación local y login/logout en escritorio y móvil; elimina sus propias cuentas al terminar:

```powershell
$env:PLANIFIA_RUN_LIVE="1"
npm.cmd run test:live
Remove-Item Env:PLANIFIA_RUN_LIVE
```

No comprueba entrega de correos ni compras reales. Consulta [resultado de esta revisión](docs/revision-2026-10-20.md) para distinguir lo probado de lo pendiente.

## Presentación y documentación

Recorrido sugerido: iniciar sesión → crear una meta manual → añadir/completar una acción → mostrar hábitos y progreso de Lumi → generar y revisar una propuesta con IA local → chat. Si los servicios de IA no están disponibles, muestra las funciones manuales y explica el estado del respaldo.

- [Arquitectura](docs/arquitectura.md), [verificación operativa](docs/verificacion.md), [continuidad e historia](docs/guia-continuidad-2026-10-09.md).
- [Android](docs/android.md), [login con Google](docs/login-google.md), [Google Play](docs/google-play.md), [monetización](docs/monetizacion.md), [pagos anteriores](docs/billing.md).
- [Evaluación de IA](docs/evaluacion-ia.md), [incidentes](docs/plan-incidentes.md), [registro de tratamientos](docs/registro-tratamientos.md).
- Importación del PlanifIA anterior: `py scripts/export_legacy.py --url https://api.planifia.cl --output exports/planifia-anterior.json`; revisar el archivo y usar **Ajustes → Importar datos**. No importa contraseñas ni borra el origen.

Escritorio: `npm run desktop:dev` / `npm run desktop:build` (requiere Rust y herramientas de compilación). Android: instrucciones en `docs/android.md`.

GitHub Pages publica sólo `dist/` mediante `.github/workflows/pages.yml`. Configura las variables públicas `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en Actions. El dominio de esta instalación es [planifia.cl](https://planifia.cl/); en un fork ajusta `public/CNAME`, las URL legales, Auth y `ALLOWED_ORIGINS`. Publicar el frontend requiere integrar los cambios en `main` y esperar el resultado del workflow. La corrección autorizada del chat ya se desplegó en Supabase.
