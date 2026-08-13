-- =============================================================================
-- Additive: 실회원 업적 영구 저장 (기존 migration_user_data_system 업적 구간만)
-- - 새 병렬 스키마 없음
-- - DB reset / bulk update / 기존 회원 데이터 삭제 없음
-- - CREATE IF NOT EXISTS / CREATE OR REPLACE 만 사용
-- =============================================================================

-- =============================================================================
-- 1. public.user_achievements
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_achievements (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  achievement_key text NOT NULL,
  acquired_at timestamptz NOT NULL,
  acquisition_sequence bigint NOT NULL,
  season_key text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_achievements_key_len
    CHECK (char_length(achievement_key) > 0 AND char_length(achievement_key) <= 80)
);

COMMENT ON TABLE public.user_achievements
  IS '사용자 업적. acquiredAt·acquisitionSequence 보존 필수. 서버 전용 부여.';

CREATE UNIQUE INDEX IF NOT EXISTS user_achievements_no_season_uniq
  ON public.user_achievements (user_id, achievement_key)
  WHERE season_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_achievements_season_uniq
  ON public.user_achievements (user_id, achievement_key, season_key)
  WHERE season_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_achievements_user_id_idx
  ON public.user_achievements (user_id, acquired_at DESC);

-- =============================================================================
-- 2. public.user_featured_achievements
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_featured_achievements (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  slot integer NOT NULL,
  achievement_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_featured_achievements_slot_range
    CHECK (slot BETWEEN 1 AND 3),

  CONSTRAINT user_featured_achievements_unique
    UNIQUE (user_id, slot)
);

COMMENT ON TABLE public.user_featured_achievements
  IS '대표 업적 슬롯 1~3. 반드시 user_achievements에 보유한 업적만 설정 가능.';

-- =============================================================================
-- 3. RLS
-- =============================================================================
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_achievements_select_own" ON public.user_achievements;
CREATE POLICY "user_achievements_select_own"
  ON public.user_achievements FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_achievements_select_public" ON public.user_achievements;
CREATE POLICY "user_achievements_select_public"
  ON public.user_achievements FOR SELECT TO anon
  USING (true);

ALTER TABLE public.user_featured_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_featured_achievements_select_all" ON public.user_featured_achievements;
CREATE POLICY "user_featured_achievements_select_all"
  ON public.user_featured_achievements FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "user_featured_achievements_manage_own" ON public.user_featured_achievements;
CREATE POLICY "user_featured_achievements_manage_own"
  ON public.user_featured_achievements FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =============================================================================
-- 4. RPC: grant_user_achievement (service_role only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.grant_user_achievement(
  p_user_id             uuid,
  p_achievement_key     text,
  p_acquired_at         timestamptz,
  p_acquisition_sequence bigint,
  p_season_key          text DEFAULT NULL,
  p_metadata            jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF p_season_key IS NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.user_achievements
       WHERE user_id = p_user_id
         AND achievement_key = p_achievement_key
         AND season_key IS NULL
    ) INTO v_exists;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.user_achievements
       WHERE user_id = p_user_id
         AND achievement_key = p_achievement_key
         AND season_key = p_season_key
    ) INTO v_exists;
  END IF;

  IF v_exists THEN
    RETURN jsonb_build_object('status', 'ALREADY_GRANTED');
  END IF;

  INSERT INTO public.user_achievements
    (user_id, achievement_key, acquired_at, acquisition_sequence, season_key, metadata)
  VALUES
    (p_user_id, p_achievement_key, p_acquired_at, p_acquisition_sequence, p_season_key, p_metadata);

  RETURN jsonb_build_object('status', 'GRANTED');
END;
$$;

COMMENT ON FUNCTION public.grant_user_achievement
  IS '업적 부여. 중복 부여 방지(idempotent). service-role 전용.';

-- =============================================================================
-- 5. RPC: set_featured_achievements (authenticated JWT)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_featured_achievements(
  p_slot1_key    text DEFAULT NULL,
  p_slot2_key    text DEFAULT NULL,
  p_slot3_key    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_key text;
  v_owned boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'USER_DATA_AUTH_REQUIRED');
  END IF;

  FOREACH v_key IN ARRAY ARRAY[p_slot1_key, p_slot2_key, p_slot3_key] LOOP
    IF v_key IS NOT NULL THEN
      SELECT EXISTS(
        SELECT 1 FROM public.user_achievements
         WHERE user_id = v_user_id AND achievement_key = v_key
      ) INTO v_owned;
      IF NOT v_owned THEN
        RETURN jsonb_build_object('status', 'ERROR', 'code', 'ACHIEVEMENT_NOT_OWNED', 'key', v_key);
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.user_featured_achievements WHERE user_id = v_user_id;

  IF p_slot1_key IS NOT NULL THEN
    INSERT INTO public.user_featured_achievements (user_id, slot, achievement_key)
    VALUES (v_user_id, 1, p_slot1_key)
    ON CONFLICT (user_id, slot) DO UPDATE
      SET achievement_key = EXCLUDED.achievement_key, updated_at = now();
  END IF;
  IF p_slot2_key IS NOT NULL THEN
    INSERT INTO public.user_featured_achievements (user_id, slot, achievement_key)
    VALUES (v_user_id, 2, p_slot2_key)
    ON CONFLICT (user_id, slot) DO UPDATE
      SET achievement_key = EXCLUDED.achievement_key, updated_at = now();
  END IF;
  IF p_slot3_key IS NOT NULL THEN
    INSERT INTO public.user_featured_achievements (user_id, slot, achievement_key)
    VALUES (v_user_id, 3, p_slot3_key)
    ON CONFLICT (user_id, slot) DO UPDATE
      SET achievement_key = EXCLUDED.achievement_key, updated_at = now();
  END IF;

  RETURN jsonb_build_object('status', 'SET');
END;
$$;

COMMENT ON FUNCTION public.set_featured_achievements(text, text, text)
  IS '대표 업적 슬롯 설정. user_id = auth.uid(). authenticated JWT 전용.';

-- =============================================================================
-- 6. EXECUTE grants
-- =============================================================================
REVOKE ALL ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.set_featured_achievements(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_featured_achievements(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_featured_achievements(text, text, text) TO authenticated, service_role;
