CREATE TABLE IF NOT EXISTS public.leader_rank_refresh_failures (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'central', 'guardian')),
  round_key text NOT NULL,
  reason text NOT NULL,
  at_ms bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS public.leader_agenda_issues (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  week_number integer NOT NULL,
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  published boolean NOT NULL,
  title text NULL,
  body text NULL,
  author_id text NULL,
  reason text NOT NULL,
  created_at_ms bigint NOT NULL,
  UNIQUE (country, week_number)
);
