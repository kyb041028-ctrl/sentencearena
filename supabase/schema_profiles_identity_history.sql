/*
================================================================================
센텐스크래프트 — Supabase용 테이블 설계도 (profiles + identity_history)
================================================================================

【이 파일을 쓰는 방법 — Supabase에서 “클릭 몇 번”으로 적용하기】
1) Supabase 프로젝트에 로그인합니다.
2) 왼쪽 메뉴에서 **SQL Editor**(SQL 편집기)를 엽니다.
3) **New query**(새 쿼리)를 누릅니다.
4) 이 파일의 **전체 내용을 복사**해서 붙여넣습니다.
5) 오른쪽 아래 **Run**(실행)을 누릅니다.
6) 아래쪽에 “Success” 비슷한 성공 메시지가 뜨면 완료입니다.

【왜 테이블이 두 개인가요? (비전공자용 한 줄 요약)】
- `profiles` : 지금 이 유저가 누구인지(닉네임, 시작 국가, 현재 신분, 문패 칭호 등) **현재 스냅샷**을 담는 메인 명함입니다.
- `identity_history` : 신분이 바뀔 때마다 **과거 기록이 쌓이는 일기장**입니다. (언제, 무엇에서 무엇으로, 왜 바뀌었는지)

【보안(RLS)에 대한 짧은 설명】
- Supabase는 기본적으로 “누구나 DB를 마음대로 읽고 쓰면 안 된다”는 전제로 **RLS(행 단위 보안)**를 켜는 것이 정석입니다.
- 이 스크립트는 **일반 로그인 유저**가 자기 프로필은 읽고/일부 수정할 수 있게 하되,
  `identity_history`는 **직접 조작하지 못하게 막고**(조작은 서버/관리자 권한으로만),
  대신 **프로필의 신분이 바뀔 때 자동으로 한 줄씩 기록**되도록 **트리거(자동 연쇄 장치)**를 붙였습니다.

【주의】
- `auth.users`는 Supabase가 회원가입 때 자동으로 만들어 주는 “진짜 계정 원부”입니다.
- `profiles.id`는 반드시 그 계정의 `id`와 **똑같이** 맞춥니다(1:1 연결).

================================================================================
*/

