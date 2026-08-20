-- SentenceArena user sanctions v1 (additive).
-- Production apply is not executed by this change set.
-- Does not store political alignment. Does not enable ALIEN_MODERATION_V1.

ALTER TABLE public.user_moderation_state
  ADD COLUMN IF NOT EXISTS current_sanction_type text NOT NULL DEFAULT 'NONE';
ALTER TABLE public.user_moderation_state
  ADD COLUMN IF NOT EXISTS current_sanction_starts_at timestamptz NULL;
ALTER TABLE public.user_moderation_state
  ADD COLUMN IF NOT EXISTS current_sanction_ends_at timestamptz NULL;
ALTER TABLE public.user_moderation_state
  ADD COLUMN IF NOT EXISTS current_sanction_permanent boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_moderation_state
  ADD COLUMN IF NOT EXISTS current_sanction_status text NULL;
ALTER TABLE public.user_moderation_state
  ADD COLUMN IF NOT EXISTS current_sanction_reason_code text NULL;
ALTER TABLE public.user_moderation_state
  ADD COLUMN IF NOT EXISTS current_sanction_behavior_key text NULL;
ALTER TABLE public.user_moderation_state
  ADD COLUMN IF NOT EXISTS current_sanction_ladder text NULL;
ALTER TABLE public.user_moderation_state
  ADD COLUMN IF NOT EXISTS pending_permanent_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_moderation_state
  ADD COLUMN IF NOT EXISTS last_sanctioned_behavior_key text NULL;

ALTER TABLE public.user_moderation_state DROP CONSTRAINT IF EXISTS user_moderation_state_sanction_type_chk;
ALTER TABLE public.user_moderation_state
  ADD CONSTRAINT user_moderation_state_sanction_type_chk CHECK (
    current_sanction_type IN (
      'NONE',
      'WARNING',
      'FINAL_WARNING',
      'ALIEN_TRANSFER',
      'WRITE_RESTRICT_24H',
      'ACCOUNT_RESTRICT_7D',
      'ACCOUNT_RESTRICT_30D',
      'TEMP_SUSPEND',
      'PERMANENT_BAN',
      'PERMANENT_REVIEW'
    )
  );

CREATE TABLE IF NOT EXISTS public.user_sanction_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sanction_type text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'SUBMITTED',
  operator_reply text NULL,
  decided_by uuid NULL REFERENCES auth.users(id),
  decided_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_sanction_appeals_status_chk CHECK (
    status IN ('SUBMITTED', 'UPHELD', 'SHORTENED', 'RELEASED')
  )
);

CREATE INDEX IF NOT EXISTS idx_user_sanction_appeals_user_created
  ON public.user_sanction_appeals (user_id, created_at DESC);

ALTER TABLE public.user_sanction_appeals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_sanction_appeals'
      AND policyname = 'user_sanction_appeals_select_self'
  ) THEN
    CREATE POLICY user_sanction_appeals_select_self
      ON public.user_sanction_appeals FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_sanction_appeals'
      AND policyname = 'user_sanction_appeals_insert_self'
  ) THEN
    CREATE POLICY user_sanction_appeals_insert_self
      ON public.user_sanction_appeals FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT ON public.user_sanction_appeals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_sanction_appeals TO service_role;

COMMENT ON TABLE public.user_sanction_appeals IS
  '제재 이의신청. 정치성향 미저장. 운영자 내부 메모와 분리된 사용자 설명/답변만 보관.';
