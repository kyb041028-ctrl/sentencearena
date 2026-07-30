-- =============================================================================
-- 센텐스크래프트 — 외계 moderation / 관측 / 랭크 시스템 SQL 초안
-- 파일: supabase/migration_alien_system.sql
-- 중요: 실제 DB에 적용하지 않는다. 자동 판정·scheduler 없음.
-- 운영 ID는 ALIEN만 사용 (레거시 구명칭 enum 금지)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. public.user_moderation_state
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_moderation_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'EARTH',
  alien_strike_count integer NOT NULL DEFAULT 0,
  alien_origin_territory text NULL,
  origin_captured_at timestamptz NULL,
  origin_source text NULL,
  entered_at timestamptz NULL,
  release_eligible_at timestamptz NULL,
  season_release_key text NULL,
  operator_hold boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_moderation_state_status_chk CHECK (
    status IN ('EARTH', 'ALIEN_ACTIVE', 'RETURN_ELIGIBLE', 'RETURNED', 'SUSPENDED', 'UNAVAILABLE')
  ),
  CONSTRAINT user_moderation_state_strike_nonneg CHECK (alien_strike_count >= 0),
  CONSTRAINT user_moderation_state_origin_chk CHECK (
    alien_origin_territory IS NULL OR alien_origin_territory IN ('PIONEER', 'GUARDIAN', 'CENTRAL', 'UNKNOWN')
  ),
  CONSTRAINT user_moderation_state_origin_source_chk CHECK (
    origin_source IS NULL OR origin_source IN ('MODERATION_TRANSFER_SNAPSHOT', 'EXISTING_HISTORY', 'LEGACY_MOCK', 'UNAVAILABLE')
  ),
  CONSTRAINT user_moderation_state_alien_requires_entered CHECK (
    status NOT IN ('ALIEN_ACTIVE', 'RETURN_ELIGIBLE') OR entered_at IS NOT NULL
  )
);

COMMENT ON TABLE public.user_moderation_state IS
  '행동 moderation 상태. alignment score와 분리. 자동 판정 공식 없음.';

-- 출신 성향 snapshot은 ALIEN 이동 시점 기준으로만 보존 (추정 금지).

ALTER TABLE public.user_moderation_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_moderation_state_select_self ON public.user_moderation_state;
CREATE POLICY user_moderation_state_select_self
  ON public.user_moderation_state FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE: policy 없음 → authenticated deny. service_role RLS bypass.

GRANT SELECT ON public.user_moderation_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_moderation_state TO service_role;

-- -----------------------------------------------------------------------------
-- 1-b. public.alien_observation_threads (원문 참조형 관측 스레드)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alien_observation_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_post_id uuid NOT NULL REFERENCES public.board_posts(id) ON DELETE CASCADE,
  observation_type text NOT NULL,
  source_territory text NOT NULL,
  source_category_key text NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  alien_comment_count integer NOT NULL DEFAULT 0,
  alien_reaction_count integer NOT NULL DEFAULT 0,
  last_alien_activity_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alien_observation_threads_type_chk CHECK (
    observation_type IN ('POPULAR', 'CENTRAL', 'TERRITORY')
  ),
  CONSTRAINT alien_observation_threads_status_chk CHECK (
    status IN ('ACTIVE', 'SOURCE_DELETED', 'SOURCE_BLINDED', 'SOURCE_PRIVATE')
  ),
  CONSTRAINT alien_observation_threads_source_territory_chk CHECK (
    source_territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN')
  ),
  CONSTRAINT alien_observation_threads_source_type_uq UNIQUE (source_post_id, observation_type)
);

COMMENT ON TABLE public.alien_observation_threads IS
  '원문 복제 금지. source_post_id 참조형 외계 관측 스레드.';

ALTER TABLE public.alien_observation_threads ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.alien_observation_threads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alien_observation_threads TO service_role;

