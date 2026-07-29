/*
================================================================================
센텐스크래프트 — 사용자 데이터 시스템 마이그레이션
================================================================================

【중요 — 이 파일은 실제 DB에 적용하지 않는다】
- 실제 Supabase migration apply 금지
- 실제 DB 접속 금지
- 구조 설계 및 dry-run 전환 준비용으로만 사용

【적용 전 반드시 확인할 사항】
1. schema_profiles_identity_history.sql 이 이미 적용되어 있어야 함
2. migration_board_core_system.sql 이 적용된 후 user_bookmarks FK 연결 가능
3. auth.users 테이블이 Supabase Auth에 의해 존재해야 함

【profiles 기존 컬럼 (중복 생성 금지)】
- id (uuid PK, references auth.users)
- display_name (text)
- avatar_url (text)
- bio (text)
- home_country (text, ISO alpha-2)
- citizenship_status (text)
- title_badge_key (text)
- exile_strike_count (integer)
- metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

따라서 profiles 확장은 home_country_iso 컬럼 이름 확인 및 profile_visibility 만 추가.

================================================================================
*/

-- 확장: pgcrypto (UUID 생성)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. public.profiles 확장 (기존 컬럼과 중복되지 않는 필드만)
-- =============================================================================
-- display_name, avatar_url, bio, home_country, updated_at 는 이미 존재함.
-- profile_visibility 만 추가한다.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'profile_visibility'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN profile_visibility text NOT NULL DEFAULT 'public'
        CHECK (profile_visibility IN ('public', 'followers_only', 'private'));
    COMMENT ON COLUMN public.profiles.profile_visibility
      IS '프로필 공개 범위 (public/followers_only/private)';
  END IF;
END $$;

-- =============================================================================
-- 2. public.user_progression — 사용자 진행 상태
-- =============================================================================
-- citizen_rank: 기존 rank_tier(1~4: 시민/논객/대표/지도자)와 별도.
-- reputation_grade: 공감 기반 명성 등급(추후 확정 전 null 허용).
-- citizen_rank 는 별도 계획 전까지 null 허용, TODO 유지.

CREATE TABLE IF NOT EXISTS public.user_progression (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,

  -- 경험치 (활동 기반)
  xp bigint NOT NULL DEFAULT 0 CONSTRAINT user_progression_xp_min CHECK (xp >= 0),

  -- 레벨 1~10 (1~5: 초기 탐험·튜토리얼, 6~10: 활동 성장 — Lv6~10 XP 임계값은 TODO)
  level integer NOT NULL DEFAULT 1
    CONSTRAINT user_progression_level_range CHECK (level BETWEEN 1 AND 10),

  -- 명성 점수 (공감 중심, 감점 없음)
  reputation_score bigint NOT NULL DEFAULT 0
    CONSTRAINT user_progression_reputation_min CHECK (reputation_score >= 0),

  -- 명성 등급 키 (시민/논객/대표/지도자) — rank_tier 와 대응, 확정 전 null 허용
  -- TODO: 명성등급과 시민등급이 다른 개념으로 확정되면 분리 컬럼 추가
  citizen_rank text NULL,

  -- 받은 공감 수 (명성 계산 원천)
  received_empathy_count bigint NOT NULL DEFAULT 0
    CONSTRAINT user_progression_empathy_min CHECK (received_empathy_count >= 0),

  -- 팔로워·팔로잉 수 (user_follows trigger 동기화)
  follower_count integer NOT NULL DEFAULT 0
    CONSTRAINT user_progression_follower_min CHECK (follower_count >= 0),
  following_count integer NOT NULL DEFAULT 0
    CONSTRAINT user_progression_following_min CHECK (following_count >= 0),

  -- 받은 게시글 좋아요 (rank 계산용)
  received_post_likes integer NOT NULL DEFAULT 0
    CONSTRAINT user_progression_post_likes_min CHECK (received_post_likes >= 0),

  -- 받은 댓글 좋아요 (rank 계산용)
  received_comment_likes integer NOT NULL DEFAULT 0
    CONSTRAINT user_progression_comment_likes_min CHECK (received_comment_likes >= 0),

  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_progression
  IS '사용자 진행 상태 (XP/레벨/명성). 클라이언트 직접 쓰기 금지 — 서버 전용.';

CREATE INDEX IF NOT EXISTS user_progression_level_idx
  ON public.user_progression (level);
CREATE INDEX IF NOT EXISTS user_progression_reputation_idx
  ON public.user_progression (reputation_score DESC);

-- user_progression 의 updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION public.set_user_progression_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_progression_set_updated_at ON public.user_progression;
CREATE TRIGGER user_progression_set_updated_at
BEFORE UPDATE ON public.user_progression
FOR EACH ROW EXECUTE PROCEDURE public.set_user_progression_updated_at();

-- =============================================================================
-- 3. public.user_progression_events — 진행 이벤트 로그 (dedup 기반)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_progression_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  amount bigint NOT NULL,
  source_type text NULL,
  source_id text NULL,

  -- dedupe_key: 동일 이벤트 반복 방지 (UNIQUE)
  dedupe_key text NOT NULL,

  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_progression_events
  IS '진행 이벤트 로그. dedupe_key UNIQUE로 중복 이벤트 방지. 서버 전용 INSERT.';

CREATE UNIQUE INDEX IF NOT EXISTS user_progression_events_dedupe_key_uniq
  ON public.user_progression_events (dedupe_key);
CREATE INDEX IF NOT EXISTS user_progression_events_user_id_idx
  ON public.user_progression_events (user_id, occurred_at DESC);

-- =============================================================================
-- 4. public.user_follows — 팔로우 관계
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  following_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- 자기 자신 팔로우 금지
  CONSTRAINT user_follows_no_self_follow
    CHECK (follower_user_id <> following_user_id),

  -- 중복 팔로우 방지
  CONSTRAINT user_follows_unique
    UNIQUE (follower_user_id, following_user_id)
);

