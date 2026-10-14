# Respaldo de IA en la nube (NVIDIA NIM)

Con el PC encendido, la app usa la IA local (Ollama) a través del gateway y del túnel, igual que antes. Si el PC está apagado, el túnel está caído u Ollama no responde, la app pasa sola a la API de NVIDIA (`https://integrate.api.nvidia.com/v1/chat/completions`). Cuando el PC vuelve, regresa sola a la IA local.

## Cómo funciona

La conmutación ocurre **en el servidor**, no en el teléfono. La app nunca habla con el gateway: llama a Supabase. Así la clave de NVIDIA y el secreto del gateway nunca llegan al APK, y los créditos se cobran y devuelven igual que siempre.

**Señal de "PC encendido".** El trabajador de la cola (dentro de `scripts/ollama-gateway.js`) renueva `last_worker_at` en Supabase cada ~3 s. Ahora sólo lo hace si `GET /health` confirma que Ollama responde en menos de 2,5 s y tiene instalados los dos modelos (`OLLAMA_MODEL` y `OLLAMA_CHAT_MODEL`). El resultado se guarda 5 s. Si la señal tiene más de 45 s (`private.ai_fallback_settings.worker_stale_seconds`), la IA local se considera apagada.

**Chat de Lumi (`lumi-chat`).**
1. Cobra los créditos (sin cambios).
2. Consulta `ai_local_online()`:
   - Si el PC está en línea, llama al gateway por el túnel. Si falla a mitad de camino (error de red, timeout, 5xx, 530 de Cloudflare, 401/403/404 del túnel o respuesta vacía), reintenta **una sola vez** con NVIDIA.
   - Si el PC no tiene señal, va directo a NVIDIA sin esperar timeouts.
   - Si la IA local responde 429 (ocupada con un plan), no usa la nube: muestra el aviso de siempre y devuelve los créditos.
3. Responde `{ reply, source: "local" | "cloud", credits }`. La app muestra "Respondió: IA local" o "Respondió: IA en la nube (respaldo)".

**Planes (`ai-fallback`).** Los planes siguen entrando a la cola con `goal-plan` (sin cambios).
1. Mientras una solicitud está en cola y `worker_online` es falso, la app llama a `ai-fallback` (como máximo una vez por minuto por solicitud).
2. La función exige la sesión de la persona y vuelve a comprobar que la IA local siga apagada. Luego toma **sólo una solicitud de esa cuenta** (`claim_ai_job_cloud`) sin renovar la señal del PC.
3. Genera la propuesta con NVIDIA usando la misma validación, el mismo ajuste de calendario y la misma corrección que la IA local (`generateValidatedPlan`), y la guarda con `finish_ai_job`.
4. Si el PC vuelve, `ai-fallback` responde `local` y no gasta cuota. Una propuesta que esté preparando la nube no ocupa la plaza de la GPU.

**Límites de la nube**, además de los créditos, en `private.ai_fallback_settings`:

| Ajuste | Por defecto |
| --- | ---: |
| `chat_per_hour` (por persona) | 30 |
| `plans_per_day` (por persona) | 6 |
| `global_chat_per_day` (toda la app) | 2000 |
| `global_plans_per_day` (toda la app) | 200 |
| `enabled` | `true` |

Con el límite alcanzado, el chat devuelve los créditos y los planes siguen esperando en la cola a la IA local.

