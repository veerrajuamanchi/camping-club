-- Migration: Add booking_url to master_activities and trip_activities, and enhance activity pairings RPC
-- 20261024010000_add_activity_booking_url.sql

-- 1. Add booking_url columns
ALTER TABLE public.master_activities ADD COLUMN IF NOT EXISTS booking_url TEXT;
ALTER TABLE public.trip_activities ADD COLUMN IF NOT EXISTS booking_url TEXT;

-- 2. Update phase6_manage_master_activity
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

-- 3. Update phase6_manage_trip_activity
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

-- 4. Update phase6_manage_activity_pairings
CREATE OR REPLACE FUNCTION public.phase6_manage_activity_pairings(
    p_activity_id UUID,
    p_action TEXT,
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
    v_activity public.trip_activities%ROWTYPE;
    v_group public.trip_activity_groups%ROWTYPE;
    v_group_id UUID;
    v_member_id UUID;
    v_m_id UUID;
    v_member_ids UUID[];
    v_group_num INTEGER;
    v_group_name TEXT;
    v_unassigned UUID[];
    v_target_group_id UUID;
    v_item RECORD;
BEGIN
    SELECT * INTO v_actor
    FROM public.member_profiles
    WHERE (member_id = p_actor_id OR auth_user_id = p_actor_id)
      AND account_status = 'active';

    IF NOT FOUND OR v_actor.member_role NOT IN ('admin', 'administrator') THEN
        RAISE EXCEPTION 'Only administrators can manage activity pairings.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_activity FROM public.trip_activities WHERE id = p_activity_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Activity not found.' USING ERRCODE = '22023';
    END IF;

    IF p_action = 'create_group' THEN
        v_group_num := COALESCE(
            (p_payload->>'group_number')::INTEGER,
            (SELECT COALESCE(MAX(group_number), 0) + 1 FROM public.trip_activity_groups WHERE activity_id = p_activity_id)
        );
        v_group_name := COALESCE(
            NULLIF(trim(p_payload->>'group_label'), ''),
            NULLIF(trim(p_payload->>'group_name'), ''),
            v_activity.unit_label || ' #' || v_group_num
        );

        INSERT INTO public.trip_activity_groups (activity_id, group_number, group_name)
        VALUES (p_activity_id, v_group_num, v_group_name)
        RETURNING id INTO v_group_id;

        IF p_payload ? 'member_ids' AND jsonb_typeof(p_payload->'member_ids') = 'array' THEN
            SELECT array_agg(elem::text::uuid)
            INTO v_member_ids
            FROM jsonb_array_elements_text(p_payload->'member_ids') AS elem;

            IF v_member_ids IS NOT NULL AND cardinality(v_member_ids) > 0 THEN
                IF cardinality(v_member_ids) > v_activity.unit_capacity THEN
                    RAISE EXCEPTION 'Group capacity exceeded (max %).', v_activity.unit_capacity USING ERRCODE = '22023';
                END IF;

                IF (SELECT count(DISTINCT m) FROM unnest(v_member_ids) AS m) < cardinality(v_member_ids) THEN
                    RAISE EXCEPTION 'Duplicate members provided in assignment.' USING ERRCODE = '22023';
                END IF;

                FOREACH v_m_id IN ARRAY v_member_ids LOOP
                    PERFORM 1 FROM public.member_profiles WHERE member_id = v_m_id AND account_status = 'active';
                    IF NOT FOUND THEN
                        RAISE EXCEPTION 'Member % is not active.', v_m_id USING ERRCODE = '22023';
                    END IF;

                    PERFORM 1 FROM public.trip_activity_participants
                    WHERE activity_id = p_activity_id AND member_id = v_m_id AND status = 'opted_out';
                    IF FOUND THEN
                        RAISE EXCEPTION 'Member % has opted out of this activity.', v_m_id USING ERRCODE = '22023';
                    END IF;

                    IF EXISTS (SELECT 1 FROM public.trip_rsvps WHERE trip_id = v_activity.trip_id AND member_id = v_m_id) THEN
                        PERFORM 1 FROM public.trip_rsvps WHERE trip_id = v_activity.trip_id AND member_id = v_m_id AND response = 'coming';
                        IF NOT FOUND THEN
                            RAISE EXCEPTION 'Member % is not attending this trip.', v_m_id USING ERRCODE = '22023';
                        END IF;
                    END IF;

                    DELETE FROM public.trip_activity_group_members
                    WHERE member_id = v_m_id
                      AND group_id IN (SELECT id FROM public.trip_activity_groups WHERE activity_id = p_activity_id);

                    INSERT INTO public.trip_activity_group_members (group_id, member_id)
                    VALUES (v_group_id, v_m_id)
                    ON CONFLICT (group_id, member_id) DO NOTHING;

                    INSERT INTO public.trip_activity_participants (activity_id, member_id, status, updated_at)
                    VALUES (p_activity_id, v_m_id, 'attending', now())
                    ON CONFLICT (activity_id, member_id)
                    DO UPDATE SET status = 'attending', updated_at = now();
                END LOOP;
            END IF;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'action', 'create_group',
            'group_id', v_group_id,
            'group_number', v_group_num,
            'group_name', v_group_name
        );

    ELSIF p_action IN ('assign_members', 'set_group_members') THEN
        v_group_id := (p_payload->>'group_id')::UUID;
        IF v_group_id IS NULL THEN
            RAISE EXCEPTION 'Group id is required.' USING ERRCODE = '22023';
        END IF;

        SELECT * INTO v_group
        FROM public.trip_activity_groups
        WHERE id = v_group_id AND activity_id = p_activity_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Group not found for this activity.' USING ERRCODE = '22023';
        END IF;

        IF p_payload ? 'member_ids' AND jsonb_typeof(p_payload->'member_ids') = 'array' THEN
            SELECT array_agg(elem::text::uuid)
            INTO v_member_ids
            FROM jsonb_array_elements_text(p_payload->'member_ids') AS elem;
        ELSE
            v_member_ids := ARRAY[]::UUID[];
        END IF;

        IF v_member_ids IS NULL THEN
            v_member_ids := ARRAY[]::UUID[];
        END IF;

        IF cardinality(v_member_ids) > v_activity.unit_capacity THEN
            RAISE EXCEPTION 'Group capacity exceeded (max %).', v_activity.unit_capacity USING ERRCODE = '22023';
        END IF;

        IF (SELECT count(DISTINCT m) FROM unnest(v_member_ids) AS m) < cardinality(v_member_ids) THEN
            RAISE EXCEPTION 'Duplicate members provided in assignment.' USING ERRCODE = '22023';
        END IF;

        DELETE FROM public.trip_activity_group_members WHERE group_id = v_group_id;

        IF cardinality(v_member_ids) > 0 THEN
            FOREACH v_m_id IN ARRAY v_member_ids LOOP
                PERFORM 1 FROM public.member_profiles WHERE member_id = v_m_id AND account_status = 'active';
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Member % is not active.', v_m_id USING ERRCODE = '22023';
                END IF;

                PERFORM 1 FROM public.trip_activity_participants
                WHERE activity_id = p_activity_id AND member_id = v_m_id AND status = 'opted_out';
                IF FOUND THEN
                    RAISE EXCEPTION 'Member % has opted out of this activity.', v_m_id USING ERRCODE = '22023';
                END IF;

                IF EXISTS (SELECT 1 FROM public.trip_rsvps WHERE trip_id = v_activity.trip_id AND member_id = v_m_id) THEN
                    PERFORM 1 FROM public.trip_rsvps WHERE trip_id = v_activity.trip_id AND member_id = v_m_id AND response = 'coming';
                    IF NOT FOUND THEN
                        RAISE EXCEPTION 'Member % is not attending this trip.', v_m_id USING ERRCODE = '22023';
                    END IF;
                END IF;

                DELETE FROM public.trip_activity_group_members
                WHERE member_id = v_m_id
                  AND group_id IN (SELECT id FROM public.trip_activity_groups WHERE activity_id = p_activity_id);

                INSERT INTO public.trip_activity_group_members (group_id, member_id)
                VALUES (v_group_id, v_m_id)
                ON CONFLICT (group_id, member_id) DO NOTHING;

                INSERT INTO public.trip_activity_participants (activity_id, member_id, status, updated_at)
                VALUES (p_activity_id, v_m_id, 'attending', now())
                ON CONFLICT (activity_id, member_id)
                DO UPDATE SET status = 'attending', updated_at = now();
            END LOOP;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'action', p_action,
            'group_id', v_group_id,
            'member_ids', to_jsonb(v_member_ids)
        );

    ELSIF p_action = 'delete_group' THEN
        v_group_id := (p_payload->>'group_id')::UUID;
        IF v_group_id IS NULL THEN
            RAISE EXCEPTION 'Group id is required for delete_group.' USING ERRCODE = '22023';
        END IF;

        SELECT * INTO v_group
        FROM public.trip_activity_groups
        WHERE id = v_group_id AND activity_id = p_activity_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Group not found for this activity.' USING ERRCODE = '22023';
        END IF;

        IF v_group.voucher_status IN ('purchased', 'verified') OR v_group.voucher_code IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot delete group with a purchased or verified voucher.' USING ERRCODE = '22023';
        END IF;

        DELETE FROM public.trip_activity_group_members WHERE group_id = v_group_id;
        DELETE FROM public.trip_activity_groups WHERE id = v_group_id AND activity_id = p_activity_id;

        RETURN jsonb_build_object('success', true, 'action', 'delete_group', 'group_id', v_group_id);

    ELSIF p_action = 'assign' THEN
        v_group_id := (p_payload->>'group_id')::UUID;
        v_member_id := (p_payload->>'member_id')::UUID;

        PERFORM 1 FROM public.trip_activity_groups WHERE id = v_group_id AND activity_id = p_activity_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Group not found for this activity.' USING ERRCODE = '22023';
        END IF;

        DELETE FROM public.trip_activity_group_members
        WHERE member_id = v_member_id
          AND group_id IN (SELECT id FROM public.trip_activity_groups WHERE activity_id = p_activity_id);

        INSERT INTO public.trip_activity_group_members (group_id, member_id)
        VALUES (v_group_id, v_member_id)
        ON CONFLICT (group_id, member_id) DO NOTHING;

        RETURN jsonb_build_object('success', true, 'action', 'assign', 'group_id', v_group_id, 'member_id', v_member_id);

    ELSIF p_action = 'unassign' THEN
        v_member_id := (p_payload->>'member_id')::UUID;
        DELETE FROM public.trip_activity_group_members
        WHERE member_id = v_member_id
          AND group_id IN (SELECT id FROM public.trip_activity_groups WHERE activity_id = p_activity_id);

        RETURN jsonb_build_object('success', true, 'action', 'unassign', 'member_id', v_member_id);

    ELSIF p_action IN ('auto_assign', 'auto_shuffle') THEN
        SELECT array_agg(tap.member_id ORDER BY random())
        INTO v_unassigned
        FROM public.trip_activity_participants tap
        WHERE tap.activity_id = p_activity_id
          AND tap.status = 'attending'
          AND NOT EXISTS (
              SELECT 1 FROM public.trip_activity_group_members gm
              JOIN public.trip_activity_groups g ON g.id = gm.group_id
              WHERE g.activity_id = p_activity_id AND gm.member_id = tap.member_id
          );

        IF v_unassigned IS NOT NULL THEN
            FOREACH v_member_id IN ARRAY v_unassigned LOOP
                SELECT g.id INTO v_target_group_id
                FROM public.trip_activity_groups g
                LEFT JOIN public.trip_activity_group_members gm ON gm.group_id = g.id
                WHERE g.activity_id = p_activity_id
                GROUP BY g.id, g.group_number
                HAVING count(gm.id) < v_activity.unit_capacity
                ORDER BY g.group_number ASC
                LIMIT 1;

                IF v_target_group_id IS NULL THEN
                    v_group_num := (SELECT COALESCE(MAX(group_number), 0) + 1 FROM public.trip_activity_groups WHERE activity_id = p_activity_id);
                    INSERT INTO public.trip_activity_groups (activity_id, group_number, group_name)
                    VALUES (p_activity_id, v_group_num, v_activity.unit_label || ' #' || v_group_num)
                    RETURNING id INTO v_target_group_id;
                END IF;

                INSERT INTO public.trip_activity_group_members (group_id, member_id)
                VALUES (v_target_group_id, v_member_id)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;

        RETURN jsonb_build_object('success', true, 'action', p_action, 'activity_id', p_activity_id);

    ELSIF p_action = 'lock_pairings' THEN
        UPDATE public.trip_activities SET is_pairings_locked = true, updated_at = now() WHERE id = p_activity_id;
        RETURN jsonb_build_object('success', true, 'action', 'lock_pairings', 'is_pairings_locked', true);

    ELSIF p_action = 'unlock_pairings' THEN
        UPDATE public.trip_activities SET is_pairings_locked = false, updated_at = now() WHERE id = p_activity_id;
        RETURN jsonb_build_object('success', true, 'action', 'unlock_pairings', 'is_pairings_locked', false);

    ELSIF p_action = 'set_pairings' THEN
        IF p_payload ? 'assignments' THEN
            DELETE FROM public.trip_activity_group_members
            WHERE group_id IN (SELECT id FROM public.trip_activity_groups WHERE activity_id = p_activity_id);

            FOR v_item IN SELECT * FROM jsonb_to_recordset(p_payload->'assignments') AS x(group_id UUID, member_id UUID) LOOP
                INSERT INTO public.trip_activity_group_members (group_id, member_id)
                VALUES (v_item.group_id, v_item.member_id)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
        RETURN jsonb_build_object('success', true, 'action', 'set_pairings', 'activity_id', p_activity_id);

    ELSE
        RAISE EXCEPTION 'Unsupported pairings action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase6_manage_activity_pairings FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase6_manage_activity_pairings TO authenticated, service_role;
