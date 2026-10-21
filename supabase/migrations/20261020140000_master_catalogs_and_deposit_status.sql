-- Migration: 20261020140000_master_catalogs_and_deposit_status.sql
-- Description: Master catalogs for gear & food, trip commitments extension, rules markdown, and $50 deposit tracking

-- 1. Master Camping Gear Directory
CREATE TABLE IF NOT EXISTS public.master_gear (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 100),
    description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
    gear_type TEXT NOT NULL CHECK (gear_type IN ('individual', 'shared')),
    category TEXT NOT NULL CHECK (category IN ('shelter', 'sleep', 'kitchen', 'lighting', 'safety', 'tools', 'clothing', 'other')),
    default_quantity TEXT DEFAULT '1',
    is_critical BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_gear_type_active ON public.master_gear(gear_type, active);
CREATE INDEX IF NOT EXISTS idx_master_gear_category ON public.master_gear(category);

-- 2. Master Food & Groceries Directory
CREATE TABLE IF NOT EXISTS public.master_food_groceries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 100),
    description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
    category TEXT NOT NULL CHECK (category IN ('pantry', 'produce', 'dairy_meat', 'bakery', 'beverages', 'campfire', 'supplies', 'other')),
    default_quantity TEXT DEFAULT '1 pack',
    is_critical BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_food_active ON public.master_food_groceries(active);
CREATE INDEX IF NOT EXISTS idx_master_food_category ON public.master_food_groceries(category);

-- 3. Extend trip_commitments
ALTER TABLE public.trip_commitments 
    DROP CONSTRAINT IF EXISTS trip_commitments_category_check;

ALTER TABLE public.trip_commitments
    ADD CONSTRAINT trip_commitments_category_check 
    CHECK (category IN ('gear', 'food', 'supplies', 'shelter', 'safety', 'sleep', 'kitchen', 'lighting', 'tools', 'clothing', 'pantry', 'produce', 'dairy_meat', 'bakery', 'beverages', 'campfire', 'other'));

ALTER TABLE public.trip_commitments
    ADD COLUMN IF NOT EXISTS master_gear_id UUID REFERENCES public.master_gear(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS master_food_id UUID REFERENCES public.master_food_groceries(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS commitment_type TEXT NOT NULL DEFAULT 'shared_volunteer' CHECK (commitment_type IN ('individual_pack', 'shared_volunteer')),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_trip_commitments_type_active 
    ON public.trip_commitments(trip_id, commitment_type, is_active);
CREATE INDEX IF NOT EXISTS idx_trip_commitments_master_gear ON public.trip_commitments(master_gear_id);
CREATE INDEX IF NOT EXISTS idx_trip_commitments_master_food ON public.trip_commitments(master_food_id);

-- 4. Extend trip_rsvps with $50 deposit status
ALTER TABLE public.trip_rsvps
    ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'unpaid' 
        CHECK (deposit_status IN ('unpaid', 'submitted_by_member', 'confirmed_by_admin', 'exempt')),
    ADD COLUMN IF NOT EXISTS deposit_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deposit_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deposit_confirmed_by UUID REFERENCES public.member_profiles(member_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trip_rsvps_deposit_confirmed_by ON public.trip_rsvps(deposit_confirmed_by);
CREATE INDEX IF NOT EXISTS idx_trip_rsvps_deposit_status ON public.trip_rsvps(trip_id, deposit_status);

-- 5. Extend camping_trips with single-copy rules_markdown
ALTER TABLE public.camping_trips
    ADD COLUMN IF NOT EXISTS rules_markdown TEXT;

-- 6. Row Level Security & Grants
ALTER TABLE public.master_gear ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_food_groceries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.master_gear FROM anon;
REVOKE ALL ON public.master_food_groceries FROM anon;

GRANT SELECT ON public.master_gear TO authenticated;
GRANT SELECT ON public.master_food_groceries TO authenticated;
GRANT ALL ON public.master_gear TO service_role;
GRANT ALL ON public.master_food_groceries TO service_role;

DROP POLICY IF EXISTS members_read_master_gear ON public.master_gear;
CREATE POLICY members_read_master_gear ON public.master_gear
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles
            WHERE (member_profiles.auth_user_id = auth.uid() OR member_profiles.member_id = auth.uid())
              AND member_profiles.account_status = 'active'
        )
    );

DROP POLICY IF EXISTS admins_modify_master_gear ON public.master_gear;
CREATE POLICY admins_modify_master_gear ON public.master_gear
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles
            WHERE (member_profiles.auth_user_id = auth.uid() OR member_profiles.member_id = auth.uid())
              AND member_profiles.member_role IN ('admin', 'administrator')
              AND member_profiles.account_status = 'active'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles
            WHERE (member_profiles.auth_user_id = auth.uid() OR member_profiles.member_id = auth.uid())
              AND member_profiles.member_role IN ('admin', 'administrator')
              AND member_profiles.account_status = 'active'
        )
    );

