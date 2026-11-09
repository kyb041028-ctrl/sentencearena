/**
 * 개발용 공통 투표 규칙.
 * 운영 인증이 아니다. 브라우저가 보낸 나이와 개발 헤더는 자격 증거가 아니다.
 * 지도자 선거투표, 시민 탄핵투표, 당선 확정, 최종 탄핵 확정은 없다.
 */
'use strict';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const KINDS = Object.freeze({
  representative_impeachment_24h: Object.freeze({
    id: 'representative_impeachment_24h',
    durationMs: 24 * HOUR_MS,
    territories: Object.freeze(['pioneer', 'guardian']),
    quorum: 5,
  }),
});

function emptyStore() {
  return { ballots: [], votes: [], blocks: [] };
}

function kindOf(voteKind) {
  return KINDS[voteKind] || null;
}

function findBallot(store, ballotId) {
  return store.ballots.filter(function (row) { return row.id === ballotId; })[0] || null;
}

function votesFor(store, ballotId) {
  return store.votes.filter(function (row) { return row.ballotId === ballotId; });
}

function tally(votes) {
  const yes = votes.filter(function (row) { return row.choice === 'yes'; }).length;
  const no = votes.filter(function (row) { return row.choice === 'no'; }).length;
  return { yes: yes, no: no, cast: yes + no };
}

function actorError(actor) {
  if (!actor || actor.verified !== true || actor.authSource !== 'test-fixture') return 'AUTH_UNVERIFIED';
  if (actor.age != null || actor.dob != null || actor.birthDate != null) return 'AUTH_UNVERIFIED';
  return null;
}

function openBallot(store, input) {
  const src = input || {};
  const kind = kindOf(src.voteKind);
  if (!kind) return { ok: false, reason: 'VOTE_KIND_UNKNOWN' };
  const country = String(src.country || '');
  const territory = String(src.territory || '');
  if (country !== 'KR' && country !== 'US') return { ok: false, reason: 'COUNTRY_REQUIRED' };
  if (kind.territories.indexOf(territory) < 0) return { ok: false, reason: 'TERRITORY_NOT_ELIGIBLE' };
  const startsAtMs = Number(src.startsAtMs);
  if (!isFinite(startsAtMs)) return { ok: false, reason: 'CLOCK_REQUIRED' };
  const eligibleIds = Array.isArray(src.eligibleRepresentativeIds) ? src.eligibleRepresentativeIds.map(String) : [];
  if (!eligibleIds.length) return { ok: false, reason: 'ELIGIBLE_REQUIRED' };
  const ballotId = kind.id + ':' + country + ':' + territory + ':' + String(src.subjectId || '');
  if (findBallot(store, ballotId)) return { ok: false, reason: 'BALLOT_EXISTS', ballot: findBallot(store, ballotId) };
  const ballot = {
    id: ballotId,
    voteKind: kind.id,
    country: country,
    territory: territory,
    subjectId: String(src.subjectId || ''),
    leaderId: String(src.leaderId || ''),
    leaderName: String(src.leaderName || ''),
    proposerId: String(src.proposerId || ''),
    proposerName: String(src.proposerName || ''),
    status: 'open',
    startsAtMs: startsAtMs,
    endsAtMs: startsAtMs + kind.durationMs,
    eligibleRepresentativeIds: eligibleIds,
    result: null,
    nextProcedure: null,
    citizenVoteOpened: false,
    closedOnce: false,
    failReason: null,
  };
  store.ballots.push(ballot);
  return { ok: true, ballot: ballot };
}

function castVote(store, input) {
  const src = input || {};
  const ballot = findBallot(store, src.ballotId);
  if (!ballot) return { ok: false, reason: 'BALLOT_NOT_FOUND' };
  if (ballot.status === 'halted') return { ok: false, reason: 'HALTED' };
  if (ballot.status === 'error') return { ok: false, reason: 'VOTE_ERROR' };
  if (ballot.status === 'closed') return { ok: false, reason: 'CLOSED' };
  const actor = src.actor || {};
  const auth = actorError(actor);
  if (auth) return { ok: false, reason: auth };
  const nowMs = Number(src.nowMs);
  if (!isFinite(nowMs)) return { ok: false, reason: 'CLOCK_REQUIRED' };
  if (nowMs < ballot.startsAtMs) return { ok: false, reason: 'NOT_STARTED' };
  if (nowMs >= ballot.endsAtMs) return { ok: false, reason: 'CLOSED' };
  if (actor.country !== ballot.country || actor.territory !== ballot.territory) return { ok: false, reason: 'CROSS_SCOPE' };
  if (actor.office !== 'representative') return { ok: false, reason: 'NOT_REPRESENTATIVE' };
  if (ballot.eligibleRepresentativeIds.indexOf(String(actor.id)) < 0) return { ok: false, reason: 'NOT_ELIGIBLE' };
  const choice = String(src.choice || '');
  if (choice !== 'yes' && choice !== 'no' && choice !== 'abstain') return { ok: false, reason: 'CHOICE_INVALID' };
  const existing = votesFor(store, ballot.id).filter(function (row) { return row.voterId === String(actor.id); })[0];
  if (existing) return { ok: false, reason: 'DUPLICATE_VOTE' };
  const vote = { ballotId: ballot.id, voterId: String(actor.id), choice: choice, atMs: nowMs };
  store.votes.push(vote);
  return { ok: true, vote: vote, publicView: publicView(store, ballot.id, nowMs) };
}