-- (선택) UUID 생성에 쓰는 확장이 꺼져 있을 때를 대비합니다. Supabase에서는 보통 이미 켜져 있습니다.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1) profiles : 유저 “현재 상태” 메인 테이블
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  /*
    id
    - 의미: Supabase Auth의 유저 고유키(UUID)와 동일해야 합니다.
    - 왜 중요한가: 로그인한 사람 = 이 행(row) 한 줄과 1:1로 연결됩니다.
  */
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,

  /*
    display_name
    - 의미: 앱에서 보여줄 닉네임/활동명입니다.
    - 참고: 이메일은 보통 auth.users에만 두고, 여기엔 “부담 없이 바꿀 수 있는 이름”을 둡니다.
  */
  display_name text NOT NULL DEFAULT '',

  /*
    avatar_url
    - 의미: 프로필 사진(아바타) 주소입니다.
    - Supabase Storage에 올린 뒤, public URL을 여기 저장하는 방식이 흔합니다.
  */
  avatar_url text,

  /*
    bio
    - 의미: 자기소개(짧은 문구)입니다. 없으면 NULL.
  */
  bio text,

  /*
    home_country
    - 의미: 가입 시 고른 “활동 무대” 국가 코드입니다. ISO 3166-1 alpha-2 (예: KR, US, JP).
    - app-config.js / config/signup-countries.js 의 목록과 맞춥니다.
  */
  home_country text NOT NULL DEFAULT 'KR' CHECK (home_country ~ '^[A-Z]{2}$' AND char_length(home_country) = 2),

  /*
    citizenship_status
    - 의미: 정치/축출 시스템에서의 “현재 거주 신분(큰 축)”입니다.
    - app-config.js의 IDENTITY_HISTORY.statusCodes와 맞춥니다.
      - CITIZEN: 일반 시민 땅
      - EXILED: 축출(일반)
      - KANTAPBIYA_RESIDENT: 외계행성 유배지
      - OUTLANDER_SPY: (선택) 외지인 첩자 상태를 ‘상시 신분’으로 관리하고 싶을 때 사용
        ※ 실제 서비스에서는 “타국 글쓰기 순간에만 잠깐 붙는 플래그”로 둘 수도 있어서,
           이 컬럼 대신 게시글 메타데이터로만 관리할지는 기획에 따라 조정하면 됩니다.
  */
  citizenship_status text NOT NULL DEFAULT 'CITIZEN' CHECK (
    citizenship_status IN ('CITIZEN', 'EXILED', 'KANTAPBIYA_RESIDENT', 'OUTLANDER_SPY')
  ),

  /*
    title_badge_key
    - 의미: 아바타 옆에 붙는 “문패 칭호”의 키입니다. (예: SPY)
    - 실제 한글 칭호 문구는 app-config.js의 TITLE_BADGE_MAP에서 매핑합니다.
  */
  title_badge_key text,

  /*
    exile_strike_count
    - 의미: 축출 판정에 쓰는 “싫어요/신고 누적” 같은 카운트를 숫자로 저장합니다.
    - 정책상 30이면 축출(app-config.js EXILE_RULES) — 구현체에 따라 가중치/분리 테이블로 바뀔 수 있습니다.
  */
  exile_strike_count integer NOT NULL DEFAULT 0 CHECK (exile_strike_count >= 0),

  /*
    metadata
    - 의미: 나중에 생길 잡다한 값(실험 기능, 임시 플래그 등)을 JSON으로 넣는 “여유 칸”입니다.
    - 처음엔 비워두고, 필요해질 때만 채워도 됩니다.
  */
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  /*
    created_at / updated_at
    - 의미: 처음 만들어진 시각 / 마지막으로 수정된 시각입니다.
    - updated_at은 아래 트리거로 자동 갱신됩니다.
  */
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS '센텐스크래프트 유저 프로필(현재 스냅샷). auth.users.id와 1:1로 연결됩니다.';
COMMENT ON COLUMN public.profiles.id IS 'Auth 유저 UUID(= auth.users.id). 프로필의 기준키입니다.';
COMMENT ON COLUMN public.profiles.display_name IS '닉네임/표시 이름.';
COMMENT ON COLUMN public.profiles.avatar_url IS '아바타 이미지 URL.';
COMMENT ON COLUMN public.profiles.bio IS '자기소개.';
COMMENT ON COLUMN public.profiles.home_country IS '가입 시 고른 국가 코드 (ISO 3166-1 alpha-2, 대문자 2글자).';
COMMENT ON COLUMN public.profiles.citizenship_status IS '현재 정치/축출 신분 코드(CITIZEN/EXILED/KANTAPBIYA_RESIDENT/OUTLANDER_SPY).';
COMMENT ON COLUMN public.profiles.title_badge_key IS '문패 칭호 키(예: SPY). 한글 표기는 앱 설정 매핑 테이블 사용.';
COMMENT ON COLUMN public.profiles.exile_strike_count IS '축출 관련 누적 카운트(예: 싫어요/신고 누적의 합산 저장소).';
COMMENT ON COLUMN public.profiles.metadata IS '확장용 JSON(운영/기능 증가 대비).';
COMMENT ON COLUMN public.profiles.created_at IS '생성 시각(UTC 저장, 표시는 앱에서 로컬 변환).';
COMMENT ON COLUMN public.profiles.updated_at IS '수정 시각(자동 갱신).';

CREATE INDEX IF NOT EXISTS profiles_home_country_idx ON public.profiles (home_country);
CREATE INDEX IF NOT EXISTS profiles_citizenship_status_idx ON public.profiles (citizenship_status);
CREATE INDEX IF NOT EXISTS profiles_title_badge_key_idx ON public.profiles (title_badge_key);