DROP POLICY IF EXISTS members_read_master_food ON public.master_food_groceries;
CREATE POLICY members_read_master_food ON public.master_food_groceries
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles
            WHERE (member_profiles.auth_user_id = auth.uid() OR member_profiles.member_id = auth.uid())
              AND member_profiles.account_status = 'active'
        )
    );

DROP POLICY IF EXISTS admins_modify_master_food ON public.master_food_groceries;
CREATE POLICY admins_modify_master_food ON public.master_food_groceries
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles
            WHERE (member_profiles.auth_user_id = auth.uid() OR member_profiles.member_id = auth.uid())
              AND member_profiles.member_role IN ('admin', 'administrator')
              AND member_profiles.account_status = 'active'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles
            WHERE (member_profiles.auth_user_id = auth.uid() OR member_profiles.member_id = auth.uid())
              AND member_profiles.member_role IN ('admin', 'administrator')
              AND member_profiles.account_status = 'active'
        )
    );

-- 7. RPC: admin_manage_master_gear
CREATE OR REPLACE FUNCTION public.admin_manage_master_gear(
    p_action TEXT,
    p_id UUID DEFAULT NULL,
    p_name TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_gear_type TEXT DEFAULT 'individual',
    p_category TEXT DEFAULT 'other',
    p_default_quantity TEXT DEFAULT '1',
    p_is_critical BOOLEAN DEFAULT FALSE,
    p_active BOOLEAN DEFAULT TRUE,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor public.member_profiles%ROWTYPE;
    v_record public.master_gear%ROWTYPE;
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

    IF v_actor.member_id IS NULL OR v_actor.member_role NOT IN ('admin', 'administrator') OR v_actor.account_status <> 'active' THEN
        RAISE EXCEPTION 'unauthorized: administrator role required' USING ERRCODE = '42501';
    END IF;

    IF p_action IN ('create', 'insert') THEN
        IF p_name IS NULL OR char_length(trim(p_name)) < 2 OR char_length(trim(p_name)) > 100 THEN
            RAISE EXCEPTION 'invalid name length: must be 2-100 characters' USING ERRCODE = '22023';
        END IF;

        IF p_gear_type NOT IN ('individual', 'shared') THEN
            RAISE EXCEPTION 'invalid gear_type: must be individual or shared' USING ERRCODE = '22023';
        END IF;

        IF p_category NOT IN ('shelter', 'sleep', 'kitchen', 'lighting', 'safety', 'tools', 'clothing', 'other') THEN
            RAISE EXCEPTION 'invalid category: %', p_category USING ERRCODE = '22023';
        END IF;

        IF p_description IS NOT NULL AND char_length(trim(p_description)) > 500 THEN
            RAISE EXCEPTION 'description must not exceed 500 characters' USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.master_gear (
            name, description, gear_type, category, default_quantity, is_critical, active
        ) VALUES (
            trim(p_name),
            nullif(trim(p_description), ''),
            p_gear_type,
            p_category,
            COALESCE(trim(p_default_quantity), '1'),
            COALESCE(p_is_critical, FALSE),
            COALESCE(p_active, TRUE)
        )
        RETURNING * INTO v_record;

        INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason)
        VALUES (v_actor.member_id, 'admin', 'master_gear', v_record.id, 'master_gear_created', v_record.name);

        RETURN to_jsonb(v_record);

    ELSIF p_action = 'update' THEN
        IF p_id IS NULL THEN
            RAISE EXCEPTION 'id is required for update' USING ERRCODE = '22023';
        END IF;

        IF p_name IS NOT NULL AND (char_length(trim(p_name)) < 2 OR char_length(trim(p_name)) > 100) THEN
            RAISE EXCEPTION 'invalid name length: must be 2-100 characters' USING ERRCODE = '22023';
        END IF;

        IF p_gear_type IS NOT NULL AND p_gear_type NOT IN ('individual', 'shared') THEN
            RAISE EXCEPTION 'invalid gear_type: must be individual or shared' USING ERRCODE = '22023';
        END IF;

        IF p_category IS NOT NULL AND p_category NOT IN ('shelter', 'sleep', 'kitchen', 'lighting', 'safety', 'tools', 'clothing', 'other') THEN
            RAISE EXCEPTION 'invalid category: %', p_category USING ERRCODE = '22023';
        END IF;

        IF p_description IS NOT NULL AND char_length(trim(p_description)) > 500 THEN
            RAISE EXCEPTION 'description must not exceed 500 characters' USING ERRCODE = '22023';
        END IF;

        UPDATE public.master_gear SET
            name = COALESCE(nullif(trim(p_name), ''), name),
            description = CASE WHEN p_description IS NOT NULL THEN nullif(trim(p_description), '') ELSE description END,
            gear_type = COALESCE(p_gear_type, gear_type),
            category = COALESCE(p_category, category),
            default_quantity = COALESCE(nullif(trim(p_default_quantity), ''), default_quantity),
            is_critical = COALESCE(p_is_critical, is_critical),
            active = COALESCE(p_active, active),
            updated_at = now()
        WHERE id = p_id
        RETURNING * INTO v_record;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'master gear item not found' USING ERRCODE = 'P0002';
        END IF;

        INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason)
        VALUES (v_actor.member_id, 'admin', 'master_gear', v_record.id, 'master_gear_updated', v_record.name);

        RETURN to_jsonb(v_record);

    ELSIF p_action = 'delete' THEN
        IF p_id IS NULL THEN
            RAISE EXCEPTION 'id is required for delete' USING ERRCODE = '22023';
        END IF;

        DELETE FROM public.master_gear WHERE id = p_id RETURNING * INTO v_record;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'master gear item not found' USING ERRCODE = 'P0002';
        END IF;

        INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason)
        VALUES (v_actor.member_id, 'admin', 'master_gear', p_id, 'master_gear_deleted', v_record.name);

        RETURN jsonb_build_object('success', true, 'action', 'delete', 'deleted_id', p_id);

    ELSE
        RAISE EXCEPTION 'unsupported action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manage_master_gear FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_manage_master_gear TO authenticated, service_role;

