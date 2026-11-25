-- Candidate only. Do not apply to production.
-- No new table. Replaces the lookup inside the existing follow functions
-- so one member pair can have one row per country.
-- A row with no country stays untouched and is not treated as KR.

ALTER TABLE public.user_follows DROP CONSTRAINT IF EXISTS user_follows_unique;
ALTER TABLE public.user_follows DROP CONSTRAINT IF EXISTS user_follows_follower_user_id_following_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS user_follows_country_pair_uniq
  ON public.user_follows (follower_user_id, following_user_id, activity_region)
  WHERE activity_region IS NOT NULL;

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
