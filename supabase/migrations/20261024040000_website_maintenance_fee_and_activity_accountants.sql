-- Migration: Website Build and Maintenance Fee ($5.00 first event, $2.50 subsequent, credited to Veerraju Amanchi, waived for Veerraju)
-- and Accountant Role extension for Activity Vouchers.
-- File: 20261024040000_website_maintenance_fee_and_activity_accountants.sql

-- 1. Update trip_expenses check constraint to allow 'website_maintenance'
ALTER TABLE public.trip_expenses
  DROP CONSTRAINT IF EXISTS trip_expenses_expense_type_check;

ALTER TABLE public.trip_expenses
  ADD CONSTRAINT trip_expenses_expense_type_check
  CHECK (expense_type IN ('cabin_deposit', 'carpool_mileage', 'shared_receipt', 'website_maintenance', 'other'));

-- 2. Add rule definition and version for Constitution
INSERT INTO public.rule_definitions (stable_key, category, scope)
SELECT 'website-maintenance-contribution', 'expenses', 'general'
WHERE NOT EXISTS (
  SELECT 1 FROM public.rule_definitions WHERE scope = 'general' AND stable_key = 'website-maintenance-contribution'
);

INSERT INTO public.rule_versions (definition_id, version_no, human_text, structured_values, effective_from)
SELECT
  d.id,
  1,
  'To support ongoing platform hosting, domain maintenance, and system upkeep, each first-time trip attendee contributes $5.00 toward website build and maintenance. For each subsequent trip attended, the participant contributes $2.50. This contribution is credited to administrator Veerraju Amanchi to offset operating expenses and is waived for the administrator himself. It is automatically posted to the trip expense ledger upon RSVP Going and removed if the RSVP changes to Not Going before financial finalization.',
  jsonb_build_object('first_trip_fee_cents', 500, 'subsequent_trip_fee_cents', 250),
  now()
FROM public.rule_definitions d
WHERE d.scope = 'general' AND d.stable_key = 'website-maintenance-contribution'
  AND NOT EXISTS (
    SELECT 1 FROM public.rule_versions v WHERE v.definition_id = d.id AND v.version_no = 1
  );

-- 3. Create private.apply_website_maintenance_fee
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
BEGIN
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

-- 4. Create private.cancel_website_maintenance_fee
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
  DELETE FROM public.trip_expenses
  WHERE trip_id = p_trip_id
    AND expense_type = 'website_maintenance'
    AND is_locked = FALSE
    AND id IN (
      SELECT expense_id FROM public.trip_expense_allocations WHERE member_id = p_member_id
    );
END;
$$;

