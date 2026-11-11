-- SentenceArena: sensitive-consent withdrawal as one database transaction.
-- NOT APPLIED. NOT production-verified. Not in the production REQUIRED catalog.
-- DEC-006 only: delete alignment state and history, then clear that consent.
-- Does not change profiles.territory, alien membership, reaction copies, or backups.
-- Does not add permanent-ban rejoin blocking.
-- A later score batch can insert new alignment rows after this function commits.
-- That calculator does not re-check consent. This file does not change it.

CREATE OR REPLACE FUNCTION public.withdraw_sensitive_political_consent(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  PERFORM 1
  FROM public.user_legal_consents
  WHERE user_id = p_user_id
  FOR UPDATE;

  DELETE FROM public.user_alignment_state WHERE user_id = p_user_id;
  DELETE FROM public.alignment_history WHERE user_id = p_user_id;
  DELETE FROM public.alignment_territory_history WHERE user_id = p_user_id;

  UPDATE public.user_legal_consents
  SET
    sensitive_political_consented_at = NULL,
    sensitive_political_policy_version = NULL,
    territory_disclosure_consented_at = NULL,
    territory_disclosure_policy_version = NULL,
    political_profile_visibility = 'private',
    updated_at = now()
  WHERE user_id = p_user_id;
END;
$fn$;

COMMENT ON FUNCTION public.withdraw_sensitive_political_consent(uuid) IS
  'DEC-006. One transaction. Alignment state and history only. Not territory, alien, reactions, or backups.';

REVOKE ALL ON FUNCTION public.withdraw_sensitive_political_consent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_sensitive_political_consent(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.withdraw_sensitive_political_consent(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_sensitive_political_consent(uuid) TO service_role;
