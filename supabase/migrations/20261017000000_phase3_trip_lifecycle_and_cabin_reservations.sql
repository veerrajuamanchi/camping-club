-- Phase 3: Trip Lifecycle Automation, Cabin Reservation Tracking, and Automated Notifications

-- 1. Expand event_status and cabin_booking_status on public.camping_trips
ALTER TABLE public.camping_trips DROP CONSTRAINT IF EXISTS camping_trips_event_status_check;
ALTER TABLE public.camping_trips ADD CONSTRAINT camping_trips_event_status_check CHECK (
  event_status IN (
    'rsvp_open',
    'confirmed',
    'in_progress',
    'completed',
    'financially_finalized',
    'financially_settled',
    'archived',
    'cancelled',
    'tentative'
  )
);

-- Add trip_status column if not exists and sync with event_status
ALTER TABLE public.camping_trips
  ADD COLUMN IF NOT EXISTS trip_status text NOT NULL DEFAULT 'rsvp_open',
  ADD COLUMN IF NOT EXISTS trip_mileage_rate_cents int NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS deposit_amount_cents int NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS cabin_payer_member_id uuid REFERENCES public.member_profiles(member_id) ON DELETE SET NULL;

UPDATE public.camping_trips
SET trip_status = CASE
  WHEN event_status = 'confirmed' THEN 'confirmed'
  WHEN event_status = 'cancelled' THEN 'cancelled'
  ELSE 'rsvp_open'
END
WHERE trip_status IS NULL OR trip_status = 'rsvp_open';

ALTER TABLE public.camping_trips DROP CONSTRAINT IF EXISTS camping_trips_cabin_booking_status_check;
ALTER TABLE public.camping_trips ADD CONSTRAINT camping_trips_cabin_booking_status_check CHECK (
  cabin_booking_status IS NULL OR cabin_booking_status IN (
    'not_booked',
    'booked',
    'pending',
    'sites_available',
    'no_vacancy',
    'cancellation_requested',
    'cancellation_confirmed',
    'unresolved'
  )
);

-- 2. Cabin Reservations Table
CREATE TABLE IF NOT EXISTS public.cabin_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE UNIQUE,
  status text NOT NULL DEFAULT 'not_booked' CHECK (
    status IN ('not_booked', 'booked', 'pending', 'cancellation_requested', 'cancellation_confirmed', 'unresolved')
  ),
  reservation_reference text,
  provider_label text,
  paid_by_member_id uuid REFERENCES public.member_profiles(member_id) ON DELETE SET NULL,
  reservation_amount_cents bigint NOT NULL DEFAULT 0 CHECK (reservation_amount_cents >= 0),
  cabin_count int DEFAULT 1 CHECK (cabin_count IS NULL OR cabin_count > 0),
  per_cabin_capacity int DEFAULT 6 CHECK (per_cabin_capacity IS NULL OR per_cabin_capacity > 0),
  cancellation_notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cabin_reservations_trip_idx ON public.cabin_reservations(trip_id);
ALTER TABLE public.cabin_reservations ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.cabin_reservations TO authenticated;

DROP POLICY IF EXISTS cabin_reservations_select ON public.cabin_reservations;
CREATE POLICY cabin_reservations_select ON public.cabin_reservations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles
      WHERE member_profiles.auth_user_id = auth.uid()
        AND member_profiles.account_status = 'active'
    )
  );

-- 3. Trip Lifecycle Events Table
CREATE TABLE IF NOT EXISTS public.trip_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.camping_trips(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor_id uuid REFERENCES public.member_profiles(member_id) ON DELETE SET NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_lifecycle_events_trip_idx ON public.trip_lifecycle_events(trip_id, created_at DESC);
ALTER TABLE public.trip_lifecycle_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.trip_lifecycle_events TO authenticated;

DROP POLICY IF EXISTS trip_lifecycle_events_select ON public.trip_lifecycle_events;
CREATE POLICY trip_lifecycle_events_select ON public.trip_lifecycle_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles
      WHERE member_profiles.auth_user_id = auth.uid()
        AND member_profiles.account_status = 'active'
    )
  );

