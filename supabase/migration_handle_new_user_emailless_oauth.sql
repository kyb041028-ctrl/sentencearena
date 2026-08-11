/*
================================================================================
마이그레이션: email-less OAuth(Kakao) 신규 사용자 profiles 자동 생성 수정
================================================================================
【원인】
- auth.users INSERT 트리거 public.handle_new_user() 가 display_name 을
  COALESCE(metadata.display_name, split_part(NEW.email, '@', 1)) 로만 결정
- Kakao email-less 사용자: NEW.email NULL + metadata.display_name 없음
  → display_name NULL → public.profiles.display_name NOT NULL 위반
  → Supabase Auth "Database error saving new user"

【수정】
- Kakao/소셜 metadata (nickname, name 등) fallback 추가
- email NULL 허용, 최종 fallback 은 빈 문자열 (가짜 email 금지)
- Google(email 있음) 동작 유지

【적용】
node tools/apply-handle-new-user-migration.js --confirm-dev-db
(또는 npm run auth:handle-new-user:migrate)
================================================================================
*/

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

  v_display := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'display_name'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'nickname'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'preferred_username'), ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    ''
  );

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

COMMENT ON FUNCTION public.handle_new_user() IS
  'auth.users 생성 시 public.profiles 자동 생성. email-less OAuth(Kakao) 지원.';
