-- A daily responsibility has a date but no implied simultaneous time block.
alter table public.trip_time_slots drop constraint trip_time_slots_time_block_check;
alter table public.trip_time_slots add constraint trip_time_slots_time_block_check check
  (time_block in ('friday_evening','friday_dinner','saturday_morning','saturday_lunch','saturday_dinner','saturday_evening','sunday_morning','sunday_lunch','trip_wide','custom','daily'));

-- Explicit daily planning replaces title/weekday-dependent candidate generation.
create or replace function public.phase3_generate_candidate_time_slots(p_trip_id uuid,p_actor_id uuid,p_regenerate boolean default false)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
begin
  perform private.phase2_require_admin(p_actor_id);
  raise exception 'Select responsibilities for each event date in the daily planner.' using errcode='22023';
end $$;
revoke all on function public.phase3_generate_candidate_time_slots(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.phase3_generate_candidate_time_slots(uuid,uuid,boolean) to service_role;

create function public.phase3_save_daily_responsibilities(
  p_actor_id uuid,p_trip_id uuid,p_days jsonb,p_expected_version integer,p_confirm_removal boolean,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare
  v_trip public.camping_trips%rowtype;
  v_day jsonb; v_id_text text; v_id uuid; v_date date;
  v_selected jsonb := '[]'; v_removed uuid[]; v_claims integer; v_slot uuid;
  v_master public.master_responsibilities%rowtype;
begin
  perform private.phase2_require_admin(p_actor_id);
  select * into v_trip from public.camping_trips where id=p_trip_id and deleted_at is null for update;
  if not found or v_trip.starts_on is null or v_trip.ends_on is null or v_trip.ends_on<v_trip.starts_on then
    raise exception 'Event start and end dates are required.' using errcode='22023';
  end if;
  if v_trip.event_status='cancelled' or v_trip.ends_on < (now() at time zone v_trip.club_timezone_snapshot)::date then
    raise exception 'Past or cancelled events cannot be replanned.' using errcode='22023';
  end if;
  if p_expected_version is distinct from v_trip.version then raise exception 'stale trip version' using errcode='40001'; end if;
  if p_request_id is null or jsonb_typeof(p_days) is distinct from 'array' then
    raise exception 'Choose responsibilities for every event date.' using errcode='22023';
  end if;
  if jsonb_array_length(p_days) <> v_trip.ends_on-v_trip.starts_on+1 then
    raise exception 'Choose responsibilities for every event date.' using errcode='22023';
  end if;
  -- The same locks used by volunteer claims ensure confirmation sees any new claim.
  perform d.id from public.trip_slot_duties d join public.trip_time_slots s on s.id=d.time_slot_id
    where s.trip_id=p_trip_id order by d.id for update of d;
  for v_day in select value from jsonb_array_elements(p_days) loop
    if jsonb_typeof(v_day) is distinct from 'object' or coalesce(v_day->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or jsonb_typeof(v_day->'responsibilityIds') is distinct from 'array' then
      raise exception 'Invalid daily responsibility selection.' using errcode='22023';
    end if;
    begin v_date := (v_day->>'date')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
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
    if exists(select 1 from public.trip_slot_duties d join public.trip_time_slots s on s.id=d.time_slot_id
      where s.trip_id=p_trip_id and s.slot_date=v_date and s.is_enabled and d.is_active and d.master_responsibility_id=v_id) then continue; end if;
    insert into public.trip_time_slots(trip_id,slot_date,time_block,slot_type,label,is_custom,is_enabled)
      values(p_trip_id,v_date,'daily','custom','Daily responsibilities',true,true)
      on conflict(trip_id,slot_date,time_block,label) do update set is_enabled=true,updated_at=now() returning id into v_slot;
    select * into v_master from public.master_responsibilities where id=v_id;
    insert into public.trip_slot_duties(time_slot_id,master_responsibility_id,capacity,workload_weight)
      values(v_slot,v_id,v_master.default_capacity,v_master.workload_weight)
      on conflict(time_slot_id,master_responsibility_id) do update set is_active=true,updated_at=now();
  end loop;
  update public.camping_trips set version=version+1,updated_at=now(),updated_by=p_actor_id where id=p_trip_id;
  insert into public.audit_events(actor_id,actor_kind,entity_type,entity_id,action,reason,request_id)
    values(p_actor_id,'admin','trip',p_trip_id,'daily_responsibilities_saved',
      jsonb_build_object('days',p_days,'disabledDutyIds',v_removed,'affectedAssignments',v_claims,'confirmedRemoval',coalesce(p_confirm_removal,false))::text,p_request_id);
  return jsonb_build_object('tripId',p_trip_id,'version',v_trip.version+1,'saved',true);
end $$;
revoke all on function public.phase3_save_daily_responsibilities(uuid,uuid,jsonb,integer,boolean,uuid) from public,anon,authenticated;
grant execute on function public.phase3_save_daily_responsibilities(uuid,uuid,jsonb,integer,boolean,uuid) to service_role;

-- Day-level selections can be combined without a false time-overlap warning.
create or replace function public.phase3_claim_duty(
  p_slot_duty_id uuid,
  p_actor_id uuid,
  p_acknowledge_overlap boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_duty public.trip_slot_duties%rowtype;
  v_slot public.trip_time_slots%rowtype;
  v_rsvp public.trip_rsvps%rowtype;
  v_active_count integer;
  v_overlap_found boolean := false;
  v_existing_overlap_duty text;
  v_record public.trip_duty_assignments%rowtype;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: active member account required' using errcode = '42501';
  end if;

  select * into v_duty from public.trip_slot_duties where id = p_slot_duty_id for update;
  if not found then
    raise exception 'duty not found' using errcode = 'P0002';
  end if;

  if not v_duty.is_active then
    raise exception 'duty is currently inactive' using errcode = '22023';
  end if;

  select * into v_slot from public.trip_time_slots where id = v_duty.time_slot_id;
  if not found or not v_slot.is_enabled then
    raise exception 'time slot is currently disabled' using errcode = '22023';
  end if;

  -- Verify confirmed attendee status ('coming')
  select * into v_rsvp from public.trip_rsvps where trip_id = v_slot.trip_id and member_id = p_actor_id;
  if not found or v_rsvp.response <> 'coming' then
    raise exception 'unauthorized: only confirmed attendees may volunteer for duties' using errcode = '42501';
  end if;

  -- Check if already holding an active claim on this specific duty
  if exists (
    select 1 from public.trip_duty_assignments
    where slot_duty_id = p_slot_duty_id
      and member_id = p_actor_id
      and status in ('claimed', 'assigned_by_admin')
  ) then
    raise exception 'duplicate claim: you already hold an active assignment for this duty' using errcode = '23505';
  end if;

  -- Capacity check with lock
  select count(*) into v_active_count
  from public.trip_duty_assignments
  where slot_duty_id = p_slot_duty_id
    and status in ('claimed', 'assigned_by_admin');

  if v_active_count >= v_duty.capacity then
    raise exception 'duty capacity reached' using errcode = '23514';
  end if;

  -- Overlap detection: check if member holds another duty on the same slot_date & time_block
  select coalesce(mr.title, 'Another duty') into v_existing_overlap_duty
  from public.trip_duty_assignments a
  join public.trip_slot_duties sd on a.slot_duty_id = sd.id
  join public.master_responsibilities mr on sd.master_responsibility_id = mr.id
  join public.trip_time_slots ts on sd.time_slot_id = ts.id
  where a.member_id = p_actor_id
    and a.status in ('claimed', 'assigned_by_admin')
    and ts.trip_id = v_slot.trip_id
    and ts.slot_date = v_slot.slot_date
    and ts.time_block = v_slot.time_block
    and sd.id <> p_slot_duty_id
  limit 1;

  if v_slot.time_block <> 'daily' and v_existing_overlap_duty is not null and not coalesce(p_acknowledge_overlap, false) then
    return jsonb_build_object(
      'overlap_detected', true,
      'message', format('You already have a responsibility (%s) scheduled for this time block. Acknowledge overlap to proceed.', v_existing_overlap_duty)
    );
  end if;

  -- Insert active assignment
  insert into public.trip_duty_assignments (
    trip_id,
    slot_duty_id,
    member_id,
    status,
    claimed_at
  ) values (
    v_slot.trip_id,
    p_slot_duty_id,
    p_actor_id,
    'claimed',
    now()
  ) returning * into v_record;

  insert into public.audit_events (
    actor_id,
    actor_kind,
    entity_type,
    entity_id,
    action,
    reason
  ) values (
    p_actor_id,
    'member',
    'trip_duty_assignment',
    v_record.id,
    'duty_claimed',
    'Member volunteered for duty'
  );

  return to_jsonb(v_record) || jsonb_build_object('success', true);
end;
$$;

revoke all on function public.phase3_claim_duty(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.phase3_claim_duty(uuid, uuid, boolean) to service_role;


-- Retained history on inactive duties must not satisfy the legacy quota.
create or replace function public.phase3_get_member_quota_progress(
  p_trip_id uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claimed_weight numeric := 0;
  v_claimed_count integer := 0;
  v_driver_credit numeric := 0;
  v_total_score numeric := 0;
  v_target integer := 2;
begin
  -- Sum duty workload weights and count
  select
    coalesce(sum(sd.workload_weight), 0),
    count(*)
  into v_claimed_weight, v_claimed_count
  from public.trip_duty_assignments a
  join public.trip_slot_duties sd on a.slot_duty_id = sd.id
  join public.trip_time_slots ts on ts.id = sd.time_slot_id
  where sd.is_active and ts.is_enabled and a.trip_id = p_trip_id
    and a.member_id = p_member_id
    and a.status in ('claimed', 'assigned_by_admin');

  -- Get approved driver credit
  select coalesce(workload_credit, 0)
  into v_driver_credit
  from public.trip_driver_credits
  where trip_id = p_trip_id
    and member_id = p_member_id
    and status = 'approved';

  -- Get trip quota target
  select coalesce(task_quota_target, 2)
  into v_target
  from public.camping_trips
  where id = p_trip_id;

  v_driver_credit := coalesce(v_driver_credit, 0);
  v_total_score := v_claimed_weight + v_driver_credit;

  return jsonb_build_object(
    'claimed_count', v_claimed_count,
    'claimed_weight', v_claimed_weight,
    'driver_credit', v_driver_credit,
    'total_score', v_total_score,
    'quota_target', v_target,
    'target_reached', v_total_score >= v_target
  );
end;
$$;

revoke all on function public.phase3_get_member_quota_progress(uuid, uuid) from public, anon, authenticated;
grant execute on function public.phase3_get_member_quota_progress(uuid, uuid) to service_role;
