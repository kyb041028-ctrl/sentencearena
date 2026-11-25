-- Candidate only. Do not run this on the production database.
-- No new table. No backfill. Existing rows stay NULL until a new action writes them.
-- Fame and the context row change in one function. A missing country or territory changes nothing.

ALTER TABLE public.user_progression_events
  ADD COLUMN IF NOT EXISTS activity_region text,
  ADD COLUMN IF NOT EXISTS territory_at_event text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_cancelled_at timestamptz;

ALTER TABLE public.user_follows
  ADD COLUMN IF NOT EXISTS activity_region text,
  ADD COLUMN IF NOT EXISTS territory_at_follow text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_cancelled_at timestamptz;

COMMENT ON COLUMN public.user_progression_events.activity_region IS
  '평가 시점 활동 국가. NULL은 UNKNOWN이며 KR로 바꾸지 않는다.';
COMMENT ON COLUMN public.user_progression_events.territory_at_event IS
  '평가 시점 영토. NULL은 UNKNOWN이다.';
COMMENT ON COLUMN public.user_follows.cancelled_at IS
  '팔로우 취소 시각. 행을 지우지 않는다.';

CREATE OR REPLACE FUNCTION public.apply_empathy_fame_with_context(
  p_user_id uuid,
  p_amount bigint,
  p_source_id text,
  p_dedupe_key text,
  p_occurred_at timestamptz,
  p_activity_region text,
  p_territory text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.user_progression%ROWTYPE;
  v_event_id uuid;
  v_new_rep bigint;
  v_existing_id uuid;
  v_existing_cancelled timestamptz;
  v_existing_region text;
  v_existing_territory text;
BEGIN
  IF p_user_id IS NULL OR p_dedupe_key IS NULL OR length(trim(p_dedupe_key)) = 0 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'PROGRESSION_ARGS_INVALID');
  END IF;
  IF p_activity_region IS NULL OR p_activity_region NOT IN ('KR', 'US')
     OR p_territory IS NULL OR length(trim(p_territory)) = 0
     OR p_amount IS NULL THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_UNKNOWN');
  END IF;

  IF to_regclass('public.user_activity_region_profile') IS NOT NULL THEN
    INSERT INTO public.user_activity_region_profile (user_id, activity_region)
    VALUES (p_user_id, p_activity_region)
    ON CONFLICT (user_id, activity_region) DO NOTHING;
    SELECT reputation_score INTO v_new_rep
      FROM public.user_activity_region_profile
     WHERE user_id = p_user_id AND activity_region = p_activity_region
     FOR UPDATE;
  ELSE
    INSERT INTO public.user_progression (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_current
      FROM public.user_progression
     WHERE user_id = p_user_id
     FOR UPDATE;
    v_new_rep := v_current.reputation_score;
  END IF;

  BEGIN
    INSERT INTO public.user_progression_events
      (user_id, event_type, amount, source_type, source_id, dedupe_key, occurred_at, activity_region, territory_at_event)
    VALUES
      (p_user_id, 'EMPATHY_RECEIVED', p_amount, 'EMPATHY', p_source_id, p_dedupe_key,
       COALESCE(p_occurred_at, now()), p_activity_region, p_territory)
    RETURNING id INTO v_event_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, cancelled_at, activity_region, territory_at_event
        INTO v_existing_id, v_existing_cancelled, v_existing_region, v_existing_territory
        FROM public.user_progression_events
       WHERE dedupe_key = p_dedupe_key;
      IF v_existing_id IS NULL OR v_existing_cancelled IS NULL THEN
        RETURN jsonb_build_object('status', 'DUPLICATE', 'code', 'DUPLICATE', 'fameDelta', 0);
      END IF;
      IF v_existing_region IS NULL OR v_existing_territory IS NULL THEN
        RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_UNKNOWN', 'fameDelta', 0);
      END IF;
      IF v_existing_region IS DISTINCT FROM p_activity_region
         OR v_existing_territory IS DISTINCT FROM p_territory THEN
        RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_LOCKED', 'fameDelta', 0);
      END IF;
      UPDATE public.user_progression_events
         SET cancelled_at = NULL
       WHERE id = v_existing_id
         AND last_cancelled_at IS NOT NULL;
      IF to_regclass('public.user_activity_region_profile') IS NOT NULL THEN
        UPDATE public.user_activity_region_profile
           SET reputation_score = reputation_score + GREATEST(0, p_amount),
               updated_at = now()
         WHERE user_id = p_user_id AND activity_region = p_activity_region
         RETURNING reputation_score INTO v_new_rep;
      ELSE
        v_new_rep := GREATEST(0, COALESCE(v_current.reputation_score, 0) + GREATEST(0, p_amount));
        UPDATE public.user_progression
           SET reputation_score = v_new_rep
         WHERE user_id = p_user_id;
      END IF;
      RETURN jsonb_build_object('status', 'APPLIED', 'eventId', v_existing_id, 'fameDelta', p_amount, 'newReputation', v_new_rep, 'regrant', true);
  END;

  IF to_regclass('public.user_activity_region_profile') IS NOT NULL THEN
    UPDATE public.user_activity_region_profile
       SET reputation_score = reputation_score + GREATEST(0, p_amount),
           updated_at = now()
     WHERE user_id = p_user_id AND activity_region = p_activity_region
     RETURNING reputation_score INTO v_new_rep;
  ELSE
    v_new_rep := GREATEST(0, COALESCE(v_current.reputation_score, 0) + GREATEST(0, p_amount));
    UPDATE public.user_progression
       SET reputation_score = v_new_rep
     WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('status', 'APPLIED', 'eventId', v_event_id, 'fameDelta', p_amount, 'newReputation', v_new_rep);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_user_follow_with_context(
  p_follower uuid,
  p_target uuid,
  p_activity_region text,
  p_territory text,
  p_cancel boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_region text;
  v_territory text;
  v_cancelled timestamptz;
BEGIN
  IF p_follower IS NULL OR p_target IS NULL OR p_follower = p_target THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'FOLLOW_ARGS_INVALID');
  END IF;
  IF p_activity_region IS NULL OR p_activity_region NOT IN ('KR', 'US')
     OR p_territory IS NULL OR length(trim(p_territory)) = 0 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'FOLLOW_SCOPE_UNKNOWN');
  END IF;

  SELECT activity_region, territory_at_follow, cancelled_at
    INTO v_region, v_territory, v_cancelled
    FROM public.user_follows
   WHERE follower_user_id = p_follower
     AND following_user_id = p_target
     AND activity_region = p_activity_region
   FOR UPDATE;

  IF FOUND THEN
    IF v_region IS NULL OR v_territory IS NULL OR length(trim(v_region)) = 0 OR length(trim(v_territory)) = 0 THEN
      RETURN jsonb_build_object('status', 'ERROR', 'code', 'FOLLOW_BASELINE_UNKNOWN');
    END IF;
    IF v_region IS DISTINCT FROM p_activity_region OR v_territory IS DISTINCT FROM p_territory THEN
      RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_LOCKED');
    END IF;
    IF COALESCE(p_cancel, false) THEN
      IF v_cancelled IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'NOT_FOUND', 'code', 'FOLLOW_NOT_FOUND');
      END IF;
      UPDATE public.user_follows
         SET cancelled_at = now(),
             last_cancelled_at = now()
       WHERE follower_user_id = p_follower
         AND following_user_id = p_target
         AND activity_region = p_activity_region;
      RETURN jsonb_build_object('status', 'CANCELLED');
    END IF;
    IF v_cancelled IS NULL THEN
      RETURN jsonb_build_object('status', 'DUPLICATE', 'code', 'DUPLICATE');
    END IF;
    UPDATE public.user_follows
       SET cancelled_at = NULL
     WHERE follower_user_id = p_follower
       AND following_user_id = p_target
       AND activity_region = p_activity_region
       AND last_cancelled_at IS NOT NULL;
    RETURN jsonb_build_object('status', 'FOLLOWED');
  END IF;

  IF COALESCE(p_cancel, false) THEN
    RETURN jsonb_build_object('status', 'NOT_FOUND', 'code', 'FOLLOW_NOT_FOUND');
  END IF;
  INSERT INTO public.user_follows
    (follower_user_id, following_user_id, activity_region, territory_at_follow)
  VALUES
    (p_follower, p_target, p_activity_region, p_territory);
  RETURN jsonb_build_object('status', 'FOLLOWED');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'DUPLICATE', 'code', 'DUPLICATE');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_empathy_fame_with_context(
  p_user_id uuid,
  p_dedupe_key text,
  p_activity_region text,
  p_territory text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.user_progression%ROWTYPE;
  v_event_id uuid;
  v_amount bigint;
  v_cancelled timestamptz;
  v_region text;
  v_territory text;
  v_new_rep bigint;
BEGIN
  IF p_user_id IS NULL OR p_dedupe_key IS NULL OR length(trim(p_dedupe_key)) = 0 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'PROGRESSION_ARGS_INVALID', 'fameDelta', 0);
  END IF;
  IF p_activity_region IS NULL OR p_activity_region NOT IN ('KR', 'US')
     OR p_territory IS NULL OR length(trim(p_territory)) = 0 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_UNKNOWN', 'fameDelta', 0);
  END IF;

  SELECT * INTO v_current
    FROM public.user_progression
   WHERE user_id = p_user_id
   FOR UPDATE;

  SELECT id, amount, cancelled_at, activity_region, territory_at_event
    INTO v_event_id, v_amount, v_cancelled, v_region, v_territory
    FROM public.user_progression_events
   WHERE user_id = p_user_id
     AND event_type = 'EMPATHY_RECEIVED'
     AND dedupe_key = p_dedupe_key;

  IF v_event_id IS NULL OR v_cancelled IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'NOT_FOUND', 'code', 'NOT_FOUND', 'fameDelta', 0);
  END IF;
  IF v_region IS NULL OR v_territory IS NULL THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_UNKNOWN', 'fameDelta', 0);
  END IF;
  IF v_region IS DISTINCT FROM p_activity_region OR v_territory IS DISTINCT FROM p_territory THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_LOCKED', 'fameDelta', 0);
  END IF;

  UPDATE public.user_progression_events
     SET cancelled_at = now(),
         last_cancelled_at = now()
   WHERE id = v_event_id;

  IF to_regclass('public.user_activity_region_profile') IS NOT NULL THEN
    UPDATE public.user_activity_region_profile
       SET reputation_score = GREATEST(0, reputation_score - GREATEST(0, COALESCE(v_amount, 0))),
           updated_at = now()
     WHERE user_id = p_user_id AND activity_region = p_activity_region
     RETURNING reputation_score INTO v_new_rep;
  ELSE
    v_new_rep := GREATEST(0, COALESCE(v_current.reputation_score, 0) - GREATEST(0, COALESCE(v_amount, 0)));
    UPDATE public.user_progression
       SET reputation_score = v_new_rep
     WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('status', 'APPLIED', 'fameDelta', v_new_rep - COALESCE(v_current.reputation_score, 0), 'newReputation', v_new_rep);
