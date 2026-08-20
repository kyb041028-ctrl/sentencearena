-- =============================================================================
-- Legal gate v1 (additive)
-- 만 14세 확인 결과 + 정치성향 민감정보 동의. 생년월일 원본 컬럼 없음.
-- 기존 회원 consent=true 자동 부여 없음.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_legal_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  age_requirement_confirmed_at timestamptz NULL,
  age_policy_version text NULL,
  age_gate_method text NULL,
  sensitive_political_consented_at timestamptz NULL,
  sensitive_political_policy_version text NULL,
  political_profile_visibility text NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_legal_consents_visibility_chk CHECK (
    political_profile_visibility IN ('private', 'public')
  ),
  CONSTRAINT user_legal_consents_no_dob CHECK (true)
);

COMMENT ON TABLE public.user_legal_consents IS
  'Signup legal gate. Stores confirmation timestamps only. Date of birth is never stored.';
COMMENT ON COLUMN public.user_legal_consents.age_requirement_confirmed_at IS
  'Server time when 만 14+ was confirmed. DOB is not stored.';
COMMENT ON COLUMN public.user_legal_consents.political_profile_visibility IS
  'Other-user visibility of political alignment map/scores. Default private.';

ALTER TABLE public.user_legal_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_legal_consents_select_own ON public.user_legal_consents;
CREATE POLICY user_legal_consents_select_own
  ON public.user_legal_consents FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Writes go through the app server (service role). Authenticated clients cannot self-insert timestamps.
REVOKE INSERT, UPDATE, DELETE ON public.user_legal_consents FROM authenticated, anon;
GRANT SELECT ON public.user_legal_consents TO authenticated;
GRANT ALL ON public.user_legal_consents TO service_role;
