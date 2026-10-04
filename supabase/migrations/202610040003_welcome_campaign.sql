-- La fecha se fija una sola vez al aplicar esta migración, nunca al abrir la web.
create table private.billing_campaign (
 id text primary key check(id='welcome'),
 enabled boolean not null default true,
 starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at>starts_at)
);
insert into private.billing_campaign(id,starts_at,ends_at)
 values('welcome',now(),now()+interval '168 hours') on conflict(id) do nothing;
revoke all on private.billing_campaign from public,anon,authenticated,service_role;

-- Haber pagado antes también agota el derecho de bienvenida, aunque fuera a precio regular.
alter table private.billing_accounts add column first_paid_at timestamptz;
insert into private.billing_accounts(user_id,environment,first_paid_at)
 select user_id,environment,min(confirmed_at) from public.payment_orders where status='approved'
 group by user_id,environment
 on conflict(user_id,environment) do update set first_paid_at=coalesce(private.billing_accounts.first_paid_at,excluded.first_paid_at);

-- Inscribir no cobra, pero el usuario ya autorizó un importe: debe conservarse.
alter table private.billing_enrollments add column amount_clp integer check(amount_clp is null or amount_clp>0);
alter table private.billing_enrollments add column promo_applied boolean not null default false;
update private.billing_enrollments enrollment set
 amount_clp=case when not exists(select 1 from private.billing_accounts account where account.user_id=enrollment.user_id and account.environment=enrollment.environment
  and coalesce(account.first_paid_at,account.promotion_used_at)<=enrollment.created_at) then plan.first_month_clp else plan.price_clp end,
 promo_applied=not exists(select 1 from private.billing_accounts account where account.user_id=enrollment.user_id and account.environment=enrollment.environment
  and coalesce(account.first_paid_at,account.promotion_used_at)<=enrollment.created_at)
 from public.plan_catalog plan where enrollment.purpose='checkout' and enrollment.plan_id=plan.id;

create function public.billing_promotion() returns jsonb
language sql security definer stable set search_path='' as $$
 select jsonb_build_object('starts_at',campaign.starts_at,'ends_at',campaign.ends_at,'server_now',now(),
  'active',coalesce(campaign.enabled and campaign.starts_at<=now() and now()<campaign.ends_at,false))
 from (select true) singleton left join private.billing_campaign campaign on campaign.id='welcome'
$$;
create function private.billing_welcome_available(p_user uuid,p_environment text) returns boolean
language sql stable set search_path='' as $$
 select coalesce((public.billing_promotion()->>'active')::boolean,false) and not exists(
  select 1 from private.billing_accounts where user_id=p_user and environment=p_environment
   and (first_paid_at is not null or promotion_used_at is not null))
$$;
create function private.billing_expected_amount(p_payload jsonb,p_amount integer) returns void
language plpgsql set search_path='' as $$
begin
 if p_payload ? 'expected_amount_clp' then
  if jsonb_typeof(p_payload->'expected_amount_clp') is distinct from 'number' or
   (p_payload->>'expected_amount_clp')::numeric is distinct from p_amount::numeric then
   raise exception 'El precio cambió. Revisa el importe actualizado antes de continuar.' using errcode='P0001';
  end if;
 end if;
end $$;

-- Los núcleos ya desplegados conservan períodos, bloqueos, estados y reglas financieras.
alter function public.billing_state() set schema private;
alter function private.billing_state() rename to billing_state_base;
alter function public.billing_admin(text,jsonb) set schema private;
alter function private.billing_admin(text,jsonb) rename to billing_admin_base;
revoke all on function private.billing_state_base(),private.billing_admin_base(text,jsonb)
 from public,anon,authenticated,service_role;

create function public.billing_state() returns jsonb
language plpgsql security definer stable set search_path='' as $$
declare result jsonb; campaign jsonb:=public.billing_promotion(); u uuid:=private.require_user(); env text;
begin
 result:=private.billing_state_base();env:=result->'settings'->>'environment';
 return result||jsonb_build_object('promotion',campaign,'promotion_available',private.billing_welcome_available(u,env));
end $$;

