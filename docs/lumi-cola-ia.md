# Lumi y la cola de IA

## Dónde se ejecuta cada parte

- `src/lumi-messages.js`: biblioteca configurable, selección sin repetir las últimas respuestas, sesión y preferencias. No usa la GPU.
- `src/lumi-conversation.js`, `lumi-voice.js`, `lumi-conversation.css`: texto progresivo, ánimo opcional, controles y sílabas originales sintetizadas con osciladores. La conversación no controla caminar, saltar ni piruetas: eso sigue en `pet-behavior.js`.
- `goal-plan`: comprueba JWT, disponibilidad, propiedad de la meta y límites; devuelve HTTP 202 con el trabajo guardado, sin esperar a Ollama.
- `202610050001_ai_queue.sql`: PostgreSQL en Supabase guarda trabajos, resultados, instantánea privada del calendario, cuota, prioridad y concesiones de ejecución.
- `scripts/ai-worker.js`: trabajador en el PC de la GPU, integrado en el proceso del adaptador. Consulta Supabase, renueva la concesión y usa Ollama a través del adaptador privado de loopback. Funciona sin navegador.
- `src/ai-jobs.js`: un monitor compartido por los diálogos y «Mis solicitudes de IA». Recupera los últimos veinte trabajos al iniciar sesión; las propuestas quedan en Supabase, no en el navegador.

## Conversación y privacidad

El sonido está desactivado inicialmente. Se activa en el mensaje o en Ajustes; el navegador puede requerir la primera interacción para habilitar Web Audio. Son seis sílabas suaves sintetizadas, sin grabaciones o assets de terceros. Cada frase detiene los sonidos anteriores. Cerrar el mensaje, cambiar de página, silenciar o esconder la pestaña detiene inmediatamente audio y animación de habla. Las pestañas ocultas no emiten mensajes espontáneos ni audio.

Los lectores de pantalla reciben el mensaje completo una vez. «Mostrar texto completo» y el ajuste equivalente omiten la escritura progresiva; la preferencia del dispositivo de reducir movimiento también la omite y desactiva el movimiento de boca. La preferencia existente de animación autónoma de Lumi se conserva, incluido el modo animado elegido por el usuario.

El saludo se muestra una vez por sesión de pestaña/cuenta; navegar o recargar no reinicia la pregunta. Cerrar sesión la reinicia. Puede desactivarse. El ánimo se guarda únicamente en `sessionStorage`, nunca en Supabase ni en el almacenamiento permanente. `localStorage` conserva preferencias de sonido y frecuencia y la fecha real de visita para ofrecer un regreso sin presión. No se modifican metas al elegir un ánimo.

Los mensajes espontáneos usan intervalos variables: aproximadamente dos minutos o cinco minutos; pueden desactivarse sin perder reacciones al progreso. Completar acciones, hitos y metas, subir de nivel o evolucionar usa mensajes locales.

## Configurar el PC

Node.js **22.18 o posterior** (24 recomendado) permite que el trabajador reutilice directamente el validador TypeScript del servidor. Instala dependencias con `npm.cmd ci`.

Añade en **`.env.gateway.local`**, archivo ignorado por Git:

```dotenv
QUEUE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
QUEUE_SERVICE_ROLE_KEY=CLAVE_ADMINISTRATIVA_PRIVADA
GATEWAY_SECRET=SECRETO_DEL_ADAPTADOR
OLLAMA_MODEL=NOMBRE_EXACTO_DEL_MODELO_INSTALADO
GATEWAY_PORT=8012
GATEWAY_CONCURRENCY=1
GATEWAY_TIMEOUT_MS=120000
OLLAMA_NUM_CTX=8192
```

La clave administrativa se obtiene en los ajustes de API de Supabase y se guarda sólo en el PC del servicio. Nunca usar `VITE_` para ella, incluirla en Git ni copiarla al navegador. Las lecturas y la cancelación de la interfaz usan JWT del usuario.

```powershell
cd C:\Users\Admin\Downloads\PlanifIA_Seller
supabase db push --linked
supabase functions deploy goal-plan
powershell -ExecutionPolicy RemoteSigned -File .\scripts\start-services.ps1 -LocalWeb
```

El comando habitual inicia Ollama, adaptador con trabajador y túnel; `-LocalWeb` es opcional. Los servicios quedan en segundo plano. `seller-gateway.stdout.log` confirma «Cola persistente de Supabase conectada». Si falta una variable de la cola, `seller-gateway.stderr.log` indica su nombre, nunca su valor. Un adaptador que ya estaba abierto con una versión anterior debe reiniciarse una vez para cargar el trabajador nuevo.

