begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- 1. Column existence (2 checks)
select has_column('public', 'master_activities', 'booking_url', 'master_activities has booking_url');
select has_column('public', 'trip_activities', 'booking_url', 'trip_activities has booking_url');

-- 2. Authenticated test fixtures
insert into auth.users(id, email)
values
  ('a1000000-0000-0000-0000-000000000001', 'admin-p20@test.com'),
  ('a1000000-0000-0000-0000-000000000002', 'member1-p20@test.com'),
  ('a1000000-0000-0000-0000-000000000003', 'member2-p20@test.com'),
  ('a1000000-0000-0000-0000-000000000004', 'member3-p20@test.com'),
  ('a1000000-0000-0000-0000-000000000005', 'inactive-p20@test.com');

insert into public.member_profiles(member_id, auth_user_id, display_name, member_role, account_status)
values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Admin P20', 'admin', 'active'),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'Member One', 'member', 'active'),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', 'Member Two', 'member', 'active'),
  ('a2000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000004', 'Member Three', 'member', 'active'),
  ('a2000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000005', 'Inactive Member', 'member', 'inactive');

insert into public.campsites(id, rotation_position, name, location_description, cabin_capacity, active)
values ('a3000000-0000-0000-0000-000000000001', 98, 'P20 Campsite', 'P20 Location', 10, true);

insert into public.camping_trips(id, month_key, rotation_position, suggested_campsite_id, selected_campsite_id, starts_on, ends_on, poll_status, event_status, version)
values ('a4000000-0000-0000-0000-000000000001', '2039-06-01'::date, 1, 'a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', current_date + 10, current_date + 13, 'closed', 'confirmed', 1);

-- 3. Master Activity with booking_url (3 checks)
-- Test 3: Admin creates master activity with booking_url
select is(
  (public.phase6_manage_master_activity(
    'create',
    null,
    jsonb_build_object(
      'title', 'Monterey Sea Kayaking',
      'category', 'Water Sports',
      'booking_url', 'https://www.groupon.com/deals/monterey-kayak',
      'unit_capacity', 2
    ),
    'a2000000-0000-0000-0000-000000000001'
  )->>'success')::boolean,
  true,
  'admin creates master activity with booking_url'
);

-- Test 4: Verify booking_url in master_activities table
select is(
  (select booking_url from public.master_activities where title = 'Monterey Sea Kayaking'),
  'https://www.groupon.com/deals/monterey-kayak',
  'master_activities persists booking_url'
);

-- Test 5: Update booking_url on master activity
select is(
  (public.phase6_manage_master_activity(
    'update',
    (select id from public.master_activities where title = 'Monterey Sea Kayaking'),
    jsonb_build_object('booking_url', 'https://www.groupon.com/deals/monterey-kayak-updated'),
    'a2000000-0000-0000-0000-000000000001'
  )->>'success')::boolean,
  true,
  'admin updates master activity booking_url'
);

-- 4. Trip Activity cloning and booking_url (3 checks)
-- Test 6: Clone from master activity inherits booking_url
select is(
  (public.phase6_manage_trip_activity(
    'clone',
    'a4000000-0000-0000-0000-000000000001',
    null,
    jsonb_build_object(
      'master_activity_id', (select id from public.master_activities where title = 'Monterey Sea Kayaking')
    ),
    'a2000000-0000-0000-0000-000000000001'
  )->>'success')::boolean,
  true,
  'admin clones trip activity from master activity'
);

