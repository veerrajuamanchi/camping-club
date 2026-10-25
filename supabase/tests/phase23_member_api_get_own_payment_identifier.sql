begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Setup test user
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('10000000-0000-4000-8000-000000000099','authenticated','authenticated','phase23-user@example.test','',now(),'{}','{}',now(),now());
insert into public.member_profiles(member_id,auth_user_id,display_name,member_role,account_status)
values
  ('20000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000099','Payment Tester','member','active');
insert into public.member_payment_methods(id,member_id,method,preferred)
values
  ('30000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000099','venmo',true);
insert into private.member_payment_identifiers(payment_method_id,identifier_ciphertext,nonce,encryption_key_version,fingerprint_hmac)
values
  ('30000000-0000-4000-8000-000000000099',decode(repeat('aa',17),'hex'),decode(repeat('bb',12),'hex'),'v1',decode(repeat('cc',32),'hex'));

-- 1. Function exists
select has_function('public', 'member_api_get_own_payment_identifier', ARRAY['uuid'], 'member_api_get_own_payment_identifier function exists');

-- 2. Privileges check
select ok(not has_function_privilege('anon','public.member_api_get_own_payment_identifier(uuid)','execute'), 'anon cannot execute RPC');
select ok(not has_function_privilege('authenticated','public.member_api_get_own_payment_identifier(uuid)','execute'), 'authenticated cannot execute RPC');
select ok(has_function_privilege('service_role','public.member_api_get_own_payment_identifier(uuid)','execute'), 'service_role can execute RPC');

-- 3. Execution by service_role returns the active user encrypted identifier
set local role service_role;
select results_eq(
  'select identifier_ciphertext_hex, nonce_hex, key_version from public.member_api_get_own_payment_identifier(''10000000-0000-4000-8000-000000000099''::uuid)',
  $$values (repeat('aa',17), repeat('bb',12), 'v1')$$,
  'service_role successfully loads member own payment identifier'
);

-- 4. Unknown user returns empty result
select is_empty(
  'select * from public.member_api_get_own_payment_identifier(''00000000-0000-0000-0000-000000000000''::uuid)',
  'unknown auth_user_id returns empty result'
);

select * from finish();
rollback;
