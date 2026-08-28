-- =============================================================================
-- Additive BETA ALIGNMENT V1.
-- Score snapshots on board_reactions, pending territory on user_alignment_state,
-- alignment_territory_history, toggle snapshot stamps, batch territory move.
-- No table drop. No row wipe. No score reset. No profile territory backfill.
-- =============================================================================

ALTER TABLE public.board_reactions
  ADD COLUMN IF NOT EXISTS actor_alignment_score_at_reaction numeric(20, 6) NULL;

ALTER TABLE public.board_reactions
  ADD COLUMN IF NOT EXISTS target_author_alignment_score_at_reaction numeric(20, 6) NULL;

ALTER TABLE public.user_alignment_state
  ADD COLUMN IF NOT EXISTS pending_territory text NULL;

ALTER TABLE public.user_alignment_state
  ADD COLUMN IF NOT EXISTS pending_territory_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.user_alignment_state
  ADD COLUMN IF NOT EXISTS pending_territory_started_at timestamptz NULL;

ALTER TABLE public.user_alignment_state
  ADD COLUMN IF NOT EXISTS last_territory_changed_at timestamptz NULL;

ALTER TABLE public.user_alignment_state
  DROP CONSTRAINT IF EXISTS user_alignment_state_pending_territory_chk;

ALTER TABLE public.user_alignment_state
  ADD CONSTRAINT user_alignment_state_pending_territory_chk
  CHECK (
    pending_territory IS NULL
    OR pending_territory IN ('PIONEER', 'CENTRAL', 'GUARDIAN')
  );

ALTER TABLE public.user_alignment_state
  DROP CONSTRAINT IF EXISTS user_alignment_state_pending_count_chk;

ALTER TABLE public.user_alignment_state
  ADD CONSTRAINT user_alignment_state_pending_count_chk
  CHECK (pending_territory_count >= 0);

