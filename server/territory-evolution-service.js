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

async function buildTerritoryEvolutionState(territory) {
  const pop = await populationAdapter.getTerritoryPopulation(territory);
  if (!pop.available || pop.population == null) {
    const vm = core.buildUnavailableEvolutionViewModel(territory, (pop.warnings && pop.warnings[0]) || 'UNAVAILABLE');
    if (_mode === 'LEGACY_LOCAL' && pop.source === core.POPULATION_SOURCE.LEGACY_MOCK) {
      return core.buildLegacyMockEvolutionState(territory);
    }
    return vm;
  }
  return core.getTerritoryEvolutionState({
    territory: pop.territory,
    population: pop.population,
    populationSource: pop.source,
    dataStatus: pop.source === core.POPULATION_SOURCE.LEGACY_MOCK
      ? core.DATA_STATUS.LEGACY_MOCK
      : core.DATA_STATUS.READY,
    updatedAt: pop.updatedAt,
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
  for (let i = 0; i < core.OPERATIONAL_TERRITORIES.length; i++) {
    const t = core.OPERATIONAL_TERRITORIES[i];
    try {
      out[t] = await buildTerritoryEvolutionState(t);
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
