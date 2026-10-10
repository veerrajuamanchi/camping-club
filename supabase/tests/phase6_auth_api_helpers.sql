begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Schema and function privilege tests
select ok(not has_function_privilege('anon', 'public.auth_api_check_rate_limit(text)', 'execute'), 'anon cannot execute auth_api_check_rate_limit');
select ok(not has_function_privilege('authenticated', 'public.auth_api_check_rate_limit(text)', 'execute'), 'authenticated cannot execute auth_api_check_rate_limit');
select ok(has_function_privilege('service_role', 'public.auth_api_check_rate_limit(text)', 'execute'), 'service_role can execute auth_api_check_rate_limit');

select ok(not has_function_privilege('anon', 'public.auth_api_is_approved_member(text)', 'execute'), 'anon cannot execute auth_api_is_approved_member');
select ok(not has_function_privilege('authenticated', 'public.auth_api_is_approved_member(text)', 'execute'), 'authenticated cannot execute auth_api_is_approved_member');
select ok(has_function_privilege('service_role', 'public.auth_api_is_approved_member(text)', 'execute'), 'service_role can execute auth_api_is_approved_member');

select ok(not has_function_privilege('anon', 'public.auth_api_has_pending_request(text)', 'execute'), 'anon cannot execute auth_api_has_pending_request');
select ok(not has_function_privilege('authenticated', 'public.auth_api_has_pending_request(text)', 'execute'), 'authenticated cannot execute auth_api_has_pending_request');
select ok(has_function_privilege('service_role', 'public.auth_api_has_pending_request(text)', 'execute'), 'service_role can execute auth_api_has_pending_request');

select ok(not has_function_privilege('anon', 'public.auth_api_create_access_request(text,text,text)', 'execute'), 'anon cannot execute auth_api_create_access_request');
select ok(not has_function_privilege('authenticated', 'public.auth_api_create_access_request(text,text,text)', 'execute'), 'authenticated cannot execute auth_api_create_access_request');
select ok(has_function_privilege('service_role', 'public.auth_api_create_access_request(text,text,text)', 'execute'), 'service_role can execute auth_api_create_access_request');

-- Rate limit checking
select is(public.auth_api_check_rate_limit('rl_test_hmac'), 0, 'rate limit is 0 when no rows exist');

insert into private.access_requests (email_hmac, hmac_key_version, display_name, status, created_at)
values
  ('rl_test_hmac', 'v1', 'RL Recent 1', 'pending', now()),
  ('rl_test_hmac', 'v1', 'RL Old 1', 'rejected', now() - interval '25 hours');

select is(public.auth_api_check_rate_limit('rl_test_hmac'), 1, 'rate limit counts only rows within last 24h');

-- Check approved member status
select is(public.auth_api_is_approved_member('unknown_member_hmac'), false, 'unknown email is not approved member');

-- Approved via string invitation event
insert into private.admin_invitation_events (email_hmac, expires_at)
values ('invited_member_hmac', now() + interval '7 days');
select is(public.auth_api_is_approved_member('invited_member_hmac'), true, 'invited string email in admin_invitation_events is approved');

-- Approved via hex invitation event (\x...)
insert into private.admin_invitation_events (email_hmac, expires_at)
values ('\x0123456789abcdef'::bytea, now() + interval '7 days');
select is(public.auth_api_is_approved_member('\x0123456789abcdef'), true, 'invited hex email in admin_invitation_events is approved');

-- Approved via approved access request
insert into private.access_requests (email_hmac, hmac_key_version, display_name, status)
values ('approved_req_hmac', 'v1', 'Approved User', 'approved');
select is(public.auth_api_is_approved_member('approved_req_hmac'), true, 'email with approved access_request is approved');

-- Check pending request status
select is(public.auth_api_has_pending_request('approved_req_hmac'), false, 'approved request is not pending');
insert into private.access_requests (email_hmac, hmac_key_version, display_name, status)
values ('pending_req_hmac', 'v1', 'Pending User', 'pending');
select is(public.auth_api_has_pending_request('pending_req_hmac'), true, 'pending request returns true');

-- Test creating access request
select lives_ok(
  $$select public.auth_api_create_access_request('new_user_hmac', 'v1', 'New User')$$,
  'create access request succeeds for new email'
);

select is(public.auth_api_has_pending_request('new_user_hmac'), true, 'new access request is now pending');

-- Test creating duplicate access request
select throws_ok(
  $$select public.auth_api_create_access_request('new_user_hmac', 'v1', 'New User Again')$$,
  'P0001',
  'duplicate_access_request',
  'creating duplicate access request throws duplicate_access_request'
);

select * from finish();
rollback;
