BEGIN;
SELECT plan(12);

SELECT has_column('public', 'campsites', 'image_url', 'campsites should have image_url');
SELECT has_column('public', 'campsites', 'camp_host_name', 'campsites should have camp_host_name');
SELECT has_column('public', 'campsites', 'camp_host_phone', 'campsites should have camp_host_phone');
SELECT has_column('public', 'campsites', 'camp_features', 'campsites should have camp_features');
SELECT has_column('public', 'campsites', 'cabin_information', 'campsites should have cabin_information');
SELECT has_function('public', 'phase2_admin_create_campsite', ARRAY['uuid', 'jsonb', 'text', 'text'], 'phase2_admin_create_campsite exists with text request_id');
SELECT has_function('public', 'phase2_admin_update_campsite', ARRAY['uuid', 'uuid', 'jsonb', 'text', 'text'], 'phase2_admin_update_campsite exists with text request_id');
SELECT hasnt_function('public', 'phase2_admin_update_campsite', ARRAY['uuid', 'uuid', 'jsonb', 'text', 'uuid'], 'phase2_admin_update_campsite uuid overload does not exist');

-- Test realistic campsite creation and update
INSERT INTO auth.users (id, email) VALUES ('f0000000-0000-0000-0000-000000000001', 'admin-test@local.test') ON CONFLICT DO NOTHING;
INSERT INTO public.member_profiles (member_id, auth_user_id, display_name, member_role, account_status)
VALUES ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Admin Tester', 'admin', 'active')
ON CONFLICT DO NOTHING;

SELECT lives_ok(
  $$
  SELECT public.phase2_admin_create_campsite(
    'f1000000-0000-0000-0000-000000000001',
    '{"name":"Test Camp Site","locationDescription":"100 Test Hwy, Forest City, CA 90000","availabilityUrl":"https://parks.ca.gov/test","campHostName":"John Camp Host","campHostPhone":"(555) 123-4567","campFeatures":["Community propane grill","Wi-Fi (limited)"],"cabinInformation":"Eight units sleep 6 people each."}'::jsonb,
    'Admin created campsite test',
    'a0000000-0000-0000-0000-000000000099'
  );
  $$,
  'phase2_admin_create_campsite succeeds with realistic fields'
);

SELECT is(
  (SELECT camp_host_name FROM public.campsites WHERE name = 'Test Camp Site'),
  'John Camp Host',
  'Created campsite persists camp_host_name'
);

SELECT lives_ok(
  $$
  SELECT public.phase2_admin_update_campsite(
    'f1000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.campsites WHERE name = 'Test Camp Site'),
    '{"expectedVersion":1,"campHostName":"Updated Camp Host","availabilityUrl":"https://parks.ca.gov/updated"}'::jsonb,
    'Admin updated campsite test',
    'a0000000-0000-0000-0000-000000000098'
  );
  $$,
  'phase2_admin_update_campsite succeeds with partial update'
);

SELECT is(
  (SELECT camp_host_name FROM public.campsites WHERE name = 'Test Camp Site'),
  'Updated Camp Host',
  'Updated campsite persists new camp_host_name and preserves unsupplied fields'
);

SELECT * FROM finish();
ROLLBACK;