-- 8. RPC: admin_manage_master_food
CREATE OR REPLACE FUNCTION public.admin_manage_master_food(
    p_action TEXT,
    p_id UUID DEFAULT NULL,
    p_name TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_category TEXT DEFAULT 'pantry',
    p_default_quantity TEXT DEFAULT '1 pack',
    p_is_critical BOOLEAN DEFAULT FALSE,
    p_active BOOLEAN DEFAULT TRUE,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor public.member_profiles%ROWTYPE;
    v_record public.master_food_groceries%ROWTYPE;
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

    IF v_actor.member_id IS NULL OR v_actor.member_role NOT IN ('admin', 'administrator') OR v_actor.account_status <> 'active' THEN
        RAISE EXCEPTION 'unauthorized: administrator role required' USING ERRCODE = '42501';
    END IF;

    IF p_action IN ('create', 'insert') THEN
        IF p_name IS NULL OR char_length(trim(p_name)) < 2 OR char_length(trim(p_name)) > 100 THEN
            RAISE EXCEPTION 'invalid name length: must be 2-100 characters' USING ERRCODE = '22023';
        END IF;

        IF p_category NOT IN ('pantry', 'produce', 'dairy_meat', 'bakery', 'beverages', 'campfire', 'supplies', 'other') THEN
            RAISE EXCEPTION 'invalid category: %', p_category USING ERRCODE = '22023';
        END IF;

        IF p_description IS NOT NULL AND char_length(trim(p_description)) > 500 THEN
            RAISE EXCEPTION 'description must not exceed 500 characters' USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.master_food_groceries (
            name, description, category, default_quantity, is_critical, active
        ) VALUES (
            trim(p_name),
            nullif(trim(p_description), ''),
            p_category,
            COALESCE(trim(p_default_quantity), '1 pack'),
            COALESCE(p_is_critical, FALSE),
            COALESCE(p_active, TRUE)
        )
        RETURNING * INTO v_record;

        INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason)
        VALUES (v_actor.member_id, 'admin', 'master_food_groceries', v_record.id, 'master_food_created', v_record.name);

        RETURN to_jsonb(v_record);

    ELSIF p_action = 'update' THEN
        IF p_id IS NULL THEN
            RAISE EXCEPTION 'id is required for update' USING ERRCODE = '22023';
        END IF;

        IF p_name IS NOT NULL AND (char_length(trim(p_name)) < 2 OR char_length(trim(p_name)) > 100) THEN
            RAISE EXCEPTION 'invalid name length: must be 2-100 characters' USING ERRCODE = '22023';
        END IF;

        IF p_category IS NOT NULL AND p_category NOT IN ('pantry', 'produce', 'dairy_meat', 'bakery', 'beverages', 'campfire', 'supplies', 'other') THEN
            RAISE EXCEPTION 'invalid category: %', p_category USING ERRCODE = '22023';
        END IF;

        IF p_description IS NOT NULL AND char_length(trim(p_description)) > 500 THEN
            RAISE EXCEPTION 'description must not exceed 500 characters' USING ERRCODE = '22023';
        END IF;

        UPDATE public.master_food_groceries SET
            name = COALESCE(nullif(trim(p_name), ''), name),
            description = CASE WHEN p_description IS NOT NULL THEN nullif(trim(p_description), '') ELSE description END,
            category = COALESCE(p_category, category),
            default_quantity = COALESCE(nullif(trim(p_default_quantity), ''), default_quantity),
            is_critical = COALESCE(p_is_critical, is_critical),
            active = COALESCE(p_active, active),
            updated_at = now()
        WHERE id = p_id
        RETURNING * INTO v_record;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'master food item not found' USING ERRCODE = 'P0002';
        END IF;

        INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason)
        VALUES (v_actor.member_id, 'admin', 'master_food_groceries', v_record.id, 'master_food_updated', v_record.name);

        RETURN to_jsonb(v_record);

    ELSIF p_action = 'delete' THEN
        IF p_id IS NULL THEN
            RAISE EXCEPTION 'id is required for delete' USING ERRCODE = '22023';
        END IF;

        DELETE FROM public.master_food_groceries WHERE id = p_id RETURNING * INTO v_record;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'master food item not found' USING ERRCODE = 'P0002';
        END IF;

        INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason)
        VALUES (v_actor.member_id, 'admin', 'master_food_groceries', p_id, 'master_food_deleted', v_record.name);

        RETURN jsonb_build_object('success', true, 'action', 'delete', 'deleted_id', p_id);

    ELSE
        RAISE EXCEPTION 'unsupported action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manage_master_food FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_manage_master_food TO authenticated, service_role;

