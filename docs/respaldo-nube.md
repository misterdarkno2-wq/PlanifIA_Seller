# Respaldo de IA en la nube (Groq)

Con el PC encendido, la app usa la IA local (Ollama) a través del gateway y del túnel, igual que antes. Si el PC está apagado, el túnel está caído u Ollama no responde, la app pasa sola a la API de Groq (`https://api.groq.com/openai/v1/chat/completions`, compatible con OpenAI). Cuando el PC vuelve, regresa sola a la IA local.

> **Por qué Groq y no NVIDIA.** Del 14 al 19 de octubre de 2026 el respaldo usó la API de prueba de NVIDIA (build.nvidia.com). Sus términos (*NVIDIA API Trial Terms of Service*) sólo permiten pruebas: prohíben el uso en producción y el envío de datos personales, y permiten a NVIDIA usar el contenido para mejorar sus modelos. El 19 de octubre se apagó el respaldo (`enabled = false`) y se cambió a Groq. El secreto `NVIDIA_API_KEY` ya no se usa: bórralo (paso 2 de [Desplegar](#desplegar)).

## Diagnóstico y verificación del 20 de octubre de 2026

La causa comprobada fue de configuración: faltaba **GROQ_API_KEY** en Supabase y el respaldo tenía **enabled=false**. Las funciones ya contenían la integración de Groq; el secreto antiguo de NVIDIA no sustituía la clave nueva.

Durante esta revisión se guardó la clave desde el panel de Supabase y, con autorización del responsable, se activó **sólo el respaldo del chat**: 10 mensajes por persona/hora y 100 diarios en toda la app. Los límites de planes siguen en cero; los planes continúan con Ollama.

La llamada real desde Supabase a Groq respondió HTTP 200 en 578 ms. También pasó una prueba del manejador real de Lumi con una caída local simulada únicamente dentro de una función temporal: respuesta `source=cloud`, saldo de 60 a 55, dos mensajes guardados y repetición rechazada con 409 sin un segundo cobro. No se apagó el gateway de producción. Los resultados están en `artifacts/groq-real-*.json`, ignorados por Git.

El modelo `openai/gpt-oss-20b` sigue disponible según [los modelos de Groq](https://console.groq.com/docs/models) y admite [JSON Schema estricto](https://console.groq.com/docs/structured-outputs). Las mediciones antiguas de NVIDIA no demostraban que la clave o la integración con Groq funcionaran.

Se corrigió el consumo de cuota cuando falta la clave y el rechazo de respuestas de chat truncadas. La función `lumi-chat` se desplegó con esas correcciones. Para repetir una prueba directa desde otro equipo, configura `GROQ_API_KEY` en el entorno o en `supabase/functions/.env.local` (ignorado) y ejecuta:

```powershell
npm.cmd run check:groq
npm.cmd run check:groq -- --plan # opcional; consume una generación y requiere capacidad suficiente
```

La clave guardada en Supabase no se descarga ni se copia al equipo: esta prueba local necesita su propia configuración privada. El comando no imprime claves ni respuestas. Los planes reales con Groq permanecen sin validar y desactivados.

## Cómo funciona

La conmutación ocurre **en el servidor**, no en el teléfono. La app nunca habla con el gateway: llama a Supabase. Así la clave de Groq y el secreto del gateway nunca llegan al APK, y los créditos se cobran y devuelven igual que siempre.

**Señal de "PC encendido".** El trabajador de la cola (dentro de `scripts/ollama-gateway.js`) renueva `last_worker_at` en Supabase cada ~3 s. Sólo lo hace si `GET /health` confirma que Ollama responde en menos de 2,5 s y tiene instalados los dos modelos (`OLLAMA_MODEL` y `OLLAMA_CHAT_MODEL`). El resultado se guarda 5 s. Si la señal tiene más de 45 s (`private.ai_fallback_settings.worker_stale_seconds`), la IA local se considera apagada.

**Chat de Lumi (`lumi-chat`).**
1. Cobra los créditos (sin cambios).
2. Consulta `ai_local_online()`:
   - Si el PC está en línea, llama al gateway por el túnel. Si falla a mitad de camino (error de red, timeout, 5xx, 530 de Cloudflare, 401/403/404 del túnel o respuesta vacía), reintenta **una sola vez** con Groq.
   - Si el PC no tiene señal, va directo a Groq sin esperar timeouts.
   - Si la IA local responde 429 (ocupada con un plan), no usa la nube: muestra el aviso de siempre y devuelve los créditos.
3. Responde `{ reply, source: "local" | "cloud", credits }`. La app muestra "Respondió: IA local" o "Respondió: IA en la nube (respaldo)".

**Planes (`ai-fallback`).** Los planes siguen entrando a la cola con `goal-plan` (sin cambios).
1. Mientras una solicitud está en cola y `worker_online` es falso, la app llama a `ai-fallback` (como máximo una vez por minuto por solicitud).
2. La función exige la sesión de la persona y vuelve a comprobar que la IA local siga apagada. Luego toma **sólo una solicitud de esa cuenta** (`claim_ai_job_cloud`) sin renovar la señal del PC.
3. Genera la propuesta con Groq usando la misma validación, el mismo ajuste de calendario y la misma corrección que la IA local (`generateValidatedPlan`), y la guarda con `finish_ai_job`.
4. Si el PC vuelve, `ai-fallback` responde `local` y no gasta cuota. Una propuesta que esté preparando la nube no ocupa la plaza de la GPU.

**Qué datos recibe Groq.** Chat: el nombre del perfil, el nombre y la etapa de Lumi, hasta 3 metas activas con su próxima acción, los últimos 6 mensajes y el mensaje nuevo. Planes: el texto de la solicitud, la meta que se planifica, las acciones completadas y el tiempo disponible, sin nombre ni correo. Nunca: correo, identificador de la cuenta, compras ni datos de anuncios. Así lo declara `public/privacidad.html`; si cambias lo que se envía, actualiza la política.

**Límites de la nube**, además de los créditos, en `private.ai_fallback_settings`:

| Ajuste | Por defecto |
| --- | ---: |
| `chat_per_hour` (por persona) | 30 |
| `plans_per_day` (por persona) | 6 |
| `global_chat_per_day` (toda la app) | 2000 |
| `global_plans_per_day` (toda la app) | 200 |
| `enabled` | `true` (chat reactivado el 2026-10-20; planes desactivados por sus límites cero) |

Con el límite alcanzado o `enabled = false`, el chat devuelve los créditos y los planes siguen esperando en la cola a la IA local.

**Modelos.**
- Local: el que ya tienes configurado (`qwen3.5:9b` para planes y `qwen3:4b-instruct` para el chat).
- Nube: `GROQ_MODEL`, por defecto `openai/gpt-oss-20b`, probado en Groq para chat el 20 de octubre. Acepta una lista separada por comas: si Groq responde 404 o 410, se usa el siguiente. Con `GROQ_CHAT_MODEL` puedes usar otra lista sólo para el chat.
- Groq anuncia con anticipación los modelos que va a retirar. Cuando retire el que usas, cambia `GROQ_MODEL`: un modelo retirado puede responder con otro código y no pasar solo al siguiente.
- Los prompts de la nube agregan instrucciones de formato: texto plano sin razonamiento para Lumi, y sólo el objeto JSON para los planes.
- Si los planes fallan con "El proveedor de IA rechazó la solicitud" (Groq responde 400 `json_validate_failed` cuando el modelo no logra cumplir el JSON Schema estricto), configura `GROQ_PLAN_FORMAT=json_object`. La validación del servidor se aplica igual.

**Costo estimado** con `openai/gpt-oss-20b` (precio de referencia: USD 0,075 por millón de tokens de entrada y USD 0,30 por millón de salida; revisa la página de precios de Groq). Un mensaje a Lumi usa unos 1.200 tokens de entrada y 400 de salida; un plan, unos 4.000 y 4.000 con su posible corrección.

| Uso del respaldo | Costo al mes |
| --- | ---: |
| 100 mensajes y 10 planes al día | ≈ USD 1 |
| Los límites globales completos todos los días (2.000 mensajes y 200 planes) | ≈ USD 30 |

## Cuenta de Groq

1. Crea la cuenta en [console.groq.com](https://console.groq.com/) con el correo del proyecto. El plan **Developer** (pago por uso) tiene límites más altos. El 19 de octubre de 2026 la consola no permitía cambiarse a ese plan ("temporarily unavailable due to high demand"); mientras tanto se usa el plan **Free** (ver más abajo). El contrato de Groq (*Services Agreement*) no limita el plan gratuito a pruebas. Además permite ofrecer el servicio a los usuarios de tu app (§3.1) y prohíbe a Groq entrenar con las solicitudes y respuestas (§4.2).
2. En **Settings → Data Controls** activa **Zero Data Retention**, para que Groq no guarde las solicitudes ni las respuestas. Si tu plan no lo permite, la política de privacidad no puede decir que Groq no las conserva: corrígela antes de publicarla.
3. Revisa y acepta las condiciones y el acuerdo de tratamiento de datos (DPA) en [console.groq.com/docs/legal](https://console.groq.com/docs/legal). Con el DPA, Groq trata los datos por cuenta de PlanifIA. Así lo dicen la política de privacidad y la sección Seguridad de los datos de Play (`docs/google-play.md`).
4. Crea una clave en **API Keys**. Empieza por `gsk_`.

### Con el plan Free: sólo el chat

Límites publicados del plan Free para `openai/gpt-oss-20b`: 30 solicitudes por minuto, 1.000 por día, 8.000 tokens por minuto y 200.000 tokens por día. Los de tu cuenta están en **Settings → Limits**.

Un plan (unos 4.000 tokens de instrucciones más hasta 6.000 de respuesta) no cabe en 8.000 tokens por minuto. Por eso, con el plan Free, deja que los planes esperen siempre a la IA local y usa la nube sólo para el chat. Un mensaje de Lumi usa unos 2.000 tokens, así que 100 mensajes al día quedan bajo los 200.000 tokens diarios:

```sql
update private.ai_fallback_settings
set plans_per_day = 0, global_plans_per_day = 0, chat_per_hour = 10, global_chat_per_day = 100
where id;
```

Con el límite alcanzado, Lumi devuelve los créditos y los planes muestran "Tu solicitud sigue guardada y se preparará cuando vuelva la IA local". Si Groq responde 429 antes del límite, el chat también devuelve los créditos.

Cuando pases al plan Developer, vuelve a los valores por defecto:

```sql
update private.ai_fallback_settings
set plans_per_day = 6, global_plans_per_day = 200, chat_per_hour = 30, global_chat_per_day = 2000
where id;
```

## Desplegar

Ejecuta estos pasos en PowerShell, desde la carpeta del proyecto. No hay migraciones nuevas: `202610130001_ai_cloud_fallback.sql` ya está aplicada.

1. **Política.** Publica antes la política de privacidad, los términos y la ficha de Seguridad de los datos que nombran a Groq. Si el respaldo se activa antes, la app manda datos a un proveedor que la política no nombra.

2. **Secretos.** En **Edge Functions → Secrets** de Supabase, guarda **GROQ_API_KEY** con la clave creada en Groq. Evita escribirla en comandos que queden en el historial. El secreto anterior `NVIDIA_API_KEY` ya no es utilizado; puedes retirarlo al completar la transición.

   No la pongas en `.env.local`, en variables `VITE_` ni en el repositorio. `npm run build` falla si una variable `VITE_` contiene `GROQ` o un valor `gsk_`.

   Opcional, para otro modelo o formato:

   ```powershell
   npx.cmd supabase secrets set GROQ_MODEL=openai/gpt-oss-20b GROQ_PLAN_FORMAT=json_object
   ```

   En `supabase/functions/.env.example` la clave queda comentada a propósito: así `secrets set --env-file` no la borra con un valor vacío.

3. **Funciones.**

   ```powershell
   npx.cmd supabase functions deploy lumi-chat
   npx.cmd supabase functions deploy ai-fallback
   ```

4. **Encender el respaldo.** Con el plan Free, aplica antes los límites de [sólo el chat](#con-el-plan-free-sólo-el-chat). Luego, en el editor SQL de Supabase:

   ```sql
   update private.ai_fallback_settings set enabled = true where id;
   ```

   Para apagarlo de nuevo, usa `enabled = false`: el chat devuelve los créditos y los planes esperan a la IA local.

5. **Gateway.** No cambia. Si todavía no lo reiniciaste después de agregar `/health`:

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like '*ollama-gateway.js*' | ForEach-Object { Stop-Process -Id $_.ProcessId }
   powershell -ExecutionPolicy RemoteSigned -File .\scripts\start-services.ps1
   curl.exe -s http://127.0.0.1:8012/health
   curl.exe -s https://ia-seller.planifia.cl/health
   ```

   Ambos deben responder `{"status":"ok","ollama":true}`. `/health` es público y no revela modelos ni datos.

6. **App.** El respaldo del chat funciona desde el paso 4 sin actualizar la app. El respaldo de los planes, el indicador y el aviso del chat que nombra a Groq necesitan la nueva versión de la web (integrar en `main`, GitHub Pages) y del APK/AAB.

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

## Limitaciones conocidas

- No hay streaming: la app no lo usaba. Las respuestas llegan completas y la app las "escribe" de a poco, igual con la IA local y con la nube.
- Si cancelas un plan mientras lo prepara la nube, la propuesta se descarta igual que con la IA local, pero los tokens de Groq ya se gastaron.
- Si Groq responde 429 (límite de la cuenta), el chat devuelve los créditos y el plan se reintenta dentro del límite configurado. Si pasa seguido, sube el nivel de la cuenta en Groq.
- El chat con Groq sí pasó una prueba real el 20 de octubre. Los planes en Groq siguen desactivados y no se han validado contra la API real; no los presentes como operativos. Haz la [prueba manual](#prueba-manual) si los habilitas en el futuro.
