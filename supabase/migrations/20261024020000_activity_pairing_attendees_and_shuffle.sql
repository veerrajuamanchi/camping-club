-- Migration: 20261024020000_activity_pairing_attendees_and_shuffle.sql
-- Description: Allow auto_shuffle and pairing assignments to include all confirmed trip attendees who have not opted out

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

        INSERT INTO public.trip_activity_participants (activity_id, member_id, status, updated_at)
        VALUES (p_activity_id, v_member_id, 'attending', now())
        ON CONFLICT (activity_id, member_id)
        DO UPDATE SET status = 'attending', updated_at = now();

        RETURN jsonb_build_object('success', true, 'action', 'assign', 'group_id', v_group_id, 'member_id', v_member_id);

    ELSIF p_action = 'unassign' THEN
        v_member_id := (p_payload->>'member_id')::UUID;
        DELETE FROM public.trip_activity_group_members
        WHERE member_id = v_member_id
          AND group_id IN (SELECT id FROM public.trip_activity_groups WHERE activity_id = p_activity_id);

        RETURN jsonb_build_object('success', true, 'action', 'unassign', 'member_id', v_member_id);

    ELSIF p_action IN ('auto_assign', 'auto_shuffle') THEN
        -- Select all unassigned members who are either registered as 'attending' the activity
        -- OR are confirmed attendees of the trip ('coming') and have not opted out of the activity
        SELECT array_agg(DISTINCT m.member_id ORDER BY random())
        INTO v_unassigned
        FROM (
            SELECT r.member_id
            FROM public.trip_rsvps r
            JOIN public.member_profiles mp ON mp.member_id = r.member_id
            WHERE r.trip_id = v_activity.trip_id
              AND r.response = 'coming'
              AND mp.account_status = 'active'
            UNION
            SELECT tap.member_id
            FROM public.trip_activity_participants tap
            JOIN public.member_profiles mp ON mp.member_id = tap.member_id
            WHERE tap.activity_id = p_activity_id
              AND tap.status = 'attending'
              AND mp.account_status = 'active'
        ) m
        WHERE NOT EXISTS (
            SELECT 1 FROM public.trip_activity_participants tap2
            WHERE tap2.activity_id = p_activity_id
              AND tap2.member_id = m.member_id
              AND tap2.status = 'opted_out'
        )
        AND NOT EXISTS (
            SELECT 1 FROM public.trip_activity_group_members gm
            JOIN public.trip_activity_groups g ON g.id = gm.group_id
            WHERE g.activity_id = p_activity_id AND gm.member_id = m.member_id
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

                INSERT INTO public.trip_activity_participants (activity_id, member_id, status, updated_at)
                VALUES (p_activity_id, v_member_id, 'attending', now())
                ON CONFLICT (activity_id, member_id)
                DO UPDATE SET status = 'attending', updated_at = now();
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

                INSERT INTO public.trip_activity_participants (activity_id, member_id, status, updated_at)
                VALUES (p_activity_id, v_item.member_id, 'attending', now())
                ON CONFLICT (activity_id, member_id)
                DO UPDATE SET status = 'attending', updated_at = now();
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
