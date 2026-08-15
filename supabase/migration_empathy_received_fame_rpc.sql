-- =============================================================================
-- Additive: EMPATHY_RECEIVED 는 XP를 올리지 않고 reputation_score 만 변경
-- Additive REPLACE only. No table wipe. No destructive table ops.
-- 공감 1 = fame +1 (확정) · 기존 POST_CREATED XP 경로 유지
-- =============================================================================

CREATE OR REPLACE FUNCTION public.apply_user_progression_event(
  p_user_id      uuid,
  p_event_type   text,
  p_amount       bigint,
  p_source_type  text,
  p_source_id    text,
  p_dedupe_key   text,
  p_occurred_at  timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current        public.user_progression%ROWTYPE;
  v_new_xp         bigint;
  v_new_level      integer;
  v_prev_level     integer;
  v_new_rep        bigint;
  v_event_id       uuid;
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

  v_prev_level := GREATEST(1, LEAST(10, COALESCE(v_current.level, 1)));

  BEGIN
    INSERT INTO public.user_progression_events
      (user_id, event_type, amount, source_type, source_id, dedupe_key, occurred_at)
    VALUES
      (p_user_id, p_event_type, p_amount, p_source_type, p_source_id, p_dedupe_key,
       COALESCE(p_occurred_at, now()))
    RETURNING id INTO v_event_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_current FROM public.user_progression WHERE user_id = p_user_id;
      RETURN jsonb_build_object(
        'status', 'DUPLICATE',
        'dedupeKey', p_dedupe_key,
        'previousLevel', GREATEST(1, LEAST(10, COALESCE(v_current.level, 1))),
        'newLevel', GREATEST(1, LEAST(10, COALESCE(v_current.level, 1))),
        'levelChanged', false,
        'newXp', COALESCE(v_current.xp, 0),
        'previousXp', COALESCE(v_current.xp, 0),
        'xpDelta', 0,
        'newReputation', COALESCE(v_current.reputation_score, 0)
      );
  END;

  IF p_event_type IN ('EMPATHY_RECEIVED', 'LIKE_RECEIVED', 'FOLLOWER_GAINED') THEN
    v_new_xp := GREATEST(0, COALESCE(v_current.xp, 0));
    v_new_rep := GREATEST(0, COALESCE(v_current.reputation_score, 0) + GREATEST(0, COALESCE(p_amount, 0)));
  ELSE
    v_new_xp := GREATEST(0, COALESCE(v_current.xp, 0) + COALESCE(p_amount, 0));
    IF p_event_type IN ('POST_CREATED', 'COMMENT_CREATED', 'BOARD_COMMENT_CREATED', 'ISSUE_COMMENT_CREATED') THEN
      v_new_rep := GREATEST(0, COALESCE(v_current.reputation_score, 0));
    ELSE
      v_new_rep := GREATEST(0, COALESCE(v_current.reputation_score, 0) + COALESCE(p_amount, 0));
    END IF;
  END IF;

  v_new_level := CASE
    WHEN v_new_xp >= 1100 THEN 10
    WHEN v_new_xp >= 800  THEN 9
    WHEN v_new_xp >= 580  THEN 8
    WHEN v_new_xp >= 420  THEN 7
    WHEN v_new_xp >= 300  THEN 6
    WHEN v_new_xp >= 220  THEN 5
    WHEN v_new_xp >= 150  THEN 4
    WHEN v_new_xp >= 90   THEN 3
    WHEN v_new_xp >= 40   THEN 2
    ELSE 1
  END;

  UPDATE public.user_progression
     SET xp = v_new_xp,
         level = v_new_level,
         reputation_score = v_new_rep
   WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'status', 'APPLIED',
    'dedupeKey', p_dedupe_key,
    'eventId', v_event_id,
    'previousLevel', v_prev_level,
    'newLevel', v_new_level,
    'levelChanged', v_new_level <> v_prev_level,
    'previousXp', COALESCE(v_current.xp, 0),
    'newXp', v_new_xp,
    'xpDelta', CASE
      WHEN p_event_type IN ('EMPATHY_RECEIVED', 'LIKE_RECEIVED', 'FOLLOWER_GAINED') THEN 0
      ELSE COALESCE(p_amount, 0)
    END,
    'newReputation', v_new_rep
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_user_progression_event(uuid, text, bigint, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_user_progression_event(uuid, text, bigint, text, text, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_user_progression_event(uuid, text, bigint, text, text, text, timestamptz) TO service_role;