create function public.billing_admin(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=nullif(p_payload->>'user_id','')::uuid;
 env text:=coalesce(p_payload->>'environment','integration');
 pid text:=p_payload->>'plan_id'; rid uuid:=nullif(p_payload->>'request_id','')::uuid;
 result jsonb; plan public.plan_catalog; existing public.payment_orders;
 enrollment private.billing_enrollments; sub public.subscriptions;
 pinned_amount integer; promo boolean; existing_id uuid; campaign jsonb:=public.billing_promotion();
begin
 if p_action not in ('quote','create_order','create_renewal','enroll_create') then
  result:=private.billing_admin_base(p_action,p_payload);
  if p_action='confirm_order' and result->>'status'='approved' then
   update private.billing_accounts set first_paid_at=coalesce(first_paid_at,(result->>'confirmed_at')::timestamptz,now())
    where user_id=(result->>'user_id')::uuid and environment=result->>'environment';
  end if;
  return result;
 end if;
 if env is distinct from (select environment from private.billing_settings where id) then
  raise exception 'La configuración del ambiente de pagos no coincide.';
 end if;
 perform 1 from public.pets where user_id=u for update;
 if not found then raise exception 'Usuario no encontrado.';end if;

 if p_action='quote' and coalesce((p_payload->>'for_change')::boolean,false) then
  return private.billing_admin_base(p_action,p_payload)||jsonb_build_object('promotion',campaign);
 end if;
 if p_action='create_renewal' then
  select * into sub from public.subscriptions where user_id=u and environment=env;
  if not found then return private.billing_admin_base(p_action,p_payload);end if;
  pid:=coalesce(sub.next_plan_id,sub.plan_id);
 end if;
 if p_action='enroll_create' and p_payload->>'purpose'='update_card' then
  perform private.billing_expected_amount(p_payload,0);
  return private.billing_admin_base(p_action,p_payload);
 end if;
 select * into plan from public.plan_catalog where id=pid and enabled and price_clp>0;
 if not found then return private.billing_admin_base(p_action,p_payload);end if;

 -- Las órdenes abiertas y las solicitudes repetidas mantienen su precio original.
 if p_action in ('quote','create_order','create_renewal') then
  if rid is not null then
   select * into existing from public.payment_orders where user_id=u and environment=env and request_id=rid;
  end if;
  if existing.id is null then
   select * into existing from public.payment_orders where user_id=u and environment=env and status in ('created','pending','processing','unknown');
  end if;
  if existing.id is null and p_action='create_renewal' then
   select * into existing from public.payment_orders where user_id=u and environment=env and renewal and renewal_cycle_end=sub.period_end;
  end if;
  existing_id:=existing.id;
 end if;
 if p_action='enroll_create' then
  select * into enrollment from private.billing_enrollments where user_id=u and environment=env and status in ('created','pending','processing','unknown');
  if enrollment.id is not null and (enrollment.plan_id is distinct from pid or enrollment.purpose is distinct from p_payload->>'purpose') then
   raise exception 'Ya tienes una inscripción pendiente. Revisa su estado antes de cambiar de plan.';
  end if;
 elsif p_action='create_order' and p_payload->>'channel'='oneclick' and rid is not null and existing_id is null then
  select * into enrollment from private.billing_enrollments where id=rid and user_id=u and environment=env and purpose='checkout';
  if found and (enrollment.status<>'enrolled' or enrollment.plan_id<>pid) then raise exception 'La inscripción no corresponde a esta contratación.';end if;
 elsif p_action='quote' and p_payload->>'channel'='oneclick' and existing_id is null then
  select frozen_row.* into enrollment from private.billing_enrollments frozen_row where frozen_row.user_id=u and frozen_row.environment=env and frozen_row.plan_id=pid and frozen_row.purpose='checkout'
   and frozen_row.status in ('created','pending','processing','unknown')
   and not exists(select 1 from public.payment_orders where user_id=u and environment=env and request_id=frozen_row.id)
   and not exists(select 1 from private.billing_accounts where user_id=u and environment=env and recurring_revoked_at>=frozen_row.created_at)
   order by frozen_row.created_at desc limit 1;
 end if;

 if existing_id is not null then
  pinned_amount:=existing.amount;promo:=existing.promo_applied;
 elsif enrollment.id is not null and enrollment.amount_clp is not null then
  pinned_amount:=enrollment.amount_clp;promo:=enrollment.promo_applied;
  if promo and exists(select 1 from private.billing_accounts where user_id=u and environment=env and (first_paid_at is not null or promotion_used_at is not null)) then
   raise exception 'La bienvenida ya se aplicó a otro pago. Revisa el precio y autoriza una nueva contratación.';
  end if;
 else
  promo:=private.billing_welcome_available(u,env);
  pinned_amount:=case when promo then plan.first_month_clp else plan.price_clp end;
 end if;
 perform private.billing_expected_amount(p_payload,pinned_amount);
 result:=private.billing_admin_base(p_action,p_payload);
 if result is null then return null;end if;

 if p_action='quote' then
  return result||jsonb_build_object('amount_clp',pinned_amount,'promotion_applied',promo,'promotion',campaign);
 elsif p_action='enroll_create' then
  if enrollment.id is null then
   update private.billing_enrollments set amount_clp=pinned_amount,promo_applied=promo where id=(result->>'id')::uuid returning * into enrollment;
   result:=to_jsonb(enrollment);
  end if;
  return result;
 elsif existing_id is null or existing_id is distinct from (result->>'id')::uuid then
  -- Sólo una orden recién creada: nunca se reprecifica una reserva ya entregada.
  update public.payment_orders set amount=pinned_amount,promo_applied=promo where id=(result->>'id')::uuid and status='created' and attempts=0;
  return private.billing_order_json((result->>'id')::uuid);
 end if;
 return result;
end $$;

revoke all on function public.billing_promotion() from public;
grant execute on function public.billing_promotion() to anon,authenticated,service_role;
revoke all on function public.billing_state() from public,anon;
grant execute on function public.billing_state() to authenticated;
revoke all on function public.billing_admin(text,jsonb) from public,anon,authenticated;
grant execute on function public.billing_admin(text,jsonb) to service_role;
revoke all on all functions in schema private from public,anon,authenticated,service_role;
