-- supabase/migrations/20261009186000_uiux_promote_waitlist.sql

CREATE OR REPLACE FUNCTION public.trip_api_promote_from_waitlist(
  p_trip_id   uuid,
  p_member_id uuid,
  p_actor_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_effective_capacity int;
  v_coming_count       int;
  v_position           int;
  v_entry_id           uuid;
  v_ack                uuid;
  v_bundle_id          uuid;
  v_content_hash       text;
BEGIN
  -- Lock the waitlist entry
  SELECT id, position INTO v_entry_id, v_position
  FROM public.trip_waitlist_entries
  WHERE trip_id = p_trip_id AND member_id = p_member_id AND status = 'waiting'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_on_waitlist' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the trip row to serialize promotions
  PERFORM 1 FROM public.camping_trips WHERE id = p_trip_id FOR UPDATE;

  -- Check capacity
  SELECT public.trip_effective_capacity(p_trip_id) INTO v_effective_capacity;
  SELECT count(*) INTO v_coming_count FROM public.trip_rsvps WHERE trip_id = p_trip_id AND response = 'coming';

  IF v_effective_capacity IS NOT NULL AND v_coming_count >= v_effective_capacity THEN
    RAISE EXCEPTION 'trip_at_capacity' USING ERRCODE = '23514';
  END IF;

  -- Ensure rule acknowledgment exists for the coming RSVP
  SELECT id INTO v_ack
  FROM public.trip_rule_acknowledgments
  WHERE trip_id = p_trip_id AND member_id = p_member_id
  ORDER BY acknowledged_at DESC
  LIMIT 1;

  IF v_ack IS NULL THEN
    SELECT id, content_hash INTO v_bundle_id, v_content_hash
    FROM public.trip_rule_bundles
    WHERE trip_id = p_trip_id AND is_current;

    IF v_bundle_id IS NULL THEN
      v_bundle_id := private.phase2_build_rule_bundle(p_trip_id, p_actor_id);
      SELECT content_hash INTO v_content_hash
      FROM public.trip_rule_bundles
      WHERE id = v_bundle_id;
    END IF;

    IF v_bundle_id IS NOT NULL THEN
      INSERT INTO public.trip_rule_acknowledgments (trip_id, member_id, bundle_id, content_hash, statement_version, request_id)
      VALUES (p_trip_id, p_member_id, v_bundle_id, v_content_hash, 'coming-v1', gen_random_uuid())
      RETURNING id INTO v_ack;
    END IF;
  END IF;

  -- Promote: insert or update RSVP to coming
  INSERT INTO public.trip_rsvps (trip_id, member_id, response, rule_acknowledgment_id, version)
  VALUES (p_trip_id, p_member_id, 'coming', v_ack, 1)
  ON CONFLICT (trip_id, member_id) DO UPDATE SET
    response = 'coming',
    rule_acknowledgment_id = COALESCE(v_ack, trip_rsvps.rule_acknowledgment_id),
    version = trip_rsvps.version + 1,
    updated_at = now();

  -- Mark waitlist entry promoted
  UPDATE public.trip_waitlist_entries
  SET status = 'promoted', resolved_at = now(), promoted_by = p_actor_id
  WHERE id = v_entry_id;

  RETURN jsonb_build_object('promoted', true, 'memberId', p_member_id, 'position', v_position);
END;
$$;

REVOKE ALL ON FUNCTION public.trip_api_promote_from_waitlist(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trip_api_promote_from_waitlist(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.trip_api_promote_from_waitlist(uuid, uuid, uuid) IS
  'Promotes a waitlisted member to an active coming RSVP, checking capacity and updating waitlist status.';
