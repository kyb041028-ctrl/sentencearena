-- =============================================================================
-- Additive alignment SCORE persistence. No table drop. No row wipe.
-- =============================================================================
-- Scope: score + previous_signal persistence only.
-- Additive. No table drop. No row wipe.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.alignment_is_finite(d numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT d IS NOT NULL AND d = d;
$$;

CREATE TABLE IF NOT EXISTS public.user_alignment_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  score numeric(20, 6) NOT NULL DEFAULT 0,
  previous_signal numeric(20, 6) NOT NULL DEFAULT 0,
  last_processed_batch_id text NULL,
  updated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_alignment_state_score_finite CHECK (public.alignment_is_finite(score)),
  CONSTRAINT user_alignment_state_signal_finite CHECK (public.alignment_is_finite(previous_signal))
);

CREATE TABLE IF NOT EXISTS public.alignment_batches (
  batch_id text PRIMARY KEY,
  scheduled_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  status text NOT NULL,
  total_users integer NOT NULL DEFAULT 0,
  processed_users integer NOT NULL DEFAULT 0,
  skipped_users integer NOT NULL DEFAULT 0,
  failed_users integer NOT NULL DEFAULT 0,
  calculation_mode text NOT NULL DEFAULT 'DELTA_WINDOW_SCORE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alignment_batches_status_chk CHECK (
    status IN ('PROCESSING', 'COMPLETED', 'FAILED')
  ),
  CONSTRAINT alignment_batches_total_users_nonneg CHECK (total_users >= 0),
  CONSTRAINT alignment_batches_processed_users_nonneg CHECK (processed_users >= 0),
  CONSTRAINT alignment_batches_skipped_users_nonneg CHECK (skipped_users >= 0),
  CONSTRAINT alignment_batches_failed_users_nonneg CHECK (failed_users >= 0),
  CONSTRAINT alignment_batches_user_sum_chk CHECK (
    processed_users + skipped_users + failed_users <= total_users
  ),
  CONSTRAINT alignment_batches_calculation_mode_chk CHECK (
    calculation_mode = 'DELTA_WINDOW_SCORE'
  )
);

CREATE TABLE IF NOT EXISTS public.alignment_history (
  history_id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES public.alignment_batches(batch_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  processed_at timestamptz NOT NULL,
  previous_score numeric(20, 6) NOT NULL,
  next_score numeric(20, 6) NOT NULL,
  score_change numeric(20, 6) NOT NULL,
  previous_signal numeric(20, 6) NOT NULL,
  next_signal numeric(20, 6) NOT NULL,
  cap_applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alignment_history_unique_batch_user UNIQUE (batch_id, user_id),
  CONSTRAINT alignment_history_id_format_chk CHECK (
    history_id = batch_id || '_' || user_id::text
  ),
  CONSTRAINT alignment_history_score_change_chk CHECK (
    score_change = (next_score - previous_score)
  ),
  CONSTRAINT alignment_history_previous_score_finite CHECK (public.alignment_is_finite(previous_score)),
  CONSTRAINT alignment_history_next_score_finite CHECK (public.alignment_is_finite(next_score)),
  CONSTRAINT alignment_history_score_change_finite CHECK (public.alignment_is_finite(score_change)),
  CONSTRAINT alignment_history_previous_signal_finite CHECK (public.alignment_is_finite(previous_signal)),
  CONSTRAINT alignment_history_next_signal_finite CHECK (public.alignment_is_finite(next_signal))
);

CREATE INDEX IF NOT EXISTS idx_user_alignment_state_updated_at
  ON public.user_alignment_state (updated_at);

CREATE INDEX IF NOT EXISTS idx_user_alignment_state_last_processed_batch_id
  ON public.user_alignment_state (last_processed_batch_id);

CREATE INDEX IF NOT EXISTS idx_alignment_batches_processed_at_desc
  ON public.alignment_batches (processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_alignment_history_user_processed_at_desc
  ON public.alignment_history (user_id, processed_at DESC);

ALTER TABLE public.user_alignment_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alignment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_alignment_state_select_own ON public.user_alignment_state;
CREATE POLICY user_alignment_state_select_own
  ON public.user_alignment_state
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS alignment_history_select_own ON public.alignment_history;
CREATE POLICY alignment_history_select_own
  ON public.alignment_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.user_alignment_state TO authenticated;
GRANT SELECT ON public.alignment_history TO authenticated;

-- RPC: apply combinedSignal computed on the server. Caller cannot supply next_score.
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
  v_rec jsonb;
  v_user_id uuid;
  v_combined numeric(20, 6);
  v_score numeric(20, 6);
  v_prev_signal numeric(20, 6);
  v_last_batch text;
  v_raw numeric(20, 6);
  v_capped numeric(20, 6);
  v_next_score numeric(20, 6);
  v_cap numeric(20, 6) := 500;
  v_history_id text;
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
  IF plan ? 'score' OR plan ? 'nextScore' OR plan ? 'cappedDelta' THEN
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
      'batchId', v_batch_id
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
      'batchId', v_batch_id
    );
  END IF;

  FOR v_rec IN SELECT value FROM jsonb_array_elements(plan->'users')
  LOOP
    IF v_rec->>'userId' IS NULL OR v_rec->>'combinedSignal' IS NULL THEN
      RAISE EXCEPTION 'ALIGNMENT_PLAN_USER_INVALID';
    END IF;
    IF v_rec ? 'score' OR v_rec ? 'nextScore' OR v_rec ? 'cappedDelta' OR v_rec ? 'signedDelta' THEN
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

    SELECT score, previous_signal, last_processed_batch_id
      INTO v_score, v_prev_signal, v_last_batch
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
    'totalUsers', v_user_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_alignment_score_batch(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_alignment_score_batch(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_alignment_score_batch(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_alignment_score_batch(jsonb) TO service_role;
