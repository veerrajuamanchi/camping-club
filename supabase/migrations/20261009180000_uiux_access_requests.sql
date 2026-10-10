-- Access requests live in the private schema (no direct Data API exposure)
CREATE TABLE private.access_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hmac       text        NOT NULL,
  hmac_key_version text        NOT NULL,
  display_name     text        NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','approved','rejected')),
  admin_note       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      uuid        REFERENCES public.member_profiles(member_id) ON DELETE SET NULL
);

CREATE INDEX ON private.access_requests (email_hmac);
CREATE INDEX ON private.access_requests (status) WHERE status = 'pending';
CREATE INDEX ON private.access_requests (resolved_by);

-- Prevent duplicate pending requests for the same email (not for approved/rejected)
CREATE UNIQUE INDEX access_requests_email_pending_uidx
  ON private.access_requests (email_hmac)
  WHERE status = 'pending';

-- Helper: create a new access request, reject duplicates with a clear error
CREATE OR REPLACE FUNCTION private.create_access_request(
  p_email_hmac       text,
  p_hmac_key_version text,
  p_display_name     text
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

  INSERT INTO private.access_requests (email_hmac, hmac_key_version, display_name)
  VALUES (p_email_hmac, p_hmac_key_version, p_display_name)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_access_request' USING ERRCODE = 'P0001';
END;
$$;

-- Helper: resolve an access request (admin only — caller must verify role)
CREATE OR REPLACE FUNCTION private.resolve_access_request(
  p_request_id uuid,
  p_actor_id   uuid,
  p_status     text,
  p_admin_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_current_status text;
BEGIN
  -- Validate resolution status
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_resolution_status' USING ERRCODE = '22023';
  END IF;

  -- Verify actor is an active admin
  IF NOT EXISTS (
    SELECT 1 FROM public.member_profiles
    WHERE member_id = p_actor_id
      AND member_role = 'admin'
      AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'administrator_required' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_current_status
  FROM private.access_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'request_already_resolved' USING ERRCODE = 'P0001';
  END IF;

  UPDATE private.access_requests
  SET
    status      = p_status,
    admin_note  = p_admin_note,
    resolved_at = now(),
    resolved_by = p_actor_id
  WHERE id = p_request_id;
END;
$$;

-- View: pending access requests (internal)
CREATE OR REPLACE VIEW private.pending_access_requests_v AS
SELECT id, display_name, created_at
FROM private.access_requests
WHERE status = 'pending';

-- View: admin access request count (internal / service_role)
CREATE OR REPLACE VIEW private.admin_access_request_count_v AS
SELECT count(*)::int AS pending_count
FROM private.access_requests
WHERE status = 'pending';

-- Admin-callable function to retrieve pending access request count
CREATE OR REPLACE FUNCTION public.get_admin_access_request_count()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.member_profiles
    WHERE auth_user_id = auth.uid()
      AND member_role = 'admin'
      AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'administrator_required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::int INTO v_count
  FROM private.access_requests
  WHERE status = 'pending';

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_access_request_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_access_request_count() TO authenticated;
