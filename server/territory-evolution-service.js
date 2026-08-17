'use strict';
/**
 * 영토 발전 service — 인원→단계·snapshot plan (실제 저장 미실행)
 */

const core = require('../shared/territory-evolution-core');
const populationAdapter = require('./territory-population-adapter');

let _evolutionRepo = null;
let _mode = 'LEGACY_LOCAL';

function setEvolutionRepository(repo) {
  _evolutionRepo = repo;
}

function setDataMode(mode) {
  _mode = mode || 'LEGACY_LOCAL';
  populationAdapter.setDataMode(_mode);
}

function getDataMode() {
  return _mode;
}

function isActivated() {
  return _mode === 'API_OPERATIONAL';
}

function directCountMapFromPopulations(all) {
  const map = {};
  core.OPERATIONAL_TERRITORIES.forEach(function (t) {
    const row = all[t] || {};
    if (t === 'ALIEN') {
      map[t] =
        row.available && row.population != null
          ? row.population
          : core.MOCK_POPULATION_DEFAULTS.ALIEN;
      return;
    }
    map[t] = row.available && row.population != null ? row.population : 0;
  });
  return map;
}

function sourceForTerritory(all, territory) {
  const row = all[territory] || {};
  if (territory === 'ALIEN') return core.POPULATION_SOURCE.LEGACY_MOCK;
  return row.source || core.POPULATION_SOURCE.MEMORY;
}

async function buildTerritoryEvolutionState(territory, preloadedAll) {
  const all = preloadedAll || (await populationAdapter.getAllTerritoryPopulations());
  const directs = directCountMapFromPopulations(all);
  const evoPop = core.resolveEvolutionPopulation(territory, directs);
  const row = all[territory] || {};
  if (evoPop == null) {
    return core.buildInvalidEvolutionViewModel(territory, 'TERRITORY_EVOLUTION_TERRITORY_INVALID');
  }
  if (territory !== 'ALIEN' && (!row.available || row.population == null) && _mode === 'API_OPERATIONAL') {
    return core.buildUnavailableEvolutionViewModel(
      territory,
      (row.warnings && row.warnings[0]) || 'UNAVAILABLE',
    );
  }
  if (_mode === 'LEGACY_LOCAL' && (!row.available || row.population == null)) {
    return core.buildLegacyMockEvolutionState(territory);
  }
  const source = sourceForTerritory(all, territory);
  return core.getTerritoryEvolutionState({
    territory: territory,
    population: evoPop,
    populationSource: source,
    dataStatus:
      source === core.POPULATION_SOURCE.LEGACY_MOCK ? core.DATA_STATUS.LEGACY_MOCK : core.DATA_STATUS.READY,
    updatedAt: row.updatedAt || null,
  });
}

async function getTerritoryEvolution(territory) {
  const check = core.assertOperationalTerritoryStrict(territory);
  if (!check.valid) {
    const err = new Error(check.error);
    err.code = check.error;
    err.status = 400;
    throw err;
  }
  return buildTerritoryEvolutionState(check.territory);
}

async function getAllTerritoryEvolutions() {
  const out = {};
  const warnings = [];
  const allPop = await populationAdapter.getAllTerritoryPopulations();
  const directCounts = directCountMapFromPopulations(allPop);
  for (let i = 0; i < core.OPERATIONAL_TERRITORIES.length; i++) {
    const t = core.OPERATIONAL_TERRITORIES[i];
    try {
      out[t] = await buildTerritoryEvolutionState(t, allPop);
    } catch (e) {
      out[t] = core.buildUnavailableEvolutionViewModel(t, 'PARTIAL_FAILURE');
      warnings.push({ territory: t, error: 'PARTIAL_FAILURE' });
    }
  }
  const anyReady = core.OPERATIONAL_TERRITORIES.some(function (t) {
    return out[t] && (out[t].dataStatus === 'READY' || out[t].dataStatus === 'LEGACY_MOCK');
  });
  const anyFail = warnings.length > 0;
  return {
    territories: out,
    directCounts: directCounts,
    dataStatus: anyFail && anyReady ? core.DATA_STATUS.PARTIAL : (anyReady ? core.DATA_STATUS.READY : core.DATA_STATUS.UNAVAILABLE),
    warnings: warnings,
    centralAggregationMode: core.CENTRAL_AGGREGATION_MODE,
    stageCanDecrease: core.STAGE_CAN_DECREASE,
  };
}

function buildTerritoryEvolutionSnapshotPlan() {
  return {
    note: 'NOT_PERSISTED',
    snapshotKey: 'plan_' + Date.now(),
    calculatedAt: new Date().toISOString(),
    territories: core.OPERATIONAL_TERRITORIES.slice(),
    writeRole: 'service_role',
    publicWriteForbidden: true,
  };
}

async function persistTerritoryEvolutionSnapshot(plan) {
  void plan;
  if (!isActivated()) {
    return { ok: false, error: 'TERRITORY_EVOLUTION_NOT_ACTIVATED', persisted: false };
  }
  if (!_evolutionRepo || typeof _evolutionRepo.saveSnapshot !== 'function') {
    return { ok: false, error: 'EVOLUTION_REPO_NOT_CONFIGURED', persisted: false };
  }
  // 실제 저장 호출하지 않음
  return { ok: false, error: 'SNAPSHOT_PERSIST_DISABLED', persisted: false };
}

async function healthCheck() {
  return {
    ok: true,
    mode: _mode,
    activated: isActivated(),
    centralAggregationMode: core.CENTRAL_AGGREGATION_MODE,
    stageCanDecrease: core.STAGE_CAN_DECREASE,
  };
}

module.exports = {
  setEvolutionRepository,
  setDataMode,
  getDataMode,
  isActivated,
  getTerritoryEvolution,
  getAllTerritoryEvolutions,
  buildTerritoryEvolutionState,
  buildTerritoryEvolutionSnapshotPlan,
  persistTerritoryEvolutionSnapshot,
  healthCheck,
};
