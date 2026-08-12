/*
================================================================================
마이그레이션: email-less OAuth(Kakao) 신규 사용자 profiles 자동 생성 + 활동명 온보딩
================================================================================
【원인】
- auth.users INSERT 트리거 public.handle_new_user() 가 display_name 을
  provider metadata / email local-part 로 자동 채움
- Google 신규: email local-part → 유효 활동명으로 오판 → 활동명 onboarding 건너뜀
- Kakao email-less: NEW.email NULL + metadata 없음 시 display_name NULL 위반 가능

【수정】
- 신규 profiles.display_name 은 항상 '' (SentenceArena 활동명은 onboarding 에서만 설정)
- provider nickname/name/email 은 SentenceArena 활동명으로 사용하지 않음
- email NULL 허용, NOT NULL 제약은 빈 문자열로 충족 (가짜 email 금지)

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

  -- SentenceArena 활동명은 onboarding 저장 시에만 확정한다.
  -- Google/Kakao/Naver metadata·email 은 인증 참고용일 뿐이다.
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

COMMENT ON FUNCTION public.handle_new_user() IS
  'auth.users 생성 시 public.profiles 자동 생성. display_name 기본값은 빈 문자열(활동명 onboarding). email-less OAuth(Kakao) 지원.';