-- 5. Update phase2_submit_rsvp to apply/cancel fee
CREATE OR REPLACE FUNCTION public.phase2_submit_rsvp(
  p_auth_user_id UUID,
  p_trip_id UUID,
  p_response TEXT,
  p_bundle_id UUID,
  p_content_hash TEXT,
  p_expected_version INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member UUID;
  v_trip public.camping_trips%ROWTYPE;
  v_old public.trip_rsvps%ROWTYPE;
  v_current_bundle public.trip_rule_bundles%ROWTYPE;
  v_ack UUID;
  v_id UUID;
  v_version INTEGER;
  v_existing BOOLEAN;
  v_event TEXT;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user required' USING errcode = '42501';
  END IF;
  SELECT member_id INTO v_member FROM public.member_profiles
  WHERE auth_user_id = p_auth_user_id AND account_status = 'active' AND member_role IN ('member', 'admin', 'accountant');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active member required' USING errcode = '42501';
  END IF;
  IF p_response NOT IN ('coming', 'not_coming') OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid RSVP parameters' USING errcode = '22023';
  END IF;
  SELECT * INTO v_trip FROM public.camping_trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR v_trip.deleted_at IS NOT NULL OR v_trip.event_status = 'cancelled' OR v_trip.poll_status = 'draft' OR v_trip.ends_on IS NULL OR v_trip.ends_on < (now() AT TIME ZONE coalesce(v_trip.club_timezone_snapshot, 'America/Los_Angeles'))::date THEN
    RAISE EXCEPTION 'camping event is closed';
  END IF;
  IF p_response = 'coming' AND (NOT EXISTS(SELECT 1 FROM public.trip_rsvps WHERE trip_id = p_trip_id AND member_id = v_member AND response = 'coming')) THEN
    PERFORM private.phase2_build_rule_bundle(p_trip_id, v_member);
  END IF;
  SELECT * INTO v_old FROM public.trip_rsvps WHERE trip_id = p_trip_id AND member_id = v_member FOR UPDATE;
  v_existing := FOUND;
  IF v_existing THEN
    IF p_expected_version IS NULL OR p_expected_version <> v_old.version THEN
      RAISE EXCEPTION 'stale RSVP version' USING errcode = '40001';
    END IF;
    v_id := v_old.id;
    v_version := v_old.version + 1;
    v_ack := v_old.rule_acknowledgment_id;
  ELSE
    IF coalesce(p_expected_version, 0) <> 0 THEN
      RAISE EXCEPTION 'stale RSVP version' USING errcode = '40001';
    END IF;
    v_id := gen_random_uuid();
    v_version := 1;
  END IF;
  IF p_response = 'coming' AND (NOT v_existing OR v_old.response <> 'coming') THEN
    SELECT * INTO v_current_bundle FROM public.trip_rule_bundles WHERE trip_id = p_trip_id AND is_current;
    IF v_current_bundle.id IS NULL OR p_bundle_id IS DISTINCT FROM v_current_bundle.id OR p_content_hash IS DISTINCT FROM v_current_bundle.content_hash THEN
      RAISE EXCEPTION 'current Camping Constitution acknowledgment required' USING errcode = '22023';
    END IF;
    SELECT id INTO v_ack FROM public.trip_rule_acknowledgments WHERE member_id = v_member AND trip_id = p_trip_id AND bundle_id = v_current_bundle.id AND statement_version = 'coming-v1';
    IF v_ack IS NULL THEN
      INSERT INTO public.trip_rule_acknowledgments(trip_id, member_id, bundle_id, content_hash, statement_version, request_id)
        VALUES(p_trip_id, v_member, v_current_bundle.id, v_current_bundle.content_hash, 'coming-v1', p_request_id) RETURNING id INTO v_ack;
    END IF;
  ELSIF p_response = 'coming' AND v_ack IS NULL THEN
    RAISE EXCEPTION 'current Camping Constitution acknowledgment required' USING errcode = '22023';
  END IF;
  IF p_response = 'coming' AND (NOT v_existing OR v_old.response <> 'coming') AND v_trip.max_capacity IS NOT NULL
    AND (SELECT count(*) FROM public.trip_rsvps WHERE trip_id = p_trip_id AND response = 'coming') >= v_trip.max_capacity THEN
    RAISE EXCEPTION 'interest poll capacity reached' USING errcode = '22023';
  END IF;
  IF v_existing THEN
    UPDATE public.trip_rsvps SET response = p_response, rule_acknowledgment_id = v_ack, version = v_version, updated_at = now() WHERE id = v_id;
    v_event := CASE WHEN v_old.response = p_response THEN NULL ELSE 'changed' END;
  ELSE
    INSERT INTO public.trip_rsvps(id, trip_id, member_id, response, rule_acknowledgment_id, version) VALUES(v_id, p_trip_id, v_member, p_response, v_ack, v_version);
    v_event := 'submitted';
  END IF;
  IF v_event IS NOT NULL THEN
    INSERT INTO public.trip_rsvp_events(trip_id, member_id, actor_id, event_type, from_response, to_response, rule_acknowledgment_id, request_id)
      VALUES(p_trip_id, v_member, v_member, v_event, CASE WHEN v_existing THEN v_old.response ELSE NULL END, p_response, v_ack, p_request_id);
  END IF;

  IF p_response = 'not_coming' THEN
    -- Delete active duty assignments
    DELETE FROM public.trip_duty_assignments
    WHERE trip_id = p_trip_id AND member_id = v_member AND status IN ('claimed', 'assigned_by_admin');

    -- Release shared gear/food commitments
    UPDATE public.trip_commitments
    SET assigned_member_id = NULL, updated_at = now()
    WHERE trip_id = p_trip_id AND assigned_member_id = v_member;

    -- Delete meal preferences
    DELETE FROM public.trip_meal_preferences
    WHERE trip_id = p_trip_id AND member_id = v_member;

    -- Remove website maintenance fee
    PERFORM private.cancel_website_maintenance_fee(p_trip_id, v_member);
  ELSIF p_response = 'coming' THEN
    -- Apply website maintenance fee
    PERFORM private.apply_website_maintenance_fee(p_trip_id, v_member);
  END IF;

  RETURN jsonb_build_object('rsvpId', v_id, 'response', p_response, 'version', v_version, 'acknowledgmentId', v_ack);
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_submit_rsvp(UUID, UUID, TEXT, UUID, TEXT, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_submit_rsvp(UUID, UUID, TEXT, UUID, TEXT, INTEGER, UUID) TO service_role;

-- 6. Update phase2_admin_record_interest with fee logic
CREATE OR REPLACE FUNCTION public.phase2_admin_record_interest(
  p_actor_id UUID, p_trip_id UUID, p_member_id UUID, p_response TEXT, p_expected_version INTEGER, p_reason TEXT, p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_trip public.camping_trips%ROWTYPE;
  v_old public.trip_rsvps%ROWTYPE;
  v_member public.member_profiles%ROWTYPE;
  v_bundle UUID;
  v_ack UUID;
  v_id UUID;
  v_version INTEGER;
BEGIN
  PERFORM private.phase2_require_admin(p_actor_id);
  IF p_response NOT IN ('coming', 'not_coming') OR p_reason IS NULL OR length(btrim(p_reason)) = 0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid administrator poll entry';
  END IF;
  SELECT * INTO v_trip FROM public.camping_trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR v_trip.deleted_at IS NOT NULL OR v_trip.event_status = 'cancelled' OR v_trip.poll_status = 'draft' OR v_trip.ends_on IS NULL OR v_trip.ends_on < (now() AT TIME ZONE coalesce(v_trip.club_timezone_snapshot, 'America/Los_Angeles'))::date THEN
    RAISE EXCEPTION 'camping event is closed';
  END IF;
  SELECT * INTO v_member FROM public.member_profiles WHERE member_id = p_member_id AND account_status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active member required';
  END IF;
  IF p_response = 'coming' AND NOT EXISTS(SELECT 1 FROM public.trip_rsvps WHERE trip_id = p_trip_id AND member_id = p_member_id AND response = 'coming') THEN
    PERFORM private.phase2_build_rule_bundle(p_trip_id, p_actor_id);
  END IF;
  SELECT * INTO v_old FROM public.trip_rsvps WHERE trip_id = p_trip_id AND member_id = p_member_id FOR UPDATE;
  IF FOUND THEN
    IF p_expected_version IS NULL OR v_old.version <> p_expected_version THEN
      RAISE EXCEPTION 'stale RSVP version' USING errcode = '40001';
    END IF;
    v_id := v_old.id; v_version := v_old.version + 1; v_ack := v_old.rule_acknowledgment_id;
  ELSE
    IF coalesce(p_expected_version, 0) <> 0 THEN
      RAISE EXCEPTION 'stale RSVP version' USING errcode = '40001';
    END IF;
    v_id := gen_random_uuid(); v_version := 1;
  END IF;
  IF p_response = 'coming' THEN
    SELECT id INTO v_bundle FROM public.trip_rule_bundles WHERE trip_id = p_trip_id AND is_current;
    IF v_old.rule_acknowledgment_id IS NOT NULL AND v_old.response = 'coming' THEN
      v_ack := v_old.rule_acknowledgment_id;
    ELSE
      SELECT id INTO v_ack FROM public.trip_rule_acknowledgments WHERE member_id = p_member_id AND trip_id = p_trip_id AND bundle_id = v_bundle AND statement_version = 'coming-v1';
      IF v_ack IS NULL THEN
        RAISE EXCEPTION 'member must personally acknowledge the current rule bundle';
      END IF;
    END IF;
    IF v_trip.max_capacity IS NOT NULL AND (v_old.id IS NULL OR v_old.response <> 'coming')
      AND (SELECT count(*) FROM public.trip_rsvps WHERE trip_id = p_trip_id AND response = 'coming') >= v_trip.max_capacity THEN
      RAISE EXCEPTION 'interest poll capacity reached';
    END IF;
  END IF;
  IF v_old.id IS NULL THEN
    INSERT INTO public.trip_rsvps(id, trip_id, member_id, response, rule_acknowledgment_id, version)
      VALUES(v_id, p_trip_id, p_member_id, p_response, v_ack, v_version);
  ELSE
    UPDATE public.trip_rsvps
      SET response = p_response, rule_acknowledgment_id = v_ack, version = v_version, updated_at = now()
      WHERE id = v_id;
  END IF;
  INSERT INTO public.trip_rsvp_events(trip_id, member_id, actor_id, event_type, from_response, to_response, rule_acknowledgment_id, request_id, reason)
    VALUES(p_trip_id, p_member_id, p_actor_id, 'admin_interest_recorded', CASE WHEN v_old.id IS NOT NULL THEN v_old.response ELSE NULL END, p_response, v_ack, p_request_id, btrim(p_reason));

  IF p_response = 'not_coming' THEN
    DELETE FROM public.trip_duty_assignments
    WHERE trip_id = p_trip_id AND member_id = p_member_id AND status IN ('claimed', 'assigned_by_admin');

    UPDATE public.trip_commitments
    SET assigned_member_id = NULL, updated_at = now()
    WHERE trip_id = p_trip_id AND assigned_member_id = p_member_id;

    DELETE FROM public.trip_meal_preferences
    WHERE trip_id = p_trip_id AND member_id = p_member_id;

    PERFORM private.cancel_website_maintenance_fee(p_trip_id, p_member_id);
  ELSIF p_response = 'coming' THEN
    PERFORM private.apply_website_maintenance_fee(p_trip_id, p_member_id);
  END IF;

  RETURN jsonb_build_object('rsvpId', v_id, 'response', p_response, 'version', v_version, 'acknowledgmentId', v_ack);
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_record_interest(UUID, UUID, UUID, TEXT, INTEGER, TEXT, UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_admin_record_interest(UUID, UUID, UUID, TEXT, INTEGER, TEXT, UUID) TO service_role;

-- 7. Update phase6_submit_voucher to allow accountants and purchasers
CREATE OR REPLACE FUNCTION public.phase6_submit_voucher(
    p_group_id UUID,
    p_purchaser_member_id UUID,
    p_purchase_date DATE,
    p_amount_cents INTEGER,
    p_order_ref TEXT,
    p_voucher_code TEXT,
    p_security_pin TEXT,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor public.member_profiles%ROWTYPE;
    v_group RECORD;
    v_is_admin BOOLEAN := FALSE;
    v_is_accountant BOOLEAN := FALSE;
    v_is_assigned BOOLEAN := FALSE;
    v_is_purchaser BOOLEAN := FALSE;
    v_expense_id UUID;
    v_expense_result JSONB;
    v_voucher_status TEXT;
BEGIN
    SELECT g.id, g.activity_id, g.expense_id, g.voucher_status, g.purchaser_member_id, ta.trip_id, ta.title
    INTO v_group
    FROM public.trip_activity_groups g
    JOIN public.trip_activities ta ON ta.id = g.activity_id
    WHERE g.id = p_group_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Activity group not found.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_actor
    FROM public.member_profiles
    WHERE (member_id = p_actor_id OR auth_user_id = p_actor_id)
      AND account_status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active member profile not found for actor.' USING ERRCODE = '42501';
    END IF;

    v_is_admin := (v_actor.member_role IN ('admin', 'administrator'));
    v_is_accountant := (v_actor.member_role = 'accountant');
    v_is_assigned := EXISTS (
        SELECT 1 FROM public.trip_activity_group_members
        WHERE group_id = p_group_id AND member_id = v_actor.member_id
    );
    v_is_purchaser := (v_group.purchaser_member_id IS NOT NULL AND v_group.purchaser_member_id = v_actor.member_id);

    IF NOT v_is_admin AND NOT v_is_accountant AND NOT v_is_assigned AND NOT v_is_purchaser THEN
        RAISE EXCEPTION 'Only assigned riders, accountants, purchasers, or administrators can submit voucher details.' USING ERRCODE = '42501';
    END IF;

    IF p_amount_cents IS NOT NULL AND p_amount_cents < 0 THEN
        RAISE EXCEPTION 'Amount cents cannot be negative.' USING ERRCODE = '22023';
    END IF;

    IF p_amount_cents IS NOT NULL AND p_amount_cents > 0 THEN
        IF v_group.expense_id IS NULL THEN
            v_expense_result := public.phase5_manage_expense(
                p_trip_id := v_group.trip_id,
                p_action := 'create',
                p_expense_type := 'shared_receipt',
                p_payer_member_id := p_purchaser_member_id,
                p_amount_cents := p_amount_cents,
                p_description := 'Activity Voucher: ' || v_group.title,
                p_incurred_date := COALESCE(p_purchase_date, CURRENT_DATE),
                p_actor_id := v_actor.member_id,
                p_is_admin := (v_is_admin OR v_is_accountant),
                p_split_mode := 'all_attendees'
            );
            v_expense_id := (v_expense_result->>'expense_id')::UUID;
        ELSE
            PERFORM public.phase5_manage_expense(
                p_trip_id := v_group.trip_id,
                p_action := 'update',
                p_expense_id := v_group.expense_id,
                p_expense_type := 'shared_receipt',
                p_payer_member_id := p_purchaser_member_id,
                p_amount_cents := p_amount_cents,
                p_description := 'Activity Voucher: ' || v_group.title,
                p_incurred_date := COALESCE(p_purchase_date, CURRENT_DATE),
                p_actor_id := v_actor.member_id,
                p_is_admin := (v_is_admin OR v_is_accountant),
                p_split_mode := 'all_attendees'
            );
            v_expense_id := v_group.expense_id;
        END IF;
    ELSE
        v_expense_id := v_group.expense_id;
    END IF;

    IF (p_voucher_code IS NOT NULL AND trim(p_voucher_code) <> '') OR
       (p_order_ref IS NOT NULL AND trim(p_order_ref) <> '') THEN
        v_voucher_status := 'purchased';
    ELSE
        v_voucher_status := COALESCE(v_group.voucher_status, 'needed');
    END IF;

    UPDATE public.trip_activity_groups
    SET purchaser_member_id = p_purchaser_member_id,
        purchase_date = p_purchase_date,
        amount_cents = p_amount_cents,
        order_reference_number = trim(p_order_ref),
        voucher_code = trim(p_voucher_code),
        security_pin = trim(p_security_pin),
        expense_id = v_expense_id,
        voucher_status = v_voucher_status,
        updated_at = now()
    WHERE id = p_group_id;

    RETURN jsonb_build_object(
        'success', true,
        'group_id', p_group_id,
        'voucher_status', v_voucher_status,
        'expense_id', v_expense_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.phase6_submit_voucher FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase6_submit_voucher TO authenticated, service_role;

-- 8. Backfill existing confirmed RSVPs on upcoming/active trips
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT trip_id, member_id
    FROM public.trip_rsvps rsvp
    JOIN public.camping_trips ct ON ct.id = rsvp.trip_id
    WHERE rsvp.response = 'coming'
      AND ct.trip_status NOT IN ('completed', 'financially_finalized', 'financially_settled')
      AND ct.deleted_at IS NULL
  LOOP
    PERFORM private.apply_website_maintenance_fee(r.trip_id, r.member_id);
  END LOOP;
END $$;

-- 9. Rebuild immutable rule bundles for open trips
DO $$
DECLARE v_trip_id UUID;
BEGIN
  FOR v_trip_id IN SELECT id FROM public.camping_trips WHERE trip_status NOT IN ('completed', 'financially_finalized', 'financially_settled') AND deleted_at IS NULL LOOP
    PERFORM private.phase2_build_rule_bundle(v_trip_id, NULL);
  END LOOP;
END $$;
