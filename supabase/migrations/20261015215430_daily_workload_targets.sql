-- Daily goals are opt-in; existing trip-wide quota and driver-credit facts stay intact.
alter table public.camping_trips add column daily_workload_target numeric(4,1)
  check (daily_workload_target is null or (daily_workload_target between 0.5 and 100 and mod(daily_workload_target,0.5)=0));

create function public.phase3_set_daily_workload_target(p_actor_id uuid,p_trip_id uuid,p_target numeric,p_expected_version integer,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare v_trip public.camping_trips%rowtype;
begin
  perform private.phase2_require_admin(p_actor_id);
  if p_request_id is null or (p_target is not null and (p_target<0.5 or p_target>100 or mod(p_target,0.5)<>0)) then
    raise exception 'invalid daily workload target' using errcode='22023';
  end if;
  select * into v_trip from public.camping_trips where id=p_trip_id and deleted_at is null for update;
  if not found then raise exception 'trip not found' using errcode='22023'; end if;
  if p_expected_version is distinct from v_trip.version then raise exception 'stale trip version' using errcode='40001'; end if;
  update public.camping_trips set daily_workload_target=p_target,version=version+1,updated_at=now(),updated_by=p_actor_id where id=p_trip_id;
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id)
    values(p_actor_id,'admin','trip',p_trip_id,'daily_workload_target_changed',
      jsonb_build_object('previousTarget',v_trip.daily_workload_target,'dailyTarget',p_target)::text,p_request_id);
  return jsonb_build_object('tripId',p_trip_id,'dailyTarget',p_target,'version',v_trip.version+1);
end $$;

create function public.phase3_get_daily_workload_progress(p_trip_id uuid,p_member_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_trip public.camping_trips%rowtype; v_days jsonb;
begin
  if not exists(select 1 from public.member_profiles where member_id=p_member_id and account_status='active') then
    raise exception 'active member required' using errcode='42501';
  end if;
  select * into v_trip from public.camping_trips where id=p_trip_id and deleted_at is null;
  if not found then raise exception 'trip not found' using errcode='22023'; end if;
  if v_trip.daily_workload_target is null or v_trip.starts_on is null or v_trip.ends_on is null then
    return jsonb_build_object('target',v_trip.daily_workload_target,'tripVersion',v_trip.version,'days','[]'::jsonb,'satisfied',true);
  end if;
  with dates as (
    select v_trip.starts_on + n as day from generate_series(0,v_trip.ends_on-v_trip.starts_on) n
  ), duties as (
    select s.slot_date,d.id,d.capacity,d.workload_weight,
      count(a.id)::integer as taken,
      coalesce(bool_or(a.member_id=p_member_id),false) as mine
    from public.trip_time_slots s
    join public.trip_slot_duties d on d.time_slot_id=s.id and d.is_active
    left join public.trip_duty_assignments a on a.slot_duty_id=d.id and a.status in ('claimed','assigned_by_admin')
    where s.trip_id=p_trip_id and s.is_enabled
    group by s.slot_date,d.id,d.capacity,d.workload_weight
  ), scores as (
    select dates.day,
      coalesce(sum(d.workload_weight) filter(where d.mine),0)::numeric(10,1) as selected,
      coalesce(sum(d.capacity*d.workload_weight),0)::numeric(10,1) as total,
      coalesce(sum(greatest(d.capacity-d.taken,0)*d.workload_weight),0)::numeric(10,1) as remaining,
      coalesce(sum(greatest(d.capacity-d.taken,0)) filter(where not d.mine),0)::integer as eligible,
      count(d.id) as duty_count
    from dates left join duties d on d.slot_date=dates.day group by dates.day
  )
  select coalesce(jsonb_agg(jsonb_build_object('date',day,'selectedWeight',selected,'totalWeight',total,'remainingWeight',remaining,
    'eligibleSlots',eligible,'status',case when selected>=v_trip.daily_workload_target then 'target_met'
      when duty_count=0 then 'no_tasks_scheduled' when eligible=0 then 'no_tasks_available' else 'needs_selection' end) order by day),'[]'::jsonb)
    into v_days from scores;
  return jsonb_build_object('target',v_trip.daily_workload_target,'tripVersion',v_trip.version,'days',v_days,
    'satisfied',not exists(select 1 from jsonb_array_elements(v_days) d where d->>'status'='needs_selection'));
end $$;

revoke all on function public.phase3_set_daily_workload_target(uuid,uuid,numeric,integer,uuid) from public,anon,authenticated;
revoke all on function public.phase3_get_daily_workload_progress(uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase3_set_daily_workload_target(uuid,uuid,numeric,integer,uuid) to service_role;
grant execute on function public.phase3_get_daily_workload_progress(uuid,uuid) to service_role;
