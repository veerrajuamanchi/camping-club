\pset format unaligned
\pset tuples_only true
\set QUIET 1
\set ON_ERROR_STOP 1

begin;
create extension if not exists pgtap;
select plan(18);

-- Create test admin and test member
insert into auth.users(id,email) values ('a0000000-0000-0000-0000-000000000001','admin1@test.com'), ('a0000000-0000-0000-0000-000000000002','member1@test.com');

insert into public.member_profiles(member_id, auth_user_id, display_name, member_role, account_status)
values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Admin One', 'admin', 'active'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Member One', 'member', 'active');

-- Create test campsite and trip
insert into public.campsites(id, rotation_position, name, location_description, cabin_capacity, active)
values ('c0000000-0000-0000-0000-000000000001', 99, 'Camp Evergreen', '123 Forest Rd', 10, true);

insert into public.camping_trips(id, month_key, rotation_position, suggested_campsite_id, selected_campsite_id, starts_on, ends_on, poll_status, poll_deadline_at, event_status, version)
values ('d0000000-0000-0000-0000-000000000001', '2038-01-01'::date, 1, 'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', current_date + interval '60 days', current_date + interval '63 days', 'closed', now() - interval '5 days', 'confirmed', 1);

-- Create rule definition & version & bundle
insert into public.rule_definitions(id, stable_key, category, scope, active)
values ('e0000000-0000-0000-0000-000000000001', 'safety-first', 'conduct', 'general', true);

