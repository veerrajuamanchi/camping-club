-- 20261025000000_separate_individual_gear_from_shared_commitments.sql
-- Enforce clear separation between shared volunteer commitments and individual personal packing items.
-- 1. Disallow claiming individual_pack items as shared group commitments in phase4_manage_commitment.
-- 2. Clean up any existing trip_commitments rows: ensure individual gear has commitment_type = 'individual_pack' and unassign any members.

-- 1. Update phase4_manage_commitment with individual_pack claim guardrail
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

        IF v_commitment.commitment_type = 'individual_pack' THEN
            RAISE EXCEPTION 'cannot_claim_individual_item: Personal packing items cannot be claimed as shared group commitments.' USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION public.phase4_manage_commitment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, UUID, UUID, BOOLEAN) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase4_manage_commitment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, UUID, UUID, BOOLEAN) TO service_role;

-- 2. Data Cleanup: ensure master gear items of type 'individual' are designated as 'individual_pack' and unassigned
UPDATE public.trip_commitments tc
SET commitment_type = 'individual_pack',
    assigned_member_id = NULL
FROM public.master_gear mg
WHERE tc.master_gear_id = mg.id
  AND mg.gear_type = 'individual'
  AND (tc.commitment_type <> 'individual_pack' OR tc.assigned_member_id IS NOT NULL);

-- Ensure all other individual_pack items have assigned_member_id = NULL
UPDATE public.trip_commitments
SET assigned_member_id = NULL
WHERE commitment_type = 'individual_pack'
  AND assigned_member_id IS NOT NULL;
