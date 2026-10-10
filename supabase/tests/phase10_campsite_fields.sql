BEGIN;
SELECT plan(6);

SELECT has_column('public', 'campsites', 'image_url', 'campsites should have image_url');
SELECT has_column('public', 'campsites', 'camp_host_name', 'campsites should have camp_host_name');
SELECT has_column('public', 'campsites', 'camp_host_phone', 'campsites should have camp_host_phone');
SELECT has_column('public', 'campsites', 'camp_features', 'campsites should have camp_features');
SELECT has_column('public', 'campsites', 'cabin_information', 'campsites should have cabin_information');
SELECT has_function('public', 'phase2_admin_create_campsite', ARRAY['uuid', 'jsonb', 'text', 'text'], 'phase2_admin_create_campsite exists');

SELECT * FROM finish();
ROLLBACK;