COMMENT ON TABLE public.user_follows
  IS '팔로우 관계. 자기 자신 팔로우 금지. toggle_user_follow RPC로만 변경.';

CREATE INDEX IF NOT EXISTS user_follows_follower_idx
  ON public.user_follows (follower_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_follows_following_idx
  ON public.user_follows (following_user_id, created_at DESC);

-- =============================================================================
-- 5. public.user_achievements — 사용자 업적
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_achievements (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  achievement_key text NOT NULL,
  acquired_at timestamptz NOT NULL,
  acquisition_sequence bigint NOT NULL,
  season_key text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- 비시즌 업적: (user_id, achievement_key, null season_key) 중복 금지
  -- 시즌 업적: (user_id, achievement_key, season_key) 중복 금지
  -- UNIQUE 는 NULL이 포함된 컬럼에는 한 row만 허용하지 않으므로 partial index 사용
  CONSTRAINT user_achievements_key_len
    CHECK (char_length(achievement_key) > 0 AND char_length(achievement_key) <= 80)
);

COMMENT ON TABLE public.user_achievements
  IS '사용자 업적. acquiredAt·acquisitionSequence 보존 필수. 서버 전용 부여.';

-- 비시즌 업적 중복 방지 (season_key IS NULL 인 경우)
CREATE UNIQUE INDEX IF NOT EXISTS user_achievements_no_season_uniq
  ON public.user_achievements (user_id, achievement_key)
  WHERE season_key IS NULL;

-- 시즌 업적 중복 방지 (season_key IS NOT NULL 인 경우)
CREATE UNIQUE INDEX IF NOT EXISTS user_achievements_season_uniq
  ON public.user_achievements (user_id, achievement_key, season_key)
  WHERE season_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_achievements_user_id_idx
  ON public.user_achievements (user_id, acquired_at DESC);

-- =============================================================================
-- 6. public.user_featured_achievements — 대표 업적 (최대 3개)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_featured_achievements (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  slot integer NOT NULL,
  achievement_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_featured_achievements_slot_range
    CHECK (slot BETWEEN 1 AND 3),

  CONSTRAINT user_featured_achievements_unique
    UNIQUE (user_id, slot)
);

COMMENT ON TABLE public.user_featured_achievements
  IS '대표 업적 슬롯 1~3. 반드시 user_achievements에 보유한 업적만 설정 가능. set_featured_achievements RPC 사용.';

-- =============================================================================
-- 7. public.user_notifications — 알림
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NULL,
  message text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- dedupe_key: 45초 내 동일 타입 중복 방지용
  dedupe_key text NULL,

  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz NULL,

  CONSTRAINT user_notifications_message_len
    CHECK (message IS NULL OR char_length(message) <= 200)
);

