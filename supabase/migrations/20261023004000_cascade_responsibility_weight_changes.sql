-- Cascade master responsibility workload weight and capacity changes to open trips
-- and ensure phase3_save_daily_responsibilities updates workload_weight.

create or replace function public.phase3_save_daily_responsibilities(
  p_actor_id uuid,
  p_trip_id uuid,
  p_days jsonb,
  p_expected_version integer,
  p_confirm_removal boolean default false,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_trip public.camping_trips%rowtype;
  v_day jsonb;
  v_date date;
  v_id uuid;
  v_id_text text;
  v_master public.master_responsibilities%rowtype;
  v_selected jsonb := '[]'::jsonb;
  v_removed uuid[];
  v_claims integer := 0;
  v_slot uuid;
begin
  perform private.phase2_require_admin(p_actor_id);
  select * into v_trip from public.camping_trips where id=p_trip_id for update;
  if not found or v_trip.deleted_at is not null then raise exception 'Event not found.' using errcode='22023'; end if;
  if v_trip.version<>p_expected_version then raise exception 'Stale event version.' using errcode='40001'; end if;
  if v_trip.starts_on is null or v_trip.ends_on is null or v_trip.starts_on>v_trip.ends_on then
    raise exception 'Confirm event dates before scheduling daily responsibilities.' using errcode='22023';
  end if;
  if p_request_id is null or jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days)=0 or
    jsonb_array_length(p_days)<>(v_trip.ends_on-v_trip.starts_on+1) then
    raise exception 'Provide responsibility choices for each event day.' using errcode='22023';
  end if;
  for v_day in select value from jsonb_array_elements(p_days) loop
    begin v_date := (v_day->>'date')::date;
    exception when others then
      raise exception 'Invalid event date.' using errcode='22023';
    end;
    if v_date<v_trip.starts_on or v_date>v_trip.ends_on or exists(select 1 from jsonb_array_elements(v_selected) x where x->>'date'=v_date::text) then
      raise exception 'Dates must match the event exactly once.' using errcode='22023';
    end if;
    if jsonb_array_length(v_day->'responsibilityIds')=0 or
      (select count(*)<>count(distinct value) from jsonb_array_elements_text(v_day->'responsibilityIds')) then
      raise exception 'Choose at least one distinct responsibility for every date.' using errcode='22023';
    end if;
    for v_id_text in select value from jsonb_array_elements_text(v_day->'responsibilityIds') loop
      begin v_id := v_id_text::uuid;
      exception when invalid_text_representation then raise exception 'Invalid responsibility.' using errcode='22023'; end;
      select * into v_master from public.master_responsibilities where id=v_id for share;
      if not found or (not v_master.active and not exists(
        select 1 from public.trip_slot_duties d join public.trip_time_slots s on s.id=d.time_slot_id
        where s.trip_id=p_trip_id and s.slot_date=v_date and s.is_enabled and d.is_active and d.master_responsibility_id=v_id
      )) then raise exception 'Choose an active master responsibility.' using errcode='22023'; end if;
      v_selected := v_selected || jsonb_build_array(jsonb_build_object('date',v_date,'id',v_id));
    end loop;
  end loop;
  select coalesce(array_agg(d.id),'{}') into v_removed
    from public.trip_slot_duties d join public.trip_time_slots s on s.id=d.time_slot_id
    where s.trip_id=p_trip_id and d.is_active and not exists(
      select 1 from jsonb_array_elements(v_selected) x where (x->>'date')::date=s.slot_date and (x->>'id')::uuid=d.master_responsibility_id
    );
  select count(*) into v_claims from public.trip_duty_assignments where slot_duty_id=any(v_removed) and status in ('claimed','assigned_by_admin');
  if v_claims>0 and not coalesce(p_confirm_removal,false) then
    raise exception 'confirmation_required: % volunteer assignments are affected. History will be retained; removed duties stop counting toward workload.',v_claims using errcode='23514';
  end if;
  update public.trip_slot_duties set is_active=false,updated_at=now() where id=any(v_removed);
  for v_day in select value from jsonb_array_elements(v_selected) loop
    v_date := (v_day->>'date')::date; v_id := (v_day->>'id')::uuid;
    select * into v_master from public.master_responsibilities where id=v_id;
    if exists(select 1 from public.trip_slot_duties d join public.trip_time_slots s on s.id=d.time_slot_id
      where s.trip_id=p_trip_id and s.slot_date=v_date and s.is_enabled and d.is_active and d.master_responsibility_id=v_id) then
      update public.trip_slot_duties d
      set workload_weight=v_master.workload_weight,
          capacity=v_master.default_capacity,
          updated_at=now()
      from public.trip_time_slots s
      where s.id=d.time_slot_id
        and s.trip_id=p_trip_id
        and s.slot_date=v_date
        and s.is_enabled
        and d.is_active
        and d.master_responsibility_id=v_id;
      continue;
    end if;
    insert into public.trip_time_slots(trip_id,slot_date,time_block,slot_type,label,is_custom,is_enabled)
      values(p_trip_id,v_date,'daily','custom','Daily responsibilities',true,true)
      on conflict(trip_id,slot_date,time_block,label) do update set is_enabled=true,updated_at=now() returning id into v_slot;
    insert into public.trip_slot_duties(time_slot_id,master_responsibility_id,capacity,workload_weight)
      values(v_slot,v_id,v_master.default_capacity,v_master.workload_weight)
      on conflict(time_slot_id,master_responsibility_id) do update set
        is_active=true,
        workload_weight=excluded.workload_weight,
        capacity=excluded.capacity,
        updated_at=now();
  end loop;
  update public.camping_trips set version=version+1,updated_at=now(),updated_by=p_actor_id where id=p_trip_id;
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id)
    values(p_actor_id,'admin','trip',p_trip_id,'daily_responsibilities_saved',
      jsonb_build_object('days',p_days,'disabledDutyIds',v_removed,'affectedAssignments',v_claims,'confirmedRemoval',coalesce(p_confirm_removal,false))::text,p_request_id);
  return jsonb_build_object('tripId',p_trip_id,'version',v_trip.version+1,'saved',true);