-- 9. RPC: admin_delete_master_responsibility (Safe Deletion Protocol)
CREATE OR REPLACE FUNCTION public.admin_delete_master_responsibility(
    p_id UUID,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor public.member_profiles%ROWTYPE;
    v_resp public.master_responsibilities%ROWTYPE;
    v_is_referenced BOOLEAN;
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

    IF v_actor.member_id IS NULL OR v_actor.member_role NOT IN ('admin', 'administrator') OR v_actor.account_status <> 'active' THEN
        RAISE EXCEPTION 'unauthorized: administrator role required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_resp FROM public.master_responsibilities WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'master responsibility not found' USING ERRCODE = 'P0002';
    END IF;

    -- Check if referenced in historical trip slot duties
    SELECT EXISTS (
        SELECT 1 FROM public.trip_slot_duties WHERE master_responsibility_id = p_id
    ) INTO v_is_referenced;

    IF v_is_referenced THEN
        -- Safe retire
        UPDATE public.master_responsibilities
        SET active = FALSE, updated_at = now()
        WHERE id = p_id;

        INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason)
        VALUES (v_actor.member_id, 'admin', 'master_responsibility', p_id, 'master_responsibility_soft_retired', 'referenced in trip duties');

        RETURN jsonb_build_object('success', true, 'action', 'soft_retired', 'id', p_id, 'active', false);
    ELSE
        -- Hard delete
        DELETE FROM public.master_responsibilities WHERE id = p_id;

        INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason)
        VALUES (v_actor.member_id, 'admin', 'master_responsibility', p_id, 'master_responsibility_deleted', 'unused template deleted');

        RETURN jsonb_build_object('success', true, 'action', 'deleted', 'id', p_id);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_master_responsibility FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_master_responsibility TO authenticated, service_role;

