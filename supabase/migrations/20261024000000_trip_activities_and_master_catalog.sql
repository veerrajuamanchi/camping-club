-- Migration: 20261024000000_trip_activities_and_master_catalog.sql
-- Description: Master activity catalog, trip activities, participation, groups (vehicles), and swap requests

-- 1. Master Activity Catalog
CREATE TABLE IF NOT EXISTS public.master_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    category TEXT NOT NULL DEFAULT 'other',
    image_url TEXT,
    location_name TEXT,
    address TEXT,
    directions_url TEXT,
    unit_label TEXT NOT NULL DEFAULT 'Vehicle',
    unit_capacity INTEGER NOT NULL DEFAULT 2 CHECK (unit_capacity >= 1),
    booking_notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_activities_active ON public.master_activities(is_active);
CREATE INDEX IF NOT EXISTS idx_master_activities_category ON public.master_activities(category);

-- 2. Trip Activities
CREATE TABLE IF NOT EXISTS public.trip_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE,
    master_activity_id UUID REFERENCES public.master_activities(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
    category TEXT NOT NULL DEFAULT 'other',
    image_url TEXT,
    activity_date DATE NOT NULL,
    start_time TIME WITHOUT TIME ZONE,
    end_time TIME WITHOUT TIME ZONE,
    location_name TEXT,
    address TEXT,
    directions_url TEXT,
    unit_label TEXT NOT NULL DEFAULT 'Vehicle',
    unit_capacity INTEGER NOT NULL DEFAULT 2 CHECK (unit_capacity >= 1),
    booking_notes TEXT,
    opt_out_policy TEXT NOT NULL DEFAULT 'locked_on_voucher' CHECK (opt_out_policy IN ('locked_on_voucher', 'flexible')),
    is_pairings_locked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_activities_trip_id ON public.trip_activities(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_activities_master_activity_id ON public.trip_activities(master_activity_id);
CREATE INDEX IF NOT EXISTS idx_trip_activities_date ON public.trip_activities(activity_date);

-- 3. Activity Participation (Opt-In / Opt-Out)
CREATE TABLE IF NOT EXISTS public.trip_activity_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.trip_activities(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('attending', 'opted_out')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_activity_participants_unique UNIQUE (activity_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_activity_participants_member_id ON public.trip_activity_participants(member_id);
CREATE INDEX IF NOT EXISTS idx_trip_activity_participants_status ON public.trip_activity_participants(activity_id, status);

-- 4. Activity Groups / Vehicles
CREATE TABLE IF NOT EXISTS public.trip_activity_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.trip_activities(id) ON DELETE CASCADE,
    group_number INTEGER NOT NULL,
    group_name TEXT,
    purchaser_member_id UUID REFERENCES public.member_profiles(member_id) ON DELETE SET NULL,
    purchase_date DATE,
    amount_cents INTEGER DEFAULT NULL CHECK (amount_cents IS NULL OR amount_cents >= 0),
    expense_id UUID REFERENCES public.trip_expenses(id) ON DELETE SET NULL,
    order_reference_number TEXT,
    voucher_code TEXT,
    security_pin TEXT,
    voucher_status TEXT NOT NULL DEFAULT 'pending' CHECK (voucher_status IN ('pending', 'purchased', 'verified')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_activity_groups_unique UNIQUE (activity_id, group_number)
);

CREATE INDEX IF NOT EXISTS idx_trip_activity_groups_purchaser ON public.trip_activity_groups(purchaser_member_id);
CREATE INDEX IF NOT EXISTS idx_trip_activity_groups_expense ON public.trip_activity_groups(expense_id);
CREATE INDEX IF NOT EXISTS idx_trip_activity_groups_voucher_status ON public.trip_activity_groups(voucher_status);

-- 5. Activity Group Members (Assignments)
CREATE TABLE IF NOT EXISTS public.trip_activity_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.trip_activity_groups(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_activity_group_members_unique UNIQUE (group_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_activity_group_members_member_id ON public.trip_activity_group_members(member_id);

-- 6. Partner Swap Requests
CREATE TABLE IF NOT EXISTS public.trip_activity_swap_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES public.trip_activities(id) ON DELETE CASCADE,
    requester_member_id UUID NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE CASCADE,
    target_member_id UUID NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trip_activity_swap_requests_activity ON public.trip_activity_swap_requests(activity_id);
CREATE INDEX IF NOT EXISTS idx_trip_activity_swap_requests_requester ON public.trip_activity_swap_requests(requester_member_id);
CREATE INDEX IF NOT EXISTS idx_trip_activity_swap_requests_target ON public.trip_activity_swap_requests(target_member_id);
CREATE INDEX IF NOT EXISTS idx_trip_activity_swap_requests_status ON public.trip_activity_swap_requests(activity_id, status);

-- 7. Row Level Security and Grants
ALTER TABLE public.master_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_activity_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_activity_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_activity_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_activity_swap_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.master_activities FROM anon, public;
REVOKE ALL ON public.trip_activities FROM anon, public;
REVOKE ALL ON public.trip_activity_participants FROM anon, public;
REVOKE ALL ON public.trip_activity_groups FROM anon, public;
REVOKE ALL ON public.trip_activity_group_members FROM anon, public;
REVOKE ALL ON public.trip_activity_swap_requests FROM anon, public;

-- Defense-in-depth grants for authenticated:
-- Only SELECT on read-only / server-managed tables
GRANT SELECT ON public.master_activities TO authenticated;
GRANT SELECT ON public.trip_activities TO authenticated;
GRANT SELECT ON public.trip_activity_group_members TO authenticated;

-- For trip_activity_groups: authenticated only gets SELECT on non-sensitive columns
-- (voucher_code and security_pin are never exposed to direct Data API select; direct updates disabled)
GRANT SELECT (
    id,
    activity_id,
    group_number,
    group_name,
    purchaser_member_id,
    purchase_date,
    amount_cents,
    expense_id,
    order_reference_number,
    voucher_status,
    created_at,
    updated_at
) ON public.trip_activity_groups TO authenticated;

-- For participant and swap tables: authenticated gets standard CRUD (constrained by RLS to own records)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_activity_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_activity_swap_requests TO authenticated;

-- Full service_role access for edge functions and trusted operations
GRANT ALL ON public.master_activities TO service_role;
GRANT ALL ON public.trip_activities TO service_role;
GRANT ALL ON public.trip_activity_participants TO service_role;
GRANT ALL ON public.trip_activity_groups TO service_role;
GRANT ALL ON public.trip_activity_group_members TO service_role;
GRANT ALL ON public.trip_activity_swap_requests TO service_role;

-- 8. Policies: master_activities
DROP POLICY IF EXISTS master_activities_select ON public.master_activities;
CREATE POLICY master_activities_select ON public.master_activities
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
        )
    );

DROP POLICY IF EXISTS master_activities_admin_all ON public.master_activities;
CREATE POLICY master_activities_admin_all ON public.master_activities
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.member_role IN ('admin', 'administrator')
              AND mp.account_status = 'active'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.member_role IN ('admin', 'administrator')
              AND mp.account_status = 'active'
        )
    );

-- 9. Policies: trip_activities
DROP POLICY IF EXISTS trip_activities_select ON public.trip_activities;
CREATE POLICY trip_activities_select ON public.trip_activities
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
        )
        AND EXISTS (
            SELECT 1 FROM public.camping_trips ct
            WHERE ct.id = trip_activities.trip_id
              AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS trip_activities_admin_all ON public.trip_activities;
CREATE POLICY trip_activities_admin_all ON public.trip_activities
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.member_role IN ('admin', 'administrator')
              AND mp.account_status = 'active'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.member_role IN ('admin', 'administrator')
              AND mp.account_status = 'active'
        )
    );

