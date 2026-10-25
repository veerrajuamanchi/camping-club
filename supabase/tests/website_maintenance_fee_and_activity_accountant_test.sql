BEGIN;
SELECT plan(11);

-- Setup test members first: Admin Veerraju, New Member Alice, Returning Member Bob, Charlie Accountant
INSERT INTO public.member_profiles (member_id, display_name, member_role, account_status)
VALUES
  ('a1111111-1111-4111-8111-111111111111', 'Veerraju Amanchi', 'admin', 'active'),
  ('a2222222-2222-4222-8222-222222222222', 'Alice Newcomer', 'member', 'active'),
  ('a3333333-3333-4333-8333-333333333333', 'Bob Returning', 'member', 'active'),
  ('a4444444-4444-4444-8444-444444444444', 'Charlie Accountant', 'accountant', 'active')
ON CONFLICT (member_id) DO UPDATE SET display_name = EXCLUDED.display_name, member_role = EXCLUDED.member_role;

-- Test 1: trip_expenses permits 'website_maintenance'
SELECT lives_ok(
  $$ INSERT INTO public.trip_expenses (
       trip_id, expense_type, payer_member_id, amount_cents, description, split_mode
     ) VALUES (
       (SELECT id FROM public.camping_trips WHERE deleted_at IS NULL LIMIT 1),
       'website_maintenance',
       'a1111111-1111-4111-8111-111111111111',
       500,
       'Website Build & Maintenance Fee ($5.00 - First Event)',
       'custom'
     ) $$,
  'trip_expenses allows website_maintenance expense_type'
);

-- Test 2: rule_definitions contains website-maintenance-contribution
SELECT results_eq(
  $$ SELECT count(*)::integer FROM public.rule_definitions WHERE stable_key = 'website-maintenance-contribution' AND scope = 'general' $$,
  $$ VALUES (1::integer) $$,
  'rule_definitions has website-maintenance-contribution rule'
);

-- Setup test trips: Past Trip (completed), and Current Trip (open) with required month_key and campsite references
INSERT INTO public.camping_trips (
  id, month_key, rotation_position, suggested_campsite_id, selected_campsite_id,
  starts_on, ends_on, club_timezone_snapshot, poll_deadline_at, title, trip_status, event_status, poll_status, minimum_participants
)
VALUES
  (
    'b1111111-1111-4111-8111-111111111111', '2025-08-01', 1,
    (SELECT id FROM public.campsites LIMIT 1), (SELECT id FROM public.campsites LIMIT 1),
    '2025-08-01', '2025-08-03', 'America/Los_Angeles', '2025-07-25 18:00:00+00', 'Past Summer Trip', 'completed', 'completed', 'closed', 4
  ),
  (
    'b2222222-2222-4222-8222-222222222222', '2025-11-01', 2,
    (SELECT id FROM public.campsites LIMIT 1), (SELECT id FROM public.campsites LIMIT 1),
    '2025-11-14', '2025-11-16', 'America/Los_Angeles', '2025-11-01 18:00:00+00', 'Current Fall Trip', 'confirmed', 'confirmed', 'open', 4
  )
ON CONFLICT (id) DO UPDATE SET trip_status = EXCLUDED.trip_status;

-- Build rule bundles for past trip and current trip
SELECT private.phase2_build_rule_bundle('b1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111');
SELECT private.phase2_build_rule_bundle('b2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111');

-- Make Bob a past attendee on the past trip with valid acknowledgment
INSERT INTO public.trip_rule_acknowledgments (id, trip_id, member_id, bundle_id, content_hash, statement_version, request_id)
SELECT
  'c3333333-3333-4333-8333-333333333333',
  'b1111111-1111-4111-8111-111111111111',
  'a3333333-3333-4333-8333-333333333333',
  b.id,
  b.content_hash,
  'coming-v1',
  gen_random_uuid()
FROM public.trip_rule_bundles b
WHERE b.trip_id = 'b1111111-1111-4111-8111-111111111111' AND b.is_current;

INSERT INTO public.trip_rsvps (id, trip_id, member_id, response, rule_acknowledgment_id, version)
VALUES
  (gen_random_uuid(), 'b1111111-1111-4111-8111-111111111111', 'a3333333-3333-4333-8333-333333333333', 'coming', 'c3333333-3333-4333-8333-333333333333', 1)
ON CONFLICT DO NOTHING;

-- Test 3: Admin Veerraju RSVPs Coming -> Fee is waived (0 expense rows created)
SELECT lives_ok(
  $$ SELECT private.apply_website_maintenance_fee('b2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111') $$,
  'apply_website_maintenance_fee succeeds for admin'
);

