-- Créditos de IA, compras de Google Play, recompensas de AdMob e invitaciones.
-- El servidor es la única fuente de verdad: el teléfono nunca suma créditos ni activa planes.

alter table public.plan_catalog add column monthly_credits integer not null default 0 check(monthly_credits>=0);
update public.plan_catalog set monthly_credits=case id when 'plus' then 1000 when 'pro' then 2500 else 0 end;

create table private.credit_settings (
 id boolean primary key default true check(id),
 ai_cost integer not null default 20 check(ai_cost>0),
 welcome integer not null default 60 check(welcome>=0),
 ad_reward integer not null default 10 check(ad_reward between 1 and 100),
 ad_daily_limit integer not null default 5 check(ad_daily_limit between 0 and 50),
 referral_inviter integer not null default 40 check(referral_inviter>=0),
 referral_invitee integer not null default 20 check(referral_invitee>=0),
 referral_monthly_limit integer not null default 10 check(referral_monthly_limit>=0),
 referral_window_days integer not null default 14 check(referral_window_days between 1 and 90),
 timezone text not null default 'America/Santiago'
);
insert into private.credit_settings(id) values(true);

-- bonus: créditos que nunca vencen (bienvenida, anuncios, invitaciones, paquetes).
-- window_start/plan_used: ventana mensual de los créditos del plan; no se acumulan.
create table private.credit_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 bonus integer not null default 0 check(bonus>=0),
 window_start timestamptz,
 plan_used integer not null default 0 check(plan_used>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table private.credit_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 reason text not null check(reason in ('welcome','ai_use','ai_refund','rewarded_ad','referral_inviter','referral_invitee','purchase','purchase_refund','admin')),
 plan_delta integer not null default 0,
 bonus_delta integer not null default 0,
 ref text,
 created_at timestamptz not null default now(),
 unique(reason,ref)
);
create index credit_events_user on private.credit_events(user_id,created_at desc);

-- Mismos IDs que en Play Console. Cambiar un ID aquí exige crearlo igual en la consola.
create table private.play_products (
 product_id text primary key check(product_id ~ '^[a-z0-9][a-z0-9_.]{0,39}$'),
 kind text not null check(kind in ('subscription','credits')),
 plan_id text references public.plan_catalog(id),
 credits integer check(credits>0),
 position integer not null default 0,
 check((kind='subscription' and plan_id in ('plus','pro') and credits is null) or (kind='credits' and plan_id is null and credits is not null))
);
insert into private.play_products values
 ('planifia_plus','subscription','plus',null,1),
 ('planifia_pro','subscription','pro',null,2),
 ('creditos_100','credits',null,100,3),
 ('creditos_300','credits',null,300,4),
 ('creditos_1000','credits',null,1000,5);

