-- Chat con Lumi: devoluciones que no se pierden y borrado que no reaparece.
-- F3: lumi_chat_begin devolvía los cobros huérfanos dentro de la misma transacción del envío; si
-- el envío se rechazaba (límite diario o por minuto) la devolución también se revertía. Ahora
-- también se devuelven al leer el saldo (monetization_state), que nunca se rechaza por límites.
-- F4: "Borrar conversación" no detenía una respuesta en camino, que la volvía a crear desde otro
-- dispositivo. Ahora el borrado cancela y devuelve los mensajes que esperan respuesta.

create function private.lumi_chat_reclaim(p_user uuid,p_older interval default interval '3 minutes') returns integer
language plpgsql set search_path='' as $$
declare stale private.lumi_chat_pending; n integer:=0;
begin
 for stale in select * from private.lumi_chat_pending where user_id=p_user and created_at<now()-p_older
  order by created_at for update skip locked loop
  if private.lumi_chat_refund_pending(stale) then n:=n+1; end if;
 end loop;
 return n;
end $$;

create or replace function public.monetization_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); s private.credit_settings; snap jsonb; tz_today date; ads_today integer;
 sub private.play_subscriptions; r private.referrals; month_start timestamptz; rewarded integer;
begin
 select * into s from private.credit_settings where id;
 perform private.ensure_credit_account(u);
 -- Devuelve los mensajes a Lumi que nunca recibieron respuesta antes de mostrar el saldo.
 perform private.lumi_chat_reclaim(u);
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

-- Botón "Borrar conversación": también cancela (y devuelve) lo que espera respuesta, para que una
-- respuesta tardía no vuelva a crear la conversación. lumi_chat_finish la rechaza: "ya no está disponible".
create or replace function public.lumi_chat_clear() returns integer
language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); n integer;
begin
 perform private.lumi_chat_reclaim(u,interval '0 seconds');
 delete from public.lumi_chat_messages where user_id=u;
 get diagnostics n=row_count;
 return n;
end $$;

revoke all on function private.lumi_chat_reclaim(uuid,interval) from public,anon,authenticated;
revoke all on function public.monetization_state(),public.lumi_chat_clear() from public,anon;
grant execute on function public.monetization_state(),public.lumi_chat_clear() to authenticated;
