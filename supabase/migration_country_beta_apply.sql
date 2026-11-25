-- Beta apply entry. Not for production.
-- Run this file once on a new database. Do not append the older country files after it.
-- Login id is the only shared identity. Blank rows are not copied to KR or US.
-- US political alignment is inactive. This file does not create a US score table.
-- Territory changes stay in set_country_territory. There is no HTTP route here.
-- US weekly rank refresh and season close are not scheduled here.
--
-- Confirmed order inside this file:
-- 1. auth.uid and board_reaction_group, only when missing
-- 2. login profile, Korean legacy progression, Korean alignment score
-- 3. country profile, territory history, follows, board, achievement ledger
-- 4. activity_region_norm that keeps NULL unknown
-- 5. country progression, territory, empathy fame, follow
-- 6. toggle_board_reaction country path and legacy 0-score path
-- 7. reaction trigger that does not rewrite NULL to KR

CREATE SCHEMA IF NOT EXISTS auth;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $fn$;
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  territory text NULL
);

CREATE TABLE IF NOT EXISTS public.user_alignment_state (
  user_id uuid PRIMARY KEY,
  score numeric(20, 6)
);

CREATE TABLE IF NOT EXISTS public.user_legal_consents (
  user_id uuid PRIMARY KEY,
  age_requirement_confirmed_at timestamptz,
  age_policy_version text,
  sensitive_political_consented_at timestamptz,
  sensitive_political_policy_version text,
  territory_disclosure_consented_at timestamptz,
  territory_disclosure_policy_version text
);

CREATE TABLE IF NOT EXISTS public.user_progression (
  user_id uuid PRIMARY KEY,
  xp bigint NOT NULL DEFAULT 0,
  level integer NOT NULL DEFAULT 1,
  reputation_score bigint NOT NULL DEFAULT 0,
  follower_count bigint NOT NULL DEFAULT 0
);

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

