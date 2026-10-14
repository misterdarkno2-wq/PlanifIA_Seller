-- Respaldo en la nube (NVIDIA NIM) cuando la IA local del PC no está disponible.
-- La señal de "PC encendido" es last_worker_at: el trabajador sólo la renueva cuando su
-- /health confirma que Ollama responde. La nube nunca la renueva, para no ocultar que el PC
-- está apagado. Los créditos se cobran y devuelven igual que con la IA local.
alter table public.ai_jobs add column provider text not null default 'local' check(provider in ('local','cloud'));
grant select(provider) on public.ai_jobs to authenticated;

create table private.ai_fallback_settings (
 id boolean primary key default true check(id),
 enabled boolean not null default true,
 -- Segundos sin señal del trabajador para considerar apagada la IA local.
 worker_stale_seconds integer not null default 45 check(worker_stale_seconds between 15 and 600),
 -- Límites de la nube por persona (además de los créditos) y de toda la app, para proteger la cuota.
 chat_per_hour integer not null default 30 check(chat_per_hour between 0 and 1000),
 plans_per_day integer not null default 6 check(plans_per_day between 0 and 100),
 global_chat_per_day integer not null default 2000 check(global_chat_per_day between 0 and 100000),
 global_plans_per_day integer not null default 200 check(global_plans_per_day between 0 and 10000)
);
insert into private.ai_fallback_settings(id) values(true);

create table private.ai_fallback_usage (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('chat','plan')),
 used_at timestamptz not null default now()
);
create index ai_fallback_usage_user on private.ai_fallback_usage(user_id,kind,used_at);
create index ai_fallback_usage_kind on private.ai_fallback_usage(kind,used_at);

create function public.ai_local_online() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(q.last_worker_at>now()-make_interval(secs=>f.worker_stale_seconds),false)
 from private.ai_queue_settings q cross join private.ai_fallback_settings f where q.id and f.id
$$;

-- Registra un uso de la nube si el límite lo permite. false = límite alcanzado o respaldo apagado.
create function public.ai_fallback_take(p_user uuid,p_kind text) returns boolean
language plpgsql security definer set search_path='' as $$
declare f private.ai_fallback_settings; mine integer; everyone integer; mine_limit integer; app_limit integer;
begin
 if p_user is null or p_kind not in ('chat','plan') then raise exception 'Solicitud inválida.'; end if;
 select * into f from private.ai_fallback_settings where id;
 if not f.enabled then return false; end if;
 -- Serializa los usos de una misma cuenta para que dos mensajes simultáneos no superen el límite.
 perform pg_advisory_xact_lock(hashtext('ai_fallback:'||p_user::text));
 delete from private.ai_fallback_usage where used_at<now()-interval '2 days';
 select count(*) into mine from private.ai_fallback_usage where user_id=p_user and kind=p_kind
  and used_at>now()-case when p_kind='chat' then interval '1 hour' else interval '1 day' end;
 select count(*) into everyone from private.ai_fallback_usage where kind=p_kind and used_at>now()-interval '1 day';
 if p_kind='chat' then mine_limit:=f.chat_per_hour; app_limit:=f.global_chat_per_day;
 else mine_limit:=f.plans_per_day; app_limit:=f.global_plans_per_day; end if;
 if mine>=mine_limit or everyone>=app_limit then return false; end if;
 insert into private.ai_fallback_usage(user_id,kind) values(p_user,p_kind);
 return true;
end $$;

-- El trabajador local cuenta sólo sus propias generaciones: una propuesta que prepara la nube
-- no ocupa la plaza de la GPU cuando el PC vuelve a encenderse.
create or replace function public.claim_ai_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.ai_queue_settings; j public.ai_jobs;
begin
 -- All worker processes share this transaction lock and this concurrency limit.
 perform pg_advisory_xact_lock(610050001);
 select * into cfg from private.ai_queue_settings where id;
 update private.ai_queue_settings set last_worker_at=now() where id;
 update public.ai_jobs set status=case when cancel_requested then 'cancelled' else 'error' end,
  finished_at=now(),updated_at=now(),error=case when cancel_requested then null else 'Se agotó el tiempo de espera o los reintentos. Puedes crear otra solicitud.' end,
  lease_token=null,lease_until=null
 where (status='queued' and created_at<now()-make_interval(secs=>cfg.max_wait_seconds))
  or (status='processing' and lease_until<now() and (cancel_requested or attempts>=cfg.max_attempts));
 update public.ai_jobs set status='queued',updated_at=now(),lease_token=null,lease_until=null,available_at=now()+interval '10 seconds'
 where status='processing' and lease_until<now();
 if (select count(*) from public.ai_jobs where status='processing' and provider='local')>=cfg.concurrency then return null; end if;
 select * into j from public.ai_jobs where status='queued' and available_at<=now()
 order by priority+floor(extract(epoch from (now()-created_at))/cfg.aging_seconds) desc,created_at,id limit 1 for update skip locked;
 if not found then return null; end if;
 update public.ai_jobs set status='processing',provider='local',attempts=attempts+1,started_at=now(),updated_at=now(),error=null,
 lease_token=gen_random_uuid(),lease_until=now()+make_interval(secs=>cfg.lease_seconds) where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'lease_token',j.lease_token,'payload',(select payload from private.ai_job_payloads where job_id=j.id),'timeout_ms',cfg.timeout_seconds*1000);
