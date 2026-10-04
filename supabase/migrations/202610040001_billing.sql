-- Importes CLP enteros. Las referencias de Transbank nunca se exponen por REST.
create table public.plan_catalog (
 id text primary key check(id in ('free','plus','pro')),
 name text not null, price_clp integer not null check(price_clp>=0),
 first_month_clp integer not null check(first_month_clp>=0 and first_month_clp<=price_clp),
 max_active_goals integer not null check(max_active_goals>0),
 ai_generations integer not null check(ai_generations>=0), ai_adjustments integer not null check(ai_adjustments>=0),
 benefits jsonb not null default '[]' check(jsonb_typeof(benefits)='array'),
 enabled boolean not null default true, position integer not null default 0
);
insert into public.plan_catalog values
 ('free','Gratis',0,0,3,3,1,'["Calendario y hábitos","Lumi y progreso de tus metas"]',true,0),
 ('plus','Plus',2750,990,15,30,15,'["Calendario y hábitos","Lumi y progreso de tus metas"]',true,1),
 ('pro','Pro',4990,1990,50,100,50,'["Calendario y hábitos","Lumi y progreso de tus metas"]',true,2);
alter table public.plan_catalog enable row level security;
create policy plans_read on public.plan_catalog for select to anon,authenticated using(enabled);
revoke all on public.plan_catalog from public,anon,authenticated;
grant select on public.plan_catalog to anon,authenticated;

create table private.billing_accounts (
 user_id uuid not null references auth.users(id) on delete cascade,
 environment text not null check(environment in ('integration','production')),
 promotion_used_at timestamptz, promotion_order_id uuid, recurring_revoked_at timestamptz, primary key(user_id,environment)
);
create table private.billing_settings (
 id boolean primary key default true check(id),
 environment text not null default 'integration' check(environment in ('integration','production')),
 max_attempts integer not null default 3 check(max_attempts between 1 and 5),
 retry_delay_hours integer not null default 24 check(retry_delay_hours between 1 and 168),
 renewal_grace_hours integer not null default 72 check(renewal_grace_hours between 1 and 168)
);
insert into private.billing_settings(id) values(true);
create table public.subscriptions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 environment text not null check(environment in ('integration','production')),
 plan_id text not null references public.plan_catalog(id), next_plan_id text references public.plan_catalog(id),
 status text not null check(status in ('active','past_due','cancelled')),
 channel text not null check(channel in ('webpay','oneclick')),
 period_start timestamptz not null, period_end timestamptz not null check(period_end>period_start),
 anchor_day integer not null check(anchor_day between 1 and 31),
 auto_renew boolean not null default false, cancel_at_period_end boolean not null default false,
 recurring_consent_at timestamptz, cancelled_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(not auto_renew or (channel='oneclick' and recurring_consent_at is not null and not cancel_at_period_end))
);
create table public.payment_orders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 environment text not null check(environment in ('integration','production')),
 request_id uuid, plan_id text not null references public.plan_catalog(id),
 buy_order text not null unique, session_id text not null,
 amount integer not null check(amount>0), promo_applied boolean not null,
 channel text not null check(channel in ('webpay','oneclick')),
 status text not null default 'created' check(status in ('created','pending','processing','unknown','approved','rejected','cancelled','abandoned')),
 period_start timestamptz not null, period_end timestamptz not null check(period_end>period_start),
 anchor_day integer not null check(anchor_day between 1 and 31), renewal boolean not null default false,
 renewal_cycle_end timestamptz,
 recurring_consent boolean not null default false,
 attempts integer not null default 0 check(attempts>=0), retry_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 confirmed_at timestamptz, unique(user_id,request_id), check(not renewal or renewal_cycle_end is not null)
);
create unique index billing_one_open_checkout on public.payment_orders(user_id,environment)
 where status in ('created','pending','processing','unknown');
