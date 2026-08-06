-- =============================================================================
-- 데일리 이슈 아침판 스케줄러 실행 이력 (additive)
-- apply: tools/apply-daily-issue-review-migration.js 와 동일 rewriteSchema 패턴
-- 또는 tools/apply-daily-issue-morning-scheduler-migration.js
-- 운영 public 자동 적용 금지. daily_issue_test 권장.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.daily_issue_scheduler_runs (
  run_key text PRIMARY KEY,
  run_type text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  status text NOT NULL,
  collected_source_count integer NOT NULL DEFAULT 0,
  candidate_count integer NOT NULL DEFAULT 0,
  auto_eligible_count integer NOT NULL DEFAULT 0,
  auto_published_count integer NOT NULL DEFAULT 0,
  manual_review_count integer NOT NULL DEFAULT 0,
  skipped_duplicate_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_summary text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_issue_scheduler_runs_type_chk CHECK (run_type IN ('COLLECT', 'PUBLISH')),
  CONSTRAINT daily_issue_scheduler_runs_status_chk CHECK (
    status IN (
      'STARTED',
      'SUCCESS',
      'PARTIAL_SUCCESS',
      'FAILED',
      'SKIPPED_DUPLICATE',
      'MISSED',
      'BLOCKED'
    )
  )
);

CREATE INDEX IF NOT EXISTS daily_issue_scheduler_runs_type_started_idx
  ON public.daily_issue_scheduler_runs (run_type, started_at DESC);

CREATE INDEX IF NOT EXISTS daily_issue_scheduler_runs_status_idx
  ON public.daily_issue_scheduler_runs (status);

-- RLS: deny anon/authenticated direct access (service role / server only)
ALTER TABLE public.daily_issue_scheduler_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_issue_scheduler_runs_deny_all ON public.daily_issue_scheduler_runs;
CREATE POLICY daily_issue_scheduler_runs_deny_all
  ON public.daily_issue_scheduler_runs
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
