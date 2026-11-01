-- Migration: 20261031150000_carpool_tasks_and_commitments.sql
-- Description: Auto-manage carpool driver duties on trip start and end days, and retire manual Carpool Driver master template

-- 1. Retire manual 'Carpool Driver' from master responsibilities catalog
UPDATE public.master_responsibilities
SET active = FALSE,
    description = 'Auto-managed by Carpool Logistics (Transporting members to and from campsite)'
WHERE title = 'Carpool Driver';

-- 2. Create private.sync_carpool_duties to manage departure and return driver duties automatically
CREATE OR REPLACE FUNCTION private.sync_carpool_duties(p_trip_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_trip public.camping_trips%ROWTYPE;
    v_resp_id UUID;
    v_start_slot_id UUID;
    v_end_slot_id UUID;
    v_start_duty_id UUID;
    v_end_duty_id UUID;
    v_driver_count INT;
    v_driver RECORD;
BEGIN
    SELECT * INTO v_trip FROM public.camping_trips WHERE id = p_trip_id;
    IF NOT FOUND OR v_trip.deleted_at IS NOT NULL THEN
        RETURN;
    END IF;

    -- Find the 'Carpool Driver' master responsibility
    SELECT id INTO v_resp_id FROM public.master_responsibilities WHERE title = 'Carpool Driver' LIMIT 1;
    IF v_resp_id IS NULL THEN
        RETURN;
    END IF;

    -- Count active carpools with drivers
    SELECT COUNT(DISTINCT driver_member_id) INTO v_driver_count
    FROM public.trip_carpools
    WHERE trip_id = p_trip_id AND driver_member_id IS NOT NULL;

    -- If no carpool drivers exist, clean up auto-assigned carpool duties
    IF v_driver_count = 0 THEN
        DELETE FROM public.trip_duty_assignments
        WHERE trip_id = p_trip_id
          AND slot_duty_id IN (
              SELECT d.id FROM public.trip_slot_duties d
              JOIN public.trip_time_slots s ON s.id = d.time_slot_id
              WHERE s.trip_id = p_trip_id AND d.master_responsibility_id = v_resp_id
          );
        UPDATE public.trip_slot_duties
        SET is_active = FALSE, updated_at = now()
        WHERE time_slot_id IN (SELECT id FROM public.trip_time_slots WHERE trip_id = p_trip_id)
          AND master_responsibility_id = v_resp_id;
        RETURN;
    END IF;

    -- Ensure starting day slot exists (starts_on)
    IF v_trip.starts_on IS NOT NULL THEN
        SELECT id INTO v_start_slot_id
        FROM public.trip_time_slots
        WHERE trip_id = p_trip_id AND slot_date = v_trip.starts_on AND slot_type = 'chore' AND time_block = 'friday_evening'
        LIMIT 1;

        IF v_start_slot_id IS NULL THEN
            INSERT INTO public.trip_time_slots (trip_id, slot_date, time_block, slot_type, label, sort_order)
            VALUES (p_trip_id, v_trip.starts_on, 'friday_evening', 'chore', 'Departure Transit & Camp Arrival', 5)
            RETURNING id INTO v_start_slot_id;
        END IF;

        -- Ensure Carpool Driver duty on start slot
        SELECT id INTO v_start_duty_id
        FROM public.trip_slot_duties
        WHERE time_slot_id = v_start_slot_id AND master_responsibility_id = v_resp_id;

        IF v_start_duty_id IS NULL THEN
            INSERT INTO public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight, is_active, custom_title)
            VALUES (v_start_slot_id, v_resp_id, GREATEST(1, v_driver_count), 1.0, TRUE, 'Carpool Driver (Departure)')
            RETURNING id INTO v_start_duty_id;
        ELSE
            UPDATE public.trip_slot_duties
            SET capacity = GREATEST(1, v_driver_count), is_active = TRUE, updated_at = now()
            WHERE id = v_start_duty_id;
        END IF;
    END IF;

    -- Ensure ending day slot exists (ends_on)
    IF v_trip.ends_on IS NOT NULL THEN
        SELECT id INTO v_end_slot_id
        FROM public.trip_time_slots
        WHERE trip_id = p_trip_id AND slot_date = v_trip.ends_on AND slot_type = 'chore' AND time_block = 'sunday_afternoon'
        LIMIT 1;

        IF v_end_slot_id IS NULL THEN
            INSERT INTO public.trip_time_slots (trip_id, slot_date, time_block, slot_type, label, sort_order)
            VALUES (p_trip_id, v_trip.ends_on, 'sunday_afternoon', 'chore', 'Return Transit & Departure', 95)
            RETURNING id INTO v_end_slot_id;
        END IF;

        -- Ensure Carpool Driver duty on end slot
        SELECT id INTO v_end_duty_id
        FROM public.trip_slot_duties
        WHERE time_slot_id = v_end_slot_id AND master_responsibility_id = v_resp_id;

        IF v_end_duty_id IS NULL THEN
            INSERT INTO public.trip_slot_duties (time_slot_id, master_responsibility_id, capacity, workload_weight, is_active, custom_title)
            VALUES (v_end_slot_id, v_resp_id, GREATEST(1, v_driver_count), 1.0, TRUE, 'Carpool Driver (Return)')
            RETURNING id INTO v_end_duty_id;
        ELSE
            UPDATE public.trip_slot_duties
            SET capacity = GREATEST(1, v_driver_count), is_active = TRUE, updated_at = now()
            WHERE id = v_end_duty_id;
        END IF;
    END IF;

    -- Synchronize driver assignments
    DELETE FROM public.trip_duty_assignments
    WHERE trip_id = p_trip_id
      AND slot_duty_id IN (v_start_duty_id, v_end_duty_id)
      AND member_id NOT IN (
          SELECT driver_member_id FROM public.trip_carpools
          WHERE trip_id = p_trip_id AND driver_member_id IS NOT NULL
      );

    FOR v_driver IN
        SELECT DISTINCT driver_member_id
        FROM public.trip_carpools
        WHERE trip_id = p_trip_id AND driver_member_id IS NOT NULL
    LOOP
        IF v_start_duty_id IS NOT NULL THEN
            INSERT INTO public.trip_duty_assignments (trip_id, slot_duty_id, member_id, status)
            VALUES (p_trip_id, v_start_duty_id, v_driver.driver_member_id, 'assigned_by_admin')
            ON CONFLICT (slot_duty_id, member_id) DO UPDATE
            SET status = 'assigned_by_admin', updated_at = now()
            WHERE trip_duty_assignments.status <> 'assigned_by_admin';
        END IF;

        IF v_end_duty_id IS NOT NULL THEN
            INSERT INTO public.trip_duty_assignments (trip_id, slot_duty_id, member_id, status)
            VALUES (p_trip_id, v_end_duty_id, v_driver.driver_member_id, 'assigned_by_admin')
            ON CONFLICT (slot_duty_id, member_id) DO UPDATE
            SET status = 'assigned_by_admin', updated_at = now()
            WHERE trip_duty_assignments.status <> 'assigned_by_admin';
        END IF;
    END LOOP;
