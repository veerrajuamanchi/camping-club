begin;
create extension if not exists pgtap with schema extensions;
select plan(119);

-- 1. Table existence (6 tables)
select has_table('public', 'master_activities', 'master_activities table exists');
select has_table('public', 'trip_activities', 'trip_activities table exists');
select has_table('public', 'trip_activity_participants', 'trip_activity_participants table exists');
select has_table('public', 'trip_activity_groups', 'trip_activity_groups table exists');
select has_table('public', 'trip_activity_group_members', 'trip_activity_group_members table exists');
select has_table('public', 'trip_activity_swap_requests', 'trip_activity_swap_requests table exists');

-- 2. Column existence: master_activities (13 columns)
select has_column('public', 'master_activities', 'id', 'master_activities has id');
select has_column('public', 'master_activities', 'title', 'master_activities has title');
select has_column('public', 'master_activities', 'category', 'master_activities has category');
select has_column('public', 'master_activities', 'image_url', 'master_activities has image_url');
select has_column('public', 'master_activities', 'location_name', 'master_activities has location_name');
select has_column('public', 'master_activities', 'address', 'master_activities has address');
select has_column('public', 'master_activities', 'directions_url', 'master_activities has directions_url');
select has_column('public', 'master_activities', 'unit_label', 'master_activities has unit_label');
select has_column('public', 'master_activities', 'unit_capacity', 'master_activities has unit_capacity');
select has_column('public', 'master_activities', 'booking_notes', 'master_activities has booking_notes');
select has_column('public', 'master_activities', 'is_active', 'master_activities has is_active');
select has_column('public', 'master_activities', 'created_at', 'master_activities has created_at');
select has_column('public', 'master_activities', 'updated_at', 'master_activities has updated_at');

-- 3. Column existence: trip_activities (17 columns)
select has_column('public', 'trip_activities', 'id', 'trip_activities has id');
select has_column('public', 'trip_activities', 'trip_id', 'trip_activities has trip_id');
select has_column('public', 'trip_activities', 'master_activity_id', 'trip_activities has master_activity_id');
select has_column('public', 'trip_activities', 'title', 'trip_activities has title');
select has_column('public', 'trip_activities', 'category', 'trip_activities has category');
select has_column('public', 'trip_activities', 'image_url', 'trip_activities has image_url');
select has_column('public', 'trip_activities', 'activity_date', 'trip_activities has activity_date');
select has_column('public', 'trip_activities', 'start_time', 'trip_activities has start_time');
select has_column('public', 'trip_activities', 'end_time', 'trip_activities has end_time');
select has_column('public', 'trip_activities', 'location_name', 'trip_activities has location_name');
select has_column('public', 'trip_activities', 'address', 'trip_activities has address');
select has_column('public', 'trip_activities', 'directions_url', 'trip_activities has directions_url');
select has_column('public', 'trip_activities', 'unit_label', 'trip_activities has unit_label');
select has_column('public', 'trip_activities', 'unit_capacity', 'trip_activities has unit_capacity');
select has_column('public', 'trip_activities', 'booking_notes', 'trip_activities has booking_notes');
select has_column('public', 'trip_activities', 'opt_out_policy', 'trip_activities has opt_out_policy');
select has_column('public', 'trip_activities', 'is_pairings_locked', 'trip_activities has is_pairings_locked');

-- 4. Column existence: trip_activity_participants (7 columns)
select has_column('public', 'trip_activity_participants', 'id', 'trip_activity_participants has id');
select has_column('public', 'trip_activity_participants', 'activity_id', 'trip_activity_participants has activity_id');
select has_column('public', 'trip_activity_participants', 'member_id', 'trip_activity_participants has member_id');
select has_column('public', 'trip_activity_participants', 'status', 'trip_activity_participants has status');
select has_column('public', 'trip_activity_participants', 'notes', 'trip_activity_participants has notes');
select has_column('public', 'trip_activity_participants', 'created_at', 'trip_activity_participants has created_at');
select has_column('public', 'trip_activity_participants', 'updated_at', 'trip_activity_participants has updated_at');