-- -----------------------------------------------------------------------------
-- 2. public.user_moderation_events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}',
  source_type text NOT NULL,
  source_id text NULL,
  strike_before integer NOT NULL,
  strike_after integer NOT NULL,
  previous_status text NOT NULL,
  next_status text NOT NULL,
  entered_at timestamptz NULL,
  release_eligible_at timestamptz NULL,
  season_release_key text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_moderation_events_type_chk CHECK (
    event_type IN (
      'WARNING_ISSUED',
      'ALIEN_TRANSFERRED',
      'RETURN_ELIGIBLE',
      'RETURNED',
      'PENALTY_EXTENDED',
      'OPERATOR_ASSIGNED',
      'OPERATOR_RELEASED'
    )
  ),
  CONSTRAINT user_moderation_events_source_chk CHECK (
    source_type IN ('REPORT_REVIEW', 'BEHAVIOR_SIGNAL', 'OPERATOR', 'SYSTEM', 'SEASON_END')
  ),
  CONSTRAINT user_moderation_events_strike_nonneg CHECK (
    strike_before >= 0 AND strike_after >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_user_moderation_events_user_created
  ON public.user_moderation_events (user_id, created_at DESC);

ALTER TABLE public.user_moderation_events ENABLE ROW LEVEL SECURITY;
-- 일반 사용자 SELECT/INSERT 정책 없음 (기본 금지). 공개 View는 후속.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_moderation_events TO service_role;

-- -----------------------------------------------------------------------------
-- 3. public.moderation_signals
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moderation_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  source_type text NOT NULL,
  source_id text NULL,
  weight numeric NULL,
  occurred_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT moderation_signals_type_chk CHECK (
    signal_type IN (
      'REPORT_ACCEPTED',
      'CONFLICT_BAITING',
      'SPAM',
      'FLOODING',
      'HEATED_BEHAVIOR',
      'REPEATED_CONFLICT',
      'OPERATOR_FLAG'
    )
  ),
  CONSTRAINT moderation_signals_status_chk CHECK (
    status IN ('PENDING', 'REVIEWED', 'DISMISSED', 'APPLIED')
  )
);

COMMENT ON TABLE public.moderation_signals IS
  '자동 판정 전 신호 저장. weight 공식·threshold·scheduler 없음. 신고 수 단독 transfer 금지.';

CREATE INDEX IF NOT EXISTS idx_moderation_signals_target_occurred
  ON public.moderation_signals (target_user_id, occurred_at DESC);

ALTER TABLE public.moderation_signals ENABLE ROW LEVEL SECURITY;
-- authenticated 전면 금지. board_reports와 자동 동일시하지 않음.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.moderation_signals TO service_role;

