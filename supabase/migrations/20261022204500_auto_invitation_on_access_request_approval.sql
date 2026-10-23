-- Migration: auto_invitation_on_access_request_approval
-- Ensures approved access requests automatically generate invitation events and permit profile completion seamlessly

-- 1. Update private.resolve_access_request to automatically seed an invitation event when an access request is approved
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
  v_email_hmac     text;
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

  SELECT status, email_hmac INTO v_current_status, v_email_hmac
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

  -- If approved, automatically create a pending invitation record so profile onboarding completes smoothly
  IF p_status = 'approved' AND v_email_hmac IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM private.admin_invitation_events
      WHERE email_hmac = v_email_hmac::bytea AND status = 'pending'
    ) THEN
      INSERT INTO private.admin_invitation_events (
        email_hmac,
        invited_by,
        requested_role,
        is_bootstrap,
        status,
        expires_at
      )
      VALUES (
        v_email_hmac::bytea,
        p_actor_id,
        'member',
        false,
        'pending',
        now() + interval '30 days'
      );
    END IF;
  END IF;
END;
$$;

-- 2. Update public.phase1_complete_invited_profile to accept either a pending invitation event OR an approved access request
CREATE OR REPLACE FUNCTION public.phase1_complete_invited_profile(
  p_auth_user_id uuid, p_email_hmac bytea, p_display_name text, p_phone_e164 text,
  p_method text, p_ciphertext bytea, p_nonce bytea, p_key_version text, p_fingerprint bytea, p_request_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_inv private.admin_invitation_events%rowtype;
  v_member uuid;
  v_role text;
BEGIN
  IF p_auth_user_id IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid profile';
  END IF;
  IF p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'invalid phone';
  END IF;
  IF p_method NOT IN ('zelle','venmo','paypal','apple_cash') OR octet_length(p_nonce) <> 12 OR octet_length(p_ciphertext) < 17 THEN
    RAISE EXCEPTION 'invalid payment preference';
  END IF;

  -- Look for a pending invitation in admin_invitation_events
  SELECT * INTO v_inv
  FROM private.admin_invitation_events
  WHERE email_hmac = p_email_hmac AND status = 'pending' AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Fallback: check if an approved access request exists for this email HMAC
    IF EXISTS (
      SELECT 1 FROM private.access_requests
      WHERE (email_hmac = encode(p_email_hmac, 'hex')
             OR email_hmac = '\x' || encode(p_email_hmac, 'hex')
             OR email_hmac::bytea = p_email_hmac)
        AND status = 'approved'
    ) THEN
      v_role := 'member';
    ELSE
      RAISE EXCEPTION 'valid invitation required' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_role := v_inv.requested_role;
    IF v_inv.is_bootstrap THEN
      PERFORM 1 FROM private.bootstrap_control
      WHERE singleton AND reserved_invitation_id = v_inv.id AND consumed_at IS NULL
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'bootstrap reservation is invalid';
      END IF;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.member_profiles WHERE auth_user_id = p_auth_user_id) THEN
    RAISE EXCEPTION 'profile already exists';
  END IF;

  INSERT INTO public.member_profiles(auth_user_id, display_name, member_role, account_status)
  VALUES (p_auth_user_id, btrim(p_display_name), v_role, 'active')
  RETURNING member_id INTO v_member;

  INSERT INTO public.member_private_contacts(member_id, phone_e164)
  VALUES (v_member, p_phone_e164);

  INSERT INTO public.member_payment_methods(member_id, method, preferred, accepted_for_receiving, active)
  VALUES (v_member, p_method, true, true, true)
  RETURNING id INTO v_inv.auth_invite_id;

  INSERT INTO private.member_payment_identifiers(payment_method_id, identifier_ciphertext, nonce, encryption_key_version, fingerprint_hmac)
  VALUES (v_inv.auth_invite_id, p_ciphertext, p_nonce, p_key_version, p_fingerprint);

  IF v_inv.id IS NOT NULL THEN
    UPDATE private.admin_invitation_events
    SET status = 'accepted', accepted_at = now()
    WHERE id = v_inv.id;

    IF v_inv.is_bootstrap THEN
      UPDATE private.bootstrap_control
      SET consumed_at = now(), reserved_invitation_id = null, reserved_at = null
      WHERE singleton;
    END IF;
  END IF;

  INSERT INTO public.audit_events(actor_id, actor_kind, entity_type, entity_id, action, request_id)
  VALUES (
    v_member,
    CASE WHEN v_role = 'admin' THEN 'admin' else 'member' END,
    'member',
    v_member,
    CASE WHEN v_role = 'admin' THEN 'bootstrap_admin_activated' else 'member_activated' END,
    p_request_id
  )
  ON CONFLICT (actor_id, request_id) DO NOTHING;

  RETURN v_member;
END;
$$;
