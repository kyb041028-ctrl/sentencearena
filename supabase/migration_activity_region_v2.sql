-- PLAN ONLY. 이 파일을 운영 DB에 실행하지 않는다.
-- 이 작업에서는 적용하지 않았다. 앱 시작 시에도 실행하지 않는다.
--
-- 적용 순서 (이미 있는 마이그레이션 다음):
-- 1. 인증과 public.profiles (계정은 하나, home_country는 국적)
-- 2. supabase/migration_board_core_system.sql
-- 3. supabase/migration_user_data_system.sql
-- 4. supabase/migration_political_alignment_persistence.sql
-- 5. 이 파일
--
-- 원칙:
-- 공통 인증은 한곳이다. 활동 기록만 KR/US로 나눈다.
-- 테이블을 통째로 복제하지 않는다.
-- 국가가 없거나 비어 있는 옛 기록은 KR로 읽는다. 기본값을 US로 넣지 않는다.
-- US는 서버가 명시해서 저장한다.
-- 기존 행을 지우거나, 비우거나, 다른 국가로 복사하지 않는다.
-- user_progression, user_alignment_state의 기본키(user_id)는 그대로다.
-- 그 한 행은 한국 점수다. 미국 점수는 아래 새 표에만 둔다.
-- supabase/migration_activity_region_plan.sql의 user_activity_region_post는
-- 운영 글 저장소가 아니다. 이 파일은 그 표를 지우지 않고, 서버도 그 표를 쓰지 않는다.
-- 스킨은 계정 공통이다. 스킨 표를 만들지 않는다.
-- 활동 국가는 JWT 클레임이 아니다. 어느 나라 글을 볼지는 서버가 정한다.
-- 그래서 기존 board_posts에는 이 파일에서 RLS를 켜지 않는다.
-- RLS는 새로 만드는 점수 표만 켠다. 인증 사용자는 본인 행만 읽는다.
-- 인증 사용자에게 INSERT/UPDATE/DELETE 정책은 주지 않는다. service role은 RLS를 우회한다.

CREATE OR REPLACE FUNCTION public.activity_region_norm(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL OR btrim(value) = '' THEN 'KR'
    ELSE upper(btrim(value))
  END;
$$;

COMMENT ON FUNCTION public.activity_region_norm(text) IS
  '비어 있으면 KR. US는 저장된 값만 US다.';

ALTER TABLE public.board_posts
  ADD COLUMN IF NOT EXISTS activity_region text;
ALTER TABLE public.board_comments
  ADD COLUMN IF NOT EXISTS activity_region text;
ALTER TABLE public.board_reactions
  ADD COLUMN IF NOT EXISTS activity_region text;
ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS activity_region text;
ALTER TABLE public.user_activity_events
  ADD COLUMN IF NOT EXISTS activity_region text;
ALTER TABLE public.user_bookmarks
  ADD COLUMN IF NOT EXISTS activity_region text;

COMMENT ON COLUMN public.board_posts.activity_region IS
  'NULL이면 한국 글. US는 명시 저장. 기존 행을 다른 국가로 옮기지 않는다.';
COMMENT ON COLUMN public.board_comments.activity_region IS
  '원글과 같은 국가. NULL이면 한국.';
COMMENT ON COLUMN public.board_reactions.activity_region IS
  '대상 글과 같은 국가. NULL이면 한국.';
COMMENT ON COLUMN public.user_notifications.activity_region IS
  'NULL이면 한국 알림. 미국 알림은 US로 저장한다.';
COMMENT ON COLUMN public.user_activity_events.activity_region IS
  'NULL이면 한국 피드. 미국 피드는 US로 저장한다.';
COMMENT ON COLUMN public.user_bookmarks.activity_region IS
  'NULL이면 한국 북마크. 기존 (user_id, post_id) 유니크는 유지한다.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_posts_activity_region_chk'
  ) THEN
    ALTER TABLE public.board_posts
      ADD CONSTRAINT board_posts_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_comments_activity_region_chk'
  ) THEN
    ALTER TABLE public.board_comments
      ADD CONSTRAINT board_comments_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'board_reactions_activity_region_chk'
  ) THEN
    ALTER TABLE public.board_reactions
      ADD CONSTRAINT board_reactions_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_notifications_activity_region_chk'
  ) THEN
    ALTER TABLE public.user_notifications
      ADD CONSTRAINT user_notifications_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_activity_events_activity_region_chk'
  ) THEN
    ALTER TABLE public.user_activity_events
      ADD CONSTRAINT user_activity_events_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_bookmarks_activity_region_chk'
  ) THEN
    ALTER TABLE public.user_bookmarks
      ADD CONSTRAINT user_bookmarks_activity_region_chk
      CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS board_posts_activity_region_created_idx
  ON public.board_posts ((COALESCE(activity_region, 'KR')), created_at DESC);
CREATE INDEX IF NOT EXISTS board_comments_activity_region_created_idx
  ON public.board_comments ((COALESCE(activity_region, 'KR')), created_at DESC);