-- 10. RPC: submit_member_deposit ($50 deposit tracking)
CREATE OR REPLACE FUNCTION public.submit_member_deposit(
    p_trip_id UUID,
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
    v_rsvp public.trip_rsvps%ROWTYPE;
    v_new_status TEXT;
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

    IF v_actor.member_id IS NULL OR v_actor.account_status <> 'active' THEN
        RAISE EXCEPTION 'unauthorized: active member profile required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_trip FROM public.camping_trips WHERE id = p_trip_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'trip not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_trip.event_status IN ('cancelled', 'completed') THEN
        RAISE EXCEPTION 'cannot submit deposit for % trip', v_trip.event_status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_rsvp FROM public.trip_rsvps WHERE trip_id = p_trip_id AND member_id = v_actor.member_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'member RSVP not found for this trip' USING ERRCODE = 'P0002';
    END IF;

    IF v_rsvp.response <> 'coming' THEN
        RAISE EXCEPTION 'deposit can only be submitted for coming attendees' USING ERRCODE = '22023';
    END IF;

    IF v_rsvp.deposit_status = 'confirmed_by_admin' THEN
        RETURN jsonb_build_object(
            'success', true,
            'trip_id', p_trip_id,
            'member_id', v_actor.member_id,
            'deposit_status', 'confirmed_by_admin',
            'deposit_submitted_at', v_rsvp.deposit_submitted_at
        );
    END IF;

    -- Attending cabin payer resolves to 'exempt'
    IF v_trip.cabin_payer_member_id = v_actor.member_id THEN
        v_new_status := 'exempt';
    ELSE
        v_new_status := 'submitted_by_member';
    END IF;

    UPDATE public.trip_rsvps
    SET deposit_status = v_new_status,
        deposit_submitted_at = COALESCE(deposit_submitted_at, now()),
        updated_at = now()
    WHERE trip_id = p_trip_id AND member_id = v_actor.member_id
    RETURNING * INTO v_rsvp;

    INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason)
    VALUES (v_actor.member_id, 'member', 'trip_rsvp', v_rsvp.id, 'deposit_status_updated', v_new_status);

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', p_trip_id,
        'member_id', v_actor.member_id,
        'deposit_status', v_new_status,
        'deposit_submitted_at', v_rsvp.deposit_submitted_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_member_deposit FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_member_deposit TO authenticated, service_role;

