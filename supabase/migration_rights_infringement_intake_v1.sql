-- SentenceArena rights-infringement intake v2 (additive).
-- Attachments + rejection codes. No DROP/TRUNCATE. No Production apply in this task.
-- Files are service_role only. Not exposed via anon/authenticated RLS.

ALTER TABLE public.rights_infringement_requests
  ADD COLUMN IF NOT EXISTS rejection_code text NULL;
ALTER TABLE public.rights_infringement_requests
  ADD COLUMN IF NOT EXISTS public_rejection_note text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rights_infringement_rejection_code_chk'
  ) THEN
    ALTER TABLE public.rights_infringement_requests
      ADD CONSTRAINT rights_infringement_rejection_code_chk CHECK (
        rejection_code IS NULL OR rejection_code IN (
          'TARGET_UNCLEAR',
          'RIGHTS_UNSUBSTANTIATED',
          'EVIDENCE_INSUFFICIENT',
          'POLITICAL_DISAGREEMENT',
          'MERE_DISCOMFORT',
          'REPEAT_SAME',
          'SUSPECTED_FALSE_OR_MALICIOUS',
          'NOT_RIGHTS_USE_GENERAL_REPORT',
          'OTHER'
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.rights_infringement_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NULL REFERENCES public.rights_infringement_requests(id) ON DELETE CASCADE,
  original_filename text NOT NULL,
  content_type text NOT NULL,
  kind text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NULL,
  file_b64 text NOT NULL,
  uploaded_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  CONSTRAINT rights_infringement_att_kind_chk CHECK (
    kind IN ('png', 'jpeg', 'gif', 'webp', 'pdf')
  ),
  CONSTRAINT rights_infringement_att_size_chk CHECK (
    byte_size > 0 AND byte_size <= 5242880
  )
);

CREATE INDEX IF NOT EXISTS idx_rights_infringement_att_request
  ON public.rights_infringement_attachments (request_id, created_at)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rights_infringement_att_staging
  ON public.rights_infringement_attachments (expires_at)
  WHERE request_id IS NULL;

COMMENT ON TABLE public.rights_infringement_attachments IS
  '권리침해 증빙. 공개 게시판 미노출. anon/authenticated 권한 없음. 사건 삭제 시 CASCADE. 5년 정책은 요청 행과 동일.';

ALTER TABLE public.rights_infringement_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_infringement_attachments FROM PUBLIC;
REVOKE ALL ON public.rights_infringement_attachments FROM anon;
REVOKE ALL ON public.rights_infringement_attachments FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rights_infringement_attachments TO service_role;
