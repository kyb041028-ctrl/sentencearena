'use strict';

const modCore = require('../shared/alien-moderation-core');
const accessCore = require('../shared/alien-access-core');
const mapper = require('./alien-moderation-mapper');
const memoryRepo = require('./alien-moderation-memory-repository');

let _repo = memoryRepo;
let _mode = 'LEGACY_LOCAL';

function setRepository(repo) {
  _repo = repo || memoryRepo;
}

function setDataMode(mode) {
  const m = String(mode || 'LEGACY_LOCAL').toUpperCase();
  if (m === 'API_OPERATIONAL') {
    _mode = 'LEGACY_LOCAL';
    return;
  }
  _mode = m === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL';
}

function getDataMode() {
  return _mode;
}

function isActivated() {
  return false;
}

function isAutoDecisionEnabled() {
  return false;
}

async function getModerationState(userId, audience) {
  const state = await _repo.getModerationState(userId);
  if (audience === 'operator') return mapper.mapStateForOperator(state);
  if (audience === 'public') return mapper.mapStateForPublic(state);
  return mapper.mapStateForSelf(state);
}

async function getAccessContext(userId) {
  const state = await _repo.getModerationState(userId);
  return accessCore.getAlienUserContextFromStatus({
    userId,
    status: (state && state.status) || modCore.STATUS.EARTH,
  });
}

async function listModerationEvents(userId, paging) {
  return _repo.listModerationEvents(userId, paging);
}

async function appendModerationSignal(signal) {
  if (_mode === 'API_OPERATIONAL') {
    return { ok: false, error: 'ALIEN_OPERATIONAL_FORBIDDEN' };
  }
  if (_mode === 'API_DRY_RUN') {
    return { ok: true, dryRun: true, signal: signal || null, note: 'NO_WRITE' };
  }
  return _repo.appendModerationSignal(signal);
}

async function planAlienTransfer(input) {
  return _repo.planAlienTransfer(input);
}

async function persistAlienTransferPlan(plan) {
  void plan;
  return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'REAL_TRANSFER_FORBIDDEN' };
}

async function planAlienReturn(input) {
  return _repo.planAlienReturn(input);
}

async function persistAlienReturnPlan(plan) {
  void plan;
  return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'REAL_RETURN_FORBIDDEN' };
}

async function markReturnEligible(input) {
  void input;
  return { ok: false, error: 'ALIEN_PERSIST_DISABLED' };
}

async function healthCheck() {
  const repoHealth = await _repo.healthCheck();
  return {
    mode: _mode,
    activated: isActivated(),
    autoDecisionEnabled: isAutoDecisionEnabled(),
    schedulerEnabled: false,
    repository: repoHealth,
  };
}

module.exports = {
  setRepository,
  setDataMode,
  getDataMode,
  isActivated,
  isAutoDecisionEnabled,
  getModerationState,
  getAccessContext,
  listModerationEvents,
  appendModerationSignal,
  planAlienTransfer,
  persistAlienTransferPlan,
  planAlienReturn,
  persistAlienReturnPlan,
  markReturnEligible,
  healthCheck,
};
