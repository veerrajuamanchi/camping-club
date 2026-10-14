-- Migration: Trip management enhancements (delete trips, custom titles, event status, camping types, custom trip creation, unschedule calendar replenishment)

-- 1. Add columns to public.camping_trips
ALTER TABLE public.camping_trips
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS event_status text NOT NULL DEFAULT 'tentative' CHECK (event_status IN ('tentative', 'confirmed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS camping_type text NOT NULL DEFAULT 'cabin' CHECK (camping_type IN ('cabin', 'tent', 'rv', 'boat')),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_auto_scheduled boolean NOT NULL DEFAULT false;

-- Mark existing generated trips as auto-scheduled
UPDATE public.camping_trips SET is_auto_scheduled = true;

-- 2. Relax cabin_booking_status constraint to support pending alongside booked and sites_available
ALTER TABLE public.camping_trips DROP CONSTRAINT IF EXISTS camping_trips_cabin_booking_status_check;
ALTER TABLE public.camping_trips ADD CONSTRAINT camping_trips_cabin_booking_status_check CHECK (
  cabin_booking_status IS NULL OR cabin_booking_status IN ('booked', 'pending', 'sites_available', 'no_vacancy')
);

-- 2b. Expand trip_poll_events event_type constraint to allow trip_deleted and trip_created
ALTER TABLE public.trip_poll_events DROP CONSTRAINT IF EXISTS trip_poll_events_event_type_check;
ALTER TABLE public.trip_poll_events ADD CONSTRAINT trip_poll_events_event_type_check CHECK (
  event_type IN ('calendar_month_generated','poll_opened','poll_closed','poll_reopened','trip_configured','campsite_overridden','rotation_reordered','trip_deleted','trip_created')
);

-- 3. Relax unique month_key constraint to allow multiple custom trips and deletions
ALTER TABLE public.camping_trips DROP CONSTRAINT IF EXISTS camping_trips_month_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS camping_trips_auto_month_key_active_idx
  ON public.camping_trips (month_key)
  WHERE deleted_at IS NULL AND is_auto_scheduled = true;

CREATE INDEX IF NOT EXISTS camping_trips_deleted_at_idx
  ON public.camping_trips (deleted_at);

-- 4. Unschedule pg_cron calendar replenishment job (12-month schedule is a one-time template)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'phase2-replenish-calendar';
    EXCEPTION WHEN OTHERS THEN
      -- In case job does not exist or pg_cron is not configured
      NULL;
    END;
  END IF;
END $$;

-- 5. Update phase2_generate_calendar to check existence directly instead of on conflict(month_key)
CREATE OR REPLACE FUNCTION public.phase2_generate_calendar(
  p_actor_id uuid,
  p_through_month date,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_config public.club_configuration%rowtype;
  v_count integer;
  v_position integer;
  v_month date;
  v_site uuid;
  v_trip uuid;
  v_generated integer := 0;
  v_site_count integer;
BEGIN
  IF p_through_month IS NULL OR extract(day FROM p_through_month) <> 1 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid calendar range';
  END IF;
  IF p_actor_id IS NOT NULL THEN
    PERFORM private.phase2_require_admin(p_actor_id);
  ELSIF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'trusted scheduler required' USING errcode = '42501';
  END IF;

  SELECT * INTO v_config FROM public.club_configuration WHERE singleton FOR UPDATE;
  SELECT count(*) INTO v_site_count FROM public.campsites WHERE active;
  IF v_site_count < 7 THEN
    RAISE EXCEPTION 'at least seven active campsites are required';
  END IF;
  IF (SELECT count(*) FROM public.campsites WHERE active) <> (SELECT count(DISTINCT rotation_position) FROM public.campsites WHERE active)
    OR (SELECT min(rotation_position) FROM public.campsites WHERE active) <> 1
    OR (SELECT max(rotation_position) FROM public.campsites WHERE active) <> v_site_count THEN
    RAISE EXCEPTION 'active campsite rotation positions must be unique and contiguous from one';
  END IF;
  IF v_config.next_rotation_position > v_site_count THEN
    RAISE EXCEPTION 'configured next rotation position is outside the active rotation';
  END IF;

  v_month := v_config.next_month_to_generate;
  v_position := v_config.next_rotation_position;
  WHILE v_month <= p_through_month LOOP
    SELECT id INTO v_site FROM public.campsites WHERE active AND rotation_position = v_position;
    -- Do not resurrect deleted trips or duplicate existing months
    IF NOT EXISTS (SELECT 1 FROM public.camping_trips WHERE month_key = v_month) THEN
      INSERT INTO public.camping_trips (
        month_key,
        rotation_position,
        suggested_campsite_id,
        selected_campsite_id,
        minimum_participants,
        is_auto_scheduled,
        created_by,
        updated_by
      ) VALUES (
        v_month,
        v_position,
        v_site,
        v_site,
        v_config.default_minimum_participants,
        true,
        p_actor_id,
        p_actor_id
      ) RETURNING id INTO v_trip;

      IF v_trip IS NOT NULL THEN
        PERFORM private.phase2_build_rule_bundle(v_trip, p_actor_id);
        INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, to_status, request_id, event_details)
        VALUES (v_trip, p_actor_id, 'calendar_month_generated', 'draft', p_request_id, jsonb_build_object('month_key', v_month, 'rotation_position', v_position, 'suggested_campsite_id', v_site));
        v_generated := v_generated + 1;
      END IF;
    END IF;
    v_trip := NULL;
    v_month := (v_month + interval '1 month')::date;
    v_position := CASE WHEN v_position >= v_site_count THEN 1 ELSE v_position + 1 END;
  END LOOP;

  UPDATE public.club_configuration
  SET next_month_to_generate = v_month,
      next_rotation_position = v_position,
      updated_by = p_actor_id,
      updated_at = now(),
      version = version + CASE WHEN v_generated > 0 THEN 1 ELSE 0 END
  WHERE singleton;

  RETURN jsonb_build_object('generated_count', v_generated, 'through_month', p_through_month, 'next_month_to_generate', v_month, 'next_rotation_position', v_position);
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_generate_calendar(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_generate_calendar(uuid, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.phase2_generate_calendar(uuid, date, uuid) TO postgres, supabase_admin;

-- 6. Admin RPC: Delete Trip (Soft Delete)
CREATE OR REPLACE FUNCTION public.phase2_admin_delete_trip(
  p_actor_id uuid,
  p_trip_id uuid,
  p_reason text,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_trip public.camping_trips%rowtype;
BEGIN
  PERFORM private.phase2_require_admin(p_actor_id);
  IF p_trip_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) = 0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid trip deletion request';
  END IF;

  SELECT * INTO v_trip FROM public.camping_trips WHERE id = p_trip_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip not found or already deleted';
  END IF;

  UPDATE public.camping_trips
  SET deleted_at = now(),
      updated_by = p_actor_id,
      updated_at = now(),
      version = version + 1
  WHERE id = p_trip_id
  RETURNING * INTO v_trip;

  INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, request_id, reason, event_details)
  VALUES (p_trip_id, p_actor_id, 'trip_deleted', p_request_id, p_reason, jsonb_build_object('deleted_at', v_trip.deleted_at, 'version', v_trip.version));

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (p_actor_id, 'admin', 'camping_trip', p_trip_id, 'trip_deleted', p_reason, p_request_id, extensions.digest(convert_to(to_jsonb(v_trip)::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'tripId', p_trip_id);
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_delete_trip(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_admin_delete_trip(uuid, uuid, text, uuid) TO service_role;

-- 7. Admin RPC: Create Custom Camping Event
CREATE OR REPLACE FUNCTION public.phase2_admin_create_custom_trip(
  p_actor_id uuid,
  p_title text,
  p_starts_on date,
  p_ends_on date,
  p_selected_campsite_id uuid,
  p_camping_type text,
  p_sites_count integer,
  p_site_capacity integer,
  p_event_status text,
  p_booking_status text,
  p_minimum_participants integer,
  p_max_capacity integer,
  p_deadline_date date,
  p_deadline_time time,
  p_additional_information text,
  p_reason text,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_config public.club_configuration%rowtype;
  v_trip_timezone text;
  v_month_key date;
  v_deadline timestamptz;
  v_deadline_date date;
  v_deadline_time time;
  v_trip_id uuid;
  v_trip public.camping_trips%rowtype;
BEGIN
  PERFORM private.phase2_require_admin(p_actor_id);
  IF p_starts_on IS NULL OR p_ends_on IS NULL OR p_ends_on < p_starts_on THEN
    RAISE EXCEPTION 'invalid trip dates: end date must not precede start date';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) < 2 OR length(btrim(p_title)) > 120 THEN
    RAISE EXCEPTION 'invalid title length: must be between 2 and 120 characters';
  END IF;
  IF p_camping_type NOT IN ('cabin', 'tent', 'rv', 'boat') THEN
    RAISE EXCEPTION 'invalid camping type: %', p_camping_type;
  END IF;
  IF p_event_status NOT IN ('tentative', 'confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid event status: %', p_event_status;
  END IF;
  IF p_booking_status NOT IN ('booked', 'pending', 'sites_available', 'no_vacancy') THEN
    RAISE EXCEPTION 'invalid booking status: %', p_booking_status;
  END IF;
  IF p_minimum_participants NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'minimum participants must be between 1 and 100';
  END IF;
  IF p_max_capacity IS NOT NULL AND p_max_capacity < p_minimum_participants THEN
    RAISE EXCEPTION 'max capacity cannot be less than minimum participants';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.campsites WHERE id = p_selected_campsite_id AND active) THEN
    RAISE EXCEPTION 'selected campsite must be active';
  END IF;

  SELECT * INTO v_config FROM public.club_configuration WHERE singleton FOR SHARE;
  v_trip_timezone := v_config.club_timezone;
  IF v_trip_timezone IS NULL THEN
    RAISE EXCEPTION 'configure the club timezone before adding trips';
  END IF;

  v_month_key := date_trunc('month', p_starts_on)::date;
  v_deadline_date := COALESCE(p_deadline_date, p_starts_on - v_config.default_poll_lead_days);
  v_deadline_time := COALESCE(p_deadline_time, v_config.default_poll_close_time);
  IF v_deadline_time IS NOT NULL THEN
    v_deadline := (v_deadline_date + v_deadline_time) AT TIME ZONE v_trip_timezone;
  ELSE
    v_deadline := NULL;
  END IF;

  INSERT INTO public.camping_trips (
    month_key,
    rotation_position,
    suggested_campsite_id,
    selected_campsite_id,
    starts_on,
    ends_on,
    club_timezone_snapshot,
    poll_deadline_at,
    minimum_participants,
    max_capacity,
    poll_status,
    additional_information,
    cabin_booking_status,
    cabin_count,
    per_cabin_capacity,
    title,
    event_status,
    camping_type,
    is_auto_scheduled,
    created_by,
    updated_by
  ) VALUES (
    v_month_key,
    1,
    p_selected_campsite_id,
    p_selected_campsite_id,
    p_starts_on,
    p_ends_on,
    v_trip_timezone,
    v_deadline,
    p_minimum_participants,
    p_max_capacity,
    CASE WHEN v_deadline IS NOT NULL AND v_deadline > now() THEN 'open' ELSE 'draft' END,
    COALESCE(p_additional_information, ''),
    p_booking_status,
    p_sites_count,
    COALESCE(p_site_capacity, 6),
    btrim(p_title),
    p_event_status,
    p_camping_type,
    false,
    p_actor_id,
    p_actor_id
  ) RETURNING * INTO v_trip;

  v_trip_id := v_trip.id;

  PERFORM private.phase2_build_rule_bundle(v_trip_id, p_actor_id);

  INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, to_status, request_id, reason, event_details)
  VALUES (v_trip_id, p_actor_id, CASE WHEN v_trip.poll_status = 'open' THEN 'poll_opened' ELSE 'calendar_month_generated' END, v_trip.poll_status, p_request_id, p_reason, jsonb_build_object('title', v_trip.title, 'starts_on', p_starts_on, 'ends_on', p_ends_on, 'camping_type', p_camping_type, 'event_status', p_event_status));

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (p_actor_id, 'admin', 'camping_trip', v_trip_id, 'trip_custom_created', p_reason, p_request_id, extensions.digest(convert_to(to_jsonb(v_trip)::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN jsonb_build_object('tripId', v_trip_id, 'version', v_trip.version);
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_create_custom_trip(uuid, text, date, date, uuid, text, integer, integer, text, text, integer, integer, date, time, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_admin_create_custom_trip(uuid, text, date, date, uuid, text, integer, integer, text, text, integer, integer, date, time, text, text, uuid) TO service_role;

-- 8. Update phase2_admin_configure_trip to support title, event_status, camping_type, cabin_count, per_cabin_capacity
DROP FUNCTION IF EXISTS public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid);
DROP FUNCTION IF EXISTS public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid,text,text,text,integer,integer);

CREATE OR REPLACE FUNCTION public.phase2_admin_configure_trip(
  p_actor_id uuid,
  p_trip_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_deadline_date date,
  p_deadline_time time,
  p_minimum_participants integer,
  p_max_capacity integer,
  p_selected_campsite_id uuid,
  p_cabin_booking_status text,
  p_additional_information text,
  p_expected_version integer,
  p_reason text,
  p_request_id uuid,
  p_title text DEFAULT NULL,
  p_event_status text DEFAULT 'tentative',
  p_camping_type text DEFAULT 'cabin',
  p_cabin_count integer DEFAULT NULL,
  p_per_cabin_capacity integer DEFAULT 6
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_trip public.camping_trips%rowtype;
  v_config public.club_configuration%rowtype;
  v_deadline_date date;
  v_deadline_time time;
  v_deadline timestamptz;
  v_trip_timezone text;
  v_old_site uuid;
  v_old_booking_status text;
  v_old_poll_status text;
BEGIN
  PERFORM private.phase2_require_admin(p_actor_id);
  IF p_starts_on IS NULL OR p_ends_on IS NULL OR p_ends_on < p_starts_on OR p_minimum_participants NOT BETWEEN 1 AND 100
    OR (p_max_capacity IS NOT NULL AND p_max_capacity < p_minimum_participants)
    OR p_cabin_booking_status NOT IN ('booked', 'pending', 'sites_available', 'no_vacancy')
    OR p_reason IS NULL OR length(btrim(p_reason)) = 0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid trip configuration';
  END IF;

  SELECT * INTO v_trip FROM public.camping_trips WHERE id = p_trip_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll not found or trip deleted';
  END IF;

  IF v_trip.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale poll version' USING errcode = '40001';
  END IF;

  SELECT * INTO v_config FROM public.club_configuration WHERE singleton FOR SHARE;
  v_trip_timezone := COALESCE(v_trip.club_timezone_snapshot, v_config.club_timezone);
  IF v_trip_timezone IS NULL THEN
    RAISE EXCEPTION 'configure the club timezone before setting poll dates';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.campsites WHERE id = p_selected_campsite_id AND active) THEN
    RAISE EXCEPTION 'selected campsite must be active';
  END IF;

  v_deadline_date := COALESCE(p_deadline_date, p_starts_on - v_config.default_poll_lead_days);
  v_deadline_time := COALESCE(p_deadline_time, v_config.default_poll_close_time);
  IF v_deadline_time IS NOT NULL THEN
    v_deadline := (v_deadline_date + v_deadline_time) AT TIME ZONE v_trip_timezone;
  ELSE
    v_deadline := NULL;
  END IF;

  IF v_deadline IS NOT NULL AND v_deadline >= (p_starts_on::timestamp AT TIME ZONE v_trip_timezone) THEN
    RAISE EXCEPTION 'poll deadline must be before trip start';
  END IF;

  IF v_trip.poll_status = 'open' AND v_deadline IS NOT NULL AND v_deadline <= now() THEN
    RAISE EXCEPTION 'an open poll needs a future deadline';
  END IF;

  v_old_site := v_trip.selected_campsite_id;
  v_old_booking_status := v_trip.cabin_booking_status;
  v_old_poll_status := v_trip.poll_status;

  UPDATE public.camping_trips
  SET starts_on = p_starts_on,
      ends_on = p_ends_on,
      club_timezone_snapshot = v_trip_timezone,
      poll_deadline_at = v_deadline,
      poll_status = CASE WHEN v_deadline IS NOT NULL AND v_deadline > now() THEN 'open' ELSE 'closed' END,
      minimum_participants = p_minimum_participants,
      max_capacity = p_max_capacity,
      selected_campsite_id = p_selected_campsite_id,
      cabin_booking_status = p_cabin_booking_status,
      additional_information = COALESCE(p_additional_information, ''),
      title = COALESCE(nullif(btrim(p_title), ''), title),
      event_status = COALESCE(p_event_status, event_status),
      camping_type = COALESCE(p_camping_type, camping_type),
      cabin_count = CASE WHEN p_cabin_count IS NOT NULL THEN p_cabin_count ELSE cabin_count END,
      per_cabin_capacity = COALESCE(p_per_cabin_capacity, per_cabin_capacity),
      updated_by = p_actor_id,
      updated_at = now(),
      version = version + 1
  WHERE id = p_trip_id
  RETURNING * INTO v_trip;

  IF v_trip.poll_status = 'open' THEN
    PERFORM private.phase2_build_rule_bundle(p_trip_id, p_actor_id);
  END IF;

  IF v_trip.poll_status <> v_old_poll_status THEN
    INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, from_status, to_status, request_id, reason, event_details)
    VALUES (p_trip_id, p_actor_id, CASE WHEN v_trip.poll_status = 'open' THEN 'poll_opened' ELSE 'poll_closed' END,
      v_old_poll_status, v_trip.poll_status, p_request_id, p_reason, jsonb_build_object('controlled_by_deadline', true));
  END IF;

  IF p_selected_campsite_id <> v_old_site THEN
    INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, request_id, reason, event_details)
    VALUES (p_trip_id, p_actor_id, 'campsite_overridden', p_request_id, p_reason, jsonb_build_object('suggested_campsite_id', v_trip.suggested_campsite_id, 'selected_campsite_id', p_selected_campsite_id));
  END IF;

  INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, request_id, reason, event_details)
  VALUES (p_trip_id, p_actor_id, 'trip_configured', p_request_id, p_reason, jsonb_build_object(
    'starts_on', p_starts_on,
    'ends_on', p_ends_on,
    'poll_deadline_at', v_deadline,
    'minimum_participants', p_minimum_participants,
    'previous_cabin_booking_status', v_old_booking_status,
    'cabin_booking_status', v_trip.cabin_booking_status,
    'title', v_trip.title,
    'event_status', v_trip.event_status,
    'camping_type', v_trip.camping_type,
    'version', v_trip.version
  ));

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (p_actor_id, 'admin', 'camping_trip', p_trip_id, 'interest_poll_configured', p_reason, p_request_id, extensions.digest(convert_to(to_jsonb(v_trip)::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN jsonb_build_object('tripId', p_trip_id, 'version', v_trip.version, 'pollDeadlineAt', v_deadline, 'minimumBasis', null);
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid,text,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid,text,text,text,integer,integer) TO service_role;

-- 9. Admin RPC: Set poll status with idempotent opening support
CREATE OR REPLACE FUNCTION public.phase2_admin_set_poll_status(
  p_actor_id uuid,
  p_trip_id uuid,
  p_status text,
  p_expected_version integer,
  p_reason text,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_trip public.camping_trips%rowtype;
  v_from_status text;
BEGIN
  PERFORM private.phase2_require_admin(p_actor_id);
  IF p_status NOT IN ('open', 'closed') OR p_reason IS NULL OR length(btrim(p_reason)) = 0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid poll transition';
  END IF;

  SELECT * INTO v_trip FROM public.camping_trips WHERE id = p_trip_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll not found';
  END IF;

  IF v_trip.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale poll version' USING errcode = '40001';
  END IF;

  v_from_status := v_trip.poll_status;
  IF p_status = 'open' THEN
    IF v_trip.poll_status NOT IN ('draft', 'closed', 'open') THEN
      RAISE EXCEPTION 'poll cannot be opened from current state';
    END IF;
    IF v_trip.starts_on IS NULL OR v_trip.ends_on IS NULL OR v_trip.club_timezone_snapshot IS NULL OR v_trip.poll_deadline_at IS NULL OR v_trip.poll_deadline_at <= now() THEN
      RAISE EXCEPTION 'poll dates, timezone and future deadline are required';
    END IF;
    PERFORM private.phase2_build_rule_bundle(p_trip_id, p_actor_id);
  ELSE
    IF v_trip.poll_status <> 'open' THEN
      RAISE EXCEPTION 'only an open poll can be closed';
    END IF;
  END IF;

  UPDATE public.camping_trips
  SET poll_status = p_status,
      version = version + 1,
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = p_trip_id
  RETURNING * INTO v_trip;

  INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, from_status, to_status, request_id, reason, event_details)
  VALUES (
    p_trip_id,
    p_actor_id,
    CASE WHEN p_status = 'open' AND v_from_status = 'closed' THEN 'poll_reopened' WHEN p_status = 'open' THEN 'poll_opened' ELSE 'poll_closed' END,
    v_from_status,
    p_status,
    p_request_id,
    p_reason,
    jsonb_build_object('minimum_basis', null, 'decision_effect', 'none')
  );

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (
    p_actor_id,
    'admin',
    'camping_trip',
    p_trip_id,
    'interest_poll_' || p_status,
    p_reason,
    p_request_id,
    extensions.digest(convert_to(p_status || ':' || v_trip.version, 'UTF8'), 'sha256')
  )
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN jsonb_build_object('tripId', p_trip_id, 'version', v_trip.version, 'pollStatus', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_set_poll_status(uuid, uuid, text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_admin_set_poll_status(uuid, uuid, text, integer, text, uuid) TO service_role;
