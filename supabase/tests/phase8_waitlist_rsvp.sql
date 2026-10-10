begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Fixture: users and member profiles
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('85000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase8-member-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('85000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase8-member-b@example.test', '', now(), '{}', '{}', now(), now());

insert into public.member_profiles(member_id, auth_user_id, display_name, member_role, account_status)
values
  ('86000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'Phase 8 Member A', 'member', 'active'),
  ('86000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000002', 'Phase 8 Member B', 'member', 'active');

create temporary table waitlist_test_trip as
select (select id from public.camping_trips order by month_key limit 1) as trip_id;

-- 1. Schema check
select has_function(
  'public',
  'trip_api_join_waitlist',
  ARRAY['uuid', 'uuid', 'uuid'],
  'trip_api_join_waitlist(uuid, uuid, uuid) function exists'
);

-- 2. Privilege checks: non-service role execution rejected
select ok(
  not has_function_privilege('anon', 'public.trip_api_join_waitlist(uuid,uuid,uuid)', 'execute'),
  'anon cannot execute trip_api_join_waitlist'
);

select ok(
  not has_function_privilege('authenticated', 'public.trip_api_join_waitlist(uuid,uuid,uuid)', 'execute'),
  'authenticated cannot execute trip_api_join_waitlist'
);

select ok(
  has_function_privilege('service_role', 'public.trip_api_join_waitlist(uuid,uuid,uuid)', 'execute'),
  'service_role can execute trip_api_join_waitlist'
);

-- 3. Behavior: first join creates waitlist entry at position 1
create temporary table join_1 as
select public.trip_api_join_waitlist(
  (select trip_id from waitlist_test_trip),
  '86000000-0000-4000-8000-000000000001'::uuid,
  '88000000-0000-4000-8000-000000000001'::uuid
) as result;

select is(
  ((select result from join_1)->>'waitlisted')::boolean,
  true,
  'first join returns waitlisted = true'
);

select is(
  ((select result from join_1)->>'position')::int,
  1,
  'first join returns position = 1'
);

select ok(
  (select result from join_1)->>'entryId' is not null,
  'first join returns entryId'
);

-- 4. Behavior: second join creates waitlist entry at position 2
create temporary table join_2 as
select public.trip_api_join_waitlist(
  (select trip_id from waitlist_test_trip),
  '86000000-0000-4000-8000-000000000002'::uuid,
  '88000000-0000-4000-8000-000000000002'::uuid
) as result;

select is(
  ((select result from join_2)->>'waitlisted')::boolean,
  true,
  'second join returns waitlisted = true'
);

select is(
  ((select result from join_2)->>'position')::int,
  2,
  'second join returns position = 2'
);

-- 5. Idempotency: rejoining when already waiting returns existing position without duplicate
create temporary table join_idempotent as
select public.trip_api_join_waitlist(
  (select trip_id from waitlist_test_trip),
  '86000000-0000-4000-8000-000000000001'::uuid,
  '88000000-0000-4000-8000-000000000003'::uuid
) as result;

select is(
  ((select result from join_idempotent)->>'waitlisted')::boolean,
  true,
  'idempotent join returns waitlisted = true'
);

select is(
  ((select result from join_idempotent)->>'position')::int,
  1,
  'idempotent join returns existing position 1'
);

select is(
  (select count(*)::int from public.trip_waitlist_entries where trip_id = (select trip_id from waitlist_test_trip)),
  2,
  'total waitlist entries remains 2 after idempotent join'
);

select * from finish();
rollback;