CREATE INDEX IF NOT EXISTS board_reactions_activity_region_created_idx
  ON public.board_reactions ((COALESCE(activity_region, 'KR')), created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_activity_region_created_idx
  ON public.user_notifications ((COALESCE(activity_region, 'KR')), created_at DESC);
CREATE INDEX IF NOT EXISTS user_activity_events_activity_region_idx
  ON public.user_activity_events ((COALESCE(activity_region, 'KR')), occurred_at DESC);
CREATE INDEX IF NOT EXISTS user_bookmarks_activity_region_idx
  ON public.user_bookmarks ((COALESCE(activity_region, 'KR')), created_at DESC);

CREATE OR REPLACE FUNCTION public.board_comment_same_activity_region()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_region text;
BEGIN
  SELECT activity_region INTO parent_region
  FROM public.board_posts
  WHERE id = NEW.post_id;
  IF NEW.activity_region IS NULL OR btrim(NEW.activity_region) = '' THEN
    NEW.activity_region := parent_region;
  ELSIF public.activity_region_norm(NEW.activity_region)
        IS DISTINCT FROM public.activity_region_norm(parent_region) THEN
    RAISE EXCEPTION 'REGION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS board_comments_same_activity_region ON public.board_comments;
CREATE TRIGGER board_comments_same_activity_region
  BEFORE INSERT OR UPDATE ON public.board_comments
  FOR EACH ROW
  EXECUTE PROCEDURE public.board_comment_same_activity_region();

CREATE OR REPLACE FUNCTION public.board_reaction_same_activity_region()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_region text;
BEGIN
  IF NEW.target_type = 'COMMENT' THEN
    SELECT p.activity_region INTO parent_region
    FROM public.board_comments c
    JOIN public.board_posts p ON p.id = c.post_id
    WHERE c.id = NEW.comment_id;
  ELSE
    SELECT activity_region INTO parent_region
    FROM public.board_posts
    WHERE id = NEW.post_id;
  END IF;
  IF NEW.activity_region IS NULL OR btrim(NEW.activity_region) = '' THEN
    NEW.activity_region := parent_region;
  ELSIF public.activity_region_norm(NEW.activity_region)
        IS DISTINCT FROM public.activity_region_norm(parent_region) THEN
    RAISE EXCEPTION 'REGION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS board_reactions_same_activity_region ON public.board_reactions;
CREATE TRIGGER board_reactions_same_activity_region
  BEFORE INSERT OR UPDATE ON public.board_reactions
  FOR EACH ROW
  EXECUTE PROCEDURE public.board_reaction_same_activity_region();

CREATE TABLE IF NOT EXISTS public.user_activity_region_profile (
  user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 10),
  xp bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
  reputation_score bigint NOT NULL DEFAULT 0 CHECK (reputation_score >= 0),
  aura bigint NOT NULL DEFAULT 0 CHECK (aura >= 0),
  tendency jsonb NULL,
  streak_30 integer NOT NULL DEFAULT 0 CHECK (streak_30 >= 0),
  streak_99 integer NOT NULL DEFAULT 0 CHECK (streak_99 >= 0),
  territory text NULL,
  evolution_contribution bigint NOT NULL DEFAULT 0 CHECK (evolution_contribution >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity_region)
);

COMMENT ON TABLE public.user_activity_region_profile IS
  '활동 국가별 레벨·명성·아우라·성향·연속·발전. 한국 user_progression 행을 복사하지 않는다.';

CREATE TABLE IF NOT EXISTS public.user_activity_region_achievement (
  user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  achievement_key text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity_region, achievement_key)
);

COMMENT ON TABLE public.user_activity_region_achievement IS
  '미국 업적만 둔다. 한국 user_achievements 행을 복사하거나 지우지 않는다.';

ALTER TABLE public.user_activity_region_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_region_achievement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_activity_region_profile_select_own"
  ON public.user_activity_region_profile;
CREATE POLICY "user_activity_region_profile_select_own"
  ON public.user_activity_region_profile
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_activity_region_achievement_select_own"
  ON public.user_activity_region_achievement;
CREATE POLICY "user_activity_region_achievement_select_own"
  ON public.user_activity_region_achievement
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.user_activity_region_profile TO authenticated;
GRANT SELECT ON public.user_activity_region_achievement TO authenticated;

-- 직접 접속(authenticated)은 한국 행만 보고 쓴다.
-- 미국 행은 service role만 다룬다. service role은 RLS를 우회하고, 트리거는 원글 국가를 복사한다.
-- 세션 설정으로 국가를 바꾸지 못한다. 빈 값은 KR이다.

DROP POLICY IF EXISTS board_posts_activity_region_direct ON public.board_posts;
CREATE POLICY board_posts_activity_region_direct
  ON public.board_posts
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.activity_region_norm(activity_region) = 'KR')
  WITH CHECK (public.activity_region_norm(activity_region) = 'KR');

DROP POLICY IF EXISTS board_comments_activity_region_direct ON public.board_comments;
CREATE POLICY board_comments_activity_region_direct
  ON public.board_comments
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.activity_region_norm(activity_region) = 'KR')
  WITH CHECK (public.activity_region_norm(activity_region) = 'KR');

DROP POLICY IF EXISTS board_reactions_activity_region_direct ON public.board_reactions;
CREATE POLICY board_reactions_activity_region_direct
  ON public.board_reactions
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.activity_region_norm(activity_region) = 'KR')
  WITH CHECK (public.activity_region_norm(activity_region) = 'KR');

DROP POLICY IF EXISTS user_notifications_activity_region_direct ON public.user_notifications;
CREATE POLICY user_notifications_activity_region_direct
  ON public.user_notifications
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.activity_region_norm(activity_region) = 'KR')
  WITH CHECK (public.activity_region_norm(activity_region) = 'KR');

DROP POLICY IF EXISTS user_activity_events_activity_region_direct ON public.user_activity_events;
CREATE POLICY user_activity_events_activity_region_direct
  ON public.user_activity_events
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.activity_region_norm(activity_region) = 'KR')
  WITH CHECK (public.activity_region_norm(activity_region) = 'KR');

DROP POLICY IF EXISTS user_bookmarks_activity_region_direct ON public.user_bookmarks;
CREATE POLICY user_bookmarks_activity_region_direct
  ON public.user_bookmarks
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.activity_region_norm(activity_region) = 'KR')
  WITH CHECK (public.activity_region_norm(activity_region) = 'KR');
