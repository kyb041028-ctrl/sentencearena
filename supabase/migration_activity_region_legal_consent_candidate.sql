-- =============================================================================
-- CANDIDATE ONLY. Do not apply to production.
-- 미국 가입 동의 저장 후보. 한국 user_legal_consents 를 복사하거나 고치지 않는다.
-- 생년월일 원문 컬럼 없음. 운영 마이그레이션으로 실행하지 않는다.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_activity_region_legal_consents (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_region text NOT NULL CHECK (activity_region = 'US'),
  age_requirement_confirmed_at timestamptz NULL,
  age_policy_version text NULL CHECK (age_policy_version IS NULL OR age_policy_version = 'age-policy-us-v1'),
  age_policy_region text NULL CHECK (age_policy_region IS NULL OR age_policy_region = 'US'),
  age_gate_method text NULL,
  terms_document_version text NULL,
  terms_consented_at timestamptz NULL,
  privacy_document_version text NULL,
  privacy_acknowledged_at timestamptz NULL,
  privacy_processing_consent_at timestamptz NULL,
  sensitive_political_consented_at timestamptz NULL,
  sensitive_political_policy_version text NULL,
  sensitive_applies_to text NULL CHECK (sensitive_applies_to IS NULL OR sensitive_applies_to = 'US'),
  territory_disclosure_consented_at timestamptz NULL,
  territory_disclosure_policy_version text NULL,
  territory_disclosure_applies_to text NULL CHECK (territory_disclosure_applies_to IS NULL OR territory_disclosure_applies_to = 'US'),
  marketing_opt_in boolean NOT NULL DEFAULT false,
  marketing_policy_version text NULL,
  marketing_choice_at timestamptz NULL,
  marketing_withdrawn_at timestamptz NULL,
  draft_status text NOT NULL DEFAULT 'DRAFT_NOT_LEGAL_REVIEW',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity_region)
);

COMMENT ON TABLE public.user_activity_region_legal_consents IS
  'Candidate US signup records. Draft documents are not a completed legal review. Date of birth is not stored.';

ALTER TABLE public.user_activity_region_legal_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_activity_region_legal_consents_select_own
  ON public.user_activity_region_legal_consents;
CREATE POLICY user_activity_region_legal_consents_select_own
  ON public.user_activity_region_legal_consents
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.user_activity_region_legal_consents FROM authenticated, anon;
GRANT SELECT ON public.user_activity_region_legal_consents TO authenticated;
GRANT ALL ON public.user_activity_region_legal_consents TO service_role;
