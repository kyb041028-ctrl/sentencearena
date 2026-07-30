'use strict';
/**
 * 영토 인원 memory repository — 테스트·LEGACY_LOCAL 전용
 * 실제 DB count 없음. CENTRAL = central only.
 */

const core = require('../shared/territory-evolution-core');

const store = {
  counts: {
    CENTRAL: core.MOCK_POPULATION_DEFAULTS.CENTRAL,
    PIONEER: core.MOCK_POPULATION_DEFAULTS.PIONEER,
    GUARDIAN: core.MOCK_POPULATION_DEFAULTS.GUARDIAN,
    ALIEN: core.MOCK_POPULATION_DEFAULTS.ALIEN,
  },
};

function setCounts(partial) {
  const src = partial || {};
  core.OPERATIONAL_TERRITORIES.forEach(function (t) {
    if (Object.prototype.hasOwnProperty.call(src, t)) {
      const p = core.parsePopulationStrict(src[t]);
      if (p.valid) store.counts[t] = p.population;
    }
  });
}

function resetCounts() {
  store.counts = {
    CENTRAL: core.MOCK_POPULATION_DEFAULTS.CENTRAL,
    PIONEER: core.MOCK_POPULATION_DEFAULTS.PIONEER,
    GUARDIAN: core.MOCK_POPULATION_DEFAULTS.GUARDIAN,
    ALIEN: core.MOCK_POPULATION_DEFAULTS.ALIEN,
  };
}

async function countUsersByTerritory(territory) {
  const check = core.assertOperationalTerritoryStrict(territory);
  if (!check.valid) {
    return { population: null, available: false, source: core.POPULATION_SOURCE.UNAVAILABLE, warnings: [check.error] };
  }
  return {
    population: store.counts[check.territory],
    available: true,
    source: core.POPULATION_SOURCE.MEMORY,
    updatedAt: new Date().toISOString(),
    warnings: [],
  };
}

async function countAllUsersByTerritory() {
  const out = {};
  for (let i = 0; i < core.OPERATIONAL_TERRITORIES.length; i++) {
    const t = core.OPERATIONAL_TERRITORIES[i];
    out[t] = await countUsersByTerritory(t);
  }
  return out;
}

async function getPopulationSnapshot() {
  const all = await countAllUsersByTerritory();
  return {
    calculatedAt: new Date().toISOString(),
    source: core.POPULATION_SOURCE.MEMORY,
    territories: all,
    /** 검증용: 지구 합계에 ALIEN 미포함 */
    earthTotal:
      (all.CENTRAL.population || 0) +
      (all.PIONEER.population || 0) +
      (all.GUARDIAN.population || 0),
    alienOnly: all.ALIEN.population || 0,
  };
}

async function healthCheck() {
  return { ok: true, mode: 'memory', connected: false };
}

module.exports = {
  setCounts,
  resetCounts,
  countUsersByTerritory,
  countAllUsersByTerritory,
  getPopulationSnapshot,
  healthCheck,
};
