-- =============================================================================
-- 센텐스크래프트 — 게시판 코어 운영 스키마 (미적용 마이그레이션)
-- =============================================================================
--
-- 주의:
-- - 실제 운영/테스트 DB에 자동 적용하지 않음. 검토 후 수동 적용.
-- - 익명 글도 author_user_id는 DB에 저장. 일반 클라이언트 노출은 View/서버 API로 차단.
-- - 반응 변경은 toggle_board_reaction RPC만 사용 (직접 INSERT/UPDATE/DELETE 금지).
-- - 지구(EARTH)·외계(ALIEN) 반응을 분리 집계. 외계 반응은 alignment에 포함하지 않음.
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. board_posts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL REFERENCES auth.users(id),
  territory text NOT NULL,
  category_key text NULL,
  board_stage integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  content text NOT NULL,
  is_anonymous boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  deleted_at timestamptz NULL,
  deleted_by uuid NULL REFERENCES auth.users(id),
  blind_reason text NULL,
  comment_count integer NOT NULL DEFAULT 0,
  earth_positive_count integer NOT NULL DEFAULT 0,
  earth_negative_count integer NOT NULL DEFAULT 0,
  alien_positive_count integer NOT NULL DEFAULT 0,
  alien_negative_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT board_posts_territory_chk CHECK (
    territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN')
  ),
  CONSTRAINT board_posts_status_chk CHECK (
    status IN ('ACTIVE', 'DELETED', 'BLINDED', 'HIDDEN_BY_OPERATOR')
  ),
  CONSTRAINT board_posts_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT board_posts_content_not_blank CHECK (length(trim(content)) > 0),
  CONSTRAINT board_posts_board_stage_pos CHECK (board_stage >= 1),
  CONSTRAINT board_posts_comment_count_nonneg CHECK (comment_count >= 0),
  CONSTRAINT board_posts_earth_positive_nonneg CHECK (earth_positive_count >= 0),
  CONSTRAINT board_posts_earth_negative_nonneg CHECK (earth_negative_count >= 0),
  CONSTRAINT board_posts_alien_positive_nonneg CHECK (alien_positive_count >= 0),
  CONSTRAINT board_posts_alien_negative_nonneg CHECK (alien_negative_count >= 0),
  CONSTRAINT board_posts_deleted_requires_ts CHECK (
    status <> 'DELETED' OR deleted_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_board_posts_territory_created
  ON public.board_posts (territory, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_board_posts_author_created
  ON public.board_posts (author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_board_posts_status_created
  ON public.board_posts (status, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. board_comments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.board_posts(id) ON DELETE CASCADE,
  parent_comment_id uuid NULL REFERENCES public.board_comments(id),
  author_user_id uuid NOT NULL REFERENCES auth.users(id),
  territory text NOT NULL,
  content text NOT NULL,
  is_anonymous boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  deleted_at timestamptz NULL,
  deleted_by uuid NULL REFERENCES auth.users(id),
  blind_reason text NULL,
  earth_positive_count integer NOT NULL DEFAULT 0,
  earth_negative_count integer NOT NULL DEFAULT 0,
  alien_positive_count integer NOT NULL DEFAULT 0,
  alien_negative_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT board_comments_territory_chk CHECK (
    territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN')
  ),
  CONSTRAINT board_comments_status_chk CHECK (
    status IN ('ACTIVE', 'DELETED', 'BLINDED', 'HIDDEN_BY_OPERATOR')
  ),
  CONSTRAINT board_comments_content_not_blank CHECK (length(trim(content)) > 0),
  CONSTRAINT board_comments_content_max_len CHECK (char_length(content) <= 1500),
  CONSTRAINT board_comments_earth_positive_nonneg CHECK (earth_positive_count >= 0),
  CONSTRAINT board_comments_earth_negative_nonneg CHECK (earth_negative_count >= 0),
  CONSTRAINT board_comments_alien_positive_nonneg CHECK (alien_positive_count >= 0),
  CONSTRAINT board_comments_alien_negative_nonneg CHECK (alien_negative_count >= 0),
  CONSTRAINT board_comments_deleted_requires_ts CHECK (
    status <> 'DELETED' OR deleted_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_board_comments_post_created
  ON public.board_comments (post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_board_comments_parent
  ON public.board_comments (parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_board_comments_author_created
  ON public.board_comments (author_user_id, created_at DESC);

-- 대댓글 1단계만: 부모는 같은 post_id이고 parent_comment_id가 null
CREATE OR REPLACE FUNCTION public.board_comments_validate_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent public.board_comments%ROWTYPE;
BEGIN
  IF NEW.parent_comment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_parent
  FROM public.board_comments
  WHERE id = NEW.parent_comment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOARD_PARENT_COMMENT_NOT_FOUND';
  END IF;
  IF v_parent.post_id <> NEW.post_id THEN
    RAISE EXCEPTION 'BOARD_PARENT_POST_MISMATCH';
  END IF;
  IF v_parent.parent_comment_id IS NOT NULL THEN
    RAISE EXCEPTION 'BOARD_COMMENT_DEPTH_EXCEEDED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_board_comments_validate_parent ON public.board_comments;
CREATE TRIGGER trg_board_comments_validate_parent
  BEFORE INSERT OR UPDATE OF parent_comment_id, post_id
  ON public.board_comments
  FOR EACH ROW
  EXECUTE PROCEDURE public.board_comments_validate_parent();

-- -----------------------------------------------------------------------------
-- 3. board_reactions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  target_type text NOT NULL,
  post_id uuid NULL REFERENCES public.board_posts(id) ON DELETE CASCADE,
  comment_id uuid NULL REFERENCES public.board_comments(id) ON DELETE CASCADE,
  target_author_user_id uuid NOT NULL REFERENCES auth.users(id),
  reaction_type text NOT NULL,
  reaction_group text NOT NULL,
  audience_scope text NOT NULL,
  actor_territory_at_reaction text NOT NULL,
  target_author_territory_at_reaction text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz NULL,

  CONSTRAINT board_reactions_target_type_chk CHECK (target_type IN ('POST', 'COMMENT')),
  CONSTRAINT board_reactions_type_chk CHECK (
    reaction_type IN ('LIKE', 'RECOMMEND', 'DISLIKE', 'DOWNVOTE')
  ),
  CONSTRAINT board_reactions_group_chk CHECK (reaction_group IN ('POSITIVE', 'NEGATIVE')),
  CONSTRAINT board_reactions_scope_chk CHECK (audience_scope IN ('EARTH', 'ALIEN')),
  CONSTRAINT board_reactions_actor_territory_chk CHECK (
    actor_territory_at_reaction IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN')
  ),
  CONSTRAINT board_reactions_target_territory_chk CHECK (
    target_author_territory_at_reaction IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN')
  ),
  CONSTRAINT board_reactions_group_matches_type CHECK (
    (reaction_group = 'POSITIVE' AND reaction_type IN ('LIKE', 'RECOMMEND'))
    OR (reaction_group = 'NEGATIVE' AND reaction_type IN ('DISLIKE', 'DOWNVOTE'))
  ),
  CONSTRAINT board_reactions_target_shape_chk CHECK (
    (target_type = 'POST' AND post_id IS NOT NULL AND comment_id IS NULL)
    OR (target_type = 'COMMENT' AND comment_id IS NOT NULL AND post_id IS NULL)
  )
);

-- 활성 반응: 한 사용자·한 대상·한 계열당 1개
CREATE UNIQUE INDEX IF NOT EXISTS uq_board_reactions_active_post_group
  ON public.board_reactions (actor_user_id, post_id, reaction_group)
  WHERE cancelled_at IS NULL AND target_type = 'POST' AND post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_board_reactions_active_comment_group
  ON public.board_reactions (actor_user_id, comment_id, reaction_group)
  WHERE cancelled_at IS NULL AND target_type = 'COMMENT' AND comment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_board_reactions_target_author_created
  ON public.board_reactions (target_author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_board_reactions_alignment_earth
  ON public.board_reactions (audience_scope, cancelled_at, created_at DESC)
  WHERE audience_scope = 'EARTH';
CREATE INDEX IF NOT EXISTS idx_board_reactions_actor_active
  ON public.board_reactions (actor_user_id, cancelled_at);

-- -----------------------------------------------------------------------------
-- 4. board_reports
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id),
  target_type text NOT NULL,
  post_id uuid NULL REFERENCES public.board_posts(id) ON DELETE CASCADE,
  comment_id uuid NULL REFERENCES public.board_comments(id) ON DELETE CASCADE,
  target_author_user_id uuid NOT NULL REFERENCES auth.users(id),
  reason_code text NOT NULL,
  reason_detail text NULL,
  status text NOT NULL DEFAULT 'SUBMITTED',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  reviewed_by uuid NULL REFERENCES auth.users(id),
  resolution_note text NULL,

  CONSTRAINT board_reports_target_type_chk CHECK (target_type IN ('POST', 'COMMENT')),
  CONSTRAINT board_reports_status_chk CHECK (
    status IN ('SUBMITTED', 'REVIEWING', 'ACCEPTED', 'REJECTED', 'RESOLVED')
  ),
  CONSTRAINT board_reports_reason_chk CHECK (
    reason_code IN ('abuse', 'spam', 'baiting', 'misinfo', 'privacy', 'other')
  ),
  CONSTRAINT board_reports_target_shape_chk CHECK (
    (target_type = 'POST' AND post_id IS NOT NULL AND comment_id IS NULL)
    OR (target_type = 'COMMENT' AND comment_id IS NOT NULL AND post_id IS NULL)
  ),
  CONSTRAINT board_reports_not_self CHECK (reporter_user_id <> target_author_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_board_reports_active_post
  ON public.board_reports (reporter_user_id, post_id)
  WHERE target_type = 'POST' AND post_id IS NOT NULL AND status IN ('SUBMITTED', 'REVIEWING');

CREATE UNIQUE INDEX IF NOT EXISTS uq_board_reports_active_comment
  ON public.board_reports (reporter_user_id, comment_id)
  WHERE target_type = 'COMMENT' AND comment_id IS NOT NULL AND status IN ('SUBMITTED', 'REVIEWING');

-- -----------------------------------------------------------------------------
-- 5. Safe public views (익명 author_user_id 마스킹)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.board_posts_public
WITH (security_invoker = true)
AS
SELECT
  p.id,
  CASE
    WHEN p.is_anonymous AND p.author_user_id IS DISTINCT FROM auth.uid() THEN NULL
    ELSE p.author_user_id
  END AS author_user_id,
  p.territory,
  p.category_key,
  p.board_stage,
  p.title,
  CASE
    WHEN p.status = 'ACTIVE' THEN p.content
    ELSE NULL
  END AS content,
  p.is_anonymous,
  p.status,
  p.deleted_at,
  p.blind_reason,
  p.comment_count,
  p.earth_positive_count,
  p.earth_negative_count,
  p.alien_positive_count,
  p.alien_negative_count,
  p.created_at,
  p.updated_at,
  (p.author_user_id = auth.uid()) AS is_mine
FROM public.board_posts p;

CREATE OR REPLACE VIEW public.board_comments_public
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.post_id,
  c.parent_comment_id,
  CASE
    WHEN c.is_anonymous AND c.author_user_id IS DISTINCT FROM auth.uid() THEN NULL
    ELSE c.author_user_id
  END AS author_user_id,
  c.territory,
  CASE
    WHEN c.status = 'ACTIVE' THEN c.content
    ELSE NULL
  END AS content,
  c.is_anonymous,
  c.status,
  c.deleted_at,
  c.blind_reason,
  c.earth_positive_count,
  c.earth_negative_count,
  c.alien_positive_count,
  c.alien_negative_count,
  c.created_at,
  c.updated_at,
  (c.author_user_id = auth.uid()) AS is_mine
FROM public.board_comments c;

-- -----------------------------------------------------------------------------
-- 6. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.board_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_reports ENABLE ROW LEVEL SECURITY;

-- posts: 직접 SELECT는 공개 상태만. 익명 ID 보호는 View + 서버 mapper 병행.
DROP POLICY IF EXISTS board_posts_select_visible ON public.board_posts;
CREATE POLICY board_posts_select_visible
  ON public.board_posts FOR SELECT TO authenticated
  USING (status IN ('ACTIVE', 'DELETED', 'BLINDED', 'HIDDEN_BY_OPERATOR'));

DROP POLICY IF EXISTS board_posts_insert_own ON public.board_posts;
CREATE POLICY board_posts_insert_own
  ON public.board_posts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_user_id);

DROP POLICY IF EXISTS board_posts_update_own_active ON public.board_posts;
CREATE POLICY board_posts_update_own_active
  ON public.board_posts FOR UPDATE TO authenticated
  USING (auth.uid() = author_user_id)
  WITH CHECK (auth.uid() = author_user_id);

-- 직접 DELETE 정책 없음

DROP POLICY IF EXISTS board_comments_select_visible ON public.board_comments;
CREATE POLICY board_comments_select_visible
  ON public.board_comments FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS board_comments_insert_own ON public.board_comments;
CREATE POLICY board_comments_insert_own
  ON public.board_comments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_user_id);

DROP POLICY IF EXISTS board_comments_update_own ON public.board_comments;
CREATE POLICY board_comments_update_own
  ON public.board_comments FOR UPDATE TO authenticated
  USING (auth.uid() = author_user_id)
  WITH CHECK (auth.uid() = author_user_id);

-- reactions: 자신의 활성/이력 조회만. 쓰기는 RPC만.
DROP POLICY IF EXISTS board_reactions_select_own ON public.board_reactions;
CREATE POLICY board_reactions_select_own
  ON public.board_reactions FOR SELECT TO authenticated
  USING (auth.uid() = actor_user_id);

-- reports: 자신의 신고만
DROP POLICY IF EXISTS board_reports_select_own ON public.board_reports;
CREATE POLICY board_reports_select_own
  ON public.board_reports FOR SELECT TO authenticated
  USING (auth.uid() = reporter_user_id);

DROP POLICY IF EXISTS board_reports_insert_own ON public.board_reports;
CREATE POLICY board_reports_insert_own
  ON public.board_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_user_id);

GRANT SELECT ON public.board_posts_public TO authenticated;
GRANT SELECT ON public.board_comments_public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.board_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.board_comments TO authenticated;
GRANT SELECT ON public.board_reactions TO authenticated;
GRANT SELECT, INSERT ON public.board_reports TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. toggle_board_reaction RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.board_reaction_group(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_type IN ('LIKE', 'RECOMMEND') THEN 'POSITIVE'
    WHEN p_type IN ('DISLIKE', 'DOWNVOTE') THEN 'NEGATIVE'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_board_reaction(
  p_target_type text,
  p_target_id uuid,
  p_reaction_type text,
  p_actor_territory text,
  p_audience_scope text,
  p_target_author_territory text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_group text;
  v_existing public.board_reactions%ROWTYPE;
  v_post public.board_posts%ROWTYPE;
  v_comment public.board_comments%ROWTYPE;
  v_target_author uuid;
  v_action text;
  v_active boolean := false;
  v_pos_col text;
  v_neg_col text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'BOARD_AUTH_REQUIRED';
  END IF;

  v_group := public.board_reaction_group(p_reaction_type);
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'BOARD_REACTION_TYPE_INVALID';
  END IF;

  IF p_target_type NOT IN ('POST', 'COMMENT') THEN
    RAISE EXCEPTION 'BOARD_TARGET_TYPE_INVALID';
  END IF;

  IF p_audience_scope NOT IN ('EARTH', 'ALIEN') THEN
    RAISE EXCEPTION 'BOARD_AUDIENCE_SCOPE_INVALID';
  END IF;

  IF p_actor_territory NOT IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN') THEN
    RAISE EXCEPTION 'BOARD_ACTOR_TERRITORY_INVALID';
  END IF;

  IF p_target_author_territory NOT IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN') THEN
    RAISE EXCEPTION 'BOARD_TARGET_TERRITORY_INVALID';
  END IF;

  IF p_target_type = 'POST' THEN
    SELECT * INTO v_post FROM public.board_posts WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOARD_POST_NOT_FOUND'; END IF;
    IF v_post.status <> 'ACTIVE' THEN RAISE EXCEPTION 'BOARD_TARGET_NOT_ACTIVE'; END IF;
    v_target_author := v_post.author_user_id;

    SELECT * INTO v_existing
    FROM public.board_reactions
    WHERE actor_user_id = v_actor
      AND target_type = 'POST'
      AND post_id = p_target_id
      AND reaction_group = v_group
      AND cancelled_at IS NULL
    FOR UPDATE;
  ELSE
    SELECT * INTO v_comment FROM public.board_comments WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOARD_COMMENT_NOT_FOUND'; END IF;
    IF v_comment.status <> 'ACTIVE' THEN RAISE EXCEPTION 'BOARD_TARGET_NOT_ACTIVE'; END IF;
    v_target_author := v_comment.author_user_id;

    SELECT * INTO v_existing
    FROM public.board_reactions
    WHERE actor_user_id = v_actor
      AND target_type = 'COMMENT'
      AND comment_id = p_target_id
      AND reaction_group = v_group
      AND cancelled_at IS NULL
    FOR UPDATE;
  END IF;

  IF p_audience_scope = 'EARTH' THEN
    v_pos_col := 'earth_positive_count';
    v_neg_col := 'earth_negative_count';
  ELSE
    v_pos_col := 'alien_positive_count';
    v_neg_col := 'alien_negative_count';
  END IF;

  IF FOUND AND v_existing.id IS NOT NULL THEN
    IF v_existing.reaction_type = p_reaction_type THEN
      UPDATE public.board_reactions
      SET cancelled_at = now(), updated_at = now()
      WHERE id = v_existing.id;
      v_action := 'CANCELLED';
      v_active := false;

      IF v_group = 'POSITIVE' THEN
        IF p_target_type = 'POST' THEN
          EXECUTE format('UPDATE public.board_posts SET %I = GREATEST(%I - 1, 0), updated_at = now() WHERE id = $1', v_pos_col, v_pos_col) USING p_target_id;
        ELSE
          EXECUTE format('UPDATE public.board_comments SET %I = GREATEST(%I - 1, 0), updated_at = now() WHERE id = $1', v_pos_col, v_pos_col) USING p_target_id;
        END IF;
      ELSE
        IF p_target_type = 'POST' THEN
          EXECUTE format('UPDATE public.board_posts SET %I = GREATEST(%I - 1, 0), updated_at = now() WHERE id = $1', v_neg_col, v_neg_col) USING p_target_id;
        ELSE
          EXECUTE format('UPDATE public.board_comments SET %I = GREATEST(%I - 1, 0), updated_at = now() WHERE id = $1', v_neg_col, v_neg_col) USING p_target_id;
        END IF;
      END IF;
    ELSE
      UPDATE public.board_reactions
      SET cancelled_at = now(), updated_at = now()
      WHERE id = v_existing.id;

      INSERT INTO public.board_reactions (
        actor_user_id, target_type, post_id, comment_id, target_author_user_id,
        reaction_type, reaction_group, audience_scope,
        actor_territory_at_reaction, target_author_territory_at_reaction
      ) VALUES (
        v_actor, p_target_type,
        CASE WHEN p_target_type = 'POST' THEN p_target_id ELSE NULL END,
        CASE WHEN p_target_type = 'COMMENT' THEN p_target_id ELSE NULL END,
        v_target_author, p_reaction_type, v_group, p_audience_scope,
        p_actor_territory, p_target_author_territory
      );
      v_action := 'REPLACED';
      v_active := true;
      -- 같은 계열 교체: 집계 수치 변화 없음
    END IF;
  ELSE
    INSERT INTO public.board_reactions (
      actor_user_id, target_type, post_id, comment_id, target_author_user_id,
      reaction_type, reaction_group, audience_scope,
      actor_territory_at_reaction, target_author_territory_at_reaction
    ) VALUES (
      v_actor, p_target_type,
      CASE WHEN p_target_type = 'POST' THEN p_target_id ELSE NULL END,
      CASE WHEN p_target_type = 'COMMENT' THEN p_target_id ELSE NULL END,
      v_target_author, p_reaction_type, v_group, p_audience_scope,
      p_actor_territory, p_target_author_territory
    );
    v_action := 'CREATED';
    v_active := true;

    IF v_group = 'POSITIVE' THEN
      IF p_target_type = 'POST' THEN
        EXECUTE format('UPDATE public.board_posts SET %I = %I + 1, updated_at = now() WHERE id = $1', v_pos_col, v_pos_col) USING p_target_id;
      ELSE
        EXECUTE format('UPDATE public.board_comments SET %I = %I + 1, updated_at = now() WHERE id = $1', v_pos_col, v_pos_col) USING p_target_id;
      END IF;
    ELSE
      IF p_target_type = 'POST' THEN
        EXECUTE format('UPDATE public.board_posts SET %I = %I + 1, updated_at = now() WHERE id = $1', v_neg_col, v_neg_col) USING p_target_id;
      ELSE
        EXECUTE format('UPDATE public.board_comments SET %I = %I + 1, updated_at = now() WHERE id = $1', v_neg_col, v_neg_col) USING p_target_id;
      END IF;
    END IF;
  END IF;

  IF p_target_type = 'POST' THEN
    SELECT * INTO v_post FROM public.board_posts WHERE id = p_target_id;
    RETURN jsonb_build_object(
      'success', true,
      'action', v_action,
      'targetType', 'POST',
      'targetId', p_target_id,
      'reactionType', p_reaction_type,
      'reactionGroup', v_group,
      'active', v_active,
      'counts', jsonb_build_object(
        'earthPositive', v_post.earth_positive_count,
        'earthNegative', v_post.earth_negative_count,
        'alienPositive', v_post.alien_positive_count,
        'alienNegative', v_post.alien_negative_count
      )
    );
  ELSE
    SELECT * INTO v_comment FROM public.board_comments WHERE id = p_target_id;
    RETURN jsonb_build_object(
      'success', true,
      'action', v_action,
      'targetType', 'COMMENT',
      'targetId', p_target_id,
      'reactionType', p_reaction_type,
      'reactionGroup', v_group,
      'active', v_active,
      'counts', jsonb_build_object(
        'earthPositive', v_comment.earth_positive_count,
        'earthNegative', v_comment.earth_negative_count,
        'alienPositive', v_comment.alien_positive_count,
        'alienNegative', v_comment.alien_negative_count
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) TO service_role;

-- alignment dataSource 조회 예시 (EARTH만):
-- SELECT id, actor_user_id, target_author_user_id, reaction_type,
--        actor_territory_at_reaction, target_author_territory_at_reaction,
--        created_at, cancelled_at, audience_scope, target_type,
--        COALESCE(post_id, comment_id) AS target_id
-- FROM public.board_reactions
-- WHERE audience_scope = 'EARTH'
--   AND (created_at >= $1 OR (cancelled_at IS NOT NULL AND cancelled_at >= $1));
