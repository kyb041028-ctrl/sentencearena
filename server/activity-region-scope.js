'use strict';

/**
 * 활동 국가는 서버가 정한 값만 쓴다.
 * 클라이언트가 다른 국가를 넘기면 거절하고, 비어 있으면 서버 국가를 쓴다.
 * 국가가 없는 옛 기록은 한국으로 읽는다.
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

function rowRegion(row) {
  return core.rowRegion(row);
}

function visible(row, region) {
  return core.visibleInRegion(row, region);
}

module.exports = {
  activeOf: activeOf,
  bind: bind,
  rowRegion: rowRegion,
  visible: visible,
  requestedFrom: requestedFrom,
};
