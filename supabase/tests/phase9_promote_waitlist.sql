begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Fixture: users and member profiles
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('95000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase9-admin@example.test', '', now(), '{}', '{}', now(), now()),
  ('95000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase9-member-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('95000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'phase9-member-b@example.test', '', now(), '{}', '{}', now(), now());

insert into public.member_profiles(member_id, auth_user_id, display_name, member_role, account_status)
values
  ('96000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'Phase 9 Admin', 'admin', 'active'),
  ('96000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000002', 'Phase 9 Member A', 'member', 'active'),
  ('96000000-0000-4000-8000-000000000003', '95000000-0000-4000-8000-000000000003', 'Phase 9 Member B', 'member', 'active');

create temporary table promote_test_trip as
select (select id from public.camping_trips order by month_key limit 1) as trip_id;

-- 1. Schema checks
select has_function(
  'public',
  'trip_api_promote_from_waitlist',
  ARRAY['uuid', 'uuid', 'uuid'],
  'trip_api_promote_from_waitlist(uuid, uuid, uuid) function exists'
);

-- 2. Privilege checks: non-service role execution rejected
select ok(
  not has_function_privilege('anon', 'public.trip_api_promote_from_waitlist(uuid,uuid,uuid)', 'execute'),
  'anon cannot execute trip_api_promote_from_waitlist'
);

select ok(
  not has_function_privilege('authenticated', 'public.trip_api_promote_from_waitlist(uuid,uuid,uuid)', 'execute'),
  'authenticated cannot execute trip_api_promote_from_waitlist'
);

select ok(
  has_function_privilege('service_role', 'public.trip_api_promote_from_waitlist(uuid,uuid,uuid)', 'execute'),
  'service_role can execute trip_api_promote_from_waitlist'
);

-- 3. Reject promotion if member is not on waitlist
select throws_ok(
  format(
    $$select public.trip_api_promote_from_waitlist('%s', '96000000-0000-4000-8000-000000000002'::uuid, '96000000-0000-4000-8000-000000000001'::uuid)$$,
    (select trip_id from promote_test_trip)
  ),
  'P0001',
  'member_not_on_waitlist',
  'rejects promotion if member not on waitlist'
);

-- Setup: add Member A to waitlist
insert into public.trip_waitlist_entries(trip_id, member_id, position, status)
values ((select trip_id from promote_test_trip), '96000000-0000-4000-8000-000000000002', 1, 'waiting');

-- Build rule bundle and add Member B as an existing confirmed RSVP
select private.phase2_build_rule_bundle((select trip_id from promote_test_trip), '96000000-0000-4000-8000-000000000001'::uuid);

insert into public.trip_rule_acknowledgments(trip_id, member_id, bundle_id, content_hash, statement_version, request_id)
values (
  (select trip_id from promote_test_trip),
  '96000000-0000-4000-8000-000000000003',
  (select id from public.trip_rule_bundles where trip_id = (select trip_id from promote_test_trip) and is_current),
  (select content_hash from public.trip_rule_bundles where trip_id = (select trip_id from promote_test_trip) and is_current),
  'coming-v1',
  gen_random_uuid()
);

insert into public.trip_rsvps(trip_id, member_id, response, rule_acknowledgment_id, version)
values (
  (select trip_id from promote_test_trip),
  '96000000-0000-4000-8000-000000000003',
  'coming',
  (select id from public.trip_rule_acknowledgments where trip_id = (select trip_id from promote_test_trip) and member_id = '96000000-0000-4000-8000-000000000003'),
  1
);

-- 4. Reject promotion if trip is at capacity
-- Set max_capacity = 1 so coming_count (1) >= max_capacity (1)
update public.camping_trips
set max_capacity = 1
where id = (select trip_id from promote_test_trip);

select throws_ok(
  format(
    $$select public.trip_api_promote_from_waitlist('%s', '96000000-0000-4000-8000-000000000002'::uuid, '96000000-0000-4000-8000-000000000001'::uuid)$$,
    (select trip_id from promote_test_trip)
  ),
  '23514',
  'trip_at_capacity',
  'rejects promotion if trip is at capacity'
);

-- Expand capacity to allow promotion
update public.camping_trips
set max_capacity = 10
where id = (select trip_id from promote_test_trip);

-- 5. Successful promotion
create temporary table promote_result as
select public.trip_api_promote_from_waitlist(
  (select trip_id from promote_test_trip),
  '96000000-0000-4000-8000-000000000002'::uuid,
  '96000000-0000-4000-8000-000000000001'::uuid
) as result;

select is(
  ((select result from promote_result)->>'promoted')::boolean,
  true,
  'promotion returns promoted = true'
);

select is(
  ((select result from promote_result)->>'memberId'),
  '96000000-0000-4000-8000-000000000002',
  'promotion returns correct memberId'
);

select is(
  ((select result from promote_result)->>'position')::int,
  1,
  'promotion returns original waitlist position'
);

-- 6. Verify waitlist entry is updated to promoted
select is(
  (select status from public.trip_waitlist_entries where trip_id = (select trip_id from promote_test_trip) and member_id = '96000000-0000-4000-8000-000000000002'),
  'promoted',
  'waitlist entry status is updated to promoted'
);

select ok(
  (select resolved_at from public.trip_waitlist_entries where trip_id = (select trip_id from promote_test_trip) and member_id = '96000000-0000-4000-8000-000000000002') is not null,
  'waitlist entry resolved_at is set'
);

select is(
  (select promoted_by from public.trip_waitlist_entries where trip_id = (select trip_id from promote_test_trip) and member_id = '96000000-0000-4000-8000-000000000002'),
  '96000000-0000-4000-8000-000000000001'::uuid,
  'waitlist entry promoted_by is set to admin'
);

-- 7. Verify RSVP is created with response coming
select is(
  (select response from public.trip_rsvps where trip_id = (select trip_id from promote_test_trip) and member_id = '96000000-0000-4000-8000-000000000002'),
  'coming',
  'trip_rsvps contains response = coming for promoted member'
);

select ok(
  (select rule_acknowledgment_id from public.trip_rsvps where trip_id = (select trip_id from promote_test_trip) and member_id = '96000000-0000-4000-8000-000000000002') is not null,
  'trip_rsvps has non-null rule_acknowledgment_id'
);

-- 8. Already promoted member cannot be promoted again
select throws_ok(
  format(
    $$select public.trip_api_promote_from_waitlist('%s', '96000000-0000-4000-8000-000000000002'::uuid, '96000000-0000-4000-8000-000000000001'::uuid)$$,
    (select trip_id from promote_test_trip)
  ),
  'P0001',
  'member_not_on_waitlist',
  'cannot promote member whose waitlist status is already promoted'
);

select * from finish();
rollback;