create unique index billing_one_renewal_period on public.payment_orders(user_id,environment,renewal_cycle_end) where renewal;
create table public.subscription_periods (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 environment text not null check(environment in ('integration','production')),
 order_id uuid not null unique references public.payment_orders(id), plan_id text not null references public.plan_catalog(id),
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 amount integer not null check(amount>0), promo_applied boolean not null,
 created_at timestamptz not null default now(), unique(user_id,environment,starts_at)
);
create table private.payment_provider (
 order_id uuid primary key references public.payment_orders(id) on delete cascade,
 provider_token text unique, provider_url text, provider_result jsonb,
 lease_until timestamptz, charge_started_at timestamptz
);
create table private.payment_attempts (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.payment_orders(id) on delete cascade,
 buy_order text not null,
 attempt_number integer not null, started_at timestamptz not null default now(),
 finished_at timestamptz, outcome text, provider_result jsonb, unique(order_id,attempt_number)
);
create table private.billing_methods (
 user_id uuid primary key references auth.users(id) on delete cascade,
 environment text not null check(environment in ('integration','production')),
 tbk_user text not null, username text not null, card_type text, last4 text check(last4 is null or last4 ~ '^[0-9]{4}$'),
 active boolean not null default true, consent_at timestamptz not null,
 updated_at timestamptz not null default now()
);
create table private.billing_enrollments (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 environment text not null check(environment in ('integration','production')),
 plan_id text references public.plan_catalog(id), purpose text not null check(purpose in ('checkout','update_card')),
 username text not null, email text, recurring_consent boolean not null check(recurring_consent),
 status text not null default 'created' check(status in ('created','pending','processing','unknown','enrolled','rejected','cancelled')),
 provider_token text unique, provider_url text, lease_until timestamptz,
 provider_result jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index billing_one_open_enrollment on private.billing_enrollments(user_id,environment)
 where status in ('created','pending','processing','unknown');
create table private.plan_ai_usage (
 user_id uuid not null references auth.users(id) on delete cascade, month date not null,
 generations integer not null default 0 check(generations>=0), adjustments integer not null default 0 check(adjustments>=0),
 primary key(user_id,month)
);
create table private.billing_consent_events (
 id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade,
 environment text not null check(environment in ('integration','production')),
 event text not null check(event in ('checkout','enroll','cancel','resume','remove_method','save_method','change_free','renewal_grace_expired')),
 accepted boolean not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['subscriptions','payment_orders','subscription_periods'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy billing_own_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create index billing_due on public.subscriptions(period_end) where auto_renew;
create index billing_orders_owner on public.payment_orders(user_id,created_at desc);

-- Conserva el día de origen: 31 enero -> 28 febrero -> 31 marzo, siempre UTC.
create function private.billing_month_end(p_start timestamptz,p_anchor integer) returns timestamptz
language sql immutable set search_path='' as $$
 select (date_trunc('month',p_start at time zone 'UTC')+interval '1 month'
  +(least(p_anchor,extract(day from date_trunc('month',p_start at time zone 'UTC')+interval '2 months'-interval '1 day')::integer)-1)*interval '1 day'
  +((p_start at time zone 'UTC')::time- time '00:00')) at time zone 'UTC'
$$;
create function private.effective_plan(p_user uuid) returns public.plan_catalog
language sql stable set search_path='' as $$
 select p.* from public.plan_catalog p where p.id=coalesce(
  (select s.plan_id from public.subscription_periods s where s.user_id=p_user and s.environment=(select environment from private.billing_settings where id)
   and s.starts_at<=now() and s.ends_at>now() order by s.starts_at desc limit 1),'free')
$$;
create function private.billing_order_json(p_order uuid) returns jsonb
language sql stable set search_path='' as $$
 select to_jsonb(o)||jsonb_build_object('provider_token',p.provider_token,'provider_url',p.provider_url,
  'provider_result',p.provider_result,'lease_until',p.lease_until,'charge_started_at',p.charge_started_at,
  'attempted',p.charge_started_at is not null)
 from public.payment_orders o left join private.payment_provider p on p.order_id=o.id where o.id=p_order
$$;
create function private.billing_consent_event(p_user uuid,p_environment text,p_event text,p_accepted boolean,p_details jsonb default '{}') returns void
language sql set search_path='' as $$
 insert into private.billing_consent_events(user_id,environment,event,accepted,details) values(p_user,p_environment,p_event,p_accepted,p_details)
$$;
create function public.billing_state() returns jsonb language plpgsql security definer stable set search_path='' as $$
declare u uuid:=private.require_user(); p public.plan_catalog; s public.subscriptions;
 m date:=(date_trunc('month',now() at time zone 'UTC'))::date; n private.plan_ai_usage; a integer; next_plan public.plan_catalog;
 current_period public.subscription_periods;
 last_period public.subscription_periods;
begin
 select * into p from private.effective_plan(u); select * into s from public.subscriptions where user_id=u and environment=(select environment from private.billing_settings where id);
 select * into next_plan from public.plan_catalog where id=coalesce(s.next_plan_id,s.plan_id,'free');
 select * into current_period from public.subscription_periods where user_id=u and environment=(select environment from private.billing_settings where id)
  and starts_at<=now() and ends_at>now() order by starts_at desc limit 1;
 select * into last_period from public.subscription_periods where user_id=u and environment=(select environment from private.billing_settings where id)
  order by ends_at desc limit 1;
 select * into n from private.plan_ai_usage where user_id=u and month=m;
 select count(*) into a from public.goals where user_id=u and status='active';
 return jsonb_build_object(
  'plans',(select coalesce(jsonb_agg(to_jsonb(c) order by position),'[]') from public.plan_catalog c where enabled),
  'effective_plan',to_jsonb(p),
  'subscription',case when s.user_id is null then null else to_jsonb(s)||jsonb_build_object(
   'plan_id',coalesce(current_period.plan_id,last_period.plan_id,s.plan_id),
   'period_start',coalesce(current_period.starts_at,last_period.starts_at,s.period_start),
   'period_end',coalesce(current_period.ends_at,last_period.ends_at,s.period_end),
   'paid_until',s.period_end,'next_date',s.period_end,
   'renewal_grace_until',s.period_end+(select renewal_grace_hours from private.billing_settings where id)*interval '1 hour',
   'next_retry_at',case when s.auto_renew then (select retry_at from public.payment_orders where user_id=u and environment=s.environment
    and renewal and renewal_cycle_end=s.period_end and status='rejected' and attempts<(select max_attempts from private.billing_settings where id) order by created_at desc limit 1) else null end,
   'next_plan_id',case when s.next_plan_id=p.id then null else s.next_plan_id end,
   'access_active',current_period.id is not null,'effective_status',case when current_period.id is null then 'expired' else s.status end,
   'next_amount',next_plan.price_clp,'next_plan',to_jsonb(next_plan),
   'payment_method',(select jsonb_build_object('card_type',card_type,'last4',last4,'active',active) from private.billing_methods where user_id=u and environment=(select environment from private.billing_settings where id))) end,
  'usage',jsonb_build_object('month',m,'reset_at',(m+interval '1 month') at time zone 'UTC',
   'generations',coalesce(n.generations,0),'adjustments',coalesce(n.adjustments,0),
   'generation_limit',p.ai_generations,'adjustment_limit',p.ai_adjustments,'active_goals',a,'max_active_goals',p.max_active_goals),
  'promotion_available',not exists(select 1 from private.billing_accounts where user_id=u and environment=(select environment from private.billing_settings where id) and promotion_used_at is not null),
  'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from
   (select * from public.payment_orders where user_id=u order by created_at desc limit 50) x),
  'pending_order',(select to_jsonb(o) from public.payment_orders o where user_id=u and environment=(select environment from private.billing_settings where id) and status in ('created','pending','processing','unknown') limit 1),
  'pending_enrollment',(select jsonb_build_object('id',id,'status',status,'purpose',purpose,'plan_id',plan_id,'created_at',created_at)
   from private.billing_enrollments where user_id=u and environment=(select environment from private.billing_settings where id) and status in ('created','pending','processing','unknown') limit 1),
  'settings',jsonb_build_object('currency','CLP','usage_timezone','UTC','environment',(select environment from private.billing_settings where id),
   'retry_max_attempts',(select max_attempts from private.billing_settings where id),'renewal_grace_hours',(select renewal_grace_hours from private.billing_settings where id))
 );
end $$;
create function public.manage_subscription(p_action text,p_plan_id text default null,p_recurring_consent boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); s public.subscriptions;
begin
 perform 1 from public.pets where user_id=u for update;
 select * into s from public.subscriptions where user_id=u and environment=(select environment from private.billing_settings where id) for update;
 if not found then raise exception 'No tienes una suscripción pagada.';end if;
 if p_action='cancel' then
  update public.subscriptions set auto_renew=false,cancel_at_period_end=true,cancelled_at=now(),updated_at=now() where user_id=u;
  insert into private.billing_accounts(user_id,environment,recurring_revoked_at) values(u,s.environment,now())
   on conflict(user_id,environment) do update set recurring_revoked_at=now();
  perform private.billing_consent_event(u,s.environment,'cancel',false);
 elsif p_action='resume' then
  if p_recurring_consent is distinct from true then raise exception 'Acepta expresamente los cobros recurrentes para reanudar.';end if;
  if s.channel<>'oneclick' or s.recurring_consent_at is null or s.period_end<=now() or not exists(select 1 from private.billing_methods where user_id=u and active and environment=s.environment) then
   raise exception 'Actualiza y autoriza el medio de pago para renovar automáticamente.';end if;
  update public.subscriptions set auto_renew=true,cancel_at_period_end=false,cancelled_at=null,recurring_consent_at=now(),updated_at=now() where user_id=u;
  update private.billing_methods set consent_at=now(),updated_at=now() where user_id=u and environment=s.environment and active;
  update private.billing_accounts set recurring_revoked_at=null where user_id=u and environment=s.environment;
  perform private.billing_consent_event(u,s.environment,'resume',true,jsonb_build_object('plan_id',coalesce(s.next_plan_id,s.plan_id)));
 elsif p_action='change_plan' then
  if not exists(select 1 from public.plan_catalog where id=p_plan_id and enabled) then raise exception 'Plan no disponible.';end if;
  update public.subscriptions set next_plan_id=p_plan_id,
   auto_renew=case when p_plan_id='free' then false else auto_renew end,
   cancel_at_period_end=case when p_plan_id='free' then true else cancel_at_period_end end,
   cancelled_at=case when p_plan_id='free' then now() else cancelled_at end,updated_at=now() where user_id=u;
  if p_plan_id='free' then
   insert into private.billing_accounts(user_id,environment,recurring_revoked_at) values(u,s.environment,now())
    on conflict(user_id,environment) do update set recurring_revoked_at=now();
   perform private.billing_consent_event(u,s.environment,'change_free',false);
  end if;
 else raise exception 'Operación no válida.';end if;
 return public.billing_state();
end $$;

create function public.reserve_plan_ai(p_user_id uuid,p_kind text) returns boolean
language plpgsql security definer set search_path='' as $$
declare p public.plan_catalog; m date:=(date_trunc('month',now() at time zone 'UTC'))::date; counted integer;
begin
 if p_kind not in ('generation','adjustment') or p_kind is null then raise exception 'Uso de IA inválido.';end if;
 perform 1 from public.pets where user_id=p_user_id for update;
 if not found then raise exception 'Usuario no encontrado.';end if;
 select * into p from private.effective_plan(p_user_id);
 if p_kind='generation' and (select count(*) from public.goals where user_id=p_user_id and status='active')>=p.max_active_goals then return false;end if;
 if p_kind='generation' then
  insert into private.plan_ai_usage(user_id,month,generations) select p_user_id,m,1 where p.ai_generations>0
   on conflict(user_id,month) do update set generations=private.plan_ai_usage.generations+1
   where private.plan_ai_usage.generations<p.ai_generations returning generations into counted;
 else
  insert into private.plan_ai_usage(user_id,month,adjustments) select p_user_id,m,1 where p.ai_adjustments>0
   on conflict(user_id,month) do update set adjustments=private.plan_ai_usage.adjustments+1
   where private.plan_ai_usage.adjustments<p.ai_adjustments returning adjustments into counted;
 end if;
 return counted is not null;
end $$;
-- El trigger cubre RPC, importaciones futuras y reactivaciones, sin borrar metas previas.
create function private.enforce_goal_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.plan_catalog; n integer;
begin
 if new.status<>'active' then return new;end if;
 if tg_op='UPDATE' and old.status='active' and old.user_id=new.user_id then return new;end if;
 perform 1 from public.pets where user_id=new.user_id for update;
 select * into p from private.effective_plan(new.user_id);
 select count(*) into n from public.goals where user_id=new.user_id and status='active' and id<>new.id;
 if n>=p.max_active_goals then raise exception 'Tu plan permite % metas activas. Puedes consultar tus datos y pausar una meta para activar otra.',p.max_active_goals using errcode='P0001';end if;
 return new;
end $$;
create trigger planifia_goal_plan_limit before insert or update of status,user_id on public.goals for each row execute function private.enforce_goal_limit();

create function public.billing_admin(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=nullif(p_payload->>'user_id','')::uuid; oid uuid:=nullif(p_payload->>'order_id','')::uuid;
 o public.payment_orders; s public.subscriptions; p public.plan_catalog; b private.billing_accounts;
 ref private.payment_provider; cfg private.billing_settings; e private.billing_enrollments;
 start_at timestamptz; end_at timestamptz; anchor integer; price integer; promo boolean; result jsonb;
 pid text:=p_payload->>'plan_id'; ch text:=p_payload->>'channel'; consent boolean:=coalesce((p_payload->>'recurring_consent')::boolean,false);
 env text:=coalesce(p_payload->>'environment','integration');
 renewal boolean:=p_action='create_renewal'; lease boolean; status_value text; enr uuid:=nullif(p_payload->>'enrollment_id','')::uuid;
 authorized boolean;
begin
 select * into cfg from private.billing_settings where id;
 if p_action='configure_environment' then
  if env not in ('integration','production') then raise exception 'Ambiente inválido.';end if;
  update private.billing_settings set environment=env where id;return jsonb_build_object('environment',env);
 end if;
 if env<>cfg.environment then raise exception 'La configuración del ambiente de pagos no coincide.';end if;
 if p_action='quote' and coalesce((p_payload->>'for_change')::boolean,false) then
  perform 1 from public.pets where user_id=u for update;
  if not found then raise exception 'Usuario no encontrado.';end if;
  select * into s from public.subscriptions where user_id=u and environment=env for update;
  if not found or s.period_end<=now() then raise exception 'No tienes un período vigente para programar este cambio.';end if;
  select * into p from public.plan_catalog where id=pid and enabled;
  if not found then raise exception 'Plan no disponible.';end if;
  return jsonb_build_object('plan_id',pid,'amount_clp',p.price_clp,'promotion_applied',false,'regular_price_clp',p.price_clp,
   'period_start',s.period_end,'period_end',private.billing_month_end(s.period_end,s.anchor_day),'channel',s.channel,
   'next_amount_clp',p.price_clp,'next_date',s.period_end,'recurring_consent_required',false,'environment',env,'for_change',true);
 end if;
 if p_action in ('create_order','create_renewal','quote') then
  perform 1 from public.pets where user_id=u for update;
  if not found then raise exception 'Usuario no encontrado.';end if;
  insert into private.billing_accounts(user_id,environment) values(u,env) on conflict do nothing;
  select * into b from private.billing_accounts where user_id=u and environment=env for update;
  select * into s from public.subscriptions where user_id=u and environment=env for update;
  if renewal then
   if s.user_id is null or not s.auto_renew or s.cancel_at_period_end or s.channel<>'oneclick' or s.period_end>now() or
    not exists(select 1 from private.billing_methods where user_id=u and active and environment=env) then return null;end if;
   if s.period_end<now()-cfg.renewal_grace_hours*interval '1 hour' then
    update public.subscriptions set auto_renew=false,cancel_at_period_end=true,cancelled_at=now(),status='past_due',updated_at=now() where user_id=u;
    update private.billing_accounts set recurring_revoked_at=now() where user_id=u and environment=env;
    perform private.billing_consent_event(u,env,'renewal_grace_expired',false,jsonb_build_object('cycle_end',s.period_end));return null;end if;
   pid:=coalesce(s.next_plan_id,s.plan_id);ch:='oneclick';consent:=true;
   if pid='free' then return null;end if;
  elsif nullif(p_payload->>'request_id','') is not null then
   select * into o from public.payment_orders where user_id=u and environment=env and request_id=(p_payload->>'request_id')::uuid;
   if found then
    if o.plan_id is distinct from pid or o.channel is distinct from ch then raise exception 'La solicitud pertenece a otra contratación.';end if;
    return private.billing_order_json(o.id);
   end if;
  end if;
  select * into o from public.payment_orders where user_id=u and environment=env and status in ('created','pending','processing','unknown');
  if found then
   if o.plan_id<>pid or o.channel<>ch then raise exception 'Ya tienes un pago pendiente de verificación.';end if;
   if p_action='quote' then
    select * into p from public.plan_catalog where id=o.plan_id;
    return jsonb_build_object('plan_id',o.plan_id,'amount_clp',o.amount,'promotion_applied',o.promo_applied,
     'regular_price_clp',p.price_clp,'period_start',o.period_start,'period_end',o.period_end,'channel',o.channel,
     'next_amount_clp',p.price_clp,'next_date',o.period_end,'recurring_consent_required',o.channel='oneclick','environment',env);
   end if;
   return private.billing_order_json(o.id);
  end if;
  select * into p from public.plan_catalog where id=pid and enabled and price_clp>0;
  if not found or ch is null or ch not in ('webpay','oneclick') then raise exception 'Plan o modalidad no disponible.';end if;
  if p_action<>'quote' and ch='oneclick' and (not consent or not exists(select 1 from private.billing_methods where user_id=u and active and environment=env)) then
   raise exception 'Inscribe y autoriza el medio de pago antes de continuar.';end if;
  if p_action<>'quote' and ch='oneclick' and b.recurring_revoked_at is not null and
   not exists(select 1 from private.billing_methods where user_id=u and environment=env and active and consent_at>b.recurring_revoked_at) then
   raise exception 'Vuelve a inscribir el medio de pago para autorizar nuevos cobros.';end if;
  if s.period_end>now() and pid<>coalesce(s.next_plan_id,s.plan_id) then
   raise exception 'Programa el cambio de plan para la próxima renovación.';end if;
  start_at:=greatest(now(),coalesce(s.period_end,now()));
  anchor:=case when s.period_end>=now() or (renewal and (s.period_end at time zone 'UTC')::date=(now() at time zone 'UTC')::date)
   then s.anchor_day else extract(day from start_at at time zone 'UTC')::integer end;
  end_at:=private.billing_month_end(start_at,anchor);
  if renewal then
   select * into o from public.payment_orders where user_id=u and environment=env and renewal_cycle_end=s.period_end and payment_orders.renewal;
   if found then return private.billing_order_json(o.id);end if;
  end if;
  promo:=b.promotion_used_at is null;price:=case when promo then p.first_month_clp else p.price_clp end;
  if p_action='quote' then return jsonb_build_object('plan_id',pid,'amount_clp',price,'promotion_applied',promo,
   'regular_price_clp',p.price_clp,'period_start',start_at,'period_end',end_at,'channel',ch,
   'next_amount_clp',p.price_clp,'next_date',end_at,'recurring_consent_required',ch='oneclick','environment',env);end if;
  oid:=gen_random_uuid();
  insert into public.payment_orders(id,user_id,environment,request_id,plan_id,buy_order,session_id,amount,promo_applied,channel,
   period_start,period_end,anchor_day,renewal,renewal_cycle_end,recurring_consent)
  values(oid,u,env,nullif(p_payload->>'request_id','')::uuid,pid,'P'||left(replace(oid::text,'-',''),25),u::text,price,promo,ch,
   start_at,end_at,anchor,renewal,case when renewal then s.period_end else null end,consent) returning * into o;
  insert into private.payment_provider(order_id) values(oid);
  if consent then perform private.billing_consent_event(u,env,'checkout',true,jsonb_build_object('order_id',oid,'plan_id',pid,'renewal',renewal));end if;
  return private.billing_order_json(oid);
 elsif p_action='renewal_due' then
  for u in select user_id from public.subscriptions where environment=env and auto_renew
   and period_end<now()-cfg.renewal_grace_hours*interval '1 hour' order by user_id loop
   perform 1 from public.pets where user_id=u for update;
   update public.subscriptions set auto_renew=false,cancel_at_period_end=true,cancelled_at=now(),status='past_due',updated_at=now()
    where user_id=u and environment=env and auto_renew and period_end<now()-cfg.renewal_grace_hours*interval '1 hour';
   if found then
    insert into private.billing_accounts(user_id,environment,recurring_revoked_at) values(u,env,now())
     on conflict(user_id,environment) do update set recurring_revoked_at=now();
    perform private.billing_consent_event(u,env,'renewal_grace_expired',false);
   end if;
  end loop;
  update public.payment_orders set status='unknown',updated_at=now() where environment=env and status='processing' and id in
   (select order_id from private.payment_provider where lease_until<=now());
  return jsonb_build_object('users',(select coalesce(jsonb_agg(user_id),'[]') from
   (select user_id from public.subscriptions where environment=env and auto_renew and not cancel_at_period_end and period_end<=now() order by period_end limit least(100,coalesce((p_payload->>'limit')::integer,25))) x),
   'reconcile',(select coalesce(jsonb_agg(private.billing_order_json(id)),'[]') from
   (select id from public.payment_orders where environment=env and status='unknown' order by updated_at limit least(100,coalesce((p_payload->>'limit')::integer,25))) x),
   'pending',(select coalesce(jsonb_agg(private.billing_order_json(id)),'[]') from
   (select id from public.payment_orders where environment=env and channel='oneclick' and status in ('created','pending') order by updated_at limit least(100,coalesce((p_payload->>'limit')::integer,25))) x),
   'webpay_pending',(select coalesce(jsonb_agg(private.billing_order_json(pending_row.id)),'[]') from
   (select pending_order.id from public.payment_orders pending_order join private.payment_provider provider_row on provider_row.order_id=pending_order.id
    where pending_order.environment=env and pending_order.channel='webpay' and pending_order.status='pending' and provider_row.provider_token is not null
    order by pending_order.created_at limit least(100,coalesce((p_payload->>'limit')::integer,25))) pending_row),
   'enrollments',(select coalesce(jsonb_agg(to_jsonb(enrolled_row)),'[]') from
   (select enrollment_row.* from private.billing_enrollments enrollment_row join private.billing_methods method_row on method_row.user_id=enrollment_row.user_id and method_row.environment=enrollment_row.environment
    where enrollment_row.environment=env and enrollment_row.status='enrolled' and enrollment_row.purpose='checkout' and method_row.active
    and not exists(select 1 from public.payment_orders payment_row where payment_row.user_id=enrollment_row.user_id and payment_row.environment=env and payment_row.request_id=enrollment_row.id)
    and not exists(select 1 from private.billing_accounts account_row where account_row.user_id=enrollment_row.user_id and account_row.environment=env and account_row.recurring_revoked_at>=enrollment_row.created_at)
    order by enrollment_row.created_at limit least(100,coalesce((p_payload->>'limit')::integer,25))) enrolled_row));
 elsif p_action in ('get_method','save_method','remove_method') then
  perform 1 from public.pets where user_id=u for update;
  if not found then raise exception 'Usuario no encontrado.';end if;
  if p_action='save_method' then
   if not coalesce((p_payload->>'consent')::boolean,false) or length(coalesce(p_payload->>'tbk_user',''))<1 or length(coalesce(p_payload->>'username',''))<1 then raise exception 'Inscripción inválida.';end if;
   insert into private.billing_methods(user_id,environment,tbk_user,username,card_type,last4,consent_at)
    values(u,env,p_payload->>'tbk_user',p_payload->>'username',p_payload->>'card_type',nullif(p_payload->>'last4',''),coalesce(nullif(p_payload->>'consent_at','')::timestamptz,now()))
    on conflict(user_id) do update set environment=excluded.environment,tbk_user=excluded.tbk_user,username=excluded.username,card_type=excluded.card_type,
     last4=excluded.last4,active=true,consent_at=excluded.consent_at,updated_at=now();
   perform private.billing_consent_event(u,env,'save_method',true,jsonb_build_object('consent_at',coalesce(nullif(p_payload->>'consent_at','')::timestamptz,now())));
  elsif p_action='remove_method' then
   update private.billing_methods set active=false,updated_at=now() where user_id=u and environment=env;
   update public.subscriptions set auto_renew=false,cancel_at_period_end=true,cancelled_at=now(),updated_at=now() where user_id=u and environment=env;
   insert into private.billing_accounts(user_id,environment,recurring_revoked_at) values(u,env,now())
    on conflict(user_id,environment) do update set recurring_revoked_at=now();
   perform private.billing_consent_event(u,env,'remove_method',false);
  end if;
  return (select to_jsonb(m)||jsonb_build_object('consent',true) from private.billing_methods m where user_id=u and environment=env);
 elsif p_action like 'enroll_%' then
  if p_action='enroll_create' then
   perform 1 from public.pets where user_id=u for update;
   if not found then raise exception 'Usuario no encontrado.';end if;
   if not consent or p_payload->>'purpose' not in ('checkout','update_card') or p_payload->>'purpose' is null then raise exception 'Autoriza los cobros recurrentes para continuar.';end if;
   if p_payload->>'purpose'='checkout' and not exists(select 1 from public.plan_catalog where id=pid and enabled and price_clp>0) then raise exception 'Plan no disponible.';end if;
   select * into e from private.billing_enrollments where user_id=u and environment=env and status in ('created','pending','processing','unknown');
   if found then return to_jsonb(e);end if;
   -- Supabase conserva el correo confirmado; no se acepta uno enviado por el navegador.
   insert into private.billing_enrollments(user_id,environment,plan_id,purpose,username,email,recurring_consent)
    values(u,env,pid,p_payload->>'purpose','p'||replace(u::text,'-',''),(select to_jsonb(a)->>'email' from auth.users a where id=u),true) returning * into e;
   perform private.billing_consent_event(u,env,'enroll',true,jsonb_build_object('enrollment_id',e.id,'plan_id',pid,'purpose',e.purpose));
   return to_jsonb(e);
  end if;
  select * into e from private.billing_enrollments where id=enr or (enr is null and provider_token=p_payload->>'provider_token');
  if not found then raise exception 'Inscripción no encontrada.';end if;
  if e.environment<>env then raise exception 'Inscripción de otro ambiente.';end if;
  perform 1 from public.pets where user_id=e.user_id for update;
  select * into e from private.billing_enrollments where id=e.id for update;
  if p_action='enroll_get' then return to_jsonb(e);
  elsif p_action='enroll_start_failed' then
   if e.provider_token is null and e.status in ('created','processing','unknown') then
    update private.billing_enrollments set status='cancelled',lease_until=null,updated_at=now() where id=e.id returning * into e;
   end if;
  elsif p_action='enroll_start_claim' then
   if e.status='processing' and e.lease_until<=now() then update private.billing_enrollments set status='unknown',updated_at=now() where id=e.id returning * into e;end if;
   lease:=e.status='created';
   if lease then update private.billing_enrollments set status='processing',lease_until=now()+interval '2 minutes',updated_at=now() where id=e.id returning * into e;end if;
   return jsonb_build_object('enrollment',to_jsonb(e),'claimed',lease);
  elsif p_action='enroll_started' then
   if e.status='created' or (e.status='processing' and e.provider_token is null) then
    if nullif(p_payload->>'token','') is null then raise exception 'Referencia inválida.';end if;
    update private.billing_enrollments set provider_token=p_payload->>'token',provider_url=p_payload->>'url',status='pending',lease_until=null,updated_at=now() where id=e.id returning * into e;end if;
  elsif p_action='enroll_claim' then
   if e.status='processing' and e.lease_until<=now() then update private.billing_enrollments set status='unknown',updated_at=now() where id=e.id returning * into e;end if;
   lease:=e.status='pending';
   if lease then update private.billing_enrollments set status='processing',lease_until=now()+interval '2 minutes',updated_at=now() where id=e.id returning * into e;end if;
   return jsonb_build_object('enrollment',to_jsonb(e),'claimed',lease);
  elsif p_action='enroll_finish' then
   if e.status='enrolled' then return to_jsonb(e);end if;
   if e.status not in ('processing','unknown') then raise exception 'Inscripción fuera de estado.';end if;
   if (p_payload->>'response_code')::integer is distinct from 0 then
    update private.billing_enrollments set status='rejected',provider_result=p_payload,updated_at=now() where id=e.id returning * into e;
   else
    if exists(select 1 from private.billing_accounts where user_id=e.user_id and environment=env and recurring_revoked_at>=e.created_at) then
     update private.billing_enrollments set status='cancelled',updated_at=now() where id=e.id returning * into e;return to_jsonb(e);end if;
    perform public.billing_admin('save_method',jsonb_build_object('environment',env,'user_id',e.user_id,'tbk_user',p_payload->>'tbk_user',
     'username',e.username,'card_type',p_payload->>'card_type','last4',p_payload->>'last4','consent',true,'consent_at',e.created_at));
    update private.billing_enrollments set status='enrolled',provider_result=p_payload,updated_at=now() where id=e.id returning * into e;
   end if;
  elsif p_action='enroll_cancel' then
   status_value:=coalesce(p_payload->>'status','cancelled');
   if status_value not in ('rejected','cancelled','unknown') then raise exception 'Resultado inválido.';end if;
   if e.status not in ('enrolled','rejected','cancelled') then
    if e.status='processing' and status_value='cancelled' then status_value:='unknown';end if;
    update private.billing_enrollments set status=status_value,lease_until=null,updated_at=now() where id=e.id returning * into e;end if;
  else raise exception 'Operación de inscripción inválida.';end if;
  return to_jsonb(e);
 end if;

 if oid is null and p_action='get_order' and u is not null and nullif(p_payload->>'request_id','') is not null then
  select id into oid from public.payment_orders where user_id=u and environment=env and request_id=(p_payload->>'request_id')::uuid;
  if oid is null then return null;end if;
 end if;
 if oid is null and p_action='get_order' and nullif(p_payload->>'buy_order','') is not null then
  select id into oid from public.payment_orders where environment=env and buy_order=p_payload->>'buy_order' and session_id=p_payload->>'session_id';
  if oid is null then return null;end if;
 end if;
 if oid is null then select order_id into oid from private.payment_provider where provider_token=coalesce(p_payload->>'provider_token',p_payload->>'token');end if;
 select * into o from public.payment_orders where id=oid;
  if not found then raise exception 'Pago no encontrado.';end if;
 if o.environment<>env then raise exception 'Pago de otro ambiente.';end if;
 perform 1 from public.pets where user_id=o.user_id for update;
 select * into o from public.payment_orders where id=oid for update;
 select * into ref from private.payment_provider where order_id=oid for update;
 if p_action='get_order' then return private.billing_order_json(oid);
 elsif p_action='initial_creation_failed' then
  if ref.provider_token is null and ref.charge_started_at is null and o.status in ('created','processing','unknown') then
   update public.payment_orders set status='abandoned',updated_at=now() where id=oid;
   update private.payment_provider set lease_until=null where order_id=oid;
   update private.payment_attempts set finished_at=now(),outcome='creation_failed' where order_id=oid and attempt_number=o.attempts;
  end if;
 elsif p_action='provider_started' then
  if o.status='created' or (o.status='processing' and ref.charge_started_at is null) then
   if nullif(p_payload->>'token','') is null then raise exception 'Referencia inválida.';end if;
   update private.payment_provider set provider_token=p_payload->>'token',provider_url=p_payload->>'url',lease_until=null where order_id=oid;
   update public.payment_orders set status='pending',updated_at=now() where id=oid;
  end if;
 elsif p_action='claim_order' then
  if o.status='processing' and ref.lease_until<=now() then
   update public.payment_orders set status='unknown',updated_at=now() where id=oid returning * into o;
  end if;
  lease:=o.status in ('created','pending') or (o.status='rejected' and o.attempts<cfg.max_attempts and o.retry_at<=now() and o.renewal);
  if lease and o.renewal and not exists(select 1 from public.subscriptions where user_id=o.user_id and auto_renew and not cancel_at_period_end
   and environment=env and channel='oneclick' and coalesce(next_plan_id,plan_id)=o.plan_id and period_end=o.renewal_cycle_end
   and period_end>=now()-cfg.renewal_grace_hours*interval '1 hour') then lease:=false;end if;
  if lease then
   update public.payment_orders set status='processing',attempts=attempts+1,updated_at=now() where id=oid returning * into o;
   if o.channel='oneclick' then
    update public.payment_orders set buy_order='P'||left(replace(o.id::text,'-',''),23)||lpad(o.attempts::text,2,'0') where id=oid returning * into o;
   end if;
   update private.payment_provider set lease_until=now()+interval '2 minutes',charge_started_at=null where order_id=oid;
   insert into private.payment_attempts(order_id,buy_order,attempt_number) values(oid,o.buy_order,o.attempts);
  end if;
  return jsonb_build_object('order',private.billing_order_json(oid),'claimed',lease);
 elsif p_action='charge_started' then
  if o.status<>'processing' or ref.lease_until<=now() or ref.charge_started_at is not null then raise exception 'Este cobro ya está iniciado o requiere verificación.';end if;
  if o.channel='oneclick' and (not o.recurring_consent or not exists(select 1 from private.billing_methods where user_id=o.user_id and environment=env and active)) then
   update public.payment_orders set status='cancelled',updated_at=now() where id=oid;return private.billing_order_json(oid);end if;
  if o.channel='oneclick' and exists(select 1 from private.billing_accounts where user_id=o.user_id and environment=env and recurring_revoked_at>=o.created_at) then
   update public.payment_orders set status='cancelled',updated_at=now() where id=oid;return private.billing_order_json(oid);end if;
  if o.renewal and not exists(select 1 from public.subscriptions where user_id=o.user_id and auto_renew and not cancel_at_period_end
   and environment=env and channel='oneclick' and coalesce(next_plan_id,plan_id)=o.plan_id
   and period_end=o.renewal_cycle_end and period_end>=now()-cfg.renewal_grace_hours*interval '1 hour') then
   update public.payment_orders set status='cancelled',updated_at=now() where id=oid;return private.billing_order_json(oid);end if;
  update private.payment_provider set charge_started_at=now() where order_id=oid;
 elsif p_action='confirm_order' then
  if o.status='approved' then return private.billing_order_json(oid);end if;
  result:=p_payload->'provider_result';
  if o.status not in ('processing','unknown','pending') or not coalesce((result->>'approved')::boolean,false) or
   (result->>'response_code')::integer is distinct from 0 or (result->>'amount')::numeric is distinct from o.amount::numeric or
   result->>'buy_order' is distinct from o.buy_order or (o.channel='webpay' and result->>'session_id' is distinct from o.session_id) then
   raise exception 'El pago no coincide con la orden pendiente.';end if;
  insert into private.billing_accounts(user_id,environment) values(o.user_id,env) on conflict do nothing;
  select * into b from private.billing_accounts where user_id=o.user_id and environment=env for update;
  if o.promo_applied and b.promotion_used_at is not null then raise exception 'La promoción ya fue utilizada.';end if;
  if o.period_start<now() then
   start_at:=now();anchor:=case when (o.period_start at time zone 'UTC')::date=(now() at time zone 'UTC')::date
    then o.anchor_day else extract(day from now() at time zone 'UTC')::integer end;
   update public.payment_orders set period_start=start_at,period_end=private.billing_month_end(start_at,anchor),anchor_day=anchor where id=oid returning * into o;
  end if;
  insert into public.subscription_periods(user_id,environment,order_id,plan_id,starts_at,ends_at,amount,promo_applied)
   values(o.user_id,env,oid,o.plan_id,o.period_start,o.period_end,o.amount,o.promo_applied);
  if o.promo_applied then update private.billing_accounts set promotion_used_at=now(),promotion_order_id=oid where user_id=o.user_id and environment=env;end if;
  select * into s from public.subscriptions where user_id=o.user_id for update;
  authorized:=o.channel='oneclick' and o.recurring_consent and
   (b.recurring_revoked_at is null or b.recurring_revoked_at<o.created_at) and
   exists(select 1 from private.billing_methods where user_id=o.user_id and environment=env and active);
  -- Una renovación anticipada de otro plan se hace efectiva al comenzar el período siguiente.
  insert into public.subscriptions(user_id,environment,plan_id,status,channel,period_start,period_end,anchor_day,auto_renew,recurring_consent_at,cancel_at_period_end,cancelled_at)
   values(o.user_id,env,o.plan_id,'active',o.channel,o.period_start,o.period_end,o.anchor_day,
    authorized,case when o.recurring_consent then o.created_at else null end,
    o.channel='oneclick' and not authorized,case when o.channel='oneclick' and not authorized then coalesce(b.recurring_revoked_at,now()) else null end)
   on conflict(user_id) do update set environment=env,plan_id=case when subscriptions.environment=env and subscriptions.period_end>now() and subscriptions.plan_id<>o.plan_id then subscriptions.plan_id else o.plan_id end,
    next_plan_id=case when subscriptions.next_plan_id is not null and subscriptions.next_plan_id<>o.plan_id then subscriptions.next_plan_id
     when subscriptions.period_end>now() and subscriptions.plan_id<>o.plan_id then o.plan_id else null end,
    status='active',channel=o.channel,period_start=case when subscriptions.period_end>now() and subscriptions.plan_id<>o.plan_id then subscriptions.period_start else o.period_start end,
    period_end=o.period_end,anchor_day=o.anchor_day,
    auto_renew=authorized and
     (not subscriptions.cancel_at_period_end or coalesce(o.created_at>subscriptions.cancelled_at,false)),
    cancel_at_period_end=case when o.channel='oneclick' and not authorized then true
     when authorized and coalesce(o.created_at>subscriptions.cancelled_at,false) then false else subscriptions.cancel_at_period_end end,
    cancelled_at=case when o.channel='oneclick' and not authorized then coalesce(b.recurring_revoked_at,subscriptions.cancelled_at,now())
     when authorized and coalesce(o.created_at>subscriptions.cancelled_at,false) then null else subscriptions.cancelled_at end,
    recurring_consent_at=case when o.recurring_consent then o.created_at else null end,
    updated_at=now();
  update public.payment_orders set status='approved',confirmed_at=now(),retry_at=null,updated_at=now() where id=oid;
  update private.payment_provider set provider_result=result,lease_until=null where order_id=oid;
  update private.payment_attempts set finished_at=now(),outcome='approved',provider_result=result where order_id=oid and attempt_number=o.attempts;
 elsif p_action='fail_order' then
  if o.status in ('approved','cancelled','abandoned') then return private.billing_order_json(oid);end if;
  status_value:=p_payload->>'status';
  if status_value not in ('rejected','cancelled','abandoned','unknown') or status_value is null then raise exception 'Resultado inválido.';end if;
  if status_value in ('cancelled','abandoned') and ref.charge_started_at is not null then status_value:='unknown';end if;
  if o.status='unknown' and status_value='rejected' and not coalesce((p_payload->>'reconciled')::boolean,false) then raise exception 'Consulta el resultado antes de reintentar.';end if;
  update public.payment_orders set status=status_value,retry_at=case when status_value='rejected' and o.renewal then now()+cfg.retry_delay_hours*interval '1 hour' else null end,updated_at=now() where id=oid;
  update private.payment_provider set provider_result=coalesce(p_payload->'provider_result',provider_result),lease_until=null where order_id=oid;
  update private.payment_attempts set finished_at=now(),outcome=status_value,provider_result=p_payload->'provider_result' where order_id=oid and attempt_number=o.attempts;
  if o.renewal and status_value='rejected' then update public.subscriptions set status='past_due',updated_at=now() where user_id=o.user_id and environment=env;end if;
 else raise exception 'Operación administrativa inválida.';end if;
 return private.billing_order_json(oid);
end $$;

revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.billing_state(),public.manage_subscription(text,text,boolean) from public,anon;
grant execute on function public.billing_state(),public.manage_subscription(text,text,boolean) to authenticated;
revoke all on function public.billing_admin(text,jsonb),public.reserve_plan_ai(uuid,text) from public,anon,authenticated;
grant execute on function public.billing_admin(text,jsonb),public.reserve_plan_ai(uuid,text) to service_role;
