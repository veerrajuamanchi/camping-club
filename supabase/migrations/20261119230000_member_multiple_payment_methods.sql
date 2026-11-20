-- Migration: Support multiple payment options (primary preferred + fallbacks)
-- File: 20261119230000_member_multiple_payment_methods.sql

-- 1. Secure RPC to fetch all active payment methods and encrypted identifiers for own profile
CREATE OR REPLACE FUNCTION public.member_api_get_own_payment_methods(
  p_auth_user_id uuid
)
RETURNS TABLE (
  payment_method_id uuid,
  method text,
  preferred boolean,
  identifier_ciphertext_hex text,
  nonce_hex text,
  key_version text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  SELECT member_id INTO v_member_id
  FROM public.member_profiles
  WHERE auth_user_id = p_auth_user_id AND account_status = 'active';

  IF v_member_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id AS payment_method_id,
    m.method,
    m.preferred,
    encode(p.identifier_ciphertext, 'hex') AS identifier_ciphertext_hex,
    encode(p.nonce, 'hex') AS nonce_hex,
    p.encryption_key_version AS key_version
  FROM public.member_payment_methods m
  LEFT JOIN private.member_payment_identifiers p ON p.payment_method_id = m.id AND p.deleted_at IS NULL
  WHERE m.member_id = v_member_id AND m.active
  ORDER BY m.preferred DESC, m.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.member_api_get_own_payment_methods(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_api_get_own_payment_methods(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.member_api_get_own_payment_methods(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.member_api_get_own_payment_methods(uuid) TO service_role;

-- 2. Secure RPC to save member profile with multiple payment methods (atomic transaction)
CREATE OR REPLACE FUNCTION public.member_api_save_own_payment_methods(
  p_auth_user_id uuid,
  p_display_name text,
  p_phone_e164 text,
  p_methods jsonb,
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_member_id uuid;
  v_item jsonb;
  v_method text;
  v_preferred boolean;
  v_ciphertext bytea;
  v_nonce bytea;
  v_key_version text;
  v_fingerprint bytea;
  v_method_id uuid;
  v_has_preferred boolean := false;
BEGIN
  IF length(btrim(p_display_name)) NOT BETWEEN 1 AND 80 OR p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'invalid profile';
  END IF;

  SELECT member_id INTO v_member_id
  FROM public.member_profiles
  WHERE auth_user_id = p_auth_user_id AND account_status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active member required' USING errcode = '42501';
  END IF;

  UPDATE public.member_profiles
  SET display_name = btrim(p_display_name)
  WHERE member_id = v_member_id;

  INSERT INTO public.member_private_contacts(member_id, phone_e164)
  VALUES (v_member_id, p_phone_e164)
  ON CONFLICT (member_id) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164;

  -- Deactivate existing payment methods before applying the new set
  UPDATE public.member_payment_methods
  SET active = false, updated_at = now()
  WHERE member_id = v_member_id AND active = true;

  -- Insert/activate each method from the payload
  IF p_methods IS NOT NULL AND jsonb_array_length(p_methods) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_methods)
    LOOP
      v_method := lower(btrim((v_item->>'method')::text));
      v_preferred := COALESCE((v_item->>'preferred')::boolean, false);
      v_ciphertext := decode(replace(v_item->>'ciphertext_hex', '\x', ''), 'hex');
      v_nonce := decode(replace(v_item->>'nonce_hex', '\x', ''), 'hex');
      v_key_version := COALESCE(v_item->>'key_version', 'local-test-v1');
      v_fingerprint := decode(replace(v_item->>'fingerprint_hex', '\x', ''), 'hex');

      IF v_method NOT IN ('zelle', 'venmo', 'paypal', 'apple_cash') THEN
        RAISE EXCEPTION 'invalid payment method: %', v_method;
      END IF;

      IF octet_length(v_nonce) <> 12 OR octet_length(v_ciphertext) < 17 THEN
        RAISE EXCEPTION 'invalid payment ciphertext or nonce for method: %', v_method;
      END IF;

      IF v_preferred THEN
        v_has_preferred := true;
      END IF;

      INSERT INTO public.member_payment_methods(
        member_id, method, preferred, accepted_for_receiving, active
      ) VALUES (
        v_member_id, v_method, v_preferred, true, true
      ) RETURNING id INTO v_method_id;

      INSERT INTO private.member_payment_identifiers(
        payment_method_id, identifier_ciphertext, nonce, encryption_key_version, fingerprint_hmac
      ) VALUES (
        v_method_id, v_ciphertext, v_nonce, v_key_version, v_fingerprint
      );
    END LOOP;

    -- Ensure at least one method is preferred if methods exist
    IF NOT v_has_preferred THEN
      UPDATE public.member_payment_methods
      SET preferred = true
      WHERE id = (
        SELECT id FROM public.member_payment_methods
        WHERE member_id = v_member_id AND active = true
        ORDER BY created_at ASC
        LIMIT 1
      );
    END IF;
  END IF;

  INSERT INTO public.audit_events(actor_id, actor_kind, entity_type, entity_id, action, request_id)
  VALUES (v_member_id, 'member', 'member', v_member_id, 'profile_updated', p_request_id)
  ON CONFLICT (actor_id, request_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.member_api_save_own_payment_methods(uuid, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_api_save_own_payment_methods(uuid, text, text, jsonb, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.member_api_save_own_payment_methods(uuid, text, text, jsonb, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.member_api_save_own_payment_methods(uuid, text, text, jsonb, uuid) TO service_role;

-- 3. Upgrade trip_api_get_settlement_recipient_payment_details to return all active payment options with preferred flag
DROP FUNCTION IF EXISTS public.trip_api_get_settlement_recipient_payment_details(uuid, uuid);

CREATE OR REPLACE FUNCTION public.trip_api_get_settlement_recipient_payment_details(
  p_trip_id uuid,
  p_actor_id uuid
)
RETURNS TABLE (
  member_id uuid,
  display_name text,
  phone_e164 text,
  method text,
  preferred boolean,
  identifier_ciphertext_hex text,
  nonce_hex text,
  key_version text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  v_is_authorized boolean;
BEGIN
  -- Check if actor is active member and either an admin or coming attendee for this trip
  SELECT EXISTS (
    SELECT 1 FROM public.member_profiles m
    WHERE m.member_id = p_actor_id
      AND m.account_status = 'active'
      AND (
        m.member_role = 'admin'
        OR EXISTS (
          SELECT 1 FROM public.trip_rsvps r
          WHERE r.trip_id = p_trip_id
            AND r.member_id = p_actor_id
            AND r.response = 'coming'
        )
      )
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RETURN;
  END IF;

  -- Return recipient payment details for this trip (all active methods, preferred first)
  RETURN QUERY
  WITH recipient_ids AS (
    SELECT DISTINCT t.recipient_member_id AS m_id
    FROM public.settlement_runs r
    JOIN public.settlement_transfers t ON t.settlement_run_id = r.id
    WHERE r.trip_id = p_trip_id
    UNION
    SELECT rsv.member_id AS m_id
    FROM public.trip_rsvps rsv
    WHERE rsv.trip_id = p_trip_id AND rsv.response = 'coming'
  )
  SELECT
    p.member_id,
    p.display_name,
    c.phone_e164,
    m.method,
    COALESCE(m.preferred, false) AS preferred,
    encode(ident.identifier_ciphertext, 'hex') AS identifier_ciphertext_hex,
    encode(ident.nonce, 'hex') AS nonce_hex,
    ident.encryption_key_version AS key_version
  FROM recipient_ids rec
  JOIN public.member_profiles p ON p.member_id = rec.m_id
  LEFT JOIN public.member_private_contacts c ON c.member_id = rec.m_id
  LEFT JOIN public.member_payment_methods m ON m.member_id = rec.m_id AND m.active
  LEFT JOIN private.member_payment_identifiers ident ON ident.payment_method_id = m.id AND ident.deleted_at IS NULL
  ORDER BY p.member_id, COALESCE(m.preferred, false) DESC, m.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.trip_api_get_settlement_recipient_payment_details(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trip_api_get_settlement_recipient_payment_details(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.trip_api_get_settlement_recipient_payment_details(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trip_api_get_settlement_recipient_payment_details(uuid, uuid) TO service_role;