-- 10. Policies: trip_activity_participants
DROP POLICY IF EXISTS trip_activity_participants_select ON public.trip_activity_participants;
CREATE POLICY trip_activity_participants_select ON public.trip_activity_participants
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
        )
        AND EXISTS (
            SELECT 1 FROM public.trip_activities ta
            JOIN public.camping_trips ct ON ct.id = ta.trip_id
            WHERE ta.id = trip_activity_participants.activity_id
              AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS trip_activity_participants_insert ON public.trip_activity_participants;
CREATE POLICY trip_activity_participants_insert ON public.trip_activity_participants
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
              AND (mp.member_id = trip_activity_participants.member_id OR mp.member_role IN ('admin', 'administrator'))
        )
    );

DROP POLICY IF EXISTS trip_activity_participants_update ON public.trip_activity_participants;
CREATE POLICY trip_activity_participants_update ON public.trip_activity_participants
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
              AND (mp.member_id = trip_activity_participants.member_id OR mp.member_role IN ('admin', 'administrator'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
              AND (mp.member_id = trip_activity_participants.member_id OR mp.member_role IN ('admin', 'administrator'))
        )
    );

DROP POLICY IF EXISTS trip_activity_participants_delete ON public.trip_activity_participants;
CREATE POLICY trip_activity_participants_delete ON public.trip_activity_participants
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
              AND (mp.member_id = trip_activity_participants.member_id OR mp.member_role IN ('admin', 'administrator'))
        )
    );

