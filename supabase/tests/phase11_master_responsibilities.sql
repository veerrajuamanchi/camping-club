begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- 1. Table structure
select has_table('public', 'master_responsibilities', 'master_responsibilities table exists');
select has_column('public', 'master_responsibilities', 'id', 'has id column');
select has_column('public', 'master_responsibilities', 'title', 'has title column');
select has_column('public', 'master_responsibilities', 'description', 'has description column');
select has_column('public', 'master_responsibilities', 'category', 'has category column');
select has_column('public', 'master_responsibilities', 'default_capacity', 'has default_capacity column');
select has_column('public', 'master_responsibilities', 'workload_weight', 'has workload_weight column');
select has_column('public', 'master_responsibilities', 'active', 'has active column');

-- 2. Camping trips policy additions
select has_column('public', 'camping_trips', 'deposit_amount_cents', 'camping_trips has deposit_amount_cents');
select has_column('public', 'camping_trips', 'contractual_refund_deadline', 'camping_trips has contractual_refund_deadline');
select has_column('public', 'camping_trips', 'cancellation_safety_buffer_days', 'camping_trips has cancellation_safety_buffer_days');
select has_column('public', 'camping_trips', 'task_quota_target', 'camping_trips has task_quota_target');

-- 3. Seed data verification
select ok((select count(*) >= 8 from public.master_responsibilities), 'seeded default master responsibilities exist');

-- 4. RLS enabled
select ok((select relrowsecurity from pg_class where oid='public.master_responsibilities'::regclass), 'master_responsibilities RLS enabled');

-- 5. Functions exist
select has_function('public', 'phase3_admin_create_master_responsibility', ARRAY['text', 'text', 'text', 'integer', 'numeric', 'uuid'], 'phase3_admin_create_master_responsibility exists');
select has_function('public', 'phase3_admin_update_master_responsibility', ARRAY['uuid', 'text', 'text', 'text', 'integer', 'numeric', 'boolean', 'uuid'], 'phase3_admin_update_master_responsibility exists');

select * from finish();
rollback;