CREATE TABLE IF NOT EXISTS public.alignment_territory_history (
  history_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_territory text NOT NULL,
  to_territory text NOT NULL,
  alignment_score numeric(20, 6) NOT NULL,
  batch_id text NOT NULL REFERENCES public.alignment_batches(batch_id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'ALIGNMENT',
  changed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alignment_territory_history_unique_batch_user UNIQUE (batch_id, user_id),
  CONSTRAINT alignment_territory_history_id_format_chk CHECK (
    history_id = batch_id || '_territory_' || user_id::text
  ),
  CONSTRAINT alignment_territory_history_reason_chk CHECK (reason = 'ALIGNMENT'),
  CONSTRAINT alignment_territory_history_from_chk CHECK (
    from_territory IN ('PIONEER', 'CENTRAL', 'GUARDIAN')
  ),
  CONSTRAINT alignment_territory_history_to_chk CHECK (
    to_territory IN ('PIONEER', 'CENTRAL', 'GUARDIAN')
  ),
  CONSTRAINT alignment_territory_history_score_finite CHECK (public.alignment_is_finite(alignment_score))
);

CREATE INDEX IF NOT EXISTS idx_alignment_territory_history_user_changed_at_desc
  ON public.alignment_territory_history (user_id, changed_at DESC);

ALTER TABLE public.alignment_territory_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alignment_territory_history_select_own ON public.alignment_territory_history;
CREATE POLICY alignment_territory_history_select_own
  ON public.alignment_territory_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.alignment_territory_history TO authenticated;

CREATE OR REPLACE FUNCTION public.alignment_beta_v1_territory_candidate(
  p_current text,
  p_score numeric,
  p_last_changed timestamptz,
  p_batch_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cur text := upper(coalesce(p_current, 'CENTRAL'));
  v_candidate text;
BEGIN
  IF v_cur IN ('ALIEN', 'KANTAPBIYA') THEN
    RETURN v_cur;
  END IF;
  IF v_cur = 'CENTRAL' THEN
    IF p_score >= 360 THEN
      v_candidate := 'PIONEER';
    ELSIF p_score <= -360 THEN
      v_candidate := 'GUARDIAN';
    ELSE
      v_candidate := 'CENTRAL';
    END IF;
  ELSIF v_cur = 'PIONEER' THEN
    IF p_score <= 160 THEN
      v_candidate := 'CENTRAL';
    ELSE
      v_candidate := 'PIONEER';
    END IF;
  ELSIF v_cur = 'GUARDIAN' THEN
    IF p_score >= -160 THEN
      v_candidate := 'CENTRAL';
    ELSE
      v_candidate := 'GUARDIAN';
    END IF;
  ELSE
    v_candidate := 'CENTRAL';
  END IF;

  IF v_candidate IS DISTINCT FROM v_cur
     AND p_last_changed IS NOT NULL
     AND p_batch_at IS NOT NULL
     AND (p_batch_at - p_last_changed) < interval '24 hours' THEN
    RETURN v_cur;
  END IF;

  RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_board_reaction(
  p_target_type text,
  p_target_id uuid,
  p_reaction_type text,
  p_actor_territory text,
  p_audience_scope text,
  p_target_author_territory text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_group text;
  v_existing public.board_reactions%ROWTYPE;
  v_post public.board_posts%ROWTYPE;
  v_comment public.board_comments%ROWTYPE;
  v_target_author uuid;
  v_action text;
  v_active boolean := false;
  v_pos_col text;
  v_neg_col text;
  v_actor_score numeric(20, 6) := 0;
  v_target_score numeric(20, 6) := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'BOARD_AUTH_REQUIRED';
  END IF;

  v_group := public.board_reaction_group(p_reaction_type);
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'BOARD_REACTION_TYPE_INVALID';
  END IF;

  IF p_target_type NOT IN ('POST', 'COMMENT') THEN
    RAISE EXCEPTION 'BOARD_TARGET_TYPE_INVALID';
  END IF;

  IF p_audience_scope NOT IN ('EARTH', 'ALIEN') THEN
    RAISE EXCEPTION 'BOARD_AUDIENCE_SCOPE_INVALID';
  END IF;

  IF p_actor_territory NOT IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN') THEN
    RAISE EXCEPTION 'BOARD_ACTOR_TERRITORY_INVALID';
  END IF;

  IF p_target_author_territory NOT IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN') THEN
    RAISE EXCEPTION 'BOARD_TARGET_TERRITORY_INVALID';
  END IF;

  IF p_target_type = 'POST' THEN
    SELECT * INTO v_post FROM public.board_posts WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOARD_POST_NOT_FOUND'; END IF;
    IF v_post.status <> 'ACTIVE' THEN RAISE EXCEPTION 'BOARD_TARGET_NOT_ACTIVE'; END IF;
    v_target_author := v_post.author_user_id;

    SELECT * INTO v_existing
    FROM public.board_reactions
    WHERE actor_user_id = v_actor
      AND target_type = 'POST'
      AND post_id = p_target_id
      AND reaction_group = v_group
      AND cancelled_at IS NULL
    FOR UPDATE;
  ELSE
    SELECT * INTO v_comment FROM public.board_comments WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOARD_COMMENT_NOT_FOUND'; END IF;
    IF v_comment.status <> 'ACTIVE' THEN RAISE EXCEPTION 'BOARD_TARGET_NOT_ACTIVE'; END IF;
    v_target_author := v_comment.author_user_id;

    SELECT * INTO v_existing
    FROM public.board_reactions
    WHERE actor_user_id = v_actor
      AND target_type = 'COMMENT'
      AND comment_id = p_target_id
      AND reaction_group = v_group
      AND cancelled_at IS NULL
    FOR UPDATE;
  END IF;

  SELECT COALESCE((SELECT score FROM public.user_alignment_state WHERE user_id = v_actor), 0)
    INTO v_actor_score;
  SELECT COALESCE((SELECT score FROM public.user_alignment_state WHERE user_id = v_target_author), 0)
    INTO v_target_score;

  IF p_audience_scope = 'EARTH' THEN
    v_pos_col := 'earth_positive_count';
    v_neg_col := 'earth_negative_count';
  ELSE
    v_pos_col := 'alien_positive_count';
    v_neg_col := 'alien_negative_count';
  END IF;

  IF FOUND AND v_existing.id IS NOT NULL THEN
    IF v_existing.reaction_type = p_reaction_type THEN
      UPDATE public.board_reactions
      SET cancelled_at = now(), updated_at = now()
      WHERE id = v_existing.id;
      v_action := 'CANCELLED';
      v_active := false;

      IF v_group = 'POSITIVE' THEN
        IF p_target_type = 'POST' THEN
          EXECUTE format('UPDATE public.board_posts SET %I = GREATEST(%I - 1, 0), updated_at = now() WHERE id = $1', v_pos_col, v_pos_col) USING p_target_id;
        ELSE
          EXECUTE format('UPDATE public.board_comments SET %I = GREATEST(%I - 1, 0), updated_at = now() WHERE id = $1', v_pos_col, v_pos_col) USING p_target_id;
        END IF;
      ELSE
        IF p_target_type = 'POST' THEN
          EXECUTE format('UPDATE public.board_posts SET %I = GREATEST(%I - 1, 0), updated_at = now() WHERE id = $1', v_neg_col, v_neg_col) USING p_target_id;
        ELSE
          EXECUTE format('UPDATE public.board_comments SET %I = GREATEST(%I - 1, 0), updated_at = now() WHERE id = $1', v_neg_col, v_neg_col) USING p_target_id;
        END IF;
      END IF;
    ELSE
      UPDATE public.board_reactions
      SET cancelled_at = now(), updated_at = now()
      WHERE id = v_existing.id;

      INSERT INTO public.board_reactions (
        actor_user_id, target_type, post_id, comment_id, target_author_user_id,
        reaction_type, reaction_group, audience_scope,
        actor_territory_at_reaction, target_author_territory_at_reaction,
        actor_alignment_score_at_reaction, target_author_alignment_score_at_reaction
      ) VALUES (
        v_actor, p_target_type,
        CASE WHEN p_target_type = 'POST' THEN p_target_id ELSE NULL END,
        CASE WHEN p_target_type = 'COMMENT' THEN p_target_id ELSE NULL END,
        v_target_author, p_reaction_type, v_group, p_audience_scope,
        p_actor_territory, p_target_author_territory,
        v_actor_score, v_target_score
      );
      v_action := 'REPLACED';
      v_active := true;
    END IF;
  ELSE
    INSERT INTO public.board_reactions (
      actor_user_id, target_type, post_id, comment_id, target_author_user_id,
      reaction_type, reaction_group, audience_scope,
      actor_territory_at_reaction, target_author_territory_at_reaction,
      actor_alignment_score_at_reaction, target_author_alignment_score_at_reaction
    ) VALUES (
      v_actor, p_target_type,
      CASE WHEN p_target_type = 'POST' THEN p_target_id ELSE NULL END,
      CASE WHEN p_target_type = 'COMMENT' THEN p_target_id ELSE NULL END,
      v_target_author, p_reaction_type, v_group, p_audience_scope,
      p_actor_territory, p_target_author_territory,
      v_actor_score, v_target_score
    );
    v_action := 'CREATED';
    v_active := true;

    IF v_group = 'POSITIVE' THEN
      IF p_target_type = 'POST' THEN
        EXECUTE format('UPDATE public.board_posts SET %I = %I + 1, updated_at = now() WHERE id = $1', v_pos_col, v_pos_col) USING p_target_id;
      ELSE
        EXECUTE format('UPDATE public.board_comments SET %I = %I + 1, updated_at = now() WHERE id = $1', v_pos_col, v_pos_col) USING p_target_id;
      END IF;
    ELSE
      IF p_target_type = 'POST' THEN
        EXECUTE format('UPDATE public.board_posts SET %I = %I + 1, updated_at = now() WHERE id = $1', v_neg_col, v_neg_col) USING p_target_id;
      ELSE
        EXECUTE format('UPDATE public.board_comments SET %I = %I + 1, updated_at = now() WHERE id = $1', v_neg_col, v_neg_col) USING p_target_id;
      END IF;
    END IF;
  END IF;

  IF p_target_type = 'POST' THEN
    SELECT * INTO v_post FROM public.board_posts WHERE id = p_target_id;
    RETURN jsonb_build_object(
      'success', true,
      'action', v_action,
      'targetType', 'POST',
      'targetId', p_target_id,
      'reactionType', p_reaction_type,
      'reactionGroup', v_group,
      'active', v_active,
      'counts', jsonb_build_object(
        'earthPositive', v_post.earth_positive_count,
        'earthNegative', v_post.earth_negative_count,
        'alienPositive', v_post.alien_positive_count,
        'alienNegative', v_post.alien_negative_count
      )
    );
  ELSE
    SELECT * INTO v_comment FROM public.board_comments WHERE id = p_target_id;
    RETURN jsonb_build_object(
      'success', true,
      'action', v_action,
      'targetType', 'COMMENT',
      'targetId', p_target_id,
      'reactionType', p_reaction_type,
      'reactionGroup', v_group,
      'active', v_active,
      'counts', jsonb_build_object(
        'earthPositive', v_comment.earth_positive_count,
        'earthNegative', v_comment.earth_negative_count,
        'alienPositive', v_comment.alien_positive_count,
        'alienNegative', v_comment.alien_negative_count
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_alignment_score_batch(plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id text;
  v_processed_at timestamptz;
  v_existing text;
  v_inserted integer := 0;
  v_user_count integer := 0;
  v_processed integer := 0;
  v_skipped integer := 0;
  v_territory_moved integer := 0;
  v_rec jsonb;
  v_user_id uuid;
  v_combined numeric(20, 6);
  v_score numeric(20, 6);
  v_prev_signal numeric(20, 6);
  v_last_batch text;
  v_pending text;
  v_pending_count integer;
  v_pending_started timestamptz;
  v_last_changed timestamptz;
  v_raw numeric(20, 6);
  v_capped numeric(20, 6);
  v_next_score numeric(20, 6);
  v_cap numeric(20, 6) := 500;
  v_history_id text;
  v_current_territory text;
  v_candidate text;
  v_has_profile boolean;
BEGIN
  IF plan IS NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_PLAN_REQUIRED';
  END IF;
  IF plan->>'batchId' IS NULL OR length(trim(plan->>'batchId')) = 0 THEN
    RAISE EXCEPTION 'ALIGNMENT_PLAN_BATCH_ID_REQUIRED';
  END IF;
  IF plan->>'processedAt' IS NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_PLAN_PROCESSED_AT_INVALID';
  END IF;
  IF plan->'users' IS NULL OR jsonb_typeof(plan->'users') <> 'array' THEN
    RAISE EXCEPTION 'ALIGNMENT_PLAN_USERS_ARRAY_REQUIRED';
  END IF;
  IF plan ? 'score' OR plan ? 'nextScore' OR plan ? 'cappedDelta' OR plan ? 'nextTerritory' THEN
    RAISE EXCEPTION 'ALIGNMENT_PLAN_CLIENT_SCORE_FORBIDDEN';
  END IF;

  v_batch_id := plan->>'batchId';
  v_processed_at := (plan->>'processedAt')::timestamptz;
  v_user_count := jsonb_array_length(plan->'users');

  SELECT batch_id INTO v_existing
  FROM public.alignment_batches
  WHERE batch_id = v_batch_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'committed', false,
      'skipReason', 'ALREADY_APPLIED',
      'batchId', v_batch_id,
      'territoryMoved', 0
    );
  END IF;

  INSERT INTO public.alignment_batches (
    batch_id, scheduled_at, processed_at, completed_at, status,
    total_users, processed_users, skipped_users, failed_users, calculation_mode
  ) VALUES (
    v_batch_id, v_processed_at, v_processed_at, NULL, 'PROCESSING',
    v_user_count, 0, 0, 0, 'DELTA_WINDOW_SCORE'
  )
  ON CONFLICT (batch_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'committed', false,
      'skipReason', 'ALREADY_APPLIED',
      'batchId', v_batch_id,
      'territoryMoved', 0
    );
  END IF;

  FOR v_rec IN SELECT value FROM jsonb_array_elements(plan->'users')
  LOOP
    IF v_rec->>'userId' IS NULL OR v_rec->>'combinedSignal' IS NULL THEN
      RAISE EXCEPTION 'ALIGNMENT_PLAN_USER_INVALID';
    END IF;
    IF v_rec ? 'score' OR v_rec ? 'nextScore' OR v_rec ? 'cappedDelta' OR v_rec ? 'signedDelta'
       OR v_rec ? 'nextTerritory' OR v_rec ? 'pendingTerritory' THEN
      RAISE EXCEPTION 'ALIGNMENT_PLAN_CLIENT_SCORE_FORBIDDEN';
    END IF;

    BEGIN
      v_user_id := (v_rec->>'userId')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ALIGNMENT_PLAN_USER_INVALID';
    END;

    BEGIN
      v_combined := (v_rec->>'combinedSignal')::numeric(20, 6);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ALIGNMENT_PLAN_SIGNAL_INVALID';
    END;

    IF v_combined IS NULL OR v_combined <> v_combined THEN
      RAISE EXCEPTION 'ALIGNMENT_PLAN_SIGNAL_INVALID';
    END IF;

    INSERT INTO public.user_alignment_state (user_id, score, previous_signal)
    VALUES (v_user_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT score, previous_signal, last_processed_batch_id,
           pending_territory, pending_territory_count, pending_territory_started_at, last_territory_changed_at
      INTO v_score, v_prev_signal, v_last_batch,
           v_pending, v_pending_count, v_pending_started, v_last_changed
    FROM public.user_alignment_state
    WHERE user_id = v_user_id
    FOR UPDATE;

    IF v_last_batch IS NOT NULL AND v_last_batch = v_batch_id THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_raw := v_combined - v_prev_signal;
    v_capped := GREATEST(-v_cap, LEAST(v_cap, v_raw));
    v_next_score := v_score + v_capped;
    v_history_id := v_batch_id || '_' || v_user_id::text;

    UPDATE public.user_alignment_state
    SET
      score = v_next_score,
      previous_signal = v_combined,
      last_processed_batch_id = v_batch_id,
      updated_at = v_processed_at
    WHERE user_id = v_user_id;

    INSERT INTO public.alignment_history (
      history_id, batch_id, user_id, processed_at,
      previous_score, next_score, score_change,
      previous_signal, next_signal, cap_applied
    ) VALUES (
      v_history_id, v_batch_id, v_user_id, v_processed_at,
      v_score, v_next_score, v_capped,
      v_prev_signal, v_combined, (v_capped <> v_raw)
    );

    v_current_territory := NULL;
    SELECT territory INTO v_current_territory
    FROM public.profiles
    WHERE id = v_user_id
    FOR UPDATE;
    v_has_profile := FOUND;

    IF v_has_profile AND v_current_territory IS NOT NULL THEN
      v_candidate := public.alignment_beta_v1_territory_candidate(
        v_current_territory, v_next_score, v_last_changed, v_processed_at
      );

      IF v_current_territory IN ('ALIEN', 'KANTAPBIYA') THEN
        UPDATE public.user_alignment_state
        SET pending_territory = NULL,
            pending_territory_count = 0,
            pending_territory_started_at = NULL
        WHERE user_id = v_user_id;
      ELSIF v_candidate = v_current_territory THEN
        UPDATE public.user_alignment_state
        SET pending_territory = NULL,
            pending_territory_count = 0,
            pending_territory_started_at = NULL
        WHERE user_id = v_user_id;
      ELSIF v_pending IS DISTINCT FROM v_candidate THEN
        UPDATE public.user_alignment_state
        SET pending_territory = v_candidate,
            pending_territory_count = 1,
            pending_territory_started_at = v_processed_at
        WHERE user_id = v_user_id;
      ELSIF COALESCE(v_pending_count, 0) + 1 >= 2 THEN
        UPDATE public.profiles
        SET territory = v_candidate
        WHERE id = v_user_id;

        INSERT INTO public.alignment_territory_history (
          history_id, user_id, from_territory, to_territory,
          alignment_score, batch_id, reason, changed_at
        ) VALUES (
          v_batch_id || '_territory_' || v_user_id::text,
          v_user_id, v_current_territory, v_candidate,
          v_next_score, v_batch_id, 'ALIGNMENT', v_processed_at
        );

        UPDATE public.user_alignment_state
        SET pending_territory = NULL,
            pending_territory_count = 0,
            pending_territory_started_at = NULL,
            last_territory_changed_at = v_processed_at
        WHERE user_id = v_user_id;

        v_territory_moved := v_territory_moved + 1;
      ELSE
        UPDATE public.user_alignment_state
        SET pending_territory = v_candidate,
            pending_territory_count = COALESCE(v_pending_count, 0) + 1
        WHERE user_id = v_user_id;
      END IF;
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  UPDATE public.alignment_batches
  SET
    status = 'COMPLETED',
    completed_at = v_processed_at,
    total_users = v_user_count,
    processed_users = v_processed,
    skipped_users = v_skipped,
    failed_users = 0
  WHERE batch_id = v_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'skipped', false,
    'committed', true,
    'skipReason', NULL,
    'batchId', v_batch_id,
    'processedUsers', v_processed,
    'skippedUsers', v_skipped,
    'totalUsers', v_user_count,
    'territoryMoved', v_territory_moved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_alignment_score_batch(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_alignment_score_batch(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_alignment_score_batch(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_alignment_score_batch(jsonb) TO service_role;
