\set ON_ERROR_STOP 1
begin;
create extension if not exists pgtap;
select plan(27);
-- Setup test users
insert into auth.users (id, email) values
  ('aaaa0001-0001-4001-8001-000000000001', 'admin_duty@example.com'),
  ('aaaa0002-0002-4002-8002-000000000002', 'member_duty1@example.com'),
  ('aaaa0003-0003-4003-8003-000000000003', 'member_duty2@example.com'),
  ('aaaa0004-0004-4004-8004-000000000004', 'not_coming_member@example.com');

insert into public.member_profiles (member_id, auth_user_id, member_role, account_status, display_name) values
  ('aaaa0001-0001-4001-8001-000000000001', 'aaaa0001-0001-4001-8001-000000000001', 'admin', 'active', 'Admin Duty'),
  ('aaaa0002-0002-4002-8002-000000000002', 'aaaa0002-0002-4002-8002-000000000002', 'member', 'active', 'Member One'),
  ('aaaa0003-0003-4003-8003-000000000003', 'aaaa0003-0003-4003-8003-000000000003', 'member', 'active', 'Member Two'),
  ('aaaa0004-0004-4004-8004-000000000004', 'aaaa0004-0004-4004-8004-000000000004', 'member', 'active', 'Member Not Coming');

-- Setup campsite and trip
insert into public.campsites (id, name, location_description, cabin_capacity, rotation_position)
values ('cccc0001-0001-4001-8001-000000000001', 'Camp Duty Test', 'Forest Trail', 12, 99);

insert into public.camping_trips (
  id, month_key, rotation_position, suggested_campsite_id, selected_campsite_id, starts_on, ends_on, poll_status, task_quota_target
) values (
  'eeee0001-0001-4001-8001-000000000001',
  '2029-10-01',
  1,
  'cccc0001-0001-4001-8001-000000000001',
  'cccc0001-0001-4001-8001-000000000001',
  '2029-10-23',
  '2029-10-25',
  'closed',
  2
);

-- Build rule bundle and add acknowledgments for confirmed attendees
select private.phase2_build_rule_bundle('eeee0001-0001-4001-8001-000000000001', 'aaaa0001-0001-4001-8001-000000000001'::uuid);

insert into public.trip_rule_acknowledgments(trip_id, member_id, bundle_id, content_hash, statement_version, request_id)
values
  ('eeee0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002',
   (select id from public.trip_rule_bundles where trip_id = 'eeee0001-0001-4001-8001-000000000001' and is_current),
   (select content_hash from public.trip_rule_bundles where trip_id = 'eeee0001-0001-4001-8001-000000000001' and is_current),
   'coming-v1', gen_random_uuid()),
  ('eeee0001-0001-4001-8001-000000000001', 'aaaa0003-0003-4003-8003-000000000003',
   (select id from public.trip_rule_bundles where trip_id = 'eeee0001-0001-4001-8001-000000000001' and is_current),
   (select content_hash from public.trip_rule_bundles where trip_id = 'eeee0001-0001-4001-8001-000000000001' and is_current),
   'coming-v1', gen_random_uuid());

-- RSVPs: Member 1 & 2 are Coming, Member 4 is Not Coming
insert into public.trip_rsvps (trip_id, member_id, response, rule_acknowledgment_id) values
  ('eeee0001-0001-4001-8001-000000000001', 'aaaa0002-0002-4002-8002-000000000002', 'coming',
   (select id from public.trip_rule_acknowledgments where trip_id = 'eeee0001-0001-4001-8001-000000000001' and member_id = 'aaaa0002-0002-4002-8002-000000000002')),
  ('eeee0001-0001-4001-8001-000000000001', 'aaaa0003-0003-4003-8003-000000000003', 'coming',
   (select id from public.trip_rule_acknowledgments where trip_id = 'eeee0001-0001-4001-8001-000000000001' and member_id = 'aaaa0003-0003-4003-8003-000000000003')),
  ('eeee0001-0001-4001-8001-000000000001', 'aaaa0004-0004-4004-8004-000000000004', 'not_coming', null);

-- Setup master responsibilities & time slot with 2 duties
insert into public.master_responsibilities (id, title, category, default_capacity, workload_weight, active) values
  ('11110001-0001-4001-8001-000000000001', 'Head Cook', 'cooking', 1, 2.0, true),
  ('11110002-0002-4002-8002-000000000002', 'Assistant Cook', 'cooking', 2, 1.0, true);

