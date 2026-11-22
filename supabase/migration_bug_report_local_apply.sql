-- Local isolated bug-report apply. Not for production.
-- Supplements admin_inquiries with a country column and the existing
-- owner-accepted bug achievement function. Do not apply this file to production.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.admin_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'RECEIVED',
  internal_note text NULL,
  author_user_id uuid NULL,
  content_hash text NULL,
  activity_region text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT admin_inquiries_kind_chk CHECK (kind IN ('BUG', 'IMPROVEMENT', 'GENERAL')),
  CONSTRAINT admin_inquiries_status_chk CHECK (status IN ('RECEIVED', 'IN_PROGRESS', 'DONE', 'ON_HOLD')),
  CONSTRAINT admin_inquiries_title_len_chk CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT admin_inquiries_note_len_chk CHECK (internal_note IS NULL OR char_length(internal_note) <= 2000),
  CONSTRAINT admin_inquiries_region_chk CHECK (activity_region IS NULL OR activity_region IN ('KR', 'US'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_inquiries_open_dup
  ON public.admin_inquiries (author_user_id, content_hash)
  WHERE author_user_id IS NOT NULL AND content_hash IS NOT NULL AND status <> 'DONE';

CREATE TABLE IF NOT EXISTS public.admin_inquiry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES public.admin_inquiries (id),
  actor_user_id uuid NULL,
  event_type text NOT NULL,
  from_status text NULL,
  to_status text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_inquiry_events_type_chk CHECK (event_type IN ('STATUS_CHANGED', 'NOTE_UPDATED'))
);

CREATE OR REPLACE FUNCTION public.admin_inquiry_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ADMIN_INQUIRY_EVENTS_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_inquiry_events_append_only ON public.admin_inquiry_events;
CREATE TRIGGER trg_admin_inquiry_events_append_only
BEFORE UPDATE OR DELETE ON public.admin_inquiry_events
FOR EACH ROW EXECUTE PROCEDURE public.admin_inquiry_events_append_only();

CREATE TABLE IF NOT EXISTS public.user_achievements (
  user_id uuid NOT NULL,
  achievement_key text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  acquisition_sequence bigint NOT NULL,
  season_key text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_achievements_no_season_uniq
  ON public.user_achievements (user_id, achievement_key) WHERE season_key IS NULL;

CREATE TABLE IF NOT EXISTS public.user_activity_region_achievement (
  user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  achievement_key text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  acquisition_sequence bigserial,
  PRIMARY KEY (user_id, activity_region, achievement_key)
);

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  notification_type text NOT NULL,
  title text NULL,
  message text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS public.achievement_verified_bugs (
  bug_key text PRIMARY KEY CHECK (bug_key ~ '^[a-z0-9][a-z0-9._:-]{2,119}$'),
  inquiry_id uuid NOT NULL UNIQUE,
  reporter_user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  accepted_by uuid NOT NULL,
  verification_evidence text NOT NULL CHECK (char_length(btrim(verification_evidence)) BETWEEN 10 AND 2000),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_user_id, activity_region)
);

CREATE OR REPLACE FUNCTION public.grant_user_achievement(
  p_user_id uuid, p_achievement_key text, p_acquired_at timestamptz,
  p_acquisition_sequence bigint, p_season_key text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seq bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_achievements
    WHERE user_id = p_user_id AND achievement_key = p_achievement_key AND season_key IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'ALREADY_GRANTED', 'achievement_key', p_achievement_key);
  END IF;
  SELECT COALESCE(MAX(acquisition_sequence), 0) + 1 INTO v_seq
    FROM public.user_achievements WHERE user_id = p_user_id;
  INSERT INTO public.user_achievements (user_id, achievement_key, acquired_at, acquisition_sequence, season_key, metadata)
  VALUES (p_user_id, p_achievement_key, now(), v_seq, p_season_key, COALESCE(p_metadata, '{}'::jsonb));
  RETURN jsonb_build_object('status', 'GRANTED', 'achievement_key', p_achievement_key, 'acquisition_sequence', v_seq);
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_special_achievement_internal(p_user_id uuid, p_region text, p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.user_activity_region_achievement%ROWTYPE;
BEGIN
  IF p_region NOT IN ('KR', 'US') OR p_key <> 'bug-busters' THEN
    RAISE EXCEPTION 'SPECIAL_ACHIEVEMENT_INPUT_INVALID';
  END IF;
  IF p_region = 'KR' THEN
    PERFORM public.grant_user_achievement(p_user_id, p_key, NULL, NULL, NULL, '{}'::jsonb);
  END IF;
  INSERT INTO public.user_activity_region_achievement (user_id, activity_region, achievement_key)
  VALUES (p_user_id, p_region, p_key)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_row;
  INSERT INTO public.user_notifications (user_id, notification_type, title, message, dedupe_key, payload)
  VALUES (
    p_user_id,
    'ACHIEVEMENT_GRANTED',
    CASE WHEN p_region = 'US' THEN 'Bug Busters' ELSE '센스코' END,
    CASE WHEN p_region = 'US' THEN 'Bug Busters' ELSE '센스코' END,
    'bug-busters:' || p_region || ':' || p_user_id::text,
    jsonb_build_object('achievement', 'bug-busters', 'region', p_region)
  );
  RETURN jsonb_build_object(
    'status', 'GRANTED',
    'achievement_key', p_key,
    'acquired_at', COALESCE(v_row.acquired_at, now()),
    'acquisition_sequence', v_row.acquisition_sequence
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_verified_bug_achievement(
  p_inquiry_id uuid, p_user_id uuid, p_region text, p_bug_key text, p_owner_id uuid, p_evidence text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing public.achievement_verified_bugs%ROWTYPE;
BEGIN
  IF p_inquiry_id IS NULL OR p_user_id IS NULL OR p_owner_id IS NULL
    OR p_region IS NULL OR p_region NOT IN ('KR', 'US')
    OR p_bug_key IS NULL OR p_bug_key !~ '^[a-z0-9][a-z0-9._:-]{2,119}$'
    OR p_evidence IS NULL OR char_length(btrim(p_evidence)) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'BUG_VERIFICATION_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(92481734, hashtext(p_user_id::text));
  SELECT * INTO v_existing FROM public.achievement_verified_bugs
    WHERE reporter_user_id = p_user_id AND activity_region = p_region;
  IF FOUND THEN RETURN jsonb_build_object('status', 'ALREADY_GRANTED'); END IF;
  INSERT INTO public.achievement_verified_bugs (bug_key, inquiry_id, reporter_user_id, activity_region, accepted_by, verification_evidence)
  VALUES (p_bug_key, p_inquiry_id, p_user_id, p_region, p_owner_id, btrim(p_evidence))
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'DUPLICATE_BUG'); END IF;
  RETURN public.grant_special_achievement_internal(p_user_id, p_region, 'bug-busters');
END;
$$;

ALTER TABLE public.admin_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_inquiry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_region_achievement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_verified_bugs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_inquiries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.admin_inquiry_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_achievements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_activity_region_achievement FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.achievement_verified_bugs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_verified_bug_achievement(uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_special_achievement_internal(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_user_achievement(uuid, text, timestamptz, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.admin_inquiries TO service_role;
GRANT SELECT, INSERT ON public.admin_inquiry_events TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_verified_bug_achievement(uuid, uuid, text, text, uuid, text) TO service_role;
