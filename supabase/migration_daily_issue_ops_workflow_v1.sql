-- =============================================================================
-- 데일리 이슈 승인대기 운영 — 예약 재취합 작업 (additive)
-- 기존 review_items / 운영 데이터 삭제·초기화 없음
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.daily_issue_recollect_jobs (
  id text PRIMARY KEY,
  review_item_id text NOT NULL,
  run_key text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz NULL,
  finished_at timestamptz NULL,
  status text NOT NULL,
  delay_minutes integer NOT NULL DEFAULT 0,
  instruction text NOT NULL DEFAULT '',
  origin_method text NOT NULL DEFAULT 'SCHEDULED_RECOLLECT',
  result_version_number integer NULL,
  error_code text NULL,
  error_summary text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT daily_issue_recollect_jobs_run_key_uq UNIQUE (run_key),
  CONSTRAINT daily_issue_recollect_jobs_status_chk CHECK (
    status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT daily_issue_recollect_jobs_delay_pos CHECK (delay_minutes >= 0)
);

CREATE INDEX IF NOT EXISTS daily_issue_recollect_jobs_item_status_idx
  ON public.daily_issue_recollect_jobs (review_item_id, status);

CREATE INDEX IF NOT EXISTS daily_issue_recollect_jobs_due_idx
  ON public.daily_issue_recollect_jobs (scheduled_at)
  WHERE status = 'PENDING';

ALTER TABLE public.daily_issue_recollect_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_issue_recollect_jobs_deny_all ON public.daily_issue_recollect_jobs;
CREATE POLICY daily_issue_recollect_jobs_deny_all
  ON public.daily_issue_recollect_jobs
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.daily_issue_recollect_jobs IS
  '승인대기 Daily Issue 예약 재취합. 만료돼도 자동 공개하지 않음. unique run_key로 중복 실행 방지.';
