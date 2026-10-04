-- Una renovación cerrada vuelve a requerir una acción del usuario.
-- Un resultado incierto conserva su reserva y nunca entra en esta regla.
create function private.close_renewal_authorization() returns trigger
language plpgsql security definer set search_path='' as $$
declare terminal boolean;
begin
 if not new.renewal then return new; end if;
 terminal := (new.status='rejected' and new.attempts>=(select max_attempts from private.billing_settings where id))
  or (new.status='cancelled' and not exists(
   select 1 from private.payment_provider where order_id=new.id and charge_started_at is not null));
 if not terminal then return new; end if;
 perform 1 from public.pets where user_id=new.user_id for update;
 update public.subscriptions set auto_renew=false,cancel_at_period_end=true,
  cancelled_at=now(),status='past_due',updated_at=now()
  where user_id=new.user_id and environment=new.environment and auto_renew
   and period_end=new.renewal_cycle_end;
 if found then
  insert into private.billing_accounts(user_id,environment,recurring_revoked_at)
   values(new.user_id,new.environment,now())
   on conflict(user_id,environment) do update set recurring_revoked_at=now();
  perform private.billing_consent_event(new.user_id,new.environment,'cancel',false,
   jsonb_build_object('order_id',new.id,'reason',case when new.status='rejected' then 'retries_exhausted' else 'renewal_cancelled_before_charge' end));
 end if;
 return new;
end $$;
create trigger planifia_closed_renewal after update of status on public.payment_orders
 for each row when(new.renewal and new.status in ('cancelled','rejected'))
 execute function private.close_renewal_authorization();
revoke all on function private.close_renewal_authorization() from public,anon,authenticated;
