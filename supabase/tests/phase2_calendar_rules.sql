begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('11000000-0000-4000-8000-000000000001','authenticated','authenticated','phase2-member-a@example.test','',now(),'{}','{}',now(),now()),
  ('11000000-0000-4000-8000-000000000002','authenticated','authenticated','phase2-member-b@example.test','',now(),'{}','{}',now(),now()),
  ('11000000-0000-4000-8000-000000000003','authenticated','authenticated','phase2-admin@example.test','',now(),'{}','{}',now(),now());
insert into public.member_profiles(member_id,auth_user_id,display_name,member_role,account_status)
values
  ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Phase Two Member A','member','active'),
  ('21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','Phase Two Member B','member','active'),
  ('21000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000003','Phase Two Admin','admin','active');

select is((select count(*)::integer from public.campsites),7,'seven predefined campsites are seeded');
select is((select jsonb_agg(name order by rotation_position) from public.campsites),'["Del Monte", "Wishon Cove", "DeSabla", "Almanor", "Shasta", "Britton", "Pit River"]'::jsonb,'initial rotation order matches the product design');
select is((select count(*)::integer from public.campsites where availability_url like 'https://%'),7,'each seeded campsite has its source URL');
select is((select default_minimum_participants::integer from public.club_configuration where singleton),4,'default minimum remains four');
select is((select club_timezone from public.club_configuration where singleton),null::text,'club timezone must be explicitly configured');
select is((select count(*)::integer from public.rule_definitions where scope='general' and active),16,'the general Constitution includes the disclosure and fifteen discussed club rules/guidelines');
select is((select count(*)::integer from public.rule_versions rv join public.rule_definitions d on d.id=rv.definition_id where d.scope='general' and rv.human_text like '%$0.76%'),1,'the seeded general Constitution preserves the driver mileage rule');
select ok((select bool_or(rv.human_text like '%first-come, first-served%') from public.rule_versions rv join public.rule_definitions d on d.id=rv.definition_id where d.scope='general' and d.stable_key='responsibility-workload'),'the seeded Constitution includes signup responsibility selection order');
select has_column('public','camping_trips','cabin_booking_status','trip records persist the new cabin booking status separately');
select is((select count(*)::integer from public.trip_rule_bundles b cross join lateral jsonb_array_elements(b.rendered_bundle) r where b.is_current and r->>'source'='general'),192,'all twelve generated polls show the disclosure and fifteen seeded general rules in their current immutable bundle');

select is((select count(*)::integer from public.camping_trips),12,'migration creates the first rolling year of interest polls');
select is(public.phase2_generate_calendar('21000000-0000-4000-8000-000000000003'::uuid,(date_trunc('month',now())::date + interval '13 months')::date,'31000000-0000-4000-8000-000000000001'::uuid)->>'generated_count','1','generator extends the rolling horizon by one month');
select is(public.phase2_generate_calendar('21000000-0000-4000-8000-000000000003'::uuid,(date_trunc('month',now())::date + interval '13 months')::date,'31000000-0000-4000-8000-000000000002'::uuid)->>'generated_count','0','repeating generation through the same month is idempotent');
select is((select count(*)::integer from public.camping_trips),13,'each generated month has one trip poll');
select is((select array_agg(rotation_position order by month_key)::text from public.camping_trips),'{1,2,3,4,5,6,7,1,2,3,4,5,6}','rotation repeats after seven months');
select is((select count(*)::integer from (select month_key from public.camping_trips group by month_key having count(*)>1) d),0,'generated calendar has no duplicate month keys');
select is((select count(*)::integer from public.camping_trips where minimum_basis is not null),0,'unapproved minimum basis is never assigned');
select is((select count(*)::integer from public.camping_trips where poll_status<>'draft'),0,'calendar generation does not open or decide a poll');

with trip as (select id from public.camping_trips order by month_key limit 1), bundle as (select b.id,b.trip_id,b.content_hash from public.trip_rule_bundles b join trip t on t.id=b.trip_id where b.is_current)
insert into public.trip_rule_acknowledgments(id,trip_id,member_id,bundle_id,content_hash,statement_version,request_id)
select '41000000-0000-4000-8000-000000000001',bundle.trip_id,'21000000-0000-4000-8000-000000000001',bundle.id,bundle.content_hash,'coming-v1','51000000-0000-4000-8000-000000000001' from bundle;
insert into public.trip_rsvps(id,trip_id,member_id,response,rule_acknowledgment_id,version)
select '61000000-0000-4000-8000-000000000001',t.id,'21000000-0000-4000-8000-000000000001','coming','41000000-0000-4000-8000-000000000001',1 from public.camping_trips t order by t.month_key limit 1;
insert into public.trip_rsvps(id,trip_id,member_id,response,version)
select '61000000-0000-4000-8000-000000000002',t.id,'21000000-0000-4000-8000-000000000002','not_coming',1 from public.camping_trips t order by t.month_key limit 1;

