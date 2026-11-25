'use strict';
/**
 * 대표 탄핵투표 24시간. 운영 DB를 열지 않는다.
 * node tools/test-rep-impeach-vote.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const service = require('../server/rep-impeach-vote-service');
const core = require('../shared/vote-engine-core');
const filing = require('../server/leader-filing-service');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) {
    console.log('PASS: ' + label);
    pass += 1;
  } else {
    console.log('FAIL: ' + label);
    fail += 1;
  }
}

function rep(id, country, territory) {
  return { id: id, country: country || 'KR', territory: territory || 'pioneer', office: 'representative', verified: true, authSource: 'test-fixture' };
}

function proposal(country, territory, id) {
  return {
    id: id || ('imp-' + country + '-' + territory),
    status: 'received',
    nextStep: 'representative_vote_24h',
    country: country,
    territory: territory,
    leaderId: 'leader-' + country + '-' + territory,
    leaderName: country === 'US' ? 'Avery' : '가온',
    actorId: 'proposer-' + country,
    actorName: country === 'US' ? 'Morgan' : '한결',
  };
}

const start = 1_700_000_000_000;
const day = core.DAY_MS;
const ids = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'];

function filingBox(country, territory, id) {
  const box = filing.emptyStore();
  box.impeachments.push(proposal(country, territory, id));
  return box;
}

function openKr(store, id) {
  const box = filingBox('KR', 'pioneer', id);
  return service.openFromProposal(store, {
    proposalId: box.impeachments[0].id,
    startsAtMs: start,
    eligibleRepresentativeIds: ['client-must-not-count'],
  }, box);
}

(async function () {
  const normal = core.emptyStore();
  const opened = openKr(normal, 'normal');
  const cast = await service.castVote(normal, { ballotId: opened.ballot.id, actor: rep('r1'), choice: 'yes', nowMs: start + 1000 });
  ok('현직 대표 정상 투표', cast.ok === true && cast.vote.choice === 'yes');

  const citizen = core.emptyStore();
  const citizenBallot = openKr(citizen, 'citizen');
  const denied = await service.castVote(citizen, {
    ballotId: citizenBallot.ballot.id,
    actor: { id: 'c1', country: 'KR', territory: 'pioneer', office: 'citizen', verified: true, authSource: 'test-fixture' },
    choice: 'yes',
    nowMs: start + 1000,
  });
  ok('시민 거부', denied.ok === false && denied.reason === 'NOT_REPRESENTATIVE');

  const cross = core.emptyStore();
  const crossBallot = openKr(cross, 'cross');
  const other = await service.castVote(cross, { ballotId: crossBallot.ballot.id, actor: rep('r1', 'US', 'guardian'), choice: 'yes', nowMs: start + 1000 });
  ok('다른 국가·영토 대표 거부', other.ok === false && other.reason === 'CROSS_SCOPE');

  const dupStore = core.emptyStore();
  const dupBallot = openKr(dupStore, 'dup');
  await service.castVote(dupStore, { ballotId: dupBallot.ballot.id, actor: rep('r1'), choice: 'yes', nowMs: start + 1000 });
  const dup = await service.castVote(dupStore, { ballotId: dupBallot.ballot.id, actor: rep('r1'), choice: 'no', nowMs: start + 1001 });
  ok('중복투표 차단', dup.ok === false && dup.reason === 'DUPLICATE_VOTE' && dupStore.votes.length === 1);

  const race = core.emptyStore();
  const raceBallot = openKr(race, 'race');
  const pair = await Promise.all([
    service.castVote(race, { ballotId: raceBallot.ballot.id, actor: rep('r1'), choice: 'yes', nowMs: start + 1000 }),
    service.castVote(race, { ballotId: raceBallot.ballot.id, actor: rep('r1'), choice: 'no', nowMs: start + 1000 }),
  ]);
  const raceOk = pair.filter(function (row) { return row.ok; }).length;
  ok('동시 제출 차단', raceOk === 1 && pair.some(function (row) { return row.reason === 'DUPLICATE_VOTE'; }) && race.votes.length === 1);

  const early = core.emptyStore();
  const earlyBallot = openKr(early, 'early');
  const before = await service.castVote(early, { ballotId: earlyBallot.ballot.id, actor: rep('r1'), choice: 'yes', nowMs: start - 1 });
  ok('시작 전 거부', before.ok === false && before.reason === 'NOT_STARTED');

  const late = core.emptyStore();
  const lateBallot = openKr(late, 'late');
  const after = await service.castVote(late, { ballotId: lateBallot.ballot.id, actor: rep('r1'), choice: 'yes', nowMs: start + day });
  ok('마감 후 거부', after.ok === false && after.reason === 'CLOSED');

  const expire = core.emptyStore();
  const expireBallot = openKr(expire, 'expire');
  const inside = await service.castVote(expire, { ballotId: expireBallot.ballot.id, actor: rep('r1'), choice: 'yes', nowMs: start + day - 1 });
  const onEnd = await service.castVote(expire, { ballotId: expireBallot.ballot.id, actor: rep('r2'), choice: 'yes', nowMs: start + day });
  const closed = await service.closeBallot(expire, { ballotId: expireBallot.ballot.id, nowMs: start + day });
  ok('24시간 만료', inside.ok === true && onEnd.reason === 'CLOSED' && expireBallot.ballot.endsAtMs - expireBallot.ballot.startsAtMs === day && closed.ok === true);

  const four = core.emptyStore();
  const fourBallot = openKr(four, 'four');
  for (let i = 0; i < 4; i += 1) {
    await service.castVote(four, { ballotId: fourBallot.ballot.id, actor: rep(ids[i]), choice: 'yes', nowMs: start + 1000 });
  }
  const fourClose = await service.closeBallot(four, { ballotId: fourBallot.ballot.id, nowMs: start + day });
  ok('4명 부결', fourClose.ballot.result === 'failed' && fourClose.ballot.failReason === 'QUORUM');

  const five = core.emptyStore();
  const fiveBallot = openKr(five, 'five');
  const fiveChoices = ['yes', 'yes', 'yes', 'no', 'no'];
  for (let i = 0; i < 5; i += 1) {
    await service.castVote(five, { ballotId: fiveBallot.ballot.id, actor: rep(ids[i]), choice: fiveChoices[i], nowMs: start + 1000 });
  }
  const fiveClose = await service.closeBallot(five, { ballotId: fiveBallot.ballot.id, nowMs: start + day });
  ok('5명 과반', fiveClose.ballot.result === 'passed' && fiveClose.ballot.finalCounts.yes === 3 && fiveClose.ballot.finalCounts.no === 2);

  const tie = core.emptyStore();
  const tieBallot = openKr(tie, 'tie');
  for (let i = 0; i < 6; i += 1) {
    await service.castVote(tie, { ballotId: tieBallot.ballot.id, actor: rep(ids[i]), choice: i < 3 ? 'yes' : 'no', nowMs: start + 1000 });
  }
  const tieClose = await service.closeBallot(tie, { ballotId: tieBallot.ballot.id, nowMs: start + day });
  ok('동률 부결', tieClose.ballot.result === 'failed' && tieClose.ballot.failReason === 'TIE');

  const skip = core.emptyStore();
  const skipBallot = openKr(skip, 'skip');
  const skipChoices = ['yes', 'yes', 'yes', 'no', 'no', 'abstain', 'abstain'];
  for (let i = 0; i < skipChoices.length; i += 1) {
    await service.castVote(skip, { ballotId: skipBallot.ballot.id, actor: rep(ids[i]), choice: skipChoices[i], nowMs: start + 1000 });
  }
  const skipClose = await service.closeBallot(skip, { ballotId: skipBallot.ballot.id, nowMs: start + day });
  ok('기권·미응답 제외', skipClose.ballot.result === 'passed' && skipClose.ballot.finalCounts.cast === 5 && skipClose.ballot.finalCounts.yes === 3);

  const waiting = core.emptyStore();
  const waitingBallot = openKr(waiting, 'waiting');
  for (let i = 0; i < 5; i += 1) {
    await service.castVote(waiting, { ballotId: waitingBallot.ballot.id, actor: rep(ids[i]), choice: 'yes', nowMs: start + 1000 });
  }
  const waitingClose = await service.closeBallot(waiting, { ballotId: waitingBallot.ballot.id, nowMs: start + day });
  const again = await service.closeBallot(waiting, { ballotId: waitingBallot.ballot.id, nowMs: start + day + 10 });
  ok('가결 후 시민투표 대기', waitingClose.ballot.nextProcedure === 'citizen_impeachment_waiting' && waitingClose.ballot.citizenVoteOpened === false && again.alreadyClosed === true && again.ballot.result === 'passed');

  const blocked = core.emptyStore();
  const blockedBallot = openKr(blocked, 'blocked');
  for (let i = 0; i < 5; i += 1) {
    await service.castVote(blocked, { ballotId: blockedBallot.ballot.id, actor: rep(ids[i]), choice: 'no', nowMs: start + 1000 });
  }
  const blockedClose = await service.closeBallot(blocked, { ballotId: blockedBallot.ballot.id, nowMs: start + day });
  const block = blocked.blocks[0];
  ok('부결 후 28일 제한', blockedClose.ballot.result === 'failed' && block && block.blockedUntilMs - (start + day) === 28 * day && block.leaderId === blockedBallot.ballot.leaderId);

  const secret = core.emptyStore();
  const secretBallot = openKr(secret, 'secret');
  const secretCast = await service.castVote(secret, { ballotId: secretBallot.ballot.id, actor: rep('r1'), choice: 'yes', nowMs: start + 1000 });
  const hidden = secretCast.publicView;
  ok('진행 중 찬반 비공개', hidden.countsHidden === true && hidden.yes == null && hidden.no == null && hidden.turnoutPct === 12 && JSON.stringify(hidden).indexOf('"yes"') < 0);

  const isolated = core.emptyStore();
  const krBox = filingBox('KR', 'pioneer', 'kr');
  const usBox = filingBox('US', 'guardian', 'us');
  service.openFromProposal(isolated, { proposalId: 'kr', startsAtMs: start, eligibleRepresentativeIds: ['u1'] }, krBox);
  const usOpen = service.openFromProposal(isolated, { proposalId: 'us', startsAtMs: start, eligibleRepresentativeIds: ['r1'] }, usBox);
  await service.castVote(isolated, { ballotId: usOpen.ballot.id, actor: rep('u1', 'US', 'guardian'), choice: 'yes', nowMs: start + 1000 });
  const krView = service.publicView(isolated, 'representative_impeachment_24h:KR:pioneer:kr', start + 1000);
  const usView = service.publicView(isolated, usOpen.ballot.id, start + 1000);
  const centralBox = filingBox('KR', 'central', 'central');
  const central = service.openFromProposal(isolated, { proposalId: 'central', startsAtMs: start, eligibleRepresentativeIds: ids }, centralBox);
  ok('한미 격리', krView.turnoutPct === 0 && usView.turnoutPct === 12 && krView.country === 'KR' && usView.country === 'US' && usOpen.ballot.eligibleRepresentativeIds.indexOf('r1') < 0 && central.reason === 'TERRITORY_NOT_ELIGIBLE');

  const agedStore = core.emptyStore();
  const agedBallot = openKr(agedStore, 'aged');
  const aged = await service.castVote(agedStore, {
    ballotId: agedBallot.ballot.id,
    actor: { id: 'r1', country: 'KR', territory: 'pioneer', office: 'representative', verified: true, authSource: 'test-fixture', age: 40 },
    choice: 'yes',
    nowMs: start + 1000,
  });
  ok('브라우저 나이는 통과시키지 않음', aged.reason === 'AUTH_UNVERIFIED');

  const reload = core.emptyStore();
  const reloadBallot = openKr(reload, 'reload');
  const reloadCast = await service.castVote(reload, { ballotId: reloadBallot.ballot.id, actor: rep('r1'), choice: 'yes', nowMs: start + 1000 });
  const reloaded = service.publicView(reload, reloadBallot.ballot.id, start + 1000);
  ok('버튼 제출 후 재조회', reloadCast.ok === true && reloaded.countsHidden === true && reloaded.turnoutPct === 12 && reloaded.yes == null && reloaded.productionAuth === false);

  const missing = service.openFromProposal(core.emptyStore(), { proposal: proposal('KR', 'pioneer', 'ghost'), eligibleRepresentativeIds: ids }, filing.emptyStore());
  ok('발의 ID 없으면 투표 생성 거부', missing.ok === false && missing.reason === 'PROPOSAL_ID_REQUIRED');

  const ignored = core.emptyStore();
  const ignoredBallot = openKr(ignored, 'ignored');
  const stranger = await service.castVote(ignored, { ballotId: ignoredBallot.ballot.id, actor: rep('client-must-not-count'), choice: 'yes', nowMs: start + 1000 });
  ok('클라이언트 명단 무시', stranger.reason === 'NOT_ELIGIBLE' && ignoredBallot.ballot.eligibleRepresentativeIds.join(',') === ids.join(','));

  const crossFiling = filingBox('KR', 'pioneer', 'cross-block');
  const crossVote = core.emptyStore();
  const crossOpen = service.openFromProposal(crossVote, { proposalId: 'cross-block', startsAtMs: start }, crossFiling);
  for (let i = 0; i < 5; i += 1) {
    await service.castVote(crossVote, { ballotId: crossOpen.ballot.id, actor: rep(ids[i]), choice: 'no', nowMs: start + 1000 });
  }
  const crossClose = await service.closeBallot(crossVote, { ballotId: crossOpen.ballot.id, nowMs: start + day });
  const applied = filing.recordRepresentativeVoteOutcome(crossFiling, crossClose.ballot);
  const appliedAgain = filing.recordRepresentativeVoteOutcome(crossFiling, crossClose.ballot);
  const againClose = await service.closeBallot(crossVote, { ballotId: crossOpen.ballot.id, nowMs: start + day + 5 });
  const repropose = filing.proposeImpeachment(filing.emptyStore(), {
    actor: { id: 'r9', name: '새발의', country: 'KR', territory: 'pioneer', office: 'representative', devAuth: true },
    country: 'KR',
    territory: 'pioneer',
    leader: { id: crossOpen.ballot.leaderId, name: '가온', country: 'KR', territory: 'pioneer' },
    reason: '다시 발의',
    nowMs: start + day + 10,
    voteBlocks: crossVote.blocks,
  });
  ok('부결 후 3차 A 재발의 거부', crossClose.ballot.result === 'failed' && applied.proposal.status === 'failed' && appliedAgain.alreadyApplied === true && againClose.alreadyClosed === true && crossVote.blocks.length === 1 && repropose.reason === 'REPROPOSAL_BLOCKED_28D' && repropose.stored === false);

  const devAuth = await service.castVote(ignored, {
    ballotId: ignoredBallot.ballot.id,
    actor: { id: 'r1', devAuth: true, office: 'representative', country: 'KR', territory: 'pioneer' },
    choice: 'yes',
    nowMs: start + 1000,
  });
  ok('개발 헤더 인증은 운영 통과가 아님', devAuth.reason === 'DEV_AUTH_NOT_PRODUCTION');

  const recoverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-vote-close-'));
  const recoverVote = path.join(recoverDir, 'vote.json');
  const recoverFiling = path.join(recoverDir, 'filing.json');
  const recoverBox = filingBox('KR', 'pioneer', 'recover');
  const recoverMemory = core.emptyStore();
  const recoverOpen = service.openFromProposal(recoverMemory, { proposalId: 'recover', startsAtMs: start }, recoverBox);
  for (let i = 0; i < 5; i += 1) {
    await service.castVote(recoverMemory, { ballotId: recoverOpen.ballot.id, actor: rep(ids[i]), choice: 'no', nowMs: start + 1000 });
  }
  service.writeStore(recoverVote, recoverMemory);
  filing.writeStore(recoverFiling, recoverBox);
  const partial = await service.closeWithFiling(recoverVote, recoverFiling, { ballotId: recoverOpen.ballot.id, nowMs: start + day }, { failFilingWrite: true });
  const partialVote = service.readStore(recoverVote);
  const partialFiling = filing.readStore(recoverFiling);
  const recovered = await service.closeWithFiling(recoverVote, recoverFiling, { ballotId: recoverOpen.ballot.id, nowMs: start + day });
  const recoveredVote = service.readStore(recoverVote);
  const recoveredFiling = filing.readStore(recoverFiling);
  const recoveredAgain = await service.closeWithFiling(recoverVote, recoverFiling, { ballotId: recoverOpen.ballot.id, nowMs: start + day + 5 });
  const againVote = service.readStore(recoverVote);
  ok('마감 한쪽 실패 후 재시도 복구', partial.ok === false && partial.reason === 'FILING_STORE_WRITE_FAILED' && partial.voteApplied === true && partial.filingApplied === false && partial.productionAuth === false && partialVote.ballots[0].closedOnce === true && partialFiling.impeachments[0].status === 'received' && recovered.ok === true && recovered.filingApplied === true && recoveredFiling.impeachments[0].status === 'failed' && recoveredFiling.impeachments[0].voteClosedOnce === true && recoveredVote.blocks.length === 1 && againVote.blocks.length === 1 && recoveredAgain.alreadyClosed === true);

  const missingFilingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-vote-close-miss-'));
  const missingVote = path.join(missingFilingDir, 'vote.json');
  const missingFilingPath = path.join(missingFilingDir, 'filing.json');
  const missingMemory = core.emptyStore();
  const missingBox = filingBox('KR', 'pioneer', 'missing-close');
  const missingOpen = service.openFromProposal(missingMemory, { proposalId: 'missing-close', startsAtMs: start }, missingBox);
  await service.castVote(missingMemory, { ballotId: missingOpen.ballot.id, actor: rep('r1'), choice: 'yes', nowMs: start + 1000 });
  service.writeStore(missingVote, missingMemory);
  filing.writeStore(missingFilingPath, filing.emptyStore());
  const missingClose = await service.closeWithFiling(missingVote, missingFilingPath, { ballotId: missingOpen.ballot.id, nowMs: start + day });
  const missingVoteAfter = service.readStore(missingVote);
  ok('발의 반영 실패는 숨기지 않음', missingClose.ok === false && missingClose.reason === 'PROPOSAL_NOT_STORED' && missingClose.voteApplied === false && missingVoteAfter.ballots[0].status === 'open' && missingVoteAfter.blocks.length === 0);

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
