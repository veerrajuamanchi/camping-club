BEGIN;
SELECT plan(21);

-- Test 1: Check constraint permits 'accountant'
SELECT col_is_pk('public', 'member_profiles', 'member_id', 'member_profiles has primary key');

-- Test 2: trip_expenses has split_mode column
SELECT has_column('public', 'trip_expenses', 'split_mode', 'trip_expenses has split_mode column');

-- Test 3: trip_expenses has receipt_storage_path column
SELECT has_column('public', 'trip_expenses', 'receipt_storage_path', 'trip_expenses has receipt_storage_path');

-- Test 4: trip_expenses has receipt_file_name column
SELECT has_column('public', 'trip_expenses', 'receipt_file_name', 'trip_expenses has receipt_file_name');

-- Test 5: storage bucket trip-receipts exists
SELECT results_eq(
  $$ SELECT id, public FROM storage.buckets WHERE id = 'trip-receipts' $$,
  $$ VALUES ('trip-receipts'::text, false) $$,
  'trip-receipts bucket exists and is private'
);

-- Test 6: purge_expired_receipts function exists
SELECT has_function('public', 'purge_expired_receipts', 'purge_expired_receipts function exists');

-- Test 7: trip_expenses has receipt_content_type column
SELECT has_column('public', 'trip_expenses', 'receipt_content_type', 'trip_expenses has receipt_content_type');

-- Test 8: member_profiles check constraint allows 'accountant'
SELECT lives_ok(
  $$ INSERT INTO public.member_profiles (member_id, display_name, member_role, account_status)
     VALUES ('11111111-1111-1111-1111-111111111111', 'Accountant User', 'accountant', 'active') $$,
  'member_profiles allows accountant role'
);

-- Test 9: member_profiles check constraint rejects invalid role
SELECT throws_ok(
  $$ INSERT INTO public.member_profiles (member_id, display_name, member_role, account_status)
     VALUES ('22222222-2222-2222-2222-222222222222', 'Invalid User', 'treasurer', 'active') $$,
  '23514',
  NULL,
  'member_profiles rejects invalid role'
);

-- Test 10: trip_expenses split_mode check constraint rejects invalid split_mode
SELECT throws_ok(
  $$ INSERT INTO public.trip_expenses (trip_id, expense_type, payer_member_id, amount_cents, description, split_mode)
     VALUES (
       (SELECT id FROM public.camping_trips LIMIT 1),
       'shared_receipt',
       '11111111-1111-1111-1111-111111111111',
       1000,
       'Invalid split test',
       'percentage'
     ) $$,
  '23514',
  NULL,
  'trip_expenses rejects invalid split_mode'
);

-- Test 11: phase1_update_membership permits updating member to accountant
DO $$
DECLARE
  v_admin_id uuid := '33333333-3333-3333-3333-333333333333';
  v_target_id uuid := '44444444-4444-4444-4444-444444444444';
BEGIN
  INSERT INTO public.member_profiles (member_id, display_name, member_role, account_status)
  VALUES (v_admin_id, 'Admin User', 'admin', 'active');

  INSERT INTO public.member_profiles (member_id, display_name, member_role, account_status)
  VALUES (v_target_id, 'Regular Member', 'member', 'active');

  PERFORM public.phase1_update_membership(
    v_admin_id,
    v_target_id,
    'accountant',
    'active',
    'Promoted to club accountant',
    gen_random_uuid()
  );
END $$;

SELECT results_eq(
  $$ SELECT member_role FROM public.member_profiles WHERE member_id = '44444444-4444-4444-4444-444444444444' $$,
  $$ VALUES ('accountant'::text) $$,
  'phase1_update_membership sets accountant role'
);

-- Test 12: verify_member_deposit allows accountant to verify deposit
DO $$
DECLARE
  v_accountant_id uuid := '44444444-4444-4444-4444-444444444444';
  v_member_id uuid := '55555555-5555-5555-5555-555555555555';
  v_trip_id uuid;
