# Respaldo de IA en la nube

GPT-6 Luna es el respaldo de Lumi y de los planes cuando la IA local no está disponible.

## Probar con la API de OpenAI

Pega la clave de un proyecto de OpenAI con saldo en `supabase/functions/.env`. Git ignora ese archivo.

```dotenv
OPENAI_API_KEY=
```

Desde la raíz del proyecto, ejecuta `npm.cmd run check:openai -- --plan` para probar un mensaje y un plan con datos de ejemplo. La prueba imprime los tiempos de respuesta.


## Cómo funciona

La conmutación ocurre **en el servidor**, no en el teléfono. La app nunca habla con el gateway: llama a Supabase. Así la clave de OpenAI y el secreto del gateway nunca llegan al APK, y los créditos se cobran y devuelven igual que siempre.

**Señal de "PC encendido".** El trabajador de la cola (dentro de `scripts/ollama-gateway.js`) renueva `last_worker_at` en Supabase cada ~3 s. Sólo lo hace si `GET /health` confirma que Ollama responde en menos de 2,5 s y tiene instalados los dos modelos (`OLLAMA_MODEL` y `OLLAMA_CHAT_MODEL`). El resultado se guarda 5 s. Si la señal tiene más de 45 s (`private.ai_fallback_settings.worker_stale_seconds`), la IA local se considera apagada.

**Chat de Lumi (`lumi-chat`).**
1. Cobra los créditos (sin cambios).
2. Consulta `ai_local_online()`:
   - Si el PC está en línea, llama al gateway por el túnel. Si falla a mitad de camino (error de red, timeout, 5xx, 530 de Cloudflare, 401/403/404 del túnel o respuesta vacía), reintenta **una sola vez** con OpenAI.
   - Si el PC no tiene señal, va directo a OpenAI sin esperar timeouts.
   - Si la IA local responde 429 (ocupada con un plan), no usa la nube: muestra el aviso de siempre y devuelve los créditos.
3. Responde `{ reply, source: "local" | "cloud", credits }`. La app muestra "Respondió: IA local" o "Respondió: IA en la nube (respaldo)".

**Planes (`ai-fallback`).** Los planes siguen entrando a la cola con `goal-plan` (sin cambios).
1. Mientras una solicitud está en cola y `worker_online` es falso, la app llama a `ai-fallback` (como máximo una vez por minuto por solicitud).
2. La función exige la sesión de la persona y vuelve a comprobar que la IA local siga apagada. Luego toma **sólo una solicitud de esa cuenta** (`claim_ai_job_cloud`) sin renovar la señal del PC.
3. Genera la propuesta con OpenAI usando la misma validación, el mismo ajuste de calendario y la misma corrección que la IA local (`generateValidatedPlan`), y la guarda con `finish_ai_job`.
4. Si el PC vuelve, `ai-fallback` responde `local` y no gasta cuota. Una propuesta que esté preparando la nube no ocupa la plaza de la GPU.

**Qué datos recibe OpenAI.** Chat: el nombre del perfil, el nombre y la etapa de Lumi, hasta 3 metas activas con su próxima acción, los últimos 6 mensajes y el mensaje nuevo. Planes: el texto de la solicitud, la meta que se planifica, las acciones completadas y el tiempo disponible, sin nombre ni correo. Nunca: correo, identificador de la cuenta, compras ni datos de anuncios. Así lo declara `public/privacidad.html`; si cambias lo que se envía, actualiza la política.

**Límites de la nube**, además de los créditos, en `private.ai_fallback_settings`:

| Ajuste | Por defecto |
| --- | ---: |
| `chat_per_hour` (por persona) | 30 |
| `plans_per_day` (por persona) | 6 |
| `global_chat_per_day` (toda la app) | 2000 |
| `global_plans_per_day` (toda la app) | 200 |
| `enabled` | `true` (habilita el respaldo para chat y planes) |

Con el límite alcanzado o `enabled = false`, el chat devuelve los créditos y los planes siguen esperando en la cola a la IA local.

