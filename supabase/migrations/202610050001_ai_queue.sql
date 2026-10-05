-- Persistent queue. Only the authenticated Edge function can submit snapshots;
-- only the private GPU worker can claim them. Browsers never set priority.
create table private.ai_queue_settings (
 id boolean primary key default true check(id),
 concurrency integer not null default 1 check(concurrency between 1 and 4),
 priorities jsonb not null default '{"free":0,"plus":10,"pro":20}',
 aging_seconds integer not null default 60 check(aging_seconds between 1 and 3600),
 per_user_limit integer not null default 1 check(per_user_limit between 1 and 5),
 daily_limit integer not null default 8 check(daily_limit between 1 and 1000),
 lease_seconds integer not null default 180 check(lease_seconds between 150 and 600),
 timeout_seconds integer not null default 125 check(timeout_seconds between 5 and 125),
 max_wait_seconds integer not null default 86400 check(max_wait_seconds between 60 and 604800),
 max_attempts integer not null default 3 check(max_attempts between 1 and 5),
 last_worker_at timestamptz
);
insert into private.ai_queue_settings(id) values(true);
create table public.ai_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 kind text not null check(kind in ('generation','adjustment')),
 plan_id text not null references public.plan_catalog(id),
 priority integer not null,
 status text not null default 'queued' check(status in ('queued','processing','completed','cancelled','error')),
 attempts integer not null default 0,
 cancel_requested boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 started_at timestamptz,
 finished_at timestamptz,
 available_at timestamptz not null default now(),
 lease_until timestamptz,
 lease_token uuid,
 result jsonb,
 error text,
 unique(user_id,request_id)
);
create index ai_jobs_schedule on public.ai_jobs(status,available_at,created_at);
create index ai_jobs_user on public.ai_jobs(user_id,created_at desc);
create table private.ai_job_payloads (
 job_id uuid primary key references public.ai_jobs(id) on delete cascade,
 fingerprint text not null,
 payload jsonb not null
);
alter table public.ai_jobs enable row level security;
create policy own_ai_jobs on public.ai_jobs for select to authenticated using(user_id=auth.uid());
revoke all on public.ai_jobs from public,anon,authenticated;
-- Lease tokens are deliberately not exposed to the browser.
grant select(id,user_id,request_id,kind,plan_id,status,attempts,cancel_requested,created_at,updated_at,started_at,finished_at,result,error) on public.ai_jobs to authenticated;
grant all on public.ai_jobs to service_role;

create function public.enqueue_ai_job(p_user_id uuid,p_request_id uuid,p_kind text,p_input jsonb,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs; cfg private.ai_queue_settings; plan public.plan_catalog;
begin
 if p_request_id is null or p_kind not in ('generation','adjustment') or length(p_payload::text)>250000 then
  raise exception 'Solicitud inválida.';
 end if;
 -- Same lock order as the plan quota RPC. Serializes requests from one account.
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
 -- An exception rolls back BOTH reservations, including a rejected monthly quota.
 if not public.reserve_plan_ai(p_user_id,p_kind) then raise exception 'Llegaste al límite de metas o IA de tu plan. Consulta Mi plan; puedes seguir editando manualmente.'; end if;
 if not public.reserve_ai_request(p_user_id,cfg.daily_limit) then raise exception 'Llegaste al límite diario de propuestas. Puedes seguir editando manualmente.'; end if;
 insert into public.ai_jobs(user_id,request_id,kind,plan_id,priority)
 values(p_user_id,p_request_id,p_kind,plan.id,coalesce((cfg.priorities->>plan.id)::integer,0)) returning * into j;
 insert into private.ai_job_payloads values(j.id,md5(p_input::text),p_payload);
 return jsonb_build_object('id',j.id,'status',j.status,'reused',false);
end $$;

create function private.ai_job_view(j public.ai_jobs) returns jsonb language plpgsql stable set search_path='' as $$
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
  where status='completed' and started_at is not null order by finished_at desc limit 20
 ) observations;
 select count(*) into running from public.ai_jobs where status='processing';
 return jsonb_build_object('id',j.id,'request_id',j.request_id,'kind',j.kind,'plan_id',j.plan_id,'status',j.status,
  'created_at',j.created_at,'cancel_requested',j.cancel_requested,'attempts',j.attempts,'result',j.result,'error',j.error,
  'position',position,'estimated_seconds',case when average_seconds is not null and position is not null then
    ceil(average_seconds*greatest(0,position-1+running)/cfg.concurrency) else null end,
  'worker_online',coalesce(cfg.last_worker_at>now()-interval '30 seconds',false));
