-- Migration: Add waiver_url to master/trip activities, waiver tracking with click intelligence, and readiness scorecard checkmark support
-- 20261024060000_activity_waiver_and_scorecard_readiness.sql

-- 1. Add waiver_url columns
ALTER TABLE public.master_activities ADD COLUMN IF NOT EXISTS waiver_url TEXT;
ALTER TABLE public.trip_activities ADD COLUMN IF NOT EXISTS waiver_url TEXT;

-- 2. Add waiver tracking timestamps to trip_activity_participants
ALTER TABLE public.trip_activity_participants ADD COLUMN IF NOT EXISTS waiver_clicked_at TIMESTAMPTZ;
ALTER TABLE public.trip_activity_participants ADD COLUMN IF NOT EXISTS waiver_signed_at TIMESTAMPTZ;

-- 3. Update phase6_manage_master_activity to support waiver_url
CREATE OR REPLACE FUNCTION public.phase6_manage_master_activity(
    p_action TEXT,
    p_id UUID DEFAULT NULL,
    p_payload JSONB DEFAULT '{}'::JSONB,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor public.member_profiles%ROWTYPE;
    v_id UUID;
    v_title TEXT;
BEGIN
    SELECT * INTO v_actor
    FROM public.member_profiles
    WHERE (member_id = p_actor_id OR auth_user_id = p_actor_id)
      AND account_status = 'active';

    IF NOT FOUND OR v_actor.member_role NOT IN ('admin', 'administrator') THEN
        RAISE EXCEPTION 'Only administrators can manage the master activity catalog.' USING ERRCODE = '42501';
    END IF;

    IF p_action = 'create' THEN
        v_title := trim(COALESCE(p_payload->>'title', ''));
        IF v_title = '' THEN
            RAISE EXCEPTION 'Activity title is required.' USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.master_activities (
            title,
            category,
            image_url,
            location_name,
            address,
            directions_url,
            booking_url,
            waiver_url,
            unit_label,
            unit_capacity,
            booking_notes,
            is_active
        ) VALUES (
            v_title,
            COALESCE(NULLIF(trim(p_payload->>'category'), ''), 'other'),
            NULLIF(trim(p_payload->>'image_url'), ''),
            NULLIF(trim(p_payload->>'location_name'), ''),
            NULLIF(trim(p_payload->>'address'), ''),
            NULLIF(trim(p_payload->>'directions_url'), ''),
            NULLIF(trim(p_payload->>'booking_url'), ''),
            NULLIF(trim(p_payload->>'waiver_url'), ''),
            COALESCE(NULLIF(trim(p_payload->>'unit_label'), ''), 'Vehicle'),
            COALESCE((p_payload->>'unit_capacity')::INTEGER, 2),
            NULLIF(trim(p_payload->>'booking_notes'), ''),
            COALESCE((p_payload->>'is_active')::BOOLEAN, true)
        ) RETURNING id INTO v_id;

        RETURN jsonb_build_object('success', true, 'action', 'create', 'id', v_id);

    ELSIF p_action = 'update' THEN
        IF p_id IS NULL THEN
            RAISE EXCEPTION 'Master activity id is required for update.' USING ERRCODE = '22023';
        END IF;

        UPDATE public.master_activities
        SET
            title = COALESCE(NULLIF(trim(p_payload->>'title'), ''), title),
            category = COALESCE(NULLIF(trim(p_payload->>'category'), ''), category),
            image_url = CASE WHEN p_payload ? 'image_url' THEN NULLIF(trim(p_payload->>'image_url'), '') ELSE image_url END,
            location_name = CASE WHEN p_payload ? 'location_name' THEN NULLIF(trim(p_payload->>'location_name'), '') ELSE location_name END,
            address = CASE WHEN p_payload ? 'address' THEN NULLIF(trim(p_payload->>'address'), '') ELSE address END,
            directions_url = CASE WHEN p_payload ? 'directions_url' THEN NULLIF(trim(p_payload->>'directions_url'), '') ELSE directions_url END,
            booking_url = CASE WHEN p_payload ? 'booking_url' THEN NULLIF(trim(p_payload->>'booking_url'), '') ELSE booking_url END,
            waiver_url = CASE WHEN p_payload ? 'waiver_url' THEN NULLIF(trim(p_payload->>'waiver_url'), '') ELSE waiver_url END,
            unit_label = COALESCE(NULLIF(trim(p_payload->>'unit_label'), ''), unit_label),
            unit_capacity = COALESCE((p_payload->>'unit_capacity')::INTEGER, unit_capacity),
            booking_notes = CASE WHEN p_payload ? 'booking_notes' THEN NULLIF(trim(p_payload->>'booking_notes'), '') ELSE booking_notes END,
            is_active = COALESCE((p_payload->>'is_active')::BOOLEAN, is_active),
            updated_at = now()
        WHERE id = p_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Master activity not found.' USING ERRCODE = '22023';
        END IF;

        RETURN jsonb_build_object('success', true, 'action', 'update', 'id', p_id);

    ELSIF p_action = 'delete' THEN
        IF p_id IS NULL THEN
            RAISE EXCEPTION 'Master activity id is required for delete.' USING ERRCODE = '22023';
        END IF;

        DELETE FROM public.master_activities WHERE id = p_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Master activity not found.' USING ERRCODE = '22023';
        END IF;

        RETURN jsonb_build_object('success', true, 'action', 'delete', 'id', p_id);

    ELSE
        RAISE EXCEPTION 'Unsupported action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase6_manage_master_activity FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase6_manage_master_activity TO authenticated, service_role;

-- 4. Update phase6_manage_trip_activity to support waiver_url
CREATE OR REPLACE FUNCTION public.phase6_manage_trip_activity(
    p_action TEXT,
    p_trip_id UUID,
    p_activity_id UUID DEFAULT NULL,
    p_payload JSONB DEFAULT '{}'::JSONB,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor public.member_profiles%ROWTYPE;
    v_trip public.camping_trips%ROWTYPE;
    v_master public.master_activities%ROWTYPE;
    v_activity_id UUID;
    v_master_id UUID;
    v_title TEXT;
    v_category TEXT;
    v_image_url TEXT;
    v_activity_date DATE;
    v_start_time TIME;
    v_end_time TIME;
    v_location_name TEXT;
    v_address TEXT;
    v_directions_url TEXT;
    v_booking_url TEXT;
    v_waiver_url TEXT;
    v_unit_label TEXT;
    v_unit_capacity INTEGER;
    v_booking_notes TEXT;
    v_opt_out_policy TEXT;
    v_num_groups INTEGER := 0;
    v_attendee_count INTEGER := 0;
BEGIN
    SELECT * INTO v_actor
    FROM public.member_profiles
    WHERE (member_id = p_actor_id OR auth_user_id = p_actor_id)
      AND account_status = 'active';

    IF NOT FOUND OR v_actor.member_role NOT IN ('admin', 'administrator') THEN
        RAISE EXCEPTION 'Only administrators can manage trip activities.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_trip FROM public.camping_trips WHERE id = p_trip_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Camping trip not found.' USING ERRCODE = '22023';
    END IF;

    IF p_action IN ('create', 'clone') THEN
        IF p_action = 'clone' OR (p_payload ? 'master_activity_id' AND p_payload->>'master_activity_id' IS NOT NULL) THEN
            SELECT * INTO v_master FROM public.master_activities WHERE id = (p_payload->>'master_activity_id')::UUID;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Master activity not found.' USING ERRCODE = '22023';
            END IF;
            v_master_id := v_master.id;
            v_title := COALESCE(NULLIF(trim(p_payload->>'title'), ''), v_master.title);
            v_category := COALESCE(NULLIF(trim(p_payload->>'category'), ''), v_master.category, 'other');
            v_image_url := COALESCE(NULLIF(trim(p_payload->>'image_url'), ''), v_master.image_url);
            v_location_name := COALESCE(NULLIF(trim(p_payload->>'location_name'), ''), v_master.location_name);
            v_address := COALESCE(NULLIF(trim(p_payload->>'address'), ''), v_master.address);
            v_directions_url := COALESCE(NULLIF(trim(p_payload->>'directions_url'), ''), v_master.directions_url);
            v_booking_url := COALESCE(NULLIF(trim(p_payload->>'booking_url'), ''), v_master.booking_url);
            v_waiver_url := COALESCE(NULLIF(trim(p_payload->>'waiver_url'), ''), v_master.waiver_url);
            v_unit_label := COALESCE(NULLIF(trim(p_payload->>'unit_label'), ''), v_master.unit_label, 'Vehicle');
            v_unit_capacity := COALESCE((p_payload->>'unit_capacity')::INTEGER, v_master.unit_capacity, 2);
            v_booking_notes := COALESCE(NULLIF(trim(p_payload->>'booking_notes'), ''), v_master.booking_notes);
        ELSE
            v_master_id := NULL;
            v_title := trim(COALESCE(p_payload->>'title', ''));
            IF v_title = '' THEN
                RAISE EXCEPTION 'Activity title is required.' USING ERRCODE = '22023';
            END IF;
            v_category := COALESCE(NULLIF(trim(p_payload->>'category'), ''), 'other');
            v_image_url := NULLIF(trim(p_payload->>'image_url'), '');
            v_location_name := NULLIF(trim(p_payload->>'location_name'), '');
            v_address := NULLIF(trim(p_payload->>'address'), '');
            v_directions_url := NULLIF(trim(p_payload->>'directions_url'), '');
            v_booking_url := NULLIF(trim(p_payload->>'booking_url'), '');
            v_waiver_url := NULLIF(trim(p_payload->>'waiver_url'), '');
            v_unit_label := COALESCE(NULLIF(trim(p_payload->>'unit_label'), ''), 'Vehicle');
            v_unit_capacity := COALESCE((p_payload->>'unit_capacity')::INTEGER, 2);
            v_booking_notes := NULLIF(trim(p_payload->>'booking_notes'), '');
        END IF;

        v_activity_date := COALESCE((p_payload->>'activity_date')::DATE, v_trip.starts_on);
        v_start_time := (p_payload->>'start_time')::TIME;
        v_end_time := (p_payload->>'end_time')::TIME;
        v_opt_out_policy := COALESCE(NULLIF(trim(p_payload->>'opt_out_policy'), ''), 'locked_on_voucher');

        INSERT INTO public.trip_activities (
            trip_id,
            master_activity_id,
            title,
            category,
            image_url,
            activity_date,
            start_time,
            end_time,
            location_name,
            address,
            directions_url,
            booking_url,
            waiver_url,
            unit_label,
            unit_capacity,
            booking_notes,
            opt_out_policy
        ) VALUES (
            p_trip_id,
            v_master_id,
            v_title,
            v_category,
            v_image_url,
            v_activity_date,
            v_start_time,
            v_end_time,
            v_location_name,
            v_address,
            v_directions_url,
            v_booking_url,
            v_waiver_url,
            v_unit_label,
            v_unit_capacity,
            v_booking_notes,
            v_opt_out_policy
        ) RETURNING id INTO v_activity_id;

        IF p_payload ? 'group_count' THEN
            v_num_groups := (p_payload->>'group_count')::INTEGER;
        ELSIF COALESCE((p_payload->>'auto_initialize_groups')::BOOLEAN, false) THEN
            SELECT count(*) INTO v_attendee_count
            FROM public.trip_rsvps
            WHERE trip_id = p_trip_id AND response = 'coming';

            IF v_attendee_count > 0 THEN
                v_num_groups := CEIL(v_attendee_count::numeric / GREATEST(v_unit_capacity, 1));
            ELSE
                v_num_groups := 1;
            END IF;
        ELSE
            v_num_groups := 0;
        END IF;

        IF v_num_groups > 0 THEN
            FOR i IN 1..v_num_groups LOOP
                INSERT INTO public.trip_activity_groups (activity_id, group_number, group_name)
                VALUES (v_activity_id, i, v_unit_label || ' #' || i)
                ON CONFLICT (activity_id, group_number) DO NOTHING;
            END LOOP;
        END IF;

        RETURN jsonb_build_object('success', true, 'action', p_action, 'activity_id', v_activity_id);

    ELSIF p_action = 'update' THEN
        IF p_activity_id IS NULL THEN
            RAISE EXCEPTION 'Activity id is required for update.' USING ERRCODE = '22023';
        END IF;

        UPDATE public.trip_activities
        SET
            title = COALESCE(NULLIF(trim(p_payload->>'title'), ''), title),
            category = COALESCE(NULLIF(trim(p_payload->>'category'), ''), category),
            image_url = CASE WHEN p_payload ? 'image_url' THEN NULLIF(trim(p_payload->>'image_url'), '') ELSE image_url END,
            activity_date = COALESCE((p_payload->>'activity_date')::DATE, activity_date),
            start_time = CASE WHEN p_payload ? 'start_time' THEN (p_payload->>'start_time')::TIME ELSE start_time END,
            end_time = CASE WHEN p_payload ? 'end_time' THEN (p_payload->>'end_time')::TIME ELSE end_time END,
            location_name = CASE WHEN p_payload ? 'location_name' THEN NULLIF(trim(p_payload->>'location_name'), '') ELSE location_name END,
            address = CASE WHEN p_payload ? 'address' THEN NULLIF(trim(p_payload->>'address'), '') ELSE address END,
            directions_url = CASE WHEN p_payload ? 'directions_url' THEN NULLIF(trim(p_payload->>'directions_url'), '') ELSE directions_url END,
            booking_url = CASE WHEN p_payload ? 'booking_url' THEN NULLIF(trim(p_payload->>'booking_url'), '') ELSE booking_url END,
            waiver_url = CASE WHEN p_payload ? 'waiver_url' THEN NULLIF(trim(p_payload->>'waiver_url'), '') ELSE waiver_url END,
            unit_label = COALESCE(NULLIF(trim(p_payload->>'unit_label'), ''), unit_label),
            unit_capacity = COALESCE((p_payload->>'unit_capacity')::INTEGER, unit_capacity),
            booking_notes = CASE WHEN p_payload ? 'booking_notes' THEN NULLIF(trim(p_payload->>'booking_notes'), '') ELSE booking_notes END,
            opt_out_policy = COALESCE(NULLIF(trim(p_payload->>'opt_out_policy'), ''), opt_out_policy),
            is_pairings_locked = COALESCE((p_payload->>'is_pairings_locked')::BOOLEAN, is_pairings_locked),
            updated_at = now()
        WHERE id = p_activity_id AND trip_id = p_trip_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Trip activity not found.' USING ERRCODE = '22023';
        END IF;

        RETURN jsonb_build_object('success', true, 'action', 'update', 'activity_id', p_activity_id);

    ELSIF p_action = 'delete' THEN
        IF p_activity_id IS NULL THEN
            RAISE EXCEPTION 'Activity id is required for delete.' USING ERRCODE = '22023';
        END IF;

        DELETE FROM public.trip_activities WHERE id = p_activity_id AND trip_id = p_trip_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Trip activity not found.' USING ERRCODE = '22023';
        END IF;

        RETURN jsonb_build_object('success', true, 'action', 'delete', 'activity_id', p_activity_id);

    ELSE
        RAISE EXCEPTION 'Unsupported action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase6_manage_trip_activity FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase6_manage_trip_activity TO authenticated, service_role;

-- 5. Function: phase6_update_activity_waiver
CREATE OR REPLACE FUNCTION public.phase6_update_activity_waiver(
    p_activity_id UUID,
    p_action TEXT,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor public.member_profiles%ROWTYPE;
    v_activity public.trip_activities%ROWTYPE;
    v_participant public.trip_activity_participants%ROWTYPE;
BEGIN
    SELECT * INTO v_actor
    FROM public.member_profiles
    WHERE (member_id = p_actor_id OR auth_user_id = p_actor_id)
      AND account_status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active member profile not found for actor.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_activity FROM public.trip_activities WHERE id = p_activity_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip activity not found.' USING ERRCODE = '22023';
    END IF;

    IF v_activity.waiver_url IS NULL OR trim(v_activity.waiver_url) = '' THEN
        RAISE EXCEPTION 'This activity does not require an external waiver.' USING ERRCODE = '22023';
    END IF;

    -- Ensure participant record exists
    SELECT * INTO v_participant
    FROM public.trip_activity_participants
    WHERE activity_id = p_activity_id AND member_id = v_actor.member_id;

    IF NOT FOUND THEN
        INSERT INTO public.trip_activity_participants (activity_id, member_id, status, updated_at)
        VALUES (p_activity_id, v_actor.member_id, 'attending', now())
        RETURNING * INTO v_participant;
    END IF;

    IF p_action = 'click' THEN
        UPDATE public.trip_activity_participants
        SET waiver_clicked_at = COALESCE(waiver_clicked_at, now()),
            updated_at = now()
        WHERE activity_id = p_activity_id AND member_id = v_actor.member_id
        RETURNING * INTO v_participant;

        RETURN jsonb_build_object(
            'success', true,
            'action', 'click',
            'activity_id', p_activity_id,
            'member_id', v_actor.member_id,
            'waiver_clicked_at', v_participant.waiver_clicked_at,
            'waiver_signed_at', v_participant.waiver_signed_at
        );

    ELSIF p_action = 'sign' THEN
        -- Intelligence verification: participant MUST have clicked the waiver link at least once
        IF v_participant.waiver_clicked_at IS NULL THEN
            RAISE EXCEPTION 'You must click the waiver link to review and complete the form before confirming.' USING ERRCODE = '22023';
        END IF;

        UPDATE public.trip_activity_participants
        SET waiver_signed_at = now(),
            updated_at = now()
        WHERE activity_id = p_activity_id AND member_id = v_actor.member_id
        RETURNING * INTO v_participant;

        RETURN jsonb_build_object(
            'success', true,
            'action', 'sign',
            'activity_id', p_activity_id,
            'member_id', v_actor.member_id,
            'waiver_clicked_at', v_participant.waiver_clicked_at,
            'waiver_signed_at', v_participant.waiver_signed_at
        );
    ELSE
        RAISE EXCEPTION 'Invalid waiver action: %. Must be click or sign.', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase6_update_activity_waiver FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase6_update_activity_waiver TO authenticated, service_role;
