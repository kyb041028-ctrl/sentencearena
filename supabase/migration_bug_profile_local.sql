-- Isolated profile + bug-report supplement. Not for production.
-- Adds inquiry storage and country achievement columns onto an existing
-- country schema. Does not replace grant_user_achievement.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS auth.local_test_roles (
  user_id uuid PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('ADMIN', 'OWNER'))
);

ALTER TABLE public.user_activity_region_achievement
  ADD COLUMN IF NOT EXISTS acquisition_sequence bigint;
ALTER TABLE public.user_activity_region_achievement
  ADD COLUMN IF NOT EXISTS acquisition_notified_at timestamptz;
ALTER TABLE public.user_activity_region_achievement
  ADD COLUMN IF NOT EXISTS featured_slot smallint;

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

CREATE TABLE IF NOT EXISTS public.achievement_verified_bugs (
  bug_key text PRIMARY KEY CHECK (bug_key ~ '^[a-z0-9][a-z0-9._:-]{2,119}$'),
  inquiry_id uuid NOT NULL,
  reporter_user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  accepted_by uuid NOT NULL,
  verification_evidence text NOT NULL CHECK (char_length(btrim(verification_evidence)) BETWEEN 10 AND 2000),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquiry_id),
  UNIQUE (reporter_user_id, activity_region)
);

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
  PERFORM pg_advisory_xact_lock(92481734, hashtext(p_user_id::text || ':' || p_region));
  SELECT * INTO v_existing FROM public.achievement_verified_bugs
    WHERE reporter_user_id = p_user_id AND activity_region = p_region;
  IF FOUND THEN RETURN jsonb_build_object('status', 'ALREADY_GRANTED'); END IF;
  INSERT INTO public.achievement_verified_bugs (bug_key, inquiry_id, reporter_user_id, activity_region, accepted_by, verification_evidence)
  VALUES (p_bug_key, p_inquiry_id, p_user_id, p_region, p_owner_id, btrim(p_evidence))
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'DUPLICATE_BUG'); END IF;
  IF p_region = 'KR' AND NOT EXISTS (
    SELECT 1 FROM public.user_achievements
    WHERE user_id = p_user_id AND achievement_key = 'bug-busters' AND season_key IS NULL
  ) THEN
    INSERT INTO public.user_achievements (user_id, achievement_key, acquired_at, acquisition_sequence, metadata)
    SELECT p_user_id, 'bug-busters', now(), COALESCE(MAX(acquisition_sequence), 0) + 1, '{}'::jsonb
    FROM public.user_achievements WHERE user_id = p_user_id;
  END IF;
  INSERT INTO public.user_activity_region_achievement (user_id, activity_region, achievement_key, acquired_at)
  VALUES (p_user_id, p_region, 'bug-busters', now())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.user_notifications (user_id, notification_type, title, message, dedupe_key, payload)
  VALUES (
    p_user_id,
    'ACHIEVEMENT_GRANTED',
    CASE WHEN p_region = 'US' THEN 'Bug Busters' ELSE '센스코' END,
    CASE WHEN p_region = 'US' THEN 'Bug Busters' ELSE '센스코' END,
    'bug-busters:' || p_region || ':' || p_user_id::text,
    jsonb_build_object('achievement', 'bug-busters', 'region', p_region)
  );
  RETURN jsonb_build_object('status', 'GRANTED', 'achievement_key', 'bug-busters', 'acquired_at', now(), 'acquisition_sequence', 1);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_verified_bug_achievement(uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
