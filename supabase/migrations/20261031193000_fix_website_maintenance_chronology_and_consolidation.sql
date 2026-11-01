-- Migration: Fix website maintenance fee chronology and consolidate fees
-- File: 20261031193000_fix_website_maintenance_chronology_and_consolidation.sql

CREATE OR REPLACE FUNCTION private.apply_website_maintenance_fee(
  p_trip_id UUID,
  p_member_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id UUID;
  v_past_count INTEGER := 0;
  v_fee_cents INTEGER;
  v_desc TEXT;
  v_existing_id UUID;
  v_new_id UUID;
  v_is_coming BOOLEAN;
  v_is_waitlisted BOOLEAN;
  v_current_starts_on DATE;
  v_current_month_key DATE;
BEGIN
  -- 1. Check if member is on the waitlist for this trip
  SELECT EXISTS (
    SELECT 1 FROM public.trip_waitlist_entries
    WHERE trip_id = p_trip_id AND member_id = p_member_id
  ) INTO v_is_waitlisted;

  IF v_is_waitlisted THEN
    -- Waitlisted members are not confirmed attendees; remove any unfinalized fee
    PERFORM private.cancel_website_maintenance_fee(p_trip_id, p_member_id);
    RETURN;
  END IF;

  -- 2. Verify member is currently confirmed 'coming' on this trip
  SELECT EXISTS (
    SELECT 1 FROM public.trip_rsvps
    WHERE trip_id = p_trip_id AND member_id = p_member_id AND response = 'coming'
  ) INTO v_is_coming;

  IF NOT v_is_coming THEN
    PERFORM private.cancel_website_maintenance_fee(p_trip_id, p_member_id);
    RETURN;
  END IF;

  -- 3. Identify platform administrator (Veerraju Amanchi)
  SELECT member_id INTO v_admin_id
  FROM public.member_profiles
  WHERE member_role = 'admin' AND account_status = 'active'
  ORDER BY (display_name ILIKE '%Veerraju%') DESC, created_at ASC
  LIMIT 1;

  -- 4. If attendee is the administrator, the fee is completely waived (no self-charge)
  IF v_admin_id IS NULL OR v_admin_id = p_member_id THEN
    RETURN;
  END IF;

  -- 5. Retrieve current trip starts_on and month_key
  SELECT starts_on, month_key INTO v_current_starts_on, v_current_month_key
  FROM public.camping_trips
  WHERE id = p_trip_id;

  -- 6. Count distinct PAST trips where member attended (strictly prior to current trip date)
  -- A trip is in the past if starts_on < current starts_on (or month_key < current month_key)
  SELECT count(DISTINCT r.trip_id) INTO v_past_count
  FROM public.trip_rsvps r
  JOIN public.camping_trips t ON t.id = r.trip_id
  WHERE r.member_id = p_member_id
    AND r.response = 'coming'
    AND t.id <> p_trip_id
    AND t.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.trip_waitlist_entries w
      WHERE w.trip_id = t.id AND w.member_id = p_member_id
    )
    AND (
      (v_current_starts_on IS NOT NULL AND t.starts_on IS NOT NULL AND t.starts_on < v_current_starts_on)
      OR (v_current_starts_on IS NULL AND t.month_key < v_current_month_key)
      OR (v_current_starts_on IS NOT NULL AND t.starts_on IS NULL AND t.month_key < to_char(v_current_starts_on, 'YYYY-MM-01')::DATE)
    );

  -- 7. Set fee: $5.00 (500 cents) for 1st event, $2.50 (250 cents) for subsequent events
  IF v_past_count = 0 THEN
    v_fee_cents := 500;
    v_desc := 'Website Build & Maintenance Fee ($5.00 - First Event)';
  ELSE
    v_fee_cents := 250;
    v_desc := 'Website Build & Maintenance Fee ($2.50 - Returning Member)';
  END IF;

  -- 8. Upsert expense and allocation on this trip
  SELECT e.id INTO v_existing_id
  FROM public.trip_expenses e
  JOIN public.trip_expense_allocations a ON a.expense_id = e.id
  WHERE e.trip_id = p_trip_id
    AND e.expense_type = 'website_maintenance'
    AND a.member_id = p_member_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.trip_expenses
    SET amount_cents = v_fee_cents,
        payer_member_id = v_admin_id,
        description = v_desc,
        updated_at = now()
    WHERE id = v_existing_id;

    UPDATE public.trip_expense_allocations
    SET allocated_cents = v_fee_cents
    WHERE expense_id = v_existing_id AND member_id = p_member_id;
  ELSE
    v_new_id := gen_random_uuid();
    INSERT INTO public.trip_expenses (
      id, trip_id, expense_type, payer_member_id, amount_cents, description, split_mode, created_at, updated_at
    ) VALUES (
      v_new_id, p_trip_id, 'website_maintenance', v_admin_id, v_fee_cents, v_desc, 'custom', now(), now()
    );

    INSERT INTO public.trip_expense_allocations (
      id, expense_id, member_id, allocated_cents, created_at
    ) VALUES (
      gen_random_uuid(), v_new_id, p_member_id, v_fee_cents, now()
    );
  END IF;
END;
$$;

-- Clean up any waitlisted fees immediately
DELETE FROM public.trip_expenses
WHERE expense_type = 'website_maintenance'
  AND is_locked = FALSE
  AND id IN (
    SELECT a.expense_id
    FROM public.trip_expense_allocations a
    JOIN public.trip_waitlist_entries w ON w.trip_id = (SELECT e.trip_id FROM public.trip_expenses e WHERE e.id = a.expense_id)
      AND w.member_id = a.member_id
  );

-- Recalculate all active confirmed attendees across all trips
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT rsvp.trip_id, rsvp.member_id
    FROM public.trip_rsvps rsvp
    JOIN public.camping_trips t ON t.id = rsvp.trip_id
    WHERE rsvp.response = 'coming'
      AND t.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.trip_waitlist_entries w
        WHERE w.trip_id = rsvp.trip_id AND w.member_id = rsvp.member_id
      )
  LOOP
    PERFORM private.apply_website_maintenance_fee(r.trip_id, r.member_id);
  END LOOP;
END;
$$;
