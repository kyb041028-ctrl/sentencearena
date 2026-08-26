-- Additive: allow OPERATOR_REVIEW return_policy (4th+ alien stay, temporary until season system).
-- Does not drop SEASON_END (legacy rows may still use it).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_moderation_state_return_policy_chk'
  ) THEN
    ALTER TABLE public.user_moderation_state
      DROP CONSTRAINT user_moderation_state_return_policy_chk;
  END IF;
END $$;

ALTER TABLE public.user_moderation_state
  ADD CONSTRAINT user_moderation_state_return_policy_chk CHECK (
    return_policy IN ('NONE', 'DAYS', 'SEASON_END', 'OPERATOR_REVIEW')
  );

COMMENT ON CONSTRAINT user_moderation_state_return_policy_chk ON public.user_moderation_state IS
  'NONE/DAYS auto-eligible; OPERATOR_REVIEW = 30d then admin return only; SEASON_END legacy only';
