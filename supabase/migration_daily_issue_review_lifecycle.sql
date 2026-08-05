-- =============================================================================
-- 센텐스크래프트 — 데일리 이슈 검수·게시 생명주기 스키마 (미적용 마이그레이션)
-- =============================================================================
--
-- 주의:
-- - 실제 운영/테스트 DB에 자동 적용하지 않음. 검토 후 수동 적용.
-- - 상태 전환 순서는 앱(shared lifecycle core)이 판정. DB는 허용 값만 제한.
-- - trigger로 자동 승인/게시/만료를 만들지 않음.
-- - public 클라이언트의 직접 읽기/쓰기 금지 (RLS 초안).
-- - 기사 published_at 과 row created_at 을 혼동하지 말 것.
-- - DROP/TRUNCATE 없음 (additive).
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. daily_issue_review_items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_issue_review_items (
  id text PRIMARY KEY,
  candidate_id text NOT NULL,
  cluster_id text NULL,
  status text NOT NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'world',
  version integer NOT NULL DEFAULT 1,
  lock_version integer NOT NULL DEFAULT 1,
  content_signature text NULL,
  cluster_signature text NULL,
  source_set_signature text NULL,
  claim_set_signature text NULL,
  event_identity_signature text NULL,
  prior_issue_id text NULL,
  follow_up_of text NULL,
  update_type text NULL,
  quality_status text NULL,
  freshness_status text NULL,
  freshness_class text NULL,
  quality_checked_at timestamptz NULL,
  freshness_checked_at timestamptz NULL,
  source_count integer NOT NULL DEFAULT 0,
  independent_source_count integer NOT NULL DEFAULT 0,
  latest_source_published_at timestamptz NULL,
  expires_at timestamptz NULL,
  publish_expires_at timestamptz NULL,
  queued_at timestamptz NULL,
  reviewed_at timestamptz NULL,
  approved_at timestamptz NULL,
  published_at timestamptz NULL,
  retired_at timestamptz NULL,
  superseded_at timestamptz NULL,
  reviewer_id text NULL,
  review_reason text NULL,
  hold_reason text NULL,
  reject_reason text NULL,
  retire_reason text NULL,
  display_priority integer NOT NULL DEFAULT 0,
  lifecycle_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  update_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirmed_summary text NULL,
  discussion_prompt text NULL,
  display_groups jsonb NULL,
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT daily_issue_review_items_status_chk CHECK (
    status IN (
      'READY_FOR_REVIEW',
      'HELD',
      'APPROVED',
      'PUBLISHED',
      'REJECTED',
      'EXPIRED',
      'RETIRED',
      'SUPERSEDED',
      'UPDATE_PENDING'
    )
  ),
  CONSTRAINT daily_issue_review_items_version_pos CHECK (version >= 1),
  CONSTRAINT daily_issue_review_items_lock_version_pos CHECK (lock_version >= 1),
  CONSTRAINT daily_issue_review_items_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT daily_issue_review_items_candidate_version_uq UNIQUE (candidate_id, version)
);

CREATE INDEX IF NOT EXISTS idx_daily_issue_review_items_status
  ON public.daily_issue_review_items (status);
CREATE INDEX IF NOT EXISTS idx_daily_issue_review_items_content_sig
  ON public.daily_issue_review_items (content_signature);
CREATE INDEX IF NOT EXISTS idx_daily_issue_review_items_cluster_sig
  ON public.daily_issue_review_items (cluster_signature);
CREATE INDEX IF NOT EXISTS idx_daily_issue_review_items_source_set_sig
  ON public.daily_issue_review_items (source_set_signature);
CREATE INDEX IF NOT EXISTS idx_daily_issue_review_items_claim_set_sig
  ON public.daily_issue_review_items (claim_set_signature);
CREATE INDEX IF NOT EXISTS idx_daily_issue_review_items_event_id_sig
  ON public.daily_issue_review_items (event_identity_signature);
CREATE INDEX IF NOT EXISTS idx_daily_issue_review_items_expires
  ON public.daily_issue_review_items (expires_at);
CREATE INDEX IF NOT EXISTS idx_daily_issue_review_items_publish_expires
  ON public.daily_issue_review_items (publish_expires_at);
CREATE INDEX IF NOT EXISTS idx_daily_issue_review_items_category_status
  ON public.daily_issue_review_items (category, status);
CREATE INDEX IF NOT EXISTS idx_daily_issue_review_items_published_at
  ON public.daily_issue_review_items (published_at DESC);

