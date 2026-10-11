-- Migration: 20261010180000_master_responsibilities.sql
-- Description: Master Responsibilities directory, trip policy columns, RLS, and admin RPCs

-- 1. Master responsibilities directory table
create table if not exists public.master_responsibilities (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 100),
  description text check (description is null or char_length(description) <= 500),
  category text not null check (category in ('meal_prep','cooking','cleanup','activities','transport','other')),
  default_capacity integer not null default 1 check (default_capacity between 1 and 20),
  workload_weight numeric(3,1) not null default 1.0 check (workload_weight between 0.5 and 5.0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists master_responsibilities_category_active_idx 
  on public.master_responsibilities(category, active);

-- 2. Extend camping_trips with policy columns
alter table public.camping_trips
  add column if not exists deposit_amount_cents bigint not null default 5000 check (deposit_amount_cents >= 0),
  add column if not exists contractual_refund_deadline date,
  add column if not exists cancellation_safety_buffer_days integer not null default 5 check (cancellation_safety_buffer_days >= 0),
  add column if not exists task_quota_target integer not null default 2 check (task_quota_target >= 0),
  add column if not exists task_quota_max integer check (task_quota_max is null or task_quota_max >= task_quota_target);

-- 3. Row Level Security & Grants
alter table public.master_responsibilities enable row level security;

-- Deny direct access to anon
revoke all on public.master_responsibilities from anon;

-- Authenticated members can view all master responsibilities
drop policy if exists members_read_master_responsibilities on public.master_responsibilities;
create policy members_read_master_responsibilities on public.master_responsibilities
  for select to authenticated
  using (true);

-- Admins can update/insert via direct table query if authorized
drop policy if exists admins_modify_master_responsibilities on public.master_responsibilities;
create policy admins_modify_master_responsibilities on public.master_responsibilities
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

grant select on public.master_responsibilities to authenticated;
grant all on public.master_responsibilities to service_role;

-- 4. Admin RPC: Create master responsibility
create or replace function public.phase3_admin_create_master_responsibility(
  p_title text,
  p_description text,
  p_category text,
  p_default_capacity integer,
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
  v_new_id uuid;
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

  insert into public.master_responsibilities (
    title,
    description,
    category,
    default_capacity,
    workload_weight,
    active
  ) values (
    trim(p_title),
    nullif(trim(p_description), ''),
    p_category,
    p_default_capacity,
    p_workload_weight,
    true
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
    'master_responsibility',
    v_record.id,
    'master_responsibility_created',
    v_record.title
  );

  return to_jsonb(v_record);
end;
$$;

revoke all on function public.phase3_admin_create_master_responsibility(text, text, text, integer, numeric, uuid) from public;
grant execute on function public.phase3_admin_create_master_responsibility(text, text, text, integer, numeric, uuid) to authenticated, service_role;

-- 5. Admin RPC: Update master responsibility
create or replace function public.phase3_admin_update_master_responsibility(
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

revoke all on function public.phase3_admin_update_master_responsibility(uuid, text, text, text, integer, numeric, boolean, uuid) from public;
grant execute on function public.phase3_admin_update_master_responsibility(uuid, text, text, text, integer, numeric, boolean, uuid) to authenticated, service_role;

-- 6. Seed initial master responsibilities
insert into public.master_responsibilities (title, description, category, default_capacity, workload_weight, active)
values
  ('Vegetable Prep', 'Washing and chopping vegetables for group meals', 'meal_prep', 2, 1.0, true),
  ('Meat & Food Prep', 'Marinating meat and prepping fresh ingredients', 'meal_prep', 2, 1.0, true),
  ('Main Dish Cook', 'Lead cooking for the primary meal dish', 'cooking', 2, 1.5, true),
  ('Side Dish & Rice/Curry', 'Preparing complementary dishes, rice, and sides', 'cooking', 2, 1.0, true),
  ('Dishes & Kitchen Cleanup', 'Washing cookware, dinnerware, and cleaning kitchen counter', 'cleanup', 2, 1.0, true),
  ('Cabin Floor & Room Cleanup', 'Sweeping, tidying up shared areas, and vacuuming', 'cleanup', 2, 1.0, true),
  ('Bathroom Cleaning', 'Sanitizing cabin bathroom and restocking supplies', 'cleanup', 1, 1.5, true),
  ('Carpool Driver', 'Transporting members to and from the campsite', 'transport', 1, 2.0, true),
  ('Activity Planning & Games', 'Organizing evening games, hikes, or group activities', 'activities', 1, 1.0, true),
  ('Campfire & Firewood Setup', 'Collecting wood, building evening campfire, safe extinguishing', 'other', 2, 1.0, true)
on conflict do nothing;
