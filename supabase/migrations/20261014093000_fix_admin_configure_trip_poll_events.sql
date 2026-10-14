-- Fix phase2_admin_configure_trip to use valid trip_poll_events event_types and return schema
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
      month_key = date_trunc('month', p_starts_on)::date,
      is_auto_scheduled = false,
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
  VALUES (p_trip_id, p_actor_id, 'trip_configured', p_request_id, p_reason, jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on, 'poll_deadline_at', v_deadline, 'minimum_participants', p_minimum_participants, 'previous_cabin_booking_status', v_old_booking_status, 'cabin_booking_status', v_trip.cabin_booking_status, 'title', v_trip.title, 'event_status', v_trip.event_status, 'camping_type', v_trip.camping_type, 'version', v_trip.version));

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (p_actor_id, 'admin', 'camping_trip', p_trip_id, 'trip_configured', p_reason, p_request_id, extensions.digest(convert_to(to_jsonb(v_trip)::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN jsonb_build_object('tripId', p_trip_id, 'version', v_trip.version, 'pollDeadlineAt', v_deadline, 'minimumBasis', null);
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid,text,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid,text,text,text,integer,integer) TO service_role;
