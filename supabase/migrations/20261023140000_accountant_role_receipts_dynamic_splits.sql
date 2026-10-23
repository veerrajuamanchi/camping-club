-- Migration: 20261023140000_accountant_role_receipts_dynamic_splits.sql
-- Accountant role, dynamic split mode, storage bucket for receipts, and retention purge

-- 1. Check constraint permits 'accountant' on member_profiles
ALTER TABLE public.member_profiles DROP CONSTRAINT IF EXISTS member_profiles_member_role_check;
ALTER TABLE public.member_profiles ADD CONSTRAINT member_profiles_member_role_check
  CHECK (member_role IN ('member', 'admin', 'accountant'));

-- 2. Update public.phase1_update_membership to accept p_role IN ('member', 'admin', 'accountant')
CREATE OR REPLACE FUNCTION public.phase1_update_membership(
  p_actor_id uuid,
  p_target_member_id uuid,
  p_role text,
  p_status text,
  p_reason text,
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_role text;
  v_old_status text;
  v_upcoming_trip_id uuid;
  v_rsvp public.trip_rsvps%rowtype;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.member_profiles
    WHERE member_id = p_actor_id AND member_role = 'admin' AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'administrator required' USING ERRCODE = '42501';
  END IF;

  IF p_role NOT IN ('member', 'admin', 'accountant') OR p_status NOT IN ('active', 'inactive', 'suspended') THEN
    RAISE EXCEPTION 'invalid membership state';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reason is required';
  END IF;

  SELECT member_role, account_status INTO v_old_role, v_old_status
  FROM public.member_profiles
  WHERE member_id = p_target_member_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  IF v_old_role = 'admin' AND v_old_status = 'active' AND (p_role <> 'admin' OR p_status <> 'active') AND
     (SELECT count(*) FROM public.member_profiles WHERE member_role = 'admin' AND account_status = 'active') <= 1 THEN
    RAISE EXCEPTION 'cannot deactivate the last active administrator';
  END IF;

  UPDATE public.member_profiles
  SET member_role = p_role,
      account_status = p_status,
      deactivated_at = CASE WHEN p_status = 'inactive' THEN coalesce(deactivated_at, now()) ELSE NULL END
  WHERE member_id = p_target_member_id;

  INSERT INTO public.audit_events(actor_id, actor_kind, entity_type, entity_id, action, reason, request_id)
  VALUES (p_actor_id, 'admin', 'member', p_target_member_id, 'membership_changed', p_reason, p_request_id)
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  -- If deactivated or suspended, automatically remove member from all upcoming camping trips
  IF p_status IN ('inactive', 'suspended') THEN
    FOR v_upcoming_trip_id IN
      SELECT ct.id FROM public.camping_trips ct
      WHERE ct.deleted_at IS NULL
        AND coalesce(ct.ends_on, ct.starts_on, ct.month_key) >= (now() AT TIME ZONE coalesce(ct.club_timezone_snapshot, 'America/Los_Angeles'))::date
      ORDER BY ct.id FOR UPDATE
    LOOP
      SELECT * INTO v_rsvp FROM public.trip_rsvps WHERE trip_id = v_upcoming_trip_id AND member_id = p_target_member_id FOR UPDATE;
      IF FOUND AND v_rsvp.response = 'coming' THEN
        UPDATE public.trip_rsvps SET response = 'not_coming', version = version + 1, updated_at = now() WHERE id = v_rsvp.id;
        INSERT INTO public.trip_rsvp_events(trip_id, member_id, actor_id, event_type, from_response, to_response, rule_acknowledgment_id, request_id, reason)
        VALUES (v_upcoming_trip_id, p_target_member_id, p_actor_id, 'changed', 'coming', 'not_coming', v_rsvp.rule_acknowledgment_id, gen_random_uuid(), 'Member account deactivated by administrator');
      END IF;

      UPDATE public.trip_duty_assignments
      SET status = 'dropped', released_at = now(), released_by = p_actor_id, release_reason = 'Member account deactivated by administrator', updated_at = now()
      WHERE trip_id = v_upcoming_trip_id AND member_id = p_target_member_id AND status IN ('claimed', 'assigned_by_admin');

      UPDATE public.trip_waitlist_entries
      SET status = 'removed', resolved_at = now()
      WHERE trip_id = v_upcoming_trip_id AND member_id = p_target_member_id AND status = 'waiting';
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase1_update_membership(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_update_membership(uuid, uuid, text, text, text, uuid) TO service_role;

-- Also update phase2_submit_rsvp to allow accountant role
CREATE OR REPLACE FUNCTION public.phase2_submit_rsvp(
  p_auth_user_id uuid,
  p_trip_id uuid,
  p_response text,
  p_bundle_id uuid,
  p_content_hash text,
  p_expected_version integer,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_member uuid;
  v_trip public.camping_trips%rowtype;
  v_old public.trip_rsvps%rowtype;
  v_ack uuid;
  v_current_bundle public.trip_rule_bundles%rowtype;
  v_id uuid;
  v_version integer;
  v_event text;
  v_existing boolean;
BEGIN
  IF p_auth_user_id IS NULL OR p_response NOT IN ('coming', 'not_coming') OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid RSVP';
  END IF;

  SELECT member_id INTO v_member FROM public.member_profiles
  WHERE auth_user_id = p_auth_user_id AND account_status = 'active' AND member_role IN ('member', 'admin', 'accountant');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active member required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_trip FROM public.camping_trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll not found';
  END IF;

  IF v_trip.deleted_at IS NOT NULL OR v_trip.event_status = 'cancelled' OR v_trip.poll_status = 'draft' OR v_trip.ends_on IS NULL OR v_trip.ends_on < (now() AT TIME ZONE coalesce(v_trip.club_timezone_snapshot, 'America/Los_Angeles'))::date THEN
    RAISE EXCEPTION 'camping event is closed';
  END IF;

  IF p_response = 'coming' AND (NOT EXISTS (SELECT 1 FROM public.trip_rsvps WHERE trip_id = p_trip_id AND member_id = v_member AND response = 'coming')) THEN
    PERFORM private.phase2_build_rule_bundle(p_trip_id, v_member);
  END IF;

  SELECT * INTO v_old FROM public.trip_rsvps WHERE trip_id = p_trip_id AND member_id = v_member FOR UPDATE;
  v_existing := FOUND;

  IF v_existing THEN
    IF p_expected_version IS NULL OR p_expected_version <> v_old.version THEN
      RAISE EXCEPTION 'stale RSVP version' USING ERRCODE = '40001';
    END IF;
    v_id := v_old.id;
    v_version := v_old.version + 1;
    v_ack := v_old.rule_acknowledgment_id;
  ELSE
    IF coalesce(p_expected_version, 0) <> 0 THEN
      RAISE EXCEPTION 'stale RSVP version' USING ERRCODE = '40001';
    END IF;
    v_id := gen_random_uuid();
    v_version := 1;
  END IF;

  IF p_response = 'coming' THEN
    SELECT * INTO v_current_bundle FROM public.trip_rule_bundles
    WHERE trip_id = p_trip_id AND superseding_bundle_id IS NULL
    ORDER BY created_at DESC LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'rule bundle missing';
    END IF;

    IF v_current_bundle.id <> p_bundle_id OR v_current_bundle.content_hash <> p_content_hash THEN
      RAISE EXCEPTION 'member must personally acknowledge the current rule bundle' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.trip_rule_acknowledgments(
      trip_id, member_id, bundle_id, acknowledged_bundle_hash, request_id
    ) VALUES (
      p_trip_id, v_member, p_bundle_id, p_content_hash, p_request_id
    )
    ON CONFLICT (member_id, bundle_id, acknowledged_bundle_hash)
    DO UPDATE SET acknowledged_at = now()
    RETURNING id INTO v_ack;
  END IF;

  INSERT INTO public.trip_rsvps(
    id, trip_id, member_id, response, rule_acknowledgment_id, version
  ) VALUES (
    v_id, p_trip_id, v_member, p_response, v_ack, v_version
  )
  ON CONFLICT (trip_id, member_id)
  DO UPDATE SET
    response = EXCLUDED.response,
    rule_acknowledgment_id = coalesce(EXCLUDED.rule_acknowledgment_id, public.trip_rsvps.rule_acknowledgment_id),
    version = EXCLUDED.version,
    updated_at = now();

  v_event := CASE WHEN NOT v_existing THEN 'created' ELSE 'changed' END;

  INSERT INTO public.trip_rsvp_events(
    trip_id, member_id, actor_id, event_type, from_response, to_response, rule_acknowledgment_id, request_id
  ) VALUES (
    p_trip_id, v_member, v_member, v_event,
    CASE WHEN v_existing THEN v_old.response ELSE NULL END,
    p_response, v_ack, p_request_id
  );

  INSERT INTO public.audit_events(actor_id, actor_kind, entity_type, entity_id, action, request_id)
  VALUES (v_member, 'member', 'trip_rsvp', v_id, 'rsvp_' || v_event, p_request_id)
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'trip_id', p_trip_id,
    'member_id', v_member,
    'response', p_response,
    'version', v_version,
    'rule_acknowledgment_id', v_ack
  );
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_submit_rsvp(uuid, uuid, text, uuid, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_submit_rsvp(uuid, uuid, text, uuid, text, integer, uuid) TO service_role;

-- 3. Update public.verify_member_deposit to allow v_actor.member_role IN ('admin', 'administrator', 'accountant')
CREATE OR REPLACE FUNCTION public.verify_member_deposit(
    p_trip_id UUID,
    p_member_id UUID,
    p_status TEXT,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor public.member_profiles%ROWTYPE;
    v_rsvp public.trip_rsvps%ROWTYPE;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        SELECT * INTO v_actor FROM public.member_profiles
        WHERE (auth_user_id = auth.uid() OR member_id = auth.uid())
        LIMIT 1;
    ELSIF p_actor_id IS NOT NULL THEN
        SELECT * INTO v_actor FROM public.member_profiles WHERE member_id = p_actor_id;
    ELSE
        RAISE EXCEPTION 'unauthorized: session required' USING ERRCODE = '42501';
    END IF;

    IF v_actor.member_id IS NULL OR v_actor.member_role NOT IN ('admin', 'administrator', 'accountant') OR v_actor.account_status <> 'active' THEN
        RAISE EXCEPTION 'unauthorized: administrator or accountant role required' USING ERRCODE = '42501';
    END IF;

    IF p_status NOT IN ('unpaid', 'submitted_by_member', 'confirmed_by_admin', 'exempt') THEN
        RAISE EXCEPTION 'invalid deposit_status: %', p_status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_rsvp FROM public.trip_rsvps WHERE trip_id = p_trip_id AND member_id = p_member_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'RSVP not found for member and trip' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.trip_rsvps
    SET deposit_status = p_status,
        deposit_confirmed_at = CASE WHEN p_status = 'confirmed_by_admin' THEN now() ELSE NULL END,
        deposit_confirmed_by = CASE WHEN p_status = 'confirmed_by_admin' THEN v_actor.member_id ELSE NULL END,
        updated_at = now()
    WHERE trip_id = p_trip_id AND member_id = p_member_id
    RETURNING * INTO v_rsvp;

    INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason)
    VALUES (
      v_actor.member_id,
      CASE WHEN v_actor.member_role = 'accountant' THEN 'member' ELSE 'admin' END,
      'trip_rsvp',
      v_rsvp.id,
      'deposit_status_verified',
      p_status
    );

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', p_trip_id,
        'member_id', p_member_id,
        'deposit_status', v_rsvp.deposit_status,
        'deposit_confirmed_at', v_rsvp.deposit_confirmed_at,
        'deposit_confirmed_by', v_rsvp.deposit_confirmed_by
    );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_member_deposit FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_member_deposit TO authenticated, service_role;

-- 4. Alter public.trip_expenses
ALTER TABLE public.trip_expenses
  ADD COLUMN IF NOT EXISTS split_mode TEXT NOT NULL DEFAULT 'all_attendees' CHECK (split_mode IN ('all_attendees', 'custom')),
  ADD COLUMN IF NOT EXISTS receipt_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS receipt_file_name TEXT,
  ADD COLUMN IF NOT EXISTS receipt_content_type TEXT;

-- 5. Backfill historical expenses
UPDATE public.trip_expenses
SET split_mode = 'custom'
WHERE created_at < now();

-- 6. Create trip-receipts bucket in storage.buckets (private, 5MB limit, JPEG/PNG/WebP/PDF)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trip-receipts',
  'trip-receipts',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 7. RLS policies on storage.objects for trip-receipts
DROP POLICY IF EXISTS "trip_receipts_select_attendee_or_staff" ON storage.objects;
CREATE POLICY "trip_receipts_select_attendee_or_staff"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'trip-receipts'
  AND split_part(name, '/', 1) = 'trips'
  AND EXISTS (
    SELECT 1 FROM public.member_profiles m
    WHERE m.auth_user_id = (SELECT auth.uid())
      AND m.account_status = 'active'
      AND (
        m.member_role IN ('admin', 'accountant')
        OR EXISTS (
          SELECT 1 FROM public.trip_rsvps r
          WHERE r.trip_id::text = split_part(storage.objects.name, '/', 2)
            AND r.member_id = m.member_id
            AND r.response = 'coming'
        )
      )
  )
);

DROP POLICY IF EXISTS "trip_receipts_insert_attendee_or_staff" ON storage.objects;
CREATE POLICY "trip_receipts_insert_attendee_or_staff"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'trip-receipts'
  AND split_part(name, '/', 1) = 'trips'
  AND EXISTS (
    SELECT 1 FROM public.member_profiles m
    WHERE m.auth_user_id = (SELECT auth.uid())
      AND m.account_status = 'active'
      AND (
        m.member_role IN ('admin', 'accountant')
        OR EXISTS (
          SELECT 1 FROM public.trip_rsvps r
          WHERE r.trip_id::text = split_part(storage.objects.name, '/', 2)
            AND r.member_id = m.member_id
            AND r.response = 'coming'
        )
      )
  )
);

