-- Migration: Cancel website maintenance fee when member is waitlisted or not coming
-- File: 20261031140000_cancel_website_fee_on_waitlist.sql

-- 1. Ensure private.apply_website_maintenance_fee only applies if member is an active 'coming' attendee
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
BEGIN
  -- Verify member is currently confirmed 'coming' on this trip
  SELECT EXISTS (
    SELECT 1 FROM public.trip_rsvps
    WHERE trip_id = p_trip_id AND member_id = p_member_id AND response = 'coming'
  ) INTO v_is_coming;

  IF NOT v_is_coming THEN
    -- If not confirmed coming, remove any unfinalized fee and return
    PERFORM private.cancel_website_maintenance_fee(p_trip_id, p_member_id);
    RETURN;
  END IF;

  -- 1. Identify platform administrator (Veerraju Amanchi)
  SELECT member_id INTO v_admin_id
  FROM public.member_profiles
  WHERE member_role = 'admin' AND account_status = 'active'
  ORDER BY (display_name ILIKE '%Veerraju%') DESC, created_at ASC
  LIMIT 1;

  -- 2. If attendee is the administrator, the fee is completely waived (no self-charge)
  IF v_admin_id IS NULL OR v_admin_id = p_member_id THEN
    RETURN;
  END IF;

  -- 3. Count past distinct trips where member had RSVP 'coming'
  SELECT count(DISTINCT r.trip_id) INTO v_past_count
  FROM public.trip_rsvps r
  JOIN public.camping_trips t ON t.id = r.trip_id
  WHERE r.member_id = p_member_id
    AND r.response = 'coming'
    AND t.id <> p_trip_id
    AND t.deleted_at IS NULL;

  -- 4. Set fee: $5.00 (500 cents) for 1st event, $2.50 (250 cents) for subsequent events
  IF v_past_count = 0 THEN
    v_fee_cents := 500;
    v_desc := 'Website Build & Maintenance Fee ($5.00 - First Event)';
  ELSE
    v_fee_cents := 250;
    v_desc := 'Website Build & Maintenance Fee ($2.50 - Returning Member)';
  END IF;

  -- 5. Upsert expense and allocation on this trip
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

-- 2. Update trip_api_join_waitlist to cancel any existing website fee for waitlisted member
CREATE OR REPLACE FUNCTION public.trip_api_join_waitlist(
  p_trip_id    uuid,
  p_member_id  uuid,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_position int;
  v_new_position      int;
  v_entry_id          uuid;
BEGIN
  -- Cancel any unfinalized website fee since member is waitlisted
  PERFORM private.cancel_website_maintenance_fee(p_trip_id, p_member_id);

  -- Check if member already on waitlist
  SELECT position INTO v_existing_position
  FROM public.trip_waitlist_entries
  WHERE trip_id = p_trip_id AND member_id = p_member_id AND status = 'waiting';

  IF FOUND THEN
    RETURN jsonb_build_object('waitlisted', true, 'position', v_existing_position);
  END IF;

  -- Get next position
  v_new_position := public.trip_waitlist_next_position(p_trip_id);

  INSERT INTO public.trip_waitlist_entries (trip_id, member_id, position)
  VALUES (p_trip_id, p_member_id, v_new_position)
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object('waitlisted', true, 'position', v_new_position, 'entryId', v_entry_id);
END;
$$;

-- 3. One-off cleanup of any website fees assigned to members not currently confirmed 'coming'
DELETE FROM public.trip_expenses
WHERE expense_type = 'website_maintenance'
  AND is_locked = FALSE
  AND id IN (
    SELECT e.id
    FROM public.trip_expenses e
    JOIN public.trip_expense_allocations a ON a.expense_id = e.id
    LEFT JOIN public.trip_rsvps r ON r.trip_id = e.trip_id AND r.member_id = a.member_id AND r.response = 'coming'
    WHERE e.expense_type = 'website_maintenance'
      AND r.id IS NULL
  );
