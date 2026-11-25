-- Candidate election store. Not applied to Production.
-- Do not run this against the production database.
-- It does not read or write auth.users, profiles, or user_progression.
-- The office is not stored in profiles.territory.
-- Client-sent representative flags and population counts are not columns here.

CREATE TABLE IF NOT EXISTS public.leader_offices (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  leader_id text NULL,
  vacancy_id text NULL,
  UNIQUE (country, territory)
);

CREATE TABLE IF NOT EXISTS public.leader_removals (
  id text PRIMARY KEY,
  office_id text NOT NULL REFERENCES public.leader_offices(id),
  person_id text NULL,
  reason text NOT NULL,
  rank_after text NOT NULL DEFAULT 'citizen' CHECK (rank_after = 'citizen'),
  keep_xp boolean NOT NULL DEFAULT true CHECK (keep_xp = true),
  keep_fame boolean NOT NULL DEFAULT true CHECK (keep_fame = true),
  keep_achievements boolean NOT NULL DEFAULT true CHECK (keep_achievements = true),
  removed_at_ms bigint NOT NULL,
  vacancy_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.leader_schedules (
  id text PRIMARY KEY,
  office_id text NOT NULL REFERENCES public.leader_offices(id),
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  vacancy_id text NOT NULL,
  removed_at_ms bigint NOT NULL,
  vacancy_ends_at_ms bigint NOT NULL,
  filing_ends_at_ms bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS public.leader_filing_rounds (
  id text PRIMARY KEY,
  office_id text NOT NULL REFERENCES public.leader_offices(id),
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  vacancy_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('filing', 'vote', 'closed')),
  opened_at_ms bigint NOT NULL,
  filing_ends_at_ms bigint NOT NULL,
  ended_at_ms bigint NULL,
  next_refiling_at_ms bigint NULL,
  result text NULL CHECK (
    result IS NULL OR result IN (
      'sole', 'plurality', 'TIE', 'ZERO_VOTES', 'no_candidates', 'halted', 'error'
    )
  ),
  CHECK (
    next_refiling_at_ms IS NULL
    OR result IN ('no_candidates', 'TIE', 'ZERO_VOTES')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS leader_one_open_round
  ON public.leader_filing_rounds (country, territory)
  WHERE status IN ('filing', 'vote');

CREATE TABLE IF NOT EXISTS public.leader_candidacies (
  id text PRIMARY KEY,
  round_id text NOT NULL REFERENCES public.leader_filing_rounds(id),
  person_id text NOT NULL,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  filed_at_ms bigint NOT NULL,
  UNIQUE (round_id, person_id)
);

CREATE TABLE IF NOT EXISTS public.leader_ballots (
  id text PRIMARY KEY,
  round_id text NOT NULL UNIQUE REFERENCES public.leader_filing_rounds(id),
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  status text NOT NULL CHECK (status IN ('open', 'closed', 'halted', 'error')),
  starts_at_ms bigint NOT NULL,
  ends_at_ms bigint NOT NULL,
  result text NULL CHECK (
    result IS NULL OR result IN ('plurality', 'TIE', 'ZERO_VOTES', 'halted', 'error')
  )
);

CREATE TABLE IF NOT EXISTS public.leader_casts (
  ballot_id text NOT NULL REFERENCES public.leader_ballots(id),
  voter_id text NOT NULL,
  choice text NOT NULL,
  at_ms bigint NOT NULL,
  PRIMARY KEY (ballot_id, voter_id)
);

CREATE TABLE IF NOT EXISTS public.leader_appointments (
  id text PRIMARY KEY,
  filing_round_id text NOT NULL UNIQUE REFERENCES public.leader_filing_rounds(id),
  office_id text NOT NULL REFERENCES public.leader_offices(id),
  vacancy_id text NOT NULL,
  person_id text NOT NULL,
  at_ms bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS public.leader_runs (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  tick_key text NOT NULL,
  opened_round_id text NULL,
  at_ms bigint NOT NULL,
  UNIQUE (country, territory, tick_key)
);

CREATE TABLE IF NOT EXISTS public.leader_representative_seats (
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  person_id text NOT NULL,
  PRIMARY KEY (country, territory, person_id)
);

CREATE TABLE IF NOT EXISTS public.leader_population_records (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  person_id text NOT NULL,
  valid boolean NOT NULL,
  last_post_at_ms bigint NULL,
  last_comment_at_ms bigint NULL,
  source text NOT NULL CHECK (source = 'server-table'),
  UNIQUE (country, territory, person_id)
);

CREATE TABLE IF NOT EXISTS public.leader_impeachment_proposals (
  id text PRIMARY KEY,
  office_id text NOT NULL REFERENCES public.leader_offices(id),
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  kind text NOT NULL CHECK (kind IN ('representative', 'citizen')),
  status text NOT NULL CHECK (status IN ('open', 'passed', 'failed', 'halted', 'error')),
  opened_at_ms bigint NOT NULL,
  ends_at_ms bigint NOT NULL,
  frozen_roster_size integer NULL,
  yes_count integer NOT NULL DEFAULT 0,
  participant_count integer NOT NULL DEFAULT 0,
  valid_votes integer NOT NULL DEFAULT 0,
  result text NULL
);

CREATE TABLE IF NOT EXISTS public.leader_impeachment_votes (
  proposal_id text NOT NULL REFERENCES public.leader_impeachment_proposals(id),
  voter_id text NOT NULL,
  choice text NOT NULL CHECK (choice IN ('yes', 'no')),
  at_ms bigint NOT NULL,
  PRIMARY KEY (proposal_id, voter_id)
);

CREATE TABLE IF NOT EXISTS public.leader_rank_members (
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'central', 'guardian')),
  person_id text NOT NULL,
  xp integer NOT NULL DEFAULT 0,
  fame integer NOT NULL DEFAULT 0,
  achievements jsonb NOT NULL DEFAULT '[]'::jsonb,
  rank text NOT NULL DEFAULT 'citizen' CHECK (rank IN ('citizen', 'debater', 'elder', 'representative', 'leader')),
  comparison_score double precision NULL,
  valid boolean NOT NULL DEFAULT false,
  last_post_at_ms bigint NULL,
  last_comment_at_ms bigint NULL,
  elected_leader boolean NOT NULL DEFAULT false,
  first_qualification_used jsonb NOT NULL DEFAULT '{}'::jsonb,
  unique_positive_evaluators integer NULL,
  PRIMARY KEY (country, territory, person_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS leader_rank_one_leader
  ON public.leader_rank_members (country, territory)
  WHERE rank = 'leader';

CREATE TABLE IF NOT EXISTS public.leader_rank_scopes (
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'central', 'guardian')),
  territory_population integer NULL,
  PRIMARY KEY (country, territory)
);

CREATE TABLE IF NOT EXISTS public.leader_rank_reactions (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'central', 'guardian')),
  actor_id text NOT NULL,
  target_id text NOT NULL,
  polarity smallint NOT NULL CHECK (polarity IN (-1, 1)),
  at_ms bigint NOT NULL,
  cancelled_at_ms bigint NULL,
  invalid boolean NOT NULL DEFAULT false,
  fame_delta bigint NULL
);