-- -----------------------------------------------------------------------------
-- 2) identity_history : 신분 변동 “누적 일기장” 테이블
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_history (
  /*
    id
    - 의미: 일기장 한 줄의 고유번호(자동 증가)입니다.
    - UUID가 아닌 이유: 단순히 “시간순으로 쌓이는 로그”에는 bigserial이 다루기 쉽습니다.
  */
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,

  /*
    user_id
    - 의미: 이 변동이 누구의 일기인지(= profiles.id).
  */
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,

  /*
    occurred_at
    - 의미: 변동이 실제로 일어난(또는 기록된) 시각입니다.
    - 기본값은 now()이지만, 서버에서 “정확한 사건 시각”을 넣고 싶으면 INSERT 때 명시해도 됩니다.
  */
  occurred_at timestamptz NOT NULL DEFAULT now(),

  /*
    from_status / to_status
    - 의미: 어떤 신분에서 어떤 신분으로 바뀌었는지(이전/이후).
    - 가입 직후 첫 기록은 from이 NULL일 수 있습니다.
  */
  from_status text,
  to_status text NOT NULL CHECK (
    to_status IN ('CITIZEN', 'EXILED', 'KANTAPBIYA_RESIDENT', 'OUTLANDER_SPY')
  ),

  /*
    reason_code
    - 의미: 왜 바뀌었는지 “기계가 읽기 좋은 코드”입니다.
    - app-config.js의 IDENTITY_HISTORY.reasonCodes와 맞추는 것을 권장합니다.
  */
  reason_code text NOT NULL,

  /*
    note_ko
    - 의미: 운영자/시스템이 남기는 한글 메모(선택).
  */
  note_ko text,

  /*
    meta
    - 의미: 추가 정보(JSON). 예: 신고 ID, 결제 영수증 키, 관리자 코멘트 등.
  */
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,

  /*
    source
    - 의미: 누가 이 기록을 만들었는지(자동 트리거 / 관리자 / 배치잡 등).
  */
  source text NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'admin', 'server', 'migration')),

  created_at timestamptz NOT NULL DEFAULT now(),

  /*
    from_status가 NULL이 아닐 때만 체크(간단한 데이터 품질 가드)
  */
  CONSTRAINT identity_history_from_status_valid_chk CHECK (
    from_status IS NULL
    OR from_status IN ('CITIZEN', 'EXILED', 'KANTAPBIYA_RESIDENT', 'OUTLANDER_SPY')
  )
);

COMMENT ON TABLE public.identity_history IS '유저 신분 변동 누적 로그(과거 기록). profiles의 변경을 추적합니다.';
COMMENT ON COLUMN public.identity_history.user_id IS '대상 유저(profiles.id).';
COMMENT ON COLUMN public.identity_history.occurred_at IS '변동 시각(기록 기준).';
COMMENT ON COLUMN public.identity_history.from_status IS '이전 신분(첫 기록은 NULL 가능).';
COMMENT ON COLUMN public.identity_history.to_status IS '이후 신분(필수).';
COMMENT ON COLUMN public.identity_history.reason_code IS '변동 사유 코드(앱 설정 reasonCodes 권장).';
COMMENT ON COLUMN public.identity_history.note_ko IS '한글 메모(선택).';
COMMENT ON COLUMN public.identity_history.meta IS '부가 JSON(영수증/신고ID 등).';
COMMENT ON COLUMN public.identity_history.source IS '기록 출처(system/admin/server/migration).';

CREATE INDEX IF NOT EXISTS identity_history_user_id_occurred_at_idx
  ON public.identity_history (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS identity_history_reason_code_idx
  ON public.identity_history (reason_code);

-- -----------------------------------------------------------------------------
-- 3) updated_at 자동 갱신(프로필 수정될 때마다 찍히게)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS 'profiles.updated_at를 UPDATE 때 자동으로 now()로 맞춥니다.';

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE PROCEDURE public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4) 신분이 바뀌면 identity_history에 “한 줄” 자동 적재(트리거)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_profile_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from text;
  v_to text;
BEGIN
  -- 신분(citizenship_status) 변화만 기록합니다.
  -- (닉네임/아바타만 바뀐 경우엔 일기장이 불필요하게 길어지지 않게)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.citizenship_status IS NOT DISTINCT FROM OLD.citizenship_status THEN
      RETURN NEW;
    END IF;
    v_from := OLD.citizenship_status;
    v_to := NEW.citizenship_status;
  ELSIF TG_OP = 'INSERT' THEN
    v_from := NULL;
    v_to := NEW.citizenship_status;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.identity_history (
    user_id,
    occurred_at,
    from_status,
    to_status,
    reason_code,
    note_ko,
    meta,
    source
  )
  VALUES (
    NEW.id,
    now(),
    v_from,
    v_to,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'SIGNUP'
      ELSE 'PROFILE_CITIZENSHIP_CHANGED'
    END,
    CASE
      WHEN TG_OP = 'INSERT' THEN '회원가입 직후 프로필 생성(초기 신분 기록)'
      ELSE '프로필의 citizenship_status 변경으로 자동 기록'
    END,
    jsonb_build_object(
      'old_title_badge_key', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD.title_badge_key) ELSE NULL END,
      'new_title_badge_key', to_jsonb(NEW.title_badge_key)
    ),
    'system'
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.log_profile_identity_change() IS 'profiles의 citizenship_status 변경 시 identity_history에 자동 INSERT합니다.';