create table private.play_subscriptions (
 purchase_token text primary key check(length(purchase_token) between 10 and 4096),
 user_id uuid not null references auth.users(id) on delete cascade,
 product_id text not null references private.play_products(product_id),
 state text not null,
 expiry_time timestamptz,
 auto_renewing boolean not null default false,
 latest_order_id text,
 linked_purchase_token text,
 test_purchase boolean not null default false,
 raw jsonb not null default '{}',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index play_subscriptions_user on private.play_subscriptions(user_id,expiry_time desc);
create table private.play_credit_purchases (
 purchase_token text primary key check(length(purchase_token) between 10 and 4096),
 user_id uuid not null references auth.users(id) on delete cascade,
 product_id text not null references private.play_products(product_id),
 order_id text,
 credits integer not null check(credits>0),
 test_purchase boolean not null default false,
 refunded_at timestamptz,
 created_at timestamptz not null default now()
);
create table private.referral_codes (
 user_id uuid primary key references auth.users(id) on delete cascade,
 code text not null unique check(code ~ '^[A-Z2-9]{8}$')
);
create table private.referrals (
 invitee_id uuid primary key references auth.users(id) on delete cascade,
 inviter_id uuid not null references auth.users(id) on delete cascade check(inviter_id<>invitee_id),
 created_at timestamptz not null default now(),
 rewarded_at timestamptz,
 inviter_rewarded boolean not null default false
);
create index referrals_inviter on private.referrals(inviter_id,rewarded_at);

alter table public.ai_jobs add column credit_plan integer not null default 0 check(credit_plan>=0);
alter table public.ai_jobs add column credit_bonus integer not null default 0 check(credit_bonus>=0);
alter table public.ai_jobs add column credit_window timestamptz;

-- Un plan de Play da acceso mientras Google lo informa vigente (incluye cancelado sin vencer y período de gracia).
create or replace function private.effective_plan(p_user uuid) returns public.plan_catalog
language sql stable set search_path='' as $$
 select p.* from public.plan_catalog p where p.id=coalesce(
  (select c.id from public.plan_catalog c where c.id in (
    select s.plan_id from public.subscription_periods s where s.user_id=p_user
      and s.environment=(select environment from private.billing_settings where id)
      and s.starts_at<=now() and s.ends_at>now()
    union
    select pp.plan_id from private.play_subscriptions g join private.play_products pp using(product_id)
      where g.user_id=p_user and g.expiry_time>now()
      and g.state in ('SUBSCRIPTION_STATE_ACTIVE','SUBSCRIPTION_STATE_CANCELED','SUBSCRIPTION_STATE_IN_GRACE_PERIOD')
   ) order by c.position desc limit 1),'free')
$$;

create function private.ensure_credit_account(p_user uuid) returns void
language plpgsql set search_path='' as $$
declare inserted integer; s private.credit_settings;
begin
 select * into s from private.credit_settings where id;
 insert into private.credit_accounts(user_id,bonus)
  select p_user,s.welcome where exists(select 1 from auth.users where id=p_user)
  on conflict(user_id) do nothing;
 get diagnostics inserted=row_count;
 if inserted>0 and s.welcome>0 then
  insert into private.credit_events(user_id,reason,bonus_delta,ref) values(p_user,'welcome',s.welcome,p_user::text);
 end if;
end $$;

-- Calcula la ventana mensual vigente. Con p_persist guarda el reinicio (requiere bloquear la cuenta).
create function private.credit_snapshot(p_user uuid,p_persist boolean default false) returns jsonb
language plpgsql set search_path='' as $$
declare a private.credit_accounts; p public.plan_catalog; ws timestamptz; used integer; allowance integer;
begin
 select * into a from private.credit_accounts where user_id=p_user;
 if not found then raise exception 'Cuenta de créditos no disponible.'; end if;
 p:=private.effective_plan(p_user);
 allowance:=p.monthly_credits; ws:=a.window_start; used:=a.plan_used;
 if allowance>0 then
  if ws is null or now()>=ws+interval '2 months' then ws:=now(); used:=0;
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

-- Una compra nueva abre una ventana nueva si la anterior ya terminó.
create function private.credit_start_window(p_user uuid) returns void
language plpgsql set search_path='' as $$
begin
 perform private.ensure_credit_account(p_user);
 perform 1 from private.credit_accounts where user_id=p_user for update;
 update private.credit_accounts set window_start=now(),plan_used=0,updated_at=now()
  where user_id=p_user and (window_start is null or now()>=window_start+interval '1 month');
 perform private.credit_snapshot(p_user,true);
end $$;

create function private.add_bonus(p_user uuid,p_amount integer,p_reason text,p_ref text) returns boolean
language plpgsql set search_path='' as $$
begin
 if p_amount<=0 then return false; end if;
 perform private.ensure_credit_account(p_user);
 perform 1 from private.credit_accounts where user_id=p_user for update;
 insert into private.credit_events(user_id,reason,bonus_delta,ref) values(p_user,p_reason,p_amount,p_ref)
  on conflict(reason,ref) do nothing;
 if not found then return false; end if;
 update private.credit_accounts set bonus=bonus+p_amount,updated_at=now() where user_id=p_user;
 return true;
end $$;

-- Gasta primero los créditos del plan y después los que no vencen.
create function private.spend_ai_credits(p_user uuid,p_ref text) returns jsonb
language plpgsql set search_path='' as $$
declare s private.credit_settings; a private.credit_accounts; snap jsonb; plan_take integer; bonus_take integer;
begin
 select * into s from private.credit_settings where id;
 perform private.ensure_credit_account(p_user);
 select * into a from private.credit_accounts where user_id=p_user for update;
 snap:=private.credit_snapshot(p_user,true);
 select * into a from private.credit_accounts where user_id=p_user;
 plan_take:=least(s.ai_cost,(snap->>'plan_available')::integer);
 bonus_take:=s.ai_cost-plan_take;
 if a.bonus<bonus_take then
  raise exception 'No tienes créditos suficientes. Cada uso de IA cuesta % créditos; consigue más en Mi plan.',s.ai_cost using errcode='P0001';
 end if;
 update private.credit_accounts set plan_used=plan_used+plan_take,bonus=bonus-bonus_take,updated_at=now() where user_id=p_user;
 insert into private.credit_events(user_id,reason,plan_delta,bonus_delta,ref) values(p_user,'ai_use',-plan_take,-bonus_take,p_ref);
 return jsonb_build_object('plan',plan_take,'bonus',bonus_take,'window_start',snap->>'window_start');
end $$;

create function private.referral_reward(p_invitee uuid) returns void
language plpgsql set search_path='' as $$
declare r private.referrals; s private.credit_settings; given integer; month_start timestamptz;
begin
 select * into r from private.referrals where invitee_id=p_invitee and rewarded_at is null for update;
 if not found then return; end if;
 if not exists(select 1 from auth.users where id=p_invitee and email_confirmed_at is not null) then return; end if;
 select * into s from private.credit_settings where id;
 month_start:=date_trunc('month',now() at time zone s.timezone) at time zone s.timezone;
 select count(*) into given from private.referrals where inviter_id=r.inviter_id and inviter_rewarded and rewarded_at>=month_start;
 perform private.add_bonus(p_invitee,s.referral_invitee,'referral_invitee',p_invitee::text);
 if given<s.referral_monthly_limit then
  perform private.add_bonus(r.inviter_id,s.referral_inviter,'referral_inviter',p_invitee::text);
 end if;
 update private.referrals set rewarded_at=now(),inviter_rewarded=given<s.referral_monthly_limit where invitee_id=p_invitee;
end $$;

-- Igual que la versión anterior, pero cobra créditos en lugar de cuotas mensuales.
create or replace function public.enqueue_ai_job(p_user_id uuid,p_request_id uuid,p_kind text,p_input jsonb,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs; cfg private.ai_queue_settings; plan public.plan_catalog; spent jsonb;
begin
 if p_request_id is null or p_kind not in ('generation','adjustment') or length(p_payload::text)>250000 then
  raise exception 'Solicitud inválida.';
 end if;
 perform 1 from public.pets where user_id=p_user_id for update;
 if not found then raise exception 'Cuenta no disponible.'; end if;
 select * into j from public.ai_jobs where user_id=p_user_id and request_id=p_request_id;
 if found then
  if (select fingerprint from private.ai_job_payloads where job_id=j.id)<>md5(p_input::text) then
   raise exception 'Este identificador ya corresponde a otra solicitud.';
  end if;
  return jsonb_build_object('id',j.id,'status',j.status,'reused',true);
 end if;
 select * into cfg from private.ai_queue_settings where id;
 if (select count(*) from public.ai_jobs where user_id=p_user_id and status in ('queued','processing'))>=cfg.per_user_limit then
  raise exception 'Ya tienes una solicitud en preparación. Recupérala antes de crear otra.';
 end if;
 plan:=private.effective_plan(p_user_id);
 if p_kind='generation' and (select count(*) from public.goals where user_id=p_user_id and status='active')>=plan.max_active_goals then
  raise exception 'Tu plan permite % metas activas. Pausa una meta o consulta Mi plan; puedes seguir editando manualmente.',plan.max_active_goals;
 end if;
 if not public.reserve_ai_request(p_user_id,cfg.daily_limit) then raise exception 'Llegaste al límite diario de propuestas. Puedes seguir editando manualmente.'; end if;
 -- Una excepción deshace también la reserva diaria y el cobro de créditos.
 spent:=private.spend_ai_credits(p_user_id,p_request_id::text);
 insert into public.ai_jobs(user_id,request_id,kind,plan_id,priority,credit_plan,credit_bonus,credit_window)
 values(p_user_id,p_request_id,p_kind,plan.id,coalesce((cfg.priorities->>plan.id)::integer,0),
  (spent->>'plan')::integer,(spent->>'bonus')::integer,(spent->>'window_start')::timestamptz) returning * into j;
 insert into private.ai_job_payloads values(j.id,md5(p_input::text),p_payload);
 perform private.referral_reward(p_user_id);
 return jsonb_build_object('id',j.id,'status',j.status,'reused',false);
end $$;

-- Devuelve los créditos si la IA no llegó a entregar nada: error, o cancelación antes de empezar.
create function private.refund_ai_credits() returns trigger
language plpgsql security definer set search_path='' as $$
declare plan_back integer:=0;
begin
 if not (new.status='error' or (new.status='cancelled' and old.status='queued')) then return new; end if;
 if new.credit_plan+new.credit_bonus=0 then return new; end if;
 perform 1 from private.credit_accounts where user_id=new.user_id for update;
 insert into private.credit_events(user_id,reason,ref) values(new.user_id,'ai_refund',new.id::text)
  on conflict(reason,ref) do nothing;
 if not found then return new; end if;
 if new.credit_plan>0 then
  update private.credit_accounts set plan_used=greatest(0,plan_used-new.credit_plan),updated_at=now()
   where user_id=new.user_id and window_start is not distinct from new.credit_window;
  if found then plan_back:=new.credit_plan; end if;
 end if;
 update private.credit_accounts set bonus=bonus+new.credit_bonus,updated_at=now() where user_id=new.user_id;
 update private.credit_events set plan_delta=plan_back,bonus_delta=new.credit_bonus where reason='ai_refund' and ref=new.id::text;
 return new;
end $$;
create trigger ai_jobs_refund_credits after update of status on public.ai_jobs
 for each row when (old.status in ('queued','processing') and new.status in ('error','cancelled'))
 execute function private.refund_ai_credits();

create function private.referral_code(p_user uuid) returns text
language plpgsql set search_path='' as $$
declare c text; alphabet text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
 select code into c from private.referral_codes where user_id=p_user;
 if found then return c; end if;
 for attempt in 1..10 loop
  c:=(select string_agg(substr(alphabet,1+floor(random()*32)::integer,1),'') from generate_series(1,8));
  insert into private.referral_codes(user_id,code) values(p_user,c) on conflict do nothing;
  if found then return c; end if;
  select code into c from private.referral_codes where user_id=p_user;
  if found then return c; end if;
 end loop;
 raise exception 'No pudimos crear tu código de invitación. Inténtalo de nuevo.';
end $$;

create function public.monetization_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); s private.credit_settings; snap jsonb; tz_today date; ads_today integer;
 sub private.play_subscriptions; r private.referrals; month_start timestamptz; rewarded integer;
begin
 select * into s from private.credit_settings where id;
 perform private.ensure_credit_account(u);
 snap:=private.credit_snapshot(u,false);
 tz_today:=(now() at time zone s.timezone)::date;
 select count(*) into ads_today from private.credit_events where user_id=u and reason='rewarded_ad'
  and created_at>=(tz_today::timestamp at time zone s.timezone);
 select * into sub from private.play_subscriptions where user_id=u order by (expiry_time>now()) desc nulls last,expiry_time desc nulls last,updated_at desc limit 1;
 select * into r from private.referrals where invitee_id=u;
 month_start:=date_trunc('month',now() at time zone s.timezone) at time zone s.timezone;
 select count(*) into rewarded from private.referrals where inviter_id=u and inviter_rewarded and rewarded_at>=month_start;
 return jsonb_build_object(
  'plan',(select jsonb_build_object('id',p.id,'name',p.name,'monthly_credits',p.monthly_credits,'max_active_goals',p.max_active_goals) from private.effective_plan(u) p),
  'plans',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'monthly_credits',monthly_credits,'max_active_goals',max_active_goals,'price_clp',price_clp,'first_month_clp',first_month_clp,'benefits',benefits) order by position),'[]') from public.plan_catalog where enabled),
  'credits',snap||jsonb_build_object('cost_per_use',s.ai_cost),
  'ads',jsonb_build_object('reward',s.ad_reward,'today',ads_today,'daily_limit',s.ad_daily_limit,
   'resets_at',((tz_today+1)::timestamp at time zone s.timezone)),
  'referral',jsonb_build_object('code',private.referral_code(u),'inviter_reward',s.referral_inviter,'invitee_reward',s.referral_invitee,
   'monthly_limit',s.referral_monthly_limit,'rewarded_this_month',rewarded,
   'invited',r.invitee_id is not null,'invite_rewarded',r.rewarded_at is not null,
   'can_redeem',r.invitee_id is null and not exists(select 1 from public.ai_jobs where user_id=u)
    and coalesce((select created_at from auth.users where id=u),now())>now()-make_interval(days=>s.referral_window_days)),
  'play_subscription',case when sub.purchase_token is null then null else jsonb_build_object(
   'product_id',sub.product_id,'plan_id',(select plan_id from private.play_products where product_id=sub.product_id),
   'state',sub.state,'expiry_time',sub.expiry_time,'auto_renewing',sub.auto_renewing,
   'active',sub.expiry_time>now() and sub.state in ('SUBSCRIPTION_STATE_ACTIVE','SUBSCRIPTION_STATE_CANCELED','SUBSCRIPTION_STATE_IN_GRACE_PERIOD')) end,
  'products',(select coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'kind',kind,'plan_id',plan_id,'credits',credits) order by position),'[]') from private.play_products),
  'recent',(select coalesce(jsonb_agg(jsonb_build_object('reason',reason,'delta',plan_delta+bonus_delta,'created_at',created_at) order by created_at desc),'[]')
   from (select * from private.credit_events where user_id=u order by created_at desc,id desc limit 15) e),
  'active_goals',(select count(*) from public.goals where user_id=u and status='active'));
