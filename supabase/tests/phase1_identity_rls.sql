begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','phase1-a@example.test','',now(),'{}','{}',now(),now()),
  ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','phase1-b@example.test','',now(),'{}','{}',now(),now());
insert into public.member_profiles(member_id,auth_user_id,display_name,member_role,account_status)
values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Member One','member','active'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Member Two','admin','active');
insert into public.member_payment_methods(id,member_id,method,preferred)
values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','venmo',true),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','paypal',true);
insert into private.member_payment_identifiers(payment_method_id,identifier_ciphertext,nonce,encryption_key_version,fingerprint_hmac)
values
  ('30000000-0000-4000-8000-000000000001',decode(repeat('11',17),'hex'),decode(repeat('22',12),'hex'),'test',decode(repeat('33',32),'hex')),
  ('30000000-0000-4000-8000-000000000002',decode(repeat('44',17),'hex'),decode(repeat('55',12),'hex'),'test',decode(repeat('66',32),'hex'));

select ok((select relrowsecurity from pg_class where oid='public.member_profiles'::regclass), 'member profile RLS enabled');
select ok((select relrowsecurity from pg_class where oid='private.member_payment_identifiers'::regclass), 'payment identifier RLS enabled');
select ok(not has_table_privilege('anon','public.member_profiles','select'), 'anonymous role has no profile table grant');
select ok(not has_schema_privilege('authenticated','private','usage'), 'authenticated role cannot address private schema');
select ok(not has_table_privilege('authenticated','public.audit_events','select'), 'members cannot query audit events directly');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.member_profiles),1,'member reads only own profile');
select is((select count(*)::integer from public.member_payment_methods),1,'member reads only own safe payment method');
select lives_ok($$update public.member_profiles set display_name='Updated Member' where auth_user_id=auth.uid()$$,'member may update own display name');
select throws_ok($$update public.member_profiles set member_role='admin' where auth_user_id=auth.uid()$$,'42501',null,'member cannot update own role directly');
select throws_ok($$insert into public.member_payment_methods(member_id,method,preferred) values('20000000-0000-4000-8000-000000000002','zelle',true)$$,'42501',null,'member cannot create a payment method for another member');
select is((select count(*)::integer from public.member_payment_methods where member_id='20000000-0000-4000-8000-000000000002'),0,'member cannot read another payment method');
select ok(not has_function_privilege(current_user,'public.phase1_update_membership(uuid,uuid,text,text,text,uuid)','execute'),'membership admin RPC is not executable by a member');
select ok(not has_function_privilege(current_user,'public.phase1_complete_invited_profile(uuid,bytea,text,text,text,bytea,bytea,text,bytea,uuid)','execute'),'profile completion RPC is not executable by a member');
select ok(not has_function_privilege(current_user,'public.phase1_begin_idempotency(text,text,uuid,bytea,text,bytea)','execute'),'idempotency claim RPC is not executable by a member');

reset role;
select is(public.phase1_begin_idempotency('test-principal','update_profile','40000000-0000-4000-8000-000000000001',decode(repeat('77',32),'hex'),'v1',decode(repeat('88',32),'hex'))->>'state','started','first idempotency request obtains a claim');
select is(public.phase1_begin_idempotency('test-principal','update_profile','40000000-0000-4000-8000-000000000001',decode(repeat('77',32),'hex'),'v1',decode(repeat('88',32),'hex'))->>'state','in_progress','concurrent retry does not execute twice');
select lives_ok($$select public.phase1_finish_idempotency('test-principal','update_profile','40000000-0000-4000-8000-000000000001',decode(repeat('77',32),'hex'),'v1',decode(repeat('88',32),'hex'),'30000000-0000-4000-8000-000000000001','profile_updated')$$,'completed request stores a replay result');
select is(public.phase1_begin_idempotency('test-principal','update_profile','40000000-0000-4000-8000-000000000001',decode(repeat('77',32),'hex'),'v1',decode(repeat('88',32),'hex'))->>'state','replay','completed request returns stored result');
select throws_ok($$select public.phase1_begin_idempotency('test-principal','update_profile','40000000-0000-4000-8000-000000000001',decode(repeat('77',32),'hex'),'v1',decode(repeat('99',32),'hex'))$$,'22023',null,'reusing a key with changed request conflicts');
select lives_ok($$update private.idempotency_records set replay_expires_at=now()-interval '1 second' where principal_scope='test-principal'$$,'test can expire a replay window');
select throws_ok($$select public.phase1_begin_idempotency('test-principal','update_profile','40000000-0000-4000-8000-000000000001',decode(repeat('77',32),'hex'),'v1',decode(repeat('88',32),'hex'))$$,'22023',null,'expired replay key is rejected and not executed again');
select throws_ok($$select public.phase1_reserve_bootstrap_invitation(decode(repeat('aa',32),'hex'),'50000000-0000-4000-8000-000000000001',now()+interval '7 days')$$,'P0001','an active administrator already exists','bootstrap cannot mint another administrator after first-admin activation');
select * from finish();
rollback;
