-- Phase 19 safety: emergency halt (KR/US), US scheduler run persistence, scheduler lease
-- Apply only to isolated/test schema via tools; not auto-applied to production public.

CREATE TABLE IF NOT EXISTS public.daily_issue_emergency_halt (
  region text PRIMARY KEY,
  halted boolean NOT NULL DEFAULT false,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  lock_version integer NOT NULL DEFAULT 1,
  CONSTRAINT daily_issue_emergency_halt_region_chk CHECK (region IN ('KR', 'US'))
);

CREATE TABLE IF NOT EXISTS public.daily_issue_emergency_halt_audit (
  id bigserial PRIMARY KEY,
  region text NOT NULL,
  action text NOT NULL,
  halted boolean NOT NULL,
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS daily_issue_emergency_halt_audit_region_created_idx
  ON public.daily_issue_emergency_halt_audit (region, created_at DESC);

CREATE TABLE IF NOT EXISTS public.daily_issue_us_scheduler_runs (
  run_key text PRIMARY KEY,
  status text NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  published_count integer NOT NULL DEFAULT 0,
  outcome text,
  error_code text,
  error_summary text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_issue_us_scheduler_runs_status_idx
  ON public.daily_issue_us_scheduler_runs (status, started_at DESC);

ALTER TABLE public.daily_issue_scheduler_runs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS activity_region text;

ALTER TABLE public.daily_issue_emergency_halt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_emergency_halt_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_us_scheduler_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_issue_emergency_halt_deny_all ON public.daily_issue_emergency_halt;
CREATE POLICY daily_issue_emergency_halt_deny_all ON public.daily_issue_emergency_halt FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS daily_issue_emergency_halt_audit_deny_all ON public.daily_issue_emergency_halt_audit;
CREATE POLICY daily_issue_emergency_halt_audit_deny_all ON public.daily_issue_emergency_halt_audit FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS daily_issue_us_scheduler_runs_deny_all ON public.daily_issue_us_scheduler_runs;
CREATE POLICY daily_issue_us_scheduler_runs_deny_all ON public.daily_issue_us_scheduler_runs FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

INSERT INTO public.daily_issue_emergency_halt (region, halted, reason)
VALUES ('KR', false, 'initial'), ('US', false, 'initial')
ON CONFLICT (region) DO NOTHING;