-- 11. Policies: trip_activity_groups
DROP POLICY IF EXISTS trip_activity_groups_select ON public.trip_activity_groups;
CREATE POLICY trip_activity_groups_select ON public.trip_activity_groups
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
        )
        AND EXISTS (
            SELECT 1 FROM public.trip_activities ta
            JOIN public.camping_trips ct ON ct.id = ta.trip_id
            WHERE ta.id = trip_activity_groups.activity_id
              AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS trip_activity_groups_admin_insert ON public.trip_activity_groups;
CREATE POLICY trip_activity_groups_admin_insert ON public.trip_activity_groups
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.member_role IN ('admin', 'administrator')
              AND mp.account_status = 'active'
        )
    );

DROP POLICY IF EXISTS trip_activity_groups_admin_delete ON public.trip_activity_groups;
CREATE POLICY trip_activity_groups_admin_delete ON public.trip_activity_groups
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.member_role IN ('admin', 'administrator')
              AND mp.account_status = 'active'
        )
    );

-- 12. Policies: trip_activity_group_members
DROP POLICY IF EXISTS trip_activity_group_members_select ON public.trip_activity_group_members;
CREATE POLICY trip_activity_group_members_select ON public.trip_activity_group_members
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
        )
        AND EXISTS (
            SELECT 1 FROM public.trip_activity_groups tag
            JOIN public.trip_activities ta ON ta.id = tag.activity_id
            JOIN public.camping_trips ct ON ct.id = ta.trip_id
            WHERE tag.id = trip_activity_group_members.group_id
              AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS trip_activity_group_members_admin_all ON public.trip_activity_group_members;
CREATE POLICY trip_activity_group_members_admin_all ON public.trip_activity_group_members
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.member_role IN ('admin', 'administrator')
              AND mp.account_status = 'active'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.member_role IN ('admin', 'administrator')
              AND mp.account_status = 'active'
        )
    );

-- 13. Policies: trip_activity_swap_requests
DROP POLICY IF EXISTS trip_activity_swap_requests_select ON public.trip_activity_swap_requests;
CREATE POLICY trip_activity_swap_requests_select ON public.trip_activity_swap_requests
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
        )
        AND EXISTS (
            SELECT 1 FROM public.trip_activities ta
            JOIN public.camping_trips ct ON ct.id = ta.trip_id
            WHERE ta.id = trip_activity_swap_requests.activity_id
              AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS trip_activity_swap_requests_insert ON public.trip_activity_swap_requests;
CREATE POLICY trip_activity_swap_requests_insert ON public.trip_activity_swap_requests
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
              AND (mp.member_id = trip_activity_swap_requests.requester_member_id OR mp.member_role IN ('admin', 'administrator'))
        )
    );

DROP POLICY IF EXISTS trip_activity_swap_requests_update ON public.trip_activity_swap_requests;
CREATE POLICY trip_activity_swap_requests_update ON public.trip_activity_swap_requests
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
              AND (
                mp.member_id IN (trip_activity_swap_requests.requester_member_id, trip_activity_swap_requests.target_member_id)
                OR mp.member_role IN ('admin', 'administrator')
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
              AND (
                mp.member_id IN (trip_activity_swap_requests.requester_member_id, trip_activity_swap_requests.target_member_id)
                OR mp.member_role IN ('admin', 'administrator')
              )
        )
    );

DROP POLICY IF EXISTS trip_activity_swap_requests_delete ON public.trip_activity_swap_requests;
CREATE POLICY trip_activity_swap_requests_delete ON public.trip_activity_swap_requests
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
              AND (mp.member_id = trip_activity_swap_requests.requester_member_id OR mp.member_role IN ('admin', 'administrator'))
        )
    );

-- ============================================================================
-- 14. Transactional RPC Functions for Activities, Groups, and Vouchers
-- ============================================================================

-- Function 1: phase6_manage_master_activity
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

-- Function 2: phase6_manage_trip_activity
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