end $$;
create function public.get_ai_jobs(p_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
 select coalesce(jsonb_agg(private.ai_job_view(j) order by j.created_at desc),'[]'::jsonb) into result
 from (select * from public.ai_jobs where user_id=auth.uid() and (p_id is null or id=p_id) order by created_at desc limit 20) j;
 return result;
end $$;
create function public.cancel_ai_job(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs;
begin
 select * into j from public.ai_jobs where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'Solicitud no encontrada.'; end if;
 if j.status='queued' then
  update public.ai_jobs set status='cancelled',cancel_requested=true,finished_at=now(),updated_at=now() where id=j.id returning * into j;
 elsif j.status='processing' then
  update public.ai_jobs set cancel_requested=true,updated_at=now() where id=j.id returning * into j;
 end if;
 return private.ai_job_view(j);
end $$;

create function public.claim_ai_job() returns jsonb language plpgsql security definer set search_path='' as $$
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
 if (select count(*) from public.ai_jobs where status='processing')>=cfg.concurrency then return null; end if;
 select * into j from public.ai_jobs where status='queued' and available_at<=now()
 order by priority+floor(extract(epoch from (now()-created_at))/cfg.aging_seconds) desc,created_at,id limit 1 for update skip locked;
 if not found then return null; end if;
 update public.ai_jobs set status='processing',attempts=attempts+1,started_at=now(),updated_at=now(),error=null,
 lease_token=gen_random_uuid(),lease_until=now()+make_interval(secs=>cfg.lease_seconds) where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'lease_token',j.lease_token,'payload',(select payload from private.ai_job_payloads where job_id=j.id),'timeout_ms',cfg.timeout_seconds*1000);
end $$;
create function public.heartbeat_ai_job(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs; cfg private.ai_queue_settings;
begin
 select * into cfg from private.ai_queue_settings where id;
 update private.ai_queue_settings set last_worker_at=now() where id;
 update public.ai_jobs set lease_until=now()+make_interval(secs=>cfg.lease_seconds),updated_at=now()
 where id=p_id and lease_token=p_token and status='processing' and lease_until>now() returning * into j;
 if not found then return jsonb_build_object('owned',false); end if;
 return jsonb_build_object('owned',true,'cancel_requested',j.cancel_requested);
end $$;
create function public.finish_ai_job(p_id uuid,p_token uuid,p_result jsonb default null,p_error text default null,p_retry boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.ai_jobs; cfg private.ai_queue_settings; next_status text;
begin
 select * into cfg from private.ai_queue_settings where id;
 select * into j from public.ai_jobs where id=p_id and lease_token=p_token and status='processing' and lease_until>now() for update;
 if not found then return false; end if;
 next_status:=case when j.cancel_requested then 'cancelled' when p_result is not null then 'completed'
  when p_retry and j.attempts<cfg.max_attempts then 'queued' else 'error' end;
 if p_result is not null and length(p_result::text)>250000 then raise exception 'Resultado demasiado grande.'; end if;
 update public.ai_jobs set status=next_status,updated_at=now(),
  finished_at=case when next_status='queued' then null else now() end,
  available_at=now()+make_interval(secs=>10*j.attempts),lease_token=null,lease_until=null,
  result=case when next_status='completed' then p_result else null end,
  error=case when next_status in ('queued','error') then left(coalesce(p_error,'No pudimos preparar la propuesta.'),500) else null end where id=j.id;
 return true;
end $$;
revoke all on function private.ai_job_view(public.ai_jobs) from public,anon,authenticated;
revoke all on function public.get_ai_jobs(uuid),public.cancel_ai_job(uuid) from public,anon;
grant execute on function public.get_ai_jobs(uuid),public.cancel_ai_job(uuid) to authenticated;
revoke all on function public.enqueue_ai_job(uuid,uuid,text,jsonb,jsonb),public.claim_ai_job(),public.heartbeat_ai_job(uuid,uuid),public.finish_ai_job(uuid,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_ai_job(uuid,uuid,text,jsonb,jsonb),public.claim_ai_job(),public.heartbeat_ai_job(uuid,uuid),public.finish_ai_job(uuid,uuid,jsonb,text,boolean) to service_role;
