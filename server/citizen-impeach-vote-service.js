/**
 * 개발용 시민 탄핵투표 48시간.
 * 4차 A 대표 투표 저장소가 가결이고 발의가 대기일 때만 연다.
 * 운영 직위, 계급, 시즌은 바꾸지 않는다. 보궐선거는 열지 않는다.
 * dev 헤더는 운영 인증이 아니다. PostgreSQL 트랜잭션이 아니다.
 */
'use strict';

const fs = require('fs');
const legal = require('../shared/legal-gate-core');
const rank = require('../shared/dec023-rank-evaluation-core');
const vote = require('../shared/vote-engine-core');
const filing = require('./leader-filing-service');

const HOUR_MS = vote.HOUR_MS;
const DAY_MS = vote.DAY_MS;
const DURATION_MS = 48 * HOUR_MS;
const BLOCK_MS = 28 * DAY_MS;
const REP_KIND = 'representative_impeachment_24h';

const tails = new Map();

function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(function (resolve) { release = resolve; });
  tails.set(key, gate);
  return prev.then(function () {
    return Promise.resolve().then(fn).then(function (value) {
      release();
      return value;
    }, function (err) {
      release();
      throw err;
    });
  });
}

function emptyStore() {
  return { ballots: [], votes: [], blocks: [], removals: [] };
}

function readStore(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    ballots: Array.isArray(parsed.ballots) ? parsed.ballots : [],
    votes: Array.isArray(parsed.votes) ? parsed.votes : [],
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    removals: Array.isArray(parsed.removals) ? parsed.removals : [],
  };
}

function writeStore(filePath, store) {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  return store;
}

function usEligibilityError(country, eligibility) {
  if (country !== 'US') return null;
  const record = eligibility && typeof eligibility === 'object' ? eligibility : null;
  if (!record || record.source !== 'test-fixture') return 'US_AGE_UNVERIFIED';
  if (record.age != null || record.dob != null || record.birthDate != null) return 'US_AGE_UNVERIFIED';
  const row = record.legalRow;
  if (!row || typeof row !== 'object') return 'US_AGE_UNVERIFIED';
  if (row.age != null || row.dob != null || row.year != null) return 'US_AGE_UNVERIFIED';
  if (legal.isUsAgeConfirmed(row)) return null;
  if (row.activity_region === 'KR' && row.age_policy_version === legal.AGE_POLICY_VERSION && row.usParticipation === 'read-only') {
    return 'US_PARTICIPATION_READ_ONLY';
  }
  return 'US_AGE_UNVERIFIED';
}