La función necesita `ALLOWED_ORIGINS`; Supabase le proporciona sus credenciales internas. `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` y `AI_DAILY_LIMIT` de la integración anterior ya no gobiernan el encolado: modelo/secreto quedan en el adaptador; límite diario en PostgreSQL. El túnel antiguo puede mantenerse para otras instalaciones autorizadas, pero la nueva aplicación procesa sus solicitudes con el trabajador y loopback.

## Prioridad y límites

Se reserva cuota diaria y mensual en la misma transacción que crea el trabajo. Por defecto hay un trabajo activo por usuario y ocho solicitudes diarias, además del límite de su plan. Cancelar o fallar no devuelve esa reserva; un reintento interno nunca la descuenta de nuevo. El identificador de solicitud es único por cuenta; repetirlo con otro contenido se rechaza. El navegador conserva sólo identificadores y hashes de contenido para recuperarse de una conexión interrumpida.

La configuración privada se modifica en el SQL Editor por un administrador:

```sql
select concurrency, priorities, aging_seconds, per_user_limit, daily_limit,
       lease_seconds, timeout_seconds, max_wait_seconds, max_attempts
from private.ai_queue_settings;

update private.ai_queue_settings
set priorities='{"free":0,"plus":10,"pro":20}', aging_seconds=60,
    per_user_limit=1, daily_limit=8, concurrency=1,
    timeout_seconds=125, lease_seconds=180,
    max_attempts=3, max_wait_seconds=86400
where id;
```

La prioridad deriva del plan vigente confirmado en la base, nunca del cuerpo enviado por el navegador. Cada minuto de espera añade un punto: una solicitud Gratis antigua alcanza la prioridad de solicitudes Pro recién llegadas. En igualdad se usa orden de llegada. Por defecto se procesa una solicitud. Para otra GPU, la concurrencia se configura tanto en SQL como en `GATEWAY_CONCURRENCY` (1–4), que inicia ese número de trabajadores y limita físicamente el adaptador. El límite efectivo es el menor de ambos. Conserva los dos en uno en esta GPU de 16 GB para no duplicar el uso de VRAM. Reinicia el adaptador tras cambiar su entorno.

La espera aproximada usa las últimas veinte duraciones completadas y la carga actual; si faltan datos se muestra «Tiempo variable». Es una estimación que puede cambiar. La interfaz informa si el servicio lleva más de treinta segundos sin señal; la solicitud continúa guardada.

## Concesiones, cancelación y fallos

La reclamación usa un bloqueo transaccional global y `FOR UPDATE SKIP LOCKED`; no permite más trabajos activos que los configurados. Cada reclamación genera un token distinto. Se renueva cada diez segundos; perder la conexión o concesión aborta la petición. Sólo un token todavía vigente puede guardar el resultado. El adaptador mantiene su plaza hasta que la petición a Ollama termina, incluso tras un timeout.

Cancelar un trabajo en cola lo cancela inmediatamente. En procesamiento se marca la petición de interrupción: el trabajador aborta el transporte en la siguiente renovación. No se anuncia «Cancelado» hasta que lo confirme; si Ollama tarda en reaccionar no se promete que deje de usar la GPU instantáneamente. Un resultado que llega tras solicitar cancelar no se publica.

Se recuperan concesiones vencidas; los fallos transitorios se reintentan hasta tres veces, con pausas de diez segundos por intento. El máximo incluye generaciones y correcciones del validador. Tras agotarlo o superar el día de espera, queda un error recuperable en la lista. El servicio debe estar encendido para detectar vencimientos y procesar la cola.

RLS y permisos de columnas protegen trabajos y resultados. Las funciones de lectura/cancelación comprueban `auth.uid()`; ni prioridad, ni concesiones ni instantáneas privadas se entregan a otro usuario. Las RPC de encolado y ejecución sólo admiten `service_role`.

## Verificar

```powershell
npm.cmd test
npm.cmd run test:edge
npm.cmd run check:edge
npm.cmd run test:ui
npm.cmd run test:companion-ui
npm.cmd run build
```

Las pruebas automáticas de SQL usan PostgreSQL embebido, no una cola simulada en el navegador. Auth/proveedor y resultados de las pruebas de interfaz son fixtures; comprueban el contrato y la experiencia, sin consumir GPU. El sonido se comprueba con un contexto sintético y con Web Audio en el navegador; su percepción final depende del altavoz del teléfono/PC. Las comprobaciones con Supabase y GPU reales se registran aparte en `docs/verificacion.md`.

Referencias: [RLS y permisos en Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) y [activación de AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume).