end $$;

create function public.redeem_referral(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); s private.credit_settings; inviter uuid; v_code text:=upper(btrim(coalesce(p_code,'')));
begin
 select * into s from private.credit_settings where id;
 if v_code !~ '^[A-Z2-9]{8}$' then raise exception 'Revisa el código: tiene 8 letras y números.' using errcode='P0001'; end if;
 perform 1 from public.pets where user_id=u for update;
 select c.user_id into inviter from private.referral_codes c where c.code=v_code;
 if not found then raise exception 'No encontramos ese código de invitación.' using errcode='P0001'; end if;
 if inviter=u then raise exception 'No puedes usar tu propio código.' using errcode='P0001'; end if;
 if exists(select 1 from private.referrals where invitee_id=u) then raise exception 'Ya usaste un código de invitación.' using errcode='P0001'; end if;
 if exists(select 1 from public.ai_jobs where user_id=u) then
  raise exception 'El código se usa antes de tu primera solicitud de IA.' using errcode='P0001';
 end if;
 if (select created_at from auth.users where id=u)<now()-make_interval(days=>s.referral_window_days) then
  raise exception 'Los códigos se usan durante los primeros % días de la cuenta.',s.referral_window_days using errcode='P0001';
 end if;
 insert into private.referrals(invitee_id,inviter_id) values(u,inviter);
 return jsonb_build_object('ok',true,'invitee_reward',s.referral_invitee);
