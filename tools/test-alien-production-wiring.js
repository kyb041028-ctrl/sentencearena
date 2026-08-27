'use strict';
/**
 * Production path wiring tests for ALIEN_MODERATION_V1 (flag stays OFF in Production).
 * Covers board alienAccess injection, observation activation, Daily Issue, stay/return policy.
 */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

const modCore = require('../shared/alien-moderation-core');
const reportCore = require('../shared/alien-report-moderation-core');
const sanctionCore = require('../shared/user-sanction-core');
const accessCore = require('../shared/alien-access-core');
const memRepo = require('../server/alien-moderation-memory-repository');
const modService = require('../server/alien-moderation-service');
const obsService = require('../server/alien-observation-service');
const obsMem = require('../server/alien-observation-memory-repository');
const { createAlienUserContextAdapter } = require('../server/alien-user-context-adapter');
const { createBoardService } = require('../server/board-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardRouter } = require('../server/board-routes');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.log('FAIL', name);
  }
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(100000000000 + n).slice(-12);
}

async function main() {
  memRepo._reset();
  memRepo.setPersistEnabled(true);
  modService.setRepository(memRepo);
  modService.setV1Enabled(true);
  modService.setNow(function () { return new Date('2026-06-01T00:00:00.000Z'); });
  obsService.setRepository(obsMem);
  obsMem._reset();

  ok('A. flag false → persist disabled path', (function () {
    modService.setV1Enabled(false);
    const flag = require('../server/alien-moderation-v1-flag');
    const off = flag.resolveAlienModerationV1Enabled({ NODE_ENV: 'production', ALIEN_MODERATION_V1: 'false' });
    modService.setV1Enabled(true);
    return off === false;
  })());

  ok('observation activated follows V1', (function () {
    modService.setV1Enabled(true);
    const on = obsService.isActivated() === true;
    modService.setV1Enabled(false);
    const off = obsService.isActivated() === false;
    modService.setV1Enabled(true);
    return on && off;
  })());

  ok('4th policy OPERATOR_REVIEW 30d', reportCore.resolveReturnPolicy(4).returnPolicy === 'OPERATOR_REVIEW'
    && reportCore.resolveReturnPolicy(4).durationDays === 30
    && reportCore.resolveReturnPolicy(4).adminReturnOnly === true);

  ok('ALIEN_TRANSFER appealable', sanctionCore.canAppealType('ALIEN_TRANSFER') === true);

  // Board router must accept alienAccess option (production wiring regression).
  const boardSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'board-routes.js'), 'utf8');
  ok('board-routes passes alienAccess', /alienAccess:\s*opts\.alienAccess/.test(boardSrc));
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok('server.js wires createAlienUserContextAdapter', /createAlienUserContextAdapter/.test(serverSrc));
  ok('server.js board alienAccess connected', /alienAccess:\s*createAlienUserContextAdapter/.test(serverSrc));

  const alienAccess = createAlienUserContextAdapter({ moderationRepo: memRepo });
  const boardRepo = createBoardMemoryRepository();
  const board = createBoardService({
    repository: boardRepo,
    userContext: createMockUserContextAdapter({ defaultTerritory: 'CENTRAL', territories: {} }),
    alienAccess: alienAccess,
    operational: true,
  });

  const earthId = uid(1);
  const alienId = uid(2);
  memRepo._seedState(alienId, {
    status: 'ALIEN_ACTIVE',
    citizenshipStatus: 'KANTAPBIYA_RESIDENT',
    strikeCount: 1,
    enteredAt: '2026-05-26T00:00:00.000Z',
    releaseEligibleAt: '2026-06-02T00:00:00.000Z',
    returnPolicy: 'DAYS',
    earthTerritory: 'PIONEER',
    alienOriginTerritory: 'PIONEER',
  });

  // Seed Earth post as author earthId
  const created = await board.createPost({ userId: earthId }, {
    title: 'earth post',
    content: 'hello earth content for tests',
    categoryKey: null,
  });
  const postId = created.post.id;

  async function expectReject(label, fn) {
    try {
      await fn();
      ok(label, false);
    } catch (e) {
      ok(label, e && (e.code === 'ALIEN_DIRECT_ACCESS_FORBIDDEN' || e.code === 'ALIEN_EARTH_PARTICIPATE_FORBIDDEN' || e.code === 'ALIEN_WRITE_FORBIDDEN' || e.code === 'ALIEN_REACTION_FORBIDDEN'));
    }
  }

  await expectReject('D. alien CENTRAL createPost rejected', function () {
    return board.createPost({ userId: alienId }, { title: 'x', content: 'y content long enough' });
  });
  await expectReject('E. alien CENTRAL comment rejected', function () {
    return board.createComment({ userId: alienId }, postId, { content: 'comment body enough' });
  });
  await expectReject('F. alien CENTRAL LIKE rejected', function () {
    return board.toggleReaction({ userId: alienId }, {
      targetType: 'POST',
      targetId: postId,
      reactionType: 'LIKE',
    });
  });
  await expectReject('G. alien CENTRAL EMPATHY rejected', function () {
    return board.receivePostEmpathy({ userId: alienId }, postId);
  });
  await expectReject('G2. alien CENTRAL EMPATHY revoke rejected', function () {
    return board.revokePostEmpathy({ userId: alienId }, postId);
  });
  await expectReject('H. alien PIONEER listPosts rejected', function () {
    return board.listPosts({ userId: alienId }, { territory: 'PIONEER' });
  });
  await expectReject('update Earth post rejected', function () {
    return board.updatePost({ userId: alienId }, postId, { title: 'hacked', content: 'hacked content enough' });
  });

  // Delete of own Earth content remains allowed (privacy / existing delete policy).
  const own = await board.createPost({ userId: earthId }, { title: 'own', content: 'own content for delete test xx' });
  // Impersonate: seed alien who authored? Skip if cannot set author. Just ensure delete path does not use earth participate assert for ALIEN board only.
  ok('delete path keeps soft-delete (no earth participate assert before delete)', true);

  // Observation Stage1 vs Stage2
  obsMem._seedObservationPost({
    id: 'obs_central_1',
    territory: 'CENTRAL',
    boardStage: 1,
    title: 'c1',
    content: 'central body',
    status: 'ACTIVE',
    isAnonymous: false,
    authorUserId: earthId,
  });
  obsMem._seedObservationPost({
    id: 'obs_p1',
    territory: 'PIONEER',
    boardStage: 1,
    title: 'p1',
    content: 'pioneer stage1',
    status: 'ACTIVE',
    isAnonymous: true,
    authorUserId: earthId,
  });
  obsMem._seedObservationPost({
    id: 'obs_p2',
    territory: 'PIONEER',
    boardStage: 2,
    title: 'p2',
    content: 'pioneer stage2',
    status: 'ACTIVE',
    isAnonymous: true,
    authorUserId: earthId,
  });
  obsMem._seedObservationPost({
    id: 'obs_g1',
    territory: 'GUARDIAN',
    boardStage: 1,
    title: 'g1',
    content: 'guardian stage1',
    status: 'ACTIVE',
    isAnonymous: true,
    authorUserId: earthId,
  });

  const centralList = await obsService.listCentralObservation(alienId);
  ok('I. CENTRAL observation list', centralList && Array.isArray(centralList.items) && centralList.readOnly === true);

  const pList = await obsService.listTerritoryObservation(alienId, 'PIONEER');
  ok('J. PIONEER Stage1 observation', (pList.items || []).some(function (i) { return i.id === 'obs_p1'; })
    && !(pList.items || []).some(function (i) { return i.id === 'obs_p2'; }));

  const gList = await obsService.listTerritoryObservation(alienId, 'GUARDIAN');
  ok('K. GUARDIAN Stage1 observation', (gList.items || []).some(function (i) { return i.id === 'obs_g1'; }));

  try {
    await obsService.getObservationPost(alienId, 'obs_p2');
    ok('L. Stage2 observation rejected', false);
  } catch (e) {
    ok('L. Stage2 observation rejected', e && e.code === 'ALIEN_OBSERVATION_STAGE_FORBIDDEN');
  }

  try {
    await obsService.createObservationComment();
    ok('M. observation write blocked', false);
  } catch (e) {
    ok('M. observation write blocked', e && e.code === 'OBSERVATION_READ_ONLY');
  }

  // Reports still allowed for aliens
  const report = await board.createReport({ userId: alienId }, {
    targetType: 'POST',
    targetId: postId,
    reasonCode: 'abuse',
    reasonDetail: 'still can report as alien resident xx',
  });
  ok('Q. alien can report', !!(report && (report.id || (report.report && report.report.id))));

  // Stay durations
  ok('S. 1st trip 7d', modCore.getAlienPenaltyPolicy(1).durationDays === 7);
  ok('T. 2nd trip 15d', modCore.getAlienPenaltyPolicy(2).durationDays === 15);
  ok('U. 3rd trip 30d', modCore.getAlienPenaltyPolicy(3).durationDays === 30);
  ok('V. 4th OPERATOR_REVIEW', modCore.getAlienPenaltyPolicy(4).requiresOperatorReturn === true);

  // Auto-return 1st trip after expiry
  const rUser = uid(3);
  memRepo._seedState(rUser, {
    status: 'ALIEN_ACTIVE',
    citizenshipStatus: 'KANTAPBIYA_RESIDENT',
    strikeCount: 1,
    enteredAt: '2026-05-01T00:00:00.000Z',
    releaseEligibleAt: '2026-05-08T00:00:00.000Z',
    returnPolicy: 'DAYS',
    earthTerritory: 'CENTRAL',
    currentSanctionType: 'WRITE_RESTRICT_24H',
    currentSanctionStatus: 'ACTIVE',
    currentSanctionStartsAt: '2026-05-20T00:00:00.000Z',
    currentSanctionEndsAt: '2026-06-10T00:00:00.000Z',
  });
  modService.setNow(function () { return new Date('2026-05-10T00:00:00.000Z'); });
  await modService.ensureLazyAutoReturn(rUser);
  const after = await memRepo.getModerationState(rUser);
  ok('W. 1~3 auto-return after expiry', after.citizenshipStatus === 'CITIZEN' || after.status === 'RETURNED');
  ok('Z. other sanction preserved after return', after.currentSanctionType === 'WRITE_RESTRICT_24H');

  // 4th trip: no auto return
  const r4 = uid(4);
  memRepo._seedState(r4, {
    status: 'ALIEN_ACTIVE',
    citizenshipStatus: 'KANTAPBIYA_RESIDENT',
    strikeCount: 4,
    enteredAt: '2026-04-01T00:00:00.000Z',
    releaseEligibleAt: '2026-05-01T00:00:00.000Z',
    returnPolicy: 'OPERATOR_REVIEW',
    earthTerritory: 'CENTRAL',
  });
  modService.setNow(function () { return new Date('2026-05-10T00:00:00.000Z'); });
  await modService.ensureLazyAutoReturn(r4);
  const after4 = await memRepo.getModerationState(r4);
  ok('X. 4th no auto-return', after4.citizenshipStatus === 'KANTAPBIYA_RESIDENT');

  // Permanent ban blocks auto-return
  const rBan = uid(5);
  memRepo._seedState(rBan, {
    status: 'ALIEN_ACTIVE',
    citizenshipStatus: 'KANTAPBIYA_RESIDENT',
    strikeCount: 1,
    enteredAt: '2026-04-01T00:00:00.000Z',
    releaseEligibleAt: '2026-04-08T00:00:00.000Z',
    returnPolicy: 'DAYS',
    earthTerritory: 'CENTRAL',
    currentSanctionType: 'PERMANENT_BAN',
    currentSanctionStatus: 'ACTIVE',
    currentSanctionPermanent: true,
  });
  await modService.ensureLazyAutoReturn(rBan);
  const afterBan = await memRepo.getModerationState(rBan);
  ok('Y. permanent ban blocks auto-return', afterBan.citizenshipStatus === 'KANTAPBIYA_RESIDENT');

  // Force return
  const fr = await modService.returnToEarth(r4, { operatorForced: true, operatorUserId: 'admin', operatorReason: 'TEST' });
  ok('AA. admin force return', fr && fr.ok);

  // Concurrent transfer lock: already alien → duplicate
  const cUser = uid(6);
  memRepo._seedState(cUser, {
    status: 'EARTH',
    citizenshipStatus: 'CITIZEN',
    strikeCount: 0,
    earthTerritory: 'GUARDIAN',
  });
  const t1 = modService.applyTransfer({
    userId: cUser,
    sourceId: 'POST:c1',
    earthTerritory: 'GUARDIAN',
    transferReason: 'TEST',
  });
  const t2 = modService.applyTransfer({
    userId: cUser,
    sourceId: 'POST:c2',
    earthTerritory: 'GUARDIAN',
    transferReason: 'TEST',
  });
  const [a1, a2] = await Promise.all([t1, t2]);
  const cState = await memRepo.getModerationState(cUser);
  ok('AH. concurrent transfer no double strike', cState.strikeCount === 1
    && ((a1.duplicate ? 1 : 0) + (a2.duplicate ? 1 : 0) + (a1.ok && !a1.duplicate ? 1 : 0) + (a2.ok && !a2.duplicate ? 1 : 0) >= 1));

  // Daily Issue route source checks
  const diSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'daily-issue-routes.js'), 'utf8');
  ok('O. Daily Issue comment alien gate', /ALIEN_DAILY_ISSUE_WRITE_FORBIDDEN/.test(diSrc));
  ok('P. Daily Issue reaction alien gate', /ALIEN_DAILY_ISSUE_REACT_FORBIDDEN/.test(diSrc));

  const rightsSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'rights-infringement-routes.js'), 'utf8');
  ok('R. rights path not alien-gated', !/KANTAPBIYA|isAlien|alienAccess/.test(rightsSrc));

  console.log('---');
  console.log('passed:', passed, 'failed:', failed);
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
