-- Isolated representative impeachment vote.
-- Not applied to Production. No citizen vote, no final removal, no leader election.
-- One account, one vote: the primary key is the concurrency guard.
-- Insert the ballot and its vote in one transaction.
-- A second insert with the same ballot_id and voter_id must fail and leave the first row.

CREATE TABLE IF NOT EXISTS public.rep_impeach_vote_ballots (
  id text PRIMARY KEY,
  vote_kind text NOT NULL CHECK (vote_kind = 'representative_impeachment_24h'),
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  status text NOT NULL CHECK (status IN ('open', 'closed', 'halted', 'error')),
  starts_at_ms bigint NOT NULL,
  ends_at_ms bigint NOT NULL,
  result text NULL CHECK (result IN ('passed', 'failed') OR result IS NULL),
  next_procedure text NULL,
  citizen_vote_opened boolean NOT NULL DEFAULT false,
  closed_once boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.rep_impeach_vote_casts (
  ballot_id text NOT NULL REFERENCES public.rep_impeach_vote_ballots(id),
  voter_id text NOT NULL,
  choice text NOT NULL CHECK (choice IN ('yes', 'no', 'abstain')),
  at_ms bigint NOT NULL,
  PRIMARY KEY (ballot_id, voter_id)
);

-- Concurrent submits use this transaction shape:
-- BEGIN;
-- INSERT INTO public.rep_impeach_vote_casts (ballot_id, voter_id, choice, at_ms)
-- VALUES ($1, $2, $3, $4);
-- COMMIT;
-- The primary key rejects the second transaction. Do not update the first choice.
