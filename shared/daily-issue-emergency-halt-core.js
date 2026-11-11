'use strict';

/**
 * 긴급 중지 — env 자동발행 OFF 와 별개. KR/US 독립.
 */

var REGIONS = Object.freeze({ KR: 'KR', US: 'US' });

var PUBLISH_KIND = Object.freeze({
  AUTO: 'AUTO',
  FORCE: 'FORCE',
  ADMIN: 'ADMIN',
});

var MAINTENANCE_ACTIONS = Object.freeze({
  TEMP_HIDE: true,
  CORRECTION: true,
  RETIRE: true,
  OPS_VERSION: true,
  REJECT: true,
  HOLD: true,
});

function normalizeRegion(value) {
  var r = String(value || '').trim().toUpperCase();
  return r === 'US' ? 'US' : r === 'KR' ? 'KR' : null;
}

function isMaintenanceTransition(fromStatus, toStatus) {
  if (toStatus === 'RETIRED' || toStatus === 'SUPERSEDED') return true;
  if (fromStatus === 'PUBLISHED' && toStatus === 'PUBLISHED') return true;
  if (toStatus === 'HELD' || toStatus === 'REJECTED') return true;
  return false;
}

function blocksNewPublish(halted, publishKind) {
  if (!halted) return false;
  if (!publishKind) return true;
  return publishKind === PUBLISH_KIND.AUTO || publishKind === PUBLISH_KIND.FORCE || publishKind === PUBLISH_KIND.ADMIN;
}

module.exports = {
  REGIONS: REGIONS,
  PUBLISH_KIND: PUBLISH_KIND,
  MAINTENANCE_ACTIONS: MAINTENANCE_ACTIONS,
  normalizeRegion: normalizeRegion,
  isMaintenanceTransition: isMaintenanceTransition,
  blocksNewPublish: blocksNewPublish,
};