COMMENT ON TABLE public.daily_issue_review_items IS
  '데일리 이슈 검수·게시 후보. 상태 전환 순서는 앱 lifecycle core가 판정.';
COMMENT ON COLUMN public.daily_issue_review_items.latest_source_published_at IS
  '출처 원문 publishedAt 중 최신값. DB created_at으로 보완하지 않음.';
COMMENT ON COLUMN public.daily_issue_review_items.lock_version IS
  'optimistic concurrency. 전환 시 expectedLockVersion 불일치면 STALE_VERSION.';
COMMENT ON COLUMN public.daily_issue_review_items.document IS
  '검수 항목 전체 스냅샷(JSONB). rawText 제외. 정규 컬럼·연결 테이블과 함께 저장.';

-- -----------------------------------------------------------------------------
-- 2. daily_issue_sources
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_issue_sources (
  id text PRIMARY KEY,
  publisher text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  normalized_url text NULL,
  published_at timestamptz NULL,
  updated_at timestamptz NULL,
  feed_seen_at timestamptz NULL,
  retrieved_at timestamptz NULL,
  first_seen_at timestamptz NULL,
  last_seen_at timestamptz NULL,
  source_event_date timestamptz NULL,
  source_event_date_confidence numeric NULL,
  source_type text NULL,
  document_type text NULL,
  origin_domain text NULL,
  author text NULL,
  primary_source_url text NULL,
  language text NULL,
  country text NULL,
  content_hash text NULL,
  normalized_text_hash text NULL,
  raw_text_storage_policy text NOT NULL DEFAULT 'OMIT_FULL_TEXT',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  row_updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT daily_issue_sources_publisher_not_blank CHECK (length(trim(publisher)) > 0),
  CONSTRAINT daily_issue_sources_url_not_blank CHECK (length(trim(url)) > 0),
  CONSTRAINT daily_issue_sources_raw_policy_chk CHECK (
    raw_text_storage_policy IN ('OMIT_FULL_TEXT', 'HASH_ONLY', 'EXTERNAL_REF')
  )
);

CREATE INDEX IF NOT EXISTS idx_daily_issue_sources_normalized_url
  ON public.daily_issue_sources (normalized_url);
CREATE INDEX IF NOT EXISTS idx_daily_issue_sources_content_hash
  ON public.daily_issue_sources (content_hash);
CREATE INDEX IF NOT EXISTS idx_daily_issue_sources_published_at
  ON public.daily_issue_sources (published_at DESC);

COMMENT ON COLUMN public.daily_issue_sources.raw_text_storage_policy IS
  '기본 OMIT_FULL_TEXT. 브라우저 번들에 rawText 노출 금지.';

-- -----------------------------------------------------------------------------
-- 3. daily_issue_evidences
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_issue_evidences (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES public.daily_issue_sources(id),
  text text NOT NULL,
  normalized_text text NULL,
  start_offset integer NULL,
  end_offset integer NULL,
  speaker text NULL,
  subject text NULL,
  published_at timestamptz NULL,
  evidence_type text NULL,
  extraction_confidence numeric NULL,
  text_hash text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT daily_issue_evidences_text_not_blank CHECK (length(trim(text)) > 0),
  CONSTRAINT daily_issue_evidences_offset_nonneg CHECK (start_offset IS NULL OR start_offset >= 0),
  CONSTRAINT daily_issue_evidences_offset_order CHECK (
    start_offset IS NULL OR end_offset IS NULL OR end_offset >= start_offset
  ),
  CONSTRAINT daily_issue_evidences_confidence_range CHECK (
    extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)
  )
);

CREATE INDEX IF NOT EXISTS idx_daily_issue_evidences_source_text_hash
  ON public.daily_issue_evidences (source_id, text_hash);