end $$;
revoke all on function public.phase3_save_daily_responsibilities(uuid,uuid,jsonb,integer,boolean,uuid) from public,anon,authenticated;
grant execute on function public.phase3_save_daily_responsibilities(uuid,uuid,jsonb,integer,boolean,uuid) to service_role;

-- Update admin_update_master_responsibility to cascade weight and capacity to open/draft trips
create or replace function public.admin_update_master_responsibility(
  p_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_default_capacity integer,
  p_workload_weight numeric,
  p_active boolean,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_record public.master_responsibilities%rowtype;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.member_role not in ('admin', 'administrator') or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: administrator role required' using errcode = '42501';
  end if;

  if char_length(trim(p_title)) < 3 or char_length(trim(p_title)) > 100 then
    raise exception 'invalid title length: must be 3-100 characters' using errcode = '22023';
  end if;

  if p_category not in ('meal_prep','cooking','cleanup','activities','transport','other') then
    raise exception 'invalid category: %', p_category using errcode = '22023';
  end if;

  if p_default_capacity < 1 or p_default_capacity > 20 then
    raise exception 'default capacity must be between 1 and 20' using errcode = '22023';
  end if;

  if p_workload_weight < 0.5 or p_workload_weight > 5.0 then
    raise exception 'workload weight must be between 0.5 and 5.0' using errcode = '22023';
  end if;

  update public.master_responsibilities set
    title = trim(p_title),
    description = nullif(trim(p_description), ''),
    category = p_category,
    default_capacity = p_default_capacity,
    workload_weight = p_workload_weight,
    active = coalesce(p_active, active),
    updated_at = now()
  where id = p_id
  returning * into v_record;

  if not found then
    raise exception 'master responsibility not found' using errcode = 'P0002';
  end if;

  -- Cascade workload_weight changes to all open/draft trips
  update public.trip_slot_duties d
  set workload_weight = p_workload_weight,
      updated_at = now()
  from public.trip_time_slots s
  join public.camping_trips t on t.id = s.trip_id
  where d.time_slot_id = s.id
    and d.master_responsibility_id = p_id
    and t.deleted_at is null
    and t.poll_status in ('draft', 'open')
    and d.workload_weight is distinct from p_workload_weight;

  insert into public.audit_events (
    actor_id,
    actor_kind,
    entity_type,
    entity_id,
    action,
    reason
  ) values (
    p_actor_id,
    'admin',
    'master_responsibility',
    v_record.id,
    'master_responsibility_updated',
    v_record.title
  );

  return to_jsonb(v_record);
end;
$$;
