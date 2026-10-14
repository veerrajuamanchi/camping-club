BEGIN;
SELECT plan(15);

-- 1. Schema checks
SELECT has_column('public', 'camping_trips', 'title', 'camping_trips has title');
SELECT has_column('public', 'camping_trips', 'event_status', 'camping_trips has event_status');
SELECT has_column('public', 'camping_trips', 'camping_type', 'camping_trips has camping_type');
SELECT has_column('public', 'camping_trips', 'deleted_at', 'camping_trips has deleted_at');
SELECT has_column('public', 'camping_trips', 'is_auto_scheduled', 'camping_trips has is_auto_scheduled');

SELECT has_function('public', 'phase2_admin_delete_trip', ARRAY['uuid', 'uuid', 'text', 'uuid'], 'phase2_admin_delete_trip exists');
SELECT has_function('public', 'phase2_admin_create_custom_trip', ARRAY['uuid', 'text', 'date', 'date', 'uuid', 'text', 'integer', 'integer', 'text', 'text', 'integer', 'integer', 'date', 'time without time zone', 'text', 'text', 'uuid'], 'phase2_admin_create_custom_trip exists');

-- Test setup: create test users and active campsite
INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'admin-custom@local.test'),
  ('e0000000-0000-0000-0000-000000000002', 'member-custom@local.test')
ON CONFLICT DO NOTHING;

INSERT INTO public.member_profiles (member_id, auth_user_id, display_name, member_role, account_status) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Admin Trip Tester', 'admin', 'active'),
  ('e1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'Member Trip Tester', 'member', 'active')
ON CONFLICT DO NOTHING;

-- Configure club timezone for testing
UPDATE public.club_configuration SET club_timezone = 'America/Los_Angeles' WHERE singleton;

-- Find an active campsite
DO $$
DECLARE
  v_site_id uuid;
  v_res jsonb;
  v_created_trip_id uuid;
BEGIN
  SELECT id INTO v_site_id FROM public.campsites WHERE active LIMIT 1;

  -- Test 2. phase2_admin_create_custom_trip
  v_res := public.phase2_admin_create_custom_trip(
    'e1000000-0000-0000-0000-000000000001',
    'Yosemite High Sierra Camp',
    '2027-08-10'::date,
    '2027-08-15'::date,
    v_site_id,
    'tent',
    4,
    6,
    'tentative',
    'pending',
    4,
    24,
    '2027-07-01'::date,
    '18:00:00'::time,
    'Bring warm sleeping bags',
    'Custom trip test creation',
    'e2000000-0000-0000-0000-000000000001'::uuid
  );

  v_created_trip_id := (v_res->>'tripId')::uuid;

  PERFORM set_config('test.created_trip_id', v_created_trip_id::text, true);
  PERFORM set_config('test.active_site_id', v_site_id::text, true);
END $$;

SELECT is(
  (SELECT title FROM public.camping_trips WHERE id = current_setting('test.created_trip_id')::uuid),
  'Yosemite High Sierra Camp',
  'Custom trip title is saved correctly'
);

SELECT is(
  (SELECT camping_type FROM public.camping_trips WHERE id = current_setting('test.created_trip_id')::uuid),
  'tent',
  'Custom trip camping_type is saved as tent'
);

SELECT is(
  (SELECT event_status FROM public.camping_trips WHERE id = current_setting('test.created_trip_id')::uuid),
  'tentative',
  'Custom trip event_status is saved as tentative'
);

-- Test 3: ordinary member cannot create custom trip
SELECT throws_ok(
  $$
  SELECT public.phase2_admin_create_custom_trip(
    'e1000000-0000-0000-0000-000000000002',
    'Unauthorized Trip',
    '2027-09-10'::date,
    '2027-09-15'::date,
    current_setting('test.active_site_id')::uuid,
    'cabin',
    2,
    4,
    'tentative',
    'pending',
    4,
    8,
    NULL,
    NULL,
    NULL,
    'Unauthorized attempt',
    'e2000000-0000-0000-0000-000000000002'::uuid
  );
  $$,
  '42501',
  NULL,
  'Ordinary member cannot create custom trips'
);

-- Test 4: date validation: end date cannot precede start date
SELECT throws_ok(
  $$
  SELECT public.phase2_admin_create_custom_trip(
    'e1000000-0000-0000-0000-000000000001',
    'Invalid Dates Trip',
    '2027-09-15'::date,
    '2027-09-10'::date,
    current_setting('test.active_site_id')::uuid,
    'cabin',
    2,
    4,
    'tentative',
    'pending',
    4,
    8,
    NULL,
    NULL,
    NULL,
    'Invalid date attempt',
    'e2000000-0000-0000-0000-000000000003'::uuid
  );
  $$,
  'invalid trip dates: end date must not precede start date',
  'End date preceding start date is rejected'
);

-- Test 5: Soft delete trip
SELECT lives_ok(
  $$
  SELECT public.phase2_admin_delete_trip(
    'e1000000-0000-0000-0000-000000000001',
    current_setting('test.created_trip_id')::uuid,
    'Admin deleted custom trip for testing',
    'e2000000-0000-0000-0000-000000000004'::uuid
  );
  $$,
  'Admin can soft-delete a trip'
);

SELECT ok(
  (SELECT deleted_at IS NOT NULL FROM public.camping_trips WHERE id = current_setting('test.created_trip_id')::uuid),
  'Deleted trip has deleted_at populated'
);

-- Test 6: Deleting an already deleted trip throws
SELECT throws_ok(
  $$
  SELECT public.phase2_admin_delete_trip(
    'e1000000-0000-0000-0000-000000000001',
    current_setting('test.created_trip_id')::uuid,
    'Admin deleted custom trip again',
    'e2000000-0000-0000-0000-000000000005'::uuid
  );
  $$,
  'trip not found or already deleted',
  'Attempting to delete already deleted trip fails'
);

SELECT * FROM finish();
ROLLBACK;