end $$;

-- Solo las Edge Functions (service_role) registran compras y recompensas verificadas.
create function public.play_apply_subscription(p_user uuid,p_token text,p_product text,p_state text,p_expiry timestamptz,
 p_auto_renewing boolean,p_order text,p_linked text,p_test boolean,p_raw jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous private.play_subscriptions; owner uuid;
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
 if previous.purchase_token is null and p_expiry>now()
  and p_state in ('SUBSCRIPTION_STATE_ACTIVE','SUBSCRIPTION_STATE_CANCELED','SUBSCRIPTION_STATE_IN_GRACE_PERIOD') then
  perform private.credit_start_window(p_user);
 end if;
 return jsonb_build_object('plan',(select id from private.effective_plan(p_user)));
end $$;

create function public.play_grant_credits(p_user uuid,p_token text,p_product text,p_order text,p_test boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare product private.play_products; existing private.play_credit_purchases;
begin
 select * into product from private.play_products where product_id=p_product and kind='credits';
 if not found then raise exception 'Paquete de créditos desconocido.' using errcode='P0001'; end if;
 perform private.ensure_credit_account(p_user);
 perform 1 from private.credit_accounts where user_id=p_user for update;
 select * into existing from private.play_credit_purchases where purchase_token=p_token;
 if found then
  if existing.user_id<>p_user then raise exception 'Esta compra pertenece a otra cuenta de PlanifIA.' using errcode='P0001'; end if;
  return jsonb_build_object('granted',false,'credits',existing.credits);
 end if;
 insert into private.play_credit_purchases(purchase_token,user_id,product_id,order_id,credits,test_purchase)
  values(p_token,p_user,p_product,p_order,product.credits,coalesce(p_test,false));
 perform private.add_bonus(p_user,product.credits,'purchase',p_token);
 return jsonb_build_object('granted',true,'credits',product.credits);
end $$;

-- Reembolso o contracargo de un paquete: descuenta lo que quede, sin saldo negativo.
create function public.play_revoke_credits(p_token text) returns boolean
language plpgsql security definer set search_path='' as $$
declare p private.play_credit_purchases; taken integer;
begin
 select * into p from private.play_credit_purchases where purchase_token=p_token and refunded_at is null for update;
 if not found then return false; end if;
 perform 1 from private.credit_accounts where user_id=p.user_id for update;
 select least(bonus,p.credits) into taken from private.credit_accounts where user_id=p.user_id;
 update private.credit_accounts set bonus=bonus-taken,updated_at=now() where user_id=p.user_id;
 update private.play_credit_purchases set refunded_at=now() where purchase_token=p_token;
 insert into private.credit_events(user_id,reason,bonus_delta,ref) values(p.user_id,'purchase_refund',-taken,p_token)
  on conflict(reason,ref) do nothing;
 return true;
end $$;

create function public.play_product_kind(p_product text) returns text
language sql security definer stable set search_path='' as $$
 select kind from private.play_products where product_id=p_product
$$;

-- Reembolso o revocación de una suscripción: deja de dar acceso de inmediato.
create function public.play_revoke_subscription(p_token text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update private.play_subscriptions set state='SUBSCRIPTION_STATE_REVOKED',expiry_time=least(coalesce(expiry_time,now()),now()),
  auto_renewing=false,updated_at=now() where purchase_token=p_token;
 return found;
end $$;

create function public.play_token_owner(p_token text) returns uuid
language sql security definer stable set search_path='' as $$
 select user_id from private.play_subscriptions where purchase_token=p_token
 union all select user_id from private.play_credit_purchases where purchase_token=p_token limit 1
$$;

-- Llamada sólo después de validar la firma de AdMob (SSV).
create function public.admob_reward(p_user uuid,p_transaction text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.credit_settings; today_count integer; tz_today date;
begin
 if p_transaction is null or length(p_transaction) not between 1 and 200 then raise exception 'Transacción inválida.'; end if;
 if not exists(select 1 from auth.users where id=p_user) then return jsonb_build_object('granted',false,'reason','unknown_user'); end if;
 select * into s from private.credit_settings where id;
 perform private.ensure_credit_account(p_user);
 perform 1 from private.credit_accounts where user_id=p_user for update;
 if exists(select 1 from private.credit_events where reason='rewarded_ad' and ref=p_transaction) then
  return jsonb_build_object('granted',false,'reason','duplicate');
 end if;
 tz_today:=(now() at time zone s.timezone)::date;
 select count(*) into today_count from private.credit_events where user_id=p_user and reason='rewarded_ad'
  and created_at>=(tz_today::timestamp at time zone s.timezone);
 if today_count>=s.ad_daily_limit then return jsonb_build_object('granted',false,'reason','daily_limit'); end if;
 perform private.add_bonus(p_user,s.ad_reward,'rewarded_ad',p_transaction);
 return jsonb_build_object('granted',true,'credits',s.ad_reward);
end $$;

revoke all on all tables in schema private from public,anon,authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.monetization_state(),public.redeem_referral(text) from public,anon;
grant execute on function public.monetization_state(),public.redeem_referral(text) to authenticated;
revoke all on function public.play_apply_subscription(uuid,text,text,text,timestamptz,boolean,text,text,boolean,jsonb),
 public.play_grant_credits(uuid,text,text,text,boolean),public.play_revoke_credits(text),public.play_token_owner(text),
 public.play_product_kind(text),public.play_revoke_subscription(text),public.admob_reward(uuid,text) from public,anon,authenticated;
grant execute on function public.play_apply_subscription(uuid,text,text,text,timestamptz,boolean,text,text,boolean,jsonb),
 public.play_grant_credits(uuid,text,text,text,boolean),public.play_revoke_credits(text),public.play_token_owner(text),
 public.play_product_kind(text),public.play_revoke_subscription(text),public.admob_reward(uuid,text) to service_role;
