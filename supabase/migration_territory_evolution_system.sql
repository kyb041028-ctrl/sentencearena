-- =============================================================================
-- 센텐스크래프트 — 영토 발전 population snapshot 스키마 (초안)
-- 파일: supabase/migration_territory_evolution_system.sql
-- ⚠️ 실제 Supabase에 적용하지 않음. 구조·RLS·GRANT만 정의.
-- =============================================================================

-- 영토별 집계 스냅샷 (이력)
CREATE TABLE IF NOT EXISTS public.territory_population_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_key text NOT NULL,
  territory text NOT NULL
    CONSTRAINT territory_population_snapshots_territory_check
      CHECK (territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN')),
  population bigint NOT NULL
    CONSTRAINT territory_population_snapshots_population_min CHECK (population >= 0),
  stage integer NOT NULL
    CONSTRAINT territory_population_snapshots_stage_range CHECK (stage BETWEEN 1 AND 6),
  source text NOT NULL,
  calculated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT territory_population_snapshots_uniq UNIQUE (snapshot_key, territory)
);

COMMENT ON TABLE public.territory_population_snapshots
  IS '영토 발전 인원·단계 스냅샷 이력. 일반 사용자 INSERT/UPDATE/DELETE 금지.';

-- 현재 상태 (영토당 1행)
CREATE TABLE IF NOT EXISTS public.territory_population_current (
  territory text PRIMARY KEY
    CONSTRAINT territory_population_current_territory_check
      CHECK (territory IN ('CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN')),
  population bigint NOT NULL
    CONSTRAINT territory_population_current_population_min CHECK (population >= 0),
  stage integer NOT NULL
    CONSTRAINT territory_population_current_stage_range CHECK (stage BETWEEN 1 AND 6),
  calculated_at timestamptz NOT NULL,
  snapshot_key text NOT NULL,
  source text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.territory_population_current
  IS '영토별 최신 발전 인원·단계. CENTRAL은 직접 소속만 (개척·수호 합산 없음).';

-- RLS
ALTER TABLE public.territory_population_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.territory_population_current ENABLE ROW LEVEL SECURITY;

-- 공개 SELECT (집계만 — userId 목록 없음)
CREATE POLICY "territory_population_snapshots_select_public"
  ON public.territory_population_snapshots FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "territory_population_current_select_public"
  ON public.territory_population_current FOR SELECT
  TO authenticated, anon
  USING (true);

-- 일반 사용자 쓰기 금지 (policy 없음 = deny). service_role은 RLS bypass.

GRANT SELECT ON public.territory_population_snapshots TO authenticated, anon;
GRANT SELECT ON public.territory_population_current TO authenticated, anon;

REVOKE INSERT, UPDATE, DELETE ON public.territory_population_snapshots FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.territory_population_current FROM PUBLIC, anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON public.territory_population_snapshots TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.territory_population_current TO service_role;

/*
적용 시 체크리스트 (아직 실행 금지)
1. migration 적용
2. service-role으로만 snapshot 기록
3. 공개 API는 SELECT 결과만 반환 (userId·alignment·moderation 금지)
4. scheduler/cron은 별도 확정 후
*/
