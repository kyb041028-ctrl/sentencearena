'use strict';

/**
 * 소속 영토가 실제로 바뀐 횟수.
 * 가입 시 최초 영토, 같은 이벤트 재시도, 판정만 되고 확정되지 않은 후보는 세지 않는다.
 * KR과 US는 통을 나누고, 한쪽 횟수를 다른 쪽에 복사하지 않는다.
 */
function createMembershipMoveLedger() {
  const seen = { KR: Object.create(null), US: Object.create(null) };
  const counts = { KR: Object.create(null), US: Object.create(null) };

  function record(event) {
    const src = event || {};
    const region = src.region === 'US' ? 'US' : src.region === 'KR' ? 'KR' : '';
    const userId = String(src.userId || '').trim();
    const eventId = String(src.eventId || '').trim();
    const fromTerritory = String(src.fromTerritory || '').trim();
    const toTerritory = String(src.toTerritory || '').trim();
    if (!region) return { recorded: false, reason: 'REGION_REQUIRED', count: 0 };
    if (!userId || !eventId) return { recorded: false, reason: 'EVENT_ID_REQUIRED', count: 0 };
    if (src.initial === true) return { recorded: false, reason: 'INITIAL_TERRITORY', count: counts[region][userId] || 0 };
    if (!fromTerritory || !toTerritory || fromTerritory === toTerritory) {
      return { recorded: false, reason: 'NOT_A_CHANGE', count: counts[region][userId] || 0 };
    }
    if (src.confirmed !== true) {
      return { recorded: false, reason: 'NOT_CONFIRMED', count: counts[region][userId] || 0 };
    }
    const key = userId + '\n' + eventId;
    if (seen[region][key]) {
      return { recorded: false, reason: 'DUPLICATE', count: counts[region][userId] || 0 };
    }
    seen[region][key] = true;
    counts[region][userId] = (counts[region][userId] || 0) + 1;
    return { recorded: true, reason: 'RECORDED', count: counts[region][userId] };
  }

  function count(region, userId) {
    const bucket = region === 'US' ? 'US' : region === 'KR' ? 'KR' : '';
    if (!bucket) return 0;
    return counts[bucket][String(userId || '').trim()] || 0;
  }

  return { record: record, count: count };
}

module.exports = {
  createMembershipMoveLedger: createMembershipMoveLedger,
};