COMMENT ON TABLE public.user_notifications
  IS '사용자 알림. max 50개/45초 중복 방지는 서버 로직으로 관리. 서버 전용 INSERT.';

CREATE INDEX IF NOT EXISTS user_notifications_user_id_created_idx
  ON public.user_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_user_id_unread_idx
  ON public.user_notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_dedupe_key_idx
  ON public.user_notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- =============================================================================
-- 8. public.user_activity_events — 활동 피드
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_activity_events
  IS '사용자 활동 피드 이벤트. 서버 전용 INSERT. 클라이언트 직접 생성 금지.';

CREATE INDEX IF NOT EXISTS user_activity_events_user_id_idx
  ON public.user_activity_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS user_activity_events_dedupe_key_idx
  ON public.user_activity_events (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- =============================================================================
-- 9. public.user_bookmarks — 북마크
-- =============================================================================
-- board_posts 가 아직 실제 적용 전이므로 post_id FK 는 후속 migration에서 추가.
CREATE TABLE IF NOT EXISTS public.user_bookmarks (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  post_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_bookmarks_unique
    UNIQUE (user_id, post_id)
);

COMMENT ON TABLE public.user_bookmarks
  IS '사용자 북마크. post_id FK (board_posts)는 board migration 적용 후 후속 migration에서 추가.';

CREATE INDEX IF NOT EXISTS user_bookmarks_user_id_idx
  ON public.user_bookmarks (user_id, created_at DESC);

-- =============================================================================
-- 10. RLS 활성화 + 정책
-- =============================================================================

-- user_progression: 서버(service-role)만 쓰기
ALTER TABLE public.user_progression ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_progression_select_own" ON public.user_progression;
CREATE POLICY "user_progression_select_own"
  ON public.user_progression FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 일반 사용자 INSERT/UPDATE/DELETE 금지 (service-role 은 RLS bypass)
-- 정책 없음 = 거부

-- user_progression_events: 서버만 삽입
ALTER TABLE public.user_progression_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_progression_events_select_own" ON public.user_progression_events;
CREATE POLICY "user_progression_events_select_own"
  ON public.user_progression_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- user_follows
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_follows_select_all" ON public.user_follows;
CREATE POLICY "user_follows_select_all"
  ON public.user_follows FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "user_follows_insert_own" ON public.user_follows;
CREATE POLICY "user_follows_insert_own"
  ON public.user_follows FOR INSERT TO authenticated
  WITH CHECK (follower_user_id = auth.uid());

DROP POLICY IF EXISTS "user_follows_delete_own" ON public.user_follows;
CREATE POLICY "user_follows_delete_own"
  ON public.user_follows FOR DELETE TO authenticated
  USING (follower_user_id = auth.uid());

-- user_achievements: 서버만 INSERT/UPDATE
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_achievements_select_own" ON public.user_achievements;
CREATE POLICY "user_achievements_select_own"
  ON public.user_achievements FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_achievements_select_public" ON public.user_achievements;
CREATE POLICY "user_achievements_select_public"
  ON public.user_achievements FOR SELECT TO anon
  USING (true);

-- user_featured_achievements: 사용자 본인 설정 가능 (RPC 통해 검증)
ALTER TABLE public.user_featured_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_featured_achievements_select_all" ON public.user_featured_achievements;
CREATE POLICY "user_featured_achievements_select_all"
  ON public.user_featured_achievements FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "user_featured_achievements_manage_own" ON public.user_featured_achievements;
CREATE POLICY "user_featured_achievements_manage_own"
  ON public.user_featured_achievements FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- user_notifications: 본인만 조회·읽음 처리
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_notifications_select_own" ON public.user_notifications;
CREATE POLICY "user_notifications_select_own"
  ON public.user_notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_notifications_update_own_read" ON public.user_notifications;
CREATE POLICY "user_notifications_update_own_read"
  ON public.user_notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- user_activity_events: 본인만 조회
ALTER TABLE public.user_activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_activity_events_select_own" ON public.user_activity_events;
CREATE POLICY "user_activity_events_select_own"
  ON public.user_activity_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- user_bookmarks: 본인만 관리
ALTER TABLE public.user_bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_bookmarks_manage_own" ON public.user_bookmarks;
CREATE POLICY "user_bookmarks_manage_own"
  ON public.user_bookmarks FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =============================================================================
-- 11. GRANT
-- =============================================================================
GRANT SELECT ON public.user_progression TO authenticated;
GRANT SELECT ON public.user_progression_events TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_follows TO authenticated;
GRANT SELECT ON public.user_achievements TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_featured_achievements TO authenticated;
GRANT SELECT, UPDATE ON public.user_notifications TO authenticated;
GRANT SELECT ON public.user_activity_events TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_bookmarks TO authenticated;

-- =============================================================================
-- 12. RPC: apply_user_progression_event
-- =============================================================================
-- service-role 전용 (SECURITY DEFINER + SET search_path)
-- 동일 dedupe_key 는 멱등(IDEMPOTENT): 에러 대신 기존 결과 반환
CREATE OR REPLACE FUNCTION public.apply_user_progression_event(
  p_user_id      uuid,
  p_event_type   text,
  p_amount       bigint,
  p_source_type  text,
  p_source_id    text,
  p_dedupe_key   text,
  p_occurred_at  timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_current  public.user_progression%ROWTYPE;
  v_new_xp   bigint;
  v_new_rep  bigint;
BEGIN
  -- 중복 이벤트 확인
  SELECT id INTO v_existing
    FROM public.user_progression_events
   WHERE dedupe_key = p_dedupe_key;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'DUPLICATE', 'dedupeKey', p_dedupe_key);
  END IF;

  -- progression row 없으면 생성
  INSERT INTO public.user_progression (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_current FROM public.user_progression WHERE user_id = p_user_id;

  -- XP 변경 (음수 결과 방지)
  v_new_xp := GREATEST(0, v_current.xp + p_amount);

  -- 명성: 공감/좋아요/팔로워 이벤트는 감점 금지
  IF p_event_type IN ('EMPATHY_RECEIVED', 'LIKE_RECEIVED', 'FOLLOWER_GAINED') THEN
    v_new_rep := GREATEST(0, v_current.reputation_score + GREATEST(0, p_amount));
  ELSE
    v_new_rep := GREATEST(0, v_current.reputation_score + p_amount);
  END IF;

  -- 상태 업데이트 (Lv1~5 XP 임계값만 확정 — Lv6~10 자동 승급은 TODO)
  UPDATE public.user_progression
     SET xp = v_new_xp,
         reputation_score = v_new_rep,
         level = LEAST(10, GREATEST(1,
           CASE
             WHEN v_new_xp >= 300 THEN 5
             WHEN v_new_xp >= 220 THEN 4
             WHEN v_new_xp >= 150 THEN 3
             WHEN v_new_xp >= 90  THEN 2
             ELSE 1
           END
         ))
   WHERE user_id = p_user_id;

  -- 이벤트 로그 INSERT
  INSERT INTO public.user_progression_events
    (user_id, event_type, amount, source_type, source_id, dedupe_key, occurred_at)
  VALUES
    (p_user_id, p_event_type, p_amount, p_source_type, p_source_id, p_dedupe_key, p_occurred_at);

  RETURN jsonb_build_object('status', 'APPLIED', 'newXp', v_new_xp, 'newReputation', v_new_rep);
END;
$$;

COMMENT ON FUNCTION public.apply_user_progression_event
  IS 'XP/명성 이벤트 원자 적용. dedupe_key UNIQUE로 중복 방지. service-role 전용.';

-- =============================================================================
-- 13. RPC: toggle_user_follow (authenticated JWT — follower = auth.uid())
-- =============================================================================
CREATE OR REPLACE FUNCTION public.toggle_user_follow(
  p_following_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_follower uuid;
  v_exists boolean;
BEGIN
  v_follower := auth.uid();
  IF v_follower IS NULL THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'USER_DATA_AUTH_REQUIRED');
  END IF;

  IF v_follower = p_following_user_id THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'SELF_FOLLOW_FORBIDDEN');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.user_follows
     WHERE follower_user_id = v_follower
       AND following_user_id = p_following_user_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.user_follows
     WHERE follower_user_id = v_follower
       AND following_user_id = p_following_user_id;

    UPDATE public.user_progression
       SET follower_count  = GREATEST(0, follower_count - 1)
     WHERE user_id = p_following_user_id;
    UPDATE public.user_progression
       SET following_count = GREATEST(0, following_count - 1)
     WHERE user_id = v_follower;

    RETURN jsonb_build_object('status', 'UNFOLLOWED');
  ELSE
    INSERT INTO public.user_follows (follower_user_id, following_user_id)
    VALUES (v_follower, p_following_user_id)
    ON CONFLICT DO NOTHING;

    UPDATE public.user_progression
       SET follower_count  = follower_count + 1
     WHERE user_id = p_following_user_id;
    UPDATE public.user_progression
       SET following_count = following_count + 1
     WHERE user_id = v_follower;

    RETURN jsonb_build_object('status', 'FOLLOWED');
  END IF;
END;
$$;

COMMENT ON FUNCTION public.toggle_user_follow(uuid)
  IS '팔로우 토글. follower_user_id = auth.uid(). authenticated JWT 전용.';

-- =============================================================================
-- 14. RPC: grant_user_achievement
-- =============================================================================
CREATE OR REPLACE FUNCTION public.grant_user_achievement(
  p_user_id             uuid,
  p_achievement_key     text,
  p_acquired_at         timestamptz,
  p_acquisition_sequence bigint,
  p_season_key          text DEFAULT NULL,
  p_metadata            jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF p_season_key IS NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.user_achievements
       WHERE user_id = p_user_id
         AND achievement_key = p_achievement_key
         AND season_key IS NULL
    ) INTO v_exists;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.user_achievements
       WHERE user_id = p_user_id
         AND achievement_key = p_achievement_key
         AND season_key = p_season_key
    ) INTO v_exists;
  END IF;

  IF v_exists THEN
    RETURN jsonb_build_object('status', 'ALREADY_GRANTED');
  END IF;

  INSERT INTO public.user_achievements
    (user_id, achievement_key, acquired_at, acquisition_sequence, season_key, metadata)
  VALUES
    (p_user_id, p_achievement_key, p_acquired_at, p_acquisition_sequence, p_season_key, p_metadata);

  RETURN jsonb_build_object('status', 'GRANTED');
