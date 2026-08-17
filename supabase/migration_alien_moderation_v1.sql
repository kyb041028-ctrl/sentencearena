-- =============================================================================
-- 센텐스아레나 — ALIEN MODERATION V1 additive persistence (development)
-- 파일: supabase/migration_alien_moderation_v1.sql
--
-- 적용: tools/apply-alien-moderation-v1-migration.js --confirm-dev-db
-- production 적용 금지. DROP/TRUNCATE/기존 row DELETE 없음.
-- profiles.territory CHECK 미변경. 정치성향 테이블 미변경.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_moderation_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'EARTH',
  alien_strike_count integer NOT NULL DEFAULT 0,
  alien_origin_territory text NULL,
  origin_captured_at timestamptz NULL,
  origin_source text NULL,
  entered_at timestamptz NULL,
  release_eligible_at timestamptz NULL,
  season_release_key text NULL,
  operator_hold boolean NOT NULL DEFAULT false,
  return_policy text NOT NULL DEFAULT 'NONE',
  last_returned_at timestamptz NULL,
  cycle_start_at timestamptz NULL,
  citizenship_status text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_moderation_state_status_chk CHECK (
    status IN ('EARTH', 'ALIEN_ACTIVE', 'RETURN_ELIGIBLE', 'RETURNED', 'SUSPENDED', 'UNAVAILABLE')
  ),
  CONSTRAINT user_moderation_state_strike_nonneg CHECK (alien_strike_count >= 0),
  CONSTRAINT user_moderation_state_origin_chk CHECK (
    alien_origin_territory IS NULL OR alien_origin_territory IN ('PIONEER', 'GUARDIAN', 'CENTRAL', 'UNKNOWN')
  ),
  CONSTRAINT user_moderation_state_origin_source_chk CHECK (
    origin_source IS NULL OR origin_source IN ('MODERATION_TRANSFER_SNAPSHOT', 'EXISTING_HISTORY', 'LEGACY_MOCK', 'UNAVAILABLE')
  ),
  CONSTRAINT user_moderation_state_return_policy_chk CHECK (
    return_policy IN ('NONE', 'DAYS', 'SEASON_END')
  ),
  CONSTRAINT user_moderation_state_alien_requires_entered CHECK (
    status NOT IN ('ALIEN_ACTIVE', 'RETURN_ELIGIBLE') OR entered_at IS NOT NULL
  )
);

COMMENT ON TABLE public.user_moderation_state IS
  '행동 moderation 상태. 정치성향 score와 분리. trip count = alien_strike_count.';

ALTER TABLE public.user_moderation_state ADD COLUMN IF NOT EXISTS return_policy text NOT NULL DEFAULT 'NONE';
ALTER TABLE public.user_moderation_state ADD COLUMN IF NOT EXISTS last_returned_at timestamptz NULL;
ALTER TABLE public.user_moderation_state ADD COLUMN IF NOT EXISTS cycle_start_at timestamptz NULL;
ALTER TABLE public.user_moderation_state ADD COLUMN IF NOT EXISTS citizenship_status text NULL;

ALTER TABLE public.user_moderation_state ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.user_moderation_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_moderation_state TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_moderation_state'
      AND policyname = 'user_moderation_state_select_self'
  ) THEN
    CREATE POLICY user_moderation_state_select_self
      ON public.user_moderation_state FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}',
  source_type text NOT NULL,
  source_id text NULL,
  strike_before integer NOT NULL DEFAULT 0,
  strike_after integer NOT NULL DEFAULT 0,
  previous_status text NOT NULL DEFAULT 'EARTH',
  next_status text NOT NULL DEFAULT 'EARTH',
  entered_at timestamptz NULL,
  release_eligible_at timestamptz NULL,
  season_release_key text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_moderation_events_type_chk CHECK (
    event_type IN (
      'WARNING_ISSUED',
      'ALIEN_TRANSFERRED',
      'RETURN_ELIGIBLE',
      'RETURNED',
      'PENALTY_EXTENDED',
      'OPERATOR_ASSIGNED',
      'OPERATOR_RELEASED'
    )
  ),
  CONSTRAINT user_moderation_events_source_chk CHECK (
    source_type IN ('REPORT_REVIEW', 'BEHAVIOR_SIGNAL', 'OPERATOR', 'SYSTEM', 'SEASON_END')
  ),
  CONSTRAINT user_moderation_events_strike_nonneg CHECK (
    strike_before >= 0 AND strike_after >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_user_moderation_events_user_created
  ON public.user_moderation_events (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_moderation_events_type_source
  ON public.user_moderation_events (event_type, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE public.user_moderation_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_moderation_events TO service_role;

CREATE TABLE IF NOT EXISTS public.user_moderation_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  dedupe_key text NULL,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_moderation_notifications_dedupe
  ON public.user_moderation_notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_moderation_notifications_user_created
  ON public.user_moderation_notifications (user_id, created_at DESC);

ALTER TABLE public.user_moderation_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_moderation_notifications'
      AND policyname = 'user_moderation_notifications_select_self'
  ) THEN
    CREATE POLICY user_moderation_notifications_select_self
      ON public.user_moderation_notifications FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT ON public.user_moderation_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_moderation_notifications TO service_role;