select ok((select relrowsecurity from pg_class where oid='public.campsites'::regclass),'campsites have RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.camping_trips'::regclass),'trip calendar has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.trip_rsvps'::regclass),'member RSVP table has RLS enabled');
select ok(not has_table_privilege('anon','public.camping_trips','select'),'visitors cannot read the private calendar');
select ok(not has_table_privilege('authenticated','public.trip_rule_bundles','select'),'members cannot read potentially stale rule bundles through the Data API');

set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.campsites),7,'active member may read the campsite catalog');
select is((select count(*)::integer from public.trip_rsvps),1,'member reads only their own RSVP');
select throws_ok($$insert into public.trip_rsvps(trip_id,member_id,response) select id,'21000000-0000-4000-8000-000000000001','not_coming' from public.camping_trips limit 1$$,'42501',null,'members cannot write RSVP rows through the Data API');
select throws_ok($$update public.camping_trips set minimum_basis='coming_rsvp'$$,'42501',null,'members cannot set the minimum-count basis directly');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.trip_rsvps),2,'administrator may inspect poll responses');
reset role;
select ok(not has_function_privilege('authenticated','public.phase2_generate_calendar(uuid,date,uuid)','execute'),'calendar generator is unavailable to direct authenticated RPC callers');
select ok(not has_function_privilege('authenticated','public.phase2_admin_get_campsite_notes(uuid)','execute'),'private campsite notes function is unavailable to direct authenticated RPC callers');
select ok(not has_function_privilege('authenticated','public.phase2_refresh_open_rule_bundles(uuid,uuid[])','execute'),'rule bundle refresh is unavailable to direct authenticated RPC callers');

create temporary table phase2_timed_bundle_fixture(trip_id uuid,initial_bundle uuid,initial_version integer,effective_bundle uuid);
insert into public.rule_definitions(id,stable_key,category,scope,created_by)
values('71000000-0000-4000-8000-000000000001','timed-rule','conduct','general','21000000-0000-4000-8000-000000000003');
insert into public.rule_versions(id,definition_id,version_no,human_text,structured_values,effective_from,expires_at,created_by)
values('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',1,'This rule is temporarily effective.','{}',clock_timestamp()+interval '2 seconds',clock_timestamp()+interval '4 seconds','21000000-0000-4000-8000-000000000003');
with target as (select id from public.camping_trips order by month_key offset 1 limit 1)
update public.camping_trips set poll_status='open',starts_on=current_date+30,ends_on=current_date+32,
  club_timezone_snapshot='America/Los_Angeles',poll_deadline_at=clock_timestamp()+interval '20 days'