SELECT results_eq(
  $$ SELECT count(*)::integer FROM public.trip_expenses
     WHERE trip_id = 'b2222222-2222-4222-8222-222222222222'
       AND expense_type = 'website_maintenance'
       AND id IN (SELECT expense_id FROM public.trip_expense_allocations WHERE member_id = 'a1111111-1111-4111-8111-111111111111') $$,
  $$ VALUES (0::integer) $$,
  'Fee is waived for Admin Veerraju Amanchi'
);

-- Test 4: Alice (New Member, 0 past trips) RSVPs Coming -> $5.00 (500 cents) expense created
SELECT lives_ok(
  $$ SELECT private.apply_website_maintenance_fee('b2222222-2222-4222-8222-222222222222', 'a2222222-2222-4222-8222-222222222222') $$,
  'apply_website_maintenance_fee succeeds for new member Alice'
);

SELECT results_eq(
  $$ SELECT amount_cents, payer_member_id FROM public.trip_expenses
     WHERE trip_id = 'b2222222-2222-4222-8222-222222222222'
       AND expense_type = 'website_maintenance'
       AND id IN (SELECT expense_id FROM public.trip_expense_allocations WHERE member_id = 'a2222222-2222-4222-8222-222222222222') $$,
  $$ VALUES (500, 'a1111111-1111-4111-8111-111111111111'::uuid) $$,
  'Alice pays $5.00 (500 cents) credited to Admin Veerraju'
);

-- Test 5: Bob (Returning Member, 1 past trip) RSVPs Coming -> $2.50 (250 cents) expense created
SELECT lives_ok(
  $$ SELECT private.apply_website_maintenance_fee('b2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333') $$,
  'apply_website_maintenance_fee succeeds for returning member Bob'
);

SELECT results_eq(
  $$ SELECT amount_cents, payer_member_id FROM public.trip_expenses
     WHERE trip_id = 'b2222222-2222-4222-8222-222222222222'
       AND expense_type = 'website_maintenance'
       AND id IN (SELECT expense_id FROM public.trip_expense_allocations WHERE member_id = 'a3333333-3333-4333-8333-333333333333') $$,
  $$ VALUES (250, 'a1111111-1111-4111-8111-111111111111'::uuid) $$,
  'Bob pays $2.50 (250 cents) credited to Admin Veerraju'
);

-- Test 6: Alice changes RSVP to Not Coming -> Fee is deleted/cancelled
SELECT lives_ok(
  $$ SELECT private.cancel_website_maintenance_fee('b2222222-2222-4222-8222-222222222222', 'a2222222-2222-4222-8222-222222222222') $$,
  'cancel_website_maintenance_fee succeeds for Alice'
);

SELECT results_eq(
  $$ SELECT count(*)::integer FROM public.trip_expenses
     WHERE trip_id = 'b2222222-2222-4222-8222-222222222222'
       AND expense_type = 'website_maintenance'
       AND id IN (SELECT expense_id FROM public.trip_expense_allocations WHERE member_id = 'a2222222-2222-4222-8222-222222222222') $$,
  $$ VALUES (0::integer) $$,
  'Alice website maintenance fee was removed after changing to Not Coming'
);

-- Test 7: Activity Accountant can submit voucher details
-- Create test activity & group
INSERT INTO public.trip_activities (id, trip_id, title, activity_date)
VALUES ('ac111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 'GoCar Tour', '2025-11-15')
ON CONFLICT DO NOTHING;

INSERT INTO public.trip_activity_groups (id, activity_id, group_number, group_name)
VALUES ('ad111111-1111-4111-8111-111111111111', 'ac111111-1111-4111-8111-111111111111', 1, 'Vehicle #1')
ON CONFLICT DO NOTHING;

-- Charlie Accountant (not assigned to Vehicle #1) submits voucher
SELECT lives_ok(
  $$ SELECT public.phase6_submit_voucher(
       p_group_id := 'ad111111-1111-4111-8111-111111111111',
       p_purchaser_member_id := 'a4444444-4444-4444-8444-444444444444',
       p_purchase_date := '2025-10-24'::date,
       p_amount_cents := 12000,
       p_order_ref := 'GRP-12345',
       p_voucher_code := 'VOUCH-999',
       p_security_pin := '1234',
       p_actor_id := 'a4444444-4444-4444-8444-444444444444'
     ) $$,
  'Accountant can submit voucher details for any vehicle group'
);

SELECT * FROM finish();
ROLLBACK;