**Modelos.**
- Local: el que ya tienes configurado (`qwen3.5:9b` para planes y `qwen3:4b-instruct` para el chat).
- Nube: `NVIDIA_MODEL`, una lista separada por comas. Por defecto es `openai/gpt-oss-20b,z-ai/glm-5.3-flash`. Si NVIDIA retira un modelo (responde 404 o 410), se usa el siguiente sin cambiar nada. Con `NVIDIA_CHAT_MODEL` puedes usar otra lista sólo para el chat.
- Prueba del 14 de octubre de 2026 con la clave real:

  | Modelo | Chat en español | JSON Schema |
  | --- | --- | --- |
  | `openai/gpt-oss-20b` | 1,8 s | válido |
  | `nvidia/nemotron-3-super-120b-a12b` | 1,2 s | inválido |
  | `z-ai/glm-5.3-flash` | 59 s | válido |
  | `google/gemma-4-31b-it`, `deepseek-ai/deepseek-v4.1-flash` | más de 60 s | — |
  | `mistralai/mistral-large-2-instruct`, `moonshotai/kimi-k2.6` | 404 | — |

  `meta/llama-3.3-70b-instruct`, el primer valor por defecto, responde 410 desde el 26 de agosto de 2026.
- Los prompts de la nube agregan instrucciones de formato: texto plano sin razonamiento para Lumi, y sólo el objeto JSON para los planes.
- Si el modelo elegido no acepta `response_format` con JSON Schema (la propuesta falla con "El proveedor de IA rechazó la solicitud"), configura `NVIDIA_PLAN_FORMAT=json_object` o `none`. La validación del servidor se aplica igual.

## Desplegar

Ejecuta estos pasos en PowerShell, desde la carpeta del proyecto.

1. **Migración.** Crea la columna `provider`, los límites y las funciones de la nube:

   ```powershell
   npx.cmd supabase db push
   ```

2. **Secreto de NVIDIA.** Crea la clave en [build.nvidia.com](https://build.nvidia.com/) y guárdala sólo en Supabase:

   ```powershell
   npx.cmd supabase secrets set NVIDIA_API_KEY=nvapi-TU_CLAVE
   ```

   No la pongas en `.env.local`, en variables `VITE_` ni en el repositorio. `npm run build` falla si una variable `VITE_` contiene `NVIDIA` o un valor `nvapi-`.

   Opcional, para otro modelo o formato:

   ```powershell
   npx.cmd supabase secrets set NVIDIA_MODEL=openai/gpt-oss-20b,z-ai/glm-5.3-flash NVIDIA_PLAN_FORMAT=json_schema
   ```

   En `supabase/functions/.env.example` la clave queda comentada a propósito: así `secrets set --env-file` no la borra con un valor vacío.

3. **Funciones.**

   ```powershell
   npx.cmd supabase functions deploy lumi-chat
   npx.cmd supabase functions deploy ai-fallback
   ```

4. **Gateway.** Reinícialo en el PC para activar `/health` y la pausa del trabajador cuando Ollama no responde:

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like '*ollama-gateway.js*' | ForEach-Object { Stop-Process -Id $_.ProcessId }
   powershell -ExecutionPolicy RemoteSigned -File .\scripts\start-services.ps1
   curl.exe -s http://127.0.0.1:8012/health
   curl.exe -s https://ia-seller.planifia.cl/health
   ```

   Ambos deben responder `{"status":"ok","ollama":true}`. `/health` es público y no revela modelos ni datos.

5. **App.** El respaldo del chat funciona desde el paso 3 sin actualizar la app. El respaldo de los planes y el indicador necesitan la nueva versión de la web (integrar en `main`, GitHub Pages) y del APK/AAB.

## Prueba manual

En el editor SQL de Supabase puedes ver el estado en cada paso:

```sql
select public.ai_local_online();
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
- Si cancelas un plan mientras lo prepara la nube, la propuesta se descarta igual que con la IA local, pero los tokens de NVIDIA ya se gastaron.
- NVIDIA retira modelos sin aviso en la API: la lista pública de `/v1/models` todavía incluye algunos que ya no responden. Para elegir otro, prueba primero con una petición real.
- No todos los modelos aceptan `response_format: json_schema` (Nemotron Super devolvió JSON inválido). Si cambias de modelo y los planes fallan con "rechazó la solicitud", usa `NVIDIA_PLAN_FORMAT=json_object`.