function actorError(actor) {
  if (!actor) return 'AUTH_UNVERIFIED';
  if (actor.authSource === 'production' || actor.productionAuth === true) return 'PRODUCTION_AUTH_NOT_CONNECTED';
  if (actor.devAuth === true && actor.authSource !== 'test-fixture') return 'DEV_AUTH_NOT_PRODUCTION';
  if (actor.verified !== true || actor.authSource !== 'test-fixture') return 'AUTH_UNVERIFIED';
  if (actor.age != null || actor.dob != null || actor.birthDate != null) return 'AUTH_UNVERIFIED';
  return null;
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

function meetsTurnout(cast, eligible) {
  return eligible > 0 && cast * 5 >= eligible;
}

function fixedRoll(input) {
  const src = input || {};
  if (Array.isArray(src.voterIds) || Array.isArray(src.eligibleRepresentativeIds) || Array.isArray(src.eligibleIds) || src.eligibleCount != null || src.voterCount != null || src.count != null) {
    // 클라이언트가 보낸 명부와 인원수는 명부 계산에 쓰지 않는다.
  }
  if (!src.population || src.population.source !== 'test-fixture') {
    return { ok: false, reason: 'REAL_POPULATION_FORBIDDEN' };
  }
  const country = String(src.country || '');
  const territory = String(src.territory || '');
  const counted = rank.countValidPopulation({
    country: country,
    territory: territory,
    asOfMs: src.nowMs,
    records: src.population.records,
  });
  if (!counted.ok) return { ok: false, reason: counted.reason };
  const ids = [];
  const seen = Object.create(null);
  (src.population.records || []).forEach(function (rec) {
    if (!rec || rec.valid !== true) return;
    if (String(rec.country || '') !== country || String(rec.territory || '') !== territory) return;
    const id = String(rec.id || '').trim();
    if (!id || seen[id]) return;
    const post = rec.lastPostAtMs != null ? Number(rec.lastPostAtMs) : null;
    const comment = rec.lastCommentAtMs != null ? Number(rec.lastCommentAtMs) : null;
    const asOf = Number(src.nowMs);
    const recentPost = post != null && isFinite(post) && post <= asOf && asOf - post <= 30 * DAY_MS;
    const recentComment = comment != null && isFinite(comment) && comment <= asOf && asOf - comment <= 30 * DAY_MS;
    if (!recentPost && !recentComment) return;
    seen[id] = true;
    ids.push(id);
  });
  if (!ids.length || ids.length !== counted.count) return { ok: false, reason: 'ELIGIBLE_REQUIRED' };
  return { ok: true, ids: ids };
}

function repBallotFor(repStore, proposalId) {
  return (repStore && repStore.ballots || []).filter(function (row) {
    return row && row.voteKind === REP_KIND && String(row.subjectId || '') === proposalId;
  })[0] || null;
}

function openFromRepresentativeVote(store, input, repStore, filingStore) {
  const src = input || {};
  const proposalId = String(src.proposalId || '');
  if (!proposalId) return { ok: false, reason: 'PROPOSAL_ID_REQUIRED', productionAuth: false };
  const proposal = (filingStore && filingStore.impeachments || []).filter(function (row) { return row && row.id === proposalId; })[0];
  if (!proposal) return { ok: false, reason: 'PROPOSAL_NOT_STORED', productionAuth: false };
  const repBallot = repBallotFor(repStore, proposalId);
  if (!repBallot) return { ok: false, reason: 'REP_VOTE_NOT_STORED', productionAuth: false };
  if (repBallot.status === 'open') return { ok: false, reason: 'REP_VOTE_OPEN', productionAuth: false };
  if (repBallot.status === 'halted') return { ok: false, reason: 'REP_VOTE_HALTED', productionAuth: false };
  if (repBallot.status === 'error') return { ok: false, reason: 'REP_VOTE_ERROR', productionAuth: false };
  if (repBallot.status !== 'closed' || repBallot.result !== 'passed' || repBallot.closedOnce !== true) {
    return { ok: false, reason: 'REP_VOTE_NOT_PASSED', productionAuth: false };
  }
  if (proposal.status !== 'citizen_impeachment_waiting') return { ok: false, reason: 'PROPOSAL_NOT_READY', productionAuth: false };
  if (String(proposal.leaderId || '') !== String(repBallot.leaderId || '') || proposal.country !== repBallot.country || proposal.territory !== repBallot.territory) {
    return { ok: false, reason: 'PROPOSAL_MISMATCH', productionAuth: false };
  }
  if (proposal.country !== 'KR' && proposal.country !== 'US') return { ok: false, reason: 'COUNTRY_REQUIRED', productionAuth: false };
  if (proposal.territory !== 'pioneer' && proposal.territory !== 'guardian') {
    return { ok: false, reason: 'TERRITORY_NOT_ELIGIBLE', productionAuth: false };
  }
  const client = src.proposal && typeof src.proposal === 'object' ? src.proposal : null;
  if (client) {
    if ((client.id && String(client.id) !== proposal.id) || (client.leaderId && String(client.leaderId) !== String(proposal.leaderId)) || (client.country && client.country !== proposal.country) || (client.territory && client.territory !== proposal.territory) || (client.status && client.status !== proposal.status)) {
      return { ok: false, reason: 'PROPOSAL_MISMATCH', productionAuth: false };
    }
  }
  const existing = store.ballots.filter(function (row) { return row.proposalId === proposalId; })[0];
  if (existing) return { ok: false, reason: 'BALLOT_EXISTS', ballot: existing, productionAuth: false };
  const nowMs = Number(src.nowMs);
  if (!isFinite(nowMs)) return { ok: false, reason: 'CLOCK_REQUIRED', productionAuth: false };
  const roll = fixedRoll({
    country: proposal.country,
    territory: proposal.territory,
    nowMs: nowMs,
    population: src.population,
    voterIds: src.voterIds,
    eligibleRepresentativeIds: src.eligibleRepresentativeIds,
    eligibleIds: src.eligibleIds,
    eligibleCount: src.eligibleCount,
    voterCount: src.voterCount,
    count: src.count,
  });
  if (!roll.ok) return { ok: false, reason: roll.reason, productionAuth: false };
  const ballot = {
    id: 'citizen_impeachment_48h:' + proposal.country + ':' + proposal.territory + ':' + proposalId,
    proposalId: proposalId,
    repBallotId: repBallot.id,
    leaderId: String(proposal.leaderId),
    leaderName: String(proposal.leaderName || repBallot.leaderName || proposal.leaderId),
    reason: String(proposal.reason || ''),
    country: proposal.country,
    territory: proposal.territory,
    proposerId: String(proposal.actorId || ''),
    proposerName: String(proposal.actorName || ''),
    status: 'open',
    startsAtMs: nowMs,
    endsAtMs: nowMs + DURATION_MS,
    voterIds: roll.ids,
    officeChanged: false,
    rankChanged: false,
    seasonChanged: false,
    followUpElectionOpened: false,
    productionAuth: false,
    closedOnce: false,
    result: null,
    failReason: null,
  };
  store.ballots.push(ballot);
  return { ok: true, stored: true, ballot: ballot, productionAuth: false };
}

function castVoteUnlocked(store, input) {
  const src = input || {};
  const ballot = findBallot(store, src.ballotId);
  if (!ballot) return { ok: false, reason: 'BALLOT_NOT_FOUND', productionAuth: false };
  if (ballot.status === 'closed' || ballot.closedOnce) return { ok: false, reason: 'CLOSED', productionAuth: false };
  const actor = src.actor || {};
  const auth = actorError(actor);
  if (auth) return { ok: false, reason: auth, productionAuth: false };
  const age = usEligibilityError(ballot.country, src.eligibility);
  if (age) return { ok: false, reason: age, productionAuth: false };
  const nowMs = Number(src.nowMs);
  if (!isFinite(nowMs)) return { ok: false, reason: 'CLOCK_REQUIRED', productionAuth: false };
  if (nowMs < ballot.startsAtMs) return { ok: false, reason: 'NOT_STARTED', productionAuth: false };
  if (nowMs >= ballot.endsAtMs) return { ok: false, reason: 'CLOSED', productionAuth: false };
  if (actor.country !== ballot.country || actor.territory !== ballot.territory) return { ok: false, reason: 'CROSS_SCOPE', productionAuth: false };
  if (ballot.voterIds.indexOf(String(actor.id)) < 0) return { ok: false, reason: 'NOT_ELIGIBLE', productionAuth: false };
  const choice = String(src.choice || '');
  if (choice !== 'yes' && choice !== 'no') return { ok: false, reason: 'CHOICE_INVALID', productionAuth: false };
  const existing = votesFor(store, ballot.id).filter(function (row) { return row.voterId === String(actor.id); })[0];
  if (existing) return { ok: false, reason: 'DUPLICATE_VOTE', productionAuth: false };
  const row = { ballotId: ballot.id, voterId: String(actor.id), choice: choice, atMs: nowMs };
  store.votes.push(row);
  return { ok: true, stored: true, vote: row, publicView: publicView(store, ballot.id, nowMs), productionAuth: false };
}

function castVote(store, input) {
  const src = input || {};
  return withLock(String(src.ballotId || ''), function () {
    return castVoteUnlocked(store, src);
  });
}

function decide(ballot, votes) {
  const counts = tally(votes);
  const eligible = ballot.voterIds.length;
  if (!meetsTurnout(counts.cast, eligible)) return { result: 'failed', failReason: 'TURNOUT', counts: counts };
  if (counts.yes > counts.no) return { result: 'passed', failReason: null, counts: counts };
  if (counts.yes === counts.no) return { result: 'failed', failReason: 'TIE', counts: counts };
  return { result: 'failed', failReason: 'MINORITY', counts: counts };
}

function applyClose(store, ballot, nowMs) {
  const decision = decide(ballot, votesFor(store, ballot.id));
  ballot.status = 'closed';
  ballot.closedOnce = true;
  ballot.closedAtMs = nowMs;
  ballot.finalCounts = decision.counts;
  ballot.result = decision.result;
  ballot.failReason = decision.failReason;
  ballot.officeChanged = false;
  ballot.rankChanged = false;
  ballot.seasonChanged = false;
  ballot.followUpElectionOpened = false;
  ballot.productionAuth = false;
  if (decision.result === 'passed') {
    if (!store.removals.some(function (row) { return row.ballotId === ballot.id; })) {
      store.removals.push({
        id: 'dev-removal:' + ballot.id,
        ballotId: ballot.id,
        proposalId: ballot.proposalId,
        repBallotId: ballot.repBallotId,
        leaderId: ballot.leaderId,
        country: ballot.country,
        territory: ballot.territory,
        confirmed: true,
        devOnly: true,
        officeChanged: false,
        rankChanged: false,
        seasonChanged: false,
        followUpElectionOpened: false,
        schedule: filing.POST_IMPEACHMENT_SCHEDULE,
        closedAtMs: nowMs,
      });
    }
  } else if (!store.blocks.some(function (row) { return row.citizenBallotId === ballot.id; })) {
    store.blocks.push({
      citizenBallotId: ballot.id,
      proposalId: ballot.proposalId,
      leaderId: ballot.leaderId,
      country: ballot.country,
      territory: ballot.territory,
      blockedUntilMs: nowMs + BLOCK_MS,
      closedAtMs: nowMs,
    });
  }
}

function closeUnlocked(store, input) {
  const src = input || {};
  const ballot = findBallot(store, src.ballotId);
  if (!ballot) return { ok: false, reason: 'BALLOT_NOT_FOUND', productionAuth: false };
  const nowMs = Number(src.nowMs);
  if (!isFinite(nowMs)) return { ok: false, reason: 'CLOCK_REQUIRED', productionAuth: false };
  if (ballot.closedOnce) {
    return { ok: true, alreadyClosed: true, recounted: false, ballot: ballot, publicView: publicView(store, ballot.id, nowMs), productionAuth: false };
  }
  if (nowMs < ballot.endsAtMs) return { ok: false, reason: 'NOT_ENDED', productionAuth: false };
  applyClose(store, ballot, nowMs);
  return { ok: true, alreadyClosed: false, recounted: false, ballot: ballot, publicView: publicView(store, ballot.id, nowMs), productionAuth: false };
}

function ensureSideRecord(repStore, ballot) {
  if (!ballot || ballot.result !== 'failed') return false;
  if (!Array.isArray(repStore.blocks)) repStore.blocks = [];
  if (repStore.blocks.some(function (row) { return row.citizenBallotId === ballot.id; })) return false;
  const saved = ballot.closedAtMs;
  repStore.blocks.push({
    citizenBallotId: ballot.id,
    proposalId: ballot.proposalId,
    leaderId: ballot.leaderId,
    country: ballot.country,
    territory: ballot.territory,
    blockedUntilMs: Number(saved) + BLOCK_MS,
    closedAtMs: saved,
  });
  return true;
}

function closeAndPersist(citizenPath, repPath, input, options) {
  const src = input || {};
  const opts = options || {};
  return withLock(String(src.ballotId || ''), function () {
    const store = readStore(citizenPath);
    const before = findBallot(store, src.ballotId);
    const wasClosed = !!(before && before.closedOnce);
    const closed = closeUnlocked(store, src);
    if (!closed.ok) return closed;
    try {
      if (opts.failCitizenWrite === true && !wasClosed) throw new Error('VOTE_STORE_WRITE_FAILED');
      if (!wasClosed) writeStore(citizenPath, store);
    } catch (err) {
      return { ok: false, reason: 'VOTE_STORE_WRITE_FAILED', voteApplied: false, blockApplied: false, productionAuth: false };
    }
    if (closed.ballot.result === 'failed') {
      const repStore = readStore(repPath);
      const changed = ensureSideRecord(repStore, closed.ballot);
      try {
        if (opts.failBlockWrite === true && changed) throw new Error('BLOCK_STORE_WRITE_FAILED');
        if (changed) writeStore(repPath, repStore);
      } catch (err) {
        return { ok: false, reason: 'BLOCK_STORE_WRITE_FAILED', voteApplied: true, blockApplied: false, productionAuth: false };
      }
    }
    const fresh = readStore(citizenPath);
    return {
      ok: true,
      alreadyClosed: wasClosed,
      recounted: false,
      ballot: findBallot(fresh, closed.ballot.id),
      publicView: publicView(fresh, closed.ballot.id, src.nowMs),
      productionAuth: false,
    };
  });
}

function publicView(store, ballotId, nowMs) {
  const ballot = findBallot(store, ballotId);
  if (!ballot) return null;
  const cast = ballot.closedOnce && ballot.finalCounts ? ballot.finalCounts.cast : votesFor(store, ballot.id).length;
  const eligible = ballot.voterIds.length;
  const turnoutText = !eligible ? '—' : (cast === 0 ? '0%' : (Math.round((cast * 1000) / eligible) / 10).toFixed(1) + '%');
  const view = {
    id: ballot.id,
    proposalId: ballot.proposalId,
    repBallotId: ballot.repBallotId,
    leaderId: ballot.leaderId,
    leaderName: ballot.leaderName,
    reason: ballot.reason,
    country: ballot.country,
    territory: ballot.territory,
    proposerName: ballot.proposerName,
    status: ballot.status,
    startsAtMs: ballot.startsAtMs,
    endsAtMs: ballot.endsAtMs,
    remainingMs: ballot.status === 'open' ? Math.max(0, ballot.endsAtMs - Number(nowMs || 0)) : 0,
    turnoutText: turnoutText,
    turnoutRatio: cast + '/' + eligible,
    eligibleCount: eligible,
    turnoutDenominator: 'FIXED_VOTER_ROLL_20PCT',
    simulation: true,
    productionAuth: false,
    officeChanged: false,
    rankChanged: false,
    seasonChanged: false,
    followUpElectionOpened: false,
  };
  if (!ballot.closedOnce) {
    view.countsHidden = true;
    return view;
  }
  const counts = ballot.finalCounts || { yes: 0, no: 0, cast: 0 };
  view.countsHidden = false;
  view.yes = counts.yes;
  view.no = counts.no;
  view.result = ballot.result;
  view.failReason = ballot.failReason;
  view.removal = store.removals.filter(function (row) { return row.ballotId === ballot.id; })[0] || null;
  view.block = store.blocks.filter(function (row) { return row.citizenBallotId === ballot.id; })[0] || null;
  return view;
}

module.exports = {
  HOUR_MS: HOUR_MS,
  DAY_MS: DAY_MS,
  DURATION_MS: DURATION_MS,
  BLOCK_MS: BLOCK_MS,
  emptyStore: emptyStore,
  readStore: readStore,
  writeStore: writeStore,
  withLock: withLock,
  meetsTurnout: meetsTurnout,
  openFromRepresentativeVote: openFromRepresentativeVote,
  castVote: castVote,
  castVoteUnlocked: castVoteUnlocked,
  closeUnlocked: closeUnlocked,
  closeAndPersist: closeAndPersist,
  publicView: publicView,
};
