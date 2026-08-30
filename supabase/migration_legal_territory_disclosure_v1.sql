-- =============================================================================
-- Legal territory disclosure consent v1 (additive)
-- 현재 소속 영토 공개 필수 동의 시각/정책버전.
-- 기존 회원 자동 동의 없음. 기존 row UPDATE/DELETE/DROP 없음.
-- political_profile_visibility 컬럼은 유지(가입 화면에서 선택하지 않음).
-- Production apply: 전용 tools/apply-legal-territory-disclosure-migration.js. 기존 row 자동 동의 없음.
-- =============================================================================

ALTER TABLE public.user_legal_consents
  ADD COLUMN IF NOT EXISTS territory_disclosure_consented_at timestamptz NULL;

ALTER TABLE public.user_legal_consents
  ADD COLUMN IF NOT EXISTS territory_disclosure_policy_version text NULL;

COMMENT ON COLUMN public.user_legal_consents.territory_disclosure_consented_at IS
  'Server time when the user consented to disclosing current territory to other users. Never backfilled.';
COMMENT ON COLUMN public.user_legal_consents.territory_disclosure_policy_version IS
  'Policy version for territory disclosure consent. Expected: territory-disclosure-v1.';
