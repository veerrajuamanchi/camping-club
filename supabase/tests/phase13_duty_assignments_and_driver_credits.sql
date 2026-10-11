\set ON_ERROR_STOP 1
create extension if not exists pgtap;

begin;

select plan(28);

-- 1. Table existence & RLS
select has_table('public', 'trip_duty_assignments', 'trip_duty_assignments table exists');
select has_table('public', 'trip_driver_credits', 'trip_driver_credits table exists');

select table_privs_are(
  'public', 'trip_duty_assignments', 'anon', ARRAY[]::text[],
  'anon has no access to trip_duty_assignments'
);
select table_privs_are(
  'public', 'trip_driver_credits', 'anon', ARRAY[]::text[],
  'anon has no access to trip_driver_credits'
);

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

-- TEST 5: Direct insert into trip_duty_assignments by authenticated user is denied by RLS
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "aaaa0002-0002-4002-8002-000000000002"}';
select throws_ok(
  $$ insert into public.trip_duty_assignments (trip_id, slot_duty_id, member_id) values ('eeee0001-0001-4001-8001-000000000001', 'dddd0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002') $$,
  '42501',
  null,
  'direct insert into trip_duty_assignments is denied by RLS'
);
reset role;

-- TEST 6: Non-confirmed member cannot claim duty
select throws_ok(
  $$ select public.phase3_claim_duty('dddd0001-0001-4001-8001-000000000001', 'aaaa0004-0004-4004-8004-000000000004', false) $$,
  '42501',
  null,
  'member who is not confirmed attendee cannot claim duty'
);

-- TEST 7: Confirmed attendee Member 1 claims Head Cook (capacity = 1)
select lives_ok(
  $$ select public.phase3_claim_duty('dddd0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002', false) $$,
  'member 1 claims head cook successfully'
);

-- TEST 8: Verify assignment row created with status claimed
select results_eq(
  $$ select status, member_id from public.trip_duty_assignments where slot_duty_id = 'dddd0001-0001-4001-8001-000000000001' and status = 'claimed' $$,
  $$ values ('claimed'::text, 'aaaa0002-0002-4002-8002-000000000002'::uuid) $$,
  'assignment row is in claimed status'
);

-- TEST 9: Duplicate claim by Member 1 fails
select throws_ok(
  $$ select public.phase3_claim_duty('dddd0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002', false) $$,
  '23505',
  null,
  'duplicate claim by same member on same duty is rejected'
);

-- TEST 10: Capacity reached: Member 2 attempting to claim Head Cook (cap 1) fails with 23514
select throws_ok(
  $$ select public.phase3_claim_duty('dddd0001-0001-4001-8001-000000000001', 'aaaa0003-0003-4003-8003-000000000003', false) $$,
  '23514',
  null,
  'claim rejected when duty capacity is full'
);

-- TEST 11: Overlap detection: Member 1 attempting to claim Assistant Cook in the same slot returns overlap warning when unacknowledged
select is(
  (public.phase3_claim_duty('dddd0002-0002-4002-8002-000000000002', 'aaaa0002-0002-4002-8002-000000000002', false)->>'overlap_detected')::boolean,
  true,
  'overlap detected when member volunteers for overlapping duty in same time slot'
);

-- TEST 12: Member 1 can claim with overlap acknowledged
select lives_ok(
  $$ select public.phase3_claim_duty('dddd0002-0002-4002-8002-000000000002', 'aaaa0002-0002-4002-8002-000000000002', true) $$,
  'member 1 claims overlapping duty when overlap is acknowledged'
);

-- TEST 13: Non-owner cannot drop Member 1 assignment
select throws_ok(
  $$ select public.phase3_drop_duty((select id from public.trip_duty_assignments where member_id = 'aaaa0002-0002-4002-8002-000000000002' and slot_duty_id = 'dddd0001-0001-4001-8001-000000000001'), 'aaaa0003-0003-4003-8003-000000000003', 'wrong person') $$,
  '42501',
  null,
  'non-owner non-admin cannot drop an assignment'
);

-- TEST 14: Member 1 drops Head Cook duty
select lives_ok(
  $$ select public.phase3_drop_duty((select id from public.trip_duty_assignments where member_id = 'aaaa0002-0002-4002-8002-000000000002' and slot_duty_id = 'dddd0001-0001-4001-8001-000000000001'), 'aaaa0002-0002-4002-8002-000000000002', 'busy schedule') $$,
  'member 1 successfully drops head cook'
);

-- TEST 15: History preserved: assignment record still exists with status dropped
select results_eq(
  $$ select status, release_reason from public.trip_duty_assignments where member_id = 'aaaa0002-0002-4002-8002-000000000002' and slot_duty_id = 'dddd0001-0001-4001-8001-000000000001' $$,
  $$ values ('dropped'::text, 'busy schedule'::text) $$,
  'assignment status updated to dropped and reason preserved'
);

