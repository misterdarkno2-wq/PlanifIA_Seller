create function public.apply_goal_plan(p_goal_id uuid,p_expected_version integer,p_plan jsonb,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();g public.goals;profile public.profiles;m jsonb;t jsonb;mid uuid;day date;start_day date;d integer;mins integer;cnt integer:=0;daily integer;existing integer;habit_minutes integer;week integer;weeks integer[]:=array[0,0,0,0];op jsonb;cached jsonb;
begin
 perform 1 from public.pets where user_id=u for update;
 op:=jsonb_build_object('goal',p_goal_id,'version',p_expected_version,'plan',p_plan);
 cached:=private.cached(u,p_request_id,op);if cached is not null then return (cached->>'goal_id')::uuid;end if;
 select * into profile from public.profiles where user_id=u for update;
 if p_goal_id is not null then
  select * into g from public.goals where id=p_goal_id and user_id=u for update;
  if not found then raise exception 'Meta no encontrada.' using errcode='42501';end if;
  if g.version is distinct from p_expected_version then raise exception 'La meta cambió desde que generaste la propuesta. Revísala y genera un ajuste nuevo.' using errcode='40001';end if;
 end if;
 if p_plan is null or jsonb_typeof(p_plan->'milestones') is distinct from 'array' or jsonb_array_length(p_plan->'milestones') not between 1 and 8 or coalesce(length(p_plan->>'title'),0) not between 1 and 160 or coalesce(length(p_plan->>'outcome'),0) not between 1 and 1000 then raise exception 'Propuesta inválida.';end if;
 start_day:=(p_plan->>'start_date')::date;
 if start_day is null or start_day<>private.local_today(u) then raise exception 'La propuesta pertenece a otro día. Genera una nueva para actualizar sus fechas.';end if;
 daily:=ceil(profile.weekly_minutes::numeric/cardinality(profile.available_days));
 if p_goal_id is null then
  p_goal_id:=public.save_goal(p_plan,null);
  select * into g from public.goals where id=p_goal_id;
 else
  update public.goals set title=p_plan->>'title',description=p_plan->>'description',outcome=p_plan->>'outcome',category=p_plan->>'category',target_date=nullif(p_plan->>'target_date','')::date,weekly_minutes=(p_plan->>'weekly_minutes')::integer,version=version+1,updated_at=now() where id=g.id;
  -- Conserva el historial; únicamente reemplaza las acciones pendientes.
  update public.tasks set status='cancelled',updated_at=now() where goal_id=g.id and user_id=u and status='pending';
  select * into g from public.goals where id=p_goal_id;
 end if;
 for m in select value from jsonb_array_elements(p_plan->'milestones') loop
  if jsonb_typeof(m->'tasks') is distinct from 'array' or jsonb_array_length(m->'tasks')<1 then raise exception 'Un hito no tiene acciones.';end if;
  insert into public.milestones(user_id,goal_id,title,position) values(u,g.id,m->>'title',cnt) returning id into mid;
  for t in select value from jsonb_array_elements(m->'tasks') loop
   cnt:=cnt+1;if cnt>40 then raise exception 'Máximo 40 acciones por propuesta.';end if;
   d:=(t->>'day_offset')::integer;mins:=(t->>'minutes')::integer;
   if d is null or mins is null or d not between 0 and 27 or mins not between 5 and 120 then raise exception 'Duración o día inválido.';end if;
   day:=start_day+d;
   if not extract(dow from day)::integer=any(profile.available_days) or (g.target_date is not null and day>g.target_date) or (nullif(t->>'deadline','')::date is not null and (nullif(t->>'deadline','')::date<day or (g.target_date is not null and nullif(t->>'deadline','')::date>g.target_date))) then raise exception 'Una acción no corresponde a los días o fechas disponibles.';end if;
   select coalesce(sum(a.minutes),0) into existing from public.tasks a left join public.goals b on b.id=a.goal_id where a.user_id=u and a.scheduled_date=day and a.status<>'cancelled' and (a.goal_id is null or b.status='active');
   select coalesce(sum(h.minutes),0) into habit_minutes from public.habits h left join public.goals b on b.id=h.goal_id where h.user_id=u and h.active and extract(dow from day)::integer=any(h.days) and (h.goal_id is null or b.status='active');
   if existing+habit_minutes+mins>daily then raise exception 'No queda suficiente tiempo el %; reprograma acciones o reduce el plan.',day;end if;
   week:=d/7+1;weeks[week]:=weeks[week]+mins;
   if weeks[week]>g.weekly_minutes then raise exception 'El plan supera el tiempo semanal asignado a la meta.';end if;
   select coalesce(sum(a.minutes),0) into existing from public.tasks a left join public.goals b on b.id=a.goal_id where a.user_id=u and a.scheduled_date between start_day+(week-1)*7 and start_day+week*7-1 and a.status<>'cancelled' and (a.goal_id is null or b.status='active');
   select coalesce(sum(h.minutes),0) into habit_minutes from public.habits h left join public.goals b on b.id=h.goal_id cross join generate_series(0,6) ds where h.user_id=u and h.active and extract(dow from start_day+(week-1)*7+ds)::integer=any(h.days) and (h.goal_id is null or b.status='active');
   if existing+habit_minutes+mins>profile.weekly_minutes then raise exception 'La semana ya está ocupada. Reduce el alcance del nuevo plan.';end if;
   insert into public.tasks(user_id,goal_id,milestone_id,title,description,priority,deadline,scheduled_date,minutes) values(u,g.id,mid,t->>'title',coalesce(t->>'description',''),t->>'priority',nullif(t->>'deadline','')::date,day,mins);
  end loop;
 end loop;
 perform private.record_command(u,p_request_id,op,jsonb_build_object('goal_id',g.id));return g.id;
end $$;

create function public.import_legacy(p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();source_name text:=p_data->>'source';item jsonb;t uuid;added integer:=0;skipped integer:=0;result jsonb;op jsonb:=jsonb_build_object('import',p_data);
begin
 perform 1 from public.pets where user_id=u for update;
 result:=private.cached(u,p_request_id,op);if result is not null then return result;end if;
 if length(source_name) not between 1 and 200 or jsonb_typeof(p_data->'items')<>'array' or jsonb_array_length(p_data->'items') not between 1 and 1000 or octet_length(p_data::text)>5000000 then raise exception 'Archivo de importación inválido o demasiado grande.';end if;
 insert into public.imports(user_id,source,fingerprint,original) values(u,source_name,md5((p_data->'original')::text),p_data->'original') on conflict(user_id,source,fingerprint) do nothing;
 for item in select value from jsonb_array_elements(p_data->'items') loop
  if exists(select 1 from private.import_items where user_id=u and source=source_name and source_key=item->>'key') then skipped:=skipped+1;continue;end if;
  if length(item->>'key') not between 1 and 200 or item->>'status' not in ('pending','completed') then raise exception 'Actividad importada inválida.';end if;
  insert into public.tasks(user_id,title,description,area,priority,deadline,scheduled_date,minutes,status) values(u,item->>'title',coalesce(item->>'description',''),coalesce(item->>'area',''),item->>'priority',nullif(item->>'deadline','')::date,nullif(item->>'scheduled_date','')::date,(item->>'minutes')::integer,item->>'status') returning id into t;
  insert into private.import_items(user_id,source,source_key,task_id) values(u,source_name,item->>'key',t);added:=added+1;
 end loop;
 result:=jsonb_build_object('added',added,'skipped',skipped);return private.record_command(u,p_request_id,op,result);
end $$;
revoke all on function public.apply_goal_plan(uuid,integer,jsonb,uuid),public.import_legacy(jsonb,uuid) from public,anon;
grant execute on function public.apply_goal_plan(uuid,integer,jsonb,uuid),public.import_legacy(jsonb,uuid) to authenticated;
