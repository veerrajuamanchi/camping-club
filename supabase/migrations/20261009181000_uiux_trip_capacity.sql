-- supabase/migrations/20261009181000_uiux_trip_capacity.sql

ALTER TABLE public.camping_trips
  ADD COLUMN IF NOT EXISTS per_cabin_capacity smallint NOT NULL DEFAULT 6
    CHECK (per_cabin_capacity >= 1),
  ADD COLUMN IF NOT EXISTS cabin_count smallint
    CHECK (cabin_count IS NULL OR cabin_count >= 1);

-- Helper: compute effective trip capacity (server-side only, not exposed via RLS)
CREATE OR REPLACE FUNCTION public.trip_effective_capacity(p_trip_id uuid)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN max_capacity IS NOT NULL THEN max_capacity
    WHEN cabin_count IS NOT NULL  THEN (cabin_count * per_cabin_capacity)::smallint
    ELSE NULL
  END
  FROM public.camping_trips
  WHERE id = p_trip_id;
$$;

COMMENT ON COLUMN public.camping_trips.per_cabin_capacity IS
  'Default 6. Multiply by cabin_count to get base capacity. Overridden by max_capacity when set.';
COMMENT ON COLUMN public.camping_trips.cabin_count IS
  'Number of cabins booked. Nullable; capacity is null if neither cabin_count nor max_capacity is set.';
