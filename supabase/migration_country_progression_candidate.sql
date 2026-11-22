-- Candidate only. Do not apply to production.
-- One progression row per member and country.
-- Does not split or zero an existing user_progression.reputation_score.
-- A new write with no verified country is rejected.

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
