-- SentenceArena candidate. NOT APPLIED. Not in the production REQUIRED catalog.
-- Source body: supabase/migration_political_alignment_beta_v1.sql
-- public.toggle_board_reaction(text, uuid, text, text, text, text), read in full before this edit.
-- Keeps RLS, audience counts, cancel, replace, and duplicate guards.
-- Does not delete old reaction rows and does not bulk-clean history.
-- New score and territory copies are written only when that person still has valid separate consent.
-- Territory snapshot columns are currently NOT NULL. This script allows NULL so a withheld copy can be stored as no copy.
-- Apply this whole file together. The function alone cannot store a missing territory copy.

ALTER TABLE public.board_reactions
  ALTER COLUMN actor_territory_at_reaction DROP NOT NULL;

ALTER TABLE public.board_reactions
  ALTER COLUMN target_author_territory_at_reaction DROP NOT NULL;

ALTER TABLE public.board_reactions
  DROP CONSTRAINT IF EXISTS board_reactions_actor_territory_chk;

ALTER TABLE public.board_reactions
  ADD CONSTRAINT board_reactions_actor_territory_chk CHECK (
    actor_territory_at_reaction IS NULL
    OR actor_territory_at_reaction IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN')
  );

ALTER TABLE public.board_reactions
  DROP CONSTRAINT IF EXISTS board_reactions_target_territory_chk;

ALTER TABLE public.board_reactions
  ADD CONSTRAINT board_reactions_target_territory_chk CHECK (
    target_author_territory_at_reaction IS NULL
    OR target_author_territory_at_reaction IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN')
  );

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
  v_actor_score numeric(20, 6) := NULL;
  v_target_score numeric(20, 6) := NULL;
  v_actor_territory_copy text := NULL;
  v_target_territory_copy text := NULL;
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

  -- Lock the two consent rows in uuid order, after the post or comment lock.
  IF v_target_author IS NOT NULL AND v_actor < v_target_author THEN
    PERFORM 1 FROM public.user_legal_consents WHERE user_id = v_actor FOR UPDATE;
    PERFORM 1 FROM public.user_legal_consents WHERE user_id = v_target_author FOR UPDATE;
  ELSIF v_target_author IS NOT NULL AND v_target_author < v_actor THEN
    PERFORM 1 FROM public.user_legal_consents WHERE user_id = v_target_author FOR UPDATE;
    PERFORM 1 FROM public.user_legal_consents WHERE user_id = v_actor FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.user_legal_consents WHERE user_id = v_actor FOR UPDATE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_legal_consents
    WHERE user_id = v_actor
      AND age_requirement_confirmed_at IS NOT NULL
      AND age_policy_version = 'age-policy-v1'
      AND sensitive_political_consented_at IS NOT NULL
      AND sensitive_political_policy_version = 'sensitive-political-v1'
      AND territory_disclosure_consented_at IS NOT NULL
      AND territory_disclosure_policy_version = 'territory-disclosure-v1'
  ) THEN
    v_actor_territory_copy := p_actor_territory;
    SELECT COALESCE((SELECT score FROM public.user_alignment_state WHERE user_id = v_actor), 0)
      INTO v_actor_score;
  END IF;

  IF v_target_author IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_legal_consents
    WHERE user_id = v_target_author
      AND age_requirement_confirmed_at IS NOT NULL
      AND age_policy_version = 'age-policy-v1'
      AND sensitive_political_consented_at IS NOT NULL
      AND sensitive_political_policy_version = 'sensitive-political-v1'
      AND territory_disclosure_consented_at IS NOT NULL
      AND territory_disclosure_policy_version = 'territory-disclosure-v1'
  ) THEN
    v_target_territory_copy := p_target_author_territory;
    SELECT COALESCE((SELECT score FROM public.user_alignment_state WHERE user_id = v_target_author), 0)
      INTO v_target_score;
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
        actor_territory_at_reaction, target_author_territory_at_reaction,
        actor_alignment_score_at_reaction, target_author_alignment_score_at_reaction
      ) VALUES (
        v_actor, p_target_type,
        CASE WHEN p_target_type = 'POST' THEN p_target_id ELSE NULL END,
        CASE WHEN p_target_type = 'COMMENT' THEN p_target_id ELSE NULL END,
        v_target_author, p_reaction_type, v_group, p_audience_scope,
        v_actor_territory_copy, v_target_territory_copy,
        v_actor_score, v_target_score
      );
      v_action := 'REPLACED';
      v_active := true;
    END IF;
  ELSE
    INSERT INTO public.board_reactions (
      actor_user_id, target_type, post_id, comment_id, target_author_user_id,
      reaction_type, reaction_group, audience_scope,
      actor_territory_at_reaction, target_author_territory_at_reaction,
      actor_alignment_score_at_reaction, target_author_alignment_score_at_reaction
    ) VALUES (
      v_actor, p_target_type,
      CASE WHEN p_target_type = 'POST' THEN p_target_id ELSE NULL END,
      CASE WHEN p_target_type = 'COMMENT' THEN p_target_id ELSE NULL END,
      v_target_author, p_reaction_type, v_group, p_audience_scope,
      v_actor_territory_copy, v_target_territory_copy,
      v_actor_score, v_target_score
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