-- TEST 16: Capacity released: Member 2 can now claim Head Cook
select lives_ok(
  $$ select public.phase3_claim_duty('dddd0001-0001-4001-8001-000000000001', 'aaaa0003-0003-4003-8003-000000000003', false) $$,
  'member 2 claims head cook after capacity was released'
);

-- TEST 17: Admin assign: Admin assigns Member 2 to Assistant Cook
select lives_ok(
  $$ select public.phase3_admin_assign_duty('dddd0002-0002-4002-8002-000000000002', 'aaaa0003-0003-4003-8003-000000000003', 'aaaa0001-0001-4001-8001-000000000001') $$,
  'admin successfully assigns member 2 to assistant cook'
);

-- TEST 18: Assignment marked as assigned_by_admin
select results_eq(
  $$ select status from public.trip_duty_assignments where member_id = 'aaaa0003-0003-4003-8003-000000000003' and slot_duty_id = 'dddd0002-0002-4002-8002-000000000002' $$,
  $$ values ('assigned_by_admin'::text) $$,
  'status is assigned_by_admin'
);

-- TEST 19: Non-admin cannot call admin_assign_duty
select throws_ok(
  $$ select public.phase3_admin_assign_duty('dddd0002-0002-4002-8002-000000000002', 'aaaa0003-0003-4003-8003-000000000003', 'aaaa0002-0002-4002-8002-000000000002') $$,
  '42501',
  null,
  'non-admin cannot call admin_assign_duty'
);

-- TEST 20: Admin reassign duty
select lives_ok(
  $$ select public.phase3_admin_reassign_duty(
       (select id from public.trip_duty_assignments where member_id = 'aaaa0003-0003-4003-8003-000000000003' and slot_duty_id = 'dddd0001-0001-4001-8001-000000000001'),
       'aaaa0002-0002-4002-8002-000000000002',
       'aaaa0001-0001-4001-8001-000000000001',
       'admin switched assignment'
     ) $$,
  'admin successfully reassigns duty'
);

-- TEST 21: Old assignment marked reassigned
select results_eq(
  $$ select status from public.trip_duty_assignments where member_id = 'aaaa0003-0003-4003-8003-000000000003' and slot_duty_id = 'dddd0001-0001-4001-8001-000000000001' $$,
  $$ values ('reassigned'::text) $$,
  'old assignment marked reassigned'
);

-- TEST 22: Non-admin cannot set driver workload credit
select throws_ok(
  $$ select public.phase3_admin_set_driver_credit('eeee0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002', 1.0, 'approved', 'carpool driver', 'aaaa0002-0002-4002-8002-000000000002') $$,
  '42501',
  null,
  'non-admin cannot approve driver workload credit'
);

-- TEST 23: Admin approves driver workload credit
select lives_ok(
  $$ select public.phase3_admin_set_driver_credit('eeee0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002', 1.0, 'approved', 'carpool driver', 'aaaa0001-0001-4001-8001-000000000001') $$,
  'admin approves driver credit'
);

-- TEST 24: Driver credit row exists in trip_driver_credits
select results_eq(
  $$ select status, workload_credit from public.trip_driver_credits where trip_id = 'eeee0001-0001-4001-8001-000000000001' and member_id = 'aaaa0002-0002-4002-8002-000000000002' $$,
  $$ values ('approved'::text, 1.0::numeric) $$,
  'driver credit row exists with approved status'
);

-- TEST 25: Quota progress calculates duty workload + driver credit
-- Member 1 now has:
-- - Head Cook (reassigned to Member 1, weight 2.0)
-- - Assistant Cook (claimed by Member 1, weight 1.0)
-- - Driver credit (weight 1.0)
-- Total score: 4.0; Quota target: 2; Target reached: true
select is(
  (public.phase3_get_member_quota_progress('eeee0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002')->>'total_score')::numeric,
  4.0::numeric,
  'total score includes duties plus approved driver credit'
);

-- TEST 26: Quota target reached is true
select is(
  (public.phase3_get_member_quota_progress('eeee0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002')->>'target_reached')::boolean,
  true,
  'target reached is true when score >= target'
);

-- TEST 27: Audit events recorded for duty claim and drop
select results_eq(
  $$ select count(*)::integer from public.audit_events where entity_type = 'trip_duty_assignment' and action in ('duty_claimed', 'duty_dropped') $$,
  $$ values (4) $$,
  'audit events recorded for claim and drop transitions'
);

-- TEST 28: Audit event recorded for driver credit approval
select results_eq(
  $$ select count(*)::integer from public.audit_events where entity_type = 'trip_driver_credit' and action = 'driver_credit_approved' $$,
  $$ values (1) $$,
  'audit event recorded for driver credit approval'
);

select * from finish();
rollback;