-- 11. RPC: verify_member_deposit (Admin verification)
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

    IF v_actor.member_id IS NULL OR v_actor.member_role NOT IN ('admin', 'administrator') OR v_actor.account_status <> 'active' THEN
        RAISE EXCEPTION 'unauthorized: administrator role required' USING ERRCODE = '42501';
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
    VALUES (v_actor.member_id, 'admin', 'trip_rsvp', v_rsvp.id, 'deposit_status_verified', p_status);

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

-- 12. RPC: seed_trip_commitments_from_master (Auto-include on trip creation)
CREATE OR REPLACE FUNCTION public.seed_trip_commitments_from_master(
    p_trip_id UUID,
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
    v_gear_seeded INTEGER := 0;
    v_food_seeded INTEGER := 0;
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

    IF v_actor.member_id IS NULL OR v_actor.member_role NOT IN ('admin', 'administrator') OR v_actor.account_status <> 'active' THEN
        RAISE EXCEPTION 'unauthorized: administrator role required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_trip FROM public.camping_trips WHERE id = p_trip_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'trip not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_trip.event_status IN ('cancelled', 'completed') THEN
        RAISE EXCEPTION 'cannot seed commitments for % trip', v_trip.event_status USING ERRCODE = '22023';
    END IF;

    -- Seed active master gear items not already present in trip_commitments
    INSERT INTO public.trip_commitments (
        trip_id,
        category,
        item_name,
        quantity_description,
        is_critical,
        master_gear_id,
        commitment_type,
        is_active
    )
    SELECT
        p_trip_id,
        mg.category,
        mg.name,
        mg.default_quantity,
        mg.is_critical,
        mg.id,
        CASE WHEN mg.gear_type = 'individual' THEN 'individual_pack' ELSE 'shared_volunteer' END,
        TRUE
    FROM public.master_gear mg
    WHERE mg.active = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM public.trip_commitments tc
          WHERE tc.trip_id = p_trip_id AND tc.master_gear_id = mg.id
      );

    GET DIAGNOSTICS v_gear_seeded = ROW_COUNT;

    -- Seed active master food items not already present in trip_commitments
    INSERT INTO public.trip_commitments (
        trip_id,
        category,
        item_name,
        quantity_description,
        is_critical,
        master_food_id,
        commitment_type,
        is_active
    )
    SELECT
        p_trip_id,
        COALESCE(mf.category, 'food'),
        mf.name,
        mf.default_quantity,
        mf.is_critical,
        mf.id,
        'shared_volunteer',
        TRUE
    FROM public.master_food_groceries mf
    WHERE mf.active = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM public.trip_commitments tc
          WHERE tc.trip_id = p_trip_id AND tc.master_food_id = mf.id
      );

    GET DIAGNOSTICS v_food_seeded = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', p_trip_id,
        'gear_seeded', v_gear_seeded,
        'food_seeded', v_food_seeded
    );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_trip_commitments_from_master FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_trip_commitments_from_master TO authenticated, service_role;

