-- SentenceArena misinfo report extras (additive).
-- Does not alter board_reports reason_code list or existing report rows.
-- No IP / alignment columns. Reporter contact is not stored here.

CREATE TABLE IF NOT EXISTS public.misinfo_report_abuse_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  warning_count integer NOT NULL DEFAULT 0,
  restriction_kind text NOT NULL DEFAULT 'NONE',
  restricted_until timestamptz NULL,
  notice_reason text NULL,
  appeal_status text NULL,
  appeal_body text NULL,
  appeal_reply text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT misinfo_report_abuse_restriction_chk CHECK (
    restriction_kind IN ('NONE', 'DAYS_30', 'MONTHS_6')
  )
);

COMMENT ON TABLE public.misinfo_report_abuse_state IS
  '허위정보 신고 기능 악용 제한. 일반 신고 전체·권리침해 요청과 분리. 정치성향 미저장.';

ALTER TABLE public.misinfo_report_abuse_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.misinfo_report_abuse_state FROM PUBLIC;
REVOKE ALL ON public.misinfo_report_abuse_state FROM anon;
REVOKE ALL ON public.misinfo_report_abuse_state FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.misinfo_report_abuse_state TO service_role;
