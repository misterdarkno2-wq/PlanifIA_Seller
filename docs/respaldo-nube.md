# Respaldo de IA con Gemini

Ollama atiende el chat de Lumi y los planes cuando el PC está disponible. Si el chat pierde el acceso al gateway o el trabajador de planes deja de enviar su señal, las Edge Functions pueden recurrir a Gemini. Cada respuesta o propuesta indica si la preparó la IA local o la de respaldo.

## Configurar la clave

1. Crea una clave en [Google AI Studio](https://aistudio.google.com/apikey).
2. Abre `supabase/functions/.env` y pega la clave después de `GEMINI_API_KEY=`. Git ignora este archivo. En un checkout nuevo puedes crearlo con esta línea.

   ```dotenv
   GEMINI_API_KEY=
   ```

3. Desde la raíz del proyecto, prueba el chat con datos sintéticos. Agrega `--plan` para comprobar además la generación y validación de una propuesta.

   ```powershell
   npm.cmd run check:gemini
   npm.cmd run check:gemini -- --plan
   ```

Para servir las funciones con Supabase local, ejecuta `supabase functions serve`. El CLI carga `supabase/functions/.env`. Completa en ese archivo `ALLOWED_ORIGINS`, `AI_BASE_URL` y `AI_API_KEY` si tu entorno local necesita comunicarse con el gateway. [Variables de entorno de Supabase](https://supabase.com/docs/guides/functions/secrets).

### Opciones

| Variable | Valor predeterminado | Uso |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Modelo para los planes. Acepta hasta cinco nombres separados por comas. Si Gemini responde 404 o 410, se prueba el siguiente. |
| `GEMINI_CHAT_MODEL` | Lista de `GEMINI_MODEL` | Lista propia para el chat de Lumi. |
| `GEMINI_PLAN_FORMAT` | `json_schema` | Esquema JSON de la propuesta. `json_object` pide JSON sin esquema y `none` pide texto. El servidor valida la propuesta en los tres casos. |

## Desplegar

Con datos reales, usa una clave de un proyecto de Google Cloud con facturación activa. El nivel gratuito de Gemini indica que puede usar las entradas y salidas para mejorar sus productos y pide excluir información personal. El nivel pagado aplica el acuerdo de tratamiento de datos de Google y conserva temporalmente las solicitudes y respuestas para seguridad y detección de abusos. [Condiciones de Gemini API](https://ai.google.dev/gemini-api/terms).

Coordina la publicación del aviso de privacidad, los términos y la ficha de Seguridad de los datos de Google Play antes de usar Gemini con usuarios. El chat envía el mensaje, el nombre del perfil, el nombre y la etapa de Lumi, hasta tres metas activas con su próxima acción y los últimos seis mensajes. Los planes envían los datos de la meta, las acciones completadas y el tiempo disponible. Los datos de la cuenta, como el correo y el identificador, quedan en Supabase.

Guarda `GEMINI_API_KEY` en **Edge Functions → Secrets**. Si el `.env` contiene sólo las variables de Gemini que quieres desplegar, puedes cargarlo con el CLI. Ejecuta estos comandos desde la raíz del proyecto con el CLI 2 y el proyecto ya vinculado.

```powershell
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy lumi-chat ai-fallback
```

Con Supabase CLI 3, agrega `--remote` a ambos comandos. [CLI de Supabase](https://supabase.com/docs/reference/cli/supabase-functions-deploy#supabase-functions-deploy).

`private.ai_fallback_settings` controla si se usa el respaldo y sus límites por persona y para toda la app. Consulta la configuración de tu instalación antes de probar un plan en la app. Con un límite de planes en cero, la solicitud espera a Ollama.

```sql
select enabled, chat_per_hour, global_chat_per_day, plans_per_day, global_plans_per_day
from private.ai_fallback_settings where id;
```

## Verificar el respaldo

1. Con Ollama activo, envía un mensaje a Lumi y verifica que indique **IA local**.
2. Con la IA local desconectada, espera a que caduque la señal del trabajador. Un mensaje nuevo debe indicar **IA en la nube (respaldo)**. Si hay cuota de planes, una solicitud nueva debe pasar de la cola a una propuesta preparada en la nube.
3. Al volver Ollama, un mensaje nuevo debe indicar **IA local**. Si Gemini falla durante el respaldo, el chat devuelve los créditos y los planes reintentan los fallos transitorios según la configuración de la cola.

```powershell
npm.cmd test
npm.cmd run test:edge
npm.cmd run check:edge
```
