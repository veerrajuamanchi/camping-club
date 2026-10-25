-- Migration: Sync expense payer with linked activity group purchaser
-- When an administrator or accountant adjusts who paid an expense in Financials,
-- ensure the linked trip_activity_groups record updates purchaser_member_id to maintain two-way synchronization.

CREATE OR REPLACE FUNCTION public.phase5_manage_expense(
    p_trip_id UUID,
    p_action TEXT,
    p_expense_id UUID DEFAULT NULL,
    p_expense_type TEXT DEFAULT 'shared_receipt',
    p_payer_member_id UUID DEFAULT NULL,
    p_amount_cents INTEGER DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_incurred_date DATE DEFAULT CURRENT_DATE,
    p_receipt_url TEXT DEFAULT NULL,
    p_source_reference_id UUID DEFAULT NULL,
    p_allocations JSONB DEFAULT '[]'::JSONB,
    p_actor_id UUID DEFAULT NULL,
    p_is_admin BOOLEAN DEFAULT FALSE,
    p_split_mode TEXT DEFAULT 'all_attendees',
    p_receipt_storage_path TEXT DEFAULT NULL,
    p_receipt_file_name TEXT DEFAULT NULL,
    p_receipt_content_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_expense_id UUID;
    v_alloc RECORD;
    v_total_allocated INTEGER := 0;
    v_existing_expense public.trip_expenses%ROWTYPE;
BEGIN
    IF p_action = 'create' THEN
        IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
            RAISE EXCEPTION 'Expense amount must be positive integer cents.' USING ERRCODE = '22023';
        END IF;

        IF p_description IS NULL OR trim(p_description) = '' THEN
            RAISE EXCEPTION 'Description is required.' USING ERRCODE = '22023';
        END IF;

        IF p_split_mode NOT IN ('all_attendees', 'custom') THEN
            RAISE EXCEPTION 'Invalid split_mode: %. Must be all_attendees or custom.', p_split_mode USING ERRCODE = '22023';
        END IF;

        IF p_payer_member_id IS NULL THEN
            p_payer_member_id := p_actor_id;
        ELSIF p_payer_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can record expenses paid by other members.' USING ERRCODE = '42501';
        END IF;

        -- Check allocation total if custom allocations provided
        IF p_split_mode = 'custom' AND jsonb_array_length(p_allocations) > 0 THEN
            FOR v_alloc IN SELECT * FROM jsonb_to_recordset(p_allocations) AS x(member_id UUID, allocated_cents INTEGER) LOOP
                v_total_allocated := v_total_allocated + v_alloc.allocated_cents;
            END LOOP;

            IF v_total_allocated <> p_amount_cents THEN
                RAISE EXCEPTION 'Allocations sum (%) must equal total expense amount (%).', v_total_allocated, p_amount_cents USING ERRCODE = '22023';
            END IF;
        END IF;

        INSERT INTO public.trip_expenses (
            trip_id, expense_type, payer_member_id, amount_cents, description,
            incurred_date, receipt_url, source_reference_id,
            split_mode, receipt_storage_path, receipt_file_name, receipt_content_type
        ) VALUES (
            p_trip_id, COALESCE(p_expense_type, 'shared_receipt'), p_payer_member_id,
            p_amount_cents, trim(p_description), COALESCE(p_incurred_date, CURRENT_DATE),
            p_receipt_url, p_source_reference_id,
            COALESCE(p_split_mode, 'all_attendees'), p_receipt_storage_path, p_receipt_file_name, p_receipt_content_type
        ) RETURNING id INTO v_expense_id;

        -- Insert allocations if custom
        IF p_split_mode = 'custom' AND jsonb_array_length(p_allocations) > 0 THEN
            FOR v_alloc IN SELECT * FROM jsonb_to_recordset(p_allocations) AS x(member_id UUID, allocated_cents INTEGER) LOOP
                INSERT INTO public.trip_expense_allocations (expense_id, member_id, allocated_cents)
                VALUES (v_expense_id, v_alloc.member_id, v_alloc.allocated_cents)
                ON CONFLICT (expense_id, member_id)
                DO UPDATE SET allocated_cents = EXCLUDED.allocated_cents;
            END LOOP;
        END IF;

        RETURN jsonb_build_object('success', true, 'action', 'create', 'expense_id', v_expense_id);

    ELSIF p_action = 'update' THEN
        SELECT * INTO v_existing_expense FROM public.trip_expenses WHERE id = p_expense_id AND trip_id = p_trip_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Expense not found.' USING ERRCODE = '22023';
        END IF;

        IF v_existing_expense.is_locked THEN
            RAISE EXCEPTION 'Locked expenses cannot be modified.' USING ERRCODE = '22023';
        END IF;

        IF v_existing_expense.payer_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Cannot update expense submitted by another member.' USING ERRCODE = '42501';
        END IF;

        IF p_split_mode IS NOT NULL AND p_split_mode NOT IN ('all_attendees', 'custom') THEN
            RAISE EXCEPTION 'Invalid split_mode: %. Must be all_attendees or custom.', p_split_mode USING ERRCODE = '22023';
        END IF;

        UPDATE public.trip_expenses
        SET
            payer_member_id = COALESCE(p_payer_member_id, payer_member_id),
            amount_cents = COALESCE(p_amount_cents, amount_cents),
            description = COALESCE(NULLIF(trim(p_description), ''), description),
            incurred_date = COALESCE(p_incurred_date, incurred_date),
            receipt_url = COALESCE(p_receipt_url, receipt_url),
            split_mode = COALESCE(p_split_mode, split_mode),
            receipt_storage_path = COALESCE(p_receipt_storage_path, receipt_storage_path),
            receipt_file_name = COALESCE(p_receipt_file_name, receipt_file_name),
            receipt_content_type = COALESCE(p_receipt_content_type, receipt_content_type),
            updated_at = now()
        WHERE id = p_expense_id;

        -- Synchronize linked activity group purchaser if payer was updated
        IF p_payer_member_id IS NOT NULL THEN
            UPDATE public.trip_activity_groups
            SET purchaser_member_id = p_payer_member_id, updated_at = now()
            WHERE expense_id = p_expense_id;
        END IF;

        -- If split_mode is now all_attendees, clean up static allocations
        IF COALESCE(p_split_mode, v_existing_expense.split_mode) = 'all_attendees' THEN
            DELETE FROM public.trip_expense_allocations WHERE expense_id = p_expense_id;
        ELSIF p_split_mode = 'custom' AND jsonb_array_length(p_allocations) > 0 THEN
            v_total_allocated := 0;
            FOR v_alloc IN SELECT * FROM jsonb_to_recordset(p_allocations) AS x(member_id UUID, allocated_cents INTEGER) LOOP
                v_total_allocated := v_total_allocated + v_alloc.allocated_cents;
            END LOOP;

            IF v_total_allocated <> COALESCE(p_amount_cents, v_existing_expense.amount_cents) THEN
                RAISE EXCEPTION 'Allocations sum (%) must equal total expense amount (%).', v_total_allocated, COALESCE(p_amount_cents, v_existing_expense.amount_cents) USING ERRCODE = '22023';
            END IF;

            DELETE FROM public.trip_expense_allocations WHERE expense_id = p_expense_id;
            FOR v_alloc IN SELECT * FROM jsonb_to_recordset(p_allocations) AS x(member_id UUID, allocated_cents INTEGER) LOOP
                INSERT INTO public.trip_expense_allocations (expense_id, member_id, allocated_cents)
                VALUES (p_expense_id, v_alloc.member_id, v_alloc.allocated_cents);
            END LOOP;
        END IF;

        RETURN jsonb_build_object('success', true, 'action', 'update', 'expense_id', p_expense_id);

    ELSIF p_action = 'delete' THEN
        SELECT * INTO v_existing_expense FROM public.trip_expenses WHERE id = p_expense_id AND trip_id = p_trip_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Expense not found.' USING ERRCODE = '22023';
        END IF;

        IF v_existing_expense.is_locked THEN
            RAISE EXCEPTION 'Locked expenses cannot be deleted.' USING ERRCODE = '22023';
        END IF;

        IF v_existing_expense.payer_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Cannot delete expense submitted by another member.' USING ERRCODE = '42501';
        END IF;

        IF v_existing_expense.receipt_storage_path IS NOT NULL THEN
            PERFORM set_config('storage.allow_delete_query', 'true', true);
            DELETE FROM storage.objects
            WHERE bucket_id = 'trip-receipts' AND name = v_existing_expense.receipt_storage_path;
        END IF;

        -- Clear expense_id and reset voucher_status on any linked activity group
        UPDATE public.trip_activity_groups
        SET expense_id = NULL, voucher_status = 'needed', updated_at = now()
        WHERE expense_id = p_expense_id;

        DELETE FROM public.trip_expenses WHERE id = p_expense_id;

        RETURN jsonb_build_object('success', true, 'action', 'delete', 'expense_id', p_expense_id);

    ELSE
        RAISE EXCEPTION 'Unsupported expense action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase5_manage_expense FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase5_manage_expense TO authenticated, service_role;
