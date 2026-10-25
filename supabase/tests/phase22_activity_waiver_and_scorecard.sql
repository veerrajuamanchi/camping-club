begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- 1. Column existence (4 checks)
select has_column('public', 'master_activities', 'waiver_url', 'master_activities has waiver_url');
select has_column('public', 'trip_activities', 'waiver_url', 'trip_activities has waiver_url');
select has_column('public', 'trip_activity_participants', 'waiver_clicked_at', 'trip_activity_participants has waiver_clicked_at');
select has_column('public', 'trip_activity_participants', 'waiver_signed_at', 'trip_activity_participants has waiver_signed_at');

-- 2. Authenticated test fixtures
insert into auth.users(id, email)
values
  ('b1000000-0000-0000-0000-000000000001', 'admin-p22@test.com'),
  ('b1000000-0000-0000-0000-000000000002', 'member1-p22@test.com');

insert into public.member_profiles(member_id, auth_user_id, display_name, member_role, account_status)
values
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Admin P22', 'admin', 'active'),
  ('b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'Member P22', 'member', 'active');

insert into public.campsites(id, rotation_position, name, location_description, cabin_capacity, active)
values ('b3000000-0000-0000-0000-000000000001', 99, 'P22 Campsite', 'P22 Location', 10, true);

insert into public.camping_trips(id, month_key, rotation_position, suggested_campsite_id, selected_campsite_id, starts_on, ends_on, poll_status, event_status, version)
values ('b4000000-0000-0000-0000-000000000001', '2039-07-01'::date, 1, 'b3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', current_date + 10, current_date + 13, 'closed', 'confirmed', 1);

-- 3. Master Activity with waiver_url
select is(
  (public.phase6_manage_master_activity(
    'create',
    null,
    jsonb_build_object(
      'title', 'GoCar Monterey Tour',
      'category', 'tour',
      'booking_url', 'https://groupon.com/deals/gocar',
      'waiver_url', 'https://fareharbor.com/waivers?shortname=seacartours',
      'unit_capacity', 2
    ),
    'b2000000-0000-0000-0000-000000000001'
  )->>'success')::boolean,
  true,
  'admin creates master activity with waiver_url'
);

select is(
  (select waiver_url from public.master_activities where title = 'GoCar Monterey Tour'),
  'https://fareharbor.com/waivers?shortname=seacartours',
  'master_activities table stores waiver_url'
);

-- 4. Trip Activity inheriting waiver_url from master activity
select is(
  (public.phase6_manage_trip_activity(
    'clone',
    'b4000000-0000-0000-0000-000000000001',
    null,
    jsonb_build_object(
      'master_activity_id', (select id from public.master_activities where title = 'GoCar Monterey Tour')
    ),
    'b2000000-0000-0000-0000-000000000001'
  )->>'success')::boolean,
  true,
  'admin clones master activity into trip activity'
);

select is(
  (select waiver_url from public.trip_activities where trip_id = 'b4000000-0000-0000-0000-000000000001'),
  'https://fareharbor.com/waivers?shortname=seacartours',
  'trip_activities table stores inherited waiver_url'
);

-- 5. Member tries to confirm signing before clicking waiver -> fails with 22023
select throws_ok(
  format(
    'select public.phase6_update_activity_waiver(%L::uuid, %L, %L::uuid)',
    (select id from public.trip_activities where trip_id = 'b4000000-0000-0000-0000-000000000001'),
    'sign',
    'b2000000-0000-0000-0000-000000000002'
  ),
  '22023',
  'You must click the waiver link to review and complete the form before confirming.',
  'confirming waiver before clicking link fails with intelligence rule error'
);

-- 6. Member clicks waiver URL -> records waiver_clicked_at
select is(
  (public.phase6_update_activity_waiver(
    (select id from public.trip_activities where trip_id = 'b4000000-0000-0000-0000-000000000001'),
    'click',
    'b2000000-0000-0000-0000-000000000002'
  )->>'action'),
  'click',
  'clicking waiver link records click action'
);

select ok(
  (select waiver_clicked_at is not null from public.trip_activity_participants
   where activity_id = (select id from public.trip_activities where trip_id = 'b4000000-0000-0000-0000-000000000001')
     and member_id = 'b2000000-0000-0000-0000-000000000002'),
  'waiver_clicked_at timestamp is set'
);

-- 7. Member confirms signing after click -> records waiver_signed_at
select ok(
  (select (public.phase6_update_activity_waiver(
    (select id from public.trip_activities where trip_id = 'b4000000-0000-0000-0000-000000000001'),
    'sign',
    'b2000000-0000-0000-0000-000000000002'
  )->>'waiver_signed_at') is not null),
  'signing waiver records waiver_signed_at'
);

select * from finish();
rollback;
