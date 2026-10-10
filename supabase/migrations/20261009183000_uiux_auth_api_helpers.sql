-- supabase/migrations/20261009183000_uiux_auth_api_helpers.sql

-- Rate limit: how many access_request rows exist for this email_hmac in last 24h
CREATE OR REPLACE FUNCTION public.auth_api_check_rate_limit(p_email_hmac text)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT count(*)::int
  FROM private.access_requests
  WHERE email_hmac = p_email_hmac
    AND created_at > now() - interval '24 hours';
$$;
REVOKE ALL ON FUNCTION public.auth_api_check_rate_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_check_rate_limit(text) TO service_role;

-- Check if email is an approved member (invitation event, approved access request, or existing active account)
CREATE OR REPLACE FUNCTION public.auth_api_is_approved_member(p_email_hmac text, p_email text DEFAULT NULL)
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

-- Check if a pending access request exists for this email
CREATE OR REPLACE FUNCTION public.auth_api_has_pending_request(p_email_hmac text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.access_requests
    WHERE email_hmac = p_email_hmac AND status = 'pending'
  );
$$;
REVOKE ALL ON FUNCTION public.auth_api_has_pending_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_has_pending_request(text) TO service_role;

-- Create an access request (delegates to private helper)
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
  RETURN private.create_access_request(p_email_hmac, p_hmac_key_version, p_display_name);
END;
$$;
REVOKE ALL ON FUNCTION public.auth_api_create_access_request(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_api_create_access_request(text,text,text) TO service_role;
