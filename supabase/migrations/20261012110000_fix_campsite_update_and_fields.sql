-- Migration: Fix campsite update overload, cast audit request_id, preserve unsupplied fields, and relax URL check constraint
ALTER TABLE public.campsites DROP CONSTRAINT IF EXISTS campsites_availability_url_check;
ALTER TABLE public.campsites DROP CONSTRAINT IF EXISTS campsites_check1;
-- Allow http and https URLs
ALTER TABLE public.campsites ADD CONSTRAINT campsites_availability_url_check CHECK (
  availability_url IS NULL OR availability_url ~ '^https?://'
);

-- Drop conflicting uuid overload to prevent PostgREST PGRST203 multiple choices error
DROP FUNCTION IF EXISTS public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, text);

-- Single canonical update implementation with text request_id coerced to uuid for audit_events
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

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (p_actor_id, 'admin', 'campsite', p_campsite_id, 'campsite_updated', p_reason, v_request_uuid, extensions.digest(convert_to(p_input::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, text) TO authenticated, service_role;

-- Canonical create implementation with request_id coerced to uuid for audit_events
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