end $$;

-- La función ai-fallback toma una solicitud en cola de ESA cuenta sólo si la IA local está
-- apagada. No renueva last_worker_at. Devuelve status: local_online, none, limited o claimed.
create function public.claim_ai_job_cloud(p_user uuid,p_job uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.ai_queue_settings; j public.ai_jobs;
begin
 if p_user is null then raise exception 'Solicitud inválida.'; end if;
 perform pg_advisory_xact_lock(610050001);
 if public.ai_local_online() then return jsonb_build_object('status','local_online'); end if;
 select * into cfg from private.ai_queue_settings where id;
 -- Con el PC apagado nadie más ordena la cola: se cierran o se reencolan las solicitudes vencidas de la cuenta.
 update public.ai_jobs set status=case when cancel_requested then 'cancelled' else 'error' end,
  finished_at=now(),updated_at=now(),error=case when cancel_requested then null else 'Se agotó el tiempo de espera o los reintentos. Puedes crear otra solicitud.' end,
  lease_token=null,lease_until=null
 where user_id=p_user and ((status='queued' and created_at<now()-make_interval(secs=>cfg.max_wait_seconds))
  or (status='processing' and lease_until<now() and (cancel_requested or attempts>=cfg.max_attempts)));
 update public.ai_jobs set status='queued',updated_at=now(),lease_token=null,lease_until=null,available_at=now()
 where user_id=p_user and status='processing' and lease_until<now();
 select * into j from public.ai_jobs where user_id=p_user and status='queued' and not cancel_requested
  and available_at<=now() and (p_job is null or id=p_job)
 order by created_at,id limit 1 for update skip locked;
 if not found then return jsonb_build_object('status','none'); end if;
 if not public.ai_fallback_take(p_user,'plan') then return jsonb_build_object('status','limited'); end if;
 update public.ai_jobs set status='processing',provider='cloud',attempts=attempts+1,started_at=now(),updated_at=now(),error=null,
 lease_token=gen_random_uuid(),lease_until=now()+make_interval(secs=>cfg.lease_seconds) where id=j.id returning * into j;
 return jsonb_build_object('status','claimed','id',j.id,'lease_token',j.lease_token,
  'payload',(select payload from private.ai_job_payloads where job_id=j.id),'timeout_ms',cfg.timeout_seconds*1000);
end $$;

create or replace function private.ai_job_view(j public.ai_jobs) returns jsonb language plpgsql stable set search_path='' as $$
declare cfg private.ai_queue_settings; position integer; average_seconds numeric; running integer;
begin
 select * into cfg from private.ai_queue_settings where id;
 if j.status='queued' then
  select count(*)+1 into position from public.ai_jobs q where q.status='queued' and
   (q.priority+floor(extract(epoch from (now()-q.created_at))/cfg.aging_seconds)>j.priority+floor(extract(epoch from (now()-j.created_at))/cfg.aging_seconds)
   or (q.priority+floor(extract(epoch from (now()-q.created_at))/cfg.aging_seconds)=j.priority+floor(extract(epoch from (now()-j.created_at))/cfg.aging_seconds) and (q.created_at,q.id)<(j.created_at,j.id)));
 end if;
 select avg(seconds) into average_seconds from (
  select extract(epoch from (finished_at-started_at)) seconds from public.ai_jobs
  where status='completed' and started_at is not null and provider='local' order by finished_at desc limit 20
 ) observations;
 select count(*) into running from public.ai_jobs where status='processing' and provider='local';
 return jsonb_build_object('id',j.id,'request_id',j.request_id,'kind',j.kind,'plan_id',j.plan_id,'status',j.status,
  'created_at',j.created_at,'cancel_requested',j.cancel_requested,'attempts',j.attempts,'result',j.result,'error',j.error,
  'provider',j.provider,
  'position',position,'estimated_seconds',case when average_seconds is not null and position is not null then
    ceil(average_seconds*greatest(0,position-1+running)/cfg.concurrency) else null end,
  -- Mismo umbral que usa el servidor para decidir el respaldo: la app no lo pide antes de tiempo.
  'worker_online',public.ai_local_online());
end $$;

revoke all on table private.ai_fallback_settings,private.ai_fallback_usage from public,anon,authenticated;
revoke all on function public.ai_local_online(),public.ai_fallback_take(uuid,text),public.claim_ai_job_cloud(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_local_online(),public.ai_fallback_take(uuid,text),public.claim_ai_job_cloud(uuid,uuid) to service_role;
