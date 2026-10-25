-- Migration: Add RPC for member-api to securely load a member's own encrypted payment identifier

CREATE OR REPLACE FUNCTION public.member_api_get_own_payment_identifier(
  p_auth_user_id uuid
)
RETURNS TABLE (
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
  v_payment_method_id uuid;
BEGIN
  SELECT member_id INTO v_member_id
  FROM public.member_profiles
  WHERE auth_user_id = p_auth_user_id AND account_status = 'active';

  IF v_member_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_payment_method_id
  FROM public.member_payment_methods
  WHERE member_id = v_member_id AND preferred AND active
  LIMIT 1;

  IF v_payment_method_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    encode(p.identifier_ciphertext, 'hex') AS identifier_ciphertext_hex,
    encode(p.nonce, 'hex') AS nonce_hex,
    p.encryption_key_version AS key_version
  FROM private.member_payment_identifiers p
  WHERE p.payment_method_id = v_payment_method_id
    AND p.deleted_at IS NULL
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.member_api_get_own_payment_identifier(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_api_get_own_payment_identifier(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.member_api_get_own_payment_identifier(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.member_api_get_own_payment_identifier(uuid) TO service_role;
