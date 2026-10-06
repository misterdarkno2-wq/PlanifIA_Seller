-- Eliminación de cuenta solicitada por la propia persona (requisito de Google Play).
-- Todas las tablas de usuario referencian auth.users con on delete cascade,
-- por lo que borrar la fila de auth elimina metas, acciones, hábitos, Lumi, cola de IA,
-- importaciones, uso y registros de suscripción de esa cuenta en una sola transacción.
create function public.delete_my_account(p_confirm text) returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid();
begin
 if u is null then raise exception 'Inicia sesión.'; end if;
 if p_confirm is distinct from 'ELIMINAR' then
  raise exception 'Escribe ELIMINAR para confirmar.';
 end if;
 -- Detiene cualquier generación pendiente antes de borrar la cuenta.
 update public.ai_jobs set cancel_requested=true,updated_at=now()
  where user_id=u and status in ('queued','processing');
 delete from auth.users where id=u;
 return found;
end $$;
revoke all on function public.delete_my_account(text) from public,anon;
grant execute on function public.delete_my_account(text) to authenticated;
