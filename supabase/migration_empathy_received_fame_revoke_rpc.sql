-- =============================================================================
-- Additive: EMPATHY 취소 시 해당 EMPATHY_RECEIVED event 가 실제로 제거된 1회만
-- reputation_score -1. 새 테이블/컬럼 없음. apply_user_progression_event 유지.
-- 동시 취소: user_progression FOR UPDATE + unique dedupe_key DELETE RETURNING.
-- 재공감: 같은 dedupe_key 재INSERT 가능 (행이 삭제되었으므로).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.revoke_empathy_received_fame(
  p_user_id      uuid,
  p_dedupe_key   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current        public.user_progression%ROWTYPE;
  v_deleted_id     uuid;
  v_deleted_amount bigint;
  v_new_rep        bigint;
BEGIN
  IF p_user_id IS NULL OR p_dedupe_key IS NULL OR length(trim(p_dedupe_key)) = 0 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'PROGRESSION_ARGS_INVALID');
  END IF;

  INSERT INTO public.user_progression (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_current
    FROM public.user_progression
   WHERE user_id = p_user_id
   FOR UPDATE;

  DELETE FROM public.user_progression_events
   WHERE user_id = p_user_id
     AND event_type = 'EMPATHY_RECEIVED'
     AND dedupe_key = p_dedupe_key
  RETURNING id, amount INTO v_deleted_id, v_deleted_amount;

  IF v_deleted_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'NOT_FOUND',
      'dedupeKey', p_dedupe_key,
      'previousLevel', GREATEST(1, LEAST(10, COALESCE(v_current.level, 1))),
      'newLevel', GREATEST(1, LEAST(10, COALESCE(v_current.level, 1))),
      'levelChanged', false,
      'newXp', COALESCE(v_current.xp, 0),
      'previousXp', COALESCE(v_current.xp, 0),
      'xpDelta', 0,
      'newReputation', COALESCE(v_current.reputation_score, 0),
      'fameDelta', 0
    );
  END IF;

  v_new_rep := GREATEST(
    0,
    COALESCE(v_current.reputation_score, 0) - GREATEST(0, COALESCE(v_deleted_amount, 0))
  );

  UPDATE public.user_progression
     SET reputation_score = v_new_rep
   WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'status', 'APPLIED',
    'dedupeKey', p_dedupe_key,
    'eventId', v_deleted_id,
    'previousLevel', GREATEST(1, LEAST(10, COALESCE(v_current.level, 1))),
    'newLevel', GREATEST(1, LEAST(10, COALESCE(v_current.level, 1))),
    'levelChanged', false,
    'previousXp', COALESCE(v_current.xp, 0),
    'newXp', COALESCE(v_current.xp, 0),
    'xpDelta', 0,
    'newReputation', v_new_rep,
    'fameDelta', v_new_rep - COALESCE(v_current.reputation_score, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.revoke_empathy_received_fame(uuid, text)
  IS 'EMPATHY_RECEIVED event DELETE + reputation -amount if row existed. XP/level unchanged. service-role only.';

REVOKE ALL ON FUNCTION public.revoke_empathy_received_fame(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_empathy_received_fame(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_empathy_received_fame(uuid, text) TO service_role;
