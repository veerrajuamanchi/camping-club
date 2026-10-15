\set ON_ERROR_STOP 1
begin;
create extension if not exists pgtap;
select plan(15);
-- Setup test users
insert into auth.users (id, email) values
  ('aaaa0001-0001-4001-8001-000000000001', 'admin_duty@example.com'),
  ('aaaa0002-0002-4002-8002-000000000002', 'member_duty1@example.com'),
  ('aaaa0003-0003-4003-8003-000000000003', 'member_duty2@example.com'),
  ('aaaa0004-0004-4004-8004-000000000004', 'not_coming_member@example.com');

insert into public.member_profiles (member_id, auth_user_id, member_role, account_status, display_name) values
  ('aaaa0001-0001-4001-8001-000000000001', 'aaaa0001-0001-4001-8001-000000000001', 'admin', 'active', 'Admin Duty'),
  ('aaaa0002-0002-4002-8002-000000000002', 'aaaa0002-0002-4002-8002-000000000002', 'member', 'active', 'Member One'),
  ('aaaa0003-0003-4003-8003-000000000003', 'aaaa0003-0003-4003-8003-000000000003', 'member', 'active', 'Member Two'),
  ('aaaa0004-0004-4004-8004-000000000004', 'aaaa0004-0004-4004-8004-000000000004', 'member', 'active', 'Member Not Coming');

-- Setup campsite and trip
insert into public.campsites (id, name, location_description, cabin_capacity, rotation_position)
values ('cccc0001-0001-4001-8001-000000000001', 'Camp Duty Test', 'Forest Trail', 12, 99);

insert into public.camping_trips (
  id, month_key, rotation_position, suggested_campsite_id, selected_campsite_id, starts_on, ends_on, poll_status, task_quota_target
) values (
  'eeee0001-0001-4001-8001-000000000001',
  '2029-10-01',
  1,
  'cccc0001-0001-4001-8001-000000000001',
  'cccc0001-0001-4001-8001-000000000001',
  '2029-10-23',
  '2029-10-25',
  'closed',
  2
);

-- Build rule bundle and add acknowledgments for confirmed attendees
select private.phase2_build_rule_bundle('eeee0001-0001-4001-8001-000000000001', 'aaaa0001-0001-4001-8001-000000000001'::uuid);

insert into public.trip_rule_acknowledgments(trip_id, member_id, bundle_id, content_hash, statement_version, request_id)
values
  ('eeee0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002',
   (select id from public.trip_rule_bundles where trip_id = 'eeee0001-0001-4001-8001-000000000001' and is_current),
   (select content_hash from public.trip_rule_bundles where trip_id = 'eeee0001-0001-4001-8001-000000000001' and is_current),
   'coming-v1', gen_random_uuid()),
  ('eeee0001-0001-4001-8001-000000000001', 'aaaa0003-0003-4003-8003-000000000003',
   (select id from public.trip_rule_bundles where trip_id = 'eeee0001-0001-4001-8001-000000000001' and is_current),
   (select content_hash from public.trip_rule_bundles where trip_id = 'eeee0001-0001-4001-8001-000000000001' and is_current),
   'coming-v1', gen_random_uuid());

-- RSVPs: Member 1 & 2 are Coming, Member 4 is Not Coming
insert into public.trip_rsvps (trip_id, member_id, response, rule_acknowledgment_id) values
  ('eeee0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002', 'coming',
   (select id from public.trip_rule_acknowledgments where trip_id = 'eeee0001-0001-4001-8001-000000000001' and member_id = 'aaaa0002-0002-4002-8002-000000000002')),
  ('eeee0001-0001-4001-8001-000000000001', 'aaaa0003-0003-4003-8003-000000000003', 'coming',
   (select id from public.trip_rule_acknowledgments where trip_id = 'eeee0001-0001-4001-8001-000000000001' and member_id = 'aaaa0003-0003-4003-8003-000000000003')),
  ('eeee0001-0001-4001-8001-000000000001', 'aaaa0004-0004-4004-8004-000000000004', 'not_coming', null);

-- Setup master responsibilities & time slot with 2 duties
insert into public.master_responsibilities (id, title, category, default_capacity, workload_weight, active) values
  ('11110001-0001-4001-8001-000000000001', 'Head Cook', 'cooking', 1, 2.0, true),
  ('11110002-0002-4002-8002-000000000002', 'Assistant Cook', 'cooking', 2, 1.0, true);

insert into public.trip_time_slots (id, trip_id, slot_date, time_block, slot_type, label) values
  ('22220001-0001-4001-8001-000000000001', 'eeee0001-0001-4001-8001-000000000001', '2029-10-23', 'friday_dinner', 'meal', 'Friday Feast');