CREATE TABLE IF NOT EXISTS public.leader_rank_follows (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'central', 'guardian')),
  follower_id text NOT NULL,
  target_id text NOT NULL,
  at_ms bigint NOT NULL,
  cancelled_at_ms bigint NULL
);

CREATE TABLE IF NOT EXISTS public.leader_rank_source_flags (
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'central', 'guardian')),
  reactions_connected boolean NOT NULL DEFAULT false,
  follows_connected boolean NOT NULL DEFAULT false,
  PRIMARY KEY (country, territory)
);

CREATE TABLE IF NOT EXISTS public.leader_rank_rounds (
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'central', 'guardian')),
  round_key text NOT NULL,
  PRIMARY KEY (country, territory, round_key)
);

CREATE TABLE IF NOT EXISTS public.leader_impeachment_blocks (
  id text PRIMARY KEY,
  country text NOT NULL CHECK (country IN ('KR', 'US')),
  territory text NOT NULL CHECK (territory IN ('pioneer', 'guardian')),
  leader_id text NOT NULL,
  blocked_until_ms bigint NOT NULL,
  reason text NOT NULL CHECK (reason = 'citizen_vote_failed')
);

CREATE OR REPLACE FUNCTION public.leader_guard_appointment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  sitting text;
  current_vacancy text;
  round_result text;
  round_vacancy text;
BEGIN
  SELECT leader_id, vacancy_id INTO sitting, current_vacancy
  FROM public.leader_offices
  WHERE id = NEW.office_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFICE_MISSING';
  END IF;
  IF sitting IS NOT NULL THEN
    RAISE EXCEPTION 'LEADER_EXISTS';
  END IF;
  IF current_vacancy IS DISTINCT FROM NEW.vacancy_id THEN
    RAISE EXCEPTION 'OLD_ROUND';
  END IF;
  SELECT result, vacancy_id INTO round_result, round_vacancy
  FROM public.leader_filing_rounds
  WHERE id = NEW.filing_round_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUND_MISSING';
  END IF;
  IF round_vacancy IS DISTINCT FROM NEW.vacancy_id THEN
    RAISE EXCEPTION 'OLD_ROUND';
  END IF;
  IF round_result IS NULL OR round_result NOT IN ('sole', 'plurality') THEN
    RAISE EXCEPTION 'NOT_APPOINTABLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.leader_representative_seats
    WHERE country = (SELECT country FROM public.leader_offices WHERE id = NEW.office_id)
      AND territory = (SELECT territory FROM public.leader_offices WHERE id = NEW.office_id)
      AND person_id = NEW.person_id
  ) THEN
    RAISE EXCEPTION 'NOT_REPRESENTATIVE';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS leader_guard_appointment_trg ON public.leader_appointments;