-- Test 7: Cloned trip activity inherited booking_url
select is(
  (select booking_url from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
  'https://www.groupon.com/deals/monterey-kayak-updated',
  'trip_activities inherits booking_url from master activity'
);

-- Test 8: Admin updates trip activity booking_url directly
select is(
  (public.phase6_manage_trip_activity(
    'update',
    'a4000000-0000-0000-0000-000000000001',
    (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
    jsonb_build_object('booking_url', 'https://operator.com/special-trip-deal'),
    'a2000000-0000-0000-0000-000000000001'
  )->>'success')::boolean,
  true,
  'admin updates trip activity booking_url'
);

-- 5. Vehicle Group Creation via create_group (5 checks)
-- Test 9: Create group with custom group_label
select is(
  (public.phase6_manage_activity_pairings(
    (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
    'create_group',
    jsonb_build_object('group_label', 'Kayak #1'),
    'a2000000-0000-0000-0000-000000000001'
  )->>'success')::boolean,
  true,
  'admin creates group with custom group_label'
);

-- Test 10: Verify created group details
select is(
  (select group_name from public.trip_activity_groups where group_number = 1),
  'Kayak #1',
  'trip_activity_groups has custom group_name from group_label'
);

-- Test 11: Create second group defaulting to next group_number and unit_label
select is(
  (public.phase6_manage_activity_pairings(
    (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
    'create_group',
    '{}'::jsonb,
    'a2000000-0000-0000-0000-000000000001'
  )->>'group_number')::integer,
  2,
  'create_group auto-increments group_number to 2'
);

-- Test 12: Create third group with member_ids passed immediately
select is(
  (public.phase6_manage_activity_pairings(
    (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
    'create_group',
    jsonb_build_object(
      'group_label', 'Kayak #3',
      'member_ids', jsonb_build_array('a2000000-0000-0000-0000-000000000002')
    ),
    'a2000000-0000-0000-0000-000000000001'
  )->>'success')::boolean,
  true,
  'admin creates group with member_ids passed immediately'
);

-- Test 13: Member is assigned to Kayak #3
select is(
  (select count(*)::integer from public.trip_activity_group_members gm
   join public.trip_activity_groups g on g.id = gm.group_id
   where g.group_name = 'Kayak #3' and gm.member_id = 'a2000000-0000-0000-0000-000000000002'),
  1,
  'member is directly assigned to Kayak #3'
);

-- 6. Member Assignment via assign_members (7 checks)
-- Test 14: Assign 2 members to Kayak #1
select is(
  (public.phase6_manage_activity_pairings(
    (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
    'assign_members',
    jsonb_build_object(
      'group_id', (select id from public.trip_activity_groups where group_number = 1),
      'member_ids', jsonb_build_array('a2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000003')
    ),
    'a2000000-0000-0000-0000-000000000001'
  )->>'success')::boolean,
  true,
  'admin assigns 2 members to vehicle group'
);

-- Test 15: Member One was moved from Kayak #3 to Kayak #1
select is(
  (select count(*)::integer from public.trip_activity_group_members gm
   join public.trip_activity_groups g on g.id = gm.group_id
   where g.group_name = 'Kayak #3' and gm.member_id = 'a2000000-0000-0000-0000-000000000002'),
  0,
  'member was cleanly moved from Kayak #3 to Kayak #1'
);

-- Test 16: Kayak #1 has both Member One and Member Two
select is(
  (select count(*)::integer from public.trip_activity_group_members gm
   join public.trip_activity_groups g on g.id = gm.group_id
   where g.group_number = 1),
  2,
  'Kayak #1 has exactly 2 members'
);

-- Test 17: Both members are recorded in trip_activity_participants as attending
select is(
  (select count(*)::integer from public.trip_activity_participants
   where activity_id = (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking')
     and member_id in ('a2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000003')
     and status = 'attending'),
  2,
  'both assigned members are marked attending'
);

-- Test 18: Exceeding capacity throws 22023
select throws_ok(
  $$ select public.phase6_manage_activity_pairings(
       (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
       'assign_members',
       jsonb_build_object(
         'group_id', (select id from public.trip_activity_groups where group_number = 1),
         'member_ids', jsonb_build_array('a2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000004')
       ),
       'a2000000-0000-0000-0000-000000000001'
     ) $$,
  '22023',
  'Group capacity exceeded (max 2).',
  'assigning 3 members when capacity is 2 throws error'
);

-- Test 19: Duplicate members throws 22023
select throws_ok(
  $$ select public.phase6_manage_activity_pairings(
       (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
       'assign_members',
       jsonb_build_object(
         'group_id', (select id from public.trip_activity_groups where group_number = 1),
         'member_ids', jsonb_build_array('a2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002')
       ),
       'a2000000-0000-0000-0000-000000000001'
     ) $$,
  '22023',
  'Duplicate members provided in assignment.',
  'assigning duplicate members throws error'
);

-- Test 20: Inactive member throws 22023
select throws_ok(
  $$ select public.phase6_manage_activity_pairings(
       (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
       'assign_members',
       jsonb_build_object(
         'group_id', (select id from public.trip_activity_groups where group_number = 1),
         'member_ids', jsonb_build_array('a2000000-0000-0000-0000-000000000005')
       ),
       'a2000000-0000-0000-0000-000000000001'
     ) $$,
  '22023',
  null,
  'assigning inactive member throws error'
);

-- 7. Deleting Vehicle Groups via delete_group (4 checks)
-- Test 21: Delete group with members (Kayak #1) succeeds when voucher is pending/null
select is(
  (public.phase6_manage_activity_pairings(
    (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
    'delete_group',
    jsonb_build_object('group_id', (select id from public.trip_activity_groups where group_number = 1)),
    'a2000000-0000-0000-0000-000000000001'
  )->>'success')::boolean,
  true,
  'admin deletes vehicle group with no voucher'
);

-- Test 22: Verify group 1 and its members are gone
select is(
  (select count(*)::integer from public.trip_activity_groups where group_number = 1),
  0,
  'deleted group is removed from trip_activity_groups'
);

-- Test 23: Set voucher on group 2 to purchased
update public.trip_activity_groups
set voucher_status = 'purchased', voucher_code = 'VOUCH-123'
where group_number = 2;

-- Test 24: Attempting to delete group with purchased voucher throws 22023
select throws_ok(
  $$ select public.phase6_manage_activity_pairings(
       (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
       'delete_group',
       jsonb_build_object('group_id', (select id from public.trip_activity_groups where group_number = 2)),
       'a2000000-0000-0000-0000-000000000001'
     ) $$,
  '22023',
  'Cannot delete group with a purchased or verified voucher.',
  'cannot delete group with purchased voucher'
);

-- 8. Non-admin authorization guardrails (2 checks)
-- Test 25: Non-admin cannot create group
select throws_ok(
  $$ select public.phase6_manage_activity_pairings(
       (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
       'create_group',
       '{}'::jsonb,
       'a2000000-0000-0000-0000-000000000002'
     ) $$,
  '42501',
  null,
  'non-admin cannot create vehicle group'
);

-- Test 26: Non-admin cannot assign members
select throws_ok(
  $$ select public.phase6_manage_activity_pairings(
       (select id from public.trip_activities where trip_id = 'a4000000-0000-0000-0000-000000000001' and title = 'Monterey Sea Kayaking'),
       'assign_members',
       jsonb_build_object(
         'group_id', (select id from public.trip_activity_groups where group_number = 3),
         'member_ids', jsonb_build_array('a2000000-0000-0000-0000-000000000002')
       ),
       'a2000000-0000-0000-0000-000000000002'
     ) $$,
  '42501',
  null,
  'non-admin cannot assign members'
);

select * from finish();
rollback;
