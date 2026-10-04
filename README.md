# PlanifIA Seller

**Tus metas, un plan claro y un paso a la vez.** Planificador para metas personales, profesionales, aprendizaje, bienestar, creatividad y proyectos. La interfaz es estática y se publica en GitHub Pages; Supabase almacena las cuentas y datos, y una Edge Function llama al proveedor de IA.

## Repositorio y estado

Este proyecto corresponde exclusivamente a `misterdarkno2-wq/PlanifIA_Seller`. Se inició desde su rama `main`, cuyo contenido era la licencia. La implementación se desarrolla en `codex/metas-supabase` y está integrada en `main`. La web se publica en [planifia.cl](https://planifia.cl/) mediante GitHub Pages. La dirección anterior era [GitHub Pages Seller](https://misterdarkno2-wq.github.io/PlanifIA_Seller/); Pages la redirige al dominio personalizado. Se reutilizan el logo, el símbolo y la ilustración original de Lumi de PlanifIA.

En esta instalación, Supabase está conectado al proyecto `hlnzxgpdxgadbdcqavcd`, las tres migraciones están aplicadas y `goal-plan` está desplegada. La configuración privada está en archivos excluidos de Git. El envío de correo para personas fuera del equipo requiere configurar SMTP; la confirmación de correo permanece habilitada. En otras instalaciones, la aplicación indica si falta configuración. Las pruebas con fixtures y las pruebas contra servicios reales se documentan por separado.

## Ejecutar en Windows

Necesitas Node.js 22.12 o posterior.

En este PC, la configuración ya está guardada. Para iniciar los servicios y abrir la interfaz local:

```powershell
cd C:\Users\Admin\Downloads\PlanifIA_Seller
powershell -ExecutionPolicy RemoteSigned -File .\scripts\start-services.ps1 -LocalWeb
```

Abre `http://127.0.0.1:5173/`. No necesitas `supabase init`, `supabase start` ni Docker para usar el proyecto en la nube.

### Instalar en otro PC

```powershell
cd C:\Users\Admin\Downloads\PlanifIA_Seller
npm.cmd ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
notepad .env.local
npm.cmd run dev
```

Abre la dirección que indica Vite, normalmente `http://127.0.0.1:5173`. Completa únicamente estas variables públicas en `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA
```

Usa la clave **publishable** (`sb_publishable_…`) o la clave legacy **anon**. Una clave administrativa, `service_role`, `sb_secret_…` o una clave del proveedor de IA nunca debe llevar el prefijo `VITE_`. Reinicia Vite si cambias `.env.local`.

## Preparar Supabase

1. Crea un proyecto en Supabase y copia su URL y clave pública a `.env.local`.
2. En **Authentication → URL Configuration**, configura Site URL como `https://planifia.cl/`. Autoriza los retornos exactos `https://planifia.cl/`, `https://planifia.cl/#reset`, `https://www.planifia.cl/`, `https://www.planifia.cl/#reset` y las direcciones locales de `supabase/config.toml`. Se conservan también los retornos de la URL anterior de GitHub Pages para enlaces existentes. El archivo documenta la configuración; comprueba que coincida con los ajustes del proyecto en la nube.
3. Mantén la confirmación de correo habilitada y configura el envío de correo de producción según las indicaciones de Supabase. La interfaz indica cuándo falta confirmar una cuenta.
4. Ejecuta las migraciones y despliega la función:

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref TU_PROJECT_REF
npx.cmd supabase db push
Copy-Item supabase\functions\.env.example supabase\functions\.env.local
notepad supabase\functions\.env.local
npx.cmd supabase secrets set --env-file supabase/functions/.env.local
npx.cmd supabase functions deploy goal-plan
```

Revisa `db push` antes de confirmar si utilizas un proyecto con tablas previas. Las migraciones crean tablas nuevas de esta aplicación y no importan ni borran la base MySQL del PlanifIA anterior. Se recomienda un proyecto de Supabase dedicado.

## IA en la nube

Completa en el archivo privado `supabase/functions/.env.local`:

```dotenv
AI_BASE_URL=https://ia-seller.planifia.cl/v1
AI_API_KEY=SECRETO_DEL_ADAPTADOR
AI_MODEL=hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S
AI_DAILY_LIMIT=8
ALLOWED_ORIGINS=https://planifia.cl,https://www.planifia.cl,https://misterdarkno2-wq.github.io,http://127.0.0.1:5173,http://localhost:5173
```

`AI_MODEL` debe admitir `response_format: json_schema` en su endpoint. La integración utiliza `/chat/completions`, JSON estructurado y validación adicional. Puedes usar otro proveedor con esa API y HTTPS. El consumo puede tener coste; el límite cuenta intentos, incluidos los que falla el proveedor, por usuario y día UTC. El límite se aplica de forma atómica en PostgreSQL.

Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` al entorno de funciones. La clave administrativa se usa únicamente para reservar la cuota del usuario cuya sesión se ha validado. Las lecturas del calendario usan su JWT y respetan RLS.

La función valida el JWT con `auth.getUser()` antes de consultar datos o llamar a la IA. `verify_jwt=false` en `config.toml` permite que esta comprobación soporte las claves actuales de Supabase; **no elimina la comprobación de sesión en el código**. Los orígenes permitidos deben ser orígenes completos, sin rutas. Si falta una credencial, la función devuelve exactamente qué secreto falta.

### Ollama conectado en este PC

La función llama a `https://ia-seller.planifia.cl/v1`, servido por un túnel separado `planifia-seller-ia`. El adaptador `scripts/ollama-gateway.js` exige un secreto Bearer, escucha solamente en `127.0.0.1:8012` y admite únicamente la generación de propuestas. Ollama sigue en `127.0.0.1:11434`; sus rutas de modelos no se publican.

El modelo instalado es `hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S`. El adaptador desactiva el pensamiento extendido para esta tarea, limita contexto/salida y permite una generación simultánea. Si está ocupado devuelve un error que permite reintentar. Los secretos de `.env.gateway.local` y `supabase/functions/.env.local` no entran en Git ni en la web.

La función valida cada propuesta y, si excede la disponibilidad, solicita una corrección una vez. Los dos intentos comparten un máximo de 125 segundos; no se guarda nada hasta la aprobación del usuario. Una solicitud de la aplicación consume una cuota diaria, aunque haga esa corrección.

Después de encender este PC:

```powershell
cd C:\Users\Admin\Downloads\PlanifIA_Seller
powershell -ExecutionPolicy RemoteSigned -File .\scripts\start-services.ps1
```

El script inicia Ollama, adaptador y túnel en segundo plano y reutiliza los procesos correctos si ya están abiertos. Para abrir también la interfaz local, añade `-LocalWeb`; la web queda en `http://127.0.0.1:5173/`. Los registros se guardan en archivos `.log` de la carpeta.

GitHub Pages y los datos de Supabase permanecen disponibles con el PC apagado. La generación con este Ollama requiere que el PC esté encendido y esos servicios estén activos. En otro PC debes configurar `.env.gateway.local` y sus credenciales de túnel; el script indica los archivos faltantes y no los descarga del repositorio.

Puedes sustituir el adaptador por un proveedor de IA compatible con HTTPS, `/chat/completions` y JSON Schema, configurando únicamente los secretos de la función. Por ejemplo, `AI_BASE_URL=https://openrouter.ai/api/v1` con su clave y un modelo compatible.

### Correo de registro y recuperación

El SMTP predeterminado de Supabase sólo envía a las direcciones del equipo. Para aceptar registros de otras personas necesitas SMTP propio; consulta [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp). Para Resend, verifica un dominio de envío y configura el proyecto según [la guía de Resend](https://resend.com/docs/send-with-supabase-smtp). Conserva la clave SMTP fuera de Git y mantén la confirmación de correo habilitada.

## Publicar en GitHub Pages

1. En este repositorio, crea las variables de Actions `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`, ambas públicas.
2. En **Settings → Pages → Source**, selecciona **GitHub Actions**. Configura **Custom domain** como `planifia.cl` y habilita **Enforce HTTPS** cuando esté listo el certificado.
3. Integra la rama de implementación en `main` cuando hayas revisado los cambios y configurado Supabase. El workflow publica únicamente `dist`.
4. Abre `https://planifia.cl/`.

La navegación utiliza fragmentos (`#today`, `#goals`, etc.), por lo que recargar una vista funciona en alojamiento estático. El workflow compila con `VITE_BASE_PATH=/` y Vite copia `public/CNAME` al artefacto. El dominio principal sirve esta aplicación Seller; `api.planifia.cl` conserva el backend anterior para exportar datos, y `ia-seller.planifia.cl` sirve el adaptador de IA. Los retornos de Auth y `ALLOWED_ORIGINS` deben incluir el dominio principal en Supabase.

```powershell
npm.cmd run build
npm.cmd run preview
```

## Metas, planes y progreso

- Estructura: **meta → hitos → acciones**. Las acciones pueden ser independientes. Las metas se editan, pausan, retoman, alcanzan y archivan. Puedes crear hitos manuales y vincularles acciones.
- La barra cuenta acciones completadas sobre las acciones vigentes de la meta. Las retiradas no forman parte del porcentaje. Alcanzar el resultado requiere una confirmación del usuario.
- La IA entrega propuestas de hasta cuatro semanas, ocho hitos y cuarenta acciones, con una primera acción y límites de tiempo. Puedes editar títulos, fechas, prioridades y duraciones o retirar acciones antes de confirmar.
- Un ajuste aprobado conserva el historial y las acciones completadas; reemplaza las pendientes marcándolas como retiradas. La versión de la meta impide sobrescribir cambios realizados desde otro dispositivo mientras se revisaba la propuesta.
- Los hábitos registran un cumplimiento por fecha y hábito. Sus registros se pueden reabrir sin perder el historial.

## Lumi y seguridad de XP

Lumi aparece destacada al inicio de **Hoy**, antes de las metas y acciones. Respira y parpadea mientras intercala por iniciativa propia miradas, pasos, pequeños saltos, estiramientos, giros y alguna voltereta. Los clics, el tacto y el cursor no activan animaciones. Cada acción termina antes de empezar otra; completar acciones, subir de nivel o evolucionar da prioridad a una celebración.

Los intervalos (8–20 segundos), pesos, duraciones, desplazamiento máximo y descanso entre volteretas se configuran en `src/pet-behavior.js`, en `LUMI_BEHAVIOR`. La posición se conserva entre movimientos y al actualizar el panel. El personaje permanece dentro de su retrato en móvil y escritorio. Al ocultar la pestaña se pausa; al salir de la vista se limpian sus temporizadores y animaciones.

Lumi está **animada por defecto**, también durante la espera de IA, sin pedir confirmación ni mostrar un selector en Hoy. En **Ajustes → Animaciones de Lumi** puedes elegir opcionalmente **Tranquilas** para detener sus animaciones o **Según dispositivo** para respetar reducir movimiento; **Animadas** recupera el comportamiento habitual. La elección se guarda en este navegador para la dirección que estés usando: localhost y `planifia.cl` tienen preferencias independientes. El resto de la interfaz sigue respetando la configuración del dispositivo. Cambiar la opción no reinicia formularios ni solicitudes de IA.

Al pedir un plan de IA aparece una pantalla de espera con Lumi, un indicador sin porcentaje y el tiempo transcurrido. Si falla, se recuperan los datos del formulario para reintentar. Cerrar la ventana descarta la respuesta pendiente y evita que vuelva a abrirse por una respuesta tardía.

Las reglas están centralizadas en `private.game_rules`: 10/20/35 XP por prioridad, 5 extra solo antes de una fecha límite real. Sin fecha o en el vencimiento/después: XP base. La curva empieza con 100 XP y suma 35 al coste de cada nivel siguiente. Hay 20 niveles y evoluciones en 1, 5, 10, 15 y 20.

`set_task_status` y `set_habit_completion` bloquean primero la mascota de la cuenta, cambian el estado y actualizan recompensas y eventos dentro de una transacción. Una recompensa conserva su primer importe aunque se cambien prioridad o fecha después. Reabrir resta ese importe exacto; completar nuevamente restaura la misma recompensa. El identificador de solicitud evita que un reintento antiguo vuelva a aplicar un cambio ya deshecho.

Todas las tablas públicas tienen RLS de lectura por `auth.uid()`. Las escrituras se realizan por funciones limitadas y no hay permisos de escritura directa para el navegador, incluida la XP. Las relaciones compuestas verifican que meta, hito, tarea y recompensa pertenezcan al mismo usuario. Consulta [seguridad y datos](docs/arquitectura.md).

## Importar datos anteriores

El PlanifIA anterior usa MySQL remoto a través de FastAPI; el navegador conserva la sesión, no una copia completa de tareas. No se modifica esa base ni se migran sus contraseñas. Crea y confirma primero tu cuenta nueva.

Con el servidor anterior encendido puedes exportar **tu cuenta**:

```powershell
py scripts/export_legacy.py --url https://api.planifia.cl --output exports/planifia-anterior.json
```

El script pide correo y contraseña sin escribirla en el archivo, conserva tareas, evaluaciones, disponibilidad, planes guardados y mascota. Usa solo la biblioteca estándar de Python. Verifica el archivo antes de continuar.

En la app nueva, abre **Ajustes → Seleccionar exportación**, revisa las actividades y confirma el correo de destino. La importación mantiene las actividades académicas como área de aprendizaje y conserva las fechas, estados y tiempos; también guarda el JSON original completo en una tabla privada por usuario. Una importación repetida identifica los registros por origen e ID y no los duplica. Las versiones distintas del original se conservan. Los datos históricos de planes y Lumi quedan en ese respaldo descargable; no se reinterpretan automáticamente ni se otorga XP retrospectiva desde datos manipulables del navegador.

La búsqueda de datos locales revisa únicamente `planifia-tareas`, `planifia-tasks` y `planifia-evaluaciones` del dominio actual. El navegador no permite leer el almacenamiento del dominio anterior; utiliza la exportación si está allí. Se conserva el archivo o almacenamiento de origen después de importar.

## Verificación

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run test:edge
npx.cmd --yes deno check --no-config --no-lock --node-modules-dir=none supabase/functions/goal-plan/index.ts
npm.cmd run build
```

Los tests de SQL ejecutan las migraciones en PostgreSQL embebido mediante PGlite: RLS entre dos usuarios, rechazo de escritura de XP, recompensas base/anticipadas/tardías, revocación, idempotencia, hábitos, conflictos de versión, rollback de planes e importación. Las pruebas de Edge Functions comprueban JWT ausente/vencido, origen, secretos, cuota y corrección de propuestas sin ampliar el tiempo máximo, con Auth/proveedor sintéticos. Las del adaptador comprueban autenticación, límites, concurrencia, modelo fijo y timeout. Los tests de dominio cubren los veinte niveles y los límites del plan. Los tests de interfaz usan fixtures de Auth/IA y generan capturas de escritorio y móvil en `dist/qa`; requieren Microsoft Edge instalado.

Después de conectar un proyecto real, completa las comprobaciones en [la lista de aceptación](docs/verificacion.md). La conexión real a Supabase, correos, IA externa y dominio publicado requiere tus cuentas y no queda validada solo con los tests locales.

## Prueba real bajo autorización explícita

`tests/live.mjs` no usa fixtures: crea dos cuentas temporales en el proyecto configurado, comprueba RLS, XP, hábitos, generación/aprobación real con Ollama e inicio/cierre de sesión en escritorio y móvil; elimina exclusivamente esas cuentas al terminar. Necesita la CLI autorizada y Microsoft Edge. Las claves administrativas se leen en memoria y no se guardan en el archivo ni en las capturas.

```powershell
$env:PLANIFIA_RUN_LIVE="1"
npm.cmd run test:live
Remove-Item Env:PLANIFIA_RUN_LIVE
```

Para comprobar el sitio publicado, establece antes `PLANIFIA_LIVE_WEB_URL=https://planifia.cl/`. Este test no verifica entrega de emails: sus cuentas de validación se confirman por la API administrativa.
