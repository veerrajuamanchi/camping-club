-- Store email in private.access_requests to automate invitations upon approval
ALTER TABLE private.access_requests ADD COLUMN IF NOT EXISTS email text;

-- Helper: create access request (4-arg primary)
CREATE OR REPLACE FUNCTION private.create_access_request(
  p_email_hmac       text,
  p_hmac_key_version text,
  p_display_name     text,
  p_email            text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM private.access_requests WHERE email_hmac = p_email_hmac AND status = 'approved') THEN
    RAISE EXCEPTION 'duplicate_access_request' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO private.access_requests (email_hmac, hmac_key_version, display_name, email)
  VALUES (p_email_hmac, p_hmac_key_version, p_display_name, p_email)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_access_request' USING ERRCODE = 'P0001';
END;
$$;

-- Helper: create access request (3-arg backwards compatibility overload)
CREATE OR REPLACE FUNCTION private.create_access_request(
  p_email_hmac       text,
  p_hmac_key_version text,
  p_display_name     text
) RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.create_access_request(p_email_hmac, p_hmac_key_version, p_display_name, NULL::text);
$$;

-- auth_api_create_access_request 4-arg
CREATE OR REPLACE FUNCTION public.auth_api_create_access_request(
  p_email_hmac       text,
  p_hmac_key_version text,
  p_display_name     text,
  p_email            text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
BEGIN
  RETURN private.create_access_request(p_email_hmac, p_hmac_key_version, p_display_name, p_email);
END;
$$;
REVOKE ALL ON FUNCTION public.auth_api_create_access_request(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_create_access_request(text,text,text,text) TO service_role;

-- auth_api_create_access_request 3-arg overload
CREATE OR REPLACE FUNCTION public.auth_api_create_access_request(
  p_email_hmac       text,
  p_hmac_key_version text,
  p_display_name     text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
BEGIN
  RETURN private.create_access_request(p_email_hmac, p_hmac_key_version, p_display_name, NULL::text);
END;
$$;
REVOKE ALL ON FUNCTION public.auth_api_create_access_request(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_create_access_request(text,text,text) TO service_role;

-- Drop old auth_api_is_approved_member(text, text) to remove default parameter collision
DROP FUNCTION IF EXISTS public.auth_api_is_approved_member(text, text);
DROP FUNCTION IF EXISTS public.auth_api_is_approved_member(text);

-- 2-arg implementation (without default parameter)
CREATE OR REPLACE FUNCTION public.auth_api_is_approved_member(p_email_hmac text, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.admin_invitation_events
    WHERE ('\x' || encode(email_hmac, 'hex')) = lower(p_email_hmac)
       OR encode(email_hmac, 'hex') = lower(p_email_hmac)
       OR encode(email_hmac, 'escape') = p_email_hmac
    UNION ALL
    SELECT 1 FROM private.access_requests
    WHERE email_hmac = p_email_hmac AND status = 'approved'
    UNION ALL
    SELECT 1 FROM auth.users u
    JOIN public.member_profiles mp ON mp.auth_user_id = u.id
    WHERE (p_email IS NOT NULL AND lower(u.email) = lower(p_email) AND mp.account_status = 'active')
  );
$$;
REVOKE ALL ON FUNCTION public.auth_api_is_approved_member(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_is_approved_member(text, text) TO service_role;

-- 1-arg implementation
CREATE OR REPLACE FUNCTION public.auth_api_is_approved_member(p_email_hmac text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, auth, pg_temp
AS $$
  SELECT public.auth_api_is_approved_member(p_email_hmac, NULL::text);
$$;
REVOKE ALL ON FUNCTION public.auth_api_is_approved_member(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_is_approved_member(text) TO service_role;

-- Drop old 3-column return type function to replace with 4-column return type
DROP FUNCTION IF EXISTS public.member_api_list_pending_requests();

-- List pending access requests including email
CREATE OR REPLACE FUNCTION public.member_api_list_pending_requests()
RETURNS TABLE (id uuid, display_name text, email text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT r.id, r.display_name, r.email, r.created_at
  FROM private.access_requests r
  WHERE r.status = 'pending'
  ORDER BY r.created_at ASC;
$$;
REVOKE ALL ON FUNCTION public.member_api_list_pending_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_api_list_pending_requests() TO service_role;

-- Resolve access request and return applicant email
DROP FUNCTION IF EXISTS public.member_api_resolve_access_request(uuid,uuid,text,text);

CREATE OR REPLACE FUNCTION public.member_api_resolve_access_request(
  p_request_id uuid,
  p_actor_id   uuid,
  p_status     text,
  p_admin_note text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email
  FROM private.access_requests
  WHERE id = p_request_id;

  PERFORM private.resolve_access_request(p_request_id, p_actor_id, p_status, p_admin_note);

  RETURN v_email;
END;
$$;
REVOKE ALL ON FUNCTION public.member_api_resolve_access_request(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_api_resolve_access_request(uuid,uuid,text,text) TO service_role;