insert into public.rule_versions(id, definition_id, version_no, human_text, structured_values, created_by)
values ('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 1, 'Always stay safe', '{}'::jsonb, 'b0000000-0000-0000-0000-000000000001');

select private.phase2_build_rule_bundle('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');

insert into public.trip_rule_acknowledgments(trip_id,member_id,bundle_id,content_hash,statement_version,request_id)
select trip_id,'b0000000-0000-0000-0000-000000000002',id,content_hash,'coming-v1',gen_random_uuid()
from public.trip_rule_bundles where trip_id='d0000000-0000-0000-0000-000000000001' and is_current;

set local role service_role;

-- Member RSVP 'coming' via phase2_admin_record_interest (or direct)
select public.phase2_admin_record_interest(
  'b0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000002',
  'coming',
  0,
  'Admin RSVP member for closed trip',
  gen_random_uuid()
);

select results_eq(
  $$ select response from public.trip_rsvps where trip_id = 'd0000000-0000-0000-0000-000000000001' and member_id = 'b0000000-0000-0000-0000-000000000002' $$,
  $$ values ('coming'::text) $$,
  'Member successfully marked coming on a closed/confirmed event'
);

-- Member submits RSVP to not_coming via phase2_submit_rsvp on closed poll
select public.phase2_submit_rsvp(
  'a0000000-0000-0000-0000-000000000002',
  'd0000000-0000-0000-0000-000000000001',
  'not_coming',
  null,
  null,
  1,
  gen_random_uuid()
);

select results_eq(
  $$ select response from public.trip_rsvps where trip_id = 'd0000000-0000-0000-0000-000000000001' and member_id = 'b0000000-0000-0000-0000-000000000002' $$,
  $$ values ('not_coming'::text) $$,
  'Member can change RSVP to not_coming even when poll is closed'
);

-- Member switches back to coming
select public.phase2_admin_record_interest(
  'b0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000002',
  'coming',
  2,
  'Admin RSVP back to coming',
  gen_random_uuid()
);

-- Create a time slot & slot duty & assign to member
insert into public.trip_time_slots(id, trip_id, slot_date, time_block, slot_type, label)
values ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', current_date + interval '60 days', 'friday_dinner', 'meal', 'Dinner Day 1');

insert into public.master_responsibilities(id, title, description, category, default_capacity, workload_weight, active)
values ('f0000000-0000-0000-0000-000000000002', 'Head Cook', 'Cook dinner', 'cooking', 1, 1.0, true);

insert into public.trip_slot_duties(id, time_slot_id, master_responsibility_id, capacity, workload_weight)
values ('f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 1, 1.0);

insert into public.trip_duty_assignments(id, trip_id, slot_duty_id, member_id, status)
values ('f0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'claimed');

-- Verify duty assignment is claimed
select results_eq(
  $$ select status from public.trip_duty_assignments where id = 'f0000000-0000-0000-0000-000000000004' $$,
  $$ values ('claimed'::text) $$,
  'Duty assignment is active claimed before deactivation'
);

-- Reject stale updates and cancelled/past events, without changing the saved RSVP.
select throws_ok($$select public.phase2_submit_rsvp('a0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','not_coming',null,null,1,gen_random_uuid())$$,'40001',null,'stale RSVP version is rejected');
update public.camping_trips set event_status='cancelled' where id='d0000000-0000-0000-0000-000000000001';
select throws_ok($$select public.phase2_submit_rsvp('a0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','not_coming',null,null,3,gen_random_uuid())$$,'P0001','camping event is closed','cancelled event rejects RSVP changes');
update public.camping_trips set event_status='confirmed',starts_on=current_date-3,ends_on=current_date-1 where id='d0000000-0000-0000-0000-000000000001';
select throws_ok($$select public.phase2_submit_rsvp('a0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','not_coming',null,null,3,gen_random_uuid())$$,'P0001','camping event is closed','past event rejects RSVP changes');
-- Past attendance is retained when the member is disabled.
select public.phase1_update_membership('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','member','suspended','Test historic preservation',gen_random_uuid());
select is((select response from public.trip_rsvps where trip_id='d0000000-0000-0000-0000-000000000001'),'coming','past attendance remains intact');
select public.phase1_update_membership('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','member','active','Test reactivation',gen_random_uuid());
update public.camping_trips set starts_on=current_date+60,ends_on=current_date+63 where id='d0000000-0000-0000-0000-000000000001';
insert into public.trip_waitlist_entries(trip_id,member_id,position) values ('d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',1);
-- Admin deactivates the member
select public.phase1_update_membership(
  'b0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000002',
  'member',
  'inactive',
  'Member left the club',
  gen_random_uuid()
);

-- Member account status is inactive
select results_eq(
  $$ select account_status from public.member_profiles where member_id = 'b0000000-0000-0000-0000-000000000002' $$,
  $$ values ('inactive'::text) $$,
  'Member profile status updated to inactive'
);

-- Member RSVP is automatically removed (changed to not_coming)
select results_eq(
  $$ select response from public.trip_rsvps where trip_id = 'd0000000-0000-0000-0000-000000000001' and member_id = 'b0000000-0000-0000-0000-000000000002' $$,
  $$ values ('not_coming'::text) $$,
  'Member was automatically removed from upcoming trip RSVP'
);

-- Duty assignment was automatically dropped
select results_eq(
  $$ select status from public.trip_duty_assignments where id = 'f0000000-0000-0000-0000-000000000004' $$,
  $$ values ('dropped'::text) $$,
  'Member duty assignment was automatically dropped upon deactivation'
);

-- Audit event was recorded
select is(
  (select count(*) from public.trip_rsvp_events where member_id = 'b0000000-0000-0000-0000-000000000002' and to_response = 'not_coming' and reason = 'Member account deactivated by administrator')::integer,
  1,
  'Audit event was recorded for the automatic RSVP removal'
);

select is((select status from public.trip_waitlist_entries where trip_id='d0000000-0000-0000-0000-000000000001'),'removed','deactivation releases waitlist entry');
select throws_ok($$select public.phase2_submit_rsvp('a0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','coming',null,null,4,gen_random_uuid())$$,'42501','active member required','inactive member cannot rejoin');
-- Model a stale acceptance from an account disabled before this fix was installed.
reset role;
update public.trip_rsvps set response='coming' where trip_id='d0000000-0000-0000-0000-000000000001';
update public.trip_duty_assignments set status='claimed',released_at=null where id='f0000000-0000-0000-0000-000000000004';
update public.trip_waitlist_entries set status='waiting',resolved_at=null where trip_id='d0000000-0000-0000-0000-000000000001';
\ir ../migrations/20261015070306_event_access_and_rsvp_maintenance.sql
select is((select response from public.trip_rsvps where trip_id='d0000000-0000-0000-0000-000000000001'),'not_coming','migration repairs previously disabled member acceptance');
select is((select status from public.trip_duty_assignments where id='f0000000-0000-0000-0000-000000000004'),'dropped','migration repairs disabled member duties');
select is((select status from public.trip_waitlist_entries where trip_id='d0000000-0000-0000-0000-000000000001'),'removed','migration repairs disabled member waitlist');
select is((select count(*)::integer from public.trip_rsvp_events where member_id='b0000000-0000-0000-0000-000000000002' and reason='Maintenance: remove upcoming participation for previously disabled account'),1,'backfill appends an explicit system-authored event');
\ir ../migrations/20261015070306_event_access_and_rsvp_maintenance.sql
select is((select count(*)::integer from public.trip_rsvp_events where member_id='b0000000-0000-0000-0000-000000000002' and reason='Maintenance: remove upcoming participation for previously disabled account'),1,'backfill is safe to repeat without duplicate events');
select * from finish();
rollback;
