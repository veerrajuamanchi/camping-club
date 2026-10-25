BEGIN;
SELECT plan(4);

-- Setup test members: Admin, Alice, Bob
INSERT INTO public.member_profiles (member_id, display_name, member_role, account_status)
VALUES
  ('c1111111-1111-4111-8111-111111111111', 'Admin Dave', 'admin', 'active'),
  ('c2222222-2222-4222-8222-222222222222', 'Alice Camper', 'member', 'active'),
  ('c3333333-3333-4333-8333-333333333333', 'Bob Camper', 'member', 'active')
ON CONFLICT (member_id) DO UPDATE SET display_name = EXCLUDED.display_name, member_role = EXCLUDED.member_role;

-- Setup test trip
INSERT INTO public.camping_trips (
  id, month_key, rotation_position, suggested_campsite_id, selected_campsite_id,
  starts_on, ends_on, club_timezone_snapshot, poll_deadline_at, title, trip_status, event_status, poll_status, minimum_participants
)
VALUES
  (
    'c4444444-4444-4444-8444-444444444444', '2025-09-01', 1,
    (SELECT id FROM public.campsites LIMIT 1), (SELECT id FROM public.campsites LIMIT 1),
    '2025-09-12', '2025-09-14', 'America/Los_Angeles', '2025-09-01 18:00:00+00', 'September Test Trip', 'confirmed', 'confirmed', 'open', 4
  )
ON CONFLICT (id) DO NOTHING;

-- Setup test activity
INSERT INTO public.trip_activities (
  id, trip_id, title, category, activity_date
)
VALUES (
  'c5555555-5555-4555-8555-555555555555',
  'c4444444-4444-4444-8444-444444444444',
  'GoCar Tours',
  'tour',
  '2025-09-13'
)
ON CONFLICT (id) DO NOTHING;

-- Setup test activity group (Vehicle #1)
INSERT INTO public.trip_activity_groups (
  id, activity_id, group_number, group_name
)
VALUES (
  'c6666666-6666-4666-8666-666666666666',
  'c5555555-5555-4555-8555-555555555555',
  1,
  'Vehicle #1'
)
ON CONFLICT (id) DO NOTHING;

-- Assign Alice to Vehicle #1
INSERT INTO public.trip_activity_group_members (group_id, member_id)
VALUES ('c6666666-6666-4666-8666-666666666666', 'c2222222-2222-4222-8222-222222222222')
ON CONFLICT DO NOTHING;

-- Step 1: Alice submits voucher details ($120.00 = 12000 cents)
SELECT lives_ok(
  $$ SELECT public.phase6_submit_voucher(
       p_group_id := 'c6666666-6666-4666-8666-666666666666'::uuid,
       p_purchaser_member_id := 'c2222222-2222-4222-8222-222222222222'::uuid,
       p_purchase_date := '2025-09-01'::date,
       p_amount_cents := 12000,
       p_order_ref := 'ORDER-1234',
       p_voucher_code := 'VOUCH-1234',
       p_security_pin := '1111',
       p_actor_id := 'c2222222-2222-4222-8222-222222222222'::uuid
     ) $$,
  'Alice submits voucher and expense is created'
);

-- Check initial purchaser is Alice
SELECT results_eq(
  $$ SELECT purchaser_member_id FROM public.trip_activity_groups WHERE id = 'c6666666-6666-4666-8666-666666666666' $$,
  $$ VALUES ('c2222222-2222-4222-8222-222222222222'::uuid) $$,
  'Vehicle purchaser is initially Alice'
);

-- Step 2: Admin Dave updates the expense in Financials, changing payer to Bob
SELECT lives_ok(
  $$ SELECT public.phase5_manage_expense(
       p_trip_id := 'c4444444-4444-4444-8444-444444444444'::uuid,
       p_action := 'update',
       p_expense_id := (SELECT expense_id FROM public.trip_activity_groups WHERE id = 'c6666666-6666-4666-8666-666666666666'),
       p_payer_member_id := 'c3333333-3333-4333-8333-333333333333'::uuid,
       p_actor_id := 'c1111111-1111-4111-8111-111111111111'::uuid,
       p_is_admin := true
     ) $$,
  'Admin updates expense payer to Bob'
);

-- Step 3: Assert that trip_activity_groups.purchaser_member_id was synchronized to Bob!
SELECT results_eq(
  $$ SELECT purchaser_member_id FROM public.trip_activity_groups WHERE id = 'c6666666-6666-4666-8666-666666666666' $$,
  $$ VALUES ('c3333333-3333-4333-8333-333333333333'::uuid) $$,
  'Vehicle purchaser is synchronized to Bob after expense payer update'
);

ROLLBACK;