-- 5. Column existence: trip_activity_groups (13 columns)
select has_column('public', 'trip_activity_groups', 'id', 'trip_activity_groups has id');
select has_column('public', 'trip_activity_groups', 'activity_id', 'trip_activity_groups has activity_id');
select has_column('public', 'trip_activity_groups', 'group_number', 'trip_activity_groups has group_number');
select has_column('public', 'trip_activity_groups', 'group_name', 'trip_activity_groups has group_name');
select has_column('public', 'trip_activity_groups', 'purchaser_member_id', 'trip_activity_groups has purchaser_member_id');
select has_column('public', 'trip_activity_groups', 'purchase_date', 'trip_activity_groups has purchase_date');
select has_column('public', 'trip_activity_groups', 'amount_cents', 'trip_activity_groups has amount_cents');
select has_column('public', 'trip_activity_groups', 'expense_id', 'trip_activity_groups has expense_id');
select has_column('public', 'trip_activity_groups', 'order_reference_number', 'trip_activity_groups has order_reference_number');
select has_column('public', 'trip_activity_groups', 'voucher_code', 'trip_activity_groups has voucher_code');
select has_column('public', 'trip_activity_groups', 'security_pin', 'trip_activity_groups has security_pin');
select has_column('public', 'trip_activity_groups', 'voucher_status', 'trip_activity_groups has voucher_status');
select has_column('public', 'trip_activity_groups', 'created_at', 'trip_activity_groups has created_at');

-- 6. Column existence: trip_activity_group_members (4 columns)
select has_column('public', 'trip_activity_group_members', 'id', 'trip_activity_group_members has id');
select has_column('public', 'trip_activity_group_members', 'group_id', 'trip_activity_group_members has group_id');
select has_column('public', 'trip_activity_group_members', 'member_id', 'trip_activity_group_members has member_id');
select has_column('public', 'trip_activity_group_members', 'created_at', 'trip_activity_group_members has created_at');

-- 7. Column existence: trip_activity_swap_requests (7 columns)
select has_column('public', 'trip_activity_swap_requests', 'id', 'trip_activity_swap_requests has id');
select has_column('public', 'trip_activity_swap_requests', 'activity_id', 'trip_activity_swap_requests has activity_id');
select has_column('public', 'trip_activity_swap_requests', 'requester_member_id', 'trip_activity_swap_requests has requester_member_id');
select has_column('public', 'trip_activity_swap_requests', 'target_member_id', 'trip_activity_swap_requests has target_member_id');
select has_column('public', 'trip_activity_swap_requests', 'status', 'trip_activity_swap_requests has status');
select has_column('public', 'trip_activity_swap_requests', 'created_at', 'trip_activity_swap_requests has created_at');
select has_column('public', 'trip_activity_swap_requests', 'resolved_at', 'trip_activity_swap_requests has resolved_at');

-- 8. Foreign keys (12 checks)
select fk_ok('public', 'trip_activities', 'trip_id', 'public', 'camping_trips', 'id');
select fk_ok('public', 'trip_activities', 'master_activity_id', 'public', 'master_activities', 'id');
select fk_ok('public', 'trip_activity_participants', 'activity_id', 'public', 'trip_activities', 'id');
select fk_ok('public', 'trip_activity_participants', 'member_id', 'public', 'member_profiles', 'member_id');
select fk_ok('public', 'trip_activity_groups', 'activity_id', 'public', 'trip_activities', 'id');
select fk_ok('public', 'trip_activity_groups', 'purchaser_member_id', 'public', 'member_profiles', 'member_id');
select fk_ok('public', 'trip_activity_groups', 'expense_id', 'public', 'trip_expenses', 'id');
select fk_ok('public', 'trip_activity_group_members', 'group_id', 'public', 'trip_activity_groups', 'id');
select fk_ok('public', 'trip_activity_group_members', 'member_id', 'public', 'member_profiles', 'member_id');
select fk_ok('public', 'trip_activity_swap_requests', 'activity_id', 'public', 'trip_activities', 'id');
select fk_ok('public', 'trip_activity_swap_requests', 'requester_member_id', 'public', 'member_profiles', 'member_id');
select fk_ok('public', 'trip_activity_swap_requests', 'target_member_id', 'public', 'member_profiles', 'member_id');

