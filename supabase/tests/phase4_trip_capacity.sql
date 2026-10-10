begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- 1. Schema checks
select has_column('public', 'camping_trips', 'per_cabin_capacity', 'camping_trips has per_cabin_capacity column');
select has_column('public', 'camping_trips', 'cabin_count', 'camping_trips has cabin_count column');
select col_default_is('public', 'camping_trips', 'per_cabin_capacity', '6'::text, 'per_cabin_capacity defaults to 6');
select has_function('public', 'trip_effective_capacity', ARRAY['uuid'], 'trip_effective_capacity function exists');

-- 2. Initial state of generated trips
select is(
  (select count(*)::integer from public.camping_trips where per_cabin_capacity <> 6),
  0,
  'all existing trips have default per_cabin_capacity of 6'
);
select is(
  (select count(*)::integer from public.camping_trips where cabin_count is not null),
  0,
  'all existing trips have NULL cabin_count initially'
);

-- 3. Behavior tests using a fixture trip
create temporary table fixture_target as
select id as trip_id from public.camping_trips order by month_key limit 1;

-- Case A: Both max_capacity and cabin_count are NULL -> returns NULL
update public.camping_trips
set max_capacity = null, cabin_count = null, per_cabin_capacity = 6
where id = (select trip_id from fixture_target);

select is(
  public.trip_effective_capacity((select trip_id from fixture_target)),
  null::smallint,
  'trip_effective_capacity returns NULL when max_capacity and cabin_count are NULL'
);

-- Case B: max_capacity is NULL, cabin_count is set with default per_cabin_capacity (6) -> 3 * 6 = 18
update public.camping_trips
set max_capacity = null, cabin_count = 3, per_cabin_capacity = 6
where id = (select trip_id from fixture_target);

select is(
  public.trip_effective_capacity((select trip_id from fixture_target)),
  18::smallint,
  'trip_effective_capacity computes cabin_count * per_cabin_capacity (3 * 6 = 18)'
);

-- Case C: max_capacity is NULL, cabin_count is set with custom per_cabin_capacity (8) -> 4 * 8 = 32
update public.camping_trips
set max_capacity = null, cabin_count = 4, per_cabin_capacity = 8
where id = (select trip_id from fixture_target);

select is(
  public.trip_effective_capacity((select trip_id from fixture_target)),
  32::smallint,
  'trip_effective_capacity computes cabin_count * custom per_cabin_capacity (4 * 8 = 32)'
);

-- Case D: max_capacity is set, cabin_count is NULL -> returns max_capacity (15)
update public.camping_trips
set max_capacity = 15, cabin_count = null, per_cabin_capacity = 6
where id = (select trip_id from fixture_target);

select is(
  public.trip_effective_capacity((select trip_id from fixture_target)),
  15::smallint,
  'trip_effective_capacity returns max_capacity when cabin_count is NULL'
);

-- Case E: max_capacity override: both max_capacity and cabin_count are set -> returns max_capacity
update public.camping_trips
set max_capacity = 20, cabin_count = 4, per_cabin_capacity = 6
where id = (select trip_id from fixture_target);

select is(
  public.trip_effective_capacity((select trip_id from fixture_target)),
  20::smallint,
  'trip_effective_capacity prioritizes max_capacity override over cabin_count * per_cabin_capacity'
);

-- Case F: Non-existent trip returns NULL
select is(
  public.trip_effective_capacity('00000000-0000-0000-0000-000000000000'::uuid),
  null::smallint,
  'trip_effective_capacity returns NULL for non-existent trip id'
);

-- 4. Constraint checks
select throws_ok(
  format(
    $$update public.camping_trips set per_cabin_capacity = 0 where id = '%s'$$,
    (select trip_id from fixture_target)
  ),
  '23514',
  null,
  'check constraint rejects per_cabin_capacity < 1'
);

select throws_ok(
  format(
    $$update public.camping_trips set cabin_count = 0 where id = '%s'$$,
    (select trip_id from fixture_target)
  ),
  '23514',
  null,
  'check constraint rejects cabin_count < 1'
);

select lives_ok(
  format(
    $$update public.camping_trips set cabin_count = null where id = '%s'$$,
    (select trip_id from fixture_target)
  ),
  'check constraint permits NULL cabin_count'
);

select * from finish();
rollback;
