-- Chat "Hablar con Lumi": cada mensaje cuesta créditos, se devuelven si Lumi no responde y se
-- guarda un historial corto. La IA del chat nunca pasa por la cola de planes (public.ai_jobs).

alter table private.credit_settings
 add column chat_cost integer not null default 5 check(chat_cost>0),
 add column chat_per_minute integer not null default 6 check(chat_per_minute between 1 and 60),
 add column chat_per_day integer not null default 200 check(chat_per_day between 1 and 2000),
 add column chat_history integer not null default 100 check(chat_history between 10 and 500);

alter table private.credit_events drop constraint credit_events_reason_check;
alter table private.credit_events add constraint credit_events_reason_check check(reason in (
 'welcome','ai_use','ai_refund','rewarded_ad','referral_inviter','referral_invitee','purchase','purchase_refund','admin',
 'lumi_chat','lumi_chat_refund'));

-- Cobro general: primero los créditos del plan y después los que no vencen.
create function private.spend_credits(p_user uuid,p_cost integer,p_reason text,p_ref text) returns jsonb
language plpgsql set search_path='' as $$
declare a private.credit_accounts; snap jsonb; plan_take integer; bonus_take integer;
begin
 if p_cost is null or p_cost<=0 then raise exception 'Costo de créditos inválido.'; end if;
 perform private.ensure_credit_account(p_user);
 select * into a from private.credit_accounts where user_id=p_user for update;
 if not found then raise exception 'Cuenta no disponible.'; end if;
 snap:=private.credit_snapshot(p_user,true);
 select * into a from private.credit_accounts where user_id=p_user;
 plan_take:=least(p_cost,(snap->>'plan_available')::integer);
 bonus_take:=p_cost-plan_take;
 if a.bonus<bonus_take then
  raise exception 'No tienes créditos suficientes. %',case p_reason
   when 'lumi_chat' then format('Cada mensaje a Lumi cuesta %s créditos; consigue más en Mi plan.',p_cost)
   else format('Cada uso de IA cuesta %s créditos; consigue más en Mi plan.',p_cost) end using errcode='P0001';
 end if;
 update private.credit_accounts set plan_used=plan_used+plan_take,bonus=bonus-bonus_take,updated_at=now() where user_id=p_user;
 insert into private.credit_events(user_id,reason,plan_delta,bonus_delta,ref) values(p_user,p_reason,-plan_take,-bonus_take,p_ref);
 return jsonb_build_object('plan',plan_take,'bonus',bonus_take,'window_start',snap->>'window_start');
end $$;

-- Los planes siguen costando ai_cost (20), ahora a través del cobro general.
create or replace function private.spend_ai_credits(p_user uuid,p_ref text) returns jsonb
language plpgsql set search_path='' as $$
begin
 return private.spend_credits(p_user,(select ai_cost from private.credit_settings where id),'ai_use',p_ref);
end $$;

-- Mensajes cobrados que esperan la respuesta de Lumi (para devolver exactamente lo cobrado).
create table private.lumi_chat_pending (
 request_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 plan_take integer not null check(plan_take>=0),
 bonus_take integer not null check(bonus_take>=0),
 credit_window timestamptz,
 created_at timestamptz not null default now()
);
create index lumi_chat_pending_user on private.lumi_chat_pending(user_id,created_at);

create table public.lumi_chat_messages (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('user','lumi')),
 content text not null check(length(content) between 1 and 600),
 created_at timestamptz not null default now()
);
create index lumi_chat_messages_user on public.lumi_chat_messages(user_id,id desc);
alter table public.lumi_chat_messages enable row level security;
create policy own_read on public.lumi_chat_messages for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.lumi_chat_messages from public,anon,authenticated;
grant select on public.lumi_chat_messages to authenticated;
grant all on public.lumi_chat_messages to service_role;

create function private.lumi_chat_refund_pending(p private.lumi_chat_pending) returns boolean
language plpgsql set search_path='' as $$
declare plan_back integer:=0;
begin
 perform 1 from private.credit_accounts where user_id=p.user_id for update;
 delete from private.lumi_chat_pending where request_id=p.request_id;
 insert into private.credit_events(user_id,reason,ref) values(p.user_id,'lumi_chat_refund',p.request_id::text)
  on conflict(reason,ref) do nothing;
 if not found then return false; end if;
 if p.plan_take>0 then
  update private.credit_accounts set plan_used=greatest(0,plan_used-p.plan_take),updated_at=now()
   where user_id=p.user_id and window_start is not distinct from p.credit_window;
  if found then plan_back:=p.plan_take; end if;
 end if;
 update private.credit_accounts set bonus=bonus+p.bonus_take,updated_at=now() where user_id=p.user_id;
 update private.credit_events set plan_delta=plan_back,bonus_delta=p.bonus_take
  where reason='lumi_chat_refund' and ref=p.request_id::text;
 return true;
end $$;

