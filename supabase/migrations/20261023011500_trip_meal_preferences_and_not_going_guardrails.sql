-- Migration: 20261023011500_trip_meal_preferences_and_not_going_guardrails.sql
-- Description: Creates trip_meal_preferences table, RLS policies, and auto-releases duties, commitments, and meal preferences when RSVP changes to not_coming

-- 1. Create table public.trip_meal_preferences
CREATE TABLE IF NOT EXISTS public.trip_meal_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE CASCADE,
    saturday_beverage TEXT NOT NULL DEFAULT 'coffee' CHECK (saturday_beverage IN ('coffee', 'tea', 'none')),
    sunday_beverage TEXT NOT NULL DEFAULT 'tea' CHECK (sunday_beverage IN ('coffee', 'tea', 'none')),
    default_diet TEXT NOT NULL DEFAULT 'vegetarian' CHECK (default_diet IN ('vegetarian', 'non_vegetarian')),
    meal_choices JSONB NOT NULL DEFAULT '{}'::jsonb,
    allergies_notes TEXT CHECK (length(allergies_notes) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_trip_member_meal_preferences UNIQUE (trip_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_meal_preferences_trip ON public.trip_meal_preferences(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_meal_preferences_member ON public.trip_meal_preferences(member_id);

-- 2. Row Level Security for trip_meal_preferences
ALTER TABLE public.trip_meal_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.trip_meal_preferences FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_meal_preferences TO authenticated;
GRANT ALL ON public.trip_meal_preferences TO service_role;

DROP POLICY IF EXISTS trip_meal_preferences_select ON public.trip_meal_preferences;
CREATE POLICY trip_meal_preferences_select ON public.trip_meal_preferences
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.camping_trips ct
            WHERE ct.id = trip_meal_preferences.trip_id
            AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS trip_meal_preferences_insert ON public.trip_meal_preferences;
CREATE POLICY trip_meal_preferences_insert ON public.trip_meal_preferences
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            JOIN public.trip_rsvps r ON r.member_id = mp.member_id
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
            AND mp.member_id = trip_meal_preferences.member_id
            AND mp.account_status = 'active'
            AND r.trip_id = trip_meal_preferences.trip_id
            AND r.response = 'coming'
        )
    );

DROP POLICY IF EXISTS trip_meal_preferences_update ON public.trip_meal_preferences;
CREATE POLICY trip_meal_preferences_update ON public.trip_meal_preferences
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            JOIN public.trip_rsvps r ON r.member_id = mp.member_id
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
            AND mp.member_id = trip_meal_preferences.member_id
            AND mp.account_status = 'active'
            AND r.trip_id = trip_meal_preferences.trip_id
            AND r.response = 'coming'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            JOIN public.trip_rsvps r ON r.member_id = mp.member_id
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
            AND mp.member_id = trip_meal_preferences.member_id
            AND mp.account_status = 'active'
            AND r.trip_id = trip_meal_preferences.trip_id
            AND r.response = 'coming'
        )
    );

DROP POLICY IF EXISTS trip_meal_preferences_delete ON public.trip_meal_preferences;
CREATE POLICY trip_meal_preferences_delete ON public.trip_meal_preferences
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
            AND (mp.member_id = trip_meal_preferences.member_id OR mp.member_role = 'admin')
            AND mp.account_status = 'active'
        )
    );

