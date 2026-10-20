-- Retiro del cobro web con Transbank (Webpay y Oneclick). Recomendación R7 de
-- docs/auditoria-legal-seguridad-2026-10-18.md.
-- PlanifIA cobra sólo dentro de la app, con Google Play. Transbank funcionó únicamente en modo
-- integración, sin pagos reales, y sus Edge Functions (billing, billing-return y billing-renew)
-- ya no están en el repositorio.
-- No se borra nada: tablas, datos y funciones quedan como registro. Sólo se quita el permiso para
-- ejecutar las funciones que servían únicamente a Transbank:
--   billing_admin        órdenes, cobros, inscripciones y renovaciones (lo usaban las tres funciones).
--   manage_subscription  cancelar, reanudar o cambiar una suscripción de Oneclick.
--   billing_promotion    campaña de bienvenida con el primer mes rebajado de Webpay y Oneclick.
-- Siguen vigentes porque también sirven a Google Play: plan_catalog, billing_state() (la consulta
-- de Mi plan; llama a billing_promotion() con los permisos de su dueño) y monetization_state().
-- Tablas que quedan sin uso y con posibles datos de integración, a revisar antes de eliminarlas:
-- public.subscriptions, public.payment_orders y, en private, payment_provider, payment_attempts,
-- billing_methods, billing_enrollments, billing_accounts, billing_consent_events y billing_campaign.
-- public.subscription_periods sigue en la consulta del plan vigente (private.effective_plan).

revoke all on function public.billing_admin(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.manage_subscription(text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.billing_promotion() from public,anon,authenticated,service_role;

comment on function public.billing_admin(text,jsonb) is
 'Retirada el 2026-10-19 (cobro web con Transbank). Nadie puede ejecutarla; se conserva como registro. PlanifIA cobra sólo con Google Play.';
comment on function public.manage_subscription(text,text,boolean) is
 'Retirada el 2026-10-19 (suscripciones de Oneclick). Nadie puede ejecutarla; se conserva como registro. Las suscripciones se gestionan en Google Play.';
comment on function public.billing_promotion() is
 'Retirada el 2026-10-19 (campaña de bienvenida de Transbank). Sólo la usa billing_state() con los permisos de su dueño.';
