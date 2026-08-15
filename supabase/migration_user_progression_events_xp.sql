-- =============================================================================
-- Additive: user_progression_events + apply_user_progression_event (Lv1~10)
-- - CREATE IF NOT EXISTS / CREATE OR REPLACE only
-- - 기존 user_progression · user_achievements 미파괴
-- - 테이블 삭제·전체비우기·대량삭제 없음
-- XP SSOT: shared/progression-xp-core.js
--   thresholds: 0,40,90,150,220,300,420,580,800,1100 (,1500 gauge)
-- DELETE_XP_POLICY = PENDING (회수 로직 없음)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_progression_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  amount bigint NOT NULL,
  source_type text NULL,
  source_id text NULL,
  dedupe_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_progression_events
  IS '진행 이벤트 로그. dedupe_key UNIQUE 중복 방지. 서버/service-role 전용 INSERT.';

CREATE UNIQUE INDEX IF NOT EXISTS user_progression_events_dedupe_key_uniq
  ON public.user_progression_events (dedupe_key);
CREATE INDEX IF NOT EXISTS user_progression_events_user_id_idx
  ON public.user_progression_events (user_id, occurred_at DESC);

ALTER TABLE public.user_progression_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_progression_events_select_own" ON public.user_progression_events;
CREATE POLICY "user_progression_events_select_own"
  ON public.user_progression_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.user_progression_events TO authenticated;
GRANT ALL ON TABLE public.user_progression_events TO service_role;
GRANT ALL ON TABLE public.user_progression_events TO postgres;

-- atomic XP + level (Lv1~10) · service-role only
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

  -- ensure progression row
  INSERT INTO public.user_progression (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- lock row for concurrent XP updates
  SELECT * INTO v_current
    FROM public.user_progression
   WHERE user_id = p_user_id
   FOR UPDATE;

  v_prev_level := GREATEST(1, LEAST(10, COALESCE(v_current.level, 1)));

  -- insert event first (UNIQUE dedupe_key) — race-safe idempotency
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

  -- 명성 전용 이벤트는 XP에 amount를 넣지 않음 (공감 1 = fame +1, LEVEL/EXP 불변)
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

  -- 공식 누적 경계 (Lv10 시작 = 1100)
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

COMMENT ON FUNCTION public.apply_user_progression_event
  IS 'XP/level atomic apply. dedupe_key UNIQUE. Lv1~10 thresholds. service-role only.';

REVOKE ALL ON FUNCTION public.apply_user_progression_event(uuid, text, bigint, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_user_progression_event(uuid, text, bigint, text, text, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_user_progression_event(uuid, text, bigint, text, text, text, timestamptz) TO service_role;