-- 9. Unique / Check constraints (7 checks)
select col_is_unique('public', 'trip_activity_participants', ARRAY['activity_id', 'member_id']::name[], 'trip_activity_participants unique activity_id and member_id');
select col_is_unique('public', 'trip_activity_groups', ARRAY['activity_id', 'group_number']::name[], 'trip_activity_groups unique activity_id and group_number');
select col_is_unique('public', 'trip_activity_group_members', ARRAY['group_id', 'member_id']::name[], 'trip_activity_group_members unique group_id and member_id');

select col_has_check('public', 'trip_activities', 'opt_out_policy', 'trip_activities has check on opt_out_policy');
select col_has_check('public', 'trip_activity_participants', 'status', 'trip_activity_participants has check on status');
select col_has_check('public', 'trip_activity_groups', 'voucher_status', 'trip_activity_groups has check on voucher_status');
select col_has_check('public', 'trip_activity_swap_requests', 'status', 'trip_activity_swap_requests has check on status');

-- 10. RLS enabled (6 checks)
select ok((select relrowsecurity from pg_class where oid='public.master_activities'::regclass), 'master_activities RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.trip_activities'::regclass), 'trip_activities RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.trip_activity_participants'::regclass), 'trip_activity_participants RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.trip_activity_groups'::regclass), 'trip_activity_groups RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.trip_activity_group_members'::regclass), 'trip_activity_group_members RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.trip_activity_swap_requests'::regclass), 'trip_activity_swap_requests RLS enabled');

-- 11. Anonymous role denied access (6 checks)
select ok(not has_table_privilege('anon', 'public.master_activities', 'select'), 'anon has no select on master_activities');
select ok(not has_table_privilege('anon', 'public.trip_activities', 'select'), 'anon has no select on trip_activities');
select ok(not has_table_privilege('anon', 'public.trip_activity_participants', 'select'), 'anon has no select on trip_activity_participants');
select ok(not has_table_privilege('anon', 'public.trip_activity_groups', 'select'), 'anon has no select on trip_activity_groups');
select ok(not has_table_privilege('anon', 'public.trip_activity_group_members', 'select'), 'anon has no select on trip_activity_group_members');
select ok(not has_table_privilege('anon', 'public.trip_activity_swap_requests', 'select'), 'anon has no select on trip_activity_swap_requests');

-- 12. Defense-in-depth: Sensitive columns masked and direct writes prevented (7 checks)
select ok(not has_column_privilege('authenticated', 'public.trip_activity_groups', 'voucher_code', 'select'), 'authenticated denied select on voucher_code');
select ok(not has_column_privilege('authenticated', 'public.trip_activity_groups', 'security_pin', 'select'), 'authenticated denied select on security_pin');
select ok(has_column_privilege('authenticated', 'public.trip_activity_groups', 'group_name', 'select'), 'authenticated allowed select on group_name');
select ok(not has_table_privilege('authenticated', 'public.master_activities', 'insert'), 'authenticated denied insert on master_activities');
select ok(not has_table_privilege('authenticated', 'public.trip_activities', 'insert'), 'authenticated denied insert on trip_activities');
select ok(not has_table_privilege('authenticated', 'public.trip_activity_groups', 'update'), 'authenticated denied update on trip_activity_groups');
select ok(not has_table_privilege('authenticated', 'public.trip_activity_group_members', 'insert'), 'authenticated denied insert on trip_activity_group_members');

