'use strict';
/**
 * 영토 인원 집계 adapter
 * 클라이언트 population 무시. 실제 DB count는 이번 작업에서 실행하지 않음.
 */

const core = require('../shared/territory-evolution-core');

let _repository = null;
let _mode = 'LEGACY_LOCAL';

function setRepository(repo) {
  _repository = repo;
}

function setDataMode(mode) {
  _mode = mode || 'LEGACY_LOCAL';
}

function getDataMode() {
  return _mode;
}

/**
 * @param {string} territory — 운영 ID (CENTRAL/PIONEER/GUARDIAN/ALIEN)
 * @param {object} [opts]
 * @param {number} [opts.clientPopulation] — 무시
 */
async function getTerritoryPopulation(territory, opts) {
  const options = opts || {};
  void options.clientPopulation;

  const check = core.assertOperationalTerritoryStrict(territory);
  if (!check.valid) {
    return {
      territory: null,
      population: null,
      available: false,
      source: core.POPULATION_SOURCE.UNAVAILABLE,
      updatedAt: null,
      warnings: [check.error],
    };
  }

  if (_mode === 'API_OPERATIONAL') {
    if (!_repository || typeof _repository.countUsersByTerritory !== 'function') {
      return {
        territory: check.territory,
        population: null,
        available: false,
        source: core.POPULATION_SOURCE.UNAVAILABLE,
        updatedAt: null,
        warnings: ['REPOSITORY_NOT_CONFIGURED'],
      };
    }
    try {
      const result = await _repository.countUsersByTerritory(check.territory);
      return {
        territory: check.territory,
        population: result.population,
        available: result.available !== false,
        source: result.source || core.POPULATION_SOURCE.OPERATIONAL_USER_DATA,
        updatedAt: result.updatedAt || null,
        warnings: result.warnings || [],
      };
    } catch (e) {
      return {
        territory: check.territory,
        population: null,
        available: false,
        source: core.POPULATION_SOURCE.UNAVAILABLE,
        updatedAt: null,
        warnings: ['COUNT_FAILED'],
      };
    }
  }

  if (_mode === 'API_DRY_RUN') {
    return {
      territory: check.territory,
      population: null,
      available: false,
      source: core.POPULATION_SOURCE.UNAVAILABLE,
      updatedAt: null,
      warnings: ['API_DRY_RUN_NO_LIVE_COUNT'],
    };
  }

  // LEGACY_LOCAL — Mock (운영값처럼 서버 저장하지 않음)
  if (_repository && typeof _repository.countUsersByTerritory === 'function') {
    const mem = await _repository.countUsersByTerritory(check.territory);
    if (mem && mem.available) {
      return {
        territory: check.territory,
        population: mem.population,
        available: true,
        source: mem.source || core.POPULATION_SOURCE.MEMORY,
        updatedAt: mem.updatedAt || null,
        warnings: mem.warnings || [],
      };
    }
  }

  const mockPop = core.MOCK_POPULATION_DEFAULTS[check.territory];
  return {
    territory: check.territory,
    population: mockPop,
    available: true,
    source: core.POPULATION_SOURCE.LEGACY_MOCK,
    updatedAt: null,
    warnings: [],
  };
}

async function getAllTerritoryPopulations(opts) {
  const out = {};
  for (let i = 0; i < core.OPERATIONAL_TERRITORIES.length; i++) {
    const t = core.OPERATIONAL_TERRITORIES[i];
    out[t] = await getTerritoryPopulation(t, opts);
  }
  return out;
}

module.exports = {
  setRepository,
  setDataMode,
  getDataMode,
  getTerritoryPopulation,
  getAllTerritoryPopulations,
};
