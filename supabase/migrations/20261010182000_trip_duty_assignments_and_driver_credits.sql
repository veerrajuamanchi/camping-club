-- Migration: 20261010182000_trip_duty_assignments_and_driver_credits.sql
-- Description: Phase C - Trip duty assignments, volunteer claiming/dropping, driver workload credits, and quota progress

-- 1. Table: trip_duty_assignments
create table if not exists public.trip_duty_assignments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.camping_trips(id) on delete cascade,
  slot_duty_id uuid not null references public.trip_slot_duties(id) on delete restrict,
  member_id uuid not null references public.member_profiles(member_id) on delete restrict,
  status text not null default 'claimed' check (status in ('claimed', 'assigned_by_admin', 'dropped', 'reassigned')),
  claimed_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references public.member_profiles(member_id),
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trip_duty_assignments_trip_member_idx
  on public.trip_duty_assignments(trip_id, member_id);

create index if not exists trip_duty_assignments_duty_status_idx
  on public.trip_duty_assignments(slot_duty_id, status);

create unique index if not exists trip_duty_assignments_active_unique
  on public.trip_duty_assignments(slot_duty_id, member_id)
  where (status in ('claimed', 'assigned_by_admin'));

-- 2. Table: trip_driver_credits
create table if not exists public.trip_driver_credits (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.camping_trips(id) on delete cascade,
  member_id uuid not null references public.member_profiles(member_id) on delete restrict,
  approved_by uuid not null references public.member_profiles(member_id),
  workload_credit numeric(3,1) not null default 1.0 check (workload_credit > 0 and workload_credit <= 5.0),
  status text not null default 'approved' check (status in ('approved', 'revoked')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, member_id)
);

create index if not exists trip_driver_credits_trip_member_idx
  on public.trip_driver_credits(trip_id, member_id, status);

-- 3. Row Level Security & Grants
alter table public.trip_duty_assignments enable row level security;
alter table public.trip_driver_credits enable row level security;

revoke all on public.trip_duty_assignments from anon;
revoke all on public.trip_driver_credits from anon;

-- Authenticated users can read assignments and driver credits
drop policy if exists authenticated_read_trip_duty_assignments on public.trip_duty_assignments;
create policy authenticated_read_trip_duty_assignments on public.trip_duty_assignments
  for select to authenticated
  using (true);

drop policy if exists authenticated_read_trip_driver_credits on public.trip_driver_credits;
create policy authenticated_read_trip_driver_credits on public.trip_driver_credits
  for select to authenticated
  using (true);

grant select on public.trip_duty_assignments to authenticated;
grant select on public.trip_driver_credits to authenticated;
grant all on public.trip_duty_assignments to service_role;
grant all on public.trip_driver_credits to service_role;

-- 4. RPC: Volunteer Claim Duty
create or replace function public.phase3_claim_duty(
  p_slot_duty_id uuid,
  p_actor_id uuid,
  p_acknowledge_overlap boolean default false
)
returns jsonb
language plpgsql
security definer
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

  if v_existing_overlap_duty is not null and not coalesce(p_acknowledge_overlap, false) then
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

revoke all on function public.phase3_claim_duty(uuid, uuid, boolean) from public;
grant execute on function public.phase3_claim_duty(uuid, uuid, boolean) to authenticated, service_role;

