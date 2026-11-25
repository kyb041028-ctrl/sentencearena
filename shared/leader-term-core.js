/**
 * 지도자 임기. 시즌 길이는 정하지 않는다.
 * 종료 시각은 취임 달력 3개월과, 호출자가 준 시즌 종료 시각 중 더 빠른 쪽이다.
 * 시즌 종료 시각이 없으면 날짜를 만들지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LeaderTermCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function leaderTermCoreFactory() {
  'use strict';

  var SEASON_LENGTH = 'UNCONFIRMED';

  function daysInMonth(year, monthIndex) {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  }

  function addCalendarMonths(ms, months) {
    var date = new Date(ms);
    var total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
    var year = Math.floor(total / 12);
    var month = total % 12;
    if (month < 0) {
      month += 12;
      year -= 1;
    }
    var day = Math.min(date.getUTCDate(), daysInMonth(year, month));
    return Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
  }

  function planTerm(input) {
    var src = input || {};
    var started = Number(src.inauguratedAtMs);
    if (!isFinite(started)) return { ok: false, reason: 'INAUGURATION_REQUIRED', seasonLength: SEASON_LENGTH };
    var threeMonthAtMs = addCalendarMonths(started, 3);
    var seasonEnd = src.seasonEndAtMs == null || src.seasonEndAtMs === '' ? null : Number(src.seasonEndAtMs);
    if (seasonEnd != null && !isFinite(seasonEnd)) {
      return { ok: false, reason: 'SEASON_END_INVALID', seasonLength: SEASON_LENGTH };
    }
    var seasonKnown = seasonEnd != null;
    var earlierAtMs = seasonKnown && seasonEnd < threeMonthAtMs ? seasonEnd : threeMonthAtMs;
    var earlierReason = seasonKnown && seasonEnd < threeMonthAtMs ? 'SEASON_END' : 'THREE_MONTH';
    return {
      ok: true,
      seasonLength: SEASON_LENGTH,
      seasonId: src.seasonId == null || src.seasonId === '' ? null : String(src.seasonId),
      inauguratedAtMs: started,
      threeMonthAtMs: threeMonthAtMs,
      seasonEndAtMs: seasonKnown ? seasonEnd : null,
      seasonEndStatus: seasonKnown ? 'PROVIDED' : 'SEASON_END_UNCONFIRMED',
      earlierAtMs: earlierAtMs,
      earlierReason: earlierReason,
    };
  }

  function authorityAt(plan, asOfMs) {
    if (!plan || plan.ok !== true) return { ok: false, reason: 'TERM_PLAN_REQUIRED', holdsOffice: false };
    var asOf = Number(asOfMs);
    if (!isFinite(asOf)) return { ok: false, reason: 'CLOCK_REQUIRED', holdsOffice: false };
    var ended = asOf >= plan.earlierAtMs;
    return {
      ok: true,
      holdsOffice: !ended,
      revoked: ended,
      revokedAtMs: ended ? plan.earlierAtMs : null,
      reason: ended ? plan.earlierReason : 'IN_TERM',
    };
  }

  function applyEnd(office, asOfMs, cause) {
    var row = office || {};
    if (row.revoked === true) {
      return { ok: true, applied: false, reason: 'ALREADY_PROCESSED', office: row, leaderCount: 0 };
    }
    var plan = row.term || planTerm(row);
    if (!plan.ok) return { ok: false, reason: plan.reason, office: row, leaderCount: row.leaderId ? 1 : 0 };
    var auth = authorityAt(plan, asOfMs);
    var forced = cause === 'IMPEACHMENT' || cause === 'SEASON_END';
    if (!forced && !auth.revoked) {
      return { ok: true, applied: false, reason: 'STILL_IN_TERM', office: Object.assign({}, row, { term: plan }), leaderCount: 1 };
    }
    var next = {
      country: row.country,
      territory: row.territory,
      leaderId: null,
      rank: 'citizen',
      revoked: true,
      revokedAtMs: forced ? Number(asOfMs) : plan.earlierAtMs,
      cause: forced ? cause : plan.earlierReason,
      term: plan,
      history: (row.history || []).concat([{ atMs: Number(asOfMs), cause: forced ? cause : plan.earlierReason, personId: row.leaderId }]),
      vacancyStartMs: forced ? Number(asOfMs) : plan.earlierAtMs,
    };
    return { ok: true, applied: true, reason: next.cause, office: next, leaderCount: 0 };
  }

  return {
    SEASON_LENGTH: SEASON_LENGTH,
    addCalendarMonths: addCalendarMonths,
    planTerm: planTerm,
    authorityAt: authorityAt,
    applyEnd: applyEnd,
  };
});
