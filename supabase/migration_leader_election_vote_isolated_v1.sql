-- Isolated dev leader election vote. Not applied to Production.
-- This does not appoint a leader or start a season term.
-- The dev JSON file lock is a single-process queue. It is not this transaction.
-- Isolated PostgreSQL concurrency stays unverified until that database exists.

CREATE TABLE IF NOT EXISTS public.leader_election_ballots (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  status text NOT NULL CHECK (status IN ('open', 'closed', 'halted', 'error')),
  starts_at_ms bigint NOT NULL,
  ends_at_ms bigint NOT NULL,
  result text NULL CHECK (result IN ('plurality', 'unconfirmed') OR result IS NULL),
  office_granted boolean NOT NULL DEFAULT false,
  closed_once boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.leader_election_casts (
  ballot_id text NOT NULL REFERENCES public.leader_election_ballots(id),
  voter_id text NOT NULL,
  choice text NOT NULL,
  at_ms bigint NOT NULL,
  PRIMARY KEY (ballot_id, voter_id)
);

-- BEGIN;
-- INSERT INTO public.leader_election_casts (ballot_id, voter_id, choice, at_ms)
-- VALUES ($1, $2, $3, $4);
-- COMMIT;
-- The primary key rejects the second transaction. Do not change the first choice.
