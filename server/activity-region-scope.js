'use strict';

/**
 * 활동 국가는 서버가 정한 값만 쓴다.
 * 클라이언트가 다른 국가를 넘기면 거절하고, 비어 있으면 서버 국가를 쓴다.
 * 새 글 목록은 명시된 KR/US만 보여 준다. 빈 국가는 어느 나라로도 넣지 않는다.
 */

const core = require('../shared/activity-region-core');

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function requestedFrom(input) {
  if (!input || typeof input !== 'object') return '';
  if (input.activityRegion != null && input.activityRegion !== '') return input.activityRegion;
  if (input.activity_region != null && input.activity_region !== '') return input.activity_region;
  return '';
}

function activeOf(actor) {
  return core.normalizeRegion(actor && actor.activityRegion) || 'KR';
}

function bind(actor, input) {
  const gate = core.assertWriteRegion(activeOf(actor), requestedFrom(input));
  if (!gate.ok) throw fail(gate.error);
  return gate.region;
}

function explicitRegion(row) {
  if (!row || typeof row !== 'object') return null;
  return core.normalizeRegion(row.activityRegion || row.activity_region);
}

function rowRegion(row) {
  return core.rowRegion(row);
}

function visible(row, region) {
  const want = core.normalizeRegion(region);
  if (!want) return false;
  return explicitRegion(row) === want;
}

function legacyUnassigned(row) {
  return explicitRegion(row) == null;
}

module.exports = {
  activeOf: activeOf,
  bind: bind,
  rowRegion: rowRegion,
  explicitRegion: explicitRegion,
  visible: visible,
  legacyUnassigned: legacyUnassigned,
  requestedFrom: requestedFrom,
};
