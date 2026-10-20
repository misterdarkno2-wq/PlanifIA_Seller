# Suscripciones

## Cobros sólo en la app, con Google Play

PlanifIA cobra únicamente dentro de la app de Android, con Google Play Billing: suscripciones Plus y Pro, paquetes de créditos y «Quitar anuncios». El servidor valida cada compra con la Google Play Developer API (`play-billing` y `play-rtdn`); los detalles están en [monetizacion.md](monetizacion.md) y [google-play.md](google-play.md).

La web no cobra. Muestra el mensaje «Las suscripciones se contratan desde la app de Google Play» en Planes y Mi suscripción, y no ofrece formularios, enlaces ni botones para contratar, renovar, cambiar de plan o registrar tarjetas. La app de Google Play todavía está en preparación: no se publica un enlace de tienda hasta contar con una ficha real. Los precios de la web son referencias del catálogo, no ofertas confirmadas de Google Play.

Qué lee la web, directamente de Supabase y sin Edge Functions:

- **Planes**: `public.plan_catalog`, que cualquier visitante puede leer (política `plans_read`).
- **Mi suscripción**: `public.billing_state()` (plan vigente, incluido el de Google Play, y uso del mes) y `public.monetization_state()` (créditos, invitaciones y suscripción de Google Play).

Los enlaces guardados con `?plan=plus` o `?plan=pro` muestran el aviso de Google Play. Los enlaces de retorno antiguos (`?order=` o `?enrollment=`) se ignoran: la web ya no consulta pagos. El plan Gratis conserva su recorrido de registro e inicio de sesión. Los precios se modifican en `public.plan_catalog` y en Play Console, no en el JavaScript.

## Transbank retirado (19 de octubre de 2026)

Entre el 4 y el 19 de octubre de 2026 el repositorio tuvo un cobro web con Transbank (Webpay Plus y Oneclick), con las Edge Functions `billing`, `billing-return` y `billing-renew` y un cron de renovación en `pg_cron`. Funcionó sólo en modo integración, con las credenciales públicas de prueba de Transbank: el responsable confirmó que no hubo pagos reales. Se retiró por la recomendación R7 de [auditoria-legal-seguridad-2026-10-18.md](auditoria-legal-seguridad-2026-10-18.md), porque sólo aumentaba la superficie de ataque.

Se eliminaron del repositorio:

- `supabase/functions/billing`, `billing-return` y `billing-renew`, y `supabase/functions/_shared/transbank.ts` y `billing.ts`.
- `supabase/billing-scheduler.sql` (el cron `planifia-billing-renew`) y `scripts/transbank-smoke.ts`.
- Las variables `TRANSBANK_*` y `BILLING_*` de `supabase/functions/.env.example` y sus entradas en `supabase/config.toml`.
- En la web: el historial de pagos, la consulta del resultado de un pago y la cancelación de una renovación de Oneclick.

El código sigue en el historial de Git, por ejemplo en la rama `codex/suscripciones-transbank`.

En la base de datos no se borró nada. La migración `202610190001_retire_transbank.sql` quita el permiso de ejecución a las funciones que sólo servían a Transbank y les deja un comentario:

| Función | Uso anterior | Ahora |
| --- | --- | --- |
| `billing_admin(text,jsonb)` | Órdenes, cobros, inscripciones y renovaciones (`service_role`) | Nadie la ejecuta |
| `manage_subscription(text,text,boolean)` | Cancelar, reanudar o cambiar una suscripción de Oneclick | Nadie la ejecuta |
| `billing_promotion()` | Campaña de bienvenida con el primer mes rebajado | Nadie la ejecuta; `billing_state()` la usa con los permisos de su dueño |

Siguen en uso porque también sirven a Google Play: `plan_catalog`, `billing_state()`, `monetization_state()` y `public.subscription_periods` (dentro de `private.effective_plan`).

Quedan sin uso, con los datos de las pruebas en integración: `public.subscriptions`, `public.payment_orders` y, en el esquema `private`, `payment_provider`, `payment_attempts`, `billing_methods`, `billing_enrollments`, `billing_accounts`, `billing_consent_events`, `billing_campaign` y `billing_settings`. Eliminarlas requiere la decisión del responsable y una migración propia; antes conviene exportar sus filas.

## Pasos manuales en producción

**Estado al 19 de octubre de 2026:** los pasos 1 a 4 están hechos y comprobados. No quedan el cron `planifia-billing-renew` ni sus dos entradas de Vault, ni los secretos `TRANSBANK_*` y `BILLING_*`, ni las funciones `billing-return` y `billing-renew`. La función `billing` responde Planes en modo `disabled` (sin Webpay ni Oneclick). Faltan el 5 (publicar la web y la app), el 6 (la migración), el 7 (borrar `billing`) y el 8 (opcional).