-- 5. RPC: Drop Duty
create or replace function public.phase3_drop_duty(
  p_assignment_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_record public.trip_duty_assignments%rowtype;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: active member account required' using errcode = '42501';
  end if;

  select * into v_record from public.trip_duty_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'assignment not found' using errcode = 'P0002';
  end if;

  if v_record.status not in ('claimed', 'assigned_by_admin') then
    raise exception 'assignment is not currently active' using errcode = 'P0001';
  end if;

  -- Only owner or admin can drop
  if v_record.member_id <> p_actor_id and v_actor.member_role not in ('admin', 'administrator') then
    raise exception 'unauthorized: only assignee or administrator may drop assignment' using errcode = '42501';
  end if;

  update public.trip_duty_assignments set
    status = 'dropped',
    released_at = now(),
    released_by = p_actor_id,
    release_reason = p_reason,
    updated_at = now()
  where id = p_assignment_id
  returning * into v_record;

  insert into public.audit_events (
    actor_id,
    actor_kind,
    entity_type,
    entity_id,
    action,
    reason
  ) values (
    p_actor_id,
    case when v_actor.member_role in ('admin', 'administrator') then 'admin' else 'member' end,
    'trip_duty_assignment',
    v_record.id,
    'duty_dropped',
    coalesce(p_reason, 'Duty dropped')
  );

  return to_jsonb(v_record) || jsonb_build_object('dropped', true);
end;
$$;

revoke all on function public.phase3_drop_duty(uuid, uuid, text) from public;
grant execute on function public.phase3_drop_duty(uuid, uuid, text) to authenticated, service_role;

-- 6. RPC: Admin Assign Duty
create or replace function public.phase3_admin_assign_duty(
  p_slot_duty_id uuid,
  p_member_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_target public.member_profiles%rowtype;
  v_duty public.trip_slot_duties%rowtype;
  v_slot public.trip_time_slots%rowtype;
  v_rsvp public.trip_rsvps%rowtype;
  v_active_count integer;
  v_record public.trip_duty_assignments%rowtype;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.member_role not in ('admin', 'administrator') or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: administrator role required' using errcode = '42501';
  end if;

  select * into v_target from public.member_profiles where member_id = p_member_id;
  if not found or v_target.account_status <> 'active' then
    raise exception 'target member must be active' using errcode = '22023';
  end if;

  select * into v_duty from public.trip_slot_duties where id = p_slot_duty_id for update;
  if not found then
    raise exception 'duty not found' using errcode = 'P0002';
  end if;

  select * into v_slot from public.trip_time_slots where id = v_duty.time_slot_id;
  if not found or not v_slot.is_enabled then
    raise exception 'time slot is currently disabled' using errcode = '22023';
  end if;

  select * into v_rsvp from public.trip_rsvps where trip_id = v_slot.trip_id and member_id = p_member_id;
  if not found or v_rsvp.response <> 'coming' then
    raise exception 'target member must be a confirmed attendee' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.trip_duty_assignments
    where slot_duty_id = p_slot_duty_id
      and member_id = p_member_id
      and status in ('claimed', 'assigned_by_admin')
  ) then
    raise exception 'target member already assigned to this duty' using errcode = '23505';
  end if;

  select count(*) into v_active_count
  from public.trip_duty_assignments
  where slot_duty_id = p_slot_duty_id
    and status in ('claimed', 'assigned_by_admin');

  if v_active_count >= v_duty.capacity then
    raise exception 'duty capacity reached' using errcode = '23514';
  end if;

  insert into public.trip_duty_assignments (
    trip_id,
    slot_duty_id,
    member_id,
    status,
    claimed_at
  ) values (
    v_slot.trip_id,
    p_slot_duty_id,
    p_member_id,
    'assigned_by_admin',
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
    'admin',
    'trip_duty_assignment',
    v_record.id,
    'duty_assigned_by_admin',
    'Administrator assigned member to duty'
  );

  return to_jsonb(v_record) || jsonb_build_object('assigned', true);
end;
$$;

revoke all on function public.phase3_admin_assign_duty(uuid, uuid, uuid) from public;
grant execute on function public.phase3_admin_assign_duty(uuid, uuid, uuid) to authenticated, service_role;

-- 7. RPC: Admin Reassign Duty
create or replace function public.phase3_admin_reassign_duty(
  p_assignment_id uuid,
  p_new_member_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_target public.member_profiles%rowtype;
  v_old public.trip_duty_assignments%rowtype;
  v_new public.trip_duty_assignments%rowtype;
  v_rsvp public.trip_rsvps%rowtype;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.member_role not in ('admin', 'administrator') or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: administrator role required' using errcode = '42501';
  end if;

  select * into v_target from public.member_profiles where member_id = p_new_member_id;
  if not found or v_target.account_status <> 'active' then
    raise exception 'target member must be active' using errcode = '22023';
  end if;

  select * into v_old from public.trip_duty_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'assignment not found' using errcode = 'P0002';
  end if;

  if v_old.status not in ('claimed', 'assigned_by_admin') then
    raise exception 'assignment is not currently active' using errcode = 'P0001';
  end if;

  select * into v_rsvp from public.trip_rsvps where trip_id = v_old.trip_id and member_id = p_new_member_id;
  if not found or v_rsvp.response <> 'coming' then
    raise exception 'target member must be a confirmed attendee' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.trip_duty_assignments
    where slot_duty_id = v_old.slot_duty_id
      and member_id = p_new_member_id
      and status in ('claimed', 'assigned_by_admin')
  ) then
    raise exception 'target member already holds this duty' using errcode = '23505';
  end if;

  -- Mark old assignment reassigned
  update public.trip_duty_assignments set
    status = 'reassigned',
    released_at = now(),
    released_by = p_actor_id,
    release_reason = coalesce(p_reason, 'Admin reassigned duty'),
    updated_at = now()
  where id = p_assignment_id;

  -- Create new assignment
  insert into public.trip_duty_assignments (
    trip_id,
    slot_duty_id,
    member_id,
    status,
    claimed_at
  ) values (
    v_old.trip_id,
    v_old.slot_duty_id,
    p_new_member_id,
    'assigned_by_admin',
    now()
  ) returning * into v_new;

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
    'trip_duty_assignment',
    v_new.id,
    'duty_reassigned_by_admin',
    coalesce(p_reason, 'Admin reassigned duty')
  );

  return jsonb_build_object(
    'reassigned', true,
    'old_assignment_id', p_assignment_id,
    'new_assignment_id', v_new.id
  );
