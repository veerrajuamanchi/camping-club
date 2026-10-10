-- Migration: Ensure both uuid and text overloads of phase2_admin_update_campsite update all extended campsite fields
DROP FUNCTION IF EXISTS public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, text);

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
      availability_status = coalesce(p_input->>'availabilityStatus', availability_status),
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

-- Provide uuid signature that delegates cleanly to the text implementation
CREATE OR REPLACE FUNCTION public.phase2_admin_update_campsite(
  p_actor_id uuid,
  p_campsite_id uuid,
  p_input jsonb,
  p_reason text,
  p_request_id uuid
) RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private, extensions, pg_temp
AS $$
  SELECT public.phase2_admin_update_campsite(p_actor_id, p_campsite_id, p_input, p_reason, p_request_id::text);
$$;

REVOKE ALL ON FUNCTION public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase2_admin_update_campsite(uuid, uuid, jsonb, text, uuid) TO authenticated, service_role;
