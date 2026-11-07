-- PLAN ONLY. 이 파일을 운영 DB에 실행하지 않는다.
-- 이 작업에서는 적용하지 않았다.
--
-- 기존 행은 activity_region이 없다. 읽을 때는 KR로 해석한다.
-- 아래 문장은 새 테이블만 추가한다. 기존 행을 지우거나 다른 국가로 복사하지 않는다.
-- user_progression, board_posts, board_comments, user_alignment_state,
-- user_achievements의 기존 기본키와 한국 점수는 그대로 둔다.

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
  '활동 국가별 프로필. home_country(국적)와 별개. 기존 user_progression 행은 이 테이블에 복사하지 않으며 KR로 읽는다.';

CREATE TABLE IF NOT EXISTS public.user_activity_region_post (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_activity_region_post_region_idx
  ON public.user_activity_region_post (activity_region, created_at DESC);

COMMENT ON COLUMN public.user_activity_region_post.activity_region IS
  '글이 속한 활동 국가. 요청 파라미터만으로 다른 국가에 넣지 않는다.';

-- 나중에 기존 게시 테이블에 컬럼을 더할 때의 원칙(실행하지 않음):
-- ALTER TABLE public.board_posts ADD COLUMN IF NOT EXISTS activity_region text;
-- NULL이면 KR. UPDATE로 기존 글을 다른 국가에 옮기지 않는다.
-- ALTER TABLE public.board_comments ADD COLUMN IF NOT EXISTS activity_region text;
-- ALTER TABLE public.user_alignment_state 는 사용자당 1행이다.
-- 미국 성향은 user_activity_region_profile.tendency에 두고 한국 행을 덮어쓰지 않는다.
