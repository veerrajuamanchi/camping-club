-- supabase/migrations/20261009185000_uiux_submit_rsvp_waitlist.sql

CREATE OR REPLACE FUNCTION public.trip_api_join_waitlist(
  p_trip_id    uuid,
  p_member_id  uuid,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_position int;
  v_new_position      int;
  v_entry_id          uuid;
BEGIN
  -- Check if member already on waitlist
  SELECT position INTO v_existing_position
  FROM public.trip_waitlist_entries
  WHERE trip_id = p_trip_id AND member_id = p_member_id AND status = 'waiting';

  IF FOUND THEN
    RETURN jsonb_build_object('waitlisted', true, 'position', v_existing_position);
  END IF;

  -- Get next position
  v_new_position := public.trip_waitlist_next_position(p_trip_id);

  INSERT INTO public.trip_waitlist_entries (trip_id, member_id, position)
  VALUES (p_trip_id, p_member_id, v_new_position)
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object('waitlisted', true, 'position', v_new_position, 'entryId', v_entry_id);
END;
$$;

REVOKE ALL ON FUNCTION public.trip_api_join_waitlist(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trip_api_join_waitlist(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.trip_api_join_waitlist(uuid, uuid, uuid) IS
  'Adds a member to the trip waitlist at next FIFO position, or returns current position if already waiting.';
