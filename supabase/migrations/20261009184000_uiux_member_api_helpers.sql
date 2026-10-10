-- List pending access requests for admin
CREATE OR REPLACE FUNCTION public.member_api_list_pending_requests()
RETURNS TABLE (id uuid, display_name text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT r.id, r.display_name, r.created_at
  FROM private.access_requests r
  WHERE r.status = 'pending'
  ORDER BY r.created_at ASC;
$$;
REVOKE ALL ON FUNCTION public.member_api_list_pending_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_api_list_pending_requests() TO service_role;

-- Resolve access request (delegates to private helper)
CREATE OR REPLACE FUNCTION public.member_api_resolve_access_request(
  p_request_id uuid,
  p_actor_id   uuid,
  p_status     text,
  p_admin_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
BEGIN
  PERFORM private.resolve_access_request(p_request_id, p_actor_id, p_status, p_admin_note);
END;
$$;
REVOKE ALL ON FUNCTION public.member_api_resolve_access_request(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_api_resolve_access_request(uuid,uuid,text,text) TO service_role;
