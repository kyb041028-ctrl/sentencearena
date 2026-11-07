-- 운영 공지 (후보, 미적용). 공식글(board_posts.is_official)과 별도 표입니다.
-- 공지 유형과 노출 기간만 담습니다. 게시판 목록과 Daily Issue에는 섞이지 않습니다.
-- 노출 여부는 DB 서버 시각(now())으로만 판단합니다. 별도 예약 실행기는 없습니다.
-- 삭제 권한은 주지 않습니다. 끝낸 공지는 ends_at 으로 닫습니다.

CREATE TABLE IF NOT EXISTS public.admin_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_type text NOT NULL DEFAULT 'GENERAL',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  is_public boolean NOT NULL DEFAULT false,
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT admin_notices_type_chk CHECK (notice_type IN ('GENERAL', 'MAINTENANCE', 'INCIDENT', 'UPDATE')),
  CONSTRAINT admin_notices_title_len_chk CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT admin_notices_body_len_chk CHECK (char_length(body) <= 4000),
  CONSTRAINT admin_notices_period_chk CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_admin_notices_public_period
  ON public.admin_notices (is_public, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.admin_notice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id uuid NOT NULL REFERENCES public.admin_notices (id),
  actor_user_id uuid NULL,
  event_type text NOT NULL,
  from_public boolean NULL,
  to_public boolean NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_notice_events_type_chk CHECK (event_type IN ('CREATED', 'UPDATED', 'VISIBILITY_CHANGED', 'ENDED'))
);

CREATE INDEX IF NOT EXISTS idx_admin_notice_events_notice
  ON public.admin_notice_events (notice_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_notice_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ADMIN_NOTICE_EVENTS_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_notice_events_append_only ON public.admin_notice_events;
CREATE TRIGGER trg_admin_notice_events_append_only
BEFORE UPDATE OR DELETE ON public.admin_notice_events
FOR EACH ROW
EXECUTE PROCEDURE public.admin_notice_events_append_only();

ALTER TABLE public.admin_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notice_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_notices FROM anon, authenticated;
REVOKE ALL ON public.admin_notice_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_notices TO service_role;
GRANT SELECT, INSERT ON public.admin_notice_events TO service_role;