-- 3. Update phase2_submit_rsvp with auto-release logic
CREATE OR REPLACE FUNCTION public.phase2_submit_rsvp(
  p_auth_user_id UUID, p_trip_id UUID, p_response TEXT, p_bundle_id UUID, p_content_hash TEXT, p_expected_version INTEGER, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,private AS $$
DECLARE
  v_member UUID;
  v_trip public.camping_trips%ROWTYPE;
  v_old public.trip_rsvps%ROWTYPE;
  v_ack UUID;
  v_current_bundle public.trip_rule_bundles%ROWTYPE;
  v_id UUID;
  v_version INTEGER;
  v_event TEXT;
  v_existing BOOLEAN;
BEGIN
  IF p_auth_user_id IS NULL OR p_response NOT IN ('coming','not_coming') OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid RSVP';
  END IF;
  SELECT member_id INTO v_member FROM public.member_profiles WHERE auth_user_id=p_auth_user_id AND account_status='active' AND member_role IN ('member','admin');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active member required' USING errcode='42501';
  END IF;
  SELECT * INTO v_trip FROM public.camping_trips WHERE id=p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll not found';
  END IF;
  IF v_trip.deleted_at IS NOT NULL OR v_trip.event_status='cancelled' OR v_trip.poll_status='draft' OR v_trip.ends_on IS NULL OR v_trip.ends_on < (now() AT TIME ZONE coalesce(v_trip.club_timezone_snapshot,'America/Los_Angeles'))::date THEN
    RAISE EXCEPTION 'camping event is closed';
  END IF;
  IF p_response='coming' AND (NOT EXISTS(SELECT 1 FROM public.trip_rsvps WHERE trip_id=p_trip_id AND member_id=v_member AND response='coming')) THEN
    PERFORM private.phase2_build_rule_bundle(p_trip_id,v_member);
  END IF;
  SELECT * INTO v_old FROM public.trip_rsvps WHERE trip_id=p_trip_id AND member_id=v_member FOR UPDATE;
  v_existing:=FOUND;
  IF v_existing THEN
    IF p_expected_version IS NULL OR p_expected_version<>v_old.version THEN
      RAISE EXCEPTION 'stale RSVP version' USING errcode='40001';
    END IF;
    v_id:=v_old.id;
    v_version:=v_old.version+1;
    v_ack:=v_old.rule_acknowledgment_id;
  ELSE
    IF coalesce(p_expected_version,0)<>0 THEN
      RAISE EXCEPTION 'stale RSVP version' USING errcode='40001';
    END IF;
    v_id:=gen_random_uuid();
    v_version:=1;
  END IF;
  IF p_response='coming' AND (NOT v_existing OR v_old.response<>'coming') THEN
    SELECT * INTO v_current_bundle FROM public.trip_rule_bundles WHERE trip_id=p_trip_id AND is_current;
    IF v_current_bundle.id IS NULL OR p_bundle_id IS DISTINCT FROM v_current_bundle.id OR p_content_hash IS DISTINCT FROM v_current_bundle.content_hash THEN
      RAISE EXCEPTION 'current Camping Constitution acknowledgment required' USING errcode='22023';
    END IF;
    SELECT id INTO v_ack FROM public.trip_rule_acknowledgments WHERE member_id=v_member AND trip_id=p_trip_id AND bundle_id=v_current_bundle.id AND statement_version='coming-v1';
    IF v_ack IS NULL THEN
      INSERT INTO public.trip_rule_acknowledgments(trip_id,member_id,bundle_id,content_hash,statement_version,request_id)
        VALUES(p_trip_id,v_member,v_current_bundle.id,v_current_bundle.content_hash,'coming-v1',p_request_id) RETURNING id INTO v_ack;
    END IF;
  ELSIF p_response='coming' AND v_ack IS NULL THEN
    RAISE EXCEPTION 'current Camping Constitution acknowledgment required' USING errcode='22023';
  END IF;
  IF p_response='coming' AND (NOT v_existing OR v_old.response<>'coming') AND v_trip.max_capacity IS NOT NULL
    AND (SELECT count(*) FROM public.trip_rsvps WHERE trip_id=p_trip_id AND response='coming')>=v_trip.max_capacity THEN
    RAISE EXCEPTION 'interest poll capacity reached' USING errcode='22023';
  END IF;
  IF v_existing THEN
    UPDATE public.trip_rsvps SET response=p_response,rule_acknowledgment_id=v_ack,version=v_version,updated_at=now() WHERE id=v_id;
    v_event:=CASE WHEN v_old.response=p_response THEN NULL ELSE 'changed' END;
  ELSE
    INSERT INTO public.trip_rsvps(id,trip_id,member_id,response,rule_acknowledgment_id,version) VALUES(v_id,p_trip_id,v_member,p_response,v_ack,v_version);
    v_event:='submitted';
  END IF;
  IF v_event IS NOT NULL THEN
    INSERT INTO public.trip_rsvp_events(trip_id,member_id,actor_id,event_type,from_response,to_response,rule_acknowledgment_id,request_id)
      VALUES(p_trip_id,v_member,v_member,v_event,CASE WHEN v_existing THEN v_old.response ELSE NULL END,p_response,v_ack,p_request_id);
  END IF;

  IF p_response='not_coming' THEN
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
  END IF;

  RETURN jsonb_build_object('rsvpId',v_id,'response',p_response,'version',v_version,'acknowledgmentId',v_ack);
END $$;

REVOKE ALL ON FUNCTION public.phase2_submit_rsvp(UUID,UUID,TEXT,UUID,TEXT,INTEGER,UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_submit_rsvp(UUID,UUID,TEXT,UUID,TEXT,INTEGER,UUID) TO service_role;

-- 4. Update phase2_admin_record_interest with auto-release logic
CREATE OR REPLACE FUNCTION public.phase2_admin_record_interest(
  p_actor_id UUID, p_trip_id UUID, p_member_id UUID, p_response TEXT, p_expected_version INTEGER, p_reason TEXT, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,private AS $$
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
  IF p_response NOT IN ('coming','not_coming') OR p_reason IS NULL OR length(btrim(p_reason))=0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid administrator poll entry';
  END IF;
  SELECT * INTO v_trip FROM public.camping_trips WHERE id=p_trip_id FOR UPDATE;
  IF NOT FOUND OR v_trip.deleted_at IS NOT NULL OR v_trip.event_status='cancelled' OR v_trip.poll_status='draft' OR v_trip.ends_on IS NULL OR v_trip.ends_on < (now() AT TIME ZONE coalesce(v_trip.club_timezone_snapshot,'America/Los_Angeles'))::date THEN
    RAISE EXCEPTION 'camping event is closed';
  END IF;
  SELECT * INTO v_member FROM public.member_profiles WHERE member_id=p_member_id AND account_status='active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active member required';
  END IF;
  IF p_response='coming' AND NOT EXISTS(SELECT 1 FROM public.trip_rsvps WHERE trip_id=p_trip_id AND member_id=p_member_id AND response='coming') THEN
    PERFORM private.phase2_build_rule_bundle(p_trip_id,p_actor_id);
  END IF;
  SELECT * INTO v_old FROM public.trip_rsvps WHERE trip_id=p_trip_id AND member_id=p_member_id FOR UPDATE;
  IF FOUND THEN
    IF p_expected_version IS NULL OR v_old.version<>p_expected_version THEN
      RAISE EXCEPTION 'stale RSVP version' USING errcode='40001';
    END IF;
    v_id:=v_old.id; v_version:=v_old.version+1; v_ack:=v_old.rule_acknowledgment_id;
  ELSE
    IF coalesce(p_expected_version,0)<>0 THEN
      RAISE EXCEPTION 'stale RSVP version' USING errcode='40001';
    END IF;
    v_id:=gen_random_uuid(); v_version:=1;
  END IF;
  IF p_response='coming' THEN
    SELECT id INTO v_bundle FROM public.trip_rule_bundles WHERE trip_id=p_trip_id AND is_current;
    IF v_old.rule_acknowledgment_id IS NOT NULL AND v_old.response='coming' THEN
      v_ack:=v_old.rule_acknowledgment_id;
    ELSE
      SELECT id INTO v_ack FROM public.trip_rule_acknowledgments WHERE member_id=p_member_id AND trip_id=p_trip_id AND bundle_id=v_bundle AND statement_version='coming-v1';
      IF v_ack IS NULL THEN
        RAISE EXCEPTION 'member must personally acknowledge the current rule bundle';
      END IF;
    END IF;
    IF v_trip.max_capacity IS NOT NULL AND (v_old.id IS NULL OR v_old.response<>'coming')
      AND (SELECT count(*) FROM public.trip_rsvps WHERE trip_id=p_trip_id AND response='coming')>=v_trip.max_capacity THEN
      RAISE EXCEPTION 'interest poll capacity reached';
    END IF;
  END IF;
  IF v_old.id IS NULL THEN
    INSERT INTO public.trip_rsvps(id,trip_id,member_id,response,rule_acknowledgment_id,version)
      VALUES(v_id,p_trip_id,p_member_id,p_response,v_ack,v_version);
  ELSE
    UPDATE public.trip_rsvps
      SET response=p_response,rule_acknowledgment_id=v_ack,version=v_version,updated_at=now()
      WHERE id=v_id;
  END IF;
  INSERT INTO public.trip_rsvp_events(trip_id,member_id,actor_id,event_type,from_response,to_response,rule_acknowledgment_id,request_id,reason)
    VALUES(p_trip_id,p_member_id,p_actor_id,'admin_interest_recorded',CASE WHEN v_old.id IS NOT NULL THEN v_old.response ELSE NULL END,p_response,v_ack,p_request_id,btrim(p_reason));

  IF p_response='not_coming' THEN
    -- Delete active duty assignments
    DELETE FROM public.trip_duty_assignments
    WHERE trip_id = p_trip_id AND member_id = p_member_id AND status IN ('claimed', 'assigned_by_admin');

    -- Release shared gear/food commitments
    UPDATE public.trip_commitments
    SET assigned_member_id = NULL, updated_at = now()
    WHERE trip_id = p_trip_id AND assigned_member_id = p_member_id;

    -- Delete meal preferences
    DELETE FROM public.trip_meal_preferences
    WHERE trip_id = p_trip_id AND member_id = p_member_id;
  END IF;

  RETURN jsonb_build_object('rsvpId',v_id,'response',p_response,'version',v_version,'acknowledgmentId',v_ack);
END $$;

REVOKE ALL ON FUNCTION public.phase2_admin_record_interest(UUID,UUID,UUID,TEXT,INTEGER,TEXT,UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_admin_record_interest(UUID,UUID,UUID,TEXT,INTEGER,TEXT,UUID) TO service_role;

-- 5. Update phase4_manage_commitment with "not_coming" guardrail
CREATE OR REPLACE FUNCTION public.phase4_manage_commitment(
    p_trip_id UUID,
    p_action TEXT,
    p_commitment_id UUID DEFAULT NULL,
    p_category TEXT DEFAULT NULL,
    p_item_name TEXT DEFAULT NULL,
    p_quantity TEXT DEFAULT NULL,
    p_is_critical BOOLEAN DEFAULT FALSE,
    p_assigned_member_id UUID DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL,
    p_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_commitment public.trip_commitments%ROWTYPE;
    v_result JSONB;
BEGIN
    IF p_action = 'claim' THEN
        -- Only confirmed attendees ('coming') may volunteer for commitments
        IF NOT EXISTS (
            SELECT 1 FROM public.trip_rsvps
            WHERE trip_id = p_trip_id AND member_id = p_actor_id AND response = 'coming'
        ) THEN
            RAISE EXCEPTION 'unauthorized: only confirmed attendees may volunteer for commitments' USING ERRCODE = '42501';
        END IF;

        SELECT * INTO v_commitment FROM public.trip_commitments WHERE id = p_commitment_id AND trip_id = p_trip_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Commitment not found.' USING ERRCODE = '22023';
        END IF;

        IF v_commitment.assigned_member_id IS NOT NULL AND v_commitment.assigned_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Item is already claimed by another member.' USING ERRCODE = '22023';
        END IF;

        UPDATE public.trip_commitments
        SET assigned_member_id = p_actor_id, updated_at = now()
        WHERE id = p_commitment_id;

        RETURN jsonb_build_object('success', true, 'action', 'claim', 'commitment_id', p_commitment_id, 'assigned_member_id', p_actor_id);

    ELSIF p_action = 'unclaim' THEN
        SELECT * INTO v_commitment FROM public.trip_commitments WHERE id = p_commitment_id AND trip_id = p_trip_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Commitment not found.' USING ERRCODE = '22023';
        END IF;

        IF v_commitment.assigned_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Cannot unclaim item claimed by another member.' USING ERRCODE = '42501';
        END IF;

        UPDATE public.trip_commitments
        SET assigned_member_id = NULL, updated_at = now()
        WHERE id = p_commitment_id;

        RETURN jsonb_build_object('success', true, 'action', 'unclaim', 'commitment_id', p_commitment_id);

    ELSIF p_action = 'admin_create' THEN
        IF NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can add commitments.' USING ERRCODE = '42501';
        END IF;

        IF p_item_name IS NULL OR trim(p_item_name) = '' THEN
            RAISE EXCEPTION 'Item name is required.' USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.trip_commitments (
            trip_id, category, item_name, quantity_description, is_critical, assigned_member_id
        ) VALUES (
            p_trip_id,
            COALESCE(p_category, 'supplies'),
            trim(p_item_name),
            trim(p_quantity),
            COALESCE(p_is_critical, false),
            p_assigned_member_id
        ) RETURNING * INTO v_commitment;

        RETURN jsonb_build_object('success', true, 'action', 'admin_create', 'commitment_id', v_commitment.id);

    ELSIF p_action = 'admin_update' THEN
        IF NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can update commitments.' USING ERRCODE = '42501';
        END IF;

        UPDATE public.trip_commitments
        SET
            category = COALESCE(p_category, category),
            item_name = COALESCE(trim(p_item_name), item_name),
            quantity_description = trim(p_quantity),
            is_critical = COALESCE(p_is_critical, is_critical),
            assigned_member_id = p_assigned_member_id,
            updated_at = now()
        WHERE id = p_commitment_id AND trip_id = p_trip_id;

        RETURN jsonb_build_object('success', true, 'action', 'admin_update', 'commitment_id', p_commitment_id);

    ELSIF p_action = 'admin_delete' THEN
        IF NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can delete commitments.' USING ERRCODE = '42501';
        END IF;

        DELETE FROM public.trip_commitments WHERE id = p_commitment_id AND trip_id = p_trip_id;

        RETURN jsonb_build_object('success', true, 'action', 'admin_delete', 'commitment_id', p_commitment_id);

    ELSE
        RAISE EXCEPTION 'Unsupported commitment action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase4_manage_commitment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase4_manage_commitment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, UUID, UUID, BOOLEAN) TO authenticated, service_role;

-- 6. Update phase2_request_withdrawal with auto-release logic on immediate withdrawal
CREATE OR REPLACE FUNCTION public.phase2_request_withdrawal(p_auth_user_id UUID, p_trip_id UUID, p_reason TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,private AS $$
DECLARE
  v_member UUID;
  v_trip public.camping_trips%ROWTYPE;
  v_rsvp public.trip_rsvps%ROWTYPE;
  v_request UUID;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'a withdrawal reason is required';
  END IF;
  SELECT member_id INTO v_member FROM public.member_profiles WHERE auth_user_id=p_auth_user_id AND account_status='active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active member required' USING errcode='42501';
  END IF;
  SELECT * INTO v_trip FROM public.camping_trips WHERE id=p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll not found';
  END IF;
  SELECT * INTO v_rsvp FROM public.trip_rsvps WHERE trip_id=p_trip_id AND member_id=v_member FOR UPDATE;
  IF NOT FOUND OR v_rsvp.response<>'coming' THEN
    RAISE EXCEPTION 'only a Coming response can be withdrawn';
  END IF;
  IF v_trip.poll_status='open' AND v_trip.poll_deadline_at>now() THEN
    UPDATE public.trip_rsvps SET response='not_coming',version=version+1,updated_at=now() WHERE id=v_rsvp.id RETURNING * INTO v_rsvp;
    INSERT INTO public.trip_rsvp_events(trip_id,member_id,actor_id,event_type,from_response,to_response,rule_acknowledgment_id,request_id,reason)
      VALUES(p_trip_id,v_member,v_member,'changed','coming','not_coming',v_rsvp.rule_acknowledgment_id,p_request_id,btrim(p_reason));

    -- Release duties, commitments, and meal preferences
    DELETE FROM public.trip_duty_assignments
    WHERE trip_id = p_trip_id AND member_id = v_member AND status IN ('claimed', 'assigned_by_admin');

    UPDATE public.trip_commitments
    SET assigned_member_id = NULL, updated_at = now()
    WHERE trip_id = p_trip_id AND assigned_member_id = v_member;

    DELETE FROM public.trip_meal_preferences
    WHERE trip_id = p_trip_id AND member_id = v_member;

    RETURN jsonb_build_object('state','withdrawn_from_interest_poll','response','not_coming','version',v_rsvp.version);
  END IF;
  INSERT INTO public.trip_withdrawal_requests(trip_id,member_id,reason,request_id) VALUES(p_trip_id,v_member,btrim(p_reason),p_request_id) RETURNING id INTO v_request;
  INSERT INTO public.trip_rsvp_events(trip_id,member_id,actor_id,event_type,from_response,to_response,rule_acknowledgment_id,request_id,reason)
    VALUES(p_trip_id,v_member,v_member,'withdrawal_requested','coming','coming',v_rsvp.rule_acknowledgment_id,p_request_id,btrim(p_reason));
  RETURN jsonb_build_object('state','pending_owner_policy','requestId',v_request,'response','coming');
END $$;

REVOKE ALL ON FUNCTION public.phase2_request_withdrawal(UUID,UUID,TEXT,UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_request_withdrawal(UUID,UUID,TEXT,UUID) TO service_role;
