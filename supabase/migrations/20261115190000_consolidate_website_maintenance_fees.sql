-- Migration: Consolidate website maintenance fees into single canonical trip expense rows
-- File: 20261115190000_consolidate_website_maintenance_fees.sql

CREATE OR REPLACE FUNCTION private.sync_trip_website_maintenance_fees(p_trip_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_current_starts_on DATE;
  v_current_month_key DATE;
  v_member_rec RECORD;
  v_past_count INTEGER;
  v_first_time_members UUID[] := ARRAY[]::UUID[];
  v_returning_members UUID[] := ARRAY[]::UUID[];
  v_first_expense_id UUID;
  v_returning_expense_id UUID;
  v_first_total_cents INTEGER;
  v_returning_total_cents INTEGER;
  v_mem_id UUID;
BEGIN
  -- 1. Identify platform administrator (Veerraju Amanchi)
  SELECT member_id INTO v_admin_id
  FROM public.member_profiles
  WHERE member_role = 'admin' AND account_status = 'active'
  ORDER BY (display_name ILIKE '%Veerraju%') DESC, created_at ASC
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RETURN;
  END IF;

  -- 2. Retrieve current trip starts_on and month_key
  SELECT starts_on, month_key INTO v_current_starts_on, v_current_month_key
  FROM public.camping_trips
  WHERE id = p_trip_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 3. Loop through all confirmed 'coming' attendees (excluding administrator, who is waived)
  FOR v_member_rec IN
    SELECT r.member_id
    FROM public.trip_rsvps r
    WHERE r.trip_id = p_trip_id
      AND r.response = 'coming'
      AND r.member_id <> v_admin_id
      AND NOT EXISTS (
        SELECT 1 FROM public.trip_waitlist_entries w
        WHERE w.trip_id = p_trip_id AND w.member_id = r.member_id AND w.status = 'waiting'
      )
  LOOP
    -- Count distinct past trips where member had RSVP 'coming' strictly prior to current trip
    SELECT count(DISTINCT r.trip_id) INTO v_past_count
    FROM public.trip_rsvps r
    JOIN public.camping_trips t ON t.id = r.trip_id
    WHERE r.member_id = v_member_rec.member_id
      AND r.response = 'coming'
      AND t.id <> p_trip_id
      AND t.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.trip_waitlist_entries w
        WHERE w.trip_id = t.id AND w.member_id = v_member_rec.member_id AND w.status = 'waiting'
      )
      AND (
        (v_current_starts_on IS NOT NULL AND t.starts_on IS NOT NULL AND t.starts_on < v_current_starts_on)
        OR (v_current_starts_on IS NULL AND t.month_key < v_current_month_key)
        OR (v_current_starts_on IS NOT NULL AND t.starts_on IS NULL AND t.month_key < to_char(v_current_starts_on, 'YYYY-MM-01')::DATE)
      );

    IF v_past_count = 0 THEN
      v_first_time_members := array_append(v_first_time_members, v_member_rec.member_id);
    ELSE
      v_returning_members := array_append(v_returning_members, v_member_rec.member_id);
    END IF;
  END LOOP;

  -- 4. Process Group 1: First-Time Event Fee ($5.00)
  IF cardinality(v_first_time_members) > 0 THEN
    v_first_total_cents := cardinality(v_first_time_members) * 500;

    -- Look for existing First Event expense row
    SELECT id INTO v_first_expense_id
    FROM public.trip_expenses
    WHERE trip_id = p_trip_id
      AND expense_type = 'website_maintenance'
      AND description ILIKE '%First Event%'
    LIMIT 1;

    IF v_first_expense_id IS NOT NULL THEN
      UPDATE public.trip_expenses
      SET amount_cents = v_first_total_cents,
          payer_member_id = v_admin_id,
          description = 'Website Build & Maintenance Fee ($5.00 - First Event)',
          split_mode = 'custom',
          updated_at = now()
      WHERE id = v_first_expense_id;
    ELSE
      v_first_expense_id := gen_random_uuid();
      INSERT INTO public.trip_expenses (
        id, trip_id, expense_type, payer_member_id, amount_cents, description, split_mode, created_at, updated_at
      ) VALUES (
        v_first_expense_id, p_trip_id, 'website_maintenance', v_admin_id, v_first_total_cents, 'Website Build & Maintenance Fee ($5.00 - First Event)', 'custom', now(), now()
      );
    END IF;

    -- Sync allocations: remove members no longer in first-time list
    DELETE FROM public.trip_expense_allocations
    WHERE expense_id = v_first_expense_id
      AND NOT (member_id = ANY(v_first_time_members));

    -- Upsert allocations for each first-time member
    FOREACH v_mem_id IN ARRAY v_first_time_members LOOP
      IF EXISTS (
        SELECT 1 FROM public.trip_expense_allocations
        WHERE expense_id = v_first_expense_id AND member_id = v_mem_id
      ) THEN
        UPDATE public.trip_expense_allocations
        SET allocated_cents = 500
        WHERE expense_id = v_first_expense_id AND member_id = v_mem_id;
      ELSE
        INSERT INTO public.trip_expense_allocations (
          id, expense_id, member_id, allocated_cents, created_at
        ) VALUES (
          gen_random_uuid(), v_first_expense_id, v_mem_id, 500, now()
        );
      END IF;
    END LOOP;
  ELSE
    -- No first-time members: delete First Event expense if unlocked
    SELECT id INTO v_first_expense_id
    FROM public.trip_expenses
    WHERE trip_id = p_trip_id
      AND expense_type = 'website_maintenance'
      AND description ILIKE '%First Event%'
      AND is_locked = FALSE
    LIMIT 1;

    IF v_first_expense_id IS NOT NULL THEN
      DELETE FROM public.trip_expense_allocations WHERE expense_id = v_first_expense_id;
      DELETE FROM public.trip_expenses WHERE id = v_first_expense_id;
    END IF;
  END IF;

  -- 5. Process Group 2: Subsequent Events Fee ($2.50)
  IF cardinality(v_returning_members) > 0 THEN
    v_returning_total_cents := cardinality(v_returning_members) * 250;

    -- Look for existing Subsequent Events / Returning Member expense row
    SELECT id INTO v_returning_expense_id
    FROM public.trip_expenses
    WHERE trip_id = p_trip_id
      AND expense_type = 'website_maintenance'
      AND (description ILIKE '%Subsequent%' OR description ILIKE '%Returning%' OR description ILIKE '%2.50%')
    LIMIT 1;

    IF v_returning_expense_id IS NOT NULL THEN
      UPDATE public.trip_expenses
      SET amount_cents = v_returning_total_cents,
          payer_member_id = v_admin_id,
          description = 'Website Build & Maintenance Fee ($2.50 - Subsequent Events)',
          split_mode = 'custom',
          updated_at = now()
      WHERE id = v_returning_expense_id;
    ELSE
      v_returning_expense_id := gen_random_uuid();
      INSERT INTO public.trip_expenses (
        id, trip_id, expense_type, payer_member_id, amount_cents, description, split_mode, created_at, updated_at
      ) VALUES (
        v_returning_expense_id, p_trip_id, 'website_maintenance', v_admin_id, v_returning_total_cents, 'Website Build & Maintenance Fee ($2.50 - Subsequent Events)', 'custom', now(), now()
      );
    END IF;

    -- Sync allocations: remove members no longer in returning list
    DELETE FROM public.trip_expense_allocations
    WHERE expense_id = v_returning_expense_id
      AND NOT (member_id = ANY(v_returning_members));

    -- Upsert allocations for each returning member
    FOREACH v_mem_id IN ARRAY v_returning_members LOOP
      IF EXISTS (
        SELECT 1 FROM public.trip_expense_allocations
        WHERE expense_id = v_returning_expense_id AND member_id = v_mem_id
      ) THEN
        UPDATE public.trip_expense_allocations
        SET allocated_cents = 250
        WHERE expense_id = v_returning_expense_id AND member_id = v_mem_id;
      ELSE
        INSERT INTO public.trip_expense_allocations (
          id, expense_id, member_id, allocated_cents, created_at
        ) VALUES (
          gen_random_uuid(), v_returning_expense_id, v_mem_id, 250, now()
        );
      END IF;
    END LOOP;
  ELSE
    -- No returning members: delete Subsequent Events expense if unlocked
    SELECT id INTO v_returning_expense_id
    FROM public.trip_expenses
    WHERE trip_id = p_trip_id
      AND expense_type = 'website_maintenance'
      AND (description ILIKE '%Subsequent%' OR description ILIKE '%Returning%' OR description ILIKE '%2.50%')
      AND is_locked = FALSE
    LIMIT 1;

    IF v_returning_expense_id IS NOT NULL THEN
      DELETE FROM public.trip_expense_allocations WHERE expense_id = v_returning_expense_id;
      DELETE FROM public.trip_expenses WHERE id = v_returning_expense_id;
    END IF;
  END IF;

  -- 6. Clean up any leftover per-person fragmented expenses
  DELETE FROM public.trip_expense_allocations
  WHERE expense_id IN (
    SELECT id FROM public.trip_expenses
    WHERE trip_id = p_trip_id
      AND expense_type = 'website_maintenance'
      AND is_locked = FALSE
      AND id NOT IN (COALESCE(v_first_expense_id, '00000000-0000-0000-0000-000000000000'::UUID),
                     COALESCE(v_returning_expense_id, '00000000-0000-0000-0000-000000000000'::UUID))
  );

  DELETE FROM public.trip_expenses
  WHERE trip_id = p_trip_id
    AND expense_type = 'website_maintenance'
    AND is_locked = FALSE
    AND id NOT IN (COALESCE(v_first_expense_id, '00000000-0000-0000-0000-000000000000'::UUID),
                   COALESCE(v_returning_expense_id, '00000000-0000-0000-0000-000000000000'::UUID));
END;
$$;

-- 2. Update apply_website_maintenance_fee and cancel_website_maintenance_fee to call the synchronizer
CREATE OR REPLACE FUNCTION private.apply_website_maintenance_fee(
  p_trip_id UUID,
  p_member_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM private.sync_trip_website_maintenance_fees(p_trip_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.cancel_website_maintenance_fee(
  p_trip_id UUID,
  p_member_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM private.sync_trip_website_maintenance_fees(p_trip_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_trip_website_maintenance_fees(p_trip_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM private.sync_trip_website_maintenance_fees(p_trip_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_trip_website_maintenance_fees(UUID) TO service_role;

-- 3. Execute consolidation for all existing trips now
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM public.camping_trips WHERE deleted_at IS NULL LOOP
    PERFORM private.sync_trip_website_maintenance_fees(t.id);
  END LOOP;
END;
$$;