insert into public.trip_time_slots (id, trip_id, slot_date, time_block, slot_type, label) values
  ('22220001-0001-4001-8001-000000000001', 'eeee0001-0001-4001-8001-000000000001', '2029-10-23', 'friday_dinner', 'meal', 'Friday Feast');

-- Head Cook duty has capacity = 1
insert into public.trip_slot_duties (id, time_slot_id, master_responsibility_id, capacity, workload_weight) values
  ('dddd0001-0001-4001-8001-000000000001', '22220001-0001-4001-8001-000000000001', '11110001-0001-4001-8001-000000000001', 1, 2.0),
  ('dddd0002-0002-4002-8002-000000000002', '22220001-0001-4001-8001-000000000001', '11110002-0002-4002-8002-000000000002', 2, 1.0);



create temporary table daily_plan_fixture(days jsonb);
insert into daily_plan_fixture values ('[
 {"date":"2029-10-23","responsibilityIds":["11110001-0001-4001-8001-000000000001"]},
 {"date":"2029-10-24","responsibilityIds":["11110002-0002-4002-8002-000000000002"]},
 {"date":"2029-10-25","responsibilityIds":["11110001-0001-4001-8001-000000000001","11110002-0002-4002-8002-000000000002"]}
]');
select has_function('public','phase3_save_daily_responsibilities',array['uuid','uuid','jsonb','integer','boolean','uuid'],'daily plan save exists');
select throws_ok($$select public.phase3_save_daily_responsibilities('aaaa0002-0002-4002-8002-000000000002','eeee0001-0001-4001-8001-000000000001',(select days from daily_plan_fixture),1,false,gen_random_uuid())$$,'42501',null,'member cannot configure daily plan');
select throws_ok($$select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001','[]',1,false,gen_random_uuid())$$,'22023',null,'empty plan rejected');
select throws_ok($$select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',(select days - 1 from daily_plan_fixture),1,false,gen_random_uuid())$$,'22023',null,'missing event date rejected');
select throws_ok($$select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',(select jsonb_set(days,'{1,date}','"2029-10-23"') from daily_plan_fixture),1,false,gen_random_uuid())$$,'22023',null,'duplicate date rejected');
select throws_ok($$select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',(select jsonb_set(days,'{1,date}','"2029-10-28"') from daily_plan_fixture),1,false,gen_random_uuid())$$,'22023',null,'out of range date rejected');
select throws_ok($$select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',(select jsonb_set(days,'{1,responsibilityIds}','[]') from daily_plan_fixture),1,false,gen_random_uuid())$$,'22023',null,'empty day rejected');
select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',(select days from daily_plan_fixture),1,false,gen_random_uuid());
select is((select count(*)::int from public.trip_slot_duties d join public.trip_time_slots s on s.id=d.time_slot_id where s.trip_id='eeee0001-0001-4001-8001-000000000001' and s.is_enabled and d.is_active),4,'exactly the selected duties enabled across three actual dates');
select is((select count(distinct s.slot_date)::int from public.trip_time_slots s join public.trip_slot_duties d on d.time_slot_id=s.id and d.is_active where s.trip_id='eeee0001-0001-4001-8001-000000000001' and s.is_enabled),3,'Tuesday to Thursday dates supported');
select ok((select is_active from public.trip_slot_duties where id='dddd0001-0001-4001-8001-000000000001'),'existing chosen duty identity preserved');
select is((select workload_weight::text from public.trip_slot_duties d join public.trip_time_slots s on s.id=d.time_slot_id where s.slot_date='2029-10-24' and s.trip_id='eeee0001-0001-4001-8001-000000000001'),'1.0','new duties inherit master weight');
select throws_ok($$select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',(select days from daily_plan_fixture),1,false,gen_random_uuid())$$,'40001',null,'stale plan rejected');
select public.phase3_claim_duty('dddd0001-0001-4001-8001-000000000001','aaaa0002-0002-4002-8002-000000000002',false);
update daily_plan_fixture set days=jsonb_set(days,'{0,responsibilityIds}','["11110002-0002-4002-8002-000000000002"]');
select throws_ok($$select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',(select days from daily_plan_fixture),2,false,gen_random_uuid())$$,'23514',null,'claimed removal requires explicit confirmation');
select ok((select is_active from public.trip_slot_duties where id='dddd0001-0001-4001-8001-000000000001'),'failed save leaves duties intact');
select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',(select days from daily_plan_fixture),2,true,gen_random_uuid());
select ok(not (select is_active from public.trip_slot_duties where id='dddd0001-0001-4001-8001-000000000001'),'confirmed removal soft-disables duty');
select is((select count(*)::int from public.trip_duty_assignments where slot_duty_id='dddd0001-0001-4001-8001-000000000001' and status='claimed'),1,'assignment history remains intact');
select is(public.phase3_get_member_quota_progress('eeee0001-0001-4001-8001-000000000001','aaaa0002-0002-4002-8002-000000000002')->>'claimed_count','0','removed duties do not satisfy legacy quota');
select is((select count(*)::int from public.audit_events where entity_id='eeee0001-0001-4001-8001-000000000001' and action='daily_responsibilities_saved'),2,'plan saves audited');
select ok(not has_function_privilege('authenticated','public.phase3_save_daily_responsibilities(uuid,uuid,jsonb,integer,boolean,uuid)','execute'),'browser cannot invoke arbitrary actor RPC');
select throws_ok($$select public.phase3_generate_candidate_time_slots('eeee0001-0001-4001-8001-000000000001','aaaa0001-0001-4001-8001-000000000001',true)$$,'22023',null,'retired generator never adds hardcoded duties');
update public.master_responsibilities set active=false where id='11110002-0002-4002-8002-000000000002';
select lives_ok($$select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',(select days from daily_plan_fixture),3,false,gen_random_uuid())$$,'existing selected retired responsibility can be preserved');
select throws_ok($$select public.phase3_save_daily_responsibilities('aaaa0001-0001-4001-8001-000000000001','eeee0001-0001-4001-8001-000000000001',null,4,false,gen_random_uuid())$$,'22023',null,'null plan rejected');
-- Daily duties have no scheduled time conflict with one another.
update public.master_responsibilities set active=true where id='11110002-0002-4002-8002-000000000002';
select ok((public.phase3_claim_duty((select d.id from public.trip_slot_duties d join public.trip_time_slots s on s.id=d.time_slot_id where s.slot_date='2029-10-25' and s.trip_id='eeee0001-0001-4001-8001-000000000001' and d.master_responsibility_id='11110001-0001-4001-8001-000000000001'),'aaaa0003-0003-4003-8003-000000000003',false)->>'success')::boolean,'first daily task claimed');
select is(public.phase3_claim_duty((select d.id from public.trip_slot_duties d join public.trip_time_slots s on s.id=d.time_slot_id where s.slot_date='2029-10-25' and s.trip_id='eeee0001-0001-4001-8001-000000000001' and d.master_responsibility_id='11110002-0002-4002-8002-000000000002'),'aaaa0003-0003-4003-8003-000000000003',false)->>'success','true','day-level duties do not imply simultaneous time conflicts');
-- A forged active admin/member ID must not bypass the Edge Function boundary.
set local role authenticated;
select throws_ok($$select public.phase3_admin_update_slot_duty('dddd0001-0001-4001-8001-000000000001',1,2.0,true,'aaaa0001-0001-4001-8001-000000000001')$$,'42501',null,'direct legacy admin RPC rejects forged actor');
select throws_ok($$select public.phase3_drop_duty((select id from public.trip_duty_assignments where slot_duty_id='dddd0001-0001-4001-8001-000000000001' limit 1),'aaaa0002-0002-4002-8002-000000000002','Forged caller')$$,'42501',null,'direct drop RPC rejects impersonation');
reset role;
select ok((select bool_and(not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute') and not p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('phase3_admin_create_master_responsibility','phase3_admin_update_master_responsibility','phase3_admin_configure_time_slot','phase3_admin_add_slot_duty','phase3_admin_update_slot_duty','phase3_admin_create_custom_time_slot','phase3_drop_duty','phase3_admin_assign_duty','phase3_admin_reassign_duty','phase3_admin_set_driver_credit')),'all legacy responsibility mutations are service-only invoker');
select * from finish();
rollback;