-- 4. Notification Outbox (in private schema)
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES public.camping_trips(id) ON DELETE CASCADE,
  recipient_member_id uuid REFERENCES public.member_profiles(member_id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (
    notification_type IN ('rsvp_deadline', 'trip_confirmed', 'trip_cancelled', 'state_transition', 'duty_reminder', 'offline_packet')
  ),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS notification_outbox_status_idx ON private.notification_outbox(status, created_at);
ALTER TABLE private.notification_outbox ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated grants on private.notification_outbox (service role only)

-- 5. RPC: Phase 3 Transition Trip Lifecycle
CREATE OR REPLACE FUNCTION public.phase3_transition_trip_lifecycle(
  p_actor_id uuid,
  p_trip_id uuid,
  p_to_status text,
  p_reason text DEFAULT NULL,
  p_expected_version int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_role text;
  v_current_status text;
  v_version int;
  v_valid_transition boolean := false;
  v_attendee_record record;
  v_payload jsonb;
BEGIN
  -- Verify caller is active admin
  SELECT member_role INTO v_role
  FROM public.member_profiles
  WHERE member_id = p_actor_id AND account_status = 'active';

  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'unauthorized: admin role required' USING ERRCODE = '42501';
  END IF;

  -- Verify trip exists
  SELECT COALESCE(trip_status, event_status, 'rsvp_open'), version
  INTO v_current_status, v_version
  FROM public.camping_trips
  WHERE id = p_trip_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_version IS NOT NULL AND v_version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_version: trip version has changed' USING ERRCODE = 'P0004';
  END IF;

  -- Validate state machine graph
  -- rsvp_open/tentative -> confirmed, cancelled
  -- confirmed -> in_progress, cancelled
  -- in_progress -> completed, cancelled
  -- completed -> financially_finalized
  -- financially_finalized -> financially_settled, completed (re-open)
  -- financially_settled -> archived
  -- any -> cancelled (admin emergency override)
  IF p_to_status = 'cancelled' THEN
    v_valid_transition := true;
  ELSIF (v_current_status = 'rsvp_open' OR v_current_status = 'tentative') AND p_to_status = 'confirmed' THEN
    v_valid_transition := true;
  ELSIF v_current_status = 'confirmed' AND p_to_status = 'in_progress' THEN
    v_valid_transition := true;
  ELSIF v_current_status = 'in_progress' AND p_to_status = 'completed' THEN
    v_valid_transition := true;
  ELSIF v_current_status = 'completed' AND p_to_status = 'financially_finalized' THEN
    v_valid_transition := true;
  ELSIF v_current_status = 'financially_finalized' AND (p_to_status = 'financially_settled' OR p_to_status = 'completed') THEN
    v_valid_transition := true;
  ELSIF v_current_status = 'financially_settled' AND p_to_status = 'archived' THEN
    v_valid_transition := true;
  ELSIF v_current_status = p_to_status THEN
    v_valid_transition := true;
  END IF;

  IF NOT v_valid_transition THEN
    RAISE EXCEPTION 'invalid_lifecycle_transition: cannot move from % to %', v_current_status, p_to_status
      USING ERRCODE = '22000';
  END IF;

  -- Update trip
  UPDATE public.camping_trips
  SET
    trip_status = p_to_status,
    event_status = CASE
      WHEN p_to_status = 'confirmed' THEN 'confirmed'
      WHEN p_to_status = 'cancelled' THEN 'cancelled'
      ELSE p_to_status
    END,
    version = version + 1,
    updated_at = now()
  WHERE id = p_trip_id;

  -- Record audit event
  INSERT INTO public.trip_lifecycle_events (
    trip_id,
    from_status,
    to_status,
    actor_id,
    reason,
    metadata
  ) VALUES (
    p_trip_id,
    v_current_status,
    p_to_status,
    p_actor_id,
    p_reason,
    jsonb_build_object('transition_at', now(), 'actor_id', p_actor_id)
  );

  -- Queue notifications for confirmed or cancelled state
  IF p_to_status = 'confirmed' OR p_to_status = 'cancelled' OR p_to_status = 'state_transition' THEN
    FOR v_attendee_record IN
      SELECT DISTINCT member_id
      FROM public.trip_participant_entries
      WHERE trip_id = p_trip_id AND response = 'coming'
    LOOP
      INSERT INTO private.notification_outbox (
        trip_id,
        recipient_member_id,
        notification_type,
        payload
      ) VALUES (
        p_trip_id,
        v_attendee_record.member_id,
        CASE
          WHEN p_to_status = 'confirmed' THEN 'trip_confirmed'
          WHEN p_to_status = 'cancelled' THEN 'trip_cancelled'
          ELSE 'state_transition'
        END,
        jsonb_build_object(
          'trip_id', p_trip_id,
          'to_status', p_to_status,
          'reason', p_reason
        )
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'trip_id', p_trip_id,
    'from_status', v_current_status,
    'to_status', p_to_status,
    'version', v_version + 1,
    'success', true
  );
END;
$$;

-- 6. RPC: Phase 3 Update Cabin Reservation
CREATE OR REPLACE FUNCTION public.phase3_update_cabin_reservation(
  p_actor_id uuid,
  p_trip_id uuid,
  p_status text,
  p_reservation_reference text DEFAULT NULL,
  p_provider_label text DEFAULT NULL,
  p_paid_by_member_id uuid DEFAULT NULL,
  p_reservation_amount_cents bigint DEFAULT 0,
  p_cabin_count int DEFAULT 1,
  p_per_cabin_capacity int DEFAULT 6,
  p_cancellation_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_role text;
  v_res_id uuid;
BEGIN
  -- Verify caller is active admin
  SELECT member_role INTO v_role
  FROM public.member_profiles
  WHERE member_id = p_actor_id AND account_status = 'active';

  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'unauthorized: admin role required' USING ERRCODE = '42501';
  END IF;

  -- Upsert cabin reservation
  INSERT INTO public.cabin_reservations (
    trip_id,
    status,
    reservation_reference,
    provider_label,
    paid_by_member_id,
    reservation_amount_cents,
    cabin_count,
    per_cabin_capacity,
    cancellation_notes,
    updated_at
  ) VALUES (
    p_trip_id,
    p_status,
    p_reservation_reference,
    p_provider_label,
    p_paid_by_member_id,
    COALESCE(p_reservation_amount_cents, 0),
    COALESCE(p_cabin_count, 1),
    COALESCE(p_per_cabin_capacity, 6),
    p_cancellation_notes,
    now()
  )
  ON CONFLICT (trip_id) DO UPDATE SET
    status = EXCLUDED.status,
    reservation_reference = EXCLUDED.reservation_reference,
    provider_label = EXCLUDED.provider_label,
    paid_by_member_id = EXCLUDED.paid_by_member_id,
    reservation_amount_cents = EXCLUDED.reservation_amount_cents,
    cabin_count = EXCLUDED.cabin_count,
    per_cabin_capacity = EXCLUDED.per_cabin_capacity,
    cancellation_notes = EXCLUDED.cancellation_notes,
    updated_at = now()
  RETURNING id INTO v_res_id;

  -- Sync with camping_trips
  UPDATE public.camping_trips
  SET
    cabin_booking_status = CASE
      WHEN p_status IN ('booked', 'pending', 'sites_available', 'no_vacancy', 'cancellation_requested', 'cancellation_confirmed', 'unresolved') THEN p_status
      ELSE 'not_booked'
    END,
    cabin_count = COALESCE(p_cabin_count, cabin_count),
    per_cabin_capacity = COALESCE(p_per_cabin_capacity, per_cabin_capacity),
    cabin_payer_member_id = COALESCE(p_paid_by_member_id, cabin_payer_member_id),
    version = version + 1,
    updated_at = now()
  WHERE id = p_trip_id;

  RETURN jsonb_build_object(
    'reservation_id', v_res_id,
    'trip_id', p_trip_id,
    'status', p_status,
    'success', true
  );
END;
$$;

-- 7. RPC: Phase 3 Get Trip Lifecycle Details
CREATE OR REPLACE FUNCTION public.phase3_get_trip_lifecycle(
  p_trip_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_trip record;
  v_reservation record;
  v_events jsonb;
  v_outbox_count int;
BEGIN
  SELECT id, title, trip_status, event_status, poll_status, starts_on, ends_on,
         minimum_participants, max_capacity, cabin_booking_status, cabin_count,
         per_cabin_capacity, trip_mileage_rate_cents, deposit_amount_cents, version
  INTO v_trip
  FROM public.camping_trips
  WHERE id = p_trip_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, status, reservation_reference, provider_label, paid_by_member_id,
         reservation_amount_cents, cabin_count, per_cabin_capacity, cancellation_notes, updated_at
  INTO v_reservation
  FROM public.cabin_reservations
  WHERE trip_id = p_trip_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'from_status', from_status,
      'to_status', to_status,
      'actor_id', actor_id,
      'reason', reason,
      'created_at', created_at
    ) ORDER BY created_at DESC
  ), '[]'::jsonb)
  INTO v_events
  FROM public.trip_lifecycle_events
  WHERE trip_id = p_trip_id;

  SELECT COUNT(*) INTO v_outbox_count
  FROM private.notification_outbox
  WHERE trip_id = p_trip_id;

  RETURN jsonb_build_object(
    'trip', row_to_json(v_trip),
    'reservation', CASE WHEN v_reservation.id IS NOT NULL THEN row_to_json(v_reservation) ELSE NULL END,
    'lifecycle_events', v_events,
    'notifications_queued_count', v_outbox_count
  );
END;
$$;
