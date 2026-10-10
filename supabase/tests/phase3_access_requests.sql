begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Fixture: users and member profiles
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('31000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase3-admin@example.test', '', now(), '{}', '{}', now(), now()),
  ('31000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase3-member@example.test', '', now(), '{}', '{}', now(), now()),
  ('31000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'phase3-inactive-admin@example.test', '', now(), '{}', '{}', now(), now());

insert into public.member_profiles(member_id, auth_user_id, display_name, member_role, account_status)
values
  ('41000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'Phase 3 Admin', 'admin', 'active'),
  ('41000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000002', 'Phase 3 Member', 'member', 'active'),
  ('41000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000003', 'Phase 3 Inactive Admin', 'admin', 'suspended');

-- Schema and function privilege tests
select ok(not has_table_privilege('anon', 'private.access_requests', 'select'), 'anon has no select on private.access_requests');
select ok(not has_table_privilege('authenticated', 'private.access_requests', 'select'), 'authenticated has no select on private.access_requests');
select ok(not has_function_privilege('anon', 'public.get_admin_access_request_count()', 'execute'), 'anon cannot execute get_admin_access_request_count');
select ok(has_function_privilege('authenticated', 'public.get_admin_access_request_count()', 'execute'), 'authenticated can execute get_admin_access_request_count');

-- get_admin_access_request_count behavior for non-admin
set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.get_admin_access_request_count()$$,
  '42501',
  'administrator_required',
  'non-admin authenticated user is rejected from get_admin_access_request_count'
);

-- get_admin_access_request_count behavior for active admin
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select is(public.get_admin_access_request_count(), 0, 'admin sees 0 pending access requests initially');
reset role;

-- create_access_request works
select lives_ok(
  $$select private.create_access_request('email_hmac_1', 'v1', 'Alice Request')$$,
  'create_access_request successfully inserts a request'
);

-- Admin count and internal views reflect pending request
set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select is(public.get_admin_access_request_count(), 1, 'admin sees 1 pending access request after insertion');
reset role;

select is((select pending_count from private.admin_access_request_count_v), 1, 'private.admin_access_request_count_v reflects pending count');
select is((select count(*)::int from private.pending_access_requests_v), 1, 'private.pending_access_requests_v includes pending request');

-- Duplicate pending request raises P0001 (duplicate_access_request)
select throws_ok(
  $$select private.create_access_request('email_hmac_1', 'v1', 'Alice Request Again')$$,
  'P0001',
  'duplicate_access_request',
  'duplicate pending request raises P0001 duplicate_access_request'
);

-- resolve_access_request with invalid status raises 22023 (invalid_resolution_status)
select throws_ok(
  format(
    $$select private.resolve_access_request('%s'::uuid, '41000000-0000-4000-8000-000000000001'::uuid, 'invalid_status', 'test note')$$,
    (select id from private.access_requests where email_hmac = 'email_hmac_1')
  ),
  '22023',
  'invalid_resolution_status',
  'resolve_access_request with invalid status raises 22023 invalid_resolution_status'
);

-- resolve_access_request non-admin actor raises 42501 (administrator_required)
select throws_ok(
  format(
    $$select private.resolve_access_request('%s'::uuid, '41000000-0000-4000-8000-000000000002'::uuid, 'approved', 'test note')$$,
    (select id from private.access_requests where email_hmac = 'email_hmac_1')
  ),
  '42501',
  'administrator_required',
  'resolve_access_request non-admin actor raises 42501 administrator_required'
);

-- resolve_access_request inactive admin actor raises 42501 (administrator_required)
select throws_ok(
  format(
    $$select private.resolve_access_request('%s'::uuid, '41000000-0000-4000-8000-000000000003'::uuid, 'approved', 'test note')$$,
    (select id from private.access_requests where email_hmac = 'email_hmac_1')
  ),
  '42501',
  'administrator_required',
  'resolve_access_request inactive admin actor raises 42501 administrator_required'
);

-- resolve_access_request non-existent request raises P0001 (request_not_found)
select throws_ok(
  $$select private.resolve_access_request('99000000-0000-4000-8000-000000000099'::uuid, '41000000-0000-4000-8000-000000000001'::uuid, 'approved', 'test note')$$,
  'P0001',
  'request_not_found',
  'resolve_access_request non-existent request raises P0001 request_not_found'
);

-- resolve_access_request works with admin actor
select lives_ok(
  format(
    $$select private.resolve_access_request('%s'::uuid, '41000000-0000-4000-8000-000000000001'::uuid, 'approved', 'Welcome')$$,
    (select id from private.access_requests where email_hmac = 'email_hmac_1')
  ),
  'admin resolves access request to approved'
);

select is((select status from private.access_requests where email_hmac = 'email_hmac_1'), 'approved', 'request status updated to approved');
select is((select resolved_by from private.access_requests where email_hmac = 'email_hmac_1'), '41000000-0000-4000-8000-000000000001'::uuid, 'resolved_by matches admin member id');

-- resolve_access_request already resolved raises P0001 (request_already_resolved)
select throws_ok(
  format(
    $$select private.resolve_access_request('%s'::uuid, '41000000-0000-4000-8000-000000000001'::uuid, 'approved', 'Again')$$,
    (select id from private.access_requests where email_hmac = 'email_hmac_1')
  ),
  'P0001',
  'request_already_resolved',
  'resolving already resolved request raises P0001 request_already_resolved'
);

-- Admin count is 0 after resolution
set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select is(public.get_admin_access_request_count(), 0, 'admin sees 0 pending access requests after resolution');
reset role;

-- Duplicate approved request raises P0001 (duplicate_access_request)
select throws_ok(
  $$select private.create_access_request('email_hmac_1', 'v1', 'Alice Request Trying Again')$$,
  'P0001',
  'duplicate_access_request',
  'creating access request when approved request exists raises P0001 duplicate_access_request'
);

-- Rejected request resolution and subsequent re-apply works
select lives_ok(
  $$select private.create_access_request('email_hmac_2', 'v1', 'Bob Request')$$,
  'create second request for Bob'
);

select lives_ok(
  format(
    $$select private.resolve_access_request('%s'::uuid, '41000000-0000-4000-8000-000000000001'::uuid, 'rejected', 'Sorry')$$,
    (select id from private.access_requests where email_hmac = 'email_hmac_2')
  ),
  'admin rejects Bob access request'
);

select lives_ok(
  $$select private.create_access_request('email_hmac_2', 'v1', 'Bob Request Re-apply')$$,
  're-applying after rejection creates new pending request'
);

select * from finish();
rollback;
