-- SentenceArena candidate. NOT APPLIED. Not in the production REQUIRED catalog.
-- Source body: supabase/migration_political_alignment_beta_v1.sql
-- public.apply_alignment_score_batch(jsonb), read in full before this edit.
-- This file does not change the score formula, the 500 cap, territory candidate rules,
-- batch id replay, grants, RLS, or search_path.
-- Added behavior: lock user_legal_consents FOR UPDATE in user-id order, then skip that user when separate
-- consent is not valid at this write. A withdrawal that committed first leaves no new
-- alignment rows. A batch that commits first can still be removed by a later withdrawal.
-- The withdraw function alone does not do this check.

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
  v_lock_id uuid;
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

  -- Lock every consent row in user-id order before any alignment row lock.
  FOR v_lock_id IN
    SELECT DISTINCT (elem->>'userId')::uuid AS lock_user_id
    FROM jsonb_array_elements(plan->'users') AS src(elem)
    WHERE elem->>'userId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY 1
  LOOP
    PERFORM 1
    FROM public.user_legal_consents
    WHERE user_id = v_lock_id
    FOR UPDATE;
  END LOOP;

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

    -- Lock consent before alignment rows. Same first lock as withdraw_sensitive_political_consent.
    PERFORM 1
    FROM public.user_legal_consents
    WHERE user_id = v_user_id
    FOR UPDATE;

    IF NOT EXISTS (
      SELECT 1
      FROM public.user_legal_consents
      WHERE user_id = v_user_id
      AND age_requirement_confirmed_at IS NOT NULL
      AND age_policy_version = 'age-policy-v1'
      AND sensitive_political_consented_at IS NOT NULL
      AND sensitive_political_policy_version = 'sensitive-political-v1'
      AND territory_disclosure_consented_at IS NOT NULL
      AND territory_disclosure_policy_version = 'territory-disclosure-v1'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
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
