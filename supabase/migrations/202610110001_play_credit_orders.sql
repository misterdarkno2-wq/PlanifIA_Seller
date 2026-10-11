-- Créditos del plan de Google Play: cada pago (orden nueva) abre un mes de créditos.
-- Antes la ventana avanzaba sola cada mes desde que se registró la compra: si la compra se
-- restauraba tarde, la renovación pagada no reiniciaba el saldo, y en el período de gracia
-- (pago fallido) el calendario entregaba 1.000 créditos de un mes sin pagar. Durante la gracia se
-- mantiene el acceso al plan (lo exige Google Play), pero los créditos esperan el pago.

-- ¿El plan vigente proviene sólo de Google Play? Las suscripciones web conservan la ventana mensual.
create function private.plan_from_play_only(p_user uuid,p_plan text) returns boolean
language sql stable set search_path='' as $$
 select exists(
   select 1 from private.play_subscriptions g join private.play_products pp using(product_id)
    where g.user_id=p_user and pp.plan_id=p_plan and g.expiry_time>now()
    and g.state in ('SUBSCRIPTION_STATE_ACTIVE','SUBSCRIPTION_STATE_CANCELED','SUBSCRIPTION_STATE_IN_GRACE_PERIOD'))
  and not exists(
   select 1 from public.subscription_periods s where s.user_id=p_user and s.plan_id=p_plan
    and s.environment=(select environment from private.billing_settings where id)
    and s.starts_at<=now() and s.ends_at>now())
$$;

create or replace function private.credit_snapshot(p_user uuid,p_persist boolean default false) returns jsonb
language plpgsql set search_path='' as $$
declare a private.credit_accounts; p public.plan_catalog; ws timestamptz; used integer; allowance integer;
begin
 select * into a from private.credit_accounts where user_id=p_user;
 if not found then raise exception 'Cuenta de créditos no disponible.'; end if;
 p:=private.effective_plan(p_user);
 allowance:=p.monthly_credits; ws:=a.window_start; used:=a.plan_used;
 if allowance>0 then
  if ws is null then ws:=now(); used:=0;
  -- Google Play: el mes siguiente lo abre play_apply_subscription al llegar la orden pagada.
  elsif private.plan_from_play_only(p_user,p.id) then null;
  elsif now()>=ws+interval '2 months' then ws:=now(); used:=0;
  elsif now()>=ws+interval '1 month' then ws:=ws+interval '1 month'; used:=0;
  end if;
  if p_persist and (ws is distinct from a.window_start or used<>a.plan_used) then
   update private.credit_accounts set window_start=ws,plan_used=used,updated_at=now() where user_id=p_user;
  end if;
 end if;
 return jsonb_build_object('plan_id',p.id,'plan_name',p.name,'plan_allowance',allowance,
  'plan_available',case when allowance>0 then greatest(0,allowance-used) else 0 end,
  'bonus',a.bonus,
  'balance',a.bonus+case when allowance>0 then greatest(0,allowance-used) else 0 end,
  'window_start',case when allowance>0 then ws end,
  'renews_at',case when allowance>0 then ws+interval '1 month' end);
end $$;

create or replace function public.play_apply_subscription(p_user uuid,p_token text,p_product text,p_state text,p_expiry timestamptz,
 p_auto_renewing boolean,p_order text,p_linked text,p_test boolean,p_raw jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous private.play_subscriptions; owner uuid; current boolean;
begin
 if not exists(select 1 from private.play_products where product_id=p_product and kind='subscription') then
  raise exception 'Producto de suscripción desconocido.' using errcode='P0001';
 end if;
 select * into previous from private.play_subscriptions where purchase_token=p_token for update;
 if found and previous.user_id<>p_user then raise exception 'Esta compra pertenece a otra cuenta de PlanifIA.' using errcode='P0001'; end if;
 if p_linked is not null then
  select user_id into owner from private.play_subscriptions where purchase_token=p_linked;
  if found and owner<>p_user then raise exception 'Esta compra pertenece a otra cuenta de PlanifIA.' using errcode='P0001'; end if;
  -- El token reemplazado deja de dar acceso aunque Google tarde en informarlo.
  update private.play_subscriptions set state='SUBSCRIPTION_STATE_EXPIRED',expiry_time=least(expiry_time,now()),updated_at=now()
   where purchase_token=p_linked;
 end if;
 insert into private.play_subscriptions(purchase_token,user_id,product_id,state,expiry_time,auto_renewing,latest_order_id,linked_purchase_token,test_purchase,raw)
  values(p_token,p_user,p_product,p_state,p_expiry,coalesce(p_auto_renewing,false),p_order,p_linked,coalesce(p_test,false),coalesce(p_raw,'{}'))
  on conflict(purchase_token) do update set state=excluded.state,expiry_time=excluded.expiry_time,auto_renewing=excluded.auto_renewing,
   latest_order_id=excluded.latest_order_id,linked_purchase_token=excluded.linked_purchase_token,test_purchase=excluded.test_purchase,
   raw=excluded.raw,updated_at=now();
 current:=p_expiry>now() and p_state in ('SUBSCRIPTION_STATE_ACTIVE','SUBSCRIPTION_STATE_CANCELED','SUBSCRIPTION_STATE_IN_GRACE_PERIOD');
 if previous.purchase_token is null and current then
  perform private.credit_start_window(p_user);
 -- Renovación pagada: Google informa una orden exitosa nueva (latestSuccessfulOrderId). Repetir la
 -- misma orden (restaurar, notificaciones duplicadas, período de gracia) no entrega otro mes.
 elsif previous.purchase_token is not null and current and p_order is not null
  and p_order is distinct from previous.latest_order_id then
  perform private.ensure_credit_account(p_user);
  perform 1 from private.credit_accounts where user_id=p_user for update;
  update private.credit_accounts set window_start=now(),plan_used=0,updated_at=now() where user_id=p_user;
 end if;
 return jsonb_build_object('plan',(select id from private.effective_plan(p_user)));
end $$;

revoke all on function private.plan_from_play_only(uuid,text) from public,anon,authenticated;
