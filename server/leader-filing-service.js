/**
 * 개발용 지도자 후보 등록과 탄핵 발의.
 * 투표 집계, 당선 확정, 탄핵 확정은 하지 않는다.
 * 일반 선거 후보 등록 기간은 정책에 없으므로 상수로 두지 않고 호출자가 넣는다.
 * devAuth는 운영 인증이 아니다. 이 모듈은 Postgres에 쓰지 않는다.
 */
'use strict';

const fs = require('fs');

const DAY_MS = 24 * 60 * 60 * 1000;
const REPROPOSAL_BLOCK_MS = 28 * DAY_MS;
const POST_IMPEACHMENT_SCHEDULE = Object.freeze({
  vacantDays: 7,
  filingDays: 3,
  reviewDays: 2,
  electionHours: 48,
  note: 'CONFIRMED_ONLY_AFTER_IMPEACHMENT',
});
const OPEN_CANDIDACY = Object.freeze(['submitted', 'in_review']);
const OPEN_IMPEACHMENT = Object.freeze(['received', 'representative_vote_pending']);

function emptyStore() {
  return { candidacies: [], impeachments: [] };
}

function readStore(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    candidacies: Array.isArray(parsed.candidacies) ? parsed.candidacies : [],
    impeachments: Array.isArray(parsed.impeachments) ? parsed.impeachments : [],
  };
}

function writeStore(filePath, store) {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  return store;
}

function devActor(actor) {
  if (!actor || actor.devAuth !== true) return { ok: false, reason: 'DEV_AUTH_REQUIRED' };
  return { ok: true };
}

function scopeError(actor, country, territory) {
  if (country !== 'KR' && country !== 'US') return 'COUNTRY_REQUIRED';
  if (territory !== 'pioneer' && territory !== 'guardian') return 'TERRITORY_NOT_ELIGIBLE';
  if (!actor || actor.country !== country || actor.territory !== territory) return 'CROSS_SCOPE';
  if (actor.office !== 'representative') return 'NOT_REPRESENTATIVE';
  return null;
}

function windowError(windowSpec) {
  if (!windowSpec || windowSpec.provided !== true) return 'FILING_WINDOW_UNCONFIRMED';
  if (windowSpec.open !== true) return 'OUTSIDE_WINDOW';
  return null;
}

function fileCandidacy(store, input) {
  const src = input || {};
  const actor = src.actor || {};
  const auth = devActor(actor);
  if (!auth.ok) return { ok: false, reason: auth.reason, stored: false };
  const country = String(src.country || '');
  const territory = String(src.territory || '');
  const scope = scopeError(actor, country, territory);
  if (scope) return { ok: false, reason: scope, stored: false };
  const windowGate = windowError(src.window);
  if (windowGate) return { ok: false, reason: windowGate, stored: false };
  if (src.preview !== true && src.intentConfirmed !== true) {
    return { ok: false, reason: 'INTENT_NOT_CONFIRMED', stored: false };
  }
  const duplicate = store.candidacies.some(function (row) {
    return row.actorId === actor.id && row.country === country && row.territory === territory && OPEN_CANDIDACY.indexOf(row.status) >= 0;
  });
  if (duplicate) return { ok: false, reason: 'DUPLICATE_CANDIDACY', stored: false };
  if (src.preview === true) return { ok: true, reason: null, stored: false, preview: true };
  const row = {
    id: 'cand-' + country + '-' + territory + '-' + String(actor.id) + '-' + store.candidacies.length,
    actorId: String(actor.id),
    actorName: String(actor.name || actor.id),
    country: country,
    territory: territory,
    status: 'submitted',
    review: 'pending',
    windowProvided: true,
    createdAtMs: src.nowMs != null ? Number(src.nowMs) : null,
  };
  store.candidacies.push(row);
  return { ok: true, reason: null, stored: true, candidacy: row };
}

