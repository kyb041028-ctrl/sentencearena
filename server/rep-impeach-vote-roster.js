/**
 * 개발용 현직 대표 명단.
 * test-fixture만 돌려준다. 운영 인증과 devAuth로 이 명단을 열지 않는다.
 */
'use strict';

const TEST_IDS = Object.freeze({
  KR: Object.freeze(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']),
  US: Object.freeze(['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8']),
});

function representatives(input) {
  const src = input || {};
  if (src.authKind === 'production' || src.productionAuth === true || src.devAuth === true) {
    return { ok: false, reason: 'PRODUCTION_AUTH_NOT_CONNECTED', productionAuth: false, ids: [] };
  }
  if (src.authKind !== 'test-fixture') {
    return { ok: false, reason: 'ROSTER_UNVERIFIED', productionAuth: false, ids: [] };
  }
  if (src.territory !== 'pioneer' && src.territory !== 'guardian') {
    return { ok: false, reason: 'TERRITORY_NOT_ELIGIBLE', productionAuth: false, ids: [] };
  }
  const ids = TEST_IDS[src.country];
  if (!ids) return { ok: false, reason: 'COUNTRY_REQUIRED', productionAuth: false, ids: [] };
  return { ok: true, authKind: 'test-fixture', productionAuth: false, ids: ids.slice() };
}

module.exports = { representatives: representatives, TEST_IDS: TEST_IDS };
