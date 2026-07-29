-- =============================================================================
-- 센텐스크래프트 — alignment 운영 저장 시스템 (미적용 마이그레이션)
-- =============================================================================
--
-- 주의:
-- - service-role key는 브라우저에 노출 금지
-- - 이 마이그레이션은 서버 전용 배치 저장을 전제로 함
-- - 일반 사용자는 alignment 값을 직접 수정할 수 없음
-- - 실제 운영 DB에는 이 파일을 검토 후 수동/CI로 적용하세요
-- - 점수/신호 컬럼은 numeric(20,6) — double precision 정확 등식 위험 회피
-- - batch INSERT는 ON CONFLICT DO NOTHING 으로 동시 중복을 skipped 처리
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 유틸: numeric 유한 값 검사 (NaN 거부)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alignment_is_finite(d numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT d IS NOT NULL AND d = d;
$$;

-- -----------------------------------------------------------------------------
-- 1. user_alignment_state
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_alignment_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  score numeric(20, 6) NOT NULL DEFAULT 0,
  current_territory text NOT NULL DEFAULT 'CENTRAL',
  previous_signal numeric(20, 6) NOT NULL DEFAULT 0,
  pending_territory text NULL,
  pending_batch_count integer NOT NULL DEFAULT 0,
  pending_started_at timestamptz NULL,
  last_processed_batch_id text NULL,
  updated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_alignment_state_score_finite CHECK (public.alignment_is_finite(score)),
  CONSTRAINT user_alignment_state_signal_finite CHECK (public.alignment_is_finite(previous_signal)),
  CONSTRAINT user_alignment_state_current_territory_chk CHECK (
    current_territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN')
  ),
  CONSTRAINT user_alignment_state_pending_territory_chk CHECK (
    pending_territory IS NULL OR pending_territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN')
  ),
  CONSTRAINT user_alignment_state_pending_batch_count_nonneg CHECK (pending_batch_count >= 0),
  CONSTRAINT user_alignment_state_pending_null_count_zero CHECK (
    pending_territory IS NULL OR pending_batch_count > 0
  ),
  CONSTRAINT user_alignment_state_pending_count_zero_started_null CHECK (
    pending_batch_count > 0 OR pending_started_at IS NULL
  ),
  CONSTRAINT user_alignment_state_pending_count_positive_fields CHECK (
    pending_batch_count = 0 OR (pending_territory IS NOT NULL AND pending_started_at IS NOT NULL)
  )
);

-- -----------------------------------------------------------------------------
-- 2. alignment_batches
-- -----------------------------------------------------------------------------
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
  territory_changed_users integer NOT NULL DEFAULT 0,
  calculation_mode text NOT NULL DEFAULT 'DELTA_WINDOW_SCORE',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT alignment_batches_status_chk CHECK (
    status IN ('PREPARED', 'PROCESSING', 'COMPLETED', 'PARTIAL_FAILURE', 'FAILED')
  ),
  CONSTRAINT alignment_batches_total_users_nonneg CHECK (total_users >= 0),
  CONSTRAINT alignment_batches_processed_users_nonneg CHECK (processed_users >= 0),
  CONSTRAINT alignment_batches_skipped_users_nonneg CHECK (skipped_users >= 0),
  CONSTRAINT alignment_batches_failed_users_nonneg CHECK (failed_users >= 0),
  CONSTRAINT alignment_batches_territory_changed_users_nonneg CHECK (territory_changed_users >= 0),
  CONSTRAINT alignment_batches_user_sum_chk CHECK (
    processed_users + skipped_users + failed_users <= total_users
  ),
  CONSTRAINT alignment_batches_calculation_mode_chk CHECK (
    calculation_mode = 'DELTA_WINDOW_SCORE'
  )
);

-- -----------------------------------------------------------------------------
-- 3. alignment_history
-- -----------------------------------------------------------------------------
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
  previous_territory text NOT NULL,
  next_territory text NOT NULL,
  territory_changed boolean NOT NULL,
  candidate_territory text NULL,
  pending_territory text NULL,
  pending_batch_count integer NOT NULL DEFAULT 0,
  cap_applied boolean NOT NULL DEFAULT false,
  transition_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT alignment_history_unique_batch_user UNIQUE (batch_id, user_id),
  CONSTRAINT alignment_history_id_format_chk CHECK (
    history_id = batch_id || '_' || user_id::text
  ),
  CONSTRAINT alignment_history_score_change_chk CHECK (
    score_change = (next_score - previous_score)
  ),
  CONSTRAINT alignment_history_territory_changed_chk CHECK (
    territory_changed = (previous_territory <> next_territory)
  ),
  CONSTRAINT alignment_history_previous_score_finite CHECK (public.alignment_is_finite(previous_score)),
  CONSTRAINT alignment_history_next_score_finite CHECK (public.alignment_is_finite(next_score)),
  CONSTRAINT alignment_history_score_change_finite CHECK (public.alignment_is_finite(score_change)),
  CONSTRAINT alignment_history_previous_signal_finite CHECK (public.alignment_is_finite(previous_signal)),
  CONSTRAINT alignment_history_next_signal_finite CHECK (public.alignment_is_finite(next_signal)),
  CONSTRAINT alignment_history_previous_territory_chk CHECK (
    previous_territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN')
  ),
  CONSTRAINT alignment_history_next_territory_chk CHECK (
    next_territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN')
  ),
  CONSTRAINT alignment_history_candidate_territory_chk CHECK (
    candidate_territory IS NULL OR candidate_territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN')
  ),
  CONSTRAINT alignment_history_pending_territory_chk CHECK (
    pending_territory IS NULL OR pending_territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN')
  ),
  CONSTRAINT alignment_history_pending_batch_count_nonneg CHECK (pending_batch_count >= 0)
);

