/*
================================================================================
마이그레이션: profiles.home_country 를 KR/JP/US 만 → ISO 전체(2글자) 허용
================================================================================
【언제 쓰나요?】
- 예전에 `schema_profiles_identity_history.sql` 을 이미 실행해서
  `home_country` 가 `IN ('KR','JP','US')` 로 막혀 있을 때
- 한 번만 Supabase SQL Editor 에서 실행하면 됩니다.

【주의】
- 새로 프로젝트를 처음 만든다면, 메인 스키마 파일만 실행해도 되고
  이 파일은 생략해도 됩니다.
================================================================================
*/

-- 기존 데이터가 소문자면 대문자로 맞춤(제약 추가 전)
UPDATE public.profiles
SET home_country = upper(btrim(home_country))
WHERE home_country IS NOT NULL;

-- 예전에 KR/JP/US 만 허용하던 제약이 있으면 먼저 제거 (이름이 다를 수 있어 둘 다 시도)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_home_country_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_home_country_iso_check;

-- ISO alpha-2 형식만 허용 (대문자 2글자)
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_home_country_iso_check
  CHECK (home_country ~ '^[A-Z]{2}$' AND char_length(home_country) = 2);

COMMENT ON COLUMN public.profiles.home_country IS '가입 시 고른 국가 코드 (ISO 3166-1 alpha-2, 대문자 2글자).';

-- 트리거 함수: 메타데이터의 잘못된 값은 KR 로 보정
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

  v_display := '';

  INSERT INTO public.profiles (id, display_name, home_country, citizenship_status)
  VALUES (
    NEW.id,
    v_display,
    v_home,
    'CITIZEN'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
