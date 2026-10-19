-- Prueba de aceptación de los Términos y la Política de privacidad, reportes de contenido de la IA y
-- límites por dirección IP. Ver docs/auditoria-legal-seguridad-2026-10-18.md.
--
-- 1. public.legal_acceptances: historial por cuenta de las versiones aceptadas, con la fecha y hora del
--    servidor y la plataforma. La persona lo puede leer pero no modificar: sólo escriben las funciones.
--    Al crear la cuenta lo registra un trigger con lo que la app envía en raw_user_meta_data->'legal'
--    (la sesión todavía no existe porque se confirma el correo); después, accept_legal().
-- 2. public.ai_content_reports: reportes de respuestas de Lumi y de planes propuestos por la IA. El
--    servidor guarda su propia copia del contenido, tomada de la base. Los revisa el dueño desde el
--    panel de Supabase (consulta en docs/plan-incidentes.md).
-- 3. private.rate_limits: límite por IP para las funciones que gastan IA. Sólo guarda un hash con
--    secreto de la IP, por ventanas de pocos minutos, y borra lo que tiene más de un día.

create function private.legal_version_ok(p_version text) returns boolean
language plpgsql stable set search_path='' as $$
begin
 if p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
 return p_version::date between date '2026-01-01' and current_date + 1;
exception when others then
 return false;
end $$;

