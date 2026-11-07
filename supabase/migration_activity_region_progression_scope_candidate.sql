-- =============================================================================
-- CANDIDATE ONLY — staging additive. Not production-public REQUIRED.
-- Per-activity-region progression/achievement storage. Does NOT alter
-- user_progression or user_alignment_state (Korea SSOT rows stay as-is).
-- US political alignment batch engine is not implemented — tendency jsonb
-- storage only; no claim of US alignment computation in app.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_activity_region_profile (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 10),
  xp bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
  reputation_score bigint NOT NULL DEFAULT 0 CHECK (reputation_score >= 0),
  aura bigint NOT NULL DEFAULT 0 CHECK (aura >= 0),
  tendency jsonb NULL,
  streak_30 integer NOT NULL DEFAULT 0 CHECK (streak_30 >= 0),
  streak_99 integer NOT NULL DEFAULT 0 CHECK (streak_99 >= 0),
  territory text NULL,
  evolution_contribution bigint NOT NULL DEFAULT 0 CHECK (evolution_contribution >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity_region)
);

COMMENT ON TABLE public.user_activity_region_profile IS
  'Optional per-region stats. Does not copy or replace user_progression.';

CREATE TABLE IF NOT EXISTS public.user_activity_region_achievement (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  achievement_key text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity_region, achievement_key)
);

COMMENT ON TABLE public.user_activity_region_achievement IS
  'Per-region achievement keys. Does not replace user_achievements.';

ALTER TABLE public.user_activity_region_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_region_achievement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_activity_region_profile_select_own
  ON public.user_activity_region_profile;
CREATE POLICY user_activity_region_profile_select_own
  ON public.user_activity_region_profile
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_activity_region_achievement_select_own
  ON public.user_activity_region_achievement;
CREATE POLICY user_activity_region_achievement_select_own
  ON public.user_activity_region_achievement
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.user_activity_region_profile TO authenticated;
GRANT SELECT ON public.user_activity_region_achievement TO authenticated;