function advanceCandidacy(store, input) {
  const src = input || {};
  const actor = src.actor || {};
  const auth = devActor(actor);
  if (!auth.ok) return { ok: false, reason: auth.reason };
  if (actor.office !== 'dev-clerk') return { ok: false, reason: 'REVIEW_ACTOR_REQUIRED' };
  const row = store.candidacies.filter(function (item) { return item.id === src.candidacyId; })[0];
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  if (src.action === 'start_review') {
    if (row.status !== 'submitted') return { ok: false, reason: 'STATUS_CONFLICT' };
    row.status = 'in_review';
    row.review = 'in_review';
    return { ok: true, candidacy: row };
  }
  if (src.action === 'close_registration') {
    if (!src.window || src.window.provided !== true || src.window.closing !== true) {
      return { ok: false, reason: 'FILING_WINDOW_UNCONFIRMED' };
    }
    row.status = 'registration_closed';
    return { ok: true, candidacy: row };
  }
  return { ok: false, reason: 'ACTION_UNKNOWN' };
}

function proposeImpeachment(store, input) {
  const src = input || {};
  const actor = src.actor || {};
  const leader = src.leader || null;
  const auth = devActor(actor);
  if (!auth.ok) return { ok: false, reason: auth.reason, stored: false };
  const country = String(src.country || '');
  const territory = String(src.territory || '');
  const scope = scopeError(actor, country, territory);
  if (scope) return { ok: false, reason: scope, stored: false };
  if (!leader || leader.country !== country || leader.territory !== territory || !leader.id) {
    return { ok: false, reason: 'NO_SITTING_LEADER', stored: false };
  }
  const reason = String(src.reason || '').trim();
  if (!reason) return { ok: false, reason: 'REASON_REQUIRED', stored: false };
  const nowMs = Number(src.nowMs);
  if (!isFinite(nowMs)) return { ok: false, reason: 'CLOCK_REQUIRED', stored: false };
  const blocked = store.impeachments.some(function (row) {
    return row.leaderId === String(leader.id) && row.country === country && row.territory === territory && row.status === 'failed' && isFinite(Number(row.failedAtMs)) && nowMs - Number(row.failedAtMs) < REPROPOSAL_BLOCK_MS;
  });
  if (blocked) return { ok: false, reason: 'REPROPOSAL_BLOCKED_28D', stored: false };
  const conflict = store.impeachments.some(function (row) {
    return row.leaderId === String(leader.id) && row.country === country && row.territory === territory && OPEN_IMPEACHMENT.indexOf(row.status) >= 0;
  });
  if (conflict) return { ok: false, reason: 'PROCEDURE_CONFLICT', stored: false };
  const sittingLeader = {
    name: String(leader.name || '').trim(),
    country: country,
    territory: territory,
  };
  if (src.preview === true) {
    return { ok: true, reason: null, stored: false, preview: true, leaderView: sittingLeader };
  }
  const row = {
    id: 'imp-' + country + '-' + territory + '-' + store.impeachments.length,
    actorId: String(actor.id),
    actorName: String(actor.name || actor.id),
    leaderId: String(leader.id),
    leaderName: sittingLeader.name,
    country: country,
    territory: territory,
    reason: reason,
    status: 'received',
    nextStep: 'representative_vote_24h',
    tally: null,
    confirmed: false,
    createdAtMs: nowMs,
  };
  store.impeachments.push(row);
  return { ok: true, reason: null, stored: true, proposal: row, leaderView: sittingLeader, postImpeachmentSchedule: POST_IMPEACHMENT_SCHEDULE };
}

function listCandidacies(store, country, territory) {
  return store.candidacies.filter(function (row) {
    return row.country === country && row.territory === territory;
  });
}

function listImpeachments(store, country, territory) {
  return store.impeachments.filter(function (row) {
    return row.country === country && row.territory === territory;
  });
}

module.exports = {
  REPROPOSAL_BLOCK_MS: REPROPOSAL_BLOCK_MS,
  POST_IMPEACHMENT_SCHEDULE: POST_IMPEACHMENT_SCHEDULE,
  emptyStore: emptyStore,
  readStore: readStore,
  writeStore: writeStore,
  fileCandidacy: fileCandidacy,
  advanceCandidacy: advanceCandidacy,
  proposeImpeachment: proposeImpeachment,
  listCandidacies: listCandidacies,
  listImpeachments: listImpeachments,
};
