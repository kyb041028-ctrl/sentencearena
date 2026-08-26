-- =============================================================================
-- Additive: Production 업적 service_role 최소 권한 + mark_user_achievement_notified 복구
-- - DROP TABLE / TRUNCATE / DELETE FROM 없음
-- - progression / XP / fame 구조 변경 없음
-- - 기존 업적 row 삭제·초기화 없음
-- - 반복 적용 안전 (IF NOT EXISTS / CREATE OR REPLACE / GRANT)
-- =============================================================================

-- 1) acquisition_notified_at (없을 때만). 기존 row backfill은 최초 추가 시에만.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user_achievements'
       AND column_name = 'acquisition_notified_at'
  ) THEN
    ALTER TABLE public.user_achievements
      ADD COLUMN acquisition_notified_at timestamptz NULL;

    UPDATE public.user_achievements
       SET acquisition_notified_at = COALESCE(acquired_at, now())
     WHERE acquisition_notified_at IS NULL;

    COMMENT ON COLUMN public.user_achievements.acquisition_notified_at IS
      '중앙 업적 획득 알람을 사용자에게 표시한 시각. NULL=미표시.';
  END IF;
END $$;

-- 2) service_role 최소 SELECT (서버 list/hydrate/evaluator). anon/authenticated 운영 전체 조회 확대 없음.
GRANT SELECT ON TABLE public.user_achievements TO service_role;
GRANT SELECT ON TABLE public.user_featured_achievements TO service_role;

-- 3) grant_user_achievement: notified-aware canonical (service_role only)
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
  v_existing public.user_achievements%ROWTYPE;
  v_seq bigint;
  v_acquired timestamptz;
  v_meta jsonb;
BEGIN
  v_meta := COALESCE(p_metadata, '{}'::jsonb);

  PERFORM pg_advisory_xact_lock(92481733, hashtext(p_user_id::text));

  IF p_season_key IS NULL THEN
    SELECT * INTO v_existing
      FROM public.user_achievements
     WHERE user_id = p_user_id
       AND achievement_key = p_achievement_key
       AND season_key IS NULL;
  ELSE
    SELECT * INTO v_existing
      FROM public.user_achievements
     WHERE user_id = p_user_id
       AND achievement_key = p_achievement_key
       AND season_key = p_season_key;
  END IF;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_GRANTED',
      'achievement_key', v_existing.achievement_key,
      'acquired_at', v_existing.acquired_at,
      'acquisition_sequence', v_existing.acquisition_sequence,
      'season_key', v_existing.season_key,
      'acquisition_notified_at', v_existing.acquisition_notified_at
    );
  END IF;

  SELECT COALESCE(MAX(acquisition_sequence), 0) + 1
    INTO v_seq
    FROM public.user_achievements
   WHERE user_id = p_user_id;

  v_acquired := now();

  INSERT INTO public.user_achievements
    (user_id, achievement_key, acquired_at, acquisition_sequence, season_key, metadata)
  VALUES
    (p_user_id, p_achievement_key, v_acquired, v_seq, p_season_key, v_meta);

  RETURN jsonb_build_object(
    'status', 'GRANTED',
    'achievement_key', p_achievement_key,
    'acquired_at', v_acquired,
    'acquisition_sequence', v_seq,
    'season_key', p_season_key,
    'acquisition_notified_at', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) TO service_role;

-- 4) mark_user_achievement_notified(key, sequence) — 서버 코드와 동일 시그니처
CREATE OR REPLACE FUNCTION public.mark_user_achievement_notified(
  p_achievement_key text,
  p_acquisition_sequence bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_row public.user_achievements%ROWTYPE;
  v_now timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'AUTH_REQUIRED');
  END IF;

  IF p_achievement_key IS NULL OR char_length(btrim(p_achievement_key)) = 0 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'ACHIEVEMENT_KEY_INVALID');
  END IF;

  IF p_acquisition_sequence IS NULL OR p_acquisition_sequence <= 0 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'ACQUISITION_SEQUENCE_INVALID');
  END IF;

  SELECT * INTO v_row
    FROM public.user_achievements
   WHERE user_id = v_user_id
     AND achievement_key = p_achievement_key
     AND acquisition_sequence = p_acquisition_sequence;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'ACHIEVEMENT_NOT_OWNED');
  END IF;

  IF v_row.acquisition_notified_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_NOTIFIED',
      'achievement_key', v_row.achievement_key,
      'acquisition_sequence', v_row.acquisition_sequence,
      'acquisition_notified_at', v_row.acquisition_notified_at,
      'acquired_at', v_row.acquired_at
    );
  END IF;

  v_now := now();
  UPDATE public.user_achievements
     SET acquisition_notified_at = v_now
   WHERE user_id = v_user_id
     AND achievement_key = p_achievement_key
     AND acquisition_sequence = p_acquisition_sequence
     AND acquisition_notified_at IS NULL;

  RETURN jsonb_build_object(
    'status', 'NOTIFIED',
    'achievement_key', v_row.achievement_key,
    'acquisition_sequence', v_row.acquisition_sequence,
    'acquisition_notified_at', v_now,
    'acquired_at', v_row.acquired_at
  );
END;
$$;

COMMENT ON FUNCTION public.mark_user_achievement_notified(text, bigint)
  IS '본인 업적 획득 알람 표시 완료. auth.uid()+key+sequence. acquired_at/sequence 변경 없음.';

REVOKE ALL ON FUNCTION public.mark_user_achievement_notified(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_user_achievement_notified(text, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_user_achievement_notified(text, bigint) TO authenticated;
