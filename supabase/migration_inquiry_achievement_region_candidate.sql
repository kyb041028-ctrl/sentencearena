-- Candidate for the inquiry database, which may be separate from achievements.
-- Existing inquiries remain NULL: never silently award KR for an unknown country.
ALTER TABLE public.admin_inquiries ADD COLUMN IF NOT EXISTS activity_region text
  CHECK (activity_region IN ('KR','US'));
