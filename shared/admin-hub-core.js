(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AdminHubCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function adminHubCoreFactory() {
  'use strict';

  var TIME_ZONE = 'Asia/Seoul';
  var KST_OFFSET_MS = 9 * 3600000;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var INQUIRY_KINDS = ['BUG', 'IMPROVEMENT', 'GENERAL'];
  var INQUIRY_STATUSES = ['RECEIVED', 'IN_PROGRESS', 'DONE', 'ON_HOLD'];
  var INQUIRY_KIND_LABEL = { BUG: '오류', IMPROVEMENT: '개선', GENERAL: '일반 문의' };
  var INQUIRY_STATUS_LABEL = { RECEIVED: '접수', IN_PROGRESS: '확인 중', DONE: '처리 완료', ON_HOLD: '보류' };
  var INTERNAL_NOTE_MAX = 2000;

  function parsePaging(query) {
    var q = query || {};
    var page = parseInt(q.page, 10);
    var size = parseInt(q.pageSize, 10);
    if (!(page >= 1)) page = 1;
    if (!(size >= 1)) size = 20;
    if (size > 50) size = 50;
    return { page: page, pageSize: size, offset: (page - 1) * size };
  }

  function isUuid(v) {
    return UUID_RE.test(String(v || ''));
  }

  function kstSlotIso(nowMs, dayOffset, hour) {
    var kst = new Date(nowMs + KST_OFFSET_MS);
    var utcMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + dayOffset, hour, 0, 0) - KST_OFFSET_MS;
    return new Date(utcMs).toISOString();
  }

  /** 05:00 / 17:00 KST 중 now 이후 가장 가까운 시각. 점수 계산과 무관한 표시용. */
  function nextAlignmentSlot(nowIso) {
    var nowMs = Date.parse(nowIso);
    if (!isFinite(nowMs)) return null;
    var candidates = [];
    for (var d = 0; d <= 1; d++) {
      candidates.push(kstSlotIso(nowMs, d, 5));
      candidates.push(kstSlotIso(nowMs, d, 17));
    }
    for (var i = 0; i < candidates.length; i++) {
      if (Date.parse(candidates[i]) > nowMs) return candidates[i];
    }
    return null;
  }

  function iso(v) {
    if (v == null) return null;
    var t = new Date(v).getTime();
    return isFinite(t) ? new Date(t).toISOString() : null;
  }

  function numOrNull(v) {
    if (v == null) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /** 허용 필드만 내보낸다. 이메일·토큰·성향 원자료는 읽지도 않는다. */
  function serializeMember(row, extra) {
    var e = extra || {};
    return {
      id: String(row.id),
      displayName: row.display_name == null ? null : String(row.display_name),
      joinedAt: iso(row.created_at),
      territory: row.territory == null ? null : String(row.territory).toLowerCase(),
      territoryStatus: row.territory == null ? (e.territoryKnown === false ? 'NOT_CONFIRMED' : 'NOT_SET') : 'OK',
      level: e.level == null ? null : numOrNull(e.level),
      reputation: e.reputation == null ? null : numOrNull(e.reputation),
      progressionStatus: e.progressionKnown === false ? 'NOT_CONFIRMED' : (e.level == null ? 'NO_DATA' : 'OK'),
      lastActivityAt: e.lastActivityAt || null,
      lastActivityStatus: e.activityKnown === false ? 'NOT_CONFIRMED' : (e.lastActivityAt ? 'OK' : 'NO_RECORD'),
      sanctionCount: e.sanctionKnown === false ? null : (e.sanctionCount || 0),
      activeSanctionCount: e.sanctionKnown === false ? null : (e.activeSanctionCount || 0),
      sanctionStatus: e.sanctionKnown === false ? 'NOT_CONFIRMED' : 'OK',
      status: e.sanctionKnown === false ? 'NOT_CONFIRMED' : ((e.activeSanctionCount || 0) > 0 ? 'SANCTIONED' : 'NORMAL'),
    };
  }

  function serializeInquiry(row, withBody) {
    var out = {
      id: String(row.id),
      kind: row.kind,
      title: row.title,
      status: row.status,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      hasInternalNote: !!(row.internal_note && String(row.internal_note).length),
    };
    if (withBody) {
      out.body = row.body;
      out.internalNote = row.internal_note == null ? '' : row.internal_note;
    }
    return out;
  }

  return {
    TIME_ZONE: TIME_ZONE,
    INQUIRY_KINDS: INQUIRY_KINDS,
    INQUIRY_STATUSES: INQUIRY_STATUSES,
    INQUIRY_KIND_LABEL: INQUIRY_KIND_LABEL,
    INQUIRY_STATUS_LABEL: INQUIRY_STATUS_LABEL,
    INTERNAL_NOTE_MAX: INTERNAL_NOTE_MAX,
    parsePaging: parsePaging,
    isUuid: isUuid,
    nextAlignmentSlot: nextAlignmentSlot,
    serializeMember: serializeMember,
    serializeInquiry: serializeInquiry,
  };
});
