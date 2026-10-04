# Suscripciones

## Web: contratación desde Google Play

La web de PlanifIA muestra el mensaje «Las suscripciones se contratan desde la app de Google Play» en Planes y Mi suscripción. No ofrece formularios, enlaces ni botones para contratar, renovar, cambiar de plan o registrar tarjetas mediante Webpay u Oneclick. Los enlaces guardados con `?plan=plus` o `?plan=pro` muestran el aviso y no crean una cotización. El plan Gratis conserva su recorrido de registro e inicio de sesión.

La app de Google Play todavía está en preparación: no se publica un enlace de tienda hasta contar con una ficha real. Los precios de la web son referencias del catálogo, no ofertas confirmadas de Google Play; la campaña anterior de Transbank deja de anunciarse en la interfaz. Este cambio no implementa Google Play Billing ni sincroniza compras de Play con Supabase.

Se conservan la consulta de beneficios, consumo e historial, la verificación de órdenes anteriores y la posibilidad de cancelar una renovación automática anterior. La web no puede reanudar esa autorización ni cambiar su tarjeta. No se completan inscripciones de tarjetas desde esta interfaz. El servidor mantiene los registros y funciones anteriores; retirar los controles de la web no deshabilita por sí solo sus endpoints ni cancela autorizaciones existentes.

## Backend anterior: Transbank

Supabase Auth identifica al usuario; PostgreSQL calcula importes, promociones, períodos, límites y permisos. Las funciones `billing`, `billing-return` y `billing-renew` conservan las operaciones de pago anteriores desde el servidor. El catálogo editable es `public.plan_catalog`. Las siguientes secciones documentan ese backend, que la web ya no utiliza para iniciar compras.

## Ambiente de integración

