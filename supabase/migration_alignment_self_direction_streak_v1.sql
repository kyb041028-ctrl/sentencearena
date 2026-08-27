-- Additive: actor-self consistency streak on user_alignment_state.
-- No score rewrite. No territory rewrite. Existing rows default streak 0.
-- Scheduler remains OFF. Streak is not backfilled from historical reactions.

ALTER TABLE public.user_alignment_state
  ADD COLUMN IF NOT EXISTS self_direction text;

ALTER TABLE public.user_alignment_state
  ADD COLUMN IF NOT EXISTS self_direction_streak integer NOT NULL DEFAULT 0;

ALTER TABLE public.user_alignment_state
  ADD COLUMN IF NOT EXISTS self_direction_last_date date;

ALTER TABLE public.user_alignment_state
  DROP CONSTRAINT IF EXISTS user_alignment_state_self_direction_chk;

ALTER TABLE public.user_alignment_state
  ADD CONSTRAINT user_alignment_state_self_direction_chk
  CHECK (
    self_direction IS NULL
    OR self_direction IN ('PIONEER', 'GUARDIAN')
  );

ALTER TABLE public.user_alignment_state
  DROP CONSTRAINT IF EXISTS user_alignment_state_self_direction_streak_chk;

ALTER TABLE public.user_alignment_state
  ADD CONSTRAINT user_alignment_state_self_direction_streak_chk
  CHECK (self_direction_streak >= 0);