## Desplegar

1. Publica los términos y la política de privacidad que identifican a OpenAI como respaldo.
2. En **Edge Functions → Secrets**, guarda `OPENAI_API_KEY`. Para el navegador y Android, usa únicamente las variables públicas que documenta el README.
3. Despliega `lumi-chat` y `ai-fallback` en el proyecto Supabase.

```powershell
supabase functions deploy lumi-chat ai-fallback --project-ref TU_PROJECT_REF --use-api
```

En el proyecto activo, consulta los límites vigentes en `private.ai_fallback_settings`. La configuración usa los mismos límites del respaldo para controlar consumo y la misma cola de planes.


## Prueba manual

En el editor SQL de Supabase puedes ver el estado en cada paso:

```sql
select public.ai_local_online(), (select enabled from private.ai_fallback_settings where id);
select created_at, status, provider, error from public.ai_jobs order by created_at desc limit 5;
```

1. **PC encendido.** En **Hablar con Lumi**, envía un mensaje: debajo de los créditos aparece **● Respondió: IA local** (verde). Crea un plan con IA: la espera dice "La IA local está preparando la propuesta".
2. **Apaga la IA local.** Puedes hacerlo de dos formas:
   - Detener Ollama: `Stop-Process -Name ollama -Force` (cierra también el ícono de la bandeja si lo usas). En `seller-gateway.stderr.log` aparece "Ollama no responde: la cola queda en espera…" y `curl.exe -s http://127.0.0.1:8012/health` devuelve `unavailable`.
   - Apagar el PC completo.
3. **Confirma que pasa a la nube.** Espera unos 45 s y verifica:
   - `ai_local_online()` devuelve `false`.
   - En el chat, un mensaje muestra **● Respondió: IA en la nube (respaldo)** (ámbar) y cobra 5 créditos, como siempre.
   - Crea un plan: primero dice "La IA local está desconectada; la IA en la nube (respaldo) preparará tu propuesta". En pocos segundos pasa a "La IA en la nube (respaldo) está preparando…" y termina con "Preparada con IA en la nube (respaldo)". En SQL: `provider = 'cloud'`, `status = 'completed'`.
   - Variante solo túnel: detén `cloudflared` y deja Ollama encendido. El chat intenta el túnel, recibe el error de Cloudflare y responde la nube. Los planes siguen saliendo de la IA local, porque el trabajador usa `127.0.0.1` y no necesita el túnel.
4. **Vuelve a encender.** Ejecuta `start-services.ps1` (o enciende Ollama). El registro dice "Ollama responde de nuevo…", y en unos 3 s `ai_local_online()` vuelve a `true`. El siguiente mensaje muestra **IA local** y un plan nuevo vuelve a decir "La IA local está preparando".

## Pruebas automáticas

```powershell
npm.cmd test                 # incluye tests/ai-fallback.test.js y tests/ai-fallback-database.test.js
npm.cmd run test:edge        # incluye supabase/functions/ai-fallback/index_test.ts y lumi-chat
npm.cmd run test:chat-ui     # indicador "IA local / IA en la nube (respaldo)"
npm.cmd run check:edge
```

Las pruebas simulan error de red, timeout, 502/503/530 de Cloudflare, respuestas vacías, Ollama colgado o sin modelo, PC sin señal, PC que vuelve, límites, una concesión vencida de la nube y la devolución de créditos. No usan la red ni claves reales.

## Límites y facturación

- OpenAI factura los tokens usados. Si una persona cancela un plan que la nube ya empezó a generar, se descarta la propuesta y los tokens consumidos se cobran.
- Si OpenAI responde HTTP 429, Lumi devuelve los créditos de PlanifIA y el plan sigue el mecanismo de reintentos de la cola.
- Puedes ver los cargos en [Gastos de OpenAI](https://platform.openai.com/settings/organization/analytics/spend) y el saldo prepago en [Facturación](https://platform.openai.com/settings/organization/billing/overview).
