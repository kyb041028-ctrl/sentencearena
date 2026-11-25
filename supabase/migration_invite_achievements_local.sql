-- Local only. Invite achievements on the existing country achievement table.
-- Does not change achievements 01-04. No friend table. No rewards or XP.

ALTER TABLE public.user_activity_region_achievement
  ADD COLUMN IF NOT EXISTS stage smallint;

ALTER TABLE public.user_activity_region_achievement
  ADD COLUMN IF NOT EXISTS stage_reached jsonb;

ALTER TABLE public.user_activity_region_achievement
  ADD COLUMN IF NOT EXISTS stage_notified smallint;
