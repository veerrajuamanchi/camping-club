-- Migration: Campsite management enhancements (delete campsite, site availability, peak season timeframe, peak season booking requirement)

-- 1. Add new columns to public.campsites
ALTER TABLE public.campsites
  ADD COLUMN IF NOT EXISTS site_availability text NOT NULL DEFAULT 'open_year_round',
  ADD COLUMN IF NOT EXISTS peak_season_timeframe text,
  ADD COLUMN IF NOT EXISTS peak_season_booking_requirement text;

-- Add constraints for lengths and valid values
ALTER TABLE public.campsites DROP CONSTRAINT IF EXISTS campsites_site_availability_check;
ALTER TABLE public.campsites ADD CONSTRAINT campsites_site_availability_check CHECK (
  site_availability IN ('open_year_round', 'closed_for_winter')
);

ALTER TABLE public.campsites DROP CONSTRAINT IF EXISTS campsites_peak_season_timeframe_check;
ALTER TABLE public.campsites ADD CONSTRAINT campsites_peak_season_timeframe_check CHECK (
  peak_season_timeframe IS NULL OR length(btrim(peak_season_timeframe)) <= 50
);

ALTER TABLE public.campsites DROP CONSTRAINT IF EXISTS campsites_peak_season_booking_requirement_check;
ALTER TABLE public.campsites ADD CONSTRAINT campsites_peak_season_booking_requirement_check CHECK (
  peak_season_booking_requirement IS NULL OR length(btrim(peak_season_booking_requirement)) <= 30
);

