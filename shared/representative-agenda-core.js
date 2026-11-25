/**
 * 지도자의제. 대표 발행과 여러 초안 중 고르기는 쓰지 않는다.
 * 월요일인지만 본다. 발행 시각은 새로 정하지 않는다.
 * 1주는 진보, 2주는 보수, 그 다음부터 반복한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LeaderAgendaCore = factory();
    root.RepresentativeAgendaCore = root.LeaderAgendaCore;
  }
})(typeof self !== 'undefined' ? self : this, function leaderAgendaCoreFactory() {
  'use strict';

  function sideForWeek(weekNumber) {
    var n = Number(weekNumber);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1) return null;
    return n % 2 === 1 ? 'pioneer' : 'guardian';
  }

  function decide(input) {
    var src = input || {};
    if (src.country !== 'KR' && src.country !== 'US') {
      return { ok: false, published: false, reason: 'COUNTRY_REQUIRED', name: '지도자의제' };
    }
    var side = sideForWeek(src.weekNumber);
    if (!side) return { ok: false, published: false, reason: 'WEEK_REQUIRED', name: '지도자의제' };
    if (String(src.weekday || '') !== 'Mon') {
      return { ok: true, published: false, reason: 'NOT_MONDAY', side: side, country: src.country, name: '지도자의제' };
    }
    if (!src.sessionUserId) {
      return { ok: false, published: false, reason: 'AUTH_NOT_CONNECTED', side: side, country: src.country, name: '지도자의제' };
    }
    if (src.authorRank === 'representative') {
      return { ok: false, published: false, reason: 'REPRESENTATIVE_CANNOT_WRITE', side: side, country: src.country, name: '지도자의제' };
    }
    if (Array.isArray(src.drafts) && src.drafts.length > 1) {
      return { ok: false, published: false, reason: 'DRAFT_SELECTION_REMOVED', side: side, country: src.country, name: '지도자의제' };
    }
    var office = (src.offices || []).filter(function (row) {
      return row && row.country === src.country && row.territory === side && row.leaderId;
    })[0];
    if (!office || src.authorityRevoked === true) {
      return {
        ok: true,
        published: false,
        reason: src.authorityRevoked === true ? 'TERM_ENDED' : 'VACANT_UNPUBLISHED',
        side: side,
        country: src.country,
        board: 'central',
        substitute: false,
        name: '지도자의제',
      };
    }
    if (String(src.sessionUserId) !== String(office.leaderId)) {
      var other = (src.offices || []).some(function (row) {
        return row && row.country === src.country && row.leaderId && String(row.leaderId) === String(src.sessionUserId) && row.territory !== side;
      });
      return {
        ok: false,
        published: false,
        reason: other ? 'OTHER_FACTION_LEADER' : 'NOT_THE_LEADER',
        side: side,
        country: src.country,
        name: '지도자의제',
      };
    }
    var title = String(src.title || '').trim();
    var body = String(src.body || '').trim();
    if (!title || !body) {
      return {
        ok: true,
        published: false,
        reason: 'NO_TEXT',
        side: side,
        country: src.country,
        board: 'central',
        substitute: false,
        name: '지도자의제',
      };
    }
    return {
      ok: true,
      published: true,
      reason: 'LEADER_WROTE',
      side: side,
      country: src.country,
      board: 'central',
      title: title,
      body: body,
      authorId: office.leaderId,
      substitute: false,
      name: '지도자의제',
    };
  }

  return {
    sideForWeek: sideForWeek,
    decide: decide,
    turnFor: sideForWeek,
    assess: decide,
  };
});
