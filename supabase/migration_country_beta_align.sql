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