END;
$$;

COMMENT ON FUNCTION public.grant_user_achievement
  IS '업적 부여. 중복 부여 방지(idempotent). service-role 전용.';

-- =============================================================================
-- 15. RPC: set_featured_achievements (authenticated JWT — user = auth.uid())
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_featured_achievements(
  p_slot1_key    text DEFAULT NULL,
  p_slot2_key    text DEFAULT NULL,
  p_slot3_key    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_key text;
  v_owned boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'USER_DATA_AUTH_REQUIRED');
  END IF;

  FOREACH v_key IN ARRAY ARRAY[p_slot1_key, p_slot2_key, p_slot3_key] LOOP
    IF v_key IS NOT NULL THEN
      SELECT EXISTS(
        SELECT 1 FROM public.user_achievements
         WHERE user_id = v_user_id AND achievement_key = v_key
      ) INTO v_owned;
      IF NOT v_owned THEN
        RETURN jsonb_build_object('status', 'ERROR', 'code', 'ACHIEVEMENT_NOT_OWNED', 'key', v_key);
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.user_featured_achievements WHERE user_id = v_user_id;

  IF p_slot1_key IS NOT NULL THEN
    INSERT INTO public.user_featured_achievements (user_id, slot, achievement_key)
    VALUES (v_user_id, 1, p_slot1_key) ON CONFLICT (user_id, slot) DO UPDATE SET achievement_key = EXCLUDED.achievement_key, updated_at = now();
  END IF;
  IF p_slot2_key IS NOT NULL THEN
    INSERT INTO public.user_featured_achievements (user_id, slot, achievement_key)
    VALUES (v_user_id, 2, p_slot2_key) ON CONFLICT (user_id, slot) DO UPDATE SET achievement_key = EXCLUDED.achievement_key, updated_at = now();
  END IF;
  IF p_slot3_key IS NOT NULL THEN
    INSERT INTO public.user_featured_achievements (user_id, slot, achievement_key)
    VALUES (v_user_id, 3, p_slot3_key) ON CONFLICT (user_id, slot) DO UPDATE SET achievement_key = EXCLUDED.achievement_key, updated_at = now();
  END IF;

  RETURN jsonb_build_object('status', 'SET');
