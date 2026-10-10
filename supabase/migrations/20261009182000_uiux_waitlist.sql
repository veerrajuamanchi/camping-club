-- supabase/migrations/20261009182000_uiux_waitlist.sql

CREATE TABLE public.trip_waitlist_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid        NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE,
  member_id   uuid        NOT NULL REFERENCES public.member_profiles(member_id) ON DELETE CASCADE,
  position    int         NOT NULL CHECK (position >= 1),
  status      text        NOT NULL DEFAULT 'waiting'
                          CHECK (status IN ('waiting','promoted','expired','removed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  promoted_by uuid        REFERENCES public.member_profiles(member_id) ON DELETE SET NULL
);

-- Indices
-- Composite index for FIFO waitlist queue queries by trip, status, and position
CREATE INDEX trip_waitlist_trip_status_pos_idx
  ON public.trip_waitlist_entries (trip_id, status, position);

-- Unique index ensuring a member has at most one active 'waiting' entry per trip
CREATE UNIQUE INDEX waitlist_member_waiting_uidx
  ON public.trip_waitlist_entries (trip_id, member_id)
  WHERE status = 'waiting';

-- Foreign key indexes (Rule 5: all FK columns must be indexed unless covered by a leading composite index)
CREATE INDEX trip_waitlist_member_idx
  ON public.trip_waitlist_entries (member_id);

CREATE INDEX trip_waitlist_promoted_by_idx
  ON public.trip_waitlist_entries (promoted_by);

-- Row Level Security
ALTER TABLE public.trip_waitlist_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.trip_waitlist_entries FROM anon, authenticated;

-- Members see only their own waitlist rows
CREATE POLICY "member_own_waitlist" ON public.trip_waitlist_entries
  FOR SELECT
  TO authenticated
  USING (
    member_id = (
      SELECT mp.member_id FROM public.member_profiles mp
      WHERE mp.auth_user_id = auth.uid() AND mp.account_status = 'active'
      LIMIT 1
    )
  );

-- Admins see all waitlist rows
CREATE POLICY "admin_all_waitlist" ON public.trip_waitlist_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.auth_user_id = auth.uid()
        AND mp.member_role = 'admin'
        AND mp.account_status = 'active'
    )
  );

-- Grants: read-only access for authenticated users; mutations restricted to server-side service role
GRANT SELECT ON public.trip_waitlist_entries TO authenticated;
GRANT ALL ON public.trip_waitlist_entries TO service_role;

-- Helper for next waitlist position
CREATE OR REPLACE FUNCTION public.trip_waitlist_next_position(p_trip_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(MAX(position), 0) + 1
  FROM public.trip_waitlist_entries
  WHERE trip_id = p_trip_id;
$$;

GRANT EXECUTE ON FUNCTION public.trip_waitlist_next_position(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.trip_waitlist_entries IS
  'Queue of members waiting for spots on oversubscribed trips with FIFO position ordering.';
COMMENT ON COLUMN public.trip_waitlist_entries.trip_id IS
  'Camping trip the member is waitlisted for.';
COMMENT ON COLUMN public.trip_waitlist_entries.member_id IS
  'Waitlisted member.';
COMMENT ON COLUMN public.trip_waitlist_entries.position IS
  '1-based FIFO queue position for this trip.';
COMMENT ON COLUMN public.trip_waitlist_entries.status IS
  'Entry status: waiting, promoted, expired, or removed.';
COMMENT ON COLUMN public.trip_waitlist_entries.promoted_by IS
  'Admin member who promoted this waitlist entry into an active RSVP.';
COMMENT ON FUNCTION public.trip_waitlist_next_position(uuid) IS
  'Calculates the next FIFO queue position for a trip (max(position) + 1, defaulting to 1).';
