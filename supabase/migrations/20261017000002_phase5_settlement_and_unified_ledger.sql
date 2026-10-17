-- Phase 5/6: Unified Expense Ledger, Two-Stage Settlement, and Recipient Confirmation Workflow
-- Migration: 20261017000002_phase5_settlement_and_unified_ledger.sql

-- 1. Create public.trip_expenses table
CREATE TABLE IF NOT EXISTS public.trip_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE,
    expense_type TEXT NOT NULL CHECK (expense_type IN ('cabin_deposit', 'carpool_mileage', 'shared_receipt', 'other')),
    payer_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    description TEXT NOT NULL,
    incurred_date DATE NOT NULL DEFAULT CURRENT_DATE,
    receipt_url TEXT,
    source_reference_id UUID,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_expenses_trip ON public.trip_expenses(trip_id, expense_type);
CREATE INDEX IF NOT EXISTS idx_trip_expenses_payer ON public.trip_expenses(payer_member_id);

-- 2. Create public.trip_expense_allocations table
CREATE TABLE IF NOT EXISTS public.trip_expense_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id UUID NOT NULL REFERENCES public.trip_expenses(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    allocated_cents INTEGER NOT NULL CHECK (allocated_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_expense_allocations_unique UNIQUE (expense_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_expense_allocations_expense ON public.trip_expense_allocations(expense_id);
CREATE INDEX IF NOT EXISTS idx_trip_expense_allocations_member ON public.trip_expense_allocations(member_id);

-- 3. Create public.settlement_runs table
CREATE TABLE IF NOT EXISTS public.settlement_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.camping_trips(id) ON DELETE RESTRICT,
    version_no INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'settled', 'superseded')),
    total_expenses_cents INTEGER NOT NULL CHECK (total_expenses_cents >= 0),
    algorithm_used TEXT NOT NULL DEFAULT 'exact' CHECK (algorithm_used IN ('exact', 'greedy_fallback')),
    snapshot_hash TEXT NOT NULL,
    created_by UUID REFERENCES public.members(id),
    finalized_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT settlement_runs_unique UNIQUE (trip_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_settlement_runs_trip ON public.settlement_runs(trip_id, status);

-- 4. Create public.settlement_balances table
CREATE TABLE IF NOT EXISTS public.settlement_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_run_id UUID NOT NULL REFERENCES public.settlement_runs(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    total_paid_cents INTEGER NOT NULL DEFAULT 0,
    total_allocated_cents INTEGER NOT NULL DEFAULT 0,
    net_balance_cents INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT settlement_balances_unique UNIQUE (settlement_run_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_balances_run ON public.settlement_balances(settlement_run_id);
CREATE INDEX IF NOT EXISTS idx_settlement_balances_member ON public.settlement_balances(member_id);

-- 5. Create public.settlement_transfers table
CREATE TABLE IF NOT EXISTS public.settlement_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_run_id UUID NOT NULL REFERENCES public.settlement_runs(id) ON DELETE CASCADE,
    payer_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    recipient_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    status TEXT NOT NULL DEFAULT 'outstanding' CHECK (status IN ('outstanding', 'sent', 'confirmed', 'disputed')),
    marked_sent_at TIMESTAMPTZ,
    confirmed_received_at TIMESTAMPTZ,
    payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('zelle', 'venmo', 'paypal', 'apple_cash', 'cash', 'other')),
    admin_override_by UUID REFERENCES public.members(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT settlement_transfers_no_self CHECK (payer_member_id <> recipient_member_id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_transfers_run ON public.settlement_transfers(settlement_run_id);
CREATE INDEX IF NOT EXISTS idx_settlement_transfers_payer ON public.settlement_transfers(payer_member_id);
CREATE INDEX IF NOT EXISTS idx_settlement_transfers_recipient ON public.settlement_transfers(recipient_member_id);

-- 6. Enable RLS
ALTER TABLE public.trip_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_expense_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_transfers ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies
DROP POLICY IF EXISTS trip_expenses_select_policy ON public.trip_expenses;
CREATE POLICY trip_expenses_select_policy ON public.trip_expenses
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.camping_trips ct
            WHERE ct.id = trip_expenses.trip_id
            AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS trip_expense_allocations_select_policy ON public.trip_expense_allocations;
CREATE POLICY trip_expense_allocations_select_policy ON public.trip_expense_allocations
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.trip_expenses te
            JOIN public.camping_trips ct ON ct.id = te.trip_id
            WHERE te.id = trip_expense_allocations.expense_id
            AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS settlement_runs_select_policy ON public.settlement_runs;
CREATE POLICY settlement_runs_select_policy ON public.settlement_runs
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.camping_trips ct
            WHERE ct.id = settlement_runs.trip_id
            AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS settlement_balances_select_policy ON public.settlement_balances;
CREATE POLICY settlement_balances_select_policy ON public.settlement_balances
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.settlement_runs sr
            JOIN public.camping_trips ct ON ct.id = sr.trip_id
            WHERE sr.id = settlement_balances.settlement_run_id
            AND ct.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS settlement_transfers_select_policy ON public.settlement_transfers;
CREATE POLICY settlement_transfers_select_policy ON public.settlement_transfers
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.settlement_runs sr
            JOIN public.camping_trips ct ON ct.id = sr.trip_id
            WHERE sr.id = settlement_transfers.settlement_run_id
            AND ct.deleted_at IS NULL
        )
    );

-- Grants
GRANT SELECT ON public.trip_expenses TO authenticated;
GRANT SELECT ON public.trip_expense_allocations TO authenticated;
GRANT SELECT ON public.settlement_runs TO authenticated;
GRANT SELECT ON public.settlement_balances TO authenticated;
GRANT SELECT ON public.settlement_transfers TO authenticated;

GRANT ALL ON public.trip_expenses TO service_role;
GRANT ALL ON public.trip_expense_allocations TO service_role;
GRANT ALL ON public.settlement_runs TO service_role;
GRANT ALL ON public.settlement_balances TO service_role;
GRANT ALL ON public.settlement_transfers TO service_role;

-- 8. RPC: phase5_manage_expense
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
    p_is_admin BOOLEAN DEFAULT FALSE
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

        IF p_payer_member_id IS NULL THEN
            p_payer_member_id := p_actor_id;
        ELSIF p_payer_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Only administrators can record expenses paid by other members.' USING ERRCODE = '42501';
        END IF;

        -- Check allocation total if allocations provided
        IF jsonb_array_length(p_allocations) > 0 THEN
            FOR v_alloc IN SELECT * FROM jsonb_to_recordset(p_allocations) AS x(member_id UUID, allocated_cents INTEGER) LOOP
                v_total_allocated := v_total_allocated + v_alloc.allocated_cents;
            END LOOP;

            IF v_total_allocated <> p_amount_cents THEN
                RAISE EXCEPTION 'Allocations sum (%) must equal total expense amount (%).', v_total_allocated, p_amount_cents USING ERRCODE = '22023';
            END IF;
        END IF;

        INSERT INTO public.trip_expenses (
            trip_id, expense_type, payer_member_id, amount_cents, description,
            incurred_date, receipt_url, source_reference_id
        ) VALUES (
            p_trip_id, COALESCE(p_expense_type, 'shared_receipt'), p_payer_member_id,
            p_amount_cents, trim(p_description), COALESCE(p_incurred_date, CURRENT_DATE),
            p_receipt_url, p_source_reference_id
        ) RETURNING id INTO v_expense_id;

        -- Insert allocations
        IF jsonb_array_length(p_allocations) > 0 THEN
            FOR v_alloc IN SELECT * FROM jsonb_to_recordset(p_allocations) AS x(member_id UUID, allocated_cents INTEGER) LOOP
                INSERT INTO public.trip_expense_allocations (expense_id, member_id, allocated_cents)
                VALUES (v_expense_id, v_alloc.member_id, v_alloc.allocated_cents)
                ON CONFLICT (expense_id, member_id)
                DO UPDATE SET allocated_cents = EXCLUDED.allocated_cents;
            END LOOP;
        END IF;

        RETURN jsonb_build_object('success', true, 'action', 'create', 'expense_id', v_expense_id);

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

        DELETE FROM public.trip_expenses WHERE id = p_expense_id;

        RETURN jsonb_build_object('success', true, 'action', 'delete', 'expense_id', p_expense_id);

    ELSE
        RAISE EXCEPTION 'Unsupported expense action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

-- 9. RPC: phase5_record_settlement_run
CREATE OR REPLACE FUNCTION public.phase5_record_settlement_run(
    p_trip_id UUID,
    p_algorithm_used TEXT,
    p_total_expenses_cents INTEGER,
    p_snapshot_hash TEXT,
    p_balances JSONB,
    p_transfers JSONB,
    p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_next_version INTEGER;
    v_run_id UUID;
    v_bal RECORD;
    v_tx RECORD;
BEGIN
    SELECT (member_role = 'admin') INTO v_is_admin FROM public.members WHERE id = p_actor_id;
    IF NOT COALESCE(v_is_admin, FALSE) THEN
        RAISE EXCEPTION 'Only administrators can finalize settlements.' USING ERRCODE = '42501';
    END IF;

    -- Compute next version number
    SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next_version
    FROM public.settlement_runs
    WHERE trip_id = p_trip_id;

    -- Mark any previous finalized runs as superseded
    UPDATE public.settlement_runs
    SET status = 'superseded'
    WHERE trip_id = p_trip_id AND status = 'finalized';

    -- Lock all trip expenses
    UPDATE public.trip_expenses
    SET is_locked = TRUE
    WHERE trip_id = p_trip_id;

    -- Insert new settlement run
    INSERT INTO public.settlement_runs (
        trip_id, version_no, status, total_expenses_cents, algorithm_used,
        snapshot_hash, created_by, finalized_at
    ) VALUES (
        p_trip_id, v_next_version, 'finalized', p_total_expenses_cents,
        COALESCE(p_algorithm_used, 'exact'), p_snapshot_hash, p_actor_id, now()
    ) RETURNING id INTO v_run_id;

    -- Insert balances
    FOR v_bal IN SELECT * FROM jsonb_to_recordset(p_balances) AS x(
        member_id UUID, total_paid_cents INTEGER, total_allocated_cents INTEGER, net_balance_cents INTEGER
    ) LOOP
        INSERT INTO public.settlement_balances (
            settlement_run_id, member_id, total_paid_cents, total_allocated_cents, net_balance_cents
        ) VALUES (
            v_run_id, v_bal.member_id, v_bal.total_paid_cents, v_bal.total_allocated_cents, v_bal.net_balance_cents
        );
    END LOOP;

    -- Insert proposed transfers
    FOR v_tx IN SELECT * FROM jsonb_to_recordset(p_transfers) AS x(
        payer_member_id UUID, recipient_member_id UUID, amount_cents INTEGER, payment_method TEXT
    ) LOOP
        INSERT INTO public.settlement_transfers (
            settlement_run_id, payer_member_id, recipient_member_id, amount_cents, payment_method, status
        ) VALUES (
            v_run_id, v_tx.payer_member_id, v_tx.recipient_member_id, v_tx.amount_cents, v_tx.payment_method, 'outstanding'
        );
    END LOOP;

    -- Update trip lifecycle status to financially_finalized
    UPDATE public.camping_trips
    SET trip_status = 'financially_finalized', event_status = 'confirmed', updated_at = now()
    WHERE id = p_trip_id;

    RETURN jsonb_build_object(
        'success', true,
        'run_id', v_run_id,
        'version_no', v_next_version,
        'status', 'finalized'
    );
END;
$$;

-- 10. RPC: phase5_update_transfer_status
CREATE OR REPLACE FUNCTION public.phase5_update_transfer_status(
    p_transfer_id UUID,
    p_action TEXT,
    p_payment_method TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL,
    p_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_tx public.settlement_transfers%ROWTYPE;
    v_all_confirmed BOOLEAN;
    v_trip_id UUID;
BEGIN
    SELECT * INTO v_tx FROM public.settlement_transfers WHERE id = p_transfer_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Settlement transfer not found.' USING ERRCODE = '22023';
    END IF;

    SELECT trip_id INTO v_trip_id FROM public.settlement_runs WHERE id = v_tx.settlement_run_id;

    IF p_action = 'mark_sent' THEN
        IF v_tx.payer_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Only the payer or administrator can mark a transfer as sent.' USING ERRCODE = '42501';
        END IF;

        UPDATE public.settlement_transfers
        SET
            status = 'sent',
            marked_sent_at = now(),
            payment_method = COALESCE(p_payment_method, payment_method),
            notes = COALESCE(trim(p_notes), notes),
            updated_at = now()
        WHERE id = p_transfer_id;

        RETURN jsonb_build_object('success', true, 'action', 'mark_sent', 'transfer_id', p_transfer_id, 'status', 'sent');

    ELSIF p_action = 'confirm_received' THEN
        IF v_tx.recipient_member_id <> p_actor_id AND NOT p_is_admin THEN
            RAISE EXCEPTION 'Only the recipient or administrator can confirm receipt.' USING ERRCODE = '42501';
        END IF;

        UPDATE public.settlement_transfers
        SET
            status = 'confirmed',
            confirmed_received_at = now(),
            admin_override_by = CASE WHEN p_is_admin AND v_tx.recipient_member_id <> p_actor_id THEN p_actor_id ELSE admin_override_by END,
            updated_at = now()
        WHERE id = p_transfer_id;

        -- Check if all transfers for this run are now confirmed
        SELECT NOT EXISTS (
            SELECT 1 FROM public.settlement_transfers
            WHERE settlement_run_id = v_tx.settlement_run_id
            AND status <> 'confirmed'
        ) INTO v_all_confirmed;

        IF v_all_confirmed THEN
            UPDATE public.settlement_runs
            SET status = 'settled', settled_at = now()
            WHERE id = v_tx.settlement_run_id;

            UPDATE public.camping_trips
            SET trip_status = 'financially_settled', updated_at = now()
            WHERE id = v_trip_id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'action', 'confirm_received',
            'transfer_id', p_transfer_id,
            'status', 'confirmed',
            'all_settled', v_all_confirmed
        );

    ELSE
        RAISE EXCEPTION 'Unsupported transfer status action: %', p_action USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.phase5_manage_expense FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5_record_settlement_run FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase5_update_transfer_status FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.phase5_manage_expense TO service_role;
GRANT EXECUTE ON FUNCTION public.phase5_record_settlement_run TO service_role;
GRANT EXECUTE ON FUNCTION public.phase5_update_transfer_status TO service_role;