CREATE TABLE IF NOT EXISTS public.country_progression_grants (
  dedupe_key text PRIMARY KEY,
  user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  xp_delta bigint NOT NULL CHECK (xp_delta >= 0),
  fame_delta bigint NOT NULL CHECK (fame_delta >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.board_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id uuid,
  territory text,
  category_key text,
  board_stage integer DEFAULT 1,
  title text,
  content text,
  is_anonymous boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  activity_region text,
  earth_positive_count integer NOT NULL DEFAULT 0,
  earth_negative_count integer NOT NULL DEFAULT 0,
  alien_positive_count integer NOT NULL DEFAULT 0,
  alien_negative_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.board_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid,
  parent_comment_id uuid,
  author_user_id uuid,
  territory text,
  content text,
  is_anonymous boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  deleted_at timestamptz,
  activity_region text,
  earth_positive_count integer NOT NULL DEFAULT 0,
  earth_negative_count integer NOT NULL DEFAULT 0,
  alien_positive_count integer NOT NULL DEFAULT 0,
  alien_negative_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.board_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  target_type text,
  post_id uuid,
  comment_id uuid,
  target_author_user_id uuid,
  reaction_type text,
  reaction_group text,
  audience_scope text,
  actor_territory_at_reaction text,
  target_author_territory_at_reaction text,
  actor_alignment_score_at_reaction numeric(20, 6),
  target_author_alignment_score_at_reaction numeric(20, 6),
  activity_region text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_user_id uuid NOT NULL,
  following_user_id uuid NOT NULL,
  activity_region text,
  territory_at_follow text,
  cancelled_at timestamptz,
  last_cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_progression_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  event_type text,
  amount bigint,
  source_type text,
  source_id text,
  dedupe_key text UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  activity_region text,
  territory_at_event text,
  cancelled_at timestamptz,
  last_cancelled_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.user_activity_region_achievement (
  user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  achievement_key text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity_region, achievement_key)
);

CREATE OR REPLACE FUNCTION public.grant_country_achievement(
  p_user_id uuid,
  p_region text,
  p_key text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_user_id IS NULL OR p_region IS NULL OR p_region NOT IN ('KR', 'US')
     OR p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'COUNTRY_REQUIRED';
  END IF;
  INSERT INTO public.user_activity_region_achievement (user_id, activity_region, achievement_key)
  VALUES (p_user_id, p_region, btrim(p_key))
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('region', p_region, 'achievement_key', btrim(p_key));
END;
$$;


CREATE OR REPLACE FUNCTION public.activity_region_norm(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL OR btrim(value) = '' THEN NULL
    WHEN upper(btrim(value)) IN ('KR', 'US') THEN upper(btrim(value))
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.activity_region_norm(text) IS
  'New reads and writes. NULL, blank, and invalid values stay unknown. They are not KR.';

CREATE OR REPLACE FUNCTION public.activity_region_legacy_read(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL OR btrim(value) = '' THEN 'UNKNOWN'
    WHEN upper(btrim(value)) IN ('KR', 'US') THEN upper(btrim(value))
    ELSE 'UNKNOWN'
  END;
$$;

COMMENT ON FUNCTION public.activity_region_legacy_read(text) IS
  'Report only. Does not assign an unknown row to KR or US.';

CREATE OR REPLACE FUNCTION public.label_activity_region_if_verified(p_current text, p_verified text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_current IS NOT NULL AND btrim(p_current) <> '' THEN
    IF upper(btrim(p_current)) IN ('KR', 'US') THEN
      RETURN upper(btrim(p_current));
    END IF;
    RETURN NULL;
  END IF;
  IF p_verified IS NULL OR upper(btrim(p_verified)) NOT IN ('KR', 'US') THEN
    RETURN NULL;
  END IF;
  RETURN upper(btrim(p_verified));
END;
$$;

COMMENT ON FUNCTION public.label_activity_region_if_verified(text, text) IS
  'Labels a past row only when the caller already verified KR or US. Does not update rows by itself.';

CREATE OR REPLACE FUNCTION public.country_level_from_xp(p_xp bigint)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_xp >= 1100 THEN 10
    WHEN p_xp >= 800 THEN 9
    WHEN p_xp >= 580 THEN 8
    WHEN p_xp >= 420 THEN 7
    WHEN p_xp >= 300 THEN 6
    WHEN p_xp >= 220 THEN 5
    WHEN p_xp >= 150 THEN 4
    WHEN p_xp >= 90 THEN 3
    WHEN p_xp >= 40 THEN 2
    ELSE 1
  END;
$$;

CREATE OR REPLACE FUNCTION public.apply_country_progression(
  p_user_id uuid,
  p_region text,
  p_xp_delta bigint,
  p_fame_delta bigint,
  p_dedupe_key text
)
RETURNS TABLE (
  out_region text,
  out_xp bigint,
  out_level integer,
  out_fame bigint,
  out_status text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_region text;
  v_xp bigint;
  v_fame bigint;
  v_level integer;
BEGIN
  v_region := public.activity_region_norm(p_region);
  IF v_region IS NULL THEN
    RAISE EXCEPTION 'COUNTRY_REQUIRED';
  END IF;
  IF p_user_id IS NULL OR p_dedupe_key IS NULL OR btrim(p_dedupe_key) = '' THEN
    RAISE EXCEPTION 'PROGRESSION_INPUT_INVALID';
  END IF;
  IF p_xp_delta IS NULL OR p_fame_delta IS NULL OR p_xp_delta < 0 OR p_fame_delta < 0 THEN
    RAISE EXCEPTION 'DELTA_INVALID';
  END IF;

  INSERT INTO public.user_activity_region_profile (user_id, activity_region)
  VALUES (p_user_id, v_region)
  ON CONFLICT (user_id, activity_region) DO NOTHING;

  PERFORM 1
  FROM public.user_activity_region_profile
  WHERE user_id = p_user_id AND activity_region = v_region
  FOR UPDATE;

  INSERT INTO public.country_progression_grants (
    dedupe_key, user_id, activity_region, xp_delta, fame_delta
  ) VALUES (
    p_dedupe_key, p_user_id, v_region, p_xp_delta, p_fame_delta
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT row.activity_region, row.xp, row.level, row.reputation_score, 'DUPLICATE'::text
    FROM public.user_activity_region_profile row
    WHERE row.user_id = p_user_id AND row.activity_region = v_region;
    RETURN;
  END IF;

  UPDATE public.user_activity_region_profile
  SET xp = xp + p_xp_delta,
      reputation_score = reputation_score + p_fame_delta,
      updated_at = now()
  WHERE user_id = p_user_id AND activity_region = v_region
  RETURNING user_activity_region_profile.xp, user_activity_region_profile.reputation_score
  INTO v_xp, v_fame;

  v_level := public.country_level_from_xp(v_xp);
  UPDATE public.user_activity_region_profile
  SET level = v_level
  WHERE user_id = p_user_id AND activity_region = v_region;

  RETURN QUERY
  SELECT v_region, v_xp, v_level, v_fame, 'APPLIED'::text;
END;
$$;

COMMENT ON FUNCTION public.apply_country_progression(uuid, text, bigint, bigint, text) IS
  'Adds XP and fame to one country row. Does not copy the row into user_progression and does not fill an empty country row from the shared table.';

CREATE TABLE IF NOT EXISTS public.country_territory_history (
  history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  from_territory text NULL CHECK (
    from_territory IS NULL OR from_territory IN ('pioneer', 'central', 'guardian', 'alien')
  ),
  to_territory text NOT NULL CHECK (to_territory IN ('pioneer', 'central', 'guardian', 'alien')),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_country_territory(
  p_user_id uuid,
  p_session text,
  p_target text,
  p_territory text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_session text := CASE WHEN upper(btrim(coalesce(p_session, ''))) IN ('KR', 'US')
    THEN upper(btrim(p_session)) ELSE NULL END;
  v_target text := CASE WHEN upper(btrim(coalesce(p_target, ''))) IN ('KR', 'US')
    THEN upper(btrim(p_target)) ELSE NULL END;
  v_territory text := lower(btrim(coalesce(p_territory, '')));
  v_from text;
BEGIN
  IF p_user_id IS NULL OR v_session IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION 'COUNTRY_REQUIRED';
  END IF;
  IF v_session IS DISTINCT FROM v_target THEN
    RAISE EXCEPTION 'REGION_MISMATCH';
  END IF;
  IF v_territory NOT IN ('pioneer', 'central', 'guardian', 'alien') THEN
    RAISE EXCEPTION 'TERRITORY_INVALID';
  END IF;

  SELECT lower(btrim(territory)) INTO v_from
  FROM public.user_activity_region_profile
  WHERE user_id = p_user_id AND activity_region = v_target;
  IF v_from IS NOT NULL AND v_from NOT IN ('pioneer', 'central', 'guardian', 'alien') THEN
    v_from := NULL;
  END IF;

  INSERT INTO public.user_activity_region_profile (user_id, activity_region, territory)
  VALUES (p_user_id, v_target, v_territory)
  ON CONFLICT (user_id, activity_region) DO UPDATE
    SET territory = EXCLUDED.territory, updated_at = now();

  INSERT INTO public.country_territory_history
    (user_id, activity_region, from_territory, to_territory)
  VALUES (p_user_id, v_target, v_from, v_territory);

  RETURN v_territory;
END;
$$;

COMMENT ON FUNCTION public.set_country_territory(uuid, text, text, text) IS
  'Candidate. Isolated use only. Not an HTTP route. Does not write profiles.territory.';

CREATE OR REPLACE FUNCTION public.apply_empathy_fame_with_context(
  p_user_id uuid,
  p_amount bigint,
  p_source_id text,
  p_dedupe_key text,
  p_occurred_at timestamptz,
  p_activity_region text,
  p_territory text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.user_progression%ROWTYPE;
  v_event_id uuid;
  v_new_rep bigint;
  v_existing_id uuid;
  v_existing_cancelled timestamptz;
  v_existing_region text;
  v_existing_territory text;
BEGIN
  IF p_user_id IS NULL OR p_dedupe_key IS NULL OR length(trim(p_dedupe_key)) = 0 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'PROGRESSION_ARGS_INVALID');
  END IF;
  IF p_activity_region IS NULL OR p_activity_region NOT IN ('KR', 'US')
     OR p_territory IS NULL OR length(trim(p_territory)) = 0
     OR p_amount IS NULL THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_UNKNOWN');
  END IF;

  IF to_regclass('public.user_activity_region_profile') IS NOT NULL THEN
    INSERT INTO public.user_activity_region_profile (user_id, activity_region)
    VALUES (p_user_id, p_activity_region)
    ON CONFLICT (user_id, activity_region) DO NOTHING;
    SELECT reputation_score INTO v_new_rep
      FROM public.user_activity_region_profile
     WHERE user_id = p_user_id AND activity_region = p_activity_region
     FOR UPDATE;
  ELSE
    INSERT INTO public.user_progression (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_current
      FROM public.user_progression
     WHERE user_id = p_user_id
     FOR UPDATE;
    v_new_rep := v_current.reputation_score;
  END IF;

  BEGIN
    INSERT INTO public.user_progression_events
      (user_id, event_type, amount, source_type, source_id, dedupe_key, occurred_at, activity_region, territory_at_event)
    VALUES
      (p_user_id, 'EMPATHY_RECEIVED', p_amount, 'EMPATHY', p_source_id, p_dedupe_key,
       COALESCE(p_occurred_at, now()), p_activity_region, p_territory)
    RETURNING id INTO v_event_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, cancelled_at, activity_region, territory_at_event
        INTO v_existing_id, v_existing_cancelled, v_existing_region, v_existing_territory
        FROM public.user_progression_events
       WHERE dedupe_key = p_dedupe_key;
      IF v_existing_id IS NULL OR v_existing_cancelled IS NULL THEN
        RETURN jsonb_build_object('status', 'DUPLICATE', 'code', 'DUPLICATE', 'fameDelta', 0);
      END IF;
      IF v_existing_region IS NULL OR v_existing_territory IS NULL THEN
        RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_UNKNOWN', 'fameDelta', 0);
      END IF;
      IF v_existing_region IS DISTINCT FROM p_activity_region
         OR v_existing_territory IS DISTINCT FROM p_territory THEN
        RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_LOCKED', 'fameDelta', 0);
      END IF;
      UPDATE public.user_progression_events
         SET cancelled_at = NULL
       WHERE id = v_existing_id
         AND last_cancelled_at IS NOT NULL;
      IF to_regclass('public.user_activity_region_profile') IS NOT NULL THEN
        UPDATE public.user_activity_region_profile
           SET reputation_score = reputation_score + GREATEST(0, p_amount),
               updated_at = now()
         WHERE user_id = p_user_id AND activity_region = p_activity_region
         RETURNING reputation_score INTO v_new_rep;
      ELSE
        v_new_rep := GREATEST(0, COALESCE(v_current.reputation_score, 0) + GREATEST(0, p_amount));
        UPDATE public.user_progression
           SET reputation_score = v_new_rep
         WHERE user_id = p_user_id;
      END IF;
      RETURN jsonb_build_object('status', 'APPLIED', 'eventId', v_existing_id, 'fameDelta', p_amount, 'newReputation', v_new_rep, 'regrant', true);
  END;

  IF to_regclass('public.user_activity_region_profile') IS NOT NULL THEN
    UPDATE public.user_activity_region_profile
       SET reputation_score = reputation_score + GREATEST(0, p_amount),
           updated_at = now()
     WHERE user_id = p_user_id AND activity_region = p_activity_region
     RETURNING reputation_score INTO v_new_rep;
  ELSE
    v_new_rep := GREATEST(0, COALESCE(v_current.reputation_score, 0) + GREATEST(0, p_amount));
    UPDATE public.user_progression
       SET reputation_score = v_new_rep
     WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('status', 'APPLIED', 'eventId', v_event_id, 'fameDelta', p_amount, 'newReputation', v_new_rep);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_user_follow_with_context(
  p_follower uuid,
  p_target uuid,
  p_activity_region text,
  p_territory text,
  p_cancel boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_region text;
  v_territory text;
  v_cancelled timestamptz;
BEGIN
  IF p_follower IS NULL OR p_target IS NULL OR p_follower = p_target THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'FOLLOW_ARGS_INVALID');
  END IF;
  IF p_activity_region IS NULL OR p_activity_region NOT IN ('KR', 'US')
     OR p_territory IS NULL OR length(trim(p_territory)) = 0 THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'FOLLOW_SCOPE_UNKNOWN');
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_follower THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'FOLLOW_CALLER_MISMATCH');
  END IF;
  IF NULLIF(upper(btrim(COALESCE(current_setting('request.jwt.claim.country', true), ''))), '') IN ('KR', 'US')
     AND NULLIF(upper(btrim(COALESCE(current_setting('request.jwt.claim.country', true), ''))), '')
         IS DISTINCT FROM p_activity_region THEN
    RETURN jsonb_build_object('status', 'ERROR', 'code', 'REGION_MISMATCH');
  END IF;

  SELECT activity_region, territory_at_follow, cancelled_at
    INTO v_region, v_territory, v_cancelled
    FROM public.user_follows
   WHERE follower_user_id = p_follower
     AND following_user_id = p_target
     AND activity_region = p_activity_region
   FOR UPDATE;

  IF FOUND THEN
    IF v_region IS NULL OR v_territory IS NULL OR length(trim(v_region)) = 0 OR length(trim(v_territory)) = 0 THEN
      RETURN jsonb_build_object('status', 'ERROR', 'code', 'FOLLOW_BASELINE_UNKNOWN');
    END IF;
    IF v_territory IS DISTINCT FROM p_territory THEN
      RETURN jsonb_build_object('status', 'ERROR', 'code', 'CONTEXT_LOCKED');
    END IF;
    IF COALESCE(p_cancel, false) THEN
      IF v_cancelled IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'NOT_FOUND', 'code', 'FOLLOW_NOT_FOUND');
      END IF;
      UPDATE public.user_follows
         SET cancelled_at = now(),
             last_cancelled_at = now()
       WHERE follower_user_id = p_follower
         AND following_user_id = p_target
         AND activity_region = p_activity_region;
      RETURN jsonb_build_object('status', 'CANCELLED');
    END IF;
    IF v_cancelled IS NULL THEN
      RETURN jsonb_build_object('status', 'DUPLICATE', 'code', 'DUPLICATE');
    END IF;
    UPDATE public.user_follows
       SET cancelled_at = NULL
     WHERE follower_user_id = p_follower
       AND following_user_id = p_target
       AND activity_region = p_activity_region
       AND last_cancelled_at IS NOT NULL;
    RETURN jsonb_build_object('status', 'FOLLOWED');
  END IF;

  IF COALESCE(p_cancel, false) THEN
    RETURN jsonb_build_object('status', 'NOT_FOUND', 'code', 'FOLLOW_NOT_FOUND');
  END IF;
  INSERT INTO public.user_follows
    (follower_user_id, following_user_id, activity_region, territory_at_follow)
  VALUES
    (p_follower, p_target, p_activity_region, p_territory);
  RETURN jsonb_build_object('status', 'FOLLOWED');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'DUPLICATE', 'code', 'DUPLICATE');
END;
$$;

CREATE OR REPLACE FUNCTION public.isolate_follow_once(
  p_follower uuid,
  p_target uuid,
  p_activity_region text,
  p_territory text,
  p_cancel boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_region text;
  v_territory text;
  v_cancelled timestamptz;
  v_count bigint;
  v_result jsonb;
BEGIN
  SELECT activity_region, territory_at_follow, cancelled_at
    INTO v_region, v_territory, v_cancelled
    FROM public.user_follows
   WHERE follower_user_id = p_follower
     AND following_user_id = p_target
     AND activity_region = p_activity_region
   FOR UPDATE;
  IF FOUND AND NOT COALESCE(p_cancel, false) AND v_cancelled IS NULL THEN
    SELECT count(*) INTO v_count
      FROM public.user_follows
     WHERE following_user_id = p_target
       AND activity_region = p_activity_region
       AND cancelled_at IS NULL;
    RETURN jsonb_build_object(
      'status', 'EXISTING',
      'code', CASE WHEN v_region IS NULL OR v_territory IS NULL THEN 'FOLLOW_BASELINE_UNKNOWN' ELSE 'DUPLICATE' END,
      'legacy', false,
      'changed', false,
      'followerCount', v_count
    );
  END IF;
  -- Country path records the row only. The shared follower_count is not a country counter.
  v_result := public.record_user_follow_with_context(
    p_follower, p_target, p_activity_region, p_territory, p_cancel
  );
  SELECT count(*) INTO v_count
    FROM public.user_follows
   WHERE following_user_id = p_target
     AND activity_region = p_activity_region
     AND cancelled_at IS NULL;
  RETURN v_result || jsonb_build_object('followerCount', COALESCE(v_count, 0), 'sharedCounterChanged', false);
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
  v_actor_score numeric(20, 6) := NULL;
  v_target_score numeric(20, 6) := NULL;
  v_content_region text := NULL;
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

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'board_posts' AND column_name = 'activity_region'
  ) THEN
    -- Legacy path: the country column is absent, so the old Korean 0-score copy stays.
    v_actor_territory_copy := p_actor_territory;
    v_target_territory_copy := p_target_author_territory;
    SELECT COALESCE((SELECT score FROM public.user_alignment_state WHERE user_id = v_actor), 0)
      INTO v_actor_score;
    SELECT COALESCE((SELECT score FROM public.user_alignment_state WHERE user_id = v_target_author), 0)
      INTO v_target_score;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'board_posts' AND column_name = 'activity_region'
  ) THEN
    IF p_target_type = 'POST' THEN
      EXECUTE 'SELECT activity_region FROM public.board_posts WHERE id = $1' INTO v_content_region USING p_target_id;
    ELSE
      EXECUTE 'SELECT activity_region FROM public.board_comments WHERE id = $1' INTO v_content_region USING p_target_id;
    END IF;
  END IF;
  IF v_content_region IS NOT NULL AND btrim(v_content_region) = '' THEN
    v_content_region := NULL;
  END IF;
  IF v_content_region IS NULL AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'board_posts' AND column_name = 'activity_region'
  ) THEN
    RAISE EXCEPTION 'COUNTRY_REQUIRED';
  END IF;
  IF v_content_region IN ('KR', 'US')
     AND NULLIF(upper(btrim(COALESCE(current_setting('request.jwt.claim.country', true), ''))), '') IN ('KR', 'US')
     AND NULLIF(upper(btrim(COALESCE(current_setting('request.jwt.claim.country', true), ''))), '')
         IS DISTINCT FROM v_content_region THEN
    RAISE EXCEPTION 'REGION_MISMATCH';
  END IF;

  -- Country path only. The legacy branch above already copied the Korean 0-score rule.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'board_posts' AND column_name = 'activity_region'
  ) THEN
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
    IF v_content_region IS DISTINCT FROM 'US' THEN
      SELECT score INTO v_actor_score FROM public.user_alignment_state WHERE user_id = v_actor;
    END IF;
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
    IF v_content_region IS DISTINCT FROM 'US' THEN
      SELECT score INTO v_target_score FROM public.user_alignment_state WHERE user_id = v_target_author;
    END IF;
  END IF;
  END IF;

  IF p_audience_scope = 'EARTH' THEN
    v_pos_col := 'earth_positive_count';
    v_neg_col := 'earth_negative_count';
  ELSE
    v_pos_col := 'alien_positive_count';
    v_neg_col := 'alien_negative_count';
  END IF;

  IF v_existing.id IS NOT NULL THEN
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

-- Parent country is copied only when it is already KR or US.
-- A blank parent is left blank. It is not rewritten to KR.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'board_reactions' AND column_name = 'activity_region'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'board_posts' AND column_name = 'activity_region'
  ) THEN
    CREATE OR REPLACE FUNCTION public.board_reaction_same_activity_region()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
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
      IF parent_region IS NOT NULL THEN
        parent_region := btrim(parent_region);
        IF parent_region = '' THEN
          parent_region := NULL;
        END IF;
      END IF;
      IF parent_region IS NULL OR parent_region NOT IN ('KR', 'US') THEN
        IF NEW.activity_region IS NOT NULL AND btrim(NEW.activity_region) <> '' THEN
          RAISE EXCEPTION 'REGION_MISMATCH';
        END IF;
        NEW.activity_region := NULL;
        RETURN NEW;
      END IF;
      IF NEW.activity_region IS NULL OR btrim(NEW.activity_region) = '' THEN
        NEW.activity_region := parent_region;
      ELSIF upper(btrim(NEW.activity_region)) IS DISTINCT FROM parent_region THEN
        RAISE EXCEPTION 'REGION_MISMATCH';
      ELSE
        NEW.activity_region := parent_region;
      END IF;
      RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS board_reactions_same_activity_region ON public.board_reactions;
    CREATE TRIGGER board_reactions_same_activity_region
      BEFORE INSERT OR UPDATE ON public.board_reactions
      FOR EACH ROW
      EXECUTE PROCEDURE public.board_reaction_same_activity_region();
  END IF;
END $$;

-- Added by the beta entry after tables exist.
-- Adds missing columns on an already-created database.
-- A different data type is an error. Blank country values are not rewritten.

CREATE OR REPLACE FUNCTION public.country_beta_require_column(
  p_table text,
  p_column text,
  p_sql_type text,
  p_data_type text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_type text;
  v_udt text;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN
    RETURN;
  END IF;
  SELECT c.data_type, c.udt_name
    INTO v_type, v_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = p_table
    AND c.column_name = p_column;
  IF v_type IS NULL THEN
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN %I %s', p_table, p_column, p_sql_type);
    RETURN;
  END IF;
  IF v_type IS DISTINCT FROM p_data_type AND COALESCE(v_udt, '') IS DISTINCT FROM p_data_type THEN
    RAISE EXCEPTION 'COUNTRY_BETA_COLUMN_TYPE_MISMATCH: %.% is % (%), expected %',
      p_table, p_column, v_type, v_udt, p_data_type;
  END IF;
END;
$$;

SELECT public.country_beta_require_column('board_posts', 'activity_region', 'text', 'text');
SELECT public.country_beta_require_column('board_comments', 'activity_region', 'text', 'text');
SELECT public.country_beta_require_column('board_reactions', 'activity_region', 'text', 'text');
SELECT public.country_beta_require_column('board_reactions', 'actor_alignment_score_at_reaction', 'numeric(20,6)', 'numeric');
SELECT public.country_beta_require_column('board_reactions', 'target_author_alignment_score_at_reaction', 'numeric(20,6)', 'numeric');
SELECT public.country_beta_require_column('user_follows', 'activity_region', 'text', 'text');
SELECT public.country_beta_require_column('user_follows', 'territory_at_follow', 'text', 'text');
SELECT public.country_beta_require_column('user_follows', 'cancelled_at', 'timestamptz', 'timestamp with time zone');
SELECT public.country_beta_require_column('user_follows', 'last_cancelled_at', 'timestamptz', 'timestamp with time zone');
SELECT public.country_beta_require_column('user_progression_events', 'activity_region', 'text', 'text');
SELECT public.country_beta_require_column('user_progression_events', 'territory_at_event', 'text', 'text');
SELECT public.country_beta_require_column('user_progression_events', 'cancelled_at', 'timestamptz', 'timestamp with time zone');
SELECT public.country_beta_require_column('user_progression_events', 'last_cancelled_at', 'timestamptz', 'timestamp with time zone');
SELECT public.country_beta_require_column('user_activity_region_profile', 'territory', 'text', 'text');
SELECT public.country_beta_require_column('user_activity_region_profile', 'xp', 'bigint', 'bigint');
SELECT public.country_beta_require_column('user_activity_region_profile', 'level', 'integer', 'integer');
SELECT public.country_beta_require_column('user_activity_region_profile', 'reputation_score', 'bigint', 'bigint');
SELECT public.country_beta_require_column('user_legal_consents', 'territory_disclosure_consented_at', 'timestamptz', 'timestamp with time zone');
SELECT public.country_beta_require_column('user_legal_consents', 'territory_disclosure_policy_version', 'text', 'text');
SELECT public.country_beta_require_column('user_notifications', 'activity_region', 'text', 'text');
SELECT public.country_beta_require_column('user_activity_events', 'activity_region', 'text', 'text');

CREATE UNIQUE INDEX IF NOT EXISTS user_follows_country_pair_uniq
  ON public.user_follows (follower_user_id, following_user_id, activity_region)
  WHERE activity_region IS NOT NULL;

ALTER TABLE public.user_follows DROP CONSTRAINT IF EXISTS user_follows_unique;
ALTER TABLE public.user_follows DROP CONSTRAINT IF EXISTS user_follows_follower_user_id_following_user_id_key;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

ALTER TABLE public.user_activity_region_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_region_achievement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_progression_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_territory_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.country_beta_ensure_policy(
  p_table text,
  p_name text,
  p_create text,
  p_must_contain text
)
RETURNS void
LANGUAGE plpgsql
AS $ensure$
DECLARE
  v_qual text;
  v_check text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid)
    INTO v_qual, v_check
  FROM pg_policy pol
  JOIN pg_class cls ON cls.oid = pol.polrelid
  JOIN pg_namespace ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = 'public' AND cls.relname = p_table AND pol.polname = p_name;
  IF NOT FOUND THEN
    EXECUTE p_create;
    RETURN;
  END IF;
  IF position(p_must_contain in COALESCE(v_qual, '') || ' ' || COALESCE(v_check, '')) = 0 THEN
    RAISE EXCEPTION 'COUNTRY_BETA_POLICY_CONFLICT: %.% exists with a different scope. This file will not drop it. qual=% with_check=%',
      p_table, p_name, v_qual, v_check;
  END IF;
END;
$ensure$;

DO $follow$
DECLARE
  v_qual text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_qual
  FROM pg_policy pol
  JOIN pg_class cls ON cls.oid = pol.polrelid
  JOIN pg_namespace ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = 'public' AND cls.relname = 'user_follows' AND pol.polname = 'user_follows_select_all';
  IF FOUND AND btrim(v_qual) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'COUNTRY_BETA_POLICY_CONFLICT: user_follows_select_all exists and is not the repository USING (true) policy. This file will not drop it. qual=%', v_qual;
  END IF;
  IF FOUND AND btrim(v_qual) = 'true' THEN
    EXECUTE 'DROP POLICY user_follows_select_all ON public.user_follows';
  END IF;
END;
$follow$;

SELECT public.country_beta_ensure_policy(
  'user_activity_region_profile',
  'country_beta_profile_select_own',
  'CREATE POLICY country_beta_profile_select_own ON public.user_activity_region_profile FOR SELECT TO authenticated USING (user_id = auth.uid())',
  'user_id = auth.uid()'
);
SELECT public.country_beta_ensure_policy(
  'user_activity_region_achievement',
  'country_beta_achievement_select_own',
  'CREATE POLICY country_beta_achievement_select_own ON public.user_activity_region_achievement FOR SELECT TO authenticated USING (user_id = auth.uid())',
  'user_id = auth.uid()'
);
SELECT public.country_beta_ensure_policy(
  'country_territory_history',
  'country_beta_territory_select_own',
  'CREATE POLICY country_beta_territory_select_own ON public.country_territory_history FOR SELECT TO authenticated USING (user_id = auth.uid())',
  'user_id = auth.uid()'
);
SELECT public.country_beta_ensure_policy(
  'user_follows',
  'country_beta_follow_select_party',
  'CREATE POLICY country_beta_follow_select_party ON public.user_follows FOR SELECT TO authenticated USING (follower_user_id = auth.uid() OR following_user_id = auth.uid())',
  'follower_user_id = auth.uid()'
);
SELECT public.country_beta_ensure_policy(
  'user_follows',
  'country_beta_follow_insert_own',
  $create$CREATE POLICY country_beta_follow_insert_own ON public.user_follows FOR INSERT TO authenticated WITH CHECK (follower_user_id = auth.uid() AND activity_region = NULLIF(upper(btrim(COALESCE(current_setting('request.jwt.claim.country', true), ''))), ''))$create$,
  'follower_user_id = auth.uid()'
);

REVOKE ALL ON public.user_activity_region_profile FROM anon, authenticated;
REVOKE ALL ON public.user_activity_region_achievement FROM anon, authenticated;
REVOKE ALL ON public.country_progression_grants FROM anon, authenticated;
REVOKE ALL ON public.country_territory_history FROM anon, authenticated;
GRANT SELECT ON public.user_activity_region_profile TO authenticated;
GRANT SELECT ON public.user_activity_region_achievement TO authenticated;
GRANT SELECT ON public.country_territory_history TO authenticated;
GRANT SELECT ON public.user_follows TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.user_legal_consents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_legal_consents ENABLE ROW LEVEL SECURITY';
    PERFORM public.country_beta_ensure_policy(
      'user_legal_consents',
      'country_beta_consent_select_own',
      'CREATE POLICY country_beta_consent_select_own ON public.user_legal_consents FOR SELECT TO authenticated USING (user_id = auth.uid())',
      'user_id = auth.uid()'
    );
    EXECUTE 'REVOKE ALL ON public.user_legal_consents FROM anon, authenticated';
    EXECUTE 'GRANT SELECT ON public.user_legal_consents TO authenticated';
  END IF;
  IF to_regclass('public.user_notifications') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY';
    PERFORM public.country_beta_ensure_policy(
      'user_notifications',
      'country_beta_notification_select_own',
      'CREATE POLICY country_beta_notification_select_own ON public.user_notifications FOR SELECT TO authenticated USING (user_id = auth.uid())',
      'user_id = auth.uid()'
    );
    EXECUTE 'REVOKE ALL ON public.user_notifications FROM anon';
  END IF;
  IF to_regclass('public.user_activity_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_activity_events ENABLE ROW LEVEL SECURITY';
    PERFORM public.country_beta_ensure_policy(
      'user_activity_events',
      'country_beta_activity_select_own',
      'CREATE POLICY country_beta_activity_select_own ON public.user_activity_events FOR SELECT TO authenticated USING (user_id = auth.uid())',
      'user_id = auth.uid()'
    );
    EXECUTE 'REVOKE ALL ON public.user_activity_events FROM anon';
  END IF;
  IF to_regclass('public.leader_rank_members') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.leader_rank_members ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.leader_rank_members FROM anon, authenticated';
  END IF;
  IF to_regclass('public.leader_offices') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.leader_offices ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.leader_offices FROM anon, authenticated';
  END IF;
  IF to_regclass('public.board_posts') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.board_posts ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'board_posts' AND cmd = 'SELECT'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY board_posts_select_visible
          ON public.board_posts FOR SELECT TO authenticated
          USING (status IN ('ACTIVE', 'DELETED', 'BLINDED', 'HIDDEN_BY_OPERATOR'))
      $pol$;
    END IF;
    PERFORM public.country_beta_ensure_policy(
      'board_posts',
      'country_beta_post_country_update',
      $pol$CREATE POLICY country_beta_post_country_update ON public.board_posts AS RESTRICTIVE FOR UPDATE TO authenticated USING (activity_region = NULLIF(upper(btrim(COALESCE(current_setting('request.jwt.claim.country', true), ''))), '')) WITH CHECK (activity_region = NULLIF(upper(btrim(COALESCE(current_setting('request.jwt.claim.country', true), ''))), ''))$pol$,
      'activity_region'
    );
    PERFORM public.country_beta_ensure_policy(
      'board_posts',
      'country_beta_post_country_insert',
      $pol$CREATE POLICY country_beta_post_country_insert ON public.board_posts AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (activity_region = NULLIF(upper(btrim(COALESCE(current_setting('request.jwt.claim.country', true), ''))), ''))$pol$,
      'activity_region'
    );
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_country_territory(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_country_territory(uuid, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.apply_country_progression(uuid, text, bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_country_progression(uuid, text, bigint, bigint, text) TO service_role;
REVOKE ALL ON FUNCTION public.grant_country_achievement(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_country_achievement(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.apply_empathy_fame_with_context(uuid, bigint, text, text, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_empathy_fame_with_context(uuid, bigint, text, text, timestamptz, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.record_user_follow_with_context(uuid, uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_user_follow_with_context(uuid, uuid, text, text, boolean) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.country_beta_apply_entry()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'migration_country_beta_apply.sql'::text;
$$;

COMMENT ON FUNCTION public.country_beta_apply_entry() IS
  'Single beta entry marker. Do not apply a NULL-to-KR activity_region_norm after this file.';
