'use strict';

const rankCore = require('../shared/alien-rank-core');
const memoryRepo = require('./alien-rank-memory-repository');

let _repo = memoryRepo;
let _mode = 'LEGACY_LOCAL';

function setRepository(repo) {
  _repo = repo || memoryRepo;
}

function setDataMode(mode) {
  const m = String(mode || 'LEGACY_LOCAL').toUpperCase();
  _mode = m === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL';
}

function getDataMode() {
  return _mode;
}

function isCalculationEnabled() {
  return false;
}

function isWeeklyLegendEnabled() {
  return false;
}

async function getAlienRank(userId) {
  return _repo.getAlienRank(userId);
}

async function listAlienRanks(paging) {
  return _repo.listAlienRanks(paging);
}

async function getWeeklyLegend(weekKey) {
  return _repo.getWeeklyLegend(weekKey);
}

async function listLegendHistory(userId) {
  return _repo.listLegendHistory(userId);
}

async function planWeeklySelection(input) {
  return rankCore.planAlienWeeklyLegendSelection(input);
}

async function persistWeeklySelection() {
  return { ok: false, error: 'WEEKLY_PERSIST_DISABLED' };
}

async function healthCheck() {
  return Object.assign({ mode: _mode }, await _repo.healthCheck(), {
    calculationEnabled: isCalculationEnabled(),
    weeklyLegendEnabled: isWeeklyLegendEnabled(),
    definitions: rankCore.listRankDefinitions(),
  });
}

module.exports = {
  setRepository,
  setDataMode,
  getDataMode,
  isCalculationEnabled,
  isWeeklyLegendEnabled,
  getAlienRank,
  listAlienRanks,
  getWeeklyLegend,
  listLegendHistory,
  planWeeklySelection,
  persistWeeklySelection,
  healthCheck,
};
