-- Migration: Set trip_mileage_rate_cents default to 76 cents ($0.76/mile) per Camping Constitution
-- File: 20261025160000_set_trip_mileage_rate_default_76_cents.sql

ALTER TABLE public.camping_trips
  ALTER COLUMN trip_mileage_rate_cents SET DEFAULT 76;

COMMENT ON COLUMN public.camping_trips.trip_mileage_rate_cents IS
  'Reimbursement rate in integer cents per mile (Constitution default: 76 cents / $0.76 per mile for 3+ carpool members). Applies to new trips; historical snapshots are preserved.';