El orden importa porque **las versiones de la app ya instaladas cargan Planes y Mi plan (incluida la compra con Google Play) a través de la Edge Function `billing`**, con sus acciones `catalog` y `state`. Si se borra antes de tiempo, esas versiones muestran «No pudimos consultar los planes» y no pueden comprar hasta actualizarse.

Los comandos se ejecutan desde la carpeta del repositorio, con la sesión de Supabase CLI iniciada; las consultas SQL, en el editor SQL de Supabase.

1. **Detener el cron de renovación.** Comprobar que existe y quitarlo:

   ```sql
   select jobid, jobname, schedule, active from cron.job where jobname = 'planifia-billing-renew';
   select cron.unschedule('planifia-billing-renew');
   ```

2. **Borrar los secretos del cron en Vault** (Dashboard > Database > Vault, o por SQL):

   ```sql
   delete from vault.secrets where name in ('planifia_billing_url', 'planifia_billing_cron_secret');
   ```

3. **Borrar los secretos de Transbank de las Edge Functions.** Primero listar los nombres y quitar sólo los que existan. Sin `TRANSBANK_ENV`, la función `billing` desplegada queda en modo «deshabilitado»: rechaza cualquier pago, pero sigue respondiendo `catalog` y `state` a la app instalada.

   ```powershell
   npx.cmd supabase secrets list
   npx.cmd supabase secrets unset TRANSBANK_ENV TRANSBANK_ONECLICK_ENABLED TRANSBANK_WEBPAY_COMMERCE_CODE TRANSBANK_WEBPAY_API_KEY TRANSBANK_ONECLICK_COMMERCE_CODE TRANSBANK_ONECLICK_API_KEY TRANSBANK_ONECLICK_CHILD_CODE BILLING_SITE_URL BILLING_CRON_SECRET BILLING_CHECKOUT_TTL_MINUTES
   ```

   `ALLOWED_ORIGINS` se conserva: la usan las demás funciones.

4. **Borrar las funciones que nadie más llama**, `billing-return` (retorno de Transbank) y `billing-renew` (cron):

   ```powershell
   npx.cmd supabase functions delete billing-return
   npx.cmd supabase functions delete billing-renew
   ```

5. **Publicar la web y una versión nueva de la app** con este cambio. Ambas leen `plan_catalog` y `billing_state()` directamente y ya no llaman a `billing`.

6. **Aplicar la migración** `202610190001_retire_transbank.sql` después de publicar la web (con `npx.cmd supabase db push` o pegándola en el editor SQL). Ojo: `db push` también aplica las migraciones anteriores que sigan pendientes, como `202610180001_legal_reports.sql`. Desde aquí, la función `billing` desplegada ya no puede crear órdenes ni cancelar suscripciones; su acción `state` sigue funcionando, pero `catalog` (Planes sin sesión iniciada) deja de responder en las versiones antiguas de la app. Por eso la web debe estar publicada antes.

7. **Borrar la función `billing`** cuando las instalaciones se hayan actualizado. Desde la 2.3.3 la app obliga a actualizar cuando la versión instalada tiene 14 días o más de atraso según Google Play (ver [android.md](android.md)): espera al menos esos 14 días después de publicar la versión nueva y revisa en Play Console qué versiones siguen activas. Las anteriores a la 2.3.3 no muestran ese aviso.

   ```powershell
   npx.cmd supabase functions delete billing
   ```

8. **Opcional, con la decisión del responsable:** exportar y eliminar las tablas de Transbank que quedan sin uso (lista en la sección anterior).

Verificación posterior: `npx.cmd supabase functions list` ya no muestra `billing`, `billing-return` ni `billing-renew`; `select count(*) from cron.job where jobname = 'planifia-billing-renew';` devuelve 0, y en la web, sin sesión, Planes muestra Gratis, Plus y Pro.

## Límites del plan y consumo

`private.effective_plan` decide el plan vigente: el de Google Play mientras Google lo informe activo (incluye cancelado sin vencer y período de gracia) o, mientras dure, un período de las pruebas de Transbank en `public.subscription_periods`; si no hay ninguno, Gratis. Los límites de metas activas se aplican en la base con el disparador `planifia_goal_plan_limit`. Al vencer o bajar de plan se conservan los datos, las tareas y la experiencia de Lumi; sólo se bloquea crear o reactivar metas por encima del límite. El uso de IA se paga con créditos (ver [monetizacion.md](monetizacion.md)).

## Pruebas

```powershell
npm.cmd test
npm.cmd run test:edge
npm.cmd run check:edge
npm.cmd run test:billing-ui
```

`tests/billing-database.test.js` comprueba con todas las migraciones que nadie puede ejecutar las funciones retiradas y que Mi plan sigue funcionando con una suscripción de Google Play. `tests/billing-ui.mjs` comprueba que la web sólo consulta los planes y el plan vigente, que no muestra pagos ni controles de cobro y que no llama a la función `billing`.