END;
$$;

COMMENT ON FUNCTION public.set_featured_achievements(text, text, text)
  IS '대표 업적 슬롯 설정. user_id = auth.uid(). authenticated JWT 전용.';

-- =============================================================================
-- 16. RPC: mark_user_notification_read (authenticated JWT — auth.uid() 소유만)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mark_user_notification_read(
  p_notification_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'USER_DATA_AUTH_REQUIRED');
  END IF;

  IF p_notification_id IS NULL THEN
    UPDATE public.user_notifications
       SET is_read = true, read_at = now()
     WHERE user_id = v_user_id AND is_read = false;
    RETURN jsonb_build_object('status', 'ALL_READ');
  ELSE
    UPDATE public.user_notifications
       SET is_read = true, read_at = now()
     WHERE id = p_notification_id AND user_id = v_user_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'ERROR', 'code', 'USER_DATA_NOTIFICATION_NOT_FOUND');
    END IF;
    RETURN jsonb_build_object('status', 'READ');
  END IF;
END;
$$;

COMMENT ON FUNCTION public.mark_user_notification_read(uuid)
  IS '알림 읽음 처리. auth.uid() 소유 알림만 변경. authenticated JWT 전용.';

-- =============================================================================
-- 17. RPC: create_user_bookmark / remove_user_bookmark (authenticated JWT)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_user_bookmark(
  p_post_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'USER_DATA_AUTH_REQUIRED');
  END IF;

  INSERT INTO public.user_bookmarks (user_id, post_id)
  VALUES (v_user_id, p_post_id)
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('status', 'OK');
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_user_bookmark(
  p_post_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'USER_DATA_AUTH_REQUIRED');
  END IF;

  DELETE FROM public.user_bookmarks
   WHERE user_id = v_user_id AND post_id = p_post_id;
  RETURN jsonb_build_object('status', 'OK');