END;
$$;

CREATE OR REPLACE FUNCTION public.link_user_follow_activity(
  p_follower uuid,
  p_target uuid,
  p_activity_region text,
  p_territory text,
  p_cancel boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.record_user_follow_with_context(
    p_follower, p_target, p_activity_region, p_territory, p_cancel
  );
  IF v_result->>'status' = 'FOLLOWED' THEN
    UPDATE public.user_progression
       SET follower_count = COALESCE(follower_count, 0) + 1
     WHERE user_id = p_target;
    UPDATE public.user_progression
       SET following_count = COALESCE(following_count, 0) + 1
     WHERE user_id = p_follower;
  ELSIF v_result->>'status' = 'CANCELLED' THEN
    UPDATE public.user_progression
       SET follower_count = GREATEST(0, COALESCE(follower_count, 0) - 1)
     WHERE user_id = p_target;
    UPDATE public.user_progression
       SET following_count = GREATEST(0, COALESCE(following_count, 0) - 1)
     WHERE user_id = p_follower;
  END IF;
  RETURN v_result;
END;
$$;

-- Isolated wiring only. Does not replace apply_user_progression_event or toggle_user_follow.
-- If a live row already exists, this does not add fame or followers again and does not delete the row.

CREATE OR REPLACE FUNCTION public.isolate_empathy_once(
  p_user_id uuid,
  p_amount bigint,
  p_source_id text,
  p_dedupe_key text,
  p_occurred_at timestamptz,
  p_activity_region text,
  p_territory text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before bigint;
  v_existing uuid;
  v_cancelled timestamptz;
BEGIN
  SELECT reputation_score INTO v_before
    FROM public.user_progression
   WHERE user_id = p_user_id
   FOR UPDATE;
  SELECT id, cancelled_at INTO v_existing, v_cancelled
    FROM public.user_progression_events
   WHERE dedupe_key = p_dedupe_key;
  IF v_existing IS NOT NULL AND v_cancelled IS NULL THEN
    RETURN jsonb_build_object('status', 'DUPLICATE', 'code', 'DUPLICATE', 'fameDelta', 0, 'preservedFame', v_before);
  END IF;
  RETURN public.apply_empathy_fame_with_context(
    p_user_id, p_amount, p_source_id, p_dedupe_key, p_occurred_at, p_activity_region, p_territory
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.isolate_follow_once(
  p_follower uuid,
  p_target uuid,
  p_activity_region text,
  p_territory text,
  p_cancel boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_region text;
  v_territory text;
  v_cancelled timestamptz;
  v_count bigint;
BEGIN
  SELECT activity_region, territory_at_follow, cancelled_at
    INTO v_region, v_territory, v_cancelled
    FROM public.user_follows
   WHERE follower_user_id = p_follower AND following_user_id = p_target
     AND activity_region = p_activity_region
   FOR UPDATE;
  IF FOUND AND NOT COALESCE(p_cancel, false) AND v_cancelled IS NULL THEN
    SELECT count(*) INTO v_count
      FROM public.user_follows
     WHERE following_user_id = p_target
       AND activity_region = p_activity_region
       AND cancelled_at IS NULL;
    RETURN jsonb_build_object(
      'status', 'EXISTING',
      'code', CASE WHEN v_region IS NULL OR v_territory IS NULL THEN 'FOLLOW_BASELINE_UNKNOWN' ELSE 'DUPLICATE' END,
      'legacy', v_region IS NULL OR v_territory IS NULL,
      'changed', false,
      'followerCount', v_count
    );
  END IF;
  RETURN public.link_user_follow_activity(p_follower, p_target, p_activity_region, p_territory, p_cancel);
END;
$$;