-- -----------------------------------------------------------------------------
-- 4. 인덱스
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_alignment_state_updated_at
  ON public.user_alignment_state (updated_at);

CREATE INDEX IF NOT EXISTS idx_user_alignment_state_last_processed_batch_id
  ON public.user_alignment_state (last_processed_batch_id);

CREATE INDEX IF NOT EXISTS idx_alignment_batches_processed_at_desc
  ON public.alignment_batches (processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_alignment_batches_status_processed_at_desc
  ON public.alignment_batches (status, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_alignment_history_user_processed_at_desc
  ON public.alignment_history (user_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_alignment_history_batch_id
  ON public.alignment_history (batch_id);

CREATE INDEX IF NOT EXISTS idx_alignment_history_next_territory_processed_at_desc
  ON public.alignment_history (next_territory, processed_at DESC);

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
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

-- alignment_batches: 일반 사용자 정책 없음 (RLS 기본 거부)

GRANT SELECT ON public.user_alignment_state TO authenticated;
GRANT SELECT ON public.alignment_history TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. RPC: persist_alignment_batch_plan
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.persist_alignment_batch_plan(plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id text;
  v_existing text;
  v_batch_record jsonb;
  v_user_updates jsonb;
  v_history_records jsonb;
  v_user_count integer := 0;
  v_history_count integer := 0;
  v_inserted integer := 0;
  v_rec jsonb;
  v_alignment jsonb;
  v_user_id uuid;
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

  IF plan->'batchRecord' IS NULL OR jsonb_typeof(plan->'batchRecord') <> 'object' THEN
    RAISE EXCEPTION 'ALIGNMENT_PLAN_BATCH_RECORD_INVALID';
  END IF;

  IF plan->'userUpdates' IS NULL OR jsonb_typeof(plan->'userUpdates') <> 'array' THEN
    RAISE EXCEPTION 'ALIGNMENT_PLAN_UPDATES_ARRAY_REQUIRED';
  END IF;

  IF plan->'historyRecords' IS NULL OR jsonb_typeof(plan->'historyRecords') <> 'array' THEN
    RAISE EXCEPTION 'ALIGNMENT_PLAN_HISTORY_ARRAY_REQUIRED';
  END IF;

  v_batch_id := plan->>'batchId';
  v_batch_record := plan->'batchRecord';
  v_user_updates := plan->'userUpdates';
  v_history_records := plan->'historyRecords';

  SELECT batch_id INTO v_existing
  FROM public.alignment_batches
  WHERE batch_id = v_batch_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'committed', false,
      'skipReason', 'ALIGNMENT_BATCH_ALREADY_PERSISTED',
      'batchId', v_batch_id
    );
  END IF;

  -- 동시 실행: PK 충돌 시 사용자 상태/이력 저장으로 진행하지 않음
  INSERT INTO public.alignment_batches (
    batch_id,
    scheduled_at,
    processed_at,
    completed_at,
    status,
    total_users,
    processed_users,
    skipped_users,
    failed_users,
    territory_changed_users,
    calculation_mode
  ) VALUES (
    v_batch_id,
    COALESCE((v_batch_record->>'scheduledAt')::timestamptz, (plan->>'processedAt')::timestamptz),
    COALESCE((v_batch_record->>'processedAt')::timestamptz, (plan->>'processedAt')::timestamptz),
    NULL,
    'PROCESSING',
    COALESCE((v_batch_record->>'totalUsers')::integer, 0),
    COALESCE((v_batch_record->>'processedUsers')::integer, 0),
    COALESCE((v_batch_record->>'skippedUsers')::integer, 0),
    COALESCE((v_batch_record->>'failedUsers')::integer, 0),
    COALESCE((v_batch_record->>'territoryChangedUsers')::integer, 0),
    COALESCE(v_batch_record->>'calculationMode', 'DELTA_WINDOW_SCORE')
  )
  ON CONFLICT (batch_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'committed', false,
      'skipReason', 'ALIGNMENT_BATCH_ALREADY_PERSISTED',
      'batchId', v_batch_id
    );
  END IF;

  FOR v_rec IN SELECT value FROM jsonb_array_elements(v_user_updates)
  LOOP
    IF v_rec->>'userId' IS NULL THEN
      RAISE EXCEPTION 'ALIGNMENT_PLAN_UPDATE_INVALID';
    END IF;

    v_user_id := (v_rec->>'userId')::uuid;
    v_alignment := v_rec->'update'->'alignment';

    IF v_alignment IS NULL THEN
      RAISE EXCEPTION 'ALIGNMENT_PLAN_UPDATE_INVALID';
    END IF;

    INSERT INTO public.user_alignment_state (
      user_id,
      score,
      current_territory,
      previous_signal,
      pending_territory,
      pending_batch_count,
      pending_started_at,
      last_processed_batch_id,
      updated_at
    ) VALUES (
      v_user_id,
      COALESCE((v_alignment->>'score')::numeric(20, 6), 0),
      COALESCE(v_alignment->>'currentTerritory', 'CENTRAL'),
      COALESCE((v_alignment->>'previousSignal')::numeric(20, 6), 0),
      NULLIF(v_alignment->>'pendingTerritory', 'null')::text,
      COALESCE((v_alignment->>'pendingBatchCount')::integer, 0),
      CASE
        WHEN v_alignment->>'pendingStartedAt' IS NULL OR v_alignment->>'pendingStartedAt' = 'null' THEN NULL
        ELSE (v_alignment->>'pendingStartedAt')::timestamptz
      END,
      v_alignment->>'lastProcessedBatchId',
      CASE
        WHEN v_alignment->>'updatedAt' IS NULL OR v_alignment->>'updatedAt' = 'null' THEN (plan->>'processedAt')::timestamptz
        ELSE (v_alignment->>'updatedAt')::timestamptz
      END
    )
    ON CONFLICT (user_id) DO UPDATE SET
      score = EXCLUDED.score,
      current_territory = EXCLUDED.current_territory,
      previous_signal = EXCLUDED.previous_signal,
      pending_territory = EXCLUDED.pending_territory,
      pending_batch_count = EXCLUDED.pending_batch_count,
      pending_started_at = EXCLUDED.pending_started_at,
      last_processed_batch_id = EXCLUDED.last_processed_batch_id,
      updated_at = EXCLUDED.updated_at;

    v_user_count := v_user_count + 1;
  END LOOP;

  FOR v_rec IN SELECT value FROM jsonb_array_elements(v_history_records)
  LOOP
    IF v_rec->>'batchId' IS NULL OR v_rec->>'userId' IS NULL THEN
      RAISE EXCEPTION 'ALIGNMENT_PLAN_HISTORY_INVALID';
    END IF;

    v_user_id := (v_rec->>'userId')::uuid;
    v_history_id := v_rec->>'batchId' || '_' || v_user_id::text;

    -- history unique/check 오류는 batch 중복으로 오인하지 않고 전체 rollback
    INSERT INTO public.alignment_history (
      history_id,
      batch_id,
      user_id,
      processed_at,
      previous_score,
      next_score,
      score_change,
      previous_signal,
      next_signal,
      previous_territory,
      next_territory,
      territory_changed,
      candidate_territory,
      pending_territory,
      pending_batch_count,
      cap_applied,
      transition_reason
    ) VALUES (
      v_history_id,
      v_rec->>'batchId',
      v_user_id,
      (v_rec->>'processedAt')::timestamptz,
      (v_rec->>'previousScore')::numeric(20, 6),
      (v_rec->>'nextScore')::numeric(20, 6),
      (v_rec->>'scoreChange')::numeric(20, 6),
      (v_rec->>'previousSignal')::numeric(20, 6),
      (v_rec->>'nextSignal')::numeric(20, 6),
      v_rec->>'previousTerritory',
      v_rec->>'nextTerritory',
      COALESCE((v_rec->>'territoryChanged')::boolean, false),
      NULLIF(v_rec->>'candidateTerritory', 'null'),
      NULLIF(v_rec->>'pendingTerritory', 'null'),
      COALESCE((v_rec->>'pendingBatchCount')::integer, 0),
      COALESCE((v_rec->>'capApplied')::boolean, false),
      v_rec->>'transitionReason'
    );

    v_history_count := v_history_count + 1;
  END LOOP;

  UPDATE public.alignment_batches
  SET
    status = COALESCE(v_batch_record->>'status', 'COMPLETED'),
    completed_at = COALESCE((v_batch_record->>'completedAt')::timestamptz, (plan->>'processedAt')::timestamptz),
    total_users = COALESCE((v_batch_record->>'totalUsers')::integer, 0),
    processed_users = COALESCE((v_batch_record->>'processedUsers')::integer, 0),
    skipped_users = COALESCE((v_batch_record->>'skippedUsers')::integer, 0),
    failed_users = COALESCE((v_batch_record->>'failedUsers')::integer, 0),
    territory_changed_users = COALESCE((v_batch_record->>'territoryChangedUsers')::integer, 0)
  WHERE batch_id = v_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'skipped', false,
    'committed', true,
    'batchId', v_batch_id,
    'userUpdateCount', v_user_count,
    'historyRecordCount', v_history_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_alignment_batch_plan(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_alignment_batch_plan(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.persist_alignment_batch_plan(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.persist_alignment_batch_plan(jsonb) TO service_role;
