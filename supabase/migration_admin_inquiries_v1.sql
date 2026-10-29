-- 문의·피드백 관리자 처리 표 (후보, 운영 미적용).
-- 이 파일은 관리자 처리 화면용입니다. 회원/비회원 접수 경로는 만들지 않습니다.
-- 접수 보관기간·비회원 접수 정책이 확정되기 전에는 접수 코드가 없습니다.
-- 이메일, 외부 고객센터 연동 없음. IP, 기기 지문, 정치성향 연계 없음.

CREATE TABLE IF NOT EXISTS public.admin_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'RECEIVED',
  internal_note text NULL,
  author_user_id uuid NULL,
  content_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT admin_inquiries_kind_chk CHECK (kind IN ('BUG', 'IMPROVEMENT', 'GENERAL')),
  CONSTRAINT admin_inquiries_status_chk CHECK (status IN ('RECEIVED', 'IN_PROGRESS', 'DONE', 'ON_HOLD')),
  CONSTRAINT admin_inquiries_title_len_chk CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT admin_inquiries_note_len_chk CHECK (internal_note IS NULL OR char_length(internal_note) <= 2000)
);

ALTER TABLE public.admin_inquiries ADD COLUMN IF NOT EXISTS content_hash text NULL;

CREATE INDEX IF NOT EXISTS idx_admin_inquiries_author_created
  ON public.admin_inquiries (author_user_id, created_at DESC)
  WHERE author_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_inquiries_open_dup
  ON public.admin_inquiries (author_user_id, content_hash)
  WHERE author_user_id IS NOT NULL AND content_hash IS NOT NULL AND status <> 'DONE';

CREATE INDEX IF NOT EXISTS idx_admin_inquiries_status_created
  ON public.admin_inquiries (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_inquiry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES public.admin_inquiries (id),
  actor_user_id uuid NULL,
  event_type text NOT NULL,
  from_status text NULL,
  to_status text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_inquiry_events_type_chk CHECK (event_type IN ('STATUS_CHANGED', 'NOTE_UPDATED'))
);

CREATE INDEX IF NOT EXISTS idx_admin_inquiry_events_inquiry
  ON public.admin_inquiry_events (inquiry_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_inquiry_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ADMIN_INQUIRY_EVENTS_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_inquiry_events_append_only ON public.admin_inquiry_events;
CREATE TRIGGER trg_admin_inquiry_events_append_only
BEFORE UPDATE OR DELETE ON public.admin_inquiry_events
FOR EACH ROW
EXECUTE PROCEDURE public.admin_inquiry_events_append_only();

ALTER TABLE public.admin_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_inquiry_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_inquiries FROM anon, authenticated;
REVOKE ALL ON public.admin_inquiry_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_inquiries TO service_role;
GRANT SELECT, INSERT ON public.admin_inquiry_events TO service_role;