create table public.legal_acceptances (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 terms_version text not null check(terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 privacy_version text not null check(privacy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 platform text not null check(platform in ('web','android','desktop')),
 age_confirmed boolean not null check(age_confirmed),
 source text not null check(source in ('signup','update')),
 accepted_at timestamptz not null default now()
);
create index legal_acceptances_owner on public.legal_acceptances(user_id,accepted_at desc);
alter table public.legal_acceptances enable row level security;
create policy own_read on public.legal_acceptances for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.legal_acceptances from public,anon,authenticated;
grant select on public.legal_acceptances to authenticated;

-- Nunca impide crear la cuenta: si los datos no son válidos no registra nada y la app pedirá aceptar.
create function private.record_signup_acceptance() returns trigger
language plpgsql security definer set search_path='' as $$
declare legal jsonb:=new.raw_user_meta_data->'legal';
begin
 if jsonb_typeof(legal)='object' and legal->>'age_confirmed'='true'
  and private.legal_version_ok(legal->>'terms_version') and private.legal_version_ok(legal->>'privacy_version')
  and coalesce(legal->>'platform','') in ('web','android','desktop') then
  insert into public.legal_acceptances(user_id,terms_version,privacy_version,platform,age_confirmed,source)
  values(new.id,legal->>'terms_version',legal->>'privacy_version',legal->>'platform',true,'signup');
 end if;
 return new;
exception when others then
 return new;
end $$;
create trigger planifia_signup_acceptance after insert on auth.users
 for each row execute function private.record_signup_acceptance();

create function public.accept_legal(p_terms_version text,p_privacy_version text,p_platform text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); r public.legal_acceptances;
begin
 if not private.legal_version_ok(p_terms_version) or not private.legal_version_ok(p_privacy_version) then
  raise exception 'La versión de los términos no es válida. Actualiza la app.' using errcode='P0001';
 end if;
 if p_platform is null or p_platform not in ('web','android','desktop') then
  raise exception 'Plataforma no válida.' using errcode='P0001';
 end if;
 -- Un doble toque o un reintento no crean filas nuevas.
 select * into r from public.legal_acceptances
  where user_id=u and terms_version=p_terms_version and privacy_version=p_privacy_version and platform=p_platform
   and accepted_at>now()-interval '1 hour'
  order by accepted_at desc limit 1;
 if not found then
  insert into public.legal_acceptances(user_id,terms_version,privacy_version,platform,age_confirmed,source)
  values(u,p_terms_version,p_privacy_version,p_platform,true,'update') returning * into r;
 end if;
 return jsonb_build_object('terms_version',r.terms_version,'privacy_version',r.privacy_version,
  'platform',r.platform,'accepted_at',r.accepted_at);
end $$;

create table public.ai_content_reports (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('chat','plan')),
 -- Sin clave foránea: "Borrar conversación" elimina el mensaje, pero el reporte conserva su copia.
 message_id bigint,
 job_id uuid,
 provider text,
 content text not null check(length(content) between 1 and 8000),
 reason text not null check(reason in ('offensive','harmful','wrong','other')),
 details text not null default '' check(length(details)<=500),
 status text not null default 'open' check(status in ('open','reviewed','actioned','dismissed')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 check((kind='chat' and message_id is not null and job_id is null) or (kind='plan' and job_id is not null and message_id is null))
);
create unique index ai_content_reports_chat_once on public.ai_content_reports(user_id,message_id) where kind='chat';
create unique index ai_content_reports_plan_once on public.ai_content_reports(user_id,job_id) where kind='plan';
create index ai_content_reports_open on public.ai_content_reports(status,created_at);
create index ai_content_reports_owner on public.ai_content_reports(user_id,created_at);
alter table public.ai_content_reports enable row level security;
create policy own_read on public.ai_content_reports for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.ai_content_reports from public,anon,authenticated;
grant select on public.ai_content_reports to authenticated;

-- p_ref: id del mensaje de Lumi o de la solicitud de IA. Para un mensaje recién recibido (sin id en la
-- app) se busca el último que Lumi le dijo a esta cuenta con ese mismo texto.
create function public.report_ai_content(p_kind text,p_ref text,p_content text,p_reason text,p_details text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); m public.lumi_chat_messages; j public.ai_jobs; r public.ai_content_reports;
 recent integer; details text:=btrim(coalesce(p_details,''));
begin
 if p_reason is null or p_reason not in ('offensive','harmful','wrong','other') then
  raise exception 'Elige qué problema tiene.' using errcode='P0001';
 end if;
 if length(details)>500 then raise exception 'Los detalles pueden tener hasta 500 caracteres.' using errcode='P0001'; end if;
 -- Serializa los reportes de la cuenta para que el límite diario no se pueda saltar en paralelo.
 perform pg_advisory_xact_lock(hashtextextended('planifia-ai-report:'||u::text,0));
 select count(*) into recent from public.ai_content_reports where user_id=u and created_at>now()-interval '1 day';
 if p_kind='chat' then
  if coalesce(p_ref,'') ~ '^[0-9]{1,18}$' then
   select * into m from public.lumi_chat_messages where id=p_ref::bigint and user_id=u and role='lumi';
  end if;
  if m.id is null and length(coalesce(p_content,'')) between 1 and 4000 then
   select * into m from public.lumi_chat_messages where user_id=u and role='lumi' and content=p_content
    order by id desc limit 1;
  end if;
  if m.id is null then
   raise exception 'No encontramos esa respuesta de Lumi en tu conversación.' using errcode='P0001';
  end if;
  select * into r from public.ai_content_reports where user_id=u and kind='chat' and message_id=m.id;
  if not found then
   if recent>=20 then raise exception 'Ya enviaste muchos reportes hoy. Si es urgente, escríbenos a planifiaprivacity@gmail.com.' using errcode='P0001'; end if;
   insert into public.ai_content_reports(user_id,kind,message_id,content,reason,details)
   values(u,'chat',m.id,m.content,p_reason,details) returning * into r;
  end if;
 elsif p_kind='plan' then
  if coalesce(p_ref,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'No encontramos esa propuesta en tu cuenta.' using errcode='P0001';
  end if;
  select * into j from public.ai_jobs where id=p_ref::uuid and user_id=u and result is not null;
  if not found then raise exception 'No encontramos esa propuesta en tu cuenta.' using errcode='P0001'; end if;
  select * into r from public.ai_content_reports where user_id=u and kind='plan' and job_id=j.id;
  if not found then
   if recent>=20 then raise exception 'Ya enviaste muchos reportes hoy. Si es urgente, escríbenos a planifiaprivacity@gmail.com.' using errcode='P0001'; end if;
   insert into public.ai_content_reports(user_id,kind,job_id,provider,content,reason,details)
   values(u,'plan',j.id,j.provider,left(coalesce(j.result->'proposal',j.result)::text,8000),p_reason,details)
   returning * into r;
  end if;
 else
  raise exception 'Tipo de contenido no válido.' using errcode='P0001';
 end if;
 return jsonb_build_object('id',r.id,'status',r.status,'created_at',r.created_at);
end $$;

create table private.rate_limits (
 bucket text not null,
 key text not null,
 window_start timestamptz not null,
 hits integer not null default 0,
 primary key(bucket,key,window_start)
);
create index rate_limits_age on private.rate_limits(window_start);

-- p_key es un hash SHA-256 con secreto de la IP, calculado en la Edge Function: la IP no llega a la base.
create function public.rate_limit_take(p_bucket text,p_key text,p_limit integer,p_window_seconds integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare w timestamptz; counted integer;
begin
 if coalesce(p_bucket,'') !~ '^[a-z_]{1,32}$' or coalesce(p_key,'') !~ '^[0-9a-f]{64}$'
  or p_limit is null or p_limit not between 1 and 100000
  or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
  raise exception 'Límite no válido.';
 end if;
 w:=to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);
 insert into private.rate_limits(bucket,key,window_start,hits) values(p_bucket,p_key,w,1)
 on conflict(bucket,key,window_start) do update set hits=private.rate_limits.hits+1
  where private.rate_limits.hits<p_limit
 returning hits into counted;
 delete from private.rate_limits where window_start<now()-interval '1 day';
 return counted is not null;
end $$;

revoke all on all tables in schema private from public,anon,authenticated;
revoke all on function private.legal_version_ok(text),private.record_signup_acceptance() from public,anon,authenticated;
revoke all on function public.accept_legal(text,text,text),public.report_ai_content(text,text,text,text,text) from public,anon;
grant execute on function public.accept_legal(text,text,text),public.report_ai_content(text,text,text,text,text) to authenticated;
-- El dueño revisa los reportes desde el panel (rol postgres o service_role).
grant all on public.legal_acceptances,public.ai_content_reports to service_role;
revoke all on function public.rate_limit_take(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.rate_limit_take(text,text,integer,integer) to service_role;