function decide(kind, votes) {
  const counts = tally(votes);
  if (counts.cast < kind.quorum) return { result: 'failed', failReason: 'QUORUM', counts: counts };
  if (counts.yes > counts.no) return { result: 'passed', failReason: null, counts: counts };
  return { result: 'failed', failReason: counts.yes === counts.no ? 'TIE' : 'MINORITY', counts: counts };
}

function closeBallot(store, input) {
  const src = input || {};
  const ballot = findBallot(store, src.ballotId);
  if (!ballot) return { ok: false, reason: 'BALLOT_NOT_FOUND' };
  if (ballot.status === 'halted') return { ok: false, reason: 'HALTED' };
  if (ballot.status === 'error') return { ok: false, reason: 'VOTE_ERROR' };
  const nowMs = Number(src.nowMs);
  if (!isFinite(nowMs)) return { ok: false, reason: 'CLOCK_REQUIRED' };
  if (ballot.closedOnce) {
    return { ok: true, alreadyClosed: true, ballot: ballot, publicView: publicView(store, ballot.id, nowMs) };
  }
  if (nowMs < ballot.endsAtMs) return { ok: false, reason: 'NOT_ENDED' };
  const kind = kindOf(ballot.voteKind);
  const decision = decide(kind, votesFor(store, ballot.id));
  ballot.status = 'closed';
  ballot.closedOnce = true;
  ballot.closedAtMs = nowMs;
  ballot.result = decision.result;
  ballot.failReason = decision.failReason;
  ballot.finalCounts = decision.counts;
  if (decision.result === 'passed') {
    ballot.nextProcedure = 'citizen_impeachment_waiting';
    ballot.citizenVoteOpened = false;
  } else {
    ballot.nextProcedure = 'reproposal_blocked_28d';
    ballot.citizenVoteOpened = false;
    store.blocks.push({
      leaderId: ballot.leaderId,
      country: ballot.country,
      territory: ballot.territory,
      ballotId: ballot.id,
      blockedUntilMs: nowMs + 28 * DAY_MS,
    });
  }
  return { ok: true, alreadyClosed: false, ballot: ballot, publicView: publicView(store, ballot.id, nowMs) };
}

function haltBallot(store, ballotId) {
  const ballot = findBallot(store, ballotId);
  if (!ballot) return { ok: false, reason: 'BALLOT_NOT_FOUND' };
  if (ballot.closedOnce) return { ok: false, reason: 'CLOSED' };
  ballot.status = 'halted';
  return { ok: true, ballot: ballot };
}

function markBallotError(store, ballotId) {
  const ballot = findBallot(store, ballotId);
  if (!ballot) return { ok: false, reason: 'BALLOT_NOT_FOUND' };
  if (ballot.closedOnce) return { ok: false, reason: 'CLOSED' };
  ballot.status = 'error';
  return { ok: true, ballot: ballot };
}

function publicView(store, ballotId, nowMs) {
  const ballot = findBallot(store, ballotId);
  if (!ballot) return null;
  const counts = ballot.closedOnce ? ballot.finalCounts : tally(votesFor(store, ballot.id));
  const eligible = ballot.eligibleRepresentativeIds.length;
  const turnoutPct = eligible ? Math.floor((counts.cast * 100) / eligible) : null;
  const view = {
    id: ballot.id,
    voteKind: ballot.voteKind,
    country: ballot.country,
    territory: ballot.territory,
    leaderId: ballot.leaderId,
    leaderName: ballot.leaderName,
    proposerId: ballot.proposerId,
    proposerName: ballot.proposerName,
    status: ballot.status,
    startsAtMs: ballot.startsAtMs,
    endsAtMs: ballot.endsAtMs,
    remainingMs: ballot.status === 'open' ? Math.max(0, ballot.endsAtMs - Number(nowMs || 0)) : 0,
    turnoutPct: turnoutPct,
    eligibleCount: eligible,
    simulation: true,
    citizenVoteOpened: false,
  };
  if (!ballot.closedOnce) {
    view.countsHidden = true;
    return view;
  }
  view.countsHidden = false;
  view.yes = counts.yes;
  view.no = counts.no;
  view.result = ballot.result;
  view.failReason = ballot.failReason;
  view.nextProcedure = ballot.nextProcedure;
  view.citizenVoteOpened = ballot.citizenVoteOpened === true;
  return view;
}

module.exports = {
  HOUR_MS: HOUR_MS,
  DAY_MS: DAY_MS,
  KINDS: KINDS,
  emptyStore: emptyStore,
  openBallot: openBallot,
  castVote: castVote,
  closeBallot: closeBallot,
  haltBallot: haltBallot,
  markBallotError: markBallotError,
  publicView: publicView,
  tally: tally,
};