END;
$$;

-- 3. Update phase4_manage_carpool to invoke private.sync_carpool_duties
CREATE OR REPLACE FUNCTION public.phase4_manage_carpool(
    p_trip_id UUID,
    p_action TEXT,
    p_carpool_id UUID DEFAULT NULL,
    p_driver_member_id UUID DEFAULT NULL,
    p_vehicle_description TEXT DEFAULT NULL,
    p_max_seats INTEGER DEFAULT 4,
    p_starting_mileage NUMERIC DEFAULT NULL,
    p_ending_mileage NUMERIC DEFAULT NULL,
    p_departure_details TEXT DEFAULT NULL,
    p_rider_member_ids UUID[] DEFAULT ARRAY[]::UUID[],
    p_actor_id UUID DEFAULT NULL,
    p_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_carpool_id UUID;
    v_carpool public.trip_carpools%ROWTYPE;
    v_rider_id UUID;
    v_res JSONB;
BEGIN
    IF p_action = 'admin_create_carpool' THEN
        IF NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can configure carpools.' USING ERRCODE = '42501';
        END IF;

        IF p_driver_member_id IS NULL THEN
            RAISE EXCEPTION 'A designated driver is required for carpools.' USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.trip_carpools (
            trip_id, driver_member_id, vehicle_description, max_seats,
            starting_mileage, ending_mileage, departure_details
        ) VALUES (
            p_trip_id, p_driver_member_id, COALESCE(trim(p_vehicle_description), 'Personal Vehicle'),
            GREATEST(1, COALESCE(p_max_seats, 4)),
            p_starting_mileage, p_ending_mileage, trim(p_departure_details)
        )
        RETURNING id INTO v_carpool_id;

        IF p_rider_member_ids IS NOT NULL AND array_length(p_rider_member_ids, 1) > 0 THEN
            FOREACH v_rider_id IN ARRAY p_rider_member_ids LOOP
                IF v_rider_id <> p_driver_member_id THEN
                    INSERT INTO public.trip_carpool_riders (carpool_id, rider_member_id)
                    VALUES (v_carpool_id, v_rider_id)
                    ON CONFLICT DO NOTHING;
                END IF;
            END LOOP;
        END IF;

        PERFORM private.sync_carpool_duties(p_trip_id);
        RETURN jsonb_build_object('success', true, 'action', 'admin_create_carpool', 'carpool_id', v_carpool_id);

    ELSIF p_action = 'admin_update_carpool' THEN
        IF NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can update carpool configuration.' USING ERRCODE = '42501';
        END IF;

        SELECT * INTO v_carpool FROM public.trip_carpools WHERE id = p_carpool_id AND trip_id = p_trip_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Carpool not found.' USING ERRCODE = '22023';
        END IF;

        UPDATE public.trip_carpools
        SET
            driver_member_id = COALESCE(p_driver_member_id, driver_member_id),
            vehicle_description = COALESCE(trim(p_vehicle_description), vehicle_description),
            max_seats = GREATEST(1, COALESCE(p_max_seats, max_seats)),
            starting_mileage = COALESCE(p_starting_mileage, starting_mileage),
            ending_mileage = COALESCE(p_ending_mileage, ending_mileage),
            departure_details = trim(p_departure_details),
            updated_at = now()
        WHERE id = p_carpool_id;

        IF p_rider_member_ids IS NOT NULL THEN
            DELETE FROM public.trip_carpool_riders WHERE carpool_id = p_carpool_id;
            FOREACH v_rider_id IN ARRAY p_rider_member_ids LOOP
                IF v_rider_id <> COALESCE(p_driver_member_id, v_carpool.driver_member_id) THEN
                    INSERT INTO public.trip_carpool_riders (carpool_id, rider_member_id)
                    VALUES (p_carpool_id, v_rider_id)
                    ON CONFLICT DO NOTHING;
                END IF;
            END LOOP;
        END IF;

        PERFORM private.sync_carpool_duties(p_trip_id);
        RETURN jsonb_build_object('success', true, 'action', 'admin_update_carpool', 'carpool_id', p_carpool_id);

    ELSIF p_action = 'admin_delete_carpool' THEN
        IF NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can delete carpools.' USING ERRCODE = '42501';
        END IF;

        DELETE FROM public.trip_carpools WHERE id = p_carpool_id AND trip_id = p_trip_id;

        PERFORM private.sync_carpool_duties(p_trip_id);
        RETURN jsonb_build_object('success', true, 'action', 'admin_delete_carpool', 'carpool_id', p_carpool_id);

    ELSIF p_action = 'record_mileage' THEN
        SELECT * INTO v_carpool FROM public.trip_carpools WHERE id = p_carpool_id AND trip_id = p_trip_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Carpool not found.' USING ERRCODE = '22023';
        END IF;

        IF v_carpool.driver_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Only the assigned driver or administrator can update mileage.' USING ERRCODE = '42501';
        END IF;

        IF p_starting_mileage IS NOT NULL AND p_ending_mileage IS NOT NULL AND p_ending_mileage < p_starting_mileage THEN
            RAISE EXCEPTION 'Ending mileage cannot be less than starting mileage.' USING ERRCODE = '22023';
        END IF;

        UPDATE public.trip_carpools
        SET
            starting_mileage = COALESCE(p_starting_mileage, starting_mileage),
            ending_mileage = COALESCE(p_ending_mileage, ending_mileage),
            updated_at = now()
        WHERE id = p_carpool_id;

        RETURN jsonb_build_object('success', true, 'action', 'record_mileage', 'carpool_id', p_carpool_id);

    ELSE
        RAISE EXCEPTION 'Unsupported carpool action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase4_manage_carpool FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase4_manage_carpool TO service_role;

-- 4. Backfill existing trips with active carpools
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT DISTINCT trip_id FROM public.trip_carpools WHERE driver_member_id IS NOT NULL LOOP
        PERFORM private.sync_carpool_duties(r.trip_id);
    END LOOP;
END $$;