end;
$$;

revoke all on function public.phase3_admin_reassign_duty(uuid, uuid, uuid, text) from public;
grant execute on function public.phase3_admin_reassign_duty(uuid, uuid, uuid, text) to authenticated, service_role;

-- 8. RPC: Admin Set Driver Workload Credit
create or replace function public.phase3_admin_set_driver_credit(
  p_trip_id uuid,
  p_member_id uuid,
  p_workload_credit numeric,
  p_status text,
  p_notes text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_target public.member_profiles%rowtype;
  v_record public.trip_driver_credits%rowtype;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.member_role not in ('admin', 'administrator') or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: administrator role required' using errcode = '42501';
  end if;

  select * into v_target from public.member_profiles where member_id = p_member_id;
  if not found or v_target.account_status <> 'active' then
    raise exception 'target member must be active' using errcode = '22023';
  end if;

  if p_workload_credit <= 0 or p_workload_credit > 5.0 then
    raise exception 'workload credit must be between 0.1 and 5.0' using errcode = '22023';
  end if;

  if p_status not in ('approved', 'revoked') then
    raise exception 'status must be approved or revoked' using errcode = '22023';
  end if;

  insert into public.trip_driver_credits (
    trip_id,
    member_id,
    approved_by,
    workload_credit,
    status,
    notes,
    updated_at
  ) values (
    p_trip_id,
    p_member_id,
    p_actor_id,
    p_workload_credit,
    p_status,
    p_notes,
    now()
  )
  on conflict (trip_id, member_id) do update set
    approved_by = excluded.approved_by,
    workload_credit = excluded.workload_credit,
    status = excluded.status,
    notes = excluded.notes,
    updated_at = now()
  returning * into v_record;

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
    'trip_driver_credit',
    v_record.id,
    'driver_credit_approved',
    format('Administrator set driver workload credit to %s (%s)', p_workload_credit, p_status)
  );

  return to_jsonb(v_record);
end;
$$;

revoke all on function public.phase3_admin_set_driver_credit(uuid, uuid, numeric, text, text, uuid) from public;
grant execute on function public.phase3_admin_set_driver_credit(uuid, uuid, numeric, text, text, uuid) to authenticated, service_role;

-- 9. RPC: Get Member Quota Progress
create or replace function public.phase3_get_member_quota_progress(
  p_trip_id uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
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
  where a.trip_id = p_trip_id
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

revoke all on function public.phase3_get_member_quota_progress(uuid, uuid) from public;
grant execute on function public.phase3_get_member_quota_progress(uuid, uuid) to authenticated, service_role;
