-- Migration: 20261110000000_carpool_meeting_details.sql
-- Add meeting_time and meeting_location to trip_carpools and update phase4_manage_carpool

ALTER TABLE public.trip_carpools ADD COLUMN IF NOT EXISTS meeting_time TEXT;
ALTER TABLE public.trip_carpools ADD COLUMN IF NOT EXISTS meeting_location TEXT;

-- Update phase4_manage_carpool to accept p_meeting_time and p_meeting_location
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
    p_is_admin BOOLEAN DEFAULT FALSE,
    p_meeting_time TEXT DEFAULT NULL,
    p_meeting_location TEXT DEFAULT NULL
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
            starting_mileage, ending_mileage, departure_details,
            meeting_time, meeting_location
        ) VALUES (
            p_trip_id, p_driver_member_id, COALESCE(trim(p_vehicle_description), 'Personal Vehicle'),
            GREATEST(1, COALESCE(p_max_seats, 4)),
            p_starting_mileage, p_ending_mileage, trim(p_departure_details),
            trim(p_meeting_time), trim(p_meeting_location)
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
            meeting_time = trim(p_meeting_time),
            meeting_location = trim(p_meeting_location),
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

    ELSE
        RAISE EXCEPTION 'Invalid action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;
