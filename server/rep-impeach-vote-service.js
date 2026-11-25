/**
 * 대표 탄핵투표 24시간.
 * 3차 발의 접수(received, representative_vote_24h)에서만 연다.
 * 개발 헤더와 devAuth는 운영 인증이 아니다.
 */
'use strict';

const fs = require('fs');
const core = require('../shared/vote-engine-core');
const roster = require('./rep-impeach-vote-roster');
const filing = require('./leader-filing-service');

const tails = new Map();

// 이 잠금은 현재 프로세스 안에서만 요청을 한 줄로 세운다.
// PostgreSQL 트랜잭션이 아니다. 격리 DB 동시성 검증은 하지 않았고 SQL은 적용하지 않는다.
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

function openFromProposal(store, input, filingStore) {
  const src = input || {};
  const proposalId = String(src.proposalId || '');
  if (!proposalId) return { ok: false, reason: 'PROPOSAL_ID_REQUIRED' };
  const filing = filingStore || null;
  const rows = filing && Array.isArray(filing.impeachments) ? filing.impeachments : null;
  if (!rows) return { ok: false, reason: 'PROPOSAL_NOT_STORED' };
  const row = rows.filter(function (item) { return item && item.id === proposalId; })[0];
  if (!row) return { ok: false, reason: 'PROPOSAL_NOT_STORED' };
  const client = src.proposal && typeof src.proposal === 'object' ? src.proposal : null;
  if (client) {
    if ((client.id && String(client.id) !== row.id) || (client.status && client.status !== row.status) || (client.nextStep && client.nextStep !== row.nextStep) || (client.country && client.country !== row.country) || (client.territory && client.territory !== row.territory) || (client.leaderId && String(client.leaderId) !== String(row.leaderId))) {
      return { ok: false, reason: 'PROPOSAL_MISMATCH' };
    }
  }
  if (row.status !== 'received' || row.nextStep !== 'representative_vote_24h') {
    return { ok: false, reason: 'PROPOSAL_NOT_READY' };
  }
  if (row.territory !== 'pioneer' && row.territory !== 'guardian') {
    return { ok: false, reason: 'TERRITORY_NOT_ELIGIBLE' };
  }
  const names = roster.representatives({ country: row.country, territory: row.territory, authKind: 'test-fixture' });
  if (!names.ok) return { ok: false, reason: names.reason, productionAuth: false };
  return core.openBallot(store, {
    voteKind: 'representative_impeachment_24h',
    country: row.country,
    territory: row.territory,
    subjectId: row.id,
    leaderId: row.leaderId,
    leaderName: row.leaderName,
    proposerId: row.actorId,
    proposerName: row.actorName,
    startsAtMs: src.startsAtMs,
    eligibleRepresentativeIds: names.ids,
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

function closeWithFiling(votePath, filingPath, input, options) {
  const src = input || {};
  const ballotId = src.ballotId;
  return withLock(String(ballotId || ''), function () {
    const voteStore = readStore(votePath);
    const filingStore = filing.readStore(filingPath);
    const closed = core.closeBallot(voteStore, src);
    if (!closed.ok) {
      return { ok: false, reason: closed.reason, voteApplied: false, filingApplied: false, productionAuth: false };
    }
    const applied = filing.recordRepresentativeVoteOutcome(filingStore, closed.ballot);
    if (!applied.ok) {
      return { ok: false, reason: applied.reason, voteApplied: false, filingApplied: false, productionAuth: false };
    }
    const voteDirty = closed.alreadyClosed !== true;
    const filingDirty = applied.alreadyApplied !== true;
    try {
      if (voteDirty) writeStore(votePath, voteStore);
    } catch (err) {
      return { ok: false, reason: 'VOTE_STORE_WRITE_FAILED', voteApplied: false, filingApplied: false, productionAuth: false };
    }
    try {
      if (options && options.failFilingWrite === true && filingDirty) {
        throw new Error('FILING_STORE_WRITE_FAILED');
      }
      if (filingDirty) filing.writeStore(filingPath, filingStore);
    } catch (err) {
      return { ok: false, reason: 'FILING_STORE_WRITE_FAILED', voteApplied: true, filingApplied: false, productionAuth: false };
    }
    const view = core.publicView(voteStore, closed.ballot.id, src.nowMs);
    if (!view || view.productionAuth !== false) {
      return { ok: false, reason: 'PRODUCTION_AUTH_NOT_CONNECTED', voteApplied: voteDirty, filingApplied: filingDirty, productionAuth: false };
    }
    return {
      ok: true,
      alreadyClosed: closed.alreadyClosed === true && applied.alreadyApplied === true,
      voteApplied: true,
      filingApplied: true,
      ballot: closed.ballot,
      publicView: view,
      productionAuth: false,
    };
  });
}

module.exports = {
  core: core,
  withLock: withLock,
  readStore: readStore,
  writeStore: writeStore,
  openFromProposal: openFromProposal,
  roster: roster,
  castVote: castVote,
  closeBallot: closeBallot,
  closeWithFiling: closeWithFiling,
  publicView: core.publicView,
  haltBallot: core.haltBallot,
  markBallotError: core.markBallotError,
};
