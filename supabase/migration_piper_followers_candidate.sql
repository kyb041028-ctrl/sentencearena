-- Candidate only. Apply on an isolated local database.
-- Do not run this on production Supabase or an existing local database.
-- Piper stays one achievement. Stages are not deleted when followers drop.

CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_user_id uuid NOT NULL,
  following_user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  cancelled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, following_user_id, activity_region)
);

CREATE TABLE IF NOT EXISTS public.user_activity_region_achievement (
  user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  achievement_key text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  acquisition_sequence integer NULL,
  featured_slot smallint NULL,
  stage smallint NULL,
  stage_reached jsonb NULL,
  acquisition_notified_at timestamptz NULL,
  PRIMARY KEY (user_id, activity_region, achievement_key)
);
