begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- 1. Table structure: master_gear
select has_table('public', 'master_gear', 'master_gear table exists');
select has_column('public', 'master_gear', 'id', 'has id column');
select has_column('public', 'master_gear', 'name', 'has name column');
select has_column('public', 'master_gear', 'gear_type', 'has gear_type column');
select has_column('public', 'master_gear', 'category', 'has category column');
select has_column('public', 'master_gear', 'is_critical', 'has is_critical column');
select has_column('public', 'master_gear', 'active', 'has active column');

-- 2. Table structure: master_food_groceries
select has_table('public', 'master_food_groceries', 'master_food_groceries table exists');
select has_column('public', 'master_food_groceries', 'id', 'has id column');
select has_column('public', 'master_food_groceries', 'name', 'has name column');
select has_column('public', 'master_food_groceries', 'category', 'has category column');
select has_column('public', 'master_food_groceries', 'active', 'has active column');

-- 3. Columns on trip_commitments, trip_rsvps, camping_trips
select has_column('public', 'trip_commitments', 'master_gear_id', 'trip_commitments has master_gear_id');
select has_column('public', 'trip_commitments', 'master_food_id', 'trip_commitments has master_food_id');
select has_column('public', 'trip_commitments', 'commitment_type', 'trip_commitments has commitment_type');
select has_column('public', 'trip_commitments', 'is_active', 'trip_commitments has is_active');
select has_column('public', 'trip_rsvps', 'deposit_status', 'trip_rsvps has deposit_status');
select has_column('public', 'camping_trips', 'rules_markdown', 'camping_trips has rules_markdown');

-- 4. Seed data verification
select ok((select count(*) >= 16 from public.master_gear), 'seeded default master gear exist');
select ok((select count(*) >= 10 from public.master_food_groceries), 'seeded default master food exist');

-- 5. RLS verification
select ok((select relrowsecurity from pg_class where oid='public.master_gear'::regclass), 'master_gear RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.master_food_groceries'::regclass), 'master_food_groceries RLS enabled');

select * from finish();
rollback;
