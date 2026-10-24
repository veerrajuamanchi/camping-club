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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.master_activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_activity_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_activity_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_activity_group_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_activity_swap_requests TO authenticated;

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

DROP POLICY IF EXISTS trip_activity_groups_update ON public.trip_activity_groups;
CREATE POLICY trip_activity_groups_update ON public.trip_activity_groups
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
              AND (
                mp.member_role IN ('admin', 'administrator')
                OR EXISTS (
                  SELECT 1 FROM public.trip_activity_group_members gm
                  WHERE gm.group_id = trip_activity_groups.id
                    AND gm.member_id = mp.member_id
                )
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.member_profiles mp
            WHERE (mp.auth_user_id = auth.uid() OR mp.member_id = auth.uid())
              AND mp.account_status = 'active'
              AND (
                mp.member_role IN ('admin', 'administrator')
                OR EXISTS (
                  SELECT 1 FROM public.trip_activity_group_members gm
                  WHERE gm.group_id = trip_activity_groups.id
                    AND gm.member_id = mp.member_id
                )
              )
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