-- 13. Authenticated test fixtures
insert into auth.users(id, email)
values
  ('93000000-0000-0000-0000-000000000001', 'admin-p19@test.com'),
  ('93000000-0000-0000-0000-000000000002', 'active-p19@test.com'),
  ('93000000-0000-0000-0000-000000000003', 'inactive-p19@test.com');

insert into public.member_profiles(member_id, auth_user_id, display_name, member_role, account_status)
values
  ('94000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', 'Admin Member', 'admin', 'active'),
  ('94000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000002', 'Active Member', 'member', 'active'),
  ('94000000-0000-0000-0000-000000000003', '93000000-0000-0000-0000-000000000003', 'Inactive Member', 'member', 'inactive');

insert into public.campsites(id, rotation_position, name, location_description, cabin_capacity, active)
values ('91000000-0000-0000-0000-000000000001', 99, 'Test Campsite', 'Test Location', 10, true);

insert into public.camping_trips(id, month_key, rotation_position, suggested_campsite_id, selected_campsite_id, starts_on, ends_on, poll_status, event_status, version)
values ('92000000-0000-0000-0000-000000000001', '2039-01-01'::date, 1, '91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', current_date + 10, current_date + 13, 'closed', 'confirmed', 1);

insert into public.master_activities(id, title, category, is_active)
values ('95000000-0000-0000-0000-000000000001', 'Monterey GoCar Tour', 'Sightseeing', true);

insert into public.trip_activities(id, trip_id, master_activity_id, title, activity_date)
values ('96000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000001', 'Saturday Monterey GoCar', current_date + 11);

insert into public.trip_activity_groups(id, activity_id, group_number, group_name, voucher_code, security_pin)
values ('97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', 1, 'Car #1', 'TOP-SECRET-CODE', '1234');

-- 14. Authenticated active member verification (9 checks)
set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000002', true);

select is((select count(*)::integer from public.master_activities), 1, 'active member reads master_activities');
select is((select count(*)::integer from public.trip_activities), 1, 'active member reads trip_activities');
select is((select count(*)::integer from public.trip_activity_groups), 1, 'active member reads trip_activity_groups');

select throws_ok(
  $$ select voucher_code from public.trip_activity_groups $$,
  '42501',
  null,
  'active member cannot select sensitive voucher_code column'
);

select throws_ok(
  $$ select security_pin from public.trip_activity_groups $$,
  '42501',
  null,
  'active member cannot select sensitive security_pin column'
);

select lives_ok(
  $$ insert into public.trip_activity_participants(activity_id, member_id, status)
     values ('96000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000002', 'attending') $$,
  'active member can insert own participation'
);

select throws_ok(
  $$ insert into public.trip_activity_participants(activity_id, member_id, status)
     values ('96000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', 'attending') $$,
  '42501',
  null,
  'active member cannot insert participation for other members'
);

select throws_ok(
  $$ update public.trip_activity_groups set group_name = 'Hacked' where id = '97000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'active member cannot directly update trip_activity_groups'
);

select throws_ok(
  $$ insert into public.master_activities(title) values ('Unauthorized') $$,
  '42501',
  null,
  'active member cannot directly insert into master_activities'
);

-- 15. Inactive member verification (3 checks)
select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000003', true);

select is((select count(*)::integer from public.master_activities), 0, 'inactive member cannot read master_activities');
select is((select count(*)::integer from public.trip_activities), 0, 'inactive member cannot read trip_activities');
select is((select count(*)::integer from public.trip_activity_groups), 0, 'inactive member cannot read trip_activity_groups');

-- 16. Anonymous role verification (2 checks)
set local role anon;

select throws_ok(
  $$ select count(*) from public.master_activities $$,
  '42501',
  null,
  'anon role cannot select master_activities'
);

select throws_ok(
  $$ select count(*) from public.trip_activities $$,
  '42501',
  null,
  'anon role cannot select trip_activities'
);

reset role;

select * from finish();
rollback;
