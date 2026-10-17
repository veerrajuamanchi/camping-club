-- Phase 4: Trip Commitments, Carpools, and Logistics Management
-- Migration: 20261017000001_phase4_logistics_and_commitments.sql

-- 1. Create trip_commitments table
CREATE TABLE IF NOT EXISTS public.trip_commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('gear', 'food', 'supplies', 'shelter', 'safety')),
    item_name TEXT NOT NULL,
    quantity_description TEXT,
    assigned_member_id UUID REFERENCES public.member_profiles(member_id) ON DELETE SET NULL,
    is_critical BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_commitments_trip_id ON public.trip_commitments(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_commitments_assigned_member ON public.trip_commitments(assigned_member_id);
CREATE INDEX IF NOT EXISTS idx_trip_commitments_category ON public.trip_commitments(trip_id, category);
CREATE INDEX IF NOT EXISTS idx_trip_commitments_critical ON public.trip_commitments(trip_id, is_critical);

-- 2. Create trip_carpools table
-- Note: NO driver_workload_credit column; driving workload is managed as standard duties in master_responsibilities.
CREATE TABLE IF NOT EXISTS public.trip_carpools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE,
    driver_member_id UUID NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE CASCADE,
    vehicle_description TEXT NOT NULL,
    max_seats INTEGER NOT NULL CHECK (max_seats >= 1),
    starting_mileage NUMERIC(10, 2),
    ending_mileage NUMERIC(10, 2),
    departure_details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_carpools_driver_trip_unique UNIQUE (trip_id, driver_member_id),
    CONSTRAINT trip_carpools_mileage_check CHECK (
        starting_mileage IS NULL OR ending_mileage IS NULL OR ending_mileage >= starting_mileage
    )
);

CREATE INDEX IF NOT EXISTS idx_trip_carpools_trip_id ON public.trip_carpools(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_carpools_driver ON public.trip_carpools(driver_member_id);

-- 3. Create trip_carpool_riders table
CREATE TABLE IF NOT EXISTS public.trip_carpool_riders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carpool_id UUID NOT NULL REFERENCES public.trip_carpools(id) ON DELETE CASCADE,
    rider_member_id UUID NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_carpool_riders_unique UNIQUE (carpool_id, rider_member_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_carpool_riders_carpool ON public.trip_carpool_riders(carpool_id);
CREATE INDEX IF NOT EXISTS idx_trip_carpool_riders_rider ON public.trip_carpool_riders(rider_member_id);

-- 4. Enable RLS
ALTER TABLE public.trip_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_carpools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_carpool_riders ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DROP POLICY IF EXISTS trip_commitments_select_policy ON public.trip_commitments;
CREATE POLICY trip_commitments_select_policy ON public.trip_commitments
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.camping_trips ct
            WHERE ct.id = trip_commitments.trip_id
            AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS trip_carpools_select_policy ON public.trip_carpools;
CREATE POLICY trip_carpools_select_policy ON public.trip_carpools
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.camping_trips ct
            WHERE ct.id = trip_carpools.trip_id
            AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS trip_carpool_riders_select_policy ON public.trip_carpool_riders;
CREATE POLICY trip_carpool_riders_select_policy ON public.trip_carpool_riders
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.trip_carpools tc
            JOIN public.camping_trips ct ON ct.id = tc.trip_id
            WHERE tc.id = trip_carpool_riders.carpool_id
            AND ct.deleted_at IS NULL
        )
    );

-- Grants
GRANT SELECT ON public.trip_commitments TO authenticated;
GRANT SELECT ON public.trip_carpools TO authenticated;
GRANT SELECT ON public.trip_carpool_riders TO authenticated;

GRANT ALL ON public.trip_commitments TO service_role;
GRANT ALL ON public.trip_carpools TO service_role;
GRANT ALL ON public.trip_carpool_riders TO service_role;

-- 6. RPC: phase4_manage_commitment
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
        )
        RETURNING * INTO v_commitment;

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

-- 7. RPC: phase4_manage_carpool
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
BEGIN
    IF p_action = 'admin_create_carpool' THEN
        IF NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can configure carpools.' USING ERRCODE = '42501';
        END IF;

        IF p_driver_member_id IS NULL THEN
            RAISE EXCEPTION 'Driver member ID is required.' USING ERRCODE = '22023';
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

        RETURN jsonb_build_object('success', true, 'action', 'admin_update_carpool', 'carpool_id', p_carpool_id);

    ELSIF p_action = 'admin_delete_carpool' THEN
        IF NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can delete carpools.' USING ERRCODE = '42501';
        END IF;

        DELETE FROM public.trip_carpools WHERE id = p_carpool_id AND trip_id = p_trip_id;

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

-- 8. RPC: phase4_admin_override_duty
CREATE OR REPLACE FUNCTION public.phase4_admin_override_duty(
    p_trip_id UUID,
    p_duty_id UUID,
    p_target_member_id UUID,
    p_action TEXT,
    p_actor_id UUID,
    p_reason TEXT DEFAULT 'Administrator duty override'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_duty RECORD;
BEGIN
    SELECT (member_role = 'admin') INTO v_is_admin FROM public.member_profiles WHERE member_id = p_actor_id;
    IF NOT COALESCE(v_is_admin, FALSE) THEN
        RAISE EXCEPTION 'Only administrators can perform duty overrides.' USING ERRCODE = '42501';
    END IF;

    SELECT d.*, s.trip_id as slot_trip_id
    INTO v_duty
    FROM public.trip_slot_duties d
    JOIN public.trip_time_slots s ON s.id = d.slot_id
    WHERE d.id = p_duty_id;

    IF NOT FOUND OR v_duty.slot_trip_id <> p_trip_id THEN
        RAISE EXCEPTION 'Duty not found for this trip.' USING ERRCODE = '22023';
    END IF;

    IF p_action = 'assign' THEN
        INSERT INTO public.trip_duty_assignments (
            duty_id, member_id, status, assigned_by_admin_id
        ) VALUES (
            p_duty_id, p_target_member_id, 'assigned_by_admin', p_actor_id
        )
        ON CONFLICT (duty_id, member_id)
        DO UPDATE SET
            status = 'assigned_by_admin',
            assigned_by_admin_id = p_actor_id,
            updated_at = now();

        RETURN jsonb_build_object('success', true, 'action', 'assign', 'duty_id', p_duty_id, 'member_id', p_target_member_id);

    ELSIF p_action = 'unassign' THEN
        DELETE FROM public.trip_duty_assignments
        WHERE duty_id = p_duty_id AND member_id = p_target_member_id;

        RETURN jsonb_build_object('success', true, 'action', 'unassign', 'duty_id', p_duty_id, 'member_id', p_target_member_id);

    ELSE
        RAISE EXCEPTION 'Unsupported duty override action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase4_manage_commitment FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase4_manage_carpool FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase4_admin_override_duty FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.phase4_manage_commitment TO service_role;
GRANT EXECUTE ON FUNCTION public.phase4_manage_carpool TO service_role;
GRANT EXECUTE ON FUNCTION public.phase4_admin_override_duty TO service_role;
