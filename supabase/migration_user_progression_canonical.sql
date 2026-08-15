-- =============================================================================
-- Additive: public.user_progression only (ProfileFrame LEVEL canonical)
-- - CREATE IF NOT EXISTS
-- - 테이블 삭제·전체비우기·대량삭제 없음
-- - 기존 user_achievements 등 미변경
-- - level DEFAULT 1 (1~10)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_progression (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  xp bigint NOT NULL DEFAULT 0 CONSTRAINT user_progression_xp_min CHECK (xp >= 0),
  level integer NOT NULL DEFAULT 1
    CONSTRAINT user_progression_level_range CHECK (level BETWEEN 1 AND 10),
  reputation_score bigint NOT NULL DEFAULT 0
    CONSTRAINT user_progression_reputation_min CHECK (reputation_score >= 0),
  citizen_rank text NULL,
  received_empathy_count bigint NOT NULL DEFAULT 0
    CONSTRAINT user_progression_empathy_min CHECK (received_empathy_count >= 0),
  follower_count integer NOT NULL DEFAULT 0
    CONSTRAINT user_progression_follower_min CHECK (follower_count >= 0),
  following_count integer NOT NULL DEFAULT 0
    CONSTRAINT user_progression_following_min CHECK (following_count >= 0),
  received_post_likes integer NOT NULL DEFAULT 0
    CONSTRAINT user_progression_post_likes_min CHECK (received_post_likes >= 0),
  received_comment_likes integer NOT NULL DEFAULT 0
    CONSTRAINT user_progression_comment_likes_min CHECK (received_comment_likes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_progression
  IS '사용자 진행 상태. xp=누적 total XP(DEFAULT 0). level 1~10. 클라이언트 직접 쓰기 금지.';

CREATE INDEX IF NOT EXISTS user_progression_level_idx
  ON public.user_progression (level);
CREATE INDEX IF NOT EXISTS user_progression_reputation_idx
  ON public.user_progression (reputation_score DESC);

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

ALTER TABLE public.user_progression ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_progression_select_own" ON public.user_progression;
CREATE POLICY "user_progression_select_own"
  ON public.user_progression FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.user_progression TO authenticated;
GRANT ALL ON TABLE public.user_progression TO service_role;
GRANT ALL ON TABLE public.user_progression TO postgres;
