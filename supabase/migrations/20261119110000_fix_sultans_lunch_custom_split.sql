-- Migration: Fix Sultan's Kebab Lunch custom split to exclude Romesh Santhiapalli
-- Expense: Lunch at Sultan's ($351.28 on 2026-11-13)
-- Exclude Romesh and split integer cents across remaining 11 confirmed attendees

DO $$
DECLARE
    v_expense RECORD;
    v_romesh_id UUID;
    v_attendee_ids UUID[];
    v_attendee_count INTEGER;
    v_base_cents INTEGER;
    v_remainder INTEGER;
    v_idx INTEGER;
    v_member_id UUID;
    v_allocated INTEGER;
BEGIN
    -- 1. Find Romesh's member_id from member_profiles
    SELECT member_id INTO v_romesh_id
    FROM public.member_profiles
    WHERE display_name ILIKE '%Romesh%'
    LIMIT 1;

    -- 2. Find the Sultan's lunch expense
    FOR v_expense IN
        SELECT id, trip_id, amount_cents
        FROM public.trip_expenses
        WHERE (description ILIKE '%Sultan%' OR description ILIKE '%Sultans%')
          AND amount_cents = 35128
    LOOP
        -- Set split_mode to custom
        UPDATE public.trip_expenses
        SET split_mode = 'custom', updated_at = now()
        WHERE id = v_expense.id;

        -- Find all other confirmed attendees of this trip excluding Romesh
        SELECT ARRAY_AGG(member_id ORDER BY member_id) INTO v_attendee_ids
        FROM public.trip_rsvps
        WHERE trip_id = v_expense.trip_id
          AND response = 'coming'
          AND (v_romesh_id IS NULL OR member_id <> v_romesh_id);

        v_attendee_count := COALESCE(array_length(v_attendee_ids, 1), 0);

        IF v_attendee_count > 0 THEN
            -- Delete old allocations
            DELETE FROM public.trip_expense_allocations WHERE expense_id = v_expense.id;

            -- Calculate equal allocations deterministically across the 11 attendees
            v_base_cents := v_expense.amount_cents / v_attendee_count;
            v_remainder := v_expense.amount_cents % v_attendee_count;

            FOR v_idx IN 1..v_attendee_count LOOP
                v_member_id := v_attendee_ids[v_idx];
                IF v_idx <= v_remainder THEN
                    v_allocated := v_base_cents + 1;
                ELSE
                    v_allocated := v_base_cents;
                END IF;

                INSERT INTO public.trip_expense_allocations (expense_id, member_id, allocated_cents)
                VALUES (v_expense.id, v_member_id, v_allocated);
            END LOOP;
        END IF;
    END LOOP;
END $$;