BEGIN
  INSERT INTO public.member_profiles (member_id, display_name, member_role, account_status)
  VALUES (v_member_id, 'Camper Five', 'member', 'active');

  SELECT id INTO v_trip_id FROM public.camping_trips LIMIT 1;

  INSERT INTO public.trip_rsvps (trip_id, member_id, response, version, deposit_status)
  VALUES (v_trip_id, v_member_id, 'not_coming', 1, 'unpaid');

  PERFORM public.verify_member_deposit(
    v_trip_id,
    v_member_id,
    'confirmed_by_admin',
    v_accountant_id
  );
END $$;

SELECT results_eq(
  $$ SELECT deposit_status, deposit_confirmed_by
     FROM public.trip_rsvps
     WHERE member_id = '55555555-5555-5555-5555-555555555555' $$,
  $$ VALUES ('confirmed_by_admin'::text, '44444444-4444-4444-4444-444444444444'::uuid) $$,
  'verify_member_deposit successfully verified by accountant'
);

-- Test 13: verify_member_deposit rejects standard member
SELECT throws_ok(
  $$ SELECT public.verify_member_deposit(
       (SELECT id FROM public.camping_trips LIMIT 1),
       '55555555-5555-5555-5555-555555555555'::uuid,
       'confirmed_by_admin',
       '55555555-5555-5555-5555-555555555555'::uuid
     ) $$,
  '42501',
  NULL,
  'verify_member_deposit rejects unauthorized standard member'
);

-- Test 14: phase5_manage_expense creates expense with split_mode and receipt metadata
DO $$
DECLARE
  v_trip_id uuid;
  v_result jsonb;
BEGIN
  SELECT id INTO v_trip_id FROM public.camping_trips LIMIT 1;

  v_result := public.phase5_manage_expense(
    p_trip_id := v_trip_id,
    p_action := 'create',
    p_expense_type := 'shared_receipt',
    p_payer_member_id := '44444444-4444-4444-4444-444444444444',
    p_amount_cents := 4500,
    p_description := 'Camp firewood and kindling',
    p_actor_id := '44444444-4444-4444-4444-444444444444',
    p_is_admin := false,
    p_split_mode := 'all_attendees',
    p_receipt_storage_path := 'trips/' || v_trip_id || '/receipt_01.jpg',
    p_receipt_file_name := 'receipt_01.jpg',
    p_receipt_content_type := 'image/jpeg'
  );
END $$;

SELECT results_eq(
  $$ SELECT split_mode, receipt_file_name, receipt_content_type
     FROM public.trip_expenses
     WHERE description = 'Camp firewood and kindling' $$,
  $$ VALUES ('all_attendees'::text, 'receipt_01.jpg'::text, 'image/jpeg'::text) $$,
  'phase5_manage_expense persists split_mode and receipt metadata'
);

-- Test 15: phase5_manage_expense delete removes receipt from storage
DO $$
DECLARE
  v_trip_id uuid;
  v_expense_id uuid;
  v_storage_path text;
BEGIN
  SELECT id INTO v_trip_id FROM public.camping_trips LIMIT 1;
  v_storage_path := 'trips/' || v_trip_id || '/to_delete.png';

  -- Insert storage object
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('trip-receipts', v_storage_path);

  -- Create expense referencing storage object
  SELECT id INTO v_expense_id FROM public.trip_expenses WHERE description = 'Camp firewood and kindling';
  UPDATE public.trip_expenses SET receipt_storage_path = v_storage_path WHERE id = v_expense_id;

  -- Delete expense
  PERFORM public.phase5_manage_expense(
    p_trip_id := v_trip_id,
    p_action := 'delete',
    p_expense_id := v_expense_id,
    p_actor_id := '44444444-4444-4444-4444-444444444444',
    p_is_admin := false
  );
END $$;

