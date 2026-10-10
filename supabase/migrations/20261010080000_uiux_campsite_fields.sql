-- Migration: Extend campsites schema with image_url, camp_host_name, camp_host_phone, camp_features, cabin_information, and admin campsite creation
ALTER TABLE public.campsites
  ADD COLUMN IF NOT EXISTS image_url text CHECK (image_url IS NULL OR image_url ~ '^https?://'),
  ADD COLUMN IF NOT EXISTS camp_host_name text,
  ADD COLUMN IF NOT EXISTS camp_host_phone text,
  ADD COLUMN IF NOT EXISTS camp_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cabin_information text;

-- Allow active campsites without requiring a strict 1..7 rotation slot if rotation is optional or assigned next
ALTER TABLE public.campsites DROP CONSTRAINT IF EXISTS campsites_check;
ALTER TABLE public.campsites ADD CONSTRAINT campsites_check CHECK (
  (active AND (rotation_position IS NULL OR rotation_position > 0)) OR
  (NOT active AND rotation_position IS NULL)
);

-- Update public.phase2_admin_update_campsite to save the new fields
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
BEGIN
  PERFORM private.phase2_require_admin(p_actor_id);
  IF jsonb_typeof(p_input) <> 'object' OR p_reason IS NULL OR length(btrim(p_reason)) = 0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid campsite update';
  END IF;

  v_expected := (p_input->>'expectedVersion')::integer;

  UPDATE public.campsites
  SET name = btrim(p_input->>'name'),
      availability_url = nullif(p_input->>'availabilityUrl', ''),
      location_description = coalesce(p_input->>'locationDescription', ''),
      directions = nullif(p_input->>'directions', ''),
      cabin_capacity = nullif(p_input->>'cabinCapacity', '')::integer,
      cabin_types = coalesce(p_input->'cabinTypes', '[]'::jsonb),
      reservation_instructions = nullif(p_input->>'reservationInstructions', ''),
      estimated_rate_cents = nullif(p_input->>'estimatedRateCents', '')::bigint,
      availability_status = p_input->>'availabilityStatus',
      availability_source_url = nullif(p_input->>'availabilitySourceUrl', ''),
      availability_verified_at = nullif(p_input->>'availabilityVerifiedAt', '')::timestamptz,
      image_url = nullif(p_input->>'imageUrl', ''),
      camp_host_name = nullif(p_input->>'campHostName', ''),
      camp_host_phone = nullif(p_input->>'campHostPhone', ''),
      camp_features = coalesce(p_input->'campFeatures', '[]'::jsonb),
      cabin_information = nullif(p_input->>'cabinInformation', ''),
      updated_by = p_actor_id,
      updated_at = now(),
      version = version + 1
  WHERE id = p_campsite_id AND version = v_expected
  RETURNING version INTO v_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campsite not found or stale version' USING errcode = '40001';
  END IF;

  INSERT INTO private.campsite_admin_notes (campsite_id, admin_notes, updated_by, updated_at)
  VALUES (p_campsite_id, coalesce(p_input->>'adminNotes', ''), p_actor_id, now())
  ON CONFLICT (campsite_id) DO UPDATE
    SET admin_notes = excluded.admin_notes,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  INSERT INTO public.audit_events (actor_id, actor_kind, entity_type, entity_id, action, reason, request_id, after_hash)
  VALUES (p_actor_id, 'admin', 'campsite', p_campsite_id, 'campsite_updated', p_reason, p_request_id, extensions.digest(convert_to(p_input::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN v_version;
END;
$$;

-- Create helper to add a brand new campsite
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
BEGIN
  PERFORM private.phase2_require_admin(p_actor_id);
  IF jsonb_typeof(p_input) <> 'object' OR p_reason IS NULL OR length(btrim(p_reason)) = 0 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid campsite creation';
  END IF;

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
  VALUES (p_actor_id, 'admin', 'campsite', v_id, 'campsite_created', p_reason, p_request_id, extensions.digest(convert_to(p_input::text, 'UTF8'), 'sha256'))
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_create_campsite(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase2_admin_create_campsite(uuid, jsonb, text, text) TO authenticated, service_role;
