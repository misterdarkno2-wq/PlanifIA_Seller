-- Recordatorios con notificaciones locales (app de Android, versión 2.3.8).
-- La persona elige UNA hora del día para recibir el aviso «Hoy tienes N pasos para tus metas». La hora
-- se guarda en su perfil para recuperarla en otro teléfono o al reinstalar. Encender o apagar los
-- avisos no pasa por la base: es una decisión de cada teléfono, que además programa los avisos con sus
-- propias alarmas. El servidor no envía notificaciones.
-- Nula = la persona aún no eligió hora (la app propone las 09:00).
-- No se cambia save_profile: su firma la usan las versiones de la app ya instaladas.

alter table public.profiles add column reminder_time time(0);

create function public.save_reminder_time(p_time time) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin
 if p_time is null then raise exception 'Elige una hora para el recordatorio.';end if;
 update public.profiles set reminder_time=date_trunc('minute',p_time)::time(0),updated_at=now() where user_id=u;
end $$;

revoke all on function public.save_reminder_time(time) from public,anon;
grant execute on function public.save_reminder_time(time) to authenticated;
