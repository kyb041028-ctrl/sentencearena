-- =============================================================================
-- 사용자 이벤트 파이프라인 SQL 초안 (미적용)
-- progression · achievement · notification · activity 원자 persist plan
-- =============================================================================

-- 기존 user_progression_events dedupe와 역할 중복 검토:
-- domain event dedupe는 별도 log, progression event는 기존 테이블 재사용

CREATE TABLE IF NOT EXISTS public.user_domain_event_log (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_user_id uuid NULL REFERENCES auth.users(id),
  source_type text NULL,
  source_id text NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz NULL,
  processing_status text NOT NULL DEFAULT 'PENDING',
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_domain_event_log_dedupe_uq UNIQUE (dedupe_key),
  CONSTRAINT user_domain_event_log_status_chk CHECK (
    processing_status IN ('PENDING', 'PROCESSED', 'PARTIAL', 'FAILED', 'SKIPPED_DUPLICATE')
  )
);

CREATE INDEX IF NOT EXISTS idx_user_domain_event_log_user_occurred
  ON public.user_domain_event_log (user_id, occurred_at DESC);

ALTER TABLE public.user_domain_event_log ENABLE ROW LEVEL SECURITY;
-- authenticated INSERT/UPDATE/DELETE 정책 없음

GRANT SELECT ON public.user_domain_event_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_domain_event_log TO service_role;

-- -----------------------------------------------------------------------------
-- RPC: persist_user_event_plan (service_role 전용 · 이번 작업에서 호출 금지)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.persist_user_event_plan(p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_dedupe text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'USER_EVENT_RPC_SERVICE_ROLE_ONLY';
  END IF;

  v_user_id := (p_plan->>'userId')::uuid;
  v_dedupe := NULLIF(p_plan->>'dedupeKey', '');
  IF v_user_id IS NULL OR v_dedupe IS NULL THEN
    RAISE EXCEPTION 'USER_EVENT_PLAN_INVALID';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_domain_event_log WHERE dedupe_key = v_dedupe) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'dedupeKey', v_dedupe);
  END IF;

  INSERT INTO public.user_domain_event_log (
    event_type, user_id, actor_user_id, source_type, source_id,
    dedupe_key, payload, occurred_at, processing_status, schema_version
  ) VALUES (
    COALESCE(p_plan->>'eventType', 'UNKNOWN'),
    v_user_id,
    (p_plan->>'actorUserId')::uuid,
    NULLIF(p_plan->>'sourceType', ''),
    NULLIF(p_plan->>'sourceId', ''),
    v_dedupe,
    COALESCE(p_plan->'payload', '{}'::jsonb),
    COALESCE((p_plan->>'occurredAt')::timestamptz, now()),
    'PENDING',
    COALESCE((p_plan->>'schemaVersion')::integer, 1)
  );

  -- progression / achievements / notifications / activity_events 는
  -- 동일 transaction 내 후속 RPC 호출로 처리 (이번 초안에서는 stub)

  RETURN jsonb_build_object('ok', true, 'userId', v_user_id, 'dedupeKey', v_dedupe, 'note', 'ATOMIC_SUB_STEPS_TODO');
END;
$$;

REVOKE ALL ON FUNCTION public.persist_user_event_plan(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_user_event_plan(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_user_event_plan(jsonb) TO service_role;
