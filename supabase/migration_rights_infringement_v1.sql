-- SentenceArena rights-infringement request v1 (additive).
-- Separate from board_reports. No backfill. No DROP/TRUNCATE/DELETE FROM.
-- Political alignment is not stored. IP/device tracking columns are not stored.

CREATE TABLE IF NOT EXISTS public.rights_infringement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number text NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED',
  is_formal boolean NOT NULL DEFAULT false,
  claim_type text NOT NULL,
  claimant_kind text NOT NULL,
  claimant_name text NOT NULL,
  claimant_email text NOT NULL,
  claimant_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  representative_of text NULL,
  representative_relation text NULL,
  representative_authority text NULL,
  target_kind text NOT NULL,
  post_id uuid NULL,
  comment_id uuid NULL,
  target_url text NULL,
  target_author_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  problem_excerpt text NOT NULL,
  claimed_right text NOT NULL,
  infringement_reason text NOT NULL,
  case_narrative text NOT NULL,
  requested_action text NOT NULL,
  requested_action_detail text NULL,
  evidence_description text NULL,
  evidence_url text NULL,
  truth_confirmed boolean NOT NULL DEFAULT false,
  abuse_notice_confirmed boolean NOT NULL DEFAULT false,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  high_risk_privacy boolean NOT NULL DEFAULT false,
  deleted_evidence_id uuid NULL,
  target_snapshot jsonb NULL,
  supplement_note text NULL,
  rejection_reason text NULL,
  operator_notes text NULL,
  temp_takedown_at timestamptz NULL,
  temp_takedown_until timestamptz NULL,
  author_notified_at timestamptz NULL,
  author_objection_deadline timestamptz NULL,
  author_objected_at timestamptz NULL,
  formalized_at timestamptz NULL,
  finalized_at timestamptz NULL,
  retention_until timestamptz NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  legal_hold_reason text NULL,
  last_abuse_action text NULL,
  last_abuse_at timestamptz NULL,
  reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rights_infringement_status_chk CHECK (
    status IN (
      'RECEIVED',
      'NEEDS_SUPPLEMENT',
      'INTAKE_REJECTED',
      'FORMAL_CASE',
      'IN_REVIEW',
      'TEMP_TAKEDOWN',
      'AUTHOR_OBJECTED',
      'COMPLETED'
    )
  ),
  CONSTRAINT rights_infringement_claim_type_chk CHECK (
    claim_type IN ('DEFAMATION', 'PRIVACY', 'LIKENESS', 'COPYRIGHT', 'OTHER_RIGHTS')
  ),
  CONSTRAINT rights_infringement_claimant_kind_chk CHECK (
    claimant_kind IN ('SELF', 'ORGANIZATION', 'AGENT')
  ),
  CONSTRAINT rights_infringement_target_kind_chk CHECK (
    target_kind IN ('POST', 'COMMENT', 'DELETED_UNKNOWN')
  ),
  CONSTRAINT rights_infringement_requested_action_chk CHECK (
    requested_action IN ('HIDE', 'DELETE', 'CORRECTION', 'OTHER')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rights_infringement_case_number
  ON public.rights_infringement_requests (case_number);
CREATE INDEX IF NOT EXISTS idx_rights_infringement_status_created
  ON public.rights_infringement_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rights_infringement_claimant_email
  ON public.rights_infringement_requests (claimant_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rights_infringement_claimant_user
  ON public.rights_infringement_requests (claimant_user_id, created_at DESC)
  WHERE claimant_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rights_infringement_target_post
  ON public.rights_infringement_requests (post_id)
  WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rights_infringement_target_comment
  ON public.rights_infringement_requests (comment_id)
  WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rights_infringement_retention
  ON public.rights_infringement_requests (retention_until)
  WHERE legal_hold = false AND retention_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rights_infringement_author
  ON public.rights_infringement_requests (target_author_user_id)
  WHERE target_author_user_id IS NOT NULL;

COMMENT ON TABLE public.rights_infringement_requests IS
  '권리침해 처리 요청. 일반 신고 board_reports와 분리. 접수는 정식 사건이 아님. 정치성향/IP 미저장.';

ALTER TABLE public.rights_infringement_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_infringement_requests FROM PUBLIC;
REVOKE ALL ON public.rights_infringement_requests FROM anon;
REVOKE ALL ON public.rights_infringement_requests FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rights_infringement_requests TO service_role;

CREATE TABLE IF NOT EXISTS public.rights_infringement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.rights_infringement_requests(id) ON DELETE CASCADE,
  actor_kind text NOT NULL,
  actor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rights_infringement_events_actor_chk CHECK (
    actor_kind IN ('CLAIMANT', 'AUTHOR', 'OPERATOR', 'SYSTEM')
  )
);

CREATE INDEX IF NOT EXISTS idx_rights_infringement_events_request
  ON public.rights_infringement_events (request_id, created_at);

ALTER TABLE public.rights_infringement_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_infringement_events FROM PUBLIC;
REVOKE ALL ON public.rights_infringement_events FROM anon;
REVOKE ALL ON public.rights_infringement_events FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rights_infringement_events TO service_role;

CREATE TABLE IF NOT EXISTS public.rights_infringement_objections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.rights_infringement_requests(id) ON DELETE CASCADE,
  author_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ground text NOT NULL,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rights_infringement_objection_ground_chk CHECK (
    ground IN (
      'FACT_BASED',
      'PUBLIC_INTEREST',
      'POLITICAL_OPINION',
      'LICENSE',
      'CLAIM_FALSE',
      'OTHER'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_rights_infringement_objections_request
  ON public.rights_infringement_objections (request_id, created_at);

ALTER TABLE public.rights_infringement_objections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_infringement_objections FROM PUBLIC;
REVOKE ALL ON public.rights_infringement_objections FROM anon;
REVOKE ALL ON public.rights_infringement_objections FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rights_infringement_objections TO service_role;

CREATE TABLE IF NOT EXISTS public.rights_infringement_abuse_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  warning_count integer NOT NULL DEFAULT 0,
  restriction_kind text NOT NULL DEFAULT 'NONE',
  restricted_until timestamptz NULL,
  last_abuse_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rights_infringement_abuse_user_uq UNIQUE (user_id),
  CONSTRAINT rights_infringement_abuse_kind_chk CHECK (
    restriction_kind IN ('NONE', 'DAYS_30', 'MONTHS_6')
  )
);

ALTER TABLE public.rights_infringement_abuse_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rights_infringement_abuse_state FROM PUBLIC;
REVOKE ALL ON public.rights_infringement_abuse_state FROM anon;
REVOKE ALL ON public.rights_infringement_abuse_state FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rights_infringement_abuse_state TO service_role;

COMMENT ON TABLE public.rights_infringement_abuse_state IS
  '권리침해 요청 기능 제한만. 일반 신고는 막지 않음. 자동 영구정지 없음.';
