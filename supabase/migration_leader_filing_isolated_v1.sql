-- Isolated leader filing and impeachment proposals.
-- Not applied to Production. No vote tally, no winner, no confirmed removal.
-- General filing dates are not in DEC-023. Do not default them here.

CREATE TABLE IF NOT EXISTS public.leader_candidacy_filings (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  actor_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('submitted', 'in_review', 'registration_closed')),
  review text NOT NULL,
  created_at_ms bigint NULL
);

CREATE TABLE IF NOT EXISTS public.impeachment_proposals (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  actor_id text NOT NULL,
  leader_id text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('received', 'representative_vote_pending', 'failed')),
  next_step text NULL,
  failed_at_ms bigint NULL,
  created_at_ms bigint NULL
);
