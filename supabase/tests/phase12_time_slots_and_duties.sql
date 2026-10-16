begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- 1. Table structure
select has_table('public', 'trip_time_slots', 'trip_time_slots table exists');
select has_column('public', 'trip_time_slots', 'id', 'trip_time_slots has id');
select has_column('public', 'trip_time_slots', 'trip_id', 'trip_time_slots has trip_id');
select has_column('public', 'trip_time_slots', 'slot_date', 'trip_time_slots has slot_date');
select has_column('public', 'trip_time_slots', 'time_block', 'trip_time_slots has time_block');
select has_column('public', 'trip_time_slots', 'slot_type', 'trip_time_slots has slot_type');
select has_column('public', 'trip_time_slots', 'label', 'trip_time_slots has label');
select has_column('public', 'trip_time_slots', 'is_enabled', 'trip_time_slots has is_enabled');

select has_table('public', 'trip_slot_duties', 'trip_slot_duties table exists');
select has_column('public', 'trip_slot_duties', 'id', 'trip_slot_duties has id');
select has_column('public', 'trip_slot_duties', 'time_slot_id', 'trip_slot_duties has time_slot_id');
select has_column('public', 'trip_slot_duties', 'master_responsibility_id', 'trip_slot_duties has master_responsibility_id');
select has_column('public', 'trip_slot_duties', 'capacity', 'trip_slot_duties has capacity');
select has_column('public', 'trip_slot_duties', 'workload_weight', 'trip_slot_duties has workload_weight');
select has_column('public', 'trip_slot_duties', 'is_active', 'trip_slot_duties has is_active');

-- 2. RLS enabled
select ok((select relrowsecurity from pg_class where oid='public.trip_time_slots'::regclass), 'trip_time_slots RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.trip_slot_duties'::regclass), 'trip_slot_duties RLS enabled');

-- 3. Functions exist
select has_function('public', 'phase3_generate_candidate_time_slots', ARRAY['uuid', 'uuid', 'boolean'], 'phase3_generate_candidate_time_slots exists');
select has_function('public', 'phase3_admin_configure_time_slot', ARRAY['uuid', 'text', 'boolean', 'uuid'], 'phase3_admin_configure_time_slot exists');
select has_function('public', 'phase3_admin_add_slot_duty', ARRAY['uuid', 'uuid', 'integer', 'numeric', 'uuid'], 'phase3_admin_add_slot_duty exists');
select has_function('public', 'phase3_admin_update_slot_duty', ARRAY['uuid', 'integer', 'numeric', 'boolean', 'uuid'], 'phase3_admin_update_slot_duty exists');
select has_function('public', 'phase3_admin_create_custom_time_slot', ARRAY['uuid', 'date', 'text', 'text', 'text', 'uuid'], 'phase3_admin_create_custom_time_slot exists');

-- 4. Generator execution test with real trip & admin
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('12000000-0000-4000-8000-000000000001','authenticated','authenticated','p12-member@example.test','',now(),'{}','{}',now(),now()),
  ('12000000-0000-4000-8000-000000000002','authenticated','authenticated','p12-admin@example.test','',now(),'{}','{}',now(),now())
on conflict do nothing;

insert into public.member_profiles(member_id,auth_user_id,display_name,member_role,account_status)
values
  ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','Slot Member','member','active'),
  ('22000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','Slot Admin','admin','active')
on conflict do nothing;

-- Pick first trip and configure dates
update public.camping_trips 
set starts_on = '2026-11-13', ends_on = '2026-11-15'
where id = (select id from public.camping_trips order by month_key limit 1);

-- Unauthorized call throws
select throws_ok(
  $$select public.phase3_generate_candidate_time_slots((select id from public.camping_trips order by month_key limit 1), '22000000-0000-4000-8000-000000000001'::uuid, false)$$,
  '42501',
  null,
  'member cannot generate candidate slots'
);

-- Explicit daily choices replace automatic weekend presets.
select throws_ok(
  $$select public.phase3_generate_candidate_time_slots((select id from public.camping_trips order by month_key limit 1), '22000000-0000-4000-8000-000000000002'::uuid, false)$$,
  '22023', null, 'preset generator directs admin to the daily planner'
);
select is((select count(*)::int from public.trip_time_slots where trip_id=(select id from public.camping_trips order by month_key limit 1)),0,'retired generator creates no slots');
insert into public.trip_time_slots(trip_id,slot_date,time_block,slot_type,label)
  values((select id from public.camping_trips order by month_key limit 1),'2026-11-13','custom','chore','Explicit setup');

-- Admin can configure time slot (e.g. toggle enabled)
select lives_ok(
  $$select public.phase3_admin_configure_time_slot(
    (select id from public.trip_time_slots limit 1),
    'Customized Label',
    false,
    '22000000-0000-4000-8000-000000000002'::uuid
  )$$,
  'admin can configure time slot label and enabled state'
);

select * from finish();
rollback;
