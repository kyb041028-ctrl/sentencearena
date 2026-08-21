-- SentenceArena retention policy v1 (additive).
-- No backfill. No existing-row UPDATE/DELETE.
-- Political alignment is not stored.
-- Rights-infringement 5-year desk is policy-only; no dedicated report system.

ALTER TABLE public.board_reports
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz NULL;
ALTER TABLE public.board_reports
  ADD COLUMN IF NOT EXISTS retention_until timestamptz NULL;
ALTER TABLE public.board_reports
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;
ALTER TABLE public.board_reports
  ADD COLUMN IF NOT EXISTS evidence_id uuid NULL;

COMMENT ON COLUMN public.board_reports.finalized_at IS
  '최종 처리 시각. ACCEPTED/REJECTED/RESOLVED. 재오픈 시 NULL.';
COMMENT ON COLUMN public.board_reports.retention_until IS
  '일반 신고 최종 처리일 + 1년. legal_hold면 자동삭제 제외.';

CREATE TABLE IF NOT EXISTS public.deleted_content_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_kind text NOT NULL,
  source_content_id uuid NOT NULL,
  title text NULL,
  body text NOT NULL DEFAULT '',
  authored_at timestamptz NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  delete_reason text NOT NULL DEFAULT 'USER_DELETE',
  author_user_id uuid NULL,
  author_display_name text NULL,
  retention_until timestamptz NOT NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  legal_hold_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deleted_content_evidence_kind_chk CHECK (content_kind IN ('POST', 'COMMENT')),
  CONSTRAINT deleted_content_evidence_reason_chk CHECK (delete_reason IN ('USER_DELETE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deleted_content_evidence_source
  ON public.deleted_content_evidence (content_kind, source_content_id);
CREATE INDEX IF NOT EXISTS idx_deleted_content_evidence_retention
  ON public.deleted_content_evidence (retention_until)
  WHERE legal_hold = false;

COMMENT ON TABLE public.deleted_content_evidence IS
  '사용자 삭제 게시글/댓글 분쟁 대응용 최소 증거. 삭제일+6개월. auth FK 없음(탈퇴 후에도 유지). 정치성향/IP/이메일 원문 미저장.';

ALTER TABLE public.deleted_content_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deleted_content_evidence FROM PUBLIC;
REVOKE ALL ON public.deleted_content_evidence FROM anon;
REVOKE ALL ON public.deleted_content_evidence FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deleted_content_evidence TO service_role;

CREATE TABLE IF NOT EXISTS public.user_sanction_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  sanction_type text NOT NULL,
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  permanent boolean NOT NULL DEFAULT false,
  reason_code text NULL,
  retention_until timestamptz NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_sanction_records_type_chk CHECK (
    sanction_type IN (
      'WARNING',
      'FINAL_WARNING',
      'ALIEN_TRANSFER',
      'WRITE_RESTRICT_24H',
      'ACCOUNT_RESTRICT_7D',
      'ACCOUNT_RESTRICT_30D',
      'TEMP_SUSPEND',
      'PERMANENT_BAN',
      'PERMANENT_REVIEW'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_user_sanction_records_retention
  ON public.user_sanction_records (retention_until)
  WHERE legal_hold = false AND permanent = false;

COMMENT ON TABLE public.user_sanction_records IS
  '일반 제재 종료 후 1년 보관. 영구정지는 계정 유지 중 삭제하지 않음. 정치성향 미저장. auth FK 없음.';

ALTER TABLE public.user_sanction_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_sanction_records FROM PUBLIC;
REVOKE ALL ON public.user_sanction_records FROM anon;
REVOKE ALL ON public.user_sanction_records FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_sanction_records TO service_role;

CREATE TABLE IF NOT EXISTS public.banned_rejoin_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_hash text NOT NULL,
  identity_kind text NOT NULL,
  sanction_type text NOT NULL DEFAULT 'PERMANENT_BAN',
  banned_at timestamptz NULL,
  reason_code text NULL,
  withdrawn_at timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz NOT NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT banned_rejoin_blocks_type_chk CHECK (sanction_type = 'PERMANENT_BAN')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_banned_rejoin_blocks_hash
  ON public.banned_rejoin_blocks (identity_hash);
CREATE INDEX IF NOT EXISTS idx_banned_rejoin_blocks_retention
  ON public.banned_rejoin_blocks (retention_until)
  WHERE legal_hold = false;

COMMENT ON TABLE public.banned_rejoin_blocks IS
  '영구정지 탈퇴자 재가입 방지 최소 해시. 이메일 원문 없음. HMAC(서버 pepper). 탈퇴 후 1년.';

ALTER TABLE public.banned_rejoin_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.banned_rejoin_blocks FROM PUBLIC;
REVOKE ALL ON public.banned_rejoin_blocks FROM anon;
REVOKE ALL ON public.banned_rejoin_blocks FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banned_rejoin_blocks TO service_role;
