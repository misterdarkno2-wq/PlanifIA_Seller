create function public.save_milestone(p_goal_id uuid,p_title text,p_id uuid default null,p_request_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user();m uuid;result jsonb;op jsonb:=jsonb_build_object('milestone_save',p_id,'goal',p_goal_id,'title',p_title);
begin
 perform 1 from public.pets where user_id=u for update;
 if p_request_id is not null then result:=private.cached(u,p_request_id,op);if result is not null then return (result->>'entity_id')::uuid;end if;end if;
 if not exists(select 1 from public.goals where id=p_goal_id and user_id=u) then raise exception 'Meta no encontrada.' using errcode='42501';end if;
 if p_id is null then
  insert into public.milestones(user_id,goal_id,title,position) values(u,p_goal_id,p_title,(select count(*) from public.milestones where goal_id=p_goal_id)) returning id into m;
 else
  update public.milestones set title=p_title where id=p_id and user_id=u and goal_id=p_goal_id returning id into m;
  if m is null then raise exception 'Hito no encontrado.' using errcode='42501';end if;
 end if;
 update public.goals set version=version+1,updated_at=now() where id=p_goal_id and user_id=u;
 if p_request_id is not null then perform private.record_command(u,p_request_id,op,jsonb_build_object('entity_id',m));end if;return m;
end $$;
revoke all on function public.save_milestone(uuid,text,uuid,uuid) from public,anon;
grant execute on function public.save_milestone(uuid,text,uuid,uuid) to authenticated;
