-- Additive: min territory stay 24h on every alignment move.
-- No score rewrite. No profile territory rewrite. No table drop.
-- Replaces alignment_beta_v1_territory_candidate only.

CREATE OR REPLACE FUNCTION public.alignment_beta_v1_territory_candidate(
  p_current text,
  p_score numeric,
  p_last_changed timestamptz,
  p_batch_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cur text := upper(coalesce(p_current, 'CENTRAL'));
  v_candidate text;
BEGIN
  IF v_cur IN ('ALIEN', 'KANTAPBIYA') THEN
    RETURN v_cur;
  END IF;
  IF v_cur = 'CENTRAL' THEN
    IF p_score >= 360 THEN
      v_candidate := 'PIONEER';
    ELSIF p_score <= -360 THEN
      v_candidate := 'GUARDIAN';
    ELSE
      v_candidate := 'CENTRAL';
    END IF;
  ELSIF v_cur = 'PIONEER' THEN
    IF p_score <= 160 THEN
      v_candidate := 'CENTRAL';
    ELSE
      v_candidate := 'PIONEER';
    END IF;
  ELSIF v_cur = 'GUARDIAN' THEN
    IF p_score >= -160 THEN
      v_candidate := 'CENTRAL';
    ELSE
      v_candidate := 'GUARDIAN';
    END IF;
  ELSE
    v_candidate := 'CENTRAL';
  END IF;

  IF v_candidate IS DISTINCT FROM v_cur
     AND p_last_changed IS NOT NULL
     AND p_batch_at IS NOT NULL
     AND (p_batch_at - p_last_changed) < interval '24 hours' THEN
    RETURN v_cur;
  END IF;

  RETURN v_candidate;
END;
$$;
