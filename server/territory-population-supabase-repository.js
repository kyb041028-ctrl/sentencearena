'use strict';
/**
 * 영토 인원 Supabase repository — 구조만 준비
 * 실제 DB 접속·count 실행 금지 (이번 작업).
 */

const core = require('../shared/territory-evolution-core');

let _adminClient = null;

function setAdminClient(client) {
  _adminClient = client;
}

/**
 * 향후 실제 집계 예시 (실행하지 않음):
 * SELECT current_territory, COUNT(*) FROM ... WHERE deleted_at IS NULL GROUP BY ...
 * CENTRAL/PIONEER/GUARDIAN/ALIEN 각각 독립.
 * ALIEN은 지구 합계에서 제외.
 */
async function countUsersByTerritory(territory) {
  const check = core.assertOperationalTerritoryStrict(territory);
  if (!check.valid) {
    return { population: null, available: false, source: core.POPULATION_SOURCE.UNAVAILABLE, warnings: [check.error] };
  }
  if (!_adminClient) {
    return {
      population: null,
      available: false,
      source: core.POPULATION_SOURCE.UNAVAILABLE,
      warnings: ['SUPABASE_CLIENT_NOT_CONFIGURED'],
      sqlPlan: {
        note: 'NOT_EXECUTED',
        territory: check.territory,
        aggregation: 'DIRECT_ONLY',
        excludeAlienFromEarth: true,
      },
    };
  }
  // 실제 쿼리 실행 금지
  return {
    population: null,
    available: false,
    source: core.POPULATION_SOURCE.UNAVAILABLE,
    warnings: ['LIVE_COUNT_NOT_ACTIVATED'],
    sqlPlan: {
      note: 'NOT_EXECUTED',
      territory: check.territory,
    },
  };
}

async function countAllUsersByTerritory() {
  const out = {};
  for (let i = 0; i < core.OPERATIONAL_TERRITORIES.length; i++) {
    out[core.OPERATIONAL_TERRITORIES[i]] = await countUsersByTerritory(core.OPERATIONAL_TERRITORIES[i]);
  }
  return out;
}

async function getPopulationSnapshot() {
  return {
    calculatedAt: null,
    source: core.POPULATION_SOURCE.UNAVAILABLE,
    territories: await countAllUsersByTerritory(),
    note: 'LIVE_SNAPSHOT_NOT_ACTIVATED',
  };
}

async function healthCheck() {
  return {
    ok: true,
    mode: 'supabase-stub',
    connected: !!_adminClient,
    liveCountEnabled: false,
  };
}

module.exports = {
  setAdminClient,
  countUsersByTerritory,
  countAllUsersByTerritory,
  getPopulationSnapshot,
  healthCheck,
};
