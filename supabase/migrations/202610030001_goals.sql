create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 name text not null default '' check(length(name)<=80),
 timezone text not null default 'America/Santiago',
 weekly_minutes integer not null default 180 check(weekly_minutes between 30 and 3360),
 available_days integer[] not null default array[1,2,3,4,5],
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.goals (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 160), description text not null default '' check(length(description)<=3000),
 category text not null check(category in ('personal','professional','learning','wellbeing','creative','project')),
 status text not null default 'active' check(status in ('active','paused','achieved','archived')),
 current_situation text not null default '' check(length(current_situation)<=2000), outcome text not null default '' check(length(outcome)<=1000),
 target_date date, weekly_minutes integer not null default 180 check(weekly_minutes between 30 and 3360),
 version integer not null default 1, achieved_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table public.milestones (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 goal_id uuid not null, title text not null check(length(title) between 1 and 160), position integer not null default 0,
 created_at timestamptz not null default now(), unique(id,goal_id,user_id),
 foreign key(goal_id,user_id) references public.goals(id,user_id) on delete cascade
);
create table public.tasks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 goal_id uuid, milestone_id uuid, title text not null check(length(title) between 1 and 160),
 description text not null default '' check(length(description)<=3000), area text not null default '' check(length(area)<=80),
 priority text not null default 'medium' check(priority in ('low','medium','high')),
 status text not null default 'pending' check(status in ('pending','completed','cancelled')),
 deadline date, scheduled_date date, minutes integer not null default 30 check(minutes between 5 and 6000),
 completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,user_id), check(milestone_id is null or goal_id is not null),
 foreign key(goal_id,user_id) references public.goals(id,user_id),
 foreign key(milestone_id,goal_id,user_id) references public.milestones(id,goal_id,user_id)
);
create table public.habits (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 goal_id uuid, title text not null check(length(title) between 1 and 160),
 days integer[] not null default array[0,1,2,3,4,5,6], minutes integer not null default 10 check(minutes between 5 and 120),
 priority text not null default 'low' check(priority in ('low','medium','high')), active boolean not null default true,
 created_at timestamptz not null default now(), unique(id,user_id),
 foreign key(goal_id,user_id) references public.goals(id,user_id)
);
create table public.habit_completions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 habit_id uuid not null, day date not null, completed boolean not null default true,
 completed_at timestamptz not null default now(), unique(habit_id,day), unique(id,user_id),
 foreign key(habit_id,user_id) references public.habits(id,user_id)
);
create table public.pets (
 user_id uuid primary key references auth.users(id) on delete cascade, name text not null default 'Lumi' check(length(name) between 1 and 40),
 total_xp integer not null default 0 check(total_xp>=0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.xp_rewards (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid, completion_id uuid, xp_awarded integer not null check(xp_awarded>0), active boolean not null default true,
 awarded_at timestamptz not null default now(), revoked_at timestamptz,
 check(num_nonnulls(task_id,completion_id)=1), unique(task_id), unique(completion_id), unique(id,user_id),
 foreign key(task_id,user_id) references public.tasks(id,user_id),
 foreign key(completion_id,user_id) references public.habit_completions(id,user_id)
);
create table public.xp_events (
 id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade,
 reward_id uuid not null, delta integer not null, created_at timestamptz not null default now(),
 foreign key(reward_id,user_id) references public.xp_rewards(id,user_id)
);
create table public.imports (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 source text not null, fingerprint text not null, original jsonb not null, imported_at timestamptz not null default now(), unique(user_id,source,fingerprint)
);
create table private.import_items (user_id uuid not null references auth.users(id) on delete cascade,source text not null, source_key text not null,task_id uuid not null references public.tasks(id),primary key(user_id,source,source_key));
create table private.commands (user_id uuid not null references auth.users(id) on delete cascade,id uuid not null,operation jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,id));
create table private.ai_usage (user_id uuid not null references auth.users(id) on delete cascade,day date not null,requests integer not null default 0,primary key(user_id,day));
create table private.game_rules (id boolean primary key default true check(id),low_xp integer not null default 10 check(low_xp>0),medium_xp integer not null default 20 check(medium_xp>0),high_xp integer not null default 35 check(high_xp>0),early_bonus integer not null default 5 check(early_bonus>=0),first_level integer not null default 100 check(first_level>0),level_increment integer not null default 35 check(level_increment>0),max_level integer not null default 20 check(max_level>=20));
insert into private.game_rules(id) values(true);

create index tasks_owner_schedule on public.tasks(user_id,scheduled_date);
create index goals_owner on public.goals(user_id,status);
create index milestones_owner on public.milestones(user_id,goal_id);
create index habits_owner on public.habits(user_id);
create index rewards_owner on public.xp_rewards(user_id);

do $$ declare t text; begin
 foreach t in array array['profiles','goals','milestones','tasks','habits','habit_completions','pets','xp_rewards','xp_events','imports'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy own_read on public.%I for select to authenticated using (user_id=(select auth.uid()))',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;

create function private.require_user() returns uuid language plpgsql stable set search_path='' as $$
begin if auth.uid() is null then raise exception 'Inicia sesión para continuar.' using errcode='42501'; end if; return auth.uid(); end $$;
create function private.local_today(p_uid uuid) returns date language sql stable set search_path='' as $$ select (now() at time zone timezone)::date from public.profiles where user_id=p_uid $$;
create function private.initialize_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(user_id,name) values(new.id,left(coalesce(new.raw_user_meta_data->>'name',''),80));
 insert into public.pets(user_id) values(new.id);
 return new;
end $$;
create trigger planifia_new_user after insert on auth.users for each row execute function private.initialize_user();
insert into public.profiles(user_id) select id from auth.users on conflict do nothing;
insert into public.pets(user_id) select id from auth.users on conflict do nothing;

create function private.pet_json(p_uid uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare r private.game_rules; p public.pets; l integer:=1; f integer:=0; need integer;
begin
 select * into r from private.game_rules; select * into p from public.pets where user_id=p_uid;
 while l<r.max_level loop need:=r.first_level+(l-1)*r.level_increment;exit when p.total_xp<f+need;f:=f+need;l:=l+1;end loop;
 return jsonb_build_object('name',p.name,'total_xp',p.total_xp,'level',l,'stage',least(5,1+l/5),'level_xp',p.total_xp-f,'next_xp',case when l=r.max_level then null else r.first_level+(l-1)*r.level_increment end);
end $$;
create function public.pet_state() returns jsonb language sql security definer stable set search_path='' as $$ select private.pet_json(private.require_user()) $$;

create function private.cached(p_uid uuid,p_id uuid,p_operation jsonb) returns jsonb language plpgsql set search_path='' as $$
declare c private.commands;
begin select * into c from private.commands where user_id=p_uid and id=p_id;
 if found then if c.operation<>p_operation then raise exception 'Este identificador ya pertenece a otra operación.';end if; return c.result;end if;
 return null;
end $$;
create function private.record_command(p_uid uuid,p_id uuid,p_operation jsonb,p_result jsonb) returns jsonb language plpgsql set search_path='' as $$
begin insert into private.commands(user_id,id,operation,result) values(p_uid,p_id,p_operation,p_result);return p_result;end $$;

create function public.save_profile(p_name text,p_timezone text,p_minutes integer,p_days integer[]) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();
begin
 perform 1 from public.pets where user_id=u for update;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Zona horaria inválida.';end if;
 if cardinality(p_days) not between 1 and 7 or not p_days<@array[0,1,2,3,4,5,6] or cardinality(p_days)<>(select count(distinct d) from unnest(p_days) d) then raise exception 'Días inválidos.';end if;
 update public.profiles set name=p_name,timezone=p_timezone,weekly_minutes=p_minutes,available_days=p_days,updated_at=now() where user_id=u;
end $$;
create function public.save_goal(p_data jsonb,p_id uuid default null,p_request_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); g uuid;
 result jsonb;op jsonb:=jsonb_build_object('goal_save',p_id,'data',p_data);
begin
 perform 1 from public.pets where user_id=u for update;
 if p_request_id is not null then result:=private.cached(u,p_request_id,op);if result is not null then return (result->>'entity_id')::uuid;end if;end if;
 if p_id is null then
  insert into public.goals(user_id,title,description,category,current_situation,outcome,target_date,weekly_minutes) values(u,p_data->>'title',coalesce(p_data->>'description',''),p_data->>'category',coalesce(p_data->>'current_situation',''),coalesce(p_data->>'outcome',''),nullif(p_data->>'target_date','')::date,(p_data->>'weekly_minutes')::integer) returning id into g;
 else
  update public.goals set title=p_data->>'title',description=coalesce(p_data->>'description',''),category=p_data->>'category',current_situation=coalesce(p_data->>'current_situation',''),outcome=coalesce(p_data->>'outcome',''),target_date=nullif(p_data->>'target_date','')::date,weekly_minutes=(p_data->>'weekly_minutes')::integer,updated_at=now(),version=version+1 where id=p_id and user_id=u returning id into g;
  if g is null then raise exception 'Meta no encontrada.' using errcode='42501';end if;
 end if;if p_request_id is not null then perform private.record_command(u,p_request_id,op,jsonb_build_object('entity_id',g));end if;return g;
end $$;
create function public.set_goal_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.pets where user_id=private.require_user() for update;
 update public.goals set status=p_status,achieved_at=case when p_status='achieved' then coalesce(achieved_at,now()) else null end,version=version+1,updated_at=now() where id=p_id and user_id=private.require_user();
 if not found then raise exception 'Meta no encontrada.' using errcode='42501';end if;
end $$;
create function public.save_task(p_data jsonb,p_id uuid default null,p_request_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();t uuid;old_goal uuid;g uuid:=nullif(p_data->>'goal_id','')::uuid;
 result jsonb;op jsonb:=jsonb_build_object('task_save',p_id,'data',p_data);
begin
 perform 1 from public.pets where user_id=u for update;
 if p_request_id is not null then result:=private.cached(u,p_request_id,op);if result is not null then return (result->>'entity_id')::uuid;end if;end if;
 if p_id is null then
  insert into public.tasks(user_id,goal_id,milestone_id,title,description,area,priority,deadline,scheduled_date,minutes) values(u,g,nullif(p_data->>'milestone_id','')::uuid,p_data->>'title',coalesce(p_data->>'description',''),coalesce(p_data->>'area',''),p_data->>'priority',nullif(p_data->>'deadline','')::date,nullif(p_data->>'scheduled_date','')::date,(p_data->>'minutes')::integer) returning id into t;
 else
  select goal_id into old_goal from public.tasks where id=p_id and user_id=u;
  update public.tasks set goal_id=g,milestone_id=nullif(p_data->>'milestone_id','')::uuid,title=p_data->>'title',description=coalesce(p_data->>'description',''),area=coalesce(p_data->>'area',''),priority=p_data->>'priority',deadline=nullif(p_data->>'deadline','')::date,scheduled_date=nullif(p_data->>'scheduled_date','')::date,minutes=(p_data->>'minutes')::integer,updated_at=now() where id=p_id and user_id=u returning id into t;
  if t is null then raise exception 'Acción no encontrada.' using errcode='42501';end if;
 end if;
 update public.goals set version=version+1,updated_at=now() where user_id=u and id in(g,old_goal);
 if p_request_id is not null then perform private.record_command(u,p_request_id,op,jsonb_build_object('entity_id',t));end if;return t;
end $$;

create function private.reward(p_uid uuid,p_task uuid,p_completion uuid,p_priority text,p_deadline date,p_complete boolean) returns integer language plpgsql set search_path='' as $$
declare r public.xp_rewards; rules private.game_rules;amount integer;delta integer:=0;
begin
 select * into r from public.xp_rewards where user_id=p_uid and (task_id=p_task or completion_id=p_completion) for update;
 if not found and p_complete then
  select * into rules from private.game_rules;
  amount:=case p_priority when 'low' then rules.low_xp when 'high' then rules.high_xp else rules.medium_xp end;
  if p_deadline is not null and private.local_today(p_uid)<p_deadline then amount:=amount+rules.early_bonus;end if;
  insert into public.xp_rewards(user_id,task_id,completion_id,xp_awarded) values(p_uid,p_task,p_completion,amount) returning * into r;delta:=amount;
 elsif r.id is not null and r.active<>p_complete then
  delta:=case when p_complete then r.xp_awarded else -r.xp_awarded end;
  update public.xp_rewards set active=p_complete,revoked_at=case when p_complete then null else now() end where id=r.id;
 end if;
 if delta<>0 then
  update public.pets set total_xp=total_xp+delta,updated_at=now() where user_id=p_uid;
  insert into public.xp_events(user_id,reward_id,delta) values(p_uid,r.id,delta);
 end if;return delta;
end $$;
create function public.set_task_status(p_id uuid,p_status text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();t public.tasks;delta integer:=0;result jsonb;op jsonb:=jsonb_build_object('task',p_id,'status',p_status);
begin
 if p_status is null or p_status not in ('pending','completed','cancelled') then raise exception 'Estado inválido.';end if;
 perform 1 from public.pets where user_id=u for update;
 result:=private.cached(u,p_request_id,op);if result is not null then return result;end if;
 select * into t from public.tasks where id=p_id and user_id=u for update;
 if not found then raise exception 'Acción no encontrada.' using errcode='42501';end if;
 if t.status<>p_status then
  delta:=private.reward(u,t.id,null,t.priority,t.deadline,p_status='completed');
  update public.tasks set status=p_status,completed_at=case when p_status='completed' then now() else null end,updated_at=now() where id=t.id;
  update public.goals set version=version+1,updated_at=now() where id=t.goal_id and user_id=u;
 end if;
 result:=jsonb_build_object('xp_delta',delta,'pet',private.pet_json(u));return private.record_command(u,p_request_id,op,result);
end $$;
create function public.save_habit(p_data jsonb,p_id uuid default null,p_request_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();h uuid;ds integer[];
 result jsonb;op jsonb:=jsonb_build_object('habit_save',p_id,'data',p_data);
begin
 perform 1 from public.pets where user_id=u for update;
 if p_request_id is not null then result:=private.cached(u,p_request_id,op);if result is not null then return (result->>'entity_id')::uuid;end if;end if;
 select array_agg(value::integer) into ds from jsonb_array_elements_text(p_data->'days');
 if cardinality(ds) not between 1 and 7 or not ds<@array[0,1,2,3,4,5,6] then raise exception 'Días inválidos.';end if;
 if p_id is null then insert into public.habits(user_id,goal_id,title,days,minutes,priority,active) values(u,nullif(p_data->>'goal_id','')::uuid,p_data->>'title',ds,(p_data->>'minutes')::integer,p_data->>'priority',coalesce((p_data->>'active')::boolean,true)) returning id into h;
 else update public.habits set title=p_data->>'title',days=ds,minutes=(p_data->>'minutes')::integer,priority=p_data->>'priority',active=coalesce((p_data->>'active')::boolean,true) where id=p_id and user_id=u returning id into h;
 if h is null then raise exception 'Hábito no encontrado.' using errcode='42501';end if;end if;if p_request_id is not null then perform private.record_command(u,p_request_id,op,jsonb_build_object('entity_id',h));end if;return h;
end $$;
create function public.set_habit_completion(p_id uuid,p_day date,p_completed boolean,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();h public.habits;c public.habit_completions;delta integer:=0;result jsonb;op jsonb:=jsonb_build_object('habit',p_id,'day',p_day,'completed',p_completed);
begin
 if p_completed is null then raise exception 'Indica si el cumplimiento está completado.';end if;
 perform 1 from public.pets where user_id=u for update;
 result:=private.cached(u,p_request_id,op);if result is not null then return result;end if;
 select * into h from public.habits where id=p_id and user_id=u for update;
 if not found then raise exception 'Hábito no encontrado.' using errcode='42501';end if;
 select * into c from public.habit_completions where habit_id=h.id and day=p_day;
 if p_day>private.local_today(u) or p_day<(h.created_at at time zone (select timezone from public.profiles where user_id=u))::date or (c.id is null and (not h.active or not extract(dow from p_day)::integer=any(h.days))) then raise exception 'Ese día no corresponde a un cumplimiento del hábito.';end if;
 if c.id is null and p_completed then
  insert into public.habit_completions(user_id,habit_id,day) values(u,h.id,p_day) returning * into c;
  delta:=private.reward(u,null,c.id,h.priority,null,true);
 elsif c.id is not null and c.completed<>p_completed then
  update public.habit_completions set completed=p_completed,completed_at=now() where id=c.id;
  delta:=private.reward(u,null,c.id,h.priority,null,p_completed);
 end if;
 result:=jsonb_build_object('xp_delta',delta,'pet',private.pet_json(u));return private.record_command(u,p_request_id,op,result);
end $$;

create function public.reserve_ai_request(p_user_id uuid,p_limit integer) returns boolean language plpgsql security definer set search_path='' as $$
declare counted integer;
begin
 if p_limit<1 or p_limit>1000 then raise exception 'Límite inválido.';end if;
 insert into private.ai_usage(user_id,day,requests) values(p_user_id,current_date,1) on conflict(user_id,day) do update set requests=private.ai_usage.requests+1 where private.ai_usage.requests<p_limit returning requests into counted;
 return counted is not null;
end $$;
-- El límite solo puede fijarlo el servidor de la función de IA.
revoke all on function public.reserve_ai_request(uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_ai_request(uuid,integer) to service_role;

revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.pet_state(),public.save_profile(text,text,integer,integer[]),public.save_goal(jsonb,uuid,uuid),public.set_goal_status(uuid,text),public.save_task(jsonb,uuid,uuid),public.set_task_status(uuid,text,uuid),public.save_habit(jsonb,uuid,uuid),public.set_habit_completion(uuid,date,boolean,uuid) from public,anon;
grant execute on function public.pet_state(),public.save_profile(text,text,integer,integer[]),public.save_goal(jsonb,uuid,uuid),public.set_goal_status(uuid,text),public.save_task(jsonb,uuid,uuid),public.set_task_status(uuid,text,uuid),public.save_habit(jsonb,uuid,uuid),public.set_habit_completion(uuid,date,boolean,uuid) to authenticated;