SELECT results_eq(
  $$ SELECT count(*)::integer FROM storage.objects WHERE bucket_id = 'trip-receipts' AND name LIKE '%to_delete.png' $$,
  $$ VALUES (0::integer) $$,
  'phase5_manage_expense delete removes receipt object from storage'
);

-- Test 16: purge_expired_receipts purges only completed trips older than top 3
DO $$
DECLARE
  v_t1 uuid := gen_random_uuid();
  v_t2 uuid := gen_random_uuid();
  v_t3 uuid := gen_random_uuid();
  v_t4 uuid := gen_random_uuid();
  v_upcoming uuid := gen_random_uuid();
  v_admin_id uuid := '33333333-3333-3333-3333-333333333333';
  v_campsite_id uuid;
BEGIN
  SELECT id INTO v_campsite_id FROM public.campsites LIMIT 1;

  -- 4 completed trips with different dates:
  -- t1 (oldest completed: 2026-01-01) -> should be purged!
  -- t2 (2026-02-01) -> retained (top 3)
  -- t3 (2026-03-01) -> retained (top 3)
  -- t4 (2026-04-01) -> retained (top 3)
  -- upcoming (2026-11-01, rsvp_open) -> retained
  INSERT INTO public.camping_trips (id, title, month_key, starts_on, ends_on, trip_status, event_status, poll_status, suggested_campsite_id, selected_campsite_id, rotation_position)
  VALUES
    (v_t1, 'Trip Jan', '2026-01-01', '2026-01-10', '2026-01-12', 'completed', 'confirmed', 'closed', v_campsite_id, v_campsite_id, 1),
    (v_t2, 'Trip Feb', '2026-02-01', '2026-02-10', '2026-02-12', 'completed', 'confirmed', 'closed', v_campsite_id, v_campsite_id, 2),
    (v_t3, 'Trip Mar', '2026-03-01', '2026-03-10', '2026-03-12', 'financially_settled', 'confirmed', 'closed', v_campsite_id, v_campsite_id, 3),
    (v_t4, 'Trip Apr', '2026-04-01', '2026-04-10', '2026-04-12', 'completed', 'confirmed', 'closed', v_campsite_id, v_campsite_id, 4),
    (v_upcoming, 'Trip Nov Upcoming', '2026-11-01', '2026-11-10', '2026-11-12', 'rsvp_open', 'tentative', 'draft', v_campsite_id, v_campsite_id, 5);

  -- Insert receipts in storage
  INSERT INTO storage.objects (bucket_id, name)
  VALUES
    ('trip-receipts', 'trips/' || v_t1 || '/receipt_t1.jpg'),
    ('trip-receipts', 'trips/' || v_t4 || '/receipt_t4.jpg'),
    ('trip-receipts', 'trips/' || v_upcoming || '/receipt_up.jpg');

  -- Insert expenses referencing receipts
  INSERT INTO public.trip_expenses (trip_id, expense_type, payer_member_id, amount_cents, description, receipt_storage_path, receipt_file_name)
  VALUES
    (v_t1, 'shared_receipt', v_admin_id, 1000, 'T1 expense', 'trips/' || v_t1 || '/receipt_t1.jpg', 'receipt_t1.jpg'),
    (v_t4, 'shared_receipt', v_admin_id, 2000, 'T4 expense', 'trips/' || v_t4 || '/receipt_t4.jpg', 'receipt_t4.jpg'),
    (v_upcoming, 'shared_receipt', v_admin_id, 3000, 'Upcoming expense', 'trips/' || v_upcoming || '/receipt_up.jpg', 'receipt_up.jpg');

  -- Run retention purge
  PERFORM public.purge_expired_receipts();
END $$;

