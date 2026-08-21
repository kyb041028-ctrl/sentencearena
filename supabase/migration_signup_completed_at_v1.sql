-- =============================================================================
-- Additive: profiles.signup_completed_at
-- SentenceArena 정상 회원가입이 끝난 서버 시각. 기본 NULL.
-- handle_new_user / 소셜 로그인 직후 자동 프로필 생성만으로는 채우지 않는다.
-- 기존 행을 이 파일에서 바꾸지 않는다. 백필은 조사 후 별도 확정 계정만.
-- 테이블 삭제·비우기·행 삭제 없음.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_completed_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.signup_completed_at IS
  'Server time when SentenceArena signup finished. NULL means membership is not complete. Not set by profile auto-create.';

CREATE OR REPLACE FUNCTION public.protect_signup_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
      NEW.signup_completed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.signup_completed_at IS DISTINCT FROM OLD.signup_completed_at THEN
    IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'PROFILES_SIGNUP_COMPLETED_CLIENT_WRITE_FORBIDDEN';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_signup_completed_at() IS
  'Browser/authenticated cannot set signup_completed_at. Server/service_role only.';

DROP TRIGGER IF EXISTS trg_protect_signup_completed_at ON public.profiles;
CREATE TRIGGER trg_protect_signup_completed_at
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE PROCEDURE public.protect_signup_completed_at();
