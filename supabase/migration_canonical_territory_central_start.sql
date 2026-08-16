-- =============================================================================
-- Additive correction: Earth membership starts at CENTRAL.
-- Users do not pick PIONEER/CENTRAL/GUARDIAN. No DROP/TRUNCATE/DELETE.
-- =============================================================================
-- 1) NULL existing rows → CENTRAL (non-NULL preserved)
-- 2) column DEFAULT 'CENTRAL' for new inserts that omit territory
-- 3) handle_new_user INSERT includes territory = CENTRAL (provider-agnostic)
-- 4) client cannot INSERT non-CENTRAL or UPDATE territory
-- Political score / territory transition / history not in this migration.
-- =============================================================================

UPDATE public.profiles
SET territory = 'CENTRAL'
WHERE territory IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN territory SET DEFAULT 'CENTRAL';

CREATE OR REPLACE FUNCTION public.protect_canonical_membership_territory()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.territory IS NULL THEN
      NEW.territory := 'CENTRAL';
    END IF;
    IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
      IF NEW.territory IS DISTINCT FROM 'CENTRAL' THEN
        RAISE EXCEPTION 'PROFILES_TERRITORY_CLIENT_WRITE_FORBIDDEN';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.territory IS DISTINCT FROM OLD.territory THEN
    IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'PROFILES_TERRITORY_CLIENT_WRITE_FORBIDDEN';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_canonical_membership_territory() IS
  'Initial membership CENTRAL only. Browser cannot change profiles.territory. Server/service_role for future automatic moves.';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_home text;
  v_display text;
BEGIN
  v_home := upper(btrim(COALESCE(NEW.raw_user_meta_data ->> 'home_country', 'KR')));
  IF v_home !~ '^[A-Z]{2}$' OR char_length(v_home) <> 2 THEN
    v_home := 'KR';
  END IF;

  -- SentenceArena 활동명은 onboarding 저장 시에만 확정한다.
  -- Google/Kakao/Naver metadata·email 은 인증 참고용일 뿐이다.
  v_display := '';

  INSERT INTO public.profiles (id, display_name, home_country, citizenship_status, territory)
  VALUES (
    NEW.id,
    v_display,
    v_home,
    'CITIZEN',
    'CENTRAL'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'auth.users 생성 시 public.profiles 자동 생성. display_name 빈 문자열(활동명 onboarding). Earth membership 초기값 CENTRAL. provider별 territory 분기 없음.';

COMMENT ON COLUMN public.profiles.territory IS
  'Earth membership territory (HOME). Initial CENTRAL. PIONEER/GUARDIAN later by automatic transition only. Not board view. Not ALIEN.';
