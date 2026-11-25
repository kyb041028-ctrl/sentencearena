-- Candidate only. Do not apply to production.
-- Country affiliation history. Does not alter profiles.territory.
-- Does not alter alignment_territory_history.
-- There is no HTTP route for this function.

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