where id=(select id from target);
insert into phase2_timed_bundle_fixture(trip_id,initial_bundle,initial_version)
select t.id,b.id,b.version_no from public.camping_trips t join public.trip_rule_bundles b on b.trip_id=t.id and b.is_current
where t.poll_status='open' order by t.month_key limit 1;
insert into public.trip_rule_acknowledgments(id,trip_id,member_id,bundle_id,content_hash,statement_version,request_id)
select '41000000-0000-4000-8000-000000000002',f.trip_id,'21000000-0000-4000-8000-000000000002',b.id,b.content_hash,'coming-v1','51000000-0000-4000-8000-000000000002'
from phase2_timed_bundle_fixture f join public.trip_rule_bundles b on b.id=f.initial_bundle;
select public.phase2_refresh_open_rule_bundles('21000000-0000-4000-8000-000000000001'::uuid,array[(select trip_id from phase2_timed_bundle_fixture)]);
select public.phase2_refresh_open_rule_bundles('21000000-0000-4000-8000-000000000001'::uuid,array[(select trip_id from phase2_timed_bundle_fixture)]);
select is((select b.version_no from public.trip_rule_bundles b join phase2_timed_bundle_fixture f on f.trip_id=b.trip_id where b.is_current),(select initial_version from phase2_timed_bundle_fixture),'unchanged rule refresh reuses the current immutable bundle version');
select is((select count(*)::integer from public.trip_rule_bundles b join phase2_timed_bundle_fixture f on f.trip_id=b.trip_id cross join lateral jsonb_array_elements(b.rendered_bundle) r where b.is_current and r->>'stable_key'='timed-rule'),0,'future-effective rule is excluded before its boundary');
select pg_sleep(2.1);
select throws_ok($$select public.phase2_admin_record_interest('21000000-0000-4000-8000-000000000003',(select trip_id from phase2_timed_bundle_fixture),'21000000-0000-4000-8000-000000000002','coming',0,'Late addition test','81000000-0000-4000-8000-000000000003')$$,'P0001','member must personally acknowledge the current rule bundle','administrator late entry rejects acknowledgment of the superseded rule bundle');
select throws_ok($$select public.phase2_submit_rsvp('11000000-0000-4000-8000-000000000002',(select trip_id from phase2_timed_bundle_fixture),'coming',(select initial_bundle from phase2_timed_bundle_fixture),(select content_hash from public.trip_rule_bundles where id=(select initial_bundle from phase2_timed_bundle_fixture)),0,'81000000-0000-4000-8000-000000000001')$$,'22023','current Camping Constitution acknowledgment required','Coming submission rejects the pre-effective rule bundle');
select public.phase2_refresh_open_rule_bundles('21000000-0000-4000-8000-000000000001'::uuid,array[(select trip_id from phase2_timed_bundle_fixture)]);
select is((select count(*)::integer from public.trip_rule_bundles b join phase2_timed_bundle_fixture f on f.trip_id=b.trip_id cross join lateral jsonb_array_elements(b.rendered_bundle) r where b.is_current and r->>'stable_key'='timed-rule'),1,'rule effective-time boundary refreshes the bundle shown to members');
update phase2_timed_bundle_fixture set effective_bundle=(select id from public.trip_rule_bundles where trip_id=phase2_timed_bundle_fixture.trip_id and is_current);
insert into public.trip_rule_acknowledgments(id,trip_id,member_id,bundle_id,content_hash,statement_version,request_id)
select '41000000-0000-4000-8000-000000000003',f.trip_id,'21000000-0000-4000-8000-000000000002',b.id,b.content_hash,'coming-v1','51000000-0000-4000-8000-000000000003'
from phase2_timed_bundle_fixture f join public.trip_rule_bundles b on b.id=f.effective_bundle;
select pg_sleep(2.1);
select throws_ok($$select public.phase2_admin_record_interest('21000000-0000-4000-8000-000000000003',(select trip_id from phase2_timed_bundle_fixture),'21000000-0000-4000-8000-000000000002','coming',0,'Late addition test','81000000-0000-4000-8000-000000000004')$$,'P0001','member must personally acknowledge the current rule bundle','administrator late entry rejects an expired rule-bundle acknowledgment');
select throws_ok($$select public.phase2_submit_rsvp('11000000-0000-4000-8000-000000000002',(select trip_id from phase2_timed_bundle_fixture),'coming',(select effective_bundle from phase2_timed_bundle_fixture),(select content_hash from public.trip_rule_bundles where id=(select effective_bundle from phase2_timed_bundle_fixture)),0,'81000000-0000-4000-8000-000000000002')$$,'22023','current Camping Constitution acknowledgment required','Coming submission rejects the expired rule bundle');
select public.phase2_refresh_open_rule_bundles('21000000-0000-4000-8000-000000000001'::uuid,array[(select trip_id from phase2_timed_bundle_fixture)]);
select is((select count(*)::integer from public.trip_rule_bundles b join phase2_timed_bundle_fixture f on f.trip_id=b.trip_id cross join lateral jsonb_array_elements(b.rendered_bundle) r where b.is_current and r->>'stable_key'='timed-rule'),0,'rule expiry boundary removes the rule from the current poll bundle');

create temporary table phase2_timezone_fixture(trip_id uuid,prior_deadline timestamptz);
insert into phase2_timezone_fixture(trip_id,prior_deadline)
select id,((current_date+55)::timestamp+time '18:00') at time zone 'America/Los_Angeles'
from public.camping_trips order by month_key offset 3 limit 1;
update public.club_configuration set club_timezone='America/Los_Angeles' where singleton;
update public.camping_trips set starts_on=current_date+90,ends_on=current_date+92,club_timezone_snapshot='America/Los_Angeles',
  poll_deadline_at=(select prior_deadline from phase2_timezone_fixture)
where id=(select trip_id from phase2_timezone_fixture);
update public.club_configuration set club_timezone='America/Denver',version=version+1 where singleton;
select public.phase2_admin_configure_trip('21000000-0000-4000-8000-000000000003'::uuid,
  (select trip_id from phase2_timezone_fixture),current_date+90,current_date+92,current_date+55,time '18:00',4,8,
  (select selected_campsite_id from public.camping_trips where id=(select trip_id from phase2_timezone_fixture)),
  'booked','timezone preservation test',1,'Timezone snapshot regression','82000000-0000-4000-8000-000000000001'::uuid);
select is((select club_timezone_snapshot from public.camping_trips where id=(select trip_id from phase2_timezone_fixture)),
  'America/Los_Angeles','existing poll keeps its captured timezone after club default changes');
select is((select poll_deadline_at from public.camping_trips where id=(select trip_id from phase2_timezone_fixture)),
  (select prior_deadline from phase2_timezone_fixture),'saving an existing poll preserves its deadline instant across a club timezone change');
select is((select event_details->>'cabin_booking_status' from public.trip_poll_events where request_id='82000000-0000-4000-8000-000000000001'::uuid and event_type='trip_configured'),
  'booked','trip configuration audit event records the selected Cabin Booking Status');

select * from finish();
rollback;
