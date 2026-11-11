/**
 * 개발용 공통 투표 규칙.
 * 운영 인증이 아니다. 브라우저가 보낸 나이와 개발 헤더는 자격 증거가 아니다.
 * 지도자 선거는 개발용 48시간 투표만 있다. 직위 부여, 시민 탄핵투표, 최종 탄핵 확정은 없다.
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
  leader_election_48h: Object.freeze({
    id: 'leader_election_48h',
    durationMs: 48 * HOUR_MS,
    territories: Object.freeze(['pioneer', 'guardian']),
    choice: 'candidate',
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
  if (!actor) return 'AUTH_UNVERIFIED';
  if (actor.authSource === 'production' || actor.productionAuth === true) return 'PRODUCTION_AUTH_NOT_CONNECTED';
  if (actor.devAuth === true && actor.authSource !== 'test-fixture') return 'DEV_AUTH_NOT_PRODUCTION';
  if (actor.verified !== true || actor.authSource !== 'test-fixture') return 'AUTH_UNVERIFIED';
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
  const candidates = Array.isArray(src.candidates) ? src.candidates.map(function (row) {
    return { id: String(row.id), name: String(row.name || row.id) };
  }).filter(function (row) { return row.id; }) : [];
  if (kind.choice === 'candidate' && candidates.length < 2) return { ok: false, reason: 'CANDIDATES_REQUIRED' };
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
    candidates: kind.choice === 'candidate' ? candidates : [],
    officeGranted: false,
    winnerId: null,
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
  const election = ballot.voteKind === 'leader_election_48h';
  if (!election && actor.office !== 'representative') return { ok: false, reason: 'NOT_REPRESENTATIVE' };
  if (ballot.eligibleRepresentativeIds.indexOf(String(actor.id)) < 0) return { ok: false, reason: 'NOT_ELIGIBLE' };
  const choice = String(src.choice || '');
  if (election) {
    const allowed = (ballot.candidates || []).some(function (row) { return row.id === choice; });
    if (!allowed) return { ok: false, reason: 'CHOICE_INVALID' };
  } else if (choice !== 'yes' && choice !== 'no' && choice !== 'abstain') return { ok: false, reason: 'CHOICE_INVALID' };
  const existing = votesFor(store, ballot.id).filter(function (row) { return row.voterId === String(actor.id); })[0];
  if (existing) return { ok: false, reason: 'DUPLICATE_VOTE' };
  const vote = { ballotId: ballot.id, voterId: String(actor.id), choice: choice, atMs: nowMs };
  store.votes.push(vote);
  return { ok: true, vote: vote, publicView: publicView(store, ballot.id, nowMs) };
}

function candidateTotals(ballot, votes) {
  const totals = (ballot.candidates || []).map(function (row) {
    return { id: row.id, name: row.name, votes: votes.filter(function (vote) { return vote.choice === row.id; }).length };
  });
  const top = totals.reduce(function (max, row) { return row.votes > max ? row.votes : max; }, 0);
  const leaders = totals.filter(function (row) { return row.votes === top; });
  return { totals: totals, top: top, leaders: leaders };
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
  if (kind && kind.choice === 'candidate') {
    const ranked = candidateTotals(ballot, votesFor(store, ballot.id));
    ballot.status = 'closed';
    ballot.closedOnce = true;
    ballot.closedAtMs = nowMs;
    ballot.officeGranted = false;
    ballot.finalCandidateTotals = ranked.totals;
    if (ranked.leaders.length === 1 && ranked.top > 0) {
      ballot.result = 'plurality';
      ballot.failReason = null;
      ballot.winnerId = ranked.leaders[0].id;
      ballot.winnerName = ranked.leaders[0].name;
    } else if (ranked.top === 0) {
      ballot.result = 'unconfirmed';
      ballot.failReason = 'ZERO_VOTES';
      ballot.winnerId = null;
      ballot.winnerName = null;
    } else {
      ballot.result = 'unconfirmed';
      ballot.failReason = 'TIE';
      ballot.winnerId = null;
      ballot.winnerName = null;
    }
    ballot.nextProcedure = null;
    ballot.citizenVoteOpened = false;
    return { ok: true, alreadyClosed: false, ballot: ballot, publicView: publicView(store, ballot.id, nowMs) };
  }
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
  if (ballot.voteKind === 'leader_election_48h') {
    const cast = votesFor(store, ballot.id).length;
    const eligible = ballot.eligibleRepresentativeIds.length;
    // 운영 산식은 확정하지 않는다. 개발 화면만 소수점 첫째 자리와 표 수/명부 수를 보여 준다.
    const turnoutText = !eligible ? '—' : (cast === 0 ? '0%' : (Math.round((cast * 1000) / eligible) / 10).toFixed(1) + '%');
    const view = {
      id: ballot.id,
      voteKind: ballot.voteKind,
      country: ballot.country,
      territory: ballot.territory,
      status: ballot.status,
      startsAtMs: ballot.startsAtMs,
      endsAtMs: ballot.endsAtMs,
      remainingMs: ballot.status === 'open' ? Math.max(0, ballot.endsAtMs - Number(nowMs || 0)) : 0,
      turnoutPct: !eligible ? null : (cast === 0 ? 0 : Math.round((cast * 1000) / eligible) / 10),
      turnoutText: turnoutText,
      turnoutRatio: cast + '/' + eligible,
      castCount: cast,
      eligibleCount: eligible,
      candidates: (ballot.candidates || []).map(function (row) { return { id: row.id, name: row.name, approved: true }; }),
      simulation: true,
      authKind: 'test-fixture',
      productionAuth: false,
      officeGranted: false,
      turnoutDenominator: 'TURNOUT_ABSTAIN_UNCONFIRMED',
    };
    if (!ballot.closedOnce) {
      view.countsHidden = true;
      return view;
    }
    view.countsHidden = false;
    view.result = ballot.result;
    view.failReason = ballot.failReason;
    view.winnerId = ballot.winnerId;
    view.winnerName = ballot.winnerName;
    view.candidateTotals = ballot.finalCandidateTotals || [];
    return view;
  }
  const counts = ballot.closedOnce ? ballot.finalCounts : tally(votesFor(store, ballot.id));
  const eligible = ballot.eligibleRepresentativeIds.length;
  // TURNOUT_ABSTAIN_UNCONFIRMED: 정책은 기권을 찬반 분모에서 빼라고만 한다. 전체 투표율 분모는 새로 정하지 않는다.
  // 현재 화면 값은 (찬성 표 + 반대 표) / 서버 유권자 수 이다. 기권은 분자에 넣지 않는다.
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
    authKind: 'test-fixture',
    productionAuth: false,
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
