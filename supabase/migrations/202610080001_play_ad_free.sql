-- Compra única "Quitar anuncios" en Google Play: quita para siempre los videos obligatorios del
-- plan Gratis (el anuncio voluntario para ganar créditos sigue disponible). No se consume.

-- Las restricciones de play_products no tienen nombre propio: se reemplazan para admitir el nuevo tipo.
do $$
declare c text;
begin
 for c in select conname from pg_constraint where conrelid='private.play_products'::regclass and contype='c' loop
  execute format('alter table private.play_products drop constraint %I',c);
 end loop;
end $$;
alter table private.play_products
 add constraint play_products_product_id_check check(product_id ~ '^[a-z0-9][a-z0-9_.]{0,39}$'),
 add constraint play_products_kind_check check(kind in ('subscription','credits','ad_free')),
 add constraint play_products_credits_check check(credits>0),
 add constraint play_products_shape_check check(
  (kind='subscription' and plan_id in ('plus','pro') and credits is null)
  or (kind='credits' and plan_id is null and credits is not null)
  or (kind='ad_free' and plan_id is null and credits is null));

insert into private.play_products(product_id,kind,plan_id,credits,position) values ('sin_anuncios','ad_free',null,null,6)
 on conflict(product_id) do nothing;

create table private.play_ad_free_purchases (
 purchase_token text primary key check(length(purchase_token) between 10 and 4096),
 user_id uuid not null references auth.users(id) on delete cascade,
 product_id text not null references private.play_products(product_id),
 order_id text,
 test_purchase boolean not null default false,
 refunded_at timestamptz,
 created_at timestamptz not null default now()
);
create index play_ad_free_user on private.play_ad_free_purchases(user_id) where refunded_at is null;

create function private.ad_free(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.play_ad_free_purchases where user_id=p_user and refunded_at is null)
$$;

create function public.play_grant_ad_free(p_user uuid,p_token text,p_product text,p_order text,p_test boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing private.play_ad_free_purchases;
begin
 if not exists(select 1 from private.play_products where product_id=p_product and kind='ad_free') then
  raise exception 'Producto desconocido.' using errcode='P0001';
 end if;
 select * into existing from private.play_ad_free_purchases where purchase_token=p_token for update;
 if found then
  if existing.user_id<>p_user then raise exception 'Esta compra pertenece a otra cuenta de PlanifIA.' using errcode='P0001'; end if;
  return jsonb_build_object('granted',false,'ad_free',existing.refunded_at is null);
 end if;
 insert into private.play_ad_free_purchases(purchase_token,user_id,product_id,order_id,test_purchase)
  values(p_token,p_user,p_product,p_order,coalesce(p_test,false));
 return jsonb_build_object('granted',true,'ad_free',true);
end $$;

-- Reembolso o contracargo: vuelven los videos del plan Gratis.
create function public.play_revoke_ad_free(p_token text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update private.play_ad_free_purchases set refunded_at=now() where purchase_token=p_token and refunded_at is null;
 return found;
end $$;

create or replace function public.play_token_owner(p_token text) returns uuid
language sql security definer stable set search_path='' as $$
 select user_id from private.play_subscriptions where purchase_token=p_token
 union all select user_id from private.play_credit_purchases where purchase_token=p_token
 union all select user_id from private.play_ad_free_purchases where purchase_token=p_token limit 1
$$;

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
  'credits',snap||jsonb_build_object('cost_per_use',s.ai_cost),
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

revoke all on private.play_ad_free_purchases from public,anon,authenticated;
revoke all on function private.ad_free(uuid) from public,anon,authenticated;
revoke all on function public.play_grant_ad_free(uuid,text,text,text,boolean),public.play_revoke_ad_free(text),
 public.play_token_owner(text) from public,anon,authenticated;
grant execute on function public.play_grant_ad_free(uuid,text,text,text,boolean),public.play_revoke_ad_free(text),
 public.play_token_owner(text) to service_role;
revoke all on function public.monetization_state() from public,anon;
grant execute on function public.monetization_state() to authenticated;
