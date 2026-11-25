'use strict';

const haltCore = require('../shared/daily-issue-emergency-halt-core');
const { createSqlEmergencyHaltStore } = require('./daily-issue-emergency-halt-store');
const { createDailyIssuePgExecutor } = require('./daily-issue-pg-client');

function settle(v) {
  if (v && typeof v.then === 'function') return v;
  return Promise.resolve(v);
}

function resolveStore(opt) {
  const o = opt || {};
  if (o.haltStore) return o.haltStore;
  if (o.executor) {
    return createSqlEmergencyHaltStore({ executor: o.executor, schemaName: o.schemaName || o.haltSchemaName });
  }
  if (o.databaseUrl) {
    const ex = createDailyIssuePgExecutor({
      databaseUrl: o.databaseUrl,
      schemaName: o.schemaName || o.haltSchemaName || 'daily_issue_test',
    });
    if (!ex.ok) return null;
    return createSqlEmergencyHaltStore({ executor: ex, schemaName: o.schemaName || 'daily_issue_test' });
  }
  return null;
}

async function getRegionState(region, opt) {
  const store = resolveStore(opt);
  if (!store) {
    return { ok: false, error: 'HALT_STORE_UNAVAILABLE', failClosed: true };
  }
  await settle(store.initialize ? store.initialize() : null);
  return settle(store.getRegion(haltCore.normalizeRegion(region) || region));
}

async function assertPublishAllowed(params) {
  const p = params || {};
  const region = haltCore.normalizeRegion(p.region);
  if (!region) return { ok: false, error: 'INVALID_REGION' };
  const kind = p.publishKind || haltCore.PUBLISH_KIND.ADMIN;
  const state = await getRegionState(region, p);
  if (!state.ok) {
    return {
      ok: false,
      error: 'EMERGENCY_HALT_UNAVAILABLE',
      failClosed: true,
      reasons: ['HALT_STATE_READ_FAILED'],
    };
  }
  if (haltCore.blocksNewPublish(state.halted, kind)) {
    return {
      ok: false,
      error: 'EMERGENCY_HALT_ACTIVE',
      region: region,
      reasons: ['REGION_HALTED'],
      halted: true,
    };
  }
  return { ok: true, region: region, halted: false };
}

async function setEmergencyHalt(params) {
  const p = params || {};
  const store = resolveStore(p);
  if (!store) return { ok: false, error: 'HALT_STORE_UNAVAILABLE' };
  if (!p.actorId) return { ok: false, error: 'ADMIN_ACTOR_REQUIRED' };
  await settle(store.initialize ? store.initialize() : null);
  return settle(
    store.setRegion({
      region: p.region,
      halted: p.halted === true,
      reason: p.reason,
      actorId: p.actorId,
      expectedLockVersion: p.expectedLockVersion,
      meta: p.meta,
    }),
  );
}

function publishKindFromOptions(opt, autoMorning) {
  if (autoMorning) return haltCore.PUBLISH_KIND.AUTO;
  if (opt && opt.forceAutoPublish === true) return haltCore.PUBLISH_KIND.FORCE;
  return haltCore.PUBLISH_KIND.ADMIN;
}

module.exports = {
  getRegionState: getRegionState,
  assertPublishAllowed: assertPublishAllowed,
  setEmergencyHalt: setEmergencyHalt,
  publishKindFromOptions: publishKindFromOptions,
  resolveStore: resolveStore,
};
