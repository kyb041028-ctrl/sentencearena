-- Local only. Do not apply to production.
-- Share and invite attribution. No rewards, XP, or achievements.

CREATE TABLE IF NOT EXISTS public.share_links (
  code text PRIMARY KEY,
  post_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  sharer_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invite_links (
  code text PRIMARY KEY,
  inviter_user_id uuid NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.share_invite_events (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  activity_region text NOT NULL CHECK (activity_region IN ('KR', 'US')),
  path_kind text NOT NULL CHECK (path_kind IN ('share', 'invite')),
  code text NOT NULL,
  post_id uuid NULL,
  user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS share_invite_signup_once
  ON public.share_invite_events (user_id, path_kind)
  WHERE kind = 'share_signup' AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS share_invite_first_action
  ON public.share_invite_events (user_id, kind)
  WHERE kind IN ('first_post', 'first_comment', 'first_reaction') AND user_id IS NOT NULL;

ALTER TABLE public.user_legal_consents
  ADD COLUMN IF NOT EXISTS us_participation text;

COMMENT ON COLUMN public.user_legal_consents.us_participation IS
  'read-only means a Korean 14-17 account may read the US area and may not participate. Date of birth is not stored.';
