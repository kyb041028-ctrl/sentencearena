-- =============================================================================
-- Additive: grant_user_achievement — DB canonical acquired_at + atomic sequence
-- - 기존 함수 signature 유지 (호환)
-- - p_acquired_at / p_acquisition_sequence 는 무시 (클라이언트 시간/순번 비신뢰)
-- - 최초 획득: acquired_at = now(), sequence = user별 max+1 (advisory lock)
-- - 중복: 기존 row 불변, canonical 필드 반환
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
  v_existing public.user_achievements%ROWTYPE;
  v_seq bigint;
  v_acquired timestamptz;
  v_meta jsonb;
BEGIN
  -- p_acquired_at / p_acquisition_sequence are intentionally ignored (client untrusted).
  v_meta := COALESCE(p_metadata, '{}'::jsonb);

  -- Serialize grants per user so concurrent grants cannot share the same sequence.
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
      'season_key', v_existing.season_key
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
    'season_key', p_season_key
  );
END;
$$;

COMMENT ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb)
  IS '업적 부여. acquired_at=now()·sequence=user별 원자 증가. 클라이언트 시각/순번 무시. 중복 시 기존 canonical 반환. service-role 전용.';

-- Keep execute grants (idempotent)
REVOKE ALL ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) TO service_role;
