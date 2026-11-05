-- Local / preflight only. Satisfies migration_activity_region_v2.sql ALTER targets
-- not present in production-public REQUIRED. Not an official migration.

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_activity_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_bookmarks (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