-- Function 3: phase6_set_activity_participation
CREATE OR REPLACE FUNCTION public.phase6_set_activity_participation(
    p_activity_id UUID,
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
    v_activity public.trip_activities%ROWTYPE;
    v_is_admin BOOLEAN := FALSE;
    v_voucher_status TEXT;
BEGIN
    IF p_status NOT IN ('attending', 'opted_out') THEN
        RAISE EXCEPTION 'Invalid participation status: %. Must be attending or opted_out.', p_status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_actor
    FROM public.member_profiles
    WHERE (member_id = p_actor_id OR auth_user_id = p_actor_id)
      AND account_status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active member profile not found for actor.' USING ERRCODE = '42501';
    END IF;

    v_is_admin := (v_actor.member_role IN ('admin', 'administrator'));

    IF v_actor.member_id <> p_member_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Cannot update participation for another member.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_activity FROM public.trip_activities WHERE id = p_activity_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip activity not found.' USING ERRCODE = '22023';
    END IF;

    IF p_status = 'opted_out' THEN
        IF v_activity.opt_out_policy = 'locked_on_voucher' AND NOT v_is_admin THEN
            SELECT g.voucher_status INTO v_voucher_status
            FROM public.trip_activity_group_members gm
            JOIN public.trip_activity_groups g ON g.id = gm.group_id
            WHERE g.activity_id = p_activity_id AND gm.member_id = p_member_id;

            IF v_voucher_status IN ('purchased', 'verified') THEN
                RAISE EXCEPTION 'Cannot opt out because a voucher has already been purchased for your assigned vehicle. Please contact an administrator.' USING ERRCODE = '22023';
            END IF;
        END IF;

        DELETE FROM public.trip_activity_group_members
        WHERE member_id = p_member_id
          AND group_id IN (SELECT id FROM public.trip_activity_groups WHERE activity_id = p_activity_id);
    END IF;

    INSERT INTO public.trip_activity_participants (activity_id, member_id, status, updated_at)
    VALUES (p_activity_id, p_member_id, p_status, now())
    ON CONFLICT (activity_id, member_id)
    DO UPDATE SET status = EXCLUDED.status, updated_at = now();

    RETURN jsonb_build_object('success', true, 'activity_id', p_activity_id, 'member_id', p_member_id, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.phase6_set_activity_participation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase6_set_activity_participation TO authenticated, service_role;

-- Function 4: phase6_manage_activity_pairings
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
    v_group_id UUID;
    v_member_id UUID;
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
        v_group_num := COALESCE((p_payload->>'group_number')::INTEGER, (SELECT COALESCE(MAX(group_number), 0) + 1 FROM public.trip_activity_groups WHERE activity_id = p_activity_id));
        v_group_name := COALESCE(NULLIF(trim(p_payload->>'group_name'), ''), v_activity.unit_label || ' #' || v_group_num);

        INSERT INTO public.trip_activity_groups (activity_id, group_number, group_name)
        VALUES (p_activity_id, v_group_num, v_group_name)
        RETURNING id INTO v_group_id;

        RETURN jsonb_build_object('success', true, 'action', 'create_group', 'group_id', v_group_id);

    ELSIF p_action = 'delete_group' THEN
        v_group_id := (p_payload->>'group_id')::UUID;
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

-- Function 5: phase6_submit_voucher
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
    v_is_assigned BOOLEAN := FALSE;
    v_expense_id UUID;
    v_expense_result JSONB;
    v_voucher_status TEXT;
BEGIN
    SELECT g.id, g.activity_id, g.expense_id, g.voucher_status, ta.trip_id, ta.title
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
    v_is_assigned := EXISTS (
        SELECT 1 FROM public.trip_activity_group_members
        WHERE group_id = p_group_id AND member_id = v_actor.member_id
    );

    IF NOT v_is_admin AND NOT v_is_assigned THEN
        RAISE EXCEPTION 'Only assigned riders or administrators can submit voucher details.' USING ERRCODE = '42501';
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
                p_description := COALESCE(v_group.title || ' Voucher', 'Activity Voucher'),
                p_incurred_date := COALESCE(p_purchase_date, CURRENT_DATE),
                p_actor_id := v_actor.member_id,
                p_is_admin := true,
                p_split_mode := 'all_attendees'
            );
            v_expense_id := (v_expense_result->>'expense_id')::UUID;
        ELSE
            PERFORM public.phase5_manage_expense(
                p_trip_id := v_group.trip_id,
                p_action := 'update',
                p_expense_id := v_group.expense_id,
                p_payer_member_id := p_purchaser_member_id,
                p_amount_cents := p_amount_cents,
                p_description := COALESCE(v_group.title || ' Voucher', 'Activity Voucher'),
                p_incurred_date := COALESCE(p_purchase_date, CURRENT_DATE),
                p_actor_id := v_actor.member_id,
                p_is_admin := true,
                p_split_mode := 'all_attendees'
            );
            v_expense_id := v_group.expense_id;
        END IF;
    ELSE
        v_expense_id := v_group.expense_id;
    END IF;

    v_voucher_status := CASE
        WHEN (p_voucher_code IS NOT NULL AND trim(p_voucher_code) <> '') OR (p_amount_cents IS NOT NULL AND p_amount_cents > 0) THEN 'purchased'
        ELSE v_group.voucher_status
    END;

    UPDATE public.trip_activity_groups
    SET
        purchaser_member_id = COALESCE(p_purchaser_member_id, purchaser_member_id),
        purchase_date = COALESCE(p_purchase_date, purchase_date),
        amount_cents = COALESCE(p_amount_cents, amount_cents),
        expense_id = v_expense_id,
        order_reference_number = COALESCE(p_order_ref, order_reference_number),
        voucher_code = COALESCE(p_voucher_code, voucher_code),
        security_pin = COALESCE(p_security_pin, security_pin),
        voucher_status = v_voucher_status,
        updated_at = now()
    WHERE id = p_group_id;

    RETURN jsonb_build_object(
        'success', true,
        'group_id', p_group_id,
        'expense_id', v_expense_id,
        'voucher_status', v_voucher_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.phase6_submit_voucher FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase6_submit_voucher TO authenticated, service_role;

-- Function 6: phase6_request_partner_swap
CREATE OR REPLACE FUNCTION public.phase6_request_partner_swap(
    p_activity_id UUID,
    p_requester_id UUID,
    p_target_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_activity public.trip_activities%ROWTYPE;
    v_req_group_id UUID;
    v_req_voucher_status TEXT;
    v_tgt_group_id UUID;
    v_tgt_voucher_status TEXT;
    v_request_id UUID;
BEGIN
    IF p_requester_id = p_target_id THEN
        RAISE EXCEPTION 'Cannot swap with yourself.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_activity FROM public.trip_activities WHERE id = p_activity_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip activity not found.' USING ERRCODE = '22023';
    END IF;

    IF v_activity.is_pairings_locked THEN
        RAISE EXCEPTION 'Pairings are locked for this activity.' USING ERRCODE = '22023';
    END IF;

    SELECT g.id, g.voucher_status INTO v_req_group_id, v_req_voucher_status
    FROM public.trip_activity_group_members gm
    JOIN public.trip_activity_groups g ON g.id = gm.group_id
    WHERE g.activity_id = p_activity_id AND gm.member_id = p_requester_id;

    SELECT g.id, g.voucher_status INTO v_tgt_group_id, v_tgt_voucher_status
    FROM public.trip_activity_group_members gm
    JOIN public.trip_activity_groups g ON g.id = gm.group_id
    WHERE g.activity_id = p_activity_id AND gm.member_id = p_target_id;

    IF v_req_group_id IS NULL OR v_tgt_group_id IS NULL THEN
        RAISE EXCEPTION 'Both members must be assigned to groups for this activity.' USING ERRCODE = '22023';
    END IF;

    IF v_req_group_id = v_tgt_group_id THEN
        RAISE EXCEPTION 'Both members are already in the same group.' USING ERRCODE = '22023';
    END IF;

    IF v_req_voucher_status IN ('purchased', 'verified') OR v_tgt_voucher_status IN ('purchased', 'verified') THEN
        RAISE EXCEPTION 'Cannot request partner swap because a voucher has already been purchased for one or both groups.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.trip_activity_swap_requests
        WHERE activity_id = p_activity_id
          AND requester_member_id = p_requester_id
          AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'You already have an active pending swap request for this activity.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.trip_activity_swap_requests (
        activity_id,
        requester_member_id,
        target_member_id,
        status
    ) VALUES (
        p_activity_id,
        p_requester_id,
        p_target_id,
        'pending'
    ) RETURNING id INTO v_request_id;

    RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'status', 'pending');
END;
$$;

REVOKE ALL ON FUNCTION public.phase6_request_partner_swap FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase6_request_partner_swap TO authenticated, service_role;

-- Function 7: phase6_respond_partner_swap
CREATE OR REPLACE FUNCTION public.phase6_respond_partner_swap(
    p_request_id UUID,
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
    v_swap public.trip_activity_swap_requests%ROWTYPE;
    v_is_admin BOOLEAN := FALSE;
    v_req_group_id UUID;
    v_req_voucher_status TEXT;
    v_tgt_group_id UUID;
    v_tgt_voucher_status TEXT;
BEGIN
    SELECT * INTO v_swap FROM public.trip_activity_swap_requests WHERE id = p_request_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Swap request not found.' USING ERRCODE = '22023';
    END IF;

    IF v_swap.status <> 'pending' THEN
        RAISE EXCEPTION 'Swap request is not pending (status: %).', v_swap.status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_actor
    FROM public.member_profiles
    WHERE (member_id = p_actor_id OR auth_user_id = p_actor_id)
      AND account_status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active member profile not found for actor.' USING ERRCODE = '42501';
    END IF;

    v_is_admin := (v_actor.member_role IN ('admin', 'administrator'));

    IF p_action = 'accept' THEN
        IF v_actor.member_id <> v_swap.target_member_id AND NOT v_is_admin THEN
            RAISE EXCEPTION 'Only the target member or an administrator can accept this swap request.' USING ERRCODE = '42501';
        END IF;

        SELECT g.id, g.voucher_status INTO v_req_group_id, v_req_voucher_status
        FROM public.trip_activity_group_members gm
        JOIN public.trip_activity_groups g ON g.id = gm.group_id
        WHERE g.activity_id = v_swap.activity_id AND gm.member_id = v_swap.requester_member_id;

        SELECT g.id, g.voucher_status INTO v_tgt_group_id, v_tgt_voucher_status
        FROM public.trip_activity_group_members gm
        JOIN public.trip_activity_groups g ON g.id = gm.group_id
        WHERE g.activity_id = v_swap.activity_id AND gm.member_id = v_swap.target_member_id;

        IF v_req_group_id IS NULL OR v_tgt_group_id IS NULL THEN
            RAISE EXCEPTION 'One or both members are no longer assigned to a group.' USING ERRCODE = '22023';
        END IF;

        IF (v_req_voucher_status IN ('purchased', 'verified') OR v_tgt_voucher_status IN ('purchased', 'verified')) AND NOT v_is_admin THEN
            RAISE EXCEPTION 'Cannot complete partner swap because a voucher has already been purchased for one or both groups.' USING ERRCODE = '22023';
        END IF;

        UPDATE public.trip_activity_group_members
        SET member_id = v_swap.target_member_id
        WHERE group_id = v_req_group_id AND member_id = v_swap.requester_member_id;

        UPDATE public.trip_activity_group_members
        SET member_id = v_swap.requester_member_id
        WHERE group_id = v_tgt_group_id AND member_id = v_swap.target_member_id;

        UPDATE public.trip_activity_swap_requests
        SET status = 'accepted', resolved_at = now()
        WHERE id = p_request_id;

        RETURN jsonb_build_object(
            'success', true,
            'request_id', p_request_id,
            'status', 'accepted',
            'requester_group_id', v_tgt_group_id,
            'target_group_id', v_req_group_id
        );

    ELSIF p_action = 'decline' THEN
        IF v_actor.member_id <> v_swap.target_member_id AND NOT v_is_admin THEN
            RAISE EXCEPTION 'Only the target member or an administrator can decline this swap request.' USING ERRCODE = '42501';
        END IF;

        UPDATE public.trip_activity_swap_requests
        SET status = 'declined', resolved_at = now()
        WHERE id = p_request_id;

        RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'declined');

    ELSIF p_action = 'cancel' THEN
        IF v_actor.member_id <> v_swap.requester_member_id AND NOT v_is_admin THEN
            RAISE EXCEPTION 'Only the requester or an administrator can cancel this swap request.' USING ERRCODE = '42501';
        END IF;

        UPDATE public.trip_activity_swap_requests
        SET status = 'cancelled', resolved_at = now()
        WHERE id = p_request_id;

        RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'cancelled');

    ELSE
        RAISE EXCEPTION 'Unsupported swap action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase6_respond_partner_swap FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase6_respond_partner_swap TO authenticated, service_role;