SELECT results_eq(
  $$ SELECT
       (SELECT count(*)::integer FROM storage.objects WHERE bucket_id = 'trip-receipts' AND name LIKE '%receipt_t1.jpg'),
       (SELECT count(*)::integer FROM storage.objects WHERE bucket_id = 'trip-receipts' AND name LIKE '%receipt_t4.jpg'),
       (SELECT count(*)::integer FROM storage.objects WHERE bucket_id = 'trip-receipts' AND name LIKE '%receipt_up.jpg'),
       (SELECT receipt_storage_path IS NULL FROM public.trip_expenses WHERE description = 'T1 expense'),
       (SELECT receipt_storage_path IS NOT NULL FROM public.trip_expenses WHERE description = 'T4 expense'),
       (SELECT receipt_storage_path IS NOT NULL FROM public.trip_expenses WHERE description = 'Upcoming expense') $$,
  $$ VALUES (0::integer, 1::integer, 1::integer, true, true, true) $$,
  'purge_expired_receipts purges only completed trips older than 3 and preserves recent and upcoming receipts'
);

-- Setup auth users for RLS testing
DO $$
BEGIN
  INSERT INTO auth.users (id, aud, role, email)
  VALUES
    ('a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'accountant-rls@test.com'),
    ('a0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'member-rls@test.com')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.member_profiles (member_id, auth_user_id, display_name, member_role, account_status)
  VALUES
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'RLS Accountant', 'accountant', 'active'),
    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'RLS Non-Attendee Member', 'member', 'active')
  ON CONFLICT (member_id) DO NOTHING;
END $$;

-- Test 17: Accountant can insert receipt into storage.objects under authenticated role
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
SELECT lives_ok(
  $$ INSERT INTO storage.objects (bucket_id, name)
     VALUES ('trip-receipts', 'trips/11111111-2222-3333-4444-555555555555/accountant_uploaded.png') $$,
  'accountant can insert receipt into storage.objects under RLS'
);

-- Test 18: Non-attending regular member is rejected from inserting receipt into storage.objects
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
SELECT throws_ok(
  $$ INSERT INTO storage.objects (bucket_id, name)
     VALUES ('trip-receipts', 'trips/11111111-2222-3333-4444-555555555555/unauthorized.png') $$,
  '42501',
  NULL,
  'non-attending member cannot insert receipt into storage.objects under RLS'
);

-- Test 19: Authenticated role cannot execute purge_expired_receipts (privilege escalation check)
SELECT throws_ok(
  $$ SELECT * FROM public.purge_expired_receipts() $$,
  '42501',
  NULL,
  'authenticated role cannot execute purge_expired_receipts'
);
RESET ROLE;

-- Test 20: phase2_submit_rsvp permits member with accountant role
DO $$
DECLARE
  v_open_trip_id uuid;
BEGIN
  SELECT id INTO v_open_trip_id FROM public.camping_trips LIMIT 1;
  UPDATE public.camping_trips
  SET starts_on = CURRENT_DATE + 5,
      ends_on = CURRENT_DATE + 7,
      poll_status = 'open',
      poll_deadline_at = now() + interval '3 days',
      club_timezone_snapshot = 'America/Los_Angeles'
  WHERE id = v_open_trip_id;
END $$;

SELECT lives_ok(
  $$ SELECT public.phase2_submit_rsvp(
       'a0000000-0000-0000-0000-000000000001'::uuid,
       (SELECT id FROM public.camping_trips WHERE poll_status = 'open' LIMIT 1),
       'not_coming',
       NULL,
       NULL,
       0,
       gen_random_uuid()
     ) $$,
  'accountant can submit RSVP via phase2_submit_rsvp'
);

-- Test 21: phase2_refresh_open_rule_bundles permits accountant actor
SELECT lives_ok(
  $$ SELECT public.phase2_refresh_open_rule_bundles(
       'b0000000-0000-0000-0000-000000000001'::uuid,
       ARRAY[(SELECT id FROM public.camping_trips WHERE poll_status = 'open' LIMIT 1)]
     ) $$,
  'accountant actor can refresh open rule bundles'
);

SELECT * FROM finish();
ROLLBACK;