DROP TRIGGER IF EXISTS profiles_log_identity_change_ins ON public.profiles;
CREATE TRIGGER profiles_log_identity_change_ins
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE PROCEDURE public.log_profile_identity_change();

DROP TRIGGER IF EXISTS profiles_log_identity_change_upd ON public.profiles;
CREATE TRIGGER profiles_log_identity_change_upd
AFTER UPDATE OF citizenship_status ON public.profiles
FOR EACH ROW
EXECUTE PROCEDURE public.log_profile_identity_change();

-- -----------------------------------------------------------------------------
-- 5) 회원가입 시 profiles 자동 생성(권장 패턴)
-- -----------------------------------------------------------------------------
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
  -- 가입 메타데이터에서 시작 국가를 읽되, 없거나 형식이 아니면 KR 기본
  v_home := upper(btrim(COALESCE(NEW.raw_user_meta_data ->> 'home_country', 'KR')));
  IF v_home !~ '^[A-Z]{2}$' OR char_length(v_home) <> 2 THEN
    v_home := 'KR';
  END IF;

  -- SentenceArena 활동명은 onboarding 저장 시에만 확정 (provider metadata/email 사용 금지)
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

COMMENT ON FUNCTION public.handle_new_user() IS 'auth.users 생성 시 public.profiles를 자동 생성합니다.';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE PROCEDURE public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 6) RLS(행 단위 보안) + 정책
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_history ENABLE ROW LEVEL SECURITY;

-- profiles: 누구나(로그인 사용자) 프로필 “읽기” 가능(커뮤니티 앱에서 흔함)
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- profiles: 비로그인(게스트)도 “읽기” 가능 — 공개 커뮤니티에서 흔한 설정입니다.
-- (비공개로 운영하고 싶으면 이 정책만 삭제하면 됩니다.)
DROP POLICY IF EXISTS "profiles_select_anon" ON public.profiles;
CREATE POLICY "profiles_select_anon"
ON public.profiles
FOR SELECT
TO anon
USING (true);

-- profiles: 본인만 “삽입” (트리거가 auth.users에서 만들어주는 경우가 많아 사실상 중복 방지용)
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- profiles: 본인만 “수정”
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- identity_history: 본인 기록만 읽기
DROP POLICY IF EXISTS "identity_history_select_own" ON public.identity_history;
CREATE POLICY "identity_history_select_own"
ON public.identity_history
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- identity_history: 클라이언트의 임의 INSERT/UPDATE/DELETE는 막습니다(무결성).
--   - 일반적으로 기록 생성은 SECURITY DEFINER 트리거/서버(service role)에서 처리합니다.
--   - RLS는 역할에 적용되므로, 테이블 소유자/슈퍼유저 실행(SQL editor)은 통과할 수 있습니다.

-- -----------------------------------------------------------------------------
-- 7) 권한(Grant) — API(anon/authenticated)에서 SELECT/UPDATE가 되게
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.identity_history TO authenticated;

/*
================================================================================
끝. 적용 후 체크리스트(사장님/운영)
================================================================================
1) Table editor에서 `profiles`, `identity_history`가 생겼는지 확인
2) Authentication으로 테스트 유저를 하나 만든 뒤, `profiles`에 자동으로 한 줄 생기는지 확인
3) `profiles.citizenship_status`를 EXILED 같은 값으로 바꿔보며 `identity_history`에 자동 기록이 쌓이는지 확인

※ 만약 트리거 실행 중 RLS에 막히면(환경에 따라 다름) 알려주세요.
   그 경우 identity_history에 트리거 전용 정책을 추가하는 버전으로 조정하면 됩니다.
================================================================================
*/