-- -----------------------------------------------------------------------------
-- 4. board_comments.audience_scope (기존 테이블 확장 — 신규 alien_comments 금지)
-- -----------------------------------------------------------------------------
ALTER TABLE public.board_comments
  ADD COLUMN IF NOT EXISTS audience_scope text NOT NULL DEFAULT 'EARTH';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_comments_audience_scope_chk'
  ) THEN
    ALTER TABLE public.board_comments
      ADD CONSTRAINT board_comments_audience_scope_chk
      CHECK (audience_scope IN ('EARTH', 'ALIEN'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_board_comments_post_scope_created
  ON public.board_comments (post_id, audience_scope, created_at ASC);

-- -----------------------------------------------------------------------------
-- 5. 외계 자유광장 — board_posts territory=ALIEN + category_key 재사용
--    별도 alien_posts 테이블 없음
-- -----------------------------------------------------------------------------
-- category_key 예: ALIEN_FREE_PLAZA / ALIEN_PIONEER_ZONE / ALIEN_GUARDIAN_ZONE
-- audience는 territory ALIEN + 접근 제어로 처리

-- -----------------------------------------------------------------------------
-- 6. public.alien_weekly_legends (이력 영구 보존 — 선출 실행 금지)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alien_weekly_legends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank_position integer NOT NULL,
  score numeric NOT NULL,
  calculation_version text NOT NULL,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT alien_weekly_legends_week_user_uq UNIQUE (week_key, user_id),
  CONSTRAINT alien_weekly_legends_week_pos_uq UNIQUE (week_key, rank_position),
  CONSTRAINT alien_weekly_legends_rank_pos_pos CHECK (rank_position >= 1)
);

COMMENT ON TABLE public.alien_weekly_legends IS
  '외계 주간 인기인 이력. 삭제 금지 정책. 점수 공식·scheduler 미구현.';

ALTER TABLE public.alien_weekly_legends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alien_weekly_legends_select_auth ON public.alien_weekly_legends;
CREATE POLICY alien_weekly_legends_select_auth
  ON public.alien_weekly_legends FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.alien_weekly_legends TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alien_weekly_legends TO service_role;

-- -----------------------------------------------------------------------------
-- 7. RPC: persist_alien_transfer_plan (service_role 전용 · 이번 작업에서 호출 금지)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.persist_alien_transfer_plan(p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_strike_before integer;
  v_strike_after integer;
  v_entered_at timestamptz;
  v_release timestamptz;
  v_season_key text;
  v_prev text;
  v_reason text[];
  v_source text;
  v_source_id text;
  v_row public.user_moderation_state%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ALIEN_RPC_SERVICE_ROLE_ONLY';
  END IF;

  v_user_id := (p_plan->>'userId')::uuid;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ALIEN_USER_REQUIRED';
  END IF;

  SELECT * INTO v_row
  FROM public.user_moderation_state
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.user_moderation_state (user_id, status, alien_strike_count)
    VALUES (v_user_id, 'EARTH', 0)
    RETURNING * INTO v_row;
  END IF;

  v_strike_before := v_row.alien_strike_count;
  v_strike_after := v_strike_before + 1;
  v_entered_at := COALESCE((p_plan->>'enteredAt')::timestamptz, now());
  v_release := (p_plan->>'releaseEligibleAt')::timestamptz;
  v_season_key := NULLIF(p_plan->>'seasonReleaseKey', '');
  v_prev := v_row.status;
  v_reason := COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_plan->'reasonCodes', '[]'::jsonb))),
    '{}'::text[]
  );
  v_source := COALESCE(NULLIF(p_plan->>'sourceType', ''), 'OPERATOR');
  v_source_id := NULLIF(p_plan->>'sourceId', '');

  -- 멱등: 동일 source_id 의 ALIEN_TRANSFERRED 가 있으면 기존 상태 반환
  IF v_source_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_moderation_events e
    WHERE e.user_id = v_user_id
      AND e.event_type = 'ALIEN_TRANSFERRED'
      AND e.source_id = v_source_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'userId', v_user_id);
  END IF;

  UPDATE public.user_moderation_state
  SET
    status = 'ALIEN_ACTIVE',
    alien_strike_count = v_strike_after,
    entered_at = v_entered_at,
    release_eligible_at = v_release,
    season_release_key = v_season_key,
    updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO public.user_moderation_events (
    user_id, event_type, reason_codes, source_type, source_id,
    strike_before, strike_after, previous_status, next_status,
    entered_at, release_eligible_at, season_release_key, metadata
  ) VALUES (
    v_user_id, 'ALIEN_TRANSFERRED', v_reason, v_source, v_source_id,
    v_strike_before, v_strike_after, v_prev, 'ALIEN_ACTIVE',
    v_entered_at, v_release, v_season_key,
    COALESCE(p_plan->'metadata', '{}'::jsonb)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'userId', v_user_id,
    'strikeBefore', v_strike_before,
    'strikeAfter', v_strike_after,
    'releaseEligibleAt', v_release
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. RPC: persist_alien_return_plan
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.persist_alien_return_plan(p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_row public.user_moderation_state%ROWTYPE;
  v_prev text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ALIEN_RPC_SERVICE_ROLE_ONLY';
  END IF;

  v_user_id := (p_plan->>'userId')::uuid;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ALIEN_USER_REQUIRED';
  END IF;

  SELECT * INTO v_row
  FROM public.user_moderation_state
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALIEN_STATE_NOT_FOUND';
  END IF;

  IF v_row.operator_hold THEN
    RAISE EXCEPTION 'ALIEN_OPERATOR_HOLD';
  END IF;

  IF v_row.status NOT IN ('ALIEN_ACTIVE', 'RETURN_ELIGIBLE') THEN
    RAISE EXCEPTION 'ALIEN_NOT_IN_ALIEN_STATUS';
  END IF;

  -- 시즌/일수 검증은 서버 plan에서 수행 후 호출. RPC는 hold·상태만 재확인.
  IF COALESCE((p_plan->>'force')::boolean, false) IS NOT TRUE THEN
    IF v_row.release_eligible_at IS NOT NULL AND v_row.release_eligible_at > now() THEN
      RAISE EXCEPTION 'ALIEN_NOT_YET_ELIGIBLE';
    END IF;
    IF v_row.alien_strike_count >= 4 AND v_row.season_release_key IS NULL
       AND (p_plan->>'seasonEndSatisfied') IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'ALIEN_SEASON_RELEASE_PENDING';
    END IF;
  END IF;

  v_prev := v_row.status;

  UPDATE public.user_moderation_state
  SET
    status = 'RETURNED',
    entered_at = NULL,
    release_eligible_at = NULL,
    season_release_key = NULL,
    updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO public.user_moderation_events (
    user_id, event_type, reason_codes, source_type, source_id,
    strike_before, strike_after, previous_status, next_status, metadata
  ) VALUES (
    v_user_id, 'RETURNED', '{}', COALESCE(NULLIF(p_plan->>'sourceType', ''), 'SYSTEM'),
    NULLIF(p_plan->>'sourceId', ''),
    v_row.alien_strike_count, v_row.alien_strike_count, v_prev, 'RETURNED',
    COALESCE(p_plan->'metadata', '{}'::jsonb)
  );

  RETURN jsonb_build_object('ok', true, 'userId', v_user_id, 'nextStatus', 'RETURNED');
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. RPC: mark_alien_return_eligible
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_alien_return_eligible(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_row public.user_moderation_state%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ALIEN_RPC_SERVICE_ROLE_ONLY';
  END IF;

  v_user_id := (p_input->>'userId')::uuid;
  SELECT * INTO v_row FROM public.user_moderation_state WHERE user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALIEN_STATE_NOT_FOUND';
  END IF;
  IF v_row.operator_hold THEN
    RAISE EXCEPTION 'ALIEN_OPERATOR_HOLD';
  END IF;
  IF v_row.status <> 'ALIEN_ACTIVE' THEN
    RAISE EXCEPTION 'ALIEN_NOT_ACTIVE';
  END IF;

  UPDATE public.user_moderation_state
  SET status = 'RETURN_ELIGIBLE', updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO public.user_moderation_events (
    user_id, event_type, reason_codes, source_type,
    strike_before, strike_after, previous_status, next_status
  ) VALUES (
    v_user_id, 'RETURN_ELIGIBLE', '{}', 'SYSTEM',
    v_row.alien_strike_count, v_row.alien_strike_count, 'ALIEN_ACTIVE', 'RETURN_ELIGIBLE'
  );

  RETURN jsonb_build_object('ok', true, 'userId', v_user_id, 'nextStatus', 'RETURN_ELIGIBLE');
END;
$$;

REVOKE ALL ON FUNCTION public.persist_alien_transfer_plan(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_alien_transfer_plan(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_alien_transfer_plan(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.persist_alien_return_plan(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_alien_return_plan(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_alien_return_plan(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.mark_alien_return_eligible(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_alien_return_eligible(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_alien_return_eligible(jsonb) TO service_role;

-- 신고 수 단독으로 transfer를 호출하는 트리거/함수 없음 (의도적).
