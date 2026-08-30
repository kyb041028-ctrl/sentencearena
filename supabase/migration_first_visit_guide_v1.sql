-- =============================================================================
-- Additive: profiles first-visit guide timestamps
-- 신규 회원 3단계 첫 방문 안내·중앙광장 보조 안내 완료 시각. 기본 NULL.
-- 기존 행을 이 파일에서 바꾸지 않는다. 백필·자동 완료 표시 없음.
-- 기존 가입완료 회원은 코드에서 eligible_at NULL = 기존 사용자로 취급한다.
-- 테이블 삭제·비우기·행 삭제 없음.
-- Production apply는 별도 확정 전까지 하지 않는다.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_visit_guide_eligible_at timestamptz NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_visit_guide_completed_at timestamptz NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS central_plaza_hint_seen_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.first_visit_guide_eligible_at IS
  'Set when a new member first saves an activity name after this feature. NULL means existing member or not yet eligible. Not backfilled.';

COMMENT ON COLUMN public.profiles.first_visit_guide_completed_at IS
  'Set when the member finishes the 3-step first-visit guide. NULL means not finished.';

COMMENT ON COLUMN public.profiles.central_plaza_hint_seen_at IS
  'Set when the one-time central plaza hint was shown. NULL means not shown.';

CREATE OR REPLACE FUNCTION public.protect_first_visit_guide_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
      NEW.first_visit_guide_eligible_at := NULL;
      NEW.first_visit_guide_completed_at := NULL;
      NEW.central_plaza_hint_seen_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
      IF NEW.first_visit_guide_eligible_at IS DISTINCT FROM OLD.first_visit_guide_eligible_at
         OR NEW.first_visit_guide_completed_at IS DISTINCT FROM OLD.first_visit_guide_completed_at
         OR NEW.central_plaza_hint_seen_at IS DISTINCT FROM OLD.central_plaza_hint_seen_at THEN
        RAISE EXCEPTION 'PROFILES_FIRST_VISIT_GUIDE_CLIENT_WRITE_FORBIDDEN';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_first_visit_guide_columns() IS
  'Browser/authenticated cannot set first-visit guide timestamps. Server/service_role only.';

DROP TRIGGER IF EXISTS trg_protect_first_visit_guide_columns ON public.profiles;
CREATE TRIGGER trg_protect_first_visit_guide_columns
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE PROCEDURE public.protect_first_visit_guide_columns();
