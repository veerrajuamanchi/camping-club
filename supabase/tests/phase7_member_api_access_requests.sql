begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- Fixture: users and member profiles
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase7-admin@example.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase7-member@example.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'phase7-inactive-admin@example.test', '', now(), '{}', '{}', now(), now());

insert into public.member_profiles(member_id, auth_user_id, display_name, member_role, account_status)
values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Phase 7 Admin', 'admin', 'active'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', 'Phase 7 Member', 'member', 'active'),
  ('72000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', 'Phase 7 Inactive Admin', 'admin', 'suspended');

-- Schema and function privilege tests
select ok(not has_function_privilege('anon', 'public.member_api_list_pending_requests()', 'execute'), 'anon cannot execute member_api_list_pending_requests');
select ok(not has_function_privilege('authenticated', 'public.member_api_list_pending_requests()', 'execute'), 'authenticated cannot execute member_api_list_pending_requests');
select ok(has_function_privilege('service_role', 'public.member_api_list_pending_requests()', 'execute'), 'service_role can execute member_api_list_pending_requests');

select ok(not has_function_privilege('anon', 'public.member_api_resolve_access_request(uuid,uuid,text,text)', 'execute'), 'anon cannot execute member_api_resolve_access_request');
select ok(not has_function_privilege('authenticated', 'public.member_api_resolve_access_request(uuid,uuid,text,text)', 'execute'), 'authenticated cannot execute member_api_resolve_access_request');
select ok(has_function_privilege('service_role', 'public.member_api_resolve_access_request(uuid,uuid,text,text)', 'execute'), 'service_role can execute member_api_resolve_access_request');

-- Fixture: access requests
insert into private.access_requests (id, email_hmac, hmac_key_version, display_name, status, created_at)
values
  ('73000000-0000-4000-8000-000000000001', 'p7_req_1', 'v1', 'Pending One', 'pending', now() - interval '2 hours'),
  ('73000000-0000-4000-8000-000000000002', 'p7_req_2', 'v1', 'Pending Two', 'pending', now() - interval '1 hour'),
  ('73000000-0000-4000-8000-000000000003', 'p7_req_3', 'v1', 'Already Approved', 'approved', now() - interval '3 hours');

-- Test member_api_list_pending_requests
select is(
  (select count(*)::int from public.member_api_list_pending_requests()),
  2,
  'member_api_list_pending_requests returns 2 pending requests'
);

select results_eq(
  $$select id, display_name from public.member_api_list_pending_requests()$$,
  $$values ('73000000-0000-4000-8000-000000000001'::uuid, 'Pending One'), ('73000000-0000-4000-8000-000000000002'::uuid, 'Pending Two')$$,
  'member_api_list_pending_requests returns expected rows in created_at ASC order'
);

-- Test member_api_resolve_access_request validation and error paths
select throws_ok(
  $$select public.member_api_resolve_access_request('73000000-0000-4000-8000-000000000001'::uuid, '72000000-0000-4000-8000-000000000001'::uuid, 'invalid_status', 'note')$$,
  '22023',
  'invalid_resolution_status',
  'member_api_resolve_access_request rejects invalid status'
);

select throws_ok(
  $$select public.member_api_resolve_access_request('73000000-0000-4000-8000-000000000001'::uuid, '72000000-0000-4000-8000-000000000002'::uuid, 'approved', 'note')$$,
  '42501',
  'administrator_required',
  'member_api_resolve_access_request rejects non-admin actor'
);

select throws_ok(
  $$select public.member_api_resolve_access_request('73000000-0000-4000-8000-000000000001'::uuid, '72000000-0000-4000-8000-000000000003'::uuid, 'approved', 'note')$$,
  '42501',
  'administrator_required',
  'member_api_resolve_access_request rejects inactive admin actor'
);

select throws_ok(
  $$select public.member_api_resolve_access_request('79000000-0000-4000-8000-000000000099'::uuid, '72000000-0000-4000-8000-000000000001'::uuid, 'approved', 'note')$$,
  'P0001',
  'request_not_found',
  'member_api_resolve_access_request rejects non-existent request'
);

select throws_ok(
  $$select public.member_api_resolve_access_request('73000000-0000-4000-8000-000000000003'::uuid, '72000000-0000-4000-8000-000000000001'::uuid, 'approved', 'note')$$,
  'P0001',
  'request_already_resolved',
  'member_api_resolve_access_request rejects already resolved request'
);

-- Test member_api_resolve_access_request approval
select lives_ok(
  $$select public.member_api_resolve_access_request('73000000-0000-4000-8000-000000000001'::uuid, '72000000-0000-4000-8000-000000000001'::uuid, 'approved', 'Welcome to club')$$,
  'member_api_resolve_access_request successfully approves pending request'
);

select is(
  (select status from private.access_requests where id = '73000000-0000-4000-8000-000000000001'::uuid),
  'approved',
  'request status updated to approved'
);

select is(
  (select resolved_by from private.access_requests where id = '73000000-0000-4000-8000-000000000001'::uuid),
  '72000000-0000-4000-8000-000000000001'::uuid,
  'resolved_by matches admin actor'
);

select is(
  (select admin_note from private.access_requests where id = '73000000-0000-4000-8000-000000000001'::uuid),
  'Welcome to club',
  'admin_note saved correctly'
);

-- Test member_api_resolve_access_request rejection
select lives_ok(
  $$select public.member_api_resolve_access_request('73000000-0000-4000-8000-000000000002'::uuid, '72000000-0000-4000-8000-000000000001'::uuid, 'rejected', null)$$,
  'member_api_resolve_access_request successfully rejects pending request with null note'
);

select is(
  (select status from private.access_requests where id = '73000000-0000-4000-8000-000000000002'::uuid),
  'rejected',
  'request status updated to rejected'
);

select is(
  (select count(*)::int from public.member_api_list_pending_requests()),
  0,
  'no pending requests remain in member_api_list_pending_requests'
);

select * from finish();
rollback;
