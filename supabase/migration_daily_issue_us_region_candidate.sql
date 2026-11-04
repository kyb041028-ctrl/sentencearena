-- =============================================================================
-- CANDIDATE ONLY. Do not apply to production.
-- 기존 데일리 이슈 표에 지역 칸만 더한다. NULL 은 한국 호환이다.
-- 기존 행을 일괄 변경하지 않는다. 미국 자동 발행을 켜지 않는다.
-- =============================================================================

ALTER TABLE public.daily_issue_review_items
  ADD COLUMN IF NOT EXISTS activity_region text NULL;

ALTER TABLE public.daily_issue_comments
  ADD COLUMN IF NOT EXISTS activity_region text NULL;

ALTER TABLE public.daily_issue_reactions
  ADD COLUMN IF NOT EXISTS activity_region text NULL;

ALTER TABLE public.daily_issue_scheduler_runs
  ADD COLUMN IF NOT EXISTS activity_region text NULL;

-- 값 제한만 추가한다. 기존 NULL 행은 그대로 둔다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_issue_review_items_activity_region_chk'
  ) THEN
    ALTER TABLE public.daily_issue_review_items
      ADD CONSTRAINT daily_issue_review_items_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
END $$;