-- Lo llama sólo la Edge Function lumi-chat (service_role) antes de pedir la respuesta a la IA:
-- valida, aplica los límites, cobra y entrega el contexto mínimo de la cuenta.
create function public.lumi_chat_begin(p_user uuid,p_request uuid,p_text text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.credit_settings; spent jsonb; tz_today date; recent integer; today integer; stale private.lumi_chat_pending;
begin
 if p_request is null or length(btrim(coalesce(p_text,''))) not between 1 and 500 then
  raise exception 'Escribe un mensaje de 1 a 500 caracteres.' using errcode='P0001';
 end if;
 perform 1 from public.pets where user_id=p_user for update;
 if not found then raise exception 'Cuenta no disponible.' using errcode='P0001'; end if;
 select * into s from private.credit_settings where id;
 -- Si una respuesta anterior nunca llegó (corte de red, función reiniciada), se devuelve.
 for stale in select * from private.lumi_chat_pending where user_id=p_user and created_at<now()-interval '3 minutes' loop
  perform private.lumi_chat_refund_pending(stale);
 end loop;
 if exists(select 1 from private.credit_events where reason='lumi_chat' and ref=p_request::text) then
  raise exception 'Este mensaje ya se envió.' using errcode='P0001';
 end if;
 select count(*) into recent from private.credit_events
  where user_id=p_user and reason='lumi_chat' and created_at>now()-interval '1 minute';
 if recent>=s.chat_per_minute then
  raise exception 'Vas muy rápido. Espera un momento antes de escribirle otra vez a Lumi.' using errcode='P0001';
 end if;
 tz_today:=(now() at time zone s.timezone)::date;
 select count(*) into today from private.credit_events
  where user_id=p_user and reason='lumi_chat' and created_at>=(tz_today::timestamp at time zone s.timezone);
 if today>=s.chat_per_day then
  raise exception 'Llegaste al límite diario de mensajes con Lumi. Vuelve mañana.' using errcode='P0001';
 end if;
 spent:=private.spend_credits(p_user,s.chat_cost,'lumi_chat',p_request::text);
 insert into private.lumi_chat_pending(request_id,user_id,plan_take,bonus_take,credit_window)
  values(p_request,p_user,(spent->>'plan')::integer,(spent->>'bonus')::integer,(spent->>'window_start')::timestamptz);
 return jsonb_build_object(
  'cost',s.chat_cost,
  'profile',jsonb_build_object(
   'name',(select name from public.profiles where user_id=p_user),
   'pet',(select jsonb_build_object('name',pj->>'name','stage',(pj->>'stage')::integer) from private.pet_json(p_user) pj)),
  'goals',(select coalesce(jsonb_agg(jsonb_build_object('title',g.title,'next_action',
    (select t.title from public.tasks t where t.user_id=p_user and t.goal_id=g.id and t.status='pending'
      order by t.scheduled_date nulls last,t.deadline nulls last,t.created_at limit 1)) order by g.updated_at desc),'[]')
   from (select * from public.goals where user_id=p_user and status='active' order by updated_at desc limit 3) g),
  'history',(select coalesce(jsonb_agg(jsonb_build_object('role',m.role,'content',m.content) order by m.id),'[]')
   from (select * from public.lumi_chat_messages where user_id=p_user order by id desc limit 6) m));
end $$;

-- Guarda la pregunta y la respuesta y conserva sólo los últimos chat_history mensajes.
create function public.lumi_chat_finish(p_user uuid,p_request uuid,p_text text,p_reply text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.credit_settings;
begin
 if length(btrim(coalesce(p_reply,''))) = 0 then raise exception 'Respuesta vacía.' using errcode='P0001'; end if;
 select * into s from private.credit_settings where id;
 delete from private.lumi_chat_pending where request_id=p_request and user_id=p_user;
 if not found then raise exception 'Este mensaje ya no está disponible.' using errcode='P0001'; end if;
 insert into public.lumi_chat_messages(user_id,role,content) values
  (p_user,'user',left(btrim(p_text),600)),(p_user,'lumi',left(btrim(p_reply),600));
 delete from public.lumi_chat_messages where user_id=p_user and id not in
  (select id from public.lumi_chat_messages where user_id=p_user order by id desc limit s.chat_history);
 return jsonb_build_object('credits',private.credit_snapshot(p_user,false)->'balance');
end $$;

-- Lumi no respondió (PC apagado, error o tiempo agotado): se devuelve lo cobrado.
create function public.lumi_chat_refund(p_user uuid,p_request uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare p private.lumi_chat_pending;
begin
 select * into p from private.lumi_chat_pending where request_id=p_request and user_id=p_user for update;
 if not found then return false; end if;
 return private.lumi_chat_refund_pending(p);
end $$;

-- Botón "Borrar conversación".
create function public.lumi_chat_clear() returns integer
language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); n integer;
begin
 delete from public.lumi_chat_messages where user_id=u;
 get diagnostics n=row_count;
 return n;
end $$;

-- El costo del chat se muestra en la app ("Cada mensaje usa 5 créditos").
create or replace function public.monetization_state() returns jsonb
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
  'credits',snap||jsonb_build_object('cost_per_use',s.ai_cost,'chat_cost',s.chat_cost),
  'ads',jsonb_build_object('reward',s.ad_reward,'today',ads_today,'daily_limit',s.ad_daily_limit,
   'resets_at',((tz_today+1)::timestamp at time zone s.timezone)),
  'ad_free',private.ad_free(u),
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

revoke all on private.lumi_chat_pending from public,anon,authenticated;
revoke all on function private.spend_credits(uuid,integer,text,text),private.lumi_chat_refund_pending(private.lumi_chat_pending)
 from public,anon,authenticated;
revoke all on function public.lumi_chat_begin(uuid,uuid,text),public.lumi_chat_finish(uuid,uuid,text,text),
 public.lumi_chat_refund(uuid,uuid),public.lumi_chat_clear() from public,anon,authenticated;
grant execute on function public.lumi_chat_begin(uuid,uuid,text),public.lumi_chat_finish(uuid,uuid,text,text),
 public.lumi_chat_refund(uuid,uuid) to service_role;
grant execute on function public.lumi_chat_clear() to authenticated;
revoke all on function public.monetization_state() from public,anon;
grant execute on function public.monetization_state() to authenticated;