END;
$$;

COMMENT ON FUNCTION public.create_user_bookmark(uuid)
  IS '북마크 추가. user_id = auth.uid(). authenticated JWT 전용.';
COMMENT ON FUNCTION public.remove_user_bookmark(uuid)
  IS '북마크 삭제. user_id = auth.uid(). authenticated JWT 전용.';

-- =============================================================================
-- 18. RPC EXECUTE 권한 분리 (PUBLIC revoke · authenticated vs service_role)
-- =============================================================================

-- service-role 전용
REVOKE ALL ON FUNCTION public.apply_user_progression_event(uuid, text, bigint, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_user_progression_event(uuid, text, bigint, text, text, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_user_progression_event(uuid, text, bigint, text, text, text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) TO service_role;

-- authenticated JWT 실행 가능 (service_role 도 허용)
REVOKE ALL ON FUNCTION public.toggle_user_follow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_user_follow(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_user_follow(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_featured_achievements(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_featured_achievements(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_featured_achievements(text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_user_notification_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_user_notification_read(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_user_notification_read(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_user_bookmark(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_user_bookmark(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_user_bookmark(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.remove_user_bookmark(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_user_bookmark(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_user_bookmark(uuid) TO authenticated, service_role;

/*
================================================================================
완료 체크리스트 (실제 적용 시)
================================================================================
1. schema_profiles_identity_history.sql 적용 확인
2. migration_home_country_iso.sql 적용 확인
3. 이 파일 실행
4. user_progression 행이 없는 기존 사용자용 초기화 스크립트 별도 작성
5. board_posts FK: user_bookmarks 에 post_id FK 후속 migration 작성
6. citizen_rank 컬럼 확정 후 CHECK 제약 추가
7. 알림 최대 50개 자동 삭제 정책 (DB trigger 또는 서버 로직) 별도 설계
================================================================================
*/