DROP POLICY IF EXISTS "trip_receipts_update_attendee_or_staff" ON storage.objects;
CREATE POLICY "trip_receipts_update_attendee_or_staff"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'trip-receipts'
  AND split_part(name, '/', 1) = 'trips'
  AND EXISTS (
    SELECT 1 FROM public.member_profiles m
    WHERE m.auth_user_id = (SELECT auth.uid())
      AND m.account_status = 'active'
      AND (
        m.member_role IN ('admin', 'accountant')
        OR EXISTS (
          SELECT 1 FROM public.trip_rsvps r
          WHERE r.trip_id::text = split_part(storage.objects.name, '/', 2)
            AND r.member_id = m.member_id
            AND r.response = 'coming'
        )
      )
  )
)
WITH CHECK (
  bucket_id = 'trip-receipts'
  AND split_part(name, '/', 1) = 'trips'
  AND EXISTS (
    SELECT 1 FROM public.member_profiles m
    WHERE m.auth_user_id = (SELECT auth.uid())
      AND m.account_status = 'active'
      AND (
        m.member_role IN ('admin', 'accountant')
        OR EXISTS (
          SELECT 1 FROM public.trip_rsvps r
          WHERE r.trip_id::text = split_part(storage.objects.name, '/', 2)
            AND r.member_id = m.member_id
            AND r.response = 'coming'
        )
      )
  )
);