CREATE TRIGGER leader_guard_appointment_trg
  BEFORE INSERT ON public.leader_appointments
  FOR EACH ROW
  EXECUTE PROCEDURE public.leader_guard_appointment();

CREATE OR REPLACE FUNCTION public.leader_guard_representative_seat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  sitting text;
  seat_count integer;
BEGIN
  SELECT leader_id INTO sitting
  FROM public.leader_offices
  WHERE country = NEW.country AND territory = NEW.territory
  FOR UPDATE;
  IF sitting IS NOT NULL AND sitting = NEW.person_id THEN
    RAISE EXCEPTION 'LEADER_OUTSIDE_CAP';
  END IF;
  SELECT count(*) INTO seat_count
  FROM public.leader_representative_seats
  WHERE country = NEW.country AND territory = NEW.territory;
  IF seat_count >= 10 THEN
    RAISE EXCEPTION 'REPRESENTATIVE_CAP';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS leader_guard_representative_seat_trg ON public.leader_representative_seats;
CREATE TRIGGER leader_guard_representative_seat_trg
  BEFORE INSERT ON public.leader_representative_seats
  FOR EACH ROW
  EXECUTE PROCEDURE public.leader_guard_representative_seat();

CREATE OR REPLACE FUNCTION public.leader_rank_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  rep_count integer;
  leader_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.country || ':' || NEW.territory));
  IF NEW.rank = 'representative' THEN
    SELECT count(*) INTO rep_count
    FROM public.leader_rank_members
    WHERE country = NEW.country AND territory = NEW.territory
      AND rank = 'representative' AND person_id <> NEW.person_id;
    IF rep_count >= 10 THEN
      RAISE EXCEPTION 'REPRESENTATIVE_CAP';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.leader_rank_members
      WHERE country = NEW.country AND territory = NEW.territory
        AND person_id = NEW.person_id AND rank = 'leader'
    ) THEN
      RAISE EXCEPTION 'LEADER_OUTSIDE_CAP';
    END IF;
  END IF;
  IF NEW.rank = 'leader' THEN
    SELECT count(*) INTO leader_count
    FROM public.leader_rank_members
    WHERE country = NEW.country AND territory = NEW.territory
      AND rank = 'leader' AND person_id <> NEW.person_id;
    IF leader_count >= 1 THEN
      RAISE EXCEPTION 'LEADER_EXISTS';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS leader_rank_guard_trg ON public.leader_rank_members;
CREATE TRIGGER leader_rank_guard_trg
  BEFORE INSERT OR UPDATE ON public.leader_rank_members
  FOR EACH ROW
  EXECUTE PROCEDURE public.leader_rank_guard();

REVOKE ALL ON FUNCTION public.leader_guard_appointment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leader_rank_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leader_rank_guard() TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.leader_guard_representative_seat() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leader_guard_appointment() TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.leader_guard_representative_seat() TO CURRENT_USER;

DO $revoke$
DECLARE
  table_name text;
  role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'leader_offices',
    'leader_removals',
    'leader_schedules',
    'leader_filing_rounds',
    'leader_candidacies',
    'leader_ballots',
    'leader_casts',
    'leader_appointments',
    'leader_runs',
    'leader_representative_seats',
    'leader_population_records',
    'leader_impeachment_proposals',
    'leader_impeachment_votes',
    'leader_impeachment_blocks',
    'leader_rank_members',
    'leader_rank_scopes',
    'leader_rank_reactions',
    'leader_rank_follows',
    'leader_rank_source_flags',
    'leader_rank_rounds'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.leader_guard_appointment() FROM ' || quote_ident(role_name);
      EXECUTE 'REVOKE ALL ON FUNCTION public.leader_guard_representative_seat() FROM ' || quote_ident(role_name);
      EXECUTE 'REVOKE ALL ON FUNCTION public.leader_rank_guard() FROM ' || quote_ident(role_name);
    END IF;
  END LOOP;
END
$revoke$;

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
