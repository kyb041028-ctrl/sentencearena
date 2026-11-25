-- Candidate only. Apply separately to the achievement database after review.
-- Prerequisites: canonical grant RPC and activity_region_v2. No dates are seeded.
BEGIN;
CREATE TABLE IF NOT EXISTS public.achievement_beta_windows (
  activity_region text PRIMARY KEY CHECK (activity_region IN ('KR', 'US')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (starts_at < ends_at)
);
CREATE TABLE IF NOT EXISTS public.achievement_verified_bugs (
  bug_key text PRIMARY KEY CHECK (bug_key ~ '^[a-z0-9][a-z0-9._:-]{2,119}$'),
  inquiry_id uuid NOT NULL UNIQUE,
  reporter_user_id uuid NOT NULL UNIQUE,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  accepted_by uuid NOT NULL,
  verification_evidence text NOT NULL CHECK (char_length(btrim(verification_evidence)) BETWEEN 10 AND 2000),
  accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.achievement_beta_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_verified_bugs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.achievement_beta_windows, public.achievement_verified_bugs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.achievement_beta_windows TO service_role;
GRANT SELECT ON public.achievement_verified_bugs TO service_role;

ALTER TABLE public.user_activity_region_achievement
  ADD COLUMN IF NOT EXISTS acquisition_sequence bigserial;
-- Preserve legacy grants without replaying their alerts. Do this only when adding
-- the column; a migration retry must not mark newer, unseen grants as displayed.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='user_activity_region_achievement' AND column_name='acquisition_notified_at') THEN
    ALTER TABLE public.user_activity_region_achievement ADD COLUMN acquisition_notified_at timestamptz;
    UPDATE public.user_activity_region_achievement SET acquisition_notified_at=acquired_at;
  END IF;
END; $$;
ALTER TABLE public.user_activity_region_achievement
  ADD COLUMN IF NOT EXISTS featured_slot smallint CHECK (featured_slot BETWEEN 1 AND 3);
CREATE UNIQUE INDEX IF NOT EXISTS region_achievement_featured_slot
  ON public.user_activity_region_achievement(user_id, activity_region, featured_slot)
  WHERE featured_slot IS NOT NULL;

-- Internal helper: cannot be invoked by API roles. KR uses the existing canonical
-- grant/notification sequence; US writes only the regional achievement ledger.
CREATE OR REPLACE FUNCTION public.grant_special_achievement_internal(p_user_id uuid, p_region text, p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.user_activity_region_achievement%ROWTYPE;
BEGIN
  IF p_region NOT IN ('KR','US') OR p_region IS NULL OR p_key NOT IN ('beta-citizen','bug-busters') THEN
    RAISE EXCEPTION 'SPECIAL_ACHIEVEMENT_INPUT_INVALID';
  END IF;
  IF p_region = 'KR' THEN
    RETURN public.grant_user_achievement(p_user_id, p_key, NULL, NULL, NULL, '{}'::jsonb);
  END IF;
  INSERT INTO public.user_activity_region_achievement(user_id, activity_region, achievement_key)
    VALUES(p_user_id, 'US', p_key) ON CONFLICT DO NOTHING RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'ALREADY_GRANTED'); END IF;
  RETURN jsonb_build_object('status','GRANTED','achievement_key',p_key,
    'acquired_at',v_row.acquired_at,'acquisition_sequence',v_row.acquisition_sequence,'season_key',NULL);
END; $$;
REVOKE ALL ON FUNCTION public.grant_special_achievement_internal(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;

-- Only a trusted server calls this immediately after a successful content write.
-- No login, signup, reaction, read or client-supplied date can satisfy it.
CREATE OR REPLACE FUNCTION public.grant_beta_participation(p_user_id uuid, p_region text, p_action text, p_source_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL OR p_region IS NULL OR p_region NOT IN ('KR','US')
    OR p_action IS NULL OR p_action NOT IN ('POST','BOARD_COMMENT','ISSUE_COMMENT')
    OR nullif(btrim(p_source_id),'') IS NULL THEN
    RAISE EXCEPTION 'BETA_PARTICIPATION_INVALID';
  END IF;
  -- [start, end): missing/invalid configuration fails closed, independently per country.
  IF NOT EXISTS (SELECT 1 FROM public.achievement_beta_windows
    WHERE activity_region = p_region AND starts_at <= now() AND now() < ends_at) THEN
    RETURN jsonb_build_object('status','BETA_WINDOW_INACTIVE');
  END IF;
  RETURN public.grant_special_achievement_internal(p_user_id,p_region,'beta-citizen');
END; $$;
REVOKE ALL ON FUNCTION public.grant_beta_participation(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_beta_participation(uuid,text,text,text) TO service_role;

-- Owner authorization and inquiry ownership/kind/region are resolved by the HTTP
-- guard and inquiry store, never from a reporter/userId in the browser body.
-- Evidence and deduplication receipt commit atomically with the grant, even on retry.
CREATE OR REPLACE FUNCTION public.accept_verified_bug_achievement(
  p_inquiry_id uuid, p_user_id uuid, p_region text, p_bug_key text, p_owner_id uuid, p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.achievement_verified_bugs%ROWTYPE;
BEGIN
  IF p_inquiry_id IS NULL OR p_user_id IS NULL OR p_owner_id IS NULL
    OR p_region IS NULL OR p_region NOT IN ('KR','US')
    OR p_bug_key IS NULL OR p_bug_key !~ '^[a-z0-9][a-z0-9._:-]{2,119}$'
    OR p_evidence IS NULL OR char_length(btrim(p_evidence)) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'BUG_VERIFICATION_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(92481734, hashtext(p_user_id::text));
  SELECT * INTO v_existing FROM public.achievement_verified_bugs WHERE reporter_user_id = p_user_id;
  IF FOUND THEN RETURN jsonb_build_object('status','ALREADY_GRANTED'); END IF;
  INSERT INTO public.achievement_verified_bugs(bug_key,inquiry_id,reporter_user_id,activity_region,accepted_by,verification_evidence)
    VALUES(p_bug_key,p_inquiry_id,p_user_id,p_region,p_owner_id,btrim(p_evidence)) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','DUPLICATE_BUG'); END IF;
  RETURN public.grant_special_achievement_internal(p_user_id,p_region,'bug-busters');
END; $$;
REVOKE ALL ON FUNCTION public.accept_verified_bug_achievement(uuid,uuid,text,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_verified_bug_achievement(uuid,uuid,text,text,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_us_featured_achievements(p_user_id uuid, p_keys text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(92481735, hashtext(p_user_id::text));
  IF p_keys IS NULL OR cardinality(p_keys) > 3 OR
    cardinality(p_keys) <> (SELECT count(DISTINCT k) FROM unnest(p_keys) k) OR
    EXISTS (SELECT 1 FROM unnest(p_keys) k WHERE NOT EXISTS
      (SELECT 1 FROM public.user_activity_region_achievement a
       WHERE a.user_id=p_user_id AND a.activity_region='US' AND a.achievement_key=k)) THEN
    RAISE EXCEPTION 'FEATURED_KEYS_INVALID';
  END IF;
  UPDATE public.user_activity_region_achievement SET featured_slot=NULL WHERE user_id=p_user_id AND activity_region='US';
  UPDATE public.user_activity_region_achievement a SET featured_slot=s.ord
    FROM unnest(p_keys) WITH ORDINALITY s(k,ord)
    WHERE a.user_id=p_user_id AND a.activity_region='US' AND a.achievement_key=s.k;
  RETURN jsonb_build_object('status','SAVED');
END; $$;
REVOKE ALL ON FUNCTION public.set_us_featured_achievements(uuid,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_us_featured_achievements(uuid,text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_us_achievement_notified(p_user_id uuid, p_key text, p_sequence bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.user_activity_region_achievement%ROWTYPE;
BEGIN
  UPDATE public.user_activity_region_achievement
    SET acquisition_notified_at=coalesce(acquisition_notified_at,now())
    WHERE user_id=p_user_id AND activity_region='US' AND achievement_key=p_key AND acquisition_sequence=p_sequence
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACHIEVEMENT_NOT_OWNED'; END IF;
  RETURN to_jsonb(v_row) || jsonb_build_object('status','NOTIFIED');
END; $$;
REVOKE ALL ON FUNCTION public.mark_us_achievement_notified(uuid,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_us_achievement_notified(uuid,text,bigint) TO service_role;
COMMIT;