-- 2. Update phase2_admin_create_campsite to accept new columns
CREATE OR REPLACE FUNCTION public.phase2_admin_create_campsite(
  p_actor_id uuid,
  p_input jsonb,
  p_reason text,
  p_request_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, private, extensions, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_next_pos integer;
  v_request_uuid uuid;
BEGIN
  PERFORM private.phase2_require_admin(p_actor_id);
  IF jsonb_typeof(p_input) <> 'object' OR p_reason IS NULL OR length(btrim(p_reason)) = 0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid campsite creation';
  END IF;

  BEGIN
    v_request_uuid := p_request_id::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_request_uuid := gen_random_uuid();
  END;

  SELECT coalesce(max(rotation_position), 0) + 1 INTO v_next_pos FROM public.campsites;

  INSERT INTO public.campsites (
    name,
    rotation_position,
    location_description,
    availability_url,
    directions,
    cabin_capacity,
    cabin_types,
    reservation_instructions,
    estimated_rate_cents,
    availability_status,
    availability_source_url,
    image_url,
    camp_host_name,
    camp_host_phone,
    camp_features,
    cabin_information,
    site_availability,
    peak_season_timeframe,
    peak_season_booking_requirement,
    active,
    version,
    created_by,
    updated_by
  ) VALUES (
    btrim(p_input->>'name'),
    v_next_pos,
    coalesce(p_input->>'locationDescription', ''),
    nullif(p_input->>'availabilityUrl', ''),
    nullif(p_input->>'directions', ''),
    nullif(p_input->>'cabinCapacity', '')::integer,
    coalesce(p_input->'cabinTypes', '[]'::jsonb),
    nullif(p_input->>'reservationInstructions', ''),
    nullif(p_input->>'estimatedRateCents', '')::bigint,
    coalesce(p_input->>'availabilityStatus', 'available'),
    nullif(p_input->>'availabilitySourceUrl', ''),
    nullif(p_input->>'imageUrl', ''),
    nullif(p_input->>'campHostName', ''),
    nullif(p_input->>'campHostPhone', ''),
    coalesce(p_input->'campFeatures', '[]'::jsonb),
    nullif(p_input->>'cabinInformation', ''),
    coalesce(p_input->>'siteAvailability', 'open_year_round'),
    nullif(p_input->>'peakSeasonTimeframe', ''),
    nullif(p_input->>'peakSeasonBookingRequirement', ''),
    true,
    1,
    p_actor_id,
    p_actor_id
  ) RETURNING id INTO v_id;

  IF p_input->>'adminNotes' IS NOT NULL AND length(btrim(p_input->>'adminNotes')) > 0 THEN
    INSERT INTO private.campsite_admin_notes (campsite_id, admin_notes, updated_by, updated_at)
    VALUES (v_id, p_input->>'adminNotes', p_actor_id, now());
  END IF;

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (p_actor_id, 'admin', 'campsite', v_id, 'campsite_created', p_reason, v_request_uuid, extensions.digest(convert_to(p_input::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_create_campsite(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase2_admin_create_campsite(uuid, jsonb, text, text) TO authenticated, service_role;

-- 3. Update phase2_admin_update_campsite to update new columns
CREATE OR REPLACE FUNCTION public.phase2_admin_update_campsite(
  p_actor_id uuid,
  p_campsite_id uuid,
  p_input jsonb,
  p_reason text,
  p_request_id text
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, private, extensions, pg_temp
AS $$
DECLARE
  v_expected integer;
  v_version integer;
  v_request_uuid uuid;
  v_site public.campsites%rowtype;
BEGIN
  PERFORM private.phase2_require_admin(p_actor_id);
  IF jsonb_typeof(p_input) <> 'object' OR p_reason IS NULL OR length(btrim(p_reason)) = 0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid campsite update';
  END IF;

  BEGIN
    v_request_uuid := p_request_id::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_request_uuid := gen_random_uuid();
  END;

  v_expected := (p_input->>'expectedVersion')::integer;

  UPDATE public.campsites
  SET name = CASE WHEN p_input ? 'name' THEN btrim(p_input->>'name') ELSE name END,
      availability_url = CASE WHEN p_input ? 'availabilityUrl' THEN nullif(p_input->>'availabilityUrl', '') ELSE availability_url END,
      location_description = CASE WHEN p_input ? 'locationDescription' THEN coalesce(p_input->>'locationDescription', '') ELSE location_description END,
      directions = CASE WHEN p_input ? 'directions' THEN nullif(p_input->>'directions', '') ELSE directions END,
      cabin_capacity = CASE WHEN p_input ? 'cabinCapacity' THEN nullif(p_input->>'cabinCapacity', '')::integer ELSE cabin_capacity END,
      cabin_types = CASE WHEN p_input ? 'cabinTypes' THEN coalesce(p_input->'cabinTypes', '[]'::jsonb) ELSE cabin_types END,
      reservation_instructions = CASE WHEN p_input ? 'reservationInstructions' THEN nullif(p_input->>'reservationInstructions', '') ELSE reservation_instructions END,
      estimated_rate_cents = CASE WHEN p_input ? 'estimatedRateCents' THEN nullif(p_input->>'estimatedRateCents', '')::bigint ELSE estimated_rate_cents END,
      availability_status = CASE WHEN p_input ? 'availabilityStatus' THEN coalesce(p_input->>'availabilityStatus', availability_status) ELSE availability_status END,
      availability_source_url = CASE WHEN p_input ? 'availabilitySourceUrl' THEN nullif(p_input->>'availabilitySourceUrl', '') ELSE availability_source_url END,
      availability_verified_at = CASE WHEN p_input ? 'availabilityVerifiedAt' THEN nullif(p_input->>'availabilityVerifiedAt', '')::timestamptz ELSE availability_verified_at END,
      image_url = CASE WHEN p_input ? 'imageUrl' THEN nullif(p_input->>'imageUrl', '') ELSE image_url END,
      camp_host_name = CASE WHEN p_input ? 'campHostName' THEN nullif(p_input->>'campHostName', '') ELSE camp_host_name END,
      camp_host_phone = CASE WHEN p_input ? 'campHostPhone' THEN nullif(p_input->>'campHostPhone', '') ELSE camp_host_phone END,
      camp_features = CASE WHEN p_input ? 'campFeatures' THEN coalesce(p_input->'campFeatures', '[]'::jsonb) ELSE camp_features END,
      cabin_information = CASE WHEN p_input ? 'cabinInformation' THEN nullif(p_input->>'cabinInformation', '') ELSE cabin_information END,
      site_availability = CASE WHEN p_input ? 'siteAvailability' THEN coalesce(p_input->>'siteAvailability', site_availability) ELSE site_availability END,
      peak_season_timeframe = CASE WHEN p_input ? 'peakSeasonTimeframe' THEN nullif(p_input->>'peakSeasonTimeframe', '') ELSE peak_season_timeframe END,
      peak_season_booking_requirement = CASE WHEN p_input ? 'peakSeasonBookingRequirement' THEN nullif(p_input->>'peakSeasonBookingRequirement', '') ELSE peak_season_booking_requirement END,
      updated_by = p_actor_id,
      updated_at = now(),
      version = version + 1
  WHERE id = p_campsite_id AND version = v_expected
  RETURNING version INTO v_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campsite not found or stale version' USING errcode = '40001';
  END IF;

  IF p_input ? 'adminNotes' THEN
    INSERT INTO private.campsite_admin_notes (campsite_id, admin_notes, updated_by, updated_at)
    VALUES (p_campsite_id, coalesce(p_input->>'adminNotes', ''), p_actor_id, now())
    ON CONFLICT (campsite_id) DO UPDATE
      SET admin_notes = excluded.admin_notes,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;
  END IF;

  SELECT * INTO v_site FROM public.campsites WHERE id = p_campsite_id;

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (p_actor_id, 'admin', 'campsite', p_campsite_id, 'campsite_updated', p_reason, v_request_uuid, extensions.digest(convert_to(to_jsonb(v_site)::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, text) TO authenticated, service_role;

-- 4. Admin RPC: Delete Campsite
CREATE OR REPLACE FUNCTION public.phase2_admin_delete_campsite(
  p_actor_id uuid,
  p_campsite_id uuid,
  p_reason text,
  p_request_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, private, extensions, pg_temp
AS $$
DECLARE
  v_site public.campsites%rowtype;
  v_request_uuid uuid;
  v_is_used boolean;
BEGIN
  PERFORM private.phase2_require_admin(p_actor_id);
  IF p_campsite_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) = 0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid campsite deletion request';
  END IF;

  BEGIN
    v_request_uuid := p_request_id::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_request_uuid := gen_random_uuid();
  END;

  SELECT * INTO v_site FROM public.campsites WHERE id = p_campsite_id AND active FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campsite not found or already deleted';
  END IF;

  -- Remove admin notes if present
  DELETE FROM private.campsite_admin_notes WHERE campsite_id = p_campsite_id;

  -- Check if referenced by active camping trips
  SELECT EXISTS (
    SELECT 1 FROM public.camping_trips
    WHERE (suggested_campsite_id = p_campsite_id OR selected_campsite_id = p_campsite_id)
      AND deleted_at IS NULL
  ) INTO v_is_used;

  IF v_is_used THEN
    -- Soft-delete to preserve trip history and relational integrity
    UPDATE public.campsites
    SET active = false,
        rotation_position = NULL,
        updated_by = p_actor_id,
        updated_at = now(),
        version = version + 1
    WHERE id = p_campsite_id
    RETURNING * INTO v_site;
  ELSE
    BEGIN
      DELETE FROM public.campsites WHERE id = p_campsite_id;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE public.campsites
      SET active = false,
          rotation_position = NULL,
          updated_by = p_actor_id,
          updated_at = now(),
          version = version + 1
      WHERE id = p_campsite_id
      RETURNING * INTO v_site;
    END;
  END IF;

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (p_actor_id, 'admin', 'campsite', p_campsite_id, 'campsite_deleted', p_reason, v_request_uuid, extensions.digest(convert_to(to_jsonb(v_site)::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'campsiteId', p_campsite_id);
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_delete_campsite(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase2_admin_delete_campsite(uuid, uuid, text, text) TO authenticated, service_role;

-- 5. Update phase2_admin_configure_trip to synchronize month_key with starts_on
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

  IF v_old_poll_status = 'draft' AND v_trip.poll_status = 'open' THEN
    INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, from_status, to_status, request_id, reason, event_details)
    VALUES (p_trip_id, p_actor_id, 'poll_opened', 'draft', 'open', p_request_id, p_reason, jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on, 'title', v_trip.title, 'event_status', v_trip.event_status, 'camping_type', v_trip.camping_type));
  END IF;

  IF v_old_booking_status <> p_cabin_booking_status THEN
    INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, request_id, reason, event_details)
    VALUES (p_trip_id, p_actor_id, 'cabin_booking_status_updated', p_request_id, p_reason, jsonb_build_object('from_status', v_old_booking_status, 'to_status', p_cabin_booking_status));
  END IF;

  IF v_old_site <> p_selected_campsite_id THEN
    INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, request_id, reason, event_details)
    VALUES (p_trip_id, p_actor_id, 'site_swapped', p_request_id, p_reason, jsonb_build_object('from_campsite', v_old_site, 'to_campsite', p_selected_campsite_id));
  END IF;

  INSERT INTO public.trip_poll_events (trip_id, actor_id, event_type, request_id, reason, event_details)
  VALUES (p_trip_id, p_actor_id, 'trip_configured', p_request_id, p_reason, jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on, 'poll_deadline_at', v_deadline, 'minimum_participants', p_minimum_participants, 'previous_cabin_booking_status', v_old_booking_status, 'cabin_booking_status', v_trip.cabin_booking_status, 'version', v_trip.version));

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (p_actor_id, 'admin', 'camping_trip', p_trip_id, 'trip_configured', p_reason, p_request_id, extensions.digest(convert_to(to_jsonb(v_trip)::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN jsonb_build_object('tripId', p_trip_id, 'version', v_trip.version);
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid,text,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_admin_configure_trip(uuid,uuid,date,date,date,time,integer,integer,uuid,text,text,integer,text,uuid,text,text,text,integer,integer) TO service_role;

