-- Migration: 20261010181000_trip_meal_and_chore_slots.sql
-- Description: Trip time slots, slot duties, candidate generator, and admin configuration RPCs

-- 1. Table: trip_time_slots
create table if not exists public.trip_time_slots (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.camping_trips(id) on delete cascade,
  slot_date date not null,
  time_block text not null check (time_block in ('friday_evening','friday_dinner','saturday_morning','saturday_lunch','saturday_dinner','saturday_evening','sunday_morning','sunday_lunch','trip_wide','custom')),
  slot_type text not null default 'meal' check (slot_type in ('meal','chore','activity','custom')),
  label text not null check (char_length(label) between 2 and 100),
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  is_custom boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id, slot_date, time_block, label)
);

create index if not exists trip_time_slots_trip_date_idx 
  on public.trip_time_slots(trip_id, slot_date, sort_order);

-- 2. Table: trip_slot_duties
create table if not exists public.trip_slot_duties (
  id uuid primary key default gen_random_uuid(),
  time_slot_id uuid not null references public.trip_time_slots(id) on delete restrict,
  master_responsibility_id uuid not null references public.master_responsibilities(id) on delete restrict,
  custom_title text check (custom_title is null or char_length(custom_title) between 2 and 100),
  capacity integer not null default 1 check (capacity between 1 and 20),
  workload_weight numeric(3,1) not null default 1.0 check (workload_weight between 0.5 and 5.0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(time_slot_id, master_responsibility_id)
);

create index if not exists trip_slot_duties_slot_idx 
  on public.trip_slot_duties(time_slot_id, is_active, sort_order);

-- 3. Row Level Security & Grants
alter table public.trip_time_slots enable row level security;
alter table public.trip_slot_duties enable row level security;

revoke all on public.trip_time_slots from anon;
revoke all on public.trip_slot_duties from anon;

-- Members can read time slots and duties
drop policy if exists members_read_trip_time_slots on public.trip_time_slots;
create policy members_read_trip_time_slots on public.trip_time_slots
  for select to authenticated
  using (true);

drop policy if exists members_read_trip_slot_duties on public.trip_slot_duties;
create policy members_read_trip_slot_duties on public.trip_slot_duties
  for select to authenticated
  using (true);

-- Admins modify
drop policy if exists admins_modify_trip_time_slots on public.trip_time_slots;
create policy admins_modify_trip_time_slots on public.trip_time_slots
  for all to authenticated
  using (
    exists (
      select 1 from public.member_profiles
      where member_profiles.member_id = auth.uid()
        and member_profiles.member_role in ('admin', 'administrator')
        and member_profiles.account_status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.member_profiles
      where member_profiles.member_id = auth.uid()
        and member_profiles.member_role in ('admin', 'administrator')
        and member_profiles.account_status = 'active'
    )
  );

drop policy if exists admins_modify_trip_slot_duties on public.trip_slot_duties;
create policy admins_modify_trip_slot_duties on public.trip_slot_duties
  for all to authenticated
  using (
    exists (
      select 1 from public.member_profiles
      where member_profiles.member_id = auth.uid()
        and member_profiles.member_role in ('admin', 'administrator')
        and member_profiles.account_status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.member_profiles
      where member_profiles.member_id = auth.uid()
        and member_profiles.member_role in ('admin', 'administrator')
        and member_profiles.account_status = 'active'
    )
  );

grant select on public.trip_time_slots to authenticated;
grant select on public.trip_slot_duties to authenticated;
grant all on public.trip_time_slots to service_role;
grant all on public.trip_slot_duties to service_role;

-- 4. Candidate Time Slot Generator (Idempotent & Preserving)
create or replace function public.phase3_generate_candidate_time_slots(
  p_trip_id uuid,
  p_actor_id uuid,
  p_regenerate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_trip public.camping_trips%rowtype;
  v_existing_count integer;
  v_curr_date date;
  v_slot_id uuid;
  v_resp_id uuid;
  v_sort integer := 0;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.member_role not in ('admin', 'administrator') or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: administrator role required' using errcode = '42501';
  end if;

  select * into v_trip from public.camping_trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  select count(*) into v_existing_count from public.trip_time_slots where trip_id = p_trip_id;
  if v_existing_count > 0 and not coalesce(p_regenerate, false) then
    return jsonb_build_object('created', false, 'message', 'Time slots already configured for this trip');
  end if;

  -- Default to Friday if dates missing
  v_curr_date := coalesce(v_trip.starts_on, current_date);

  -- 1. Friday / Day 1: Evening Campfire & Dinner
  v_sort := v_sort + 10;
  insert into public.trip_time_slots (trip_id, slot_date, time_block, slot_type, label, sort_order)
  values (p_trip_id, v_curr_date, 'friday_evening', 'chore', 'Friday Evening Campfire & Setup', v_sort)
  on conflict (trip_id, slot_date, time_block, label) do update set updated_at = now()
  returning id into v_slot_id;

  select id into v_resp_id from public.master_responsibilities where title = 'Campfire & Firewood Setup' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0)
    on conflict (time_slot_id, master_responsibility_id) do nothing;
  end if;

  v_sort := v_sort + 10;
  insert into public.trip_time_slots (trip_id, slot_date, time_block, slot_type, label, sort_order)
  values (p_trip_id, v_curr_date, 'friday_dinner', 'meal', 'Friday Dinner', v_sort)
  on conflict (trip_id, slot_date, time_block, label) do update set updated_at = now()
  returning id into v_slot_id;

  select id into v_resp_id from public.master_responsibilities where title = 'Main Dish Cook' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.5) on conflict do nothing;
  end if;
  select id into v_resp_id from public.master_responsibilities where title = 'Dishes & Kitchen Cleanup' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0) on conflict do nothing;
  end if;
  select id into v_resp_id from public.master_responsibilities where title = 'Vegetable Prep' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0) on conflict do nothing;
  end if;

  -- 2. Saturday / Day 2 (if trip length >= 2 days)
  v_curr_date := v_curr_date + interval '1 day';
  v_sort := v_sort + 10;
  insert into public.trip_time_slots (trip_id, slot_date, time_block, slot_type, label, sort_order)
  values (p_trip_id, v_curr_date, 'saturday_morning', 'meal', 'Saturday Breakfast', v_sort)
  on conflict (trip_id, slot_date, time_block, label) do update set updated_at = now()
  returning id into v_slot_id;

  select id into v_resp_id from public.master_responsibilities where title = 'Main Dish Cook' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.5) on conflict do nothing;
  end if;
  select id into v_resp_id from public.master_responsibilities where title = 'Dishes & Kitchen Cleanup' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0) on conflict do nothing;
  end if;

  v_sort := v_sort + 10;
  insert into public.trip_time_slots (trip_id, slot_date, time_block, slot_type, label, sort_order)
  values (p_trip_id, v_curr_date, 'saturday_lunch', 'meal', 'Saturday Lunch', v_sort)
  on conflict (trip_id, slot_date, time_block, label) do update set updated_at = now()
  returning id into v_slot_id;

  select id into v_resp_id from public.master_responsibilities where title = 'Side Dish & Rice/Curry' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0) on conflict do nothing;
  end if;
  select id into v_resp_id from public.master_responsibilities where title = 'Dishes & Kitchen Cleanup' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0) on conflict do nothing;
  end if;

  v_sort := v_sort + 10;
  insert into public.trip_time_slots (trip_id, slot_date, time_block, slot_type, label, sort_order)
  values (p_trip_id, v_curr_date, 'saturday_dinner', 'meal', 'Saturday Dinner', v_sort)
  on conflict (trip_id, slot_date, time_block, label) do update set updated_at = now()
  returning id into v_slot_id;

  select id into v_resp_id from public.master_responsibilities where title = 'Main Dish Cook' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.5) on conflict do nothing;
  end if;
  select id into v_resp_id from public.master_responsibilities where title = 'Meat & Food Prep' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0) on conflict do nothing;
  end if;
  select id into v_resp_id from public.master_responsibilities where title = 'Dishes & Kitchen Cleanup' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0) on conflict do nothing;
  end if;

  v_sort := v_sort + 10;
  insert into public.trip_time_slots (trip_id, slot_date, time_block, slot_type, label, sort_order)
  values (p_trip_id, v_curr_date, 'saturday_evening', 'chore', 'Saturday Evening Games & Campfire', v_sort)
  on conflict (trip_id, slot_date, time_block, label) do update set updated_at = now()
  returning id into v_slot_id;

  select id into v_resp_id from public.master_responsibilities where title = 'Activity Planning & Games' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 1, 1.0) on conflict do nothing;
  end if;
  select id into v_resp_id from public.master_responsibilities where title = 'Campfire & Firewood Setup' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0) on conflict do nothing;
  end if;

  -- 3. Sunday / Last Day: Breakfast & Cleanup
  v_curr_date := v_curr_date + interval '1 day';
  v_sort := v_sort + 10;
  insert into public.trip_time_slots (trip_id, slot_date, time_block, slot_type, label, sort_order)
  values (p_trip_id, v_curr_date, 'sunday_morning', 'meal', 'Sunday Breakfast', v_sort)
  on conflict (trip_id, slot_date, time_block, label) do update set updated_at = now()
  returning id into v_slot_id;

  select id into v_resp_id from public.master_responsibilities where title = 'Main Dish Cook' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.5) on conflict do nothing;
  end if;
  select id into v_resp_id from public.master_responsibilities where title = 'Dishes & Kitchen Cleanup' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0) on conflict do nothing;
  end if;

  v_sort := v_sort + 10;
  insert into public.trip_time_slots (trip_id, slot_date, time_block, slot_type, label, sort_order)
  values (p_trip_id, v_curr_date, 'sunday_morning', 'chore', 'Sunday Cabin & Bathroom Cleanup', v_sort)
  on conflict (trip_id, slot_date, time_block, label) do update set updated_at = now()
  returning id into v_slot_id;

  select id into v_resp_id from public.master_responsibilities where title = 'Cabin Floor & Room Cleanup' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 2, 1.0) on conflict do nothing;
  end if;
  select id into v_resp_id from public.master_responsibilities where title = 'Bathroom Cleaning' limit 1;
  if v_resp_id is not null then
    insert into public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight)
    values (v_slot_id, v_resp_id, 1, 1.5) on conflict do nothing;
  end if;

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
    'camping_trip',
    p_trip_id,
    'candidate_time_slots_generated',
    case when coalesce(p_regenerate, false) then 'Regenerated candidate time slots' else 'Generated candidate time slots' end
  );

  return jsonb_build_object('created', true, 'trip_id', p_trip_id);
