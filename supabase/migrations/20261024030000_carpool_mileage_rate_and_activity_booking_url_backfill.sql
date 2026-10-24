-- Migration: Backfill booking_url from booking_notes if formatted as URL, and ensure default carpool mileage rate is 50 cents
-- File: 20261024030000_carpool_mileage_rate_and_activity_booking_url_backfill.sql

-- 1. Backfill trip_activities booking_url from booking_notes if it looks like a URL
UPDATE public.trip_activities
SET booking_url = trim(booking_notes)
WHERE (booking_url IS NULL OR trim(booking_url) = '')
  AND booking_notes IS NOT NULL
  AND (trim(booking_notes) ILIKE 'http://%' OR trim(booking_notes) ILIKE 'https://%');

-- 2. Backfill master_activities booking_url from booking_notes if it looks like a URL
UPDATE public.master_activities
SET booking_url = trim(booking_notes)
WHERE (booking_url IS NULL OR trim(booking_url) = '')
  AND booking_notes IS NOT NULL
  AND (trim(booking_notes) ILIKE 'http://%' OR trim(booking_notes) ILIKE 'https://%');
