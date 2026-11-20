-- Migration: Add RPC for trip-api to load encrypted payment identifiers and contact details for settlement transfer recipients

CREATE OR REPLACE FUNCTION public.trip_api_get_settlement_recipient_payment_details(
  p_trip_id uuid,
  p_actor_id uuid
)
RETURNS TABLE (
  member_id uuid,
  display_name text,
  phone_e164 text,
  method text,
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
  -- 1. Check if actor is active member and either an admin or coming attendee for this trip
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

  -- 2. Return recipient payment details for this trip
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
    encode(ident.identifier_ciphertext, 'hex') AS identifier_ciphertext_hex,
    encode(ident.nonce, 'hex') AS nonce_hex,
    ident.encryption_key_version AS key_version
  FROM recipient_ids rec
  JOIN public.member_profiles p ON p.member_id = rec.m_id
  LEFT JOIN public.member_private_contacts c ON c.member_id = rec.m_id
  LEFT JOIN public.member_payment_methods m ON m.member_id = rec.m_id AND m.preferred AND m.active
  LEFT JOIN private.member_payment_identifiers ident ON ident.payment_method_id = m.id AND ident.deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trip_api_get_settlement_recipient_payment_details(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trip_api_get_settlement_recipient_payment_details(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.trip_api_get_settlement_recipient_payment_details(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trip_api_get_settlement_recipient_payment_details(uuid, uuid) TO service_role;