end;
$$;

revoke all on function public.phase3_generate_candidate_time_slots(uuid, uuid, boolean) from public;
grant execute on function public.phase3_generate_candidate_time_slots(uuid, uuid, boolean) to authenticated, service_role;

-- 5. Admin RPC: Configure Time Slot (Label / Enabled)
create or replace function public.phase3_admin_configure_time_slot(
  p_slot_id uuid,
  p_label text,
  p_is_enabled boolean,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_record public.trip_time_slots%rowtype;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.member_role not in ('admin', 'administrator') or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: administrator role required' using errcode = '42501';
  end if;

  update public.trip_time_slots set
    label = coalesce(nullif(trim(p_label), ''), label),
    is_enabled = coalesce(p_is_enabled, is_enabled),
    updated_at = now()
  where id = p_slot_id
  returning * into v_record;

  if not found then
    raise exception 'time slot not found' using errcode = 'P0002';
  end if;

  return to_jsonb(v_record);
end;
$$;

revoke all on function public.phase3_admin_configure_time_slot(uuid, text, boolean, uuid) from public;
grant execute on function public.phase3_admin_configure_time_slot(uuid, text, boolean, uuid) to authenticated, service_role;

-- 6. Admin RPC: Add Duty to Slot
create or replace function public.phase3_admin_add_slot_duty(
  p_time_slot_id uuid,
  p_master_responsibility_id uuid,
  p_capacity integer,
  p_workload_weight numeric,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_record public.trip_slot_duties%rowtype;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.member_role not in ('admin', 'administrator') or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: administrator role required' using errcode = '42501';
  end if;

  if p_capacity < 1 or p_capacity > 20 then
    raise exception 'capacity must be between 1 and 20' using errcode = '22023';
  end if;

  if p_workload_weight < 0.5 or p_workload_weight > 5.0 then
    raise exception 'workload weight must be between 0.5 and 5.0' using errcode = '22023';
  end if;

  insert into public.trip_slot_duties (
    time_slot_id,
    master_responsibility_id,
    capacity,
    workload_weight,
    is_active
  ) values (
    p_time_slot_id,
    p_master_responsibility_id,
    p_capacity,
    p_workload_weight,
    true
  )
  on conflict (time_slot_id, master_responsibility_id) do update set
    capacity = excluded.capacity,
    workload_weight = excluded.workload_weight,
    is_active = true,
    updated_at = now()
  returning * into v_record;

  return to_jsonb(v_record);
end;
$$;

revoke all on function public.phase3_admin_add_slot_duty(uuid, uuid, integer, numeric, uuid) from public;
grant execute on function public.phase3_admin_add_slot_duty(uuid, uuid, integer, numeric, uuid) to authenticated, service_role;

-- 7. Admin RPC: Update Slot Duty
create or replace function public.phase3_admin_update_slot_duty(
  p_slot_duty_id uuid,
  p_capacity integer,
  p_workload_weight numeric,
  p_is_active boolean,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_record public.trip_slot_duties%rowtype;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.member_role not in ('admin', 'administrator') or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: administrator role required' using errcode = '42501';
  end if;

  update public.trip_slot_duties set
    capacity = coalesce(p_capacity, capacity),
    workload_weight = coalesce(p_workload_weight, workload_weight),
    is_active = coalesce(p_is_active, is_active),
    updated_at = now()
  where id = p_slot_duty_id
  returning * into v_record;

  if not found then
    raise exception 'slot duty not found' using errcode = 'P0002';
  end if;

  return to_jsonb(v_record);
end;
$$;

revoke all on function public.phase3_admin_update_slot_duty(uuid, integer, numeric, boolean, uuid) from public;
grant execute on function public.phase3_admin_update_slot_duty(uuid, integer, numeric, boolean, uuid) to authenticated, service_role;

-- 8. Admin RPC: Create Custom Time Slot
create or replace function public.phase3_admin_create_custom_time_slot(
  p_trip_id uuid,
  p_slot_date date,
  p_time_block text,
  p_slot_type text,
  p_label text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.member_profiles%rowtype;
  v_record public.trip_time_slots%rowtype;
begin
  select * into v_actor from public.member_profiles where member_id = p_actor_id;
  if not found or v_actor.member_role not in ('admin', 'administrator') or v_actor.account_status <> 'active' then
    raise exception 'unauthorized: administrator role required' using errcode = '42501';
  end if;

  if char_length(trim(p_label)) < 2 or char_length(trim(p_label)) > 100 then
    raise exception 'label must be 2-100 characters' using errcode = '22023';
  end if;

  insert into public.trip_time_slots (
    trip_id,
    slot_date,
    time_block,
    slot_type,
    label,
    is_custom,
    is_enabled,
    sort_order
  ) values (
    p_trip_id,
    p_slot_date,
    p_time_block,
    p_slot_type,
    trim(p_label),
    true,
    true,
    99
  ) returning * into v_record;

  return to_jsonb(v_record);
end;
$$;

revoke all on function public.phase3_admin_create_custom_time_slot(uuid, date, text, text, text, uuid) from public;
grant execute on function public.phase3_admin_create_custom_time_slot(uuid, date, text, text, text, uuid) to authenticated, service_role;
