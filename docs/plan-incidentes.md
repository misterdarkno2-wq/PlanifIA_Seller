# Plan de respuesta a incidentes de seguridad y de datos personales

Qué hacer si se filtra una clave, alguien entra a una cuenta o a los sistemas, se pierde información o los datos de las personas quedan expuestos. También explica cómo revisar los reportes de contenido de la IA.

Este plan no reemplaza la asesoría de un abogado. Desde el **1 de diciembre de 2026** rige la Ley 21.719, que obliga a informar las vulneraciones a la Agencia de Protección de Datos Personales y, en ciertos casos, a las personas afectadas. Confirma con el abogado la fecha de vigencia, que podría postergarse.

## 1. Quién decide

| Rol | Persona | Contacto |
| --- | --- | --- |
| Responsable del tratamiento y de las decisiones | Claudia Valenzuela | [PENDIENTE: teléfono]; planifiaprivacity@gmail.com |
| Respaldo si el responsable no está disponible | [PENDIENTE: nombre] | [PENDIENTE] |
| Asesoría legal | [PENDIENTE: abogado] | [PENDIENTE] |

El responsable decide si hay que contener (apagar funciones, rotar claves), si hay que avisar a la Agencia o a las personas, y cuándo se cierra el incidente. Todo se anota en el [registro](#9-registro-de-incidentes).

## 2. Cómo se detecta

Revisa estas señales al menos una vez por semana y siempre que algo parezca raro:

- **Alertas de GitHub**: gitleaks (workflow *Secretos y dependencias*), CodeQL, Dependabot y *secret scanning* en la pestaña **Security**.
- **Supabase**: avisos del panel, el **Security Advisor** y los logs de las Edge Functions y de Auth (**Logs → Edge Functions / Auth**). Busca picos de `401`, `429` o errores `goal-plan failed`, `lumi-chat ai`, `play-rtdn`, `admob-ssv`.
- **Cuentas nuevas en masa** (posibles cuentas falsas que acumulan créditos):
  ```sql
  select date_trunc('hour', created_at) hora, count(*) from auth.users
  where created_at > now() - interval '2 days' group by 1 order by 1 desc;
  ```
- **Uso anormal de créditos o de la IA**:
  ```sql
  select reason, count(*), sum(bonus_delta) from private.credit_events
  where created_at > now() - interval '1 day' group by 1 order by 2 desc;
  select bucket, count(*), max(hits) from private.rate_limits group by 1;
  ```
- **Proveedores**: avisos de Google Play Console (políticas o pagos), AdMob (tráfico no válido), Groq (uso y facturación), Cloudflare (túnel).
- **Personas**: correos a planifiaprivacity@gmail.com y reportes de contenido de la IA (sección 8).
- **PC de la IA**: archivos `seller-*.log` en la raíz del proyecto. No deben contener tokens, correos ni texto de los usuarios.

## 3. Gravedad

| Nivel | Ejemplos | Plazo para contener |
| --- | --- | --- |
| Crítico | Clave de servicio de Supabase filtrada; acceso a la base de datos; datos de muchas personas expuestos; keystore de carga filtrado | Inmediato (mismo día) |
| Alto | Clave de Groq, de Google Play o del gateway filtrada; una cuenta tomada por otra persona; contenido enviado a un proveedor no declarado en la política | 24 horas |
| Medio | Fraude con créditos o anuncios; abuso de la IA; vulnerabilidad sin explotar | 72 horas |
| Bajo | Error sin datos expuestos; reporte de contenido aislado | Siguiente revisión |

## 4. Contener (primeros minutos)

1. **Apagar la IA en la nube**, si el problema la involucra (en el SQL Editor de Supabase):
   ```sql
   update private.ai_fallback_settings set enabled = false where id;
   ```
2. **Detener el PC de la IA**: cierra el gateway y el túnel (`seller-tunnel`) o apaga el equipo.
3. **Pausar registros nuevos**: Supabase → **Authentication → Sign In / Providers → Allow new users to sign up** (desactivar).
4. **Rotar la clave comprometida** (sección 5) y **cerrar sesiones** (sección 6).
5. **Guardar evidencia** antes de borrar nada: capturas, logs exportados, fecha y hora (zona America/Santiago).

## 5. Cómo rotar cada secreto

Después de cada rotación, comprueba que la app funcione (iniciar sesión, chat, plan) y anota la fecha en el registro.

| Secreto | Dónde vive | Cómo rotarlo |
| --- | --- | --- |
| Clave de servicio de Supabase (`sb_secret_…` o `service_role`) | Edge Functions (automática), `.env.gateway.local` del PC (`QUEUE_SERVICE_ROLE_KEY`) | Supabase → **Project Settings → API Keys**: crea una clave secreta nueva y revoca la anterior. Actualiza `QUEUE_SERVICE_ROLE_KEY` en el PC y reinicia `scripts/start-services.ps1`. Si el proyecto usa las claves JWT antiguas, rotar el *JWT secret* invalida también la clave pública y todas las sesiones: habría que recompilar la web y la app. |
| Clave pública (`sb_publishable_…`) | Web y app (no es secreta) | Sólo si se abusa de ella: crea una nueva, actualiza `VITE_SUPABASE_PUBLISHABLE_KEY` en GitHub (variables del repositorio), publica la web y sube una versión de la app. |
| `GROQ_API_KEY` | Secreto de Supabase | console.groq.com → **API Keys**: revoca la clave y crea otra. `npx.cmd supabase secrets set GROQ_API_KEY=gsk_...` |
| `NVIDIA_API_KEY` (ya no se usa) | Secreto de Supabase | Revócala en build.nvidia.com → **API Keys** y bórrala: `npx.cmd supabase secrets unset NVIDIA_API_KEY` |
| Secreto del gateway (`GATEWAY_SECRET` = `AI_API_KEY`) | `.env.gateway.local` del PC y secreto de Supabase | Genera 32 bytes aleatorios (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`), cámbialo en los dos lugares a la vez y reinicia los servicios del PC. |
| Credenciales del túnel de Cloudflare | `.cloudflared/planifia-seller-ia.json` | Cloudflare **Zero Trust → Networks → Tunnels**: rota el token del túnel (o crea uno nuevo y borra el anterior) y reemplaza el archivo. |
| Cuenta de servicio de Google Play (`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`) | Secreto de Supabase | Google Cloud Console → **IAM → Cuentas de servicio → Claves**: crea una clave nueva, borra la anterior y `npx.cmd supabase secrets set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON='...'` |
| `PLAY_RTDN_SECRET` | Secreto de Supabase y URL de push de Pub/Sub | Genera uno nuevo, cámbialo en la suscripción push (`?token=`) y en Supabase. Si activaste el JWT de Pub/Sub, revisa también `PLAY_RTDN_AUDIENCE` y `PLAY_RTDN_SERVICE_ACCOUNT`. |
| `BILLING_CRON_SECRET` | Secreto de Supabase y Vault (`planifia_billing_cron_secret`) | Genera uno nuevo y cámbialo en los dos lugares. |
| `RATE_LIMIT_SALT` | Secreto de Supabase | Genera uno nuevo. Los límites por IP vuelven a cero. |
| Transbank (`TRANSBANK_*`) | Secretos de Supabase | Hoy en integración (claves públicas de prueba). En producción: portal de Transbank. |
| AdMob | Sin secreto en el servidor (la firma se verifica con claves públicas de Google) | Si se compromete la cuenta de Google: cambia la contraseña, revisa la verificación en dos pasos y los usuarios con acceso en AdMob. |
| Clave de carga de Android (`planifia-release.keystore`) | Fuera de Git; hoy en la raíz del proyecto | Play Console → **Integridad de la app → Firma de apps → Solicitar restablecimiento de la clave de carga**. La clave de firma de la app la guarda Google (Play App Signing). |
| Cuenta de GitHub | — | Cambia la contraseña, revisa la verificación en dos pasos, los tokens personales y las claves de despliegue, y los colaboradores. |

## 6. Cerrar sesiones

- **Una persona**: en el SQL Editor,
  ```sql
  delete from auth.sessions where user_id = 'ID-DE-LA-CUENTA';
  delete from auth.refresh_tokens where user_id = 'ID-DE-LA-CUENTA';
  ```
  O desde el panel: **Authentication → Users → (cuenta) → Sign out user** si está disponible.
- **Todas las cuentas**: `delete from auth.sessions; delete from auth.refresh_tokens;`. Los tokens de acceso ya emitidos siguen sirviendo hasta que vencen (1 hora por defecto); para cortarlos de inmediato hay que rotar las claves de firma JWT.
- Pide a las personas afectadas cambiar su contraseña con **Olvidé mi contraseña**.

## 7. Evaluar y avisar

1. **Qué pasó**: qué datos, de cuántas personas, desde cuándo, si incluyen datos sensibles (por ejemplo, salud escrita en metas o en el chat) o de menores, y si el riesgo sigue.
2. **A quién avisar** (confirmar con el abogado):
   - **Agencia de Protección de Datos Personales** (desde que rija la Ley 21.719): por los medios más expeditos y sin dilaciones indebidas cuando la vulneración pueda afectar a las personas. [PENDIENTE: canal de notificación de la Agencia]
   - **Personas afectadas**: cuando la vulneración afecte datos sensibles o pueda causarles un daño, y siempre que convenga para que se protejan (por ejemplo, cambiar la contraseña).
   - **Proveedores**: Supabase, Groq, Google o Cloudflare, si el incidente pasa por ellos.
   - **Google Play**: si cambia lo declarado en Seguridad de los datos.
   - El CSIRT de Gobierno (csirt.gob.cl) recibe reportes voluntarios de incidentes.

### Plantilla: aviso a la Agencia

> **Asunto:** Notificación de vulneración de seguridad de datos personales – PlanifIA
>
> Responsable: [nombre o razón social], RUT [RUT], domicilio [domicilio]. Contacto: planifiaprivacity@gmail.com, [teléfono].
>
> 1. Fecha y hora en que ocurrió y en que la detectamos: […]
> 2. Qué ocurrió: […]
> 3. Datos afectados: […] (indicar si hay datos sensibles o de menores).
> 4. Personas afectadas (número aproximado): […]
> 5. Consecuencias probables: […]
> 6. Medidas adoptadas para contener y mitigar: […]
> 7. Medidas recomendadas a las personas afectadas: […]
> 8. Si se avisó a las personas afectadas, cuándo y cómo: […]

### Plantilla: aviso a las personas

> **Asunto:** Aviso de seguridad sobre tu cuenta de PlanifIA
>
> Hola. El [fecha] detectamos [qué pasó, en palabras simples]. Esto pudo afectar [qué datos tuyos]. [No afectó / sí afectó] tu contraseña.
>
> Lo que ya hicimos: […].
> Lo que te recomendamos: [cambiar tu contraseña con «Olvidé mi contraseña», revisar tu cuenta, desconfiar de correos que pidan tus datos].
>
> Si tienes dudas o quieres ejercer tus derechos, escríbenos a planifiaprivacity@gmail.com. También puedes reclamar ante la Agencia de Protección de Datos Personales.
>
> [Nombre del responsable], PlanifIA

## 8. Reportes de contenido de la IA

Cada respuesta de Lumi y cada plan propuesto tienen un botón **Reportar** (exigido por la política de contenido generado por IA de Google Play). Revisa los reportes al menos una vez por semana en el SQL Editor:

```sql
select id, created_at, kind, reason, details, provider, left(content, 300) contenido
from public.ai_content_reports where status = 'open' order by created_at;
```

Después de revisar cada uno:

```sql
update public.ai_content_reports set status = 'reviewed', reviewed_at = now() where id = '...';
-- 'actioned' si cambiaste algo (instrucciones de Lumi, detector de crisis), 'dismissed' si no correspondía.
```

- Contenido peligroso o de crisis que el detector no vio: agrega la expresión a `supabase/functions/_shared/crisis.js` con su prueba y despliega `lumi-chat` y `goal-plan`.
- Contenido ofensivo o incorrecto: ajusta `LUMI_SYSTEM` en `supabase/functions/lumi-chat/handler.ts` o las instrucciones de planes en `supabase/functions/_shared/plan.js`.
- Si un reporte revela un riesgo para alguien, trátalo como incidente de gravedad alta.
- Revisa una vez al año los números de `CRISIS_LINES` (Minsal, ChileAtiende).
- Plazos de la política de privacidad:
  - Los reportes se borran solos a los 12 meses cuando alguien envía un reporte nuevo. Si pasan meses sin reportes, bórralos a mano:
    ```sql
    delete from public.ai_content_reports where created_at < now() - interval '12 months';
    ```
  - Una vez al mes, borra en Gmail (planifiaprivacity@gmail.com) los correos de consultas resueltas hace más de 12 meses.
  - Responde los reclamos dentro de 10 días hábiles (términos, sección 15).

## 9. Registro de incidentes

Anota todos los incidentes, también los que no se notificaron, con la decisión y su motivo. Guarda este registro fuera del repositorio si incluye datos personales.

| N.º | Detectado (fecha y hora) | Qué pasó | Datos y personas afectadas | Gravedad | Medidas | ¿Aviso a la Agencia? | ¿Aviso a personas? | Cerrado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-10-19 | Del 14 al 19 de octubre de 2026 el respaldo de IA envió a NVIDIA (API de prueba) mensajes del chat con el nombre del perfil y textos de planes. La política publicada decía que la IA no usaba servicios de terceros, y los términos de prueba de NVIDIA prohíben datos personales y permiten usar el contenido para mejorar sus modelos. | Personas que usaron el chat o pidieron planes con el PC apagado en esas fechas. Planes: `select user_id, created_at from public.ai_jobs where provider = 'cloud';`. Chat: no se guarda qué IA respondió; `private.ai_fallback_usage` sólo conserva 2 días. | Alto | Respaldo apagado en producción (`enabled = false`) el 19 de octubre; código cambiado a Groq; política nueva lista para publicar. Pendiente: revocar la clave de NVIDIA y borrar el secreto, y pedir a NVIDIA que elimine el contenido si es posible. | [PENDIENTE: decisión con el abogado] | [PENDIENTE: decisión con el abogado] | No |

## 10. Después del incidente

- Revisa qué falló y qué control lo habría evitado. Agrega una prueba o una alerta.
- Actualiza este plan, la política de privacidad y la sección Seguridad de los datos de Play si cambió algo.
- Si rotaste claves, confirma que las antiguas ya no sirven.
