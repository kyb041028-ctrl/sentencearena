-- SentenceArena admin ops stats (not applied to production).
-- Visitor collection stays off until a privacy policy and retention period are decided.
-- No IP address, no device fingerprint, no political alignment, no raw URL.

CREATE TABLE IF NOT EXISTS public.admin_ops_visit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL,
  visitor_key text NOT NULL,
  actor_type text NOT NULL,
  user_id uuid NULL,
  kind text NOT NULL,
  channel text NULL,
  utm_source text NULL,
  device_class text NULL,
  CONSTRAINT admin_ops_visit_events_actor_chk CHECK (actor_type IN ('member', 'guest')),
  CONSTRAINT admin_ops_visit_events_kind_chk CHECK (kind IN ('activity', 'page_view')),
  CONSTRAINT admin_ops_visit_events_channel_chk CHECK (
    channel IS NULL OR channel IN ('direct', 'google', 'naver', 'instagram', 'threads', 'youtube', 'other')
  ),
  CONSTRAINT admin_ops_visit_events_device_chk CHECK (
    device_class IS NULL OR device_class IN ('pc', 'mobile')
  ),
  CONSTRAINT admin_ops_visit_events_key_len_chk CHECK (char_length(visitor_key) BETWEEN 8 AND 64),
  CONSTRAINT admin_ops_visit_events_utm_len_chk CHECK (utm_source IS NULL OR char_length(utm_source) <= 40),
  CONSTRAINT admin_ops_visit_events_guest_chk CHECK (
    (actor_type = 'guest' AND user_id IS NULL) OR (actor_type = 'member' AND user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_admin_ops_visit_events_occurred
  ON public.admin_ops_visit_events (occurred_at);

CREATE INDEX IF NOT EXISTS idx_admin_ops_visit_events_visitor_time
  ON public.admin_ops_visit_events (visitor_key, occurred_at);

COMMENT ON TABLE public.admin_ops_visit_events IS
  'Admin-only visit facts. Do not enable public writes. Retention is undecided. No IP, fingerprint, or alignment.';

ALTER TABLE public.admin_ops_visit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_ops_visit_events FROM PUBLIC;
REVOKE ALL ON public.admin_ops_visit_events FROM anon;
REVOKE ALL ON public.admin_ops_visit_events FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_ops_visit_events TO service_role;
