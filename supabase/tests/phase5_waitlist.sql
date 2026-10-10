begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- Fixture: users and member profiles
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('55000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase5-member-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('55000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase5-member-b@example.test', '', now(), '{}', '{}', now(), now()),
  ('55000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'phase5-admin@example.test', '', now(), '{}', '{}', now(), now()),
  ('55000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'phase5-suspended@example.test', '', now(), '{}', '{}', now(), now());

insert into public.member_profiles(member_id, auth_user_id, display_name, member_role, account_status)
values
  ('65000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', 'Phase 5 Member A', 'member', 'active'),
  ('65000000-0000-4000-8000-000000000002', '55000000-0000-4000-8000-000000000002', 'Phase 5 Member B', 'member', 'active'),
  ('65000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000003', 'Phase 5 Admin', 'admin', 'active'),
  ('65000000-0000-4000-8000-000000000004', '55000000-0000-4000-8000-000000000004', 'Phase 5 Suspended', 'member', 'suspended');

create temporary table waitlist_fixtures as
select
  (select id from public.camping_trips order by month_key limit 1) as trip_1,
  (select id from public.camping_trips order by month_key offset 1 limit 1) as trip_2;

-- 1. Schema checks
select has_table('public', 'trip_waitlist_entries', 'trip_waitlist_entries table exists');
select has_column('public', 'trip_waitlist_entries', 'id', 'id column exists');
select has_column('public', 'trip_waitlist_entries', 'trip_id', 'trip_id column exists');
select has_column('public', 'trip_waitlist_entries', 'member_id', 'member_id column exists');
select has_column('public', 'trip_waitlist_entries', 'position', 'position column exists');
select has_column('public', 'trip_waitlist_entries', 'status', 'status column exists');
select has_column('public', 'trip_waitlist_entries', 'created_at', 'created_at column exists');
select has_column('public', 'trip_waitlist_entries', 'resolved_at', 'resolved_at column exists');
select has_column('public', 'trip_waitlist_entries', 'promoted_by', 'promoted_by column exists');
select col_default_is('public', 'trip_waitlist_entries', 'status', 'waiting'::text, 'status column defaults to waiting');
select has_function('public', 'trip_waitlist_next_position', ARRAY['uuid'], 'trip_waitlist_next_position function exists');

-- 2. Index checks (composite, unique, and foreign key indexes per Rule 5)
select has_index('public', 'trip_waitlist_entries', 'trip_waitlist_trip_status_pos_idx', 'composite status position index exists');
select has_index('public', 'trip_waitlist_entries', 'waitlist_member_waiting_uidx', 'partial unique index on waiting status exists');
select has_index('public', 'trip_waitlist_entries', 'trip_waitlist_member_idx', 'member_id FK index exists');
select has_index('public', 'trip_waitlist_entries', 'trip_waitlist_promoted_by_idx', 'promoted_by FK index exists');

-- 3. Grants and RLS configuration
select ok((select relrowsecurity from pg_class where oid = 'public.trip_waitlist_entries'::regclass), 'trip_waitlist_entries has RLS enabled');
select ok(not has_table_privilege('anon', 'public.trip_waitlist_entries', 'select'), 'anon has no select on trip_waitlist_entries');
select ok(not has_table_privilege('anon', 'public.trip_waitlist_entries', 'insert'), 'anon has no insert on trip_waitlist_entries');
select ok(has_table_privilege('authenticated', 'public.trip_waitlist_entries', 'select'), 'authenticated has select on trip_waitlist_entries');
select ok(not has_table_privilege('authenticated', 'public.trip_waitlist_entries', 'insert'), 'authenticated has no direct insert on trip_waitlist_entries');
select ok(not has_table_privilege('authenticated', 'public.trip_waitlist_entries', 'update'), 'authenticated has no direct update on trip_waitlist_entries');
select ok(not has_table_privilege('authenticated', 'public.trip_waitlist_entries', 'delete'), 'authenticated has no direct delete on trip_waitlist_entries');

-- 4. Constraints checks
select throws_ok(
  format(
    $$insert into public.trip_waitlist_entries (trip_id, member_id, position) values ('%s', '65000000-0000-4000-8000-000000000001', 0)$$,
    (select trip_1 from waitlist_fixtures)
  ),
  '23514',
  null,
  'position >= 1 check constraint rejects 0'
);

select throws_ok(
  format(
    $$insert into public.trip_waitlist_entries (trip_id, member_id, position, status) values ('%s', '65000000-0000-4000-8000-000000000001', 1, 'invalid_status')$$,
    (select trip_1 from waitlist_fixtures)
  ),
  '23514',
  null,
  'status check constraint rejects invalid status'
);

-- 5. Helper function trip_waitlist_next_position behavior
select is(
  public.trip_waitlist_next_position((select trip_1 from waitlist_fixtures)),
  1,
  'trip_waitlist_next_position returns 1 when trip has no waitlist entries'
);

insert into public.trip_waitlist_entries (trip_id, member_id, position, status)
select trip_1, '65000000-0000-4000-8000-000000000001', 1, 'waiting'
from waitlist_fixtures;

select is(
  public.trip_waitlist_next_position((select trip_1 from waitlist_fixtures)),
  2,
  'trip_waitlist_next_position returns 2 after first position inserted'
);

insert into public.trip_waitlist_entries (trip_id, member_id, position, status)
select trip_1, '65000000-0000-4000-8000-000000000002', 2, 'waiting'
from waitlist_fixtures;

select is(
  public.trip_waitlist_next_position((select trip_1 from waitlist_fixtures)),
  3,
  'trip_waitlist_next_position returns 3 after second position inserted'
);

select is(
  public.trip_waitlist_next_position((select trip_2 from waitlist_fixtures)),
  1,
  'trip_waitlist_next_position returns 1 for different trip with no entries'
);

-- 6. Partial unique index check: only one 'waiting' per member per trip
select throws_ok(
  format(
    $$insert into public.trip_waitlist_entries (trip_id, member_id, position, status) values ('%s', '65000000-0000-4000-8000-000000000001', 3, 'waiting')$$,
    (select trip_1 from waitlist_fixtures)
  ),
  '23505',
  null,
  'cannot insert second waiting entry for same member on same trip'
);

-- Promote member A's entry, then inserting another 'waiting' entry succeeds
update public.trip_waitlist_entries
set status = 'promoted', resolved_at = now(), promoted_by = '65000000-0000-4000-8000-000000000003'
where member_id = '65000000-0000-4000-8000-000000000001' and status = 'waiting';

select lives_ok(
  format(
    $$insert into public.trip_waitlist_entries (trip_id, member_id, position, status) values ('%s', '65000000-0000-4000-8000-000000000001', 3, 'waiting')$$,
    (select trip_1 from waitlist_fixtures)
  ),
  'new waiting entry permitted after previous entry promoted'
);

-- 7. RLS policies behavior
-- Member A reads only own rows (2 rows: 1 promoted, 1 waiting)
set local role authenticated;
select set_config('request.jwt.claim.sub', '55000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::int from public.trip_waitlist_entries),
  2,
  'member A sees only their own waitlist entries'
);
select is(
  (select count(*)::int from public.trip_waitlist_entries where member_id = '65000000-0000-4000-8000-000000000002'),
  0,
  'member A cannot see member B waitlist entries'
);
select throws_ok(
  $$insert into public.trip_waitlist_entries (trip_id, member_id, position) select id, '65000000-0000-4000-8000-000000000001', 4 from public.camping_trips limit 1$$,
  '42501',
  null,
  'authenticated role cannot insert directly through Data API'
);
select throws_ok(
  $$update public.trip_waitlist_entries set status = 'promoted'$$,
  '42501',
  null,
  'authenticated role cannot update directly through Data API'
);
reset role;

-- Member B reads only own rows (1 row: waiting)
set local role authenticated;
select set_config('request.jwt.claim.sub', '55000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::int from public.trip_waitlist_entries),
  1,
  'member B sees only their own waitlist entry'
);
reset role;

-- Suspended member sees no rows
set local role authenticated;
select set_config('request.jwt.claim.sub', '55000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*)::int from public.trip_waitlist_entries),
  0,
  'suspended member sees 0 waitlist entries'
);
reset role;

-- Admin sees all waitlist rows across members (3 total rows)
set local role authenticated;
select set_config('request.jwt.claim.sub', '55000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::int from public.trip_waitlist_entries),
  3,
  'admin sees all waitlist entries across all members'
);
reset role;

-- Anonymous user cannot select from trip_waitlist_entries
set local role anon;
select throws_ok(
  $$select count(*) from public.trip_waitlist_entries$$,
  '42501',
  null,
  'anonymous role is denied select on trip_waitlist_entries'
);
reset role;

select * from finish();
rollback;