-- 13. RPC: update_trip_commitment_status (Manage Trip Checklist toggle)
CREATE OR REPLACE FUNCTION public.update_trip_commitment_status(
    p_commitment_id UUID,
    p_is_active BOOLEAN,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor public.member_profiles%ROWTYPE;
    v_commitment public.trip_commitments%ROWTYPE;
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

    IF v_actor.member_id IS NULL OR v_actor.member_role NOT IN ('admin', 'administrator') OR v_actor.account_status <> 'active' THEN
        RAISE EXCEPTION 'unauthorized: administrator role required' USING ERRCODE = '42501';
    END IF;

    UPDATE public.trip_commitments
    SET is_active = COALESCE(p_is_active, is_active),
        updated_at = now()
    WHERE id = p_commitment_id
    RETURNING * INTO v_commitment;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'commitment not found' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'commitment_id', p_commitment_id,
        'is_active', v_commitment.is_active
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_trip_commitment_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_trip_commitment_status TO authenticated, service_role;

-- 14. Seed Initial Master Gear and Groceries
INSERT INTO public.master_gear (name, description, gear_type, category, default_quantity, is_critical, active)
VALUES
  ('Sleeping Bag', 'Warm sleeping bag rated for 30°F or below', 'individual', 'sleep', '1', true, true),
  ('Sleeping Pad / Air Mattress', 'Insulated ground pad or mattress', 'individual', 'sleep', '1', false, true),
  ('Tent & Rainfly', 'Personal or family tent with stakes and rain protection', 'individual', 'shelter', '1', false, true),
  ('Warm Jacket & Layered Clothing', 'Insulated jacket, thermal base layers, and rain jacket', 'individual', 'clothing', '1 set', true, true),
  ('Headlamp / Flashlight', 'Hands-free headlamp with fresh batteries', 'individual', 'lighting', '1', true, true),
  ('Mess Kit & Reusable Mug', 'Personal plate, bowl, fork, spoon, and insulated mug', 'individual', 'kitchen', '1 set', false, true),
  ('Toiletries & Sunscreen', 'Toothbrush, biodegradable soap, sunscreen, and insect repellent', 'individual', 'safety', '1 kit', false, true),
  ('Hiking Boots & Sturdy Socks', 'Comfortable trail footwear and extra wool socks', 'individual', 'clothing', '1 pair', false, true),
  ('2-Burner Propane Camp Stove', 'Primary camp stove with propane regulator and hose', 'shared', 'kitchen', '1', true, true),
  ('Large Cooking Pots & Ladles', '5-gallon group pots, pans, and serving utensils', 'shared', 'kitchen', '1 set', true, true),
  ('Campfire Grate & Heavy Duty Tongs', 'Steel cooking grate and grilling tongs', 'shared', 'kitchen', '1', false, true),
  ('High-Capacity Coolers with Ice', 'Large group coolers for perishable food storage', 'shared', 'kitchen', '2 coolers', true, true),
  ('Group First Aid & Emergency Kit', 'Comprehensive trauma, burn, and wound treatment kit', 'shared', 'safety', '1 kit', true, true),
  ('Area Lanterns & String Lights', 'Battery/solar powered lights for shared dining area', 'shared', 'lighting', '2 lanterns', false, true),
  ('Firewood & Fire Starters', 'Seasoned split firewood bundles and natural starters', 'shared', 'tools', '3 bundles', false, true),
  ('Folding Dining Table & Chairs', 'Portable camp tables and community seating', 'shared', 'shelter', '2 tables', false, true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.master_food_groceries (name, description, category, default_quantity, is_critical, active)
VALUES
  ('Pancake Mix & Maple Syrup', 'Buttermilk pancake mix and 100% pure maple syrup', 'pantry', '2 boxes', false, true),
  ('Cooking Oil & Butter', 'High-heat avocado or canola oil and salted butter', 'pantry', '1 bottle', true, true),
  ('Farm Fresh Eggs', 'Large pasture-raised eggs for breakfast scramble', 'dairy_meat', '2 cartons', true, true),
  ('Firewood & Kindling', 'Hardwood bundles for evening campfire', 'campfire', '4 bundles', true, true),
  ('Campfire S''mores Kit', 'Graham crackers, marshmallows, and chocolate bars', 'campfire', '2 packs', false, true),
  ('Ground Coffee & Tea Variety', 'Medium roast ground coffee, french press, and assorted tea', 'beverages', '1 can', false, true),
  ('Purified Drinking Water', '5-gallon potable drinking water dispensers', 'beverages', '3 jugs', true, true),
  ('Camp Potatoes & Onions', 'Russet baking potatoes, sweet onions, and garlic', 'produce', '5 lbs', false, true),
  ('Artisan Bread & Bagels', 'Sandwich bread, brioche burger buns, and plain bagels', 'bakery', '3 loaves', false, true),
  ('Heavy-Duty Trash Bags & Paper Towels', 'Contractor clean-up bags and absorbent paper towel rolls', 'supplies', '2 rolls', true, true)
ON CONFLICT (name) DO NOTHING;
