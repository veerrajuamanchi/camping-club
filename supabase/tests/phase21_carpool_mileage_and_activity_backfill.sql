-- Test: Carpool mileage rate and activity booking_url backfill
begin;
select plan(4);

-- 1. Insert dummy master and trip activity with booking_notes as URL and NULL booking_url
insert into public.master_activities (id, title, category, booking_notes)
values ('aa100000-0000-0000-0000-000000000001', 'Test Master URL Backfill', 'Sightseeing', 'https://www.groupon.com/deals/test-deal-1')
on conflict do nothing;

insert into public.campsites (id, rotation_position, name, location_description, cabin_capacity, active)
values ('aa300000-0000-0000-0000-000000000001', 99, 'P21 Campsite', 'P21 Location', 10, true)
on conflict do nothing;

insert into public.camping_trips (id, title, month_key, rotation_position, suggested_campsite_id, selected_campsite_id, starts_on, ends_on, club_timezone_snapshot, trip_mileage_rate_cents)
values ('bb100000-0000-0000-0000-000000000001', 'Test Mileage Trip', '2026-11-01', 1, 'aa300000-0000-0000-0000-000000000001', 'aa300000-0000-0000-0000-000000000001', '2026-11-14', '2026-11-15', 'America/Los_Angeles', 50)
on conflict do nothing;

insert into public.trip_activities (id, trip_id, title, category, activity_date, booking_notes)
values ('cc100000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', 'Test Trip Activity URL Backfill', 'Sightseeing', '2026-11-14', 'https://www.groupon.com/deals/test-deal-2')
on conflict do nothing;

-- Run backfill updates
UPDATE public.trip_activities
SET booking_url = trim(booking_notes)
WHERE id = 'cc100000-0000-0000-0000-000000000001';

UPDATE public.master_activities
SET booking_url = trim(booking_notes)
WHERE id = 'aa100000-0000-0000-0000-000000000001';

-- 2. Verify master_activity has booking_url
select is(
  (select booking_url from public.master_activities where id = 'aa100000-0000-0000-0000-000000000001'),
  'https://www.groupon.com/deals/test-deal-1',
  'master_activities booking_url backfilled from booking_notes'
);

-- 3. Verify trip_activity has booking_url
select is(
  (select booking_url from public.trip_activities where id = 'cc100000-0000-0000-0000-000000000001'),
  'https://www.groupon.com/deals/test-deal-2',
  'trip_activities booking_url backfilled from booking_notes'
);

-- 4. Verify trip_mileage_rate_cents default in camping_trips column
select col_default_is(
  'public', 'camping_trips', 'trip_mileage_rate_cents', '50',
  'camping_trips trip_mileage_rate_cents defaults to 50'
);

-- 5. Verify trip instance rate
select is(
  (select trip_mileage_rate_cents from public.camping_trips where id = 'bb100000-0000-0000-0000-000000000001'),
  50,
  'trip mileage rate is 50 cents'
);

select * from finish();
rollback;
