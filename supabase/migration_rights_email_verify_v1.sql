-- SentenceArena guest rights-infringement email verification (additive).
-- Stores HMAC hashes only. No plaintext email, code, IP, or alignment.
-- Do not apply to Production until a real mail sender is configured.

CREATE TABLE IF NOT EXISTS public.rights_email_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash text NOT NULL,
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  fail_count integer NOT NULL DEFAULT 0,
  verified_at timestamptz NULL,
  consumed_at timestamptz NULL,
  CONSTRAINT rights_email_challenges_email_hash_uq UNIQUE (email_hash)
);

CREATE INDEX IF NOT EXISTS idx_rights_email_challenges_expires
  ON public.rights_email_challenges (expires_at);

COMMENT ON TABLE public.rights_email_challenges IS
  '비회원 권리침해 이메일 확인 임시 기록. 이메일/인증번호 원문 미저장. 단기 보관 후 삭제.';

ALTER TABLE public.rights_email_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_email_challenges FROM PUBLIC;
REVOKE ALL ON public.rights_email_challenges FROM anon;
REVOKE ALL ON public.rights_email_challenges FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rights_email_challenges TO service_role;