-- -----------------------------------------------------------------------------
-- 4. daily_issue_claims
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_issue_claims (
  id text PRIMARY KEY,
  text text NOT NULL,
  classification text NOT NULL,
  subject text NULL,
  speaker text NULL,
  confidence numeric NULL,
  publication_eligibility text NULL,
  is_core boolean NOT NULL DEFAULT false,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  text_hash text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT daily_issue_claims_classification_chk CHECK (
    classification IN (
      'CONFIRMED_FACT',
      'ATTRIBUTED_CLAIM',
      'SOURCE_DISAGREEMENT',
      'UNVERIFIED',
      'ANALYSIS_FORECAST',
      'CONTEXT',
      'REJECTED'
    )
  ),
  CONSTRAINT daily_issue_claims_text_not_blank CHECK (length(trim(text)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_daily_issue_claims_classification
  ON public.daily_issue_claims (classification);
CREATE INDEX IF NOT EXISTS idx_daily_issue_claims_text_hash
  ON public.daily_issue_claims (text_hash);

-- -----------------------------------------------------------------------------
-- 5. 연결 테이블
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_issue_review_item_sources (
  review_item_id text NOT NULL REFERENCES public.daily_issue_review_items(id),
  source_id text NOT NULL REFERENCES public.daily_issue_sources(id),
  sort_order integer NOT NULL DEFAULT 0,
  relation_type text NOT NULL DEFAULT 'SUPPORTING',
  PRIMARY KEY (review_item_id, source_id),
  CONSTRAINT daily_issue_review_item_sources_relation_chk CHECK (
    relation_type IN ('SUPPORTING', 'CONTRADICTING', 'CONTEXT', 'PRIMARY_OFFICIAL')
  )
);

CREATE TABLE IF NOT EXISTS public.daily_issue_review_item_evidences (
  review_item_id text NOT NULL REFERENCES public.daily_issue_review_items(id),
  evidence_id text NOT NULL REFERENCES public.daily_issue_evidences(id),
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (review_item_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS public.daily_issue_review_item_claims (
  review_item_id text NOT NULL REFERENCES public.daily_issue_review_items(id),
  claim_id text NOT NULL REFERENCES public.daily_issue_claims(id),
  section_type text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (review_item_id, claim_id)
);

CREATE TABLE IF NOT EXISTS public.daily_issue_claim_evidences (
  claim_id text NOT NULL REFERENCES public.daily_issue_claims(id),
  evidence_id text NOT NULL REFERENCES public.daily_issue_evidences(id),
  PRIMARY KEY (claim_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS public.daily_issue_claim_sources (
  claim_id text NOT NULL REFERENCES public.daily_issue_claims(id),
  source_id text NOT NULL REFERENCES public.daily_issue_sources(id),
  role text NOT NULL DEFAULT 'SUPPORTING',
  PRIMARY KEY (claim_id, source_id, role),
  CONSTRAINT daily_issue_claim_sources_role_chk CHECK (
    role IN ('SUPPORTING', 'CONTRADICTING')
  )
);

-- -----------------------------------------------------------------------------
-- 6. updates
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_issue_updates (
  id text PRIMARY KEY,
  issue_id text NOT NULL REFERENCES public.daily_issue_review_items(id),
  candidate_id text NULL,
  update_type text NOT NULL,
  title text NULL,
  novelty_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  added_source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  added_evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  added_claim_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  update_reason text NULL,
  created_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_issue_updates_issue
  ON public.daily_issue_updates (issue_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 7. audit logs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_issue_audit_logs (
  id text PRIMARY KEY,
  entity_id text NOT NULL,
  entity_type text NOT NULL DEFAULT 'review_item',
  from_status text NULL,
  to_status text NULL,
  action text NOT NULL,
  actor_id text NULL,
  reason_code text NULL,
  reason_text text NULL,
  snapshot_hash text NULL,
  transaction_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_issue_audit_logs_entity
  ON public.daily_issue_audit_logs (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_issue_audit_logs_action
  ON public.daily_issue_audit_logs (action, created_at DESC);

COMMENT ON TABLE public.daily_issue_audit_logs IS
  '상태 전환과 동일 DB transaction에서만 commit. 수정·삭제 API 없음.';

-- -----------------------------------------------------------------------------
-- 8. repository meta
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_issue_repository_meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.daily_issue_repository_meta (key, value)
VALUES
  ('schema_version', '"1"'::jsonb),
  ('repository_contract_version', '"1"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 9. RLS 초안 — public 직접 접근 차단 (운영 적용은 후속 수동)
-- -----------------------------------------------------------------------------
ALTER TABLE public.daily_issue_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_review_item_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_review_item_evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_review_item_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_claim_evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_claim_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_issue_repository_meta ENABLE ROW LEVEL SECURITY;

-- 정책: anon/authenticated 직접 SELECT/INSERT/UPDATE/DELETE 없음.
-- service_role 또는 서버 전용 접근만 허용 (운영 정책은 후속).

-- -----------------------------------------------------------------------------
-- Rollback 참고 (수동):
-- DROP TABLE IF EXISTS public.daily_issue_claim_sources CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_claim_evidences CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_review_item_claims CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_review_item_evidences CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_review_item_sources CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_updates CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_audit_logs CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_claims CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_evidences CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_sources CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_review_items CASCADE;
-- DROP TABLE IF EXISTS public.daily_issue_repository_meta CASCADE;
-- =============================================================================