Los pagos empiezan en integración y la interfaz indica **Pagos de prueba**. No se envían tarjetas ni se realizan cobros reales en la verificación automatizada. Las credenciales públicas de integración proceden del [SDK oficial de Transbank](https://github.com/TransbankDevelopers/transbank-sdk-nodejs/tree/master/lib/transbank/common). `TRANSBANK_ENV` debe ser explícito: sin configurarlo se deshabilitan pagos; producción nunca hereda esas credenciales.

Desde la carpeta del repositorio:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:edge
npm.cmd run check:edge
npx.cmd supabase db push
npx.cmd supabase secrets set --env-file supabase/functions/.env.local
npx.cmd supabase functions deploy billing
npx.cmd supabase functions deploy billing-return
npx.cmd supabase functions deploy billing-renew
npx.cmd supabase functions deploy goal-plan
```

Copiar antes los campos de `supabase/functions/.env.example` al archivo privado `.env.local`, conservando las claves de IA existentes. Nunca añadir prefijo `VITE_` a credenciales Transbank ni al secreto de renovación. `.env.local` queda fuera de Git. Supabase aporta automáticamente sus claves al ejecutar funciones.

Comprobación REST real de integración, únicamente creación y consulta, sin tarjeta ni autorización:

```powershell
npx.cmd deno run --no-config --no-lock --allow-net=webpay3gint.transbank.cl scripts/transbank-smoke.ts
```

## Modalidades

- **Webpay Plus** paga un mes y exige renovación manual. No guarda una tarjeta para cobrar meses siguientes. La orden incluye precio, plan, período y promoción decididos por el servidor.
- **Oneclick** necesita `TRANSBANK_ONECLICK_ENABLED=true` y habilitación comercial propia. Pide consentimiento expreso. Una inscripción exitosa solo registra una referencia privada; el plan se activa después del primer cobro aprobado, correlacionado y validado. Actualizar tarjeta no produce un cargo inmediato.

El retorno admite GET y POST y busca el token en registros privados. Verifica monto entero CLP, orden, sesión Webpay, o comercio hijo y orden Oneclick; requiere estado `AUTHORIZED` y código `0`. Un parámetro `approved=true`, visitar la URL o repetir el retorno no activa una suscripción. Nunca se guardan PAN completo ni CVV; la interfaz solo recibe marca y últimos cuatro dígitos cuando están disponibles.

## Promoción, períodos y cambios

La promoción pertenece al primer período mensual pagado del usuario: Plus $990 y luego $2.750; Pro $1.990 y luego $4.990. Un rechazo no consume la promoción. La confirmación del primer pago y el uso promocional se guardan en una misma transacción bajo bloqueo. Cambiar de plan, cancelar o volver no recupera la promoción. Integración y producción mantienen registros y medios separados.

### Oferta de bienvenida de 7 días

La migración `202610040003_welcome_campaign.sql` fija una campaña de siete días desde su primera aplicación en la base. Abrir la web, recargar, desplegar código o cambiar la hora del teléfono no reinicia la oferta. El backend conserva los importes Plus $990 y Pro $1.990 durante el primer período elegible; la web no anuncia esta campaña como una oferta de Google Play.

Las fechas y la activación se administran en `private.billing_campaign`, desde el editor SQL de Supabase con acceso administrativo. Consulta pública segura de las fechas actuales:

```sql
select public.billing_promotion();
```

Para cerrar la campaña antes de su fecha, ejecuta `update private.billing_campaign set enabled=false where id='welcome';`. Para una nueva ventana, modifica explícitamente `starts_at`, `ends_at` y `enabled`; usa fechas con zona horaria. No se reabre automáticamente. Los precios se modifican en `public.plan_catalog`, no en el JavaScript.

El servidor exige una campaña activa y que la cuenta no haya tenido ningún período pagado, incluso a precio regular. Fuera de la ventana se aplican los precios regulares. Una cotización anterior no autoriza un precio superior: el navegador envía `expected_amount_clp` y el servidor compara ese importe con su cálculo bajo bloqueo, antes de crear el pago o inscribir. No utiliza ese campo para fijar el precio. Una orden ya creada o una inscripción Oneclick aceptada conservan su importe al terminar la campaña; la inscripción sigue sin activar el plan hasta confirmar el cobro. Una bienvenida consumida por otra compra bloquea la inscripción antigua, en lugar de sustituirla por un cobro mayor.

Los meses se calculan en UTC con el día inicial como ancla. Si un mes no tiene ese día, se usa su último día; por ejemplo, 31 de enero → 28/29 de febrero → 31 de marzo. La renovación anticipada empieza desde el vencimiento vigente y conserva los días pagados. El cambio de plan se aplica en el siguiente período, sin prorrateo. Cancelar futuros cobros mantiene acceso hasta vencer y no devuelve pagos anteriores. Los datos, tareas y XP permanecen conservados al vencer o bajar de plan.

El consumo de IA reinicia el primer día de cada mes UTC. Generación y ajuste tienen contadores distintos. Una solicitud validada que se envía a la IA consume una unidad, incluso si el proveedor falla; las solicitudes bloqueadas no llaman al modelo. El límite diario existente sigue funcionando como protección adicional.

## Renovación en la nube

Configurar un secreto aleatorio de al menos 32 caracteres como `BILLING_CRON_SECRET` en Edge Functions. Guardar en Supabase Vault las entradas `planifia_billing_url` y `planifia_billing_cron_secret` descritas en `supabase/billing-scheduler.sql`. Ejecutar ese archivo en el editor SQL como administrador. El cron corre cada 15 minutos aunque nadie abra la aplicación, mediante [pg_cron y pg_net](https://supabase.com/docs/guides/functions/schedule-functions), y obtiene el secreto de [Vault](https://supabase.com/docs/guides/database/vault).

Las órdenes, intentos y reservas persistentes impiden cobrar un período dos veces. Una respuesta incierta se consulta con la misma referencia: un timeout o un 404 no prueban que no hubo cargo y nunca disparan un nuevo cargo a ciegas. Los rechazos confirmados permiten reintentos limitados, configurados en `private.billing_settings` (por defecto 3 intentos, 24 horas entre ellos, hasta 72 horas tras el vencimiento). Al agotarlos o vencer esa ventana se cancela la autorización del ciclo y se solicita renovar manualmente; una orden incierta sigue en verificación. Si el pago se confirma tarde, el nuevo mes parte de la confirmación para conservar un mes completo de acceso. La pantalla informa pagos pendientes o rechazados y permite cambiar tarjeta o renovar manualmente. Si Transbank no permite recuperar una inscripción incierta, requiere revisión del comercio; nunca activa beneficios.

El cron también revisa los formularios Webpay abandonados tras `BILLING_CHECKOUT_TTL_MINUTES` (30 por defecto, configurable entre 10 y 120). Solo cierra una orden cuando Transbank confirma `INITIALIZED` y no existe un intento de confirmación financiera iniciado. Un estado incierto se mantiene pendiente de verificación.

Si falla abrir un formulario inicial, la base verifica bajo bloqueo si llegó a guardar su token. Sin token ni confirmación financiera iniciada, cierra la creación fallida y permite volver a intentarlo; si el token se guardó antes de perder la respuesta, conserva el formulario existente. Un fallo de inscripción o pago individual no impide revisar los demás usuarios: el cron devuelve contadores `processed`, `reconciled` y `failed`, sin referencias privadas.

Si se cambia el plan justo antes de iniciar un cobro automático, el servidor cancela la orden correspondiente al plan anterior. El usuario renueva manualmente con el precio del plan nuevo. No crea un cargo automático adicional para resolver esa carrera.

## Qué falta para producción

1. Contrato y código de comercio habilitados para Webpay Plus; para renovación automática, habilitación Oneclick y código hijo.
2. Claves privadas de cada producto guardadas en Supabase, sin publicarlas.
3. Completar las pruebas y certificación que exija Transbank para ese comercio.
4. Configurar `TRANSBANK_ENV=production` y `billing_admin('configure_environment','{"environment":"production"}'::jsonb)` desde administración. Las órdenes de integración no pueden activar planes ni reutilizar tarjetas en producción.
5. Activar y comprobar el cron y sus registros antes de ofrecer renovación automática. No basta con desplegar la web.

Fuentes de operación: [Webpay Plus](https://transbankdevelopers.com/documentacion/webpay-plus), [Oneclick](https://transbankdevelopers.com/documentacion/oneclick), [referencia oficial REST](https://github.com/TransbankDevelopers/transbank-developers-docs/tree/master/referencia/webpay) y [código oficial SDK](https://github.com/TransbankDevelopers/transbank-sdk-nodejs/tree/master/lib/transbank/webpay).