DROP POLICY IF EXISTS "trip_receipts_delete_admin" ON storage.objects;
CREATE POLICY "trip_receipts_delete_admin"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'trip-receipts'
  AND EXISTS (
    SELECT 1 FROM public.member_profiles m
    WHERE m.auth_user_id = (SELECT auth.uid())
      AND m.account_status = 'active'
      AND m.member_role = 'admin'
  )
);

-- 8. Update public.phase5_manage_expense to accept p_split_mode, p_receipt_storage_path, p_receipt_file_name, p_receipt_content_type
DROP FUNCTION IF EXISTS public.phase5_manage_expense(UUID, TEXT, UUID, TEXT, UUID, INTEGER, TEXT, DATE, TEXT, UUID, JSONB, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.phase5_manage_expense(
    p_trip_id UUID,
    p_action TEXT,
    p_expense_id UUID DEFAULT NULL,
    p_expense_type TEXT DEFAULT 'shared_receipt',
    p_payer_member_id UUID DEFAULT NULL,
    p_amount_cents INTEGER DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_incurred_date DATE DEFAULT CURRENT_DATE,
    p_receipt_url TEXT DEFAULT NULL,
    p_source_reference_id UUID DEFAULT NULL,
    p_allocations JSONB DEFAULT '[]'::JSONB,
    p_actor_id UUID DEFAULT NULL,
    p_is_admin BOOLEAN DEFAULT FALSE,
    p_split_mode TEXT DEFAULT 'all_attendees',
    p_receipt_storage_path TEXT DEFAULT NULL,
    p_receipt_file_name TEXT DEFAULT NULL,
    p_receipt_content_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_expense_id UUID;
    v_alloc RECORD;
    v_total_allocated INTEGER := 0;
    v_existing_expense public.trip_expenses%ROWTYPE;
BEGIN
    IF p_action = 'create' THEN
        IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
            RAISE EXCEPTION 'Expense amount must be positive integer cents.' USING ERRCODE = '22023';
        END IF;

        IF p_description IS NULL OR trim(p_description) = '' THEN
            RAISE EXCEPTION 'Description is required.' USING ERRCODE = '22023';
        END IF;

        IF p_split_mode NOT IN ('all_attendees', 'custom') THEN
            RAISE EXCEPTION 'Invalid split_mode: %. Must be all_attendees or custom.', p_split_mode USING ERRCODE = '22023';
        END IF;

        IF p_payer_member_id IS NULL THEN
            p_payer_member_id := p_actor_id;
        ELSIF p_payer_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can record expenses paid by other members.' USING ERRCODE = '42501';
        END IF;

        -- Check allocation total if allocations provided
        IF jsonb_array_length(p_allocations) > 0 THEN
            FOR v_alloc IN SELECT * FROM jsonb_to_recordset(p_allocations) AS x(member_id UUID, allocated_cents INTEGER) LOOP
                v_total_allocated := v_total_allocated + v_alloc.allocated_cents;
            END LOOP;

            IF v_total_allocated <> p_amount_cents THEN
                RAISE EXCEPTION 'Allocations sum (%) must equal total expense amount (%).', v_total_allocated, p_amount_cents USING ERRCODE = '22023';
            END IF;
        END IF;

        INSERT INTO public.trip_expenses (
            trip_id, expense_type, payer_member_id, amount_cents, description,
            incurred_date, receipt_url, source_reference_id,
            split_mode, receipt_storage_path, receipt_file_name, receipt_content_type
        ) VALUES (
            p_trip_id, COALESCE(p_expense_type, 'shared_receipt'), p_payer_member_id,
            p_amount_cents, trim(p_description), COALESCE(p_incurred_date, CURRENT_DATE),
            p_receipt_url, p_source_reference_id,
            COALESCE(p_split_mode, 'all_attendees'), p_receipt_storage_path, p_receipt_file_name, p_receipt_content_type
        ) RETURNING id INTO v_expense_id;

        -- Insert allocations if provided
        IF jsonb_array_length(p_allocations) > 0 THEN
            FOR v_alloc IN SELECT * FROM jsonb_to_recordset(p_allocations) AS x(member_id UUID, allocated_cents INTEGER) LOOP
                INSERT INTO public.trip_expense_allocations (expense_id, member_id, allocated_cents)
                VALUES (v_expense_id, v_alloc.member_id, v_alloc.allocated_cents)
                ON CONFLICT (expense_id, member_id)
                DO UPDATE SET allocated_cents = EXCLUDED.allocated_cents;
            END LOOP;
        END IF;

        RETURN jsonb_build_object('success', true, 'action', 'create', 'expense_id', v_expense_id);

    ELSIF p_action = 'delete' THEN
        SELECT * INTO v_existing_expense FROM public.trip_expenses WHERE id = p_expense_id AND trip_id = p_trip_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Expense not found.' USING ERRCODE = '22023';
        END IF;

        IF v_existing_expense.is_locked THEN
            RAISE EXCEPTION 'Locked expenses cannot be deleted.' USING ERRCODE = '22023';
        END IF;

        IF v_existing_expense.payer_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Cannot delete expense submitted by another member.' USING ERRCODE = '42501';
        END IF;

        -- Deleting an expense removes its attached receipt object from storage
        IF v_existing_expense.receipt_storage_path IS NOT NULL THEN
            PERFORM set_config('storage.allow_delete_query', 'true', true);
            DELETE FROM storage.objects
            WHERE bucket_id = 'trip-receipts' AND name = v_existing_expense.receipt_storage_path;
        END IF;

        DELETE FROM public.trip_expenses WHERE id = p_expense_id;

        RETURN jsonb_build_object('success', true, 'action', 'delete', 'expense_id', p_expense_id);

    ELSE
        RAISE EXCEPTION 'Unsupported expense action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase5_manage_expense FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase5_manage_expense TO service_role;

-- 9. Create public.purge_expired_receipts() function
CREATE OR REPLACE FUNCTION public.purge_expired_receipts()
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_expired_trip_ids uuid[];
    v_path text;
BEGIN
    -- Identify completed/financially_settled trips older than the 3 most recent
    WITH retained_trips AS (
        SELECT id FROM public.camping_trips
        WHERE trip_status IN ('completed', 'financially_settled')
          AND deleted_at IS NULL
        ORDER BY COALESCE(starts_on, month_key) DESC, created_at DESC
        LIMIT 3
    )
    SELECT array_agg(id) INTO v_expired_trip_ids
    FROM public.camping_trips
    WHERE trip_status IN ('completed', 'financially_settled')
      AND deleted_at IS NULL
      AND id NOT IN (SELECT id FROM retained_trips);

    IF v_expired_trip_ids IS NULL OR array_length(v_expired_trip_ids, 1) = 0 THEN
        RETURN;
    END IF;

    -- Allow deleting objects directly from storage table for retention purge
    PERFORM set_config('storage.allow_delete_query', 'true', true);

    -- Delete and return storage objects for expired trips
    FOR v_path IN
        DELETE FROM storage.objects
        WHERE bucket_id = 'trip-receipts'
          AND (
            (split_part(name, '/', 1) = 'trips' AND split_part(name, '/', 2) = ANY(v_expired_trip_ids::text[]))
            OR name IN (
                SELECT receipt_storage_path FROM public.trip_expenses
                WHERE trip_id = ANY(v_expired_trip_ids) AND receipt_storage_path IS NOT NULL
            )
          )
        RETURNING name
    LOOP
        RETURN NEXT v_path;
    END LOOP;

    -- Null out receipt columns on trip_expenses for expired trips
    UPDATE public.trip_expenses
    SET receipt_storage_path = NULL,
        receipt_file_name = NULL,
        receipt_content_type = NULL,
        receipt_url = NULL,
        updated_at = now()
    WHERE trip_id = ANY(v_expired_trip_ids)
      AND (receipt_storage_path IS NOT NULL OR receipt_file_name IS NOT NULL OR receipt_content_type IS NOT NULL OR receipt_url IS NOT NULL);

    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_receipts FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_receipts TO authenticated, service_role;
