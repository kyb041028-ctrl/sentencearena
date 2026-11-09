/**
 * 대표 탄핵투표 24시간.
 * 3차 발의 접수(received, representative_vote_24h)에서만 연다.
 * 개발 헤더와 devAuth는 운영 인증이 아니다.
 */
'use strict';

const fs = require('fs');
const core = require('../shared/vote-engine-core');

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

function readStore(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return core.emptyStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    ballots: Array.isArray(parsed.ballots) ? parsed.ballots : [],
    votes: Array.isArray(parsed.votes) ? parsed.votes : [],
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
  };
}

function writeStore(filePath, store) {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  return store;
}

function openFromProposal(store, input) {
  const src = input || {};
  const proposal = src.proposal || {};
  if (proposal.status !== 'received' || proposal.nextStep !== 'representative_vote_24h') {
    return { ok: false, reason: 'PROPOSAL_NOT_READY' };
  }
  return core.openBallot(store, {
    voteKind: 'representative_impeachment_24h',
    country: proposal.country,
    territory: proposal.territory,
    subjectId: proposal.id,
    leaderId: proposal.leaderId,
    leaderName: proposal.leaderName,
    proposerId: proposal.actorId,
    proposerName: proposal.actorName,
    startsAtMs: src.startsAtMs,
    eligibleRepresentativeIds: src.eligibleRepresentativeIds,
  });
}

function castVote(store, input) {
  const ballotId = input && input.ballotId;
  return withLock(String(ballotId || ''), function () {
    return core.castVote(store, input);
  });
}

function closeBallot(store, input) {
  const ballotId = input && input.ballotId;
  return withLock(String(ballotId || ''), function () {
    return core.closeBallot(store, input);
  });
}

module.exports = {
  core: core,
  withLock: withLock,
  readStore: readStore,
  writeStore: writeStore,
  openFromProposal: openFromProposal,
  castVote: castVote,
  closeBallot: closeBallot,
  publicView: core.publicView,
  haltBallot: core.haltBallot,
  markBallotError: core.markBallotError,
};