-- Head Cook duty has capacity = 1
insert into public.trip_slot_duties (id, time_slot_id, master_responsibility_id, capacity, workload_weight) values
  ('dddd0001-0001-4001-8001-000000000001', '22220001-0001-4001-8001-000000000001', '11110001-0001-4001-8001-000000000001', 1, 2.0),
  ('dddd0002-0002-4002-8002-000000000002', '22220001-0001-4001-8001-000000000001', '11110002-0002-4002-8002-000000000002', 2, 1.0);


select has_column('public','camping_trips','daily_workload_target','daily target is separate from the legacy trip quota');
select has_function('public','phase3_get_daily_workload_progress',array['uuid','uuid'],'daily progress is a trusted operation');
select public.phase3_set_daily_workload_target('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',4,1,gen_random_uuid());
select is((select daily_workload_target::text from public.camping_trips where id='eeee0001-0001-4001-8001-000000000001'),'4.0','daily target persists');
select throws_ok($$select public.phase3_set_daily_workload_target('aaaa0002-0002-4002-8002-000000000002','eeee0001-0001-4001-8001-000000000001',3,2,gen_random_uuid())$$,'42501',null,'member cannot change daily target');
select throws_ok($$select public.phase3_set_daily_workload_target('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',3,1,gen_random_uuid())$$,'40001',null,'stale target updates are rejected');
select is(public.phase3_get_daily_workload_progress('eeee0001-0001-4001-8001-000000000001','aaaa0002-0002-4002-8002-000000000002')->'days'->0->>'status','needs_selection','open eligible tasks require selection');
select public.phase3_claim_duty('dddd0001-0001-4001-8001-000000000001','aaaa0002-0002-4002-8002-000000000002',false);
select is(public.phase3_get_daily_workload_progress('eeee0001-0001-4001-8001-000000000001','aaaa0002-0002-4002-8002-000000000002')->'days'->0->>'selectedWeight','2.0','one task scores its 2x weight rather than one task count');
select public.phase3_claim_duty('dddd0002-0002-4002-8002-000000000002','aaaa0002-0002-4002-8002-000000000002',true);
select public.phase3_claim_duty('dddd0002-0002-4002-8002-000000000002','aaaa0003-0003-4003-8003-000000000003',false);
select is(public.phase3_get_daily_workload_progress('eeee0001-0001-4001-8001-000000000001','aaaa0003-0003-4003-8003-000000000003')->'days'->0->>'status','no_tasks_available','full slots excuse a member below target');
select is(public.phase3_get_daily_workload_progress('eeee0001-0001-4001-8001-000000000001','aaaa0002-0002-4002-8002-000000000002')->'days'->1->>'selectedWeight','0.0','work on one day is not credited to another day');
select is(public.phase3_get_daily_workload_progress('eeee0001-0001-4001-8001-000000000001','aaaa0002-0002-4002-8002-000000000002')->'days'->1->>'status','no_tasks_scheduled','unscheduled days do not demand selection');
select public.phase3_set_daily_workload_target('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',2.5,2,gen_random_uuid());
select is(public.phase3_get_daily_workload_progress('eeee0001-0001-4001-8001-000000000001','aaaa0002-0002-4002-8002-000000000002')->'days'->0->>'status','target_met','weight above fractional target satisfies the day');
select ok(not has_function_privilege('authenticated','public.phase3_get_daily_workload_progress(uuid,uuid)','execute'),'direct browser calls cannot inspect arbitrary member progress');
select public.phase3_drop_duty((select id from public.trip_duty_assignments where slot_duty_id='dddd0001-0001-4001-8001-000000000001' and member_id='aaaa0002-0002-4002-8002-000000000002'),'aaaa0002-0002-4002-8002-000000000002','Reopen a slot');
select is(public.phase3_get_daily_workload_progress('eeee0001-0001-4001-8001-000000000001','aaaa0003-0003-4003-8003-000000000003')->'days'->0->>'status','needs_selection','released capacity removes an exhaustion exemption');
update public.trip_time_slots set is_enabled=false where id='22220001-0001-4001-8001-000000000001';
select is(public.phase3_get_daily_workload_progress('eeee0001-0001-4001-8001-000000000001','aaaa0003-0003-4003-8003-000000000003')->'days'->0->>'status','no_tasks_scheduled','disabled slots do not impose a requirement');
update public.trip_time_slots set is_enabled=true where id='22220001-0001-4001-8001-000000000001';
update public.trip_slot_duties set is_active=false where id='dddd0002-0002-4002-8002-000000000002';
select is(public.phase3_get_daily_workload_progress('eeee0001-0001-4001-8001-000000000001','aaaa0003-0003-4003-8003-000000000003')->'days'->0->>'selectedWeight','0.0','inactive duties do not contribute daily weight');
select * from finish();
rollback;
