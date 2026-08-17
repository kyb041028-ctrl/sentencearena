'use strict';
/**
 * 센텐스아레나 — 신고 기반 외계행 moderation V1
 * node tools/test-alien-report-moderation.js
 */

const reportCore = require('../shared/alien-report-moderation-core');
const modCore = require('../shared/alien-moderation-core');
const memRepo = require('../server/alien-moderation-memory-repository');
const modService = require('../server/alien-moderation-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const supabasePop = require('../server/territory-population-supabase-repository');
const evoService = require('../server/territory-evolution-service');
const popAdapter = require('../server/territory-population-adapter');
const evoCore = require('../shared/territory-evolution-core');
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
const results = [];

function ok(label, condition, detail) {
  if (condition) {
    results.push('  PASS: ' + label);
    pass++;
  } else {
    results.push('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    fail++;
  }
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function createFakeProfilesClient(members) {
  return {
    from: function (table) {
      if (table !== 'profiles') throw new Error('unexpected table ' + table);
      const state = { eq: {}, neq: {} };
      const q = {
        select: function () { return q; },
        eq: function (col, val) { state.eq[col] = val; return q; },
        neq: function (col, val) { state.neq[col] = val; return q; },
        then: function (resolve, reject) {
          let rows = members.slice();
          Object.keys(state.eq).forEach(function (col) {
            rows = rows.filter(function (m) { return m[col] === state.eq[col]; });
          });
          Object.keys(state.neq).forEach(function (col) {
            rows = rows.filter(function (m) { return m[col] !== state.neq[col]; });
          });
          return Promise.resolve({ count: rows.length, error: null, data: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

async function makeHarness(options) {
  const opts = options || {};
  memRepo._reset();
  modService.setRepository(memRepo);
  modService.setV1Enabled(opts.v1 !== false);
  const boardRepo = createBoardMemoryRepository();
  modService.setBoardReportReader(boardRepo);
  const board = createBoardService({
    repository: boardRepo,
    userContext: createMockUserContextAdapter({
      defaultTerritory: 'CENTRAL',
      territories: opts.territories || {},
    }),
    operational: true,
    onReportCreated: function (row) {
      return modService.onReportCreated(row);
    },
  });
  return { board: board, boardRepo: boardRepo };
}

async function seedPost(board, authorId, title) {
  const created = await board.createPost({ userId: authorId }, {
    territory: 'CENTRAL',
    title: title || '신고 대상 글',
    content: '본문입니다. 충분히 긴 내용으로 작성합니다.',
    isAnonymous: false,
  });
  return created.post;
}

(async function main() {
  results.push('\n[분류]');
  ok('A0. abuse=SIMPLE', reportCore.classifyReportReason('abuse') === 'SIMPLE');
  ok('A0b. other=OTHER', reportCore.classifyReportReason('other') === 'OTHER');
  ok('A0c. reason 목록 유지', JSON.stringify(reportCore.REPORT_REASONS) === JSON.stringify(['abuse', 'spam', 'baiting', 'misinfo', 'privacy', 'other']));

  const h = await makeHarness({
    territories: { [uid(1)]: 'PIONEER' },
  });
  memRepo._seedState(uid(1), { earthTerritory: 'PIONEER', citizenshipStatus: 'CITIZEN' });
  const target = uid(1);
  const r1 = uid(11);
  const r2 = uid(12);
  const r3 = uid(13);
  const r4 = uid(14);
  const post1 = await seedPost(h.board, target, '글1 충분히 긴 제목입니다');
  const post2 = await seedPost(h.board, target, '글2 충분히 긴 제목입니다');
  const post3 = await seedPost(h.board, target, '글3 충분히 긴 제목입니다');
  const post4 = await seedPost(h.board, target, '글4 충분히 긴 제목입니다');

  results.push('\n[A 1회 경고]');
  const a1 = await h.board.createReport({ userId: r1 }, {
    targetType: 'POST',
    targetId: post1.id,
    reasonCode: 'abuse',
  });
  ok('A. 단순신고 1회 경고', a1.moderation && a1.moderation.action === 'WARN' && a1.moderation.warningIssued === true);
  const inbox1 = await modService.listInbox(target);
  ok('A2. 경고 알림 1회', inbox1.filter(function (n) { return n.type === 'alien_warn'; }).length === 1);
  const a1b = await modService.onReportCreated({
    id: a1.id,
    targetAuthorUserId: target,
    reasonCode: 'abuse',
    reporterUserId: r1,
    status: 'SUBMITTED',
    createdAt: a1.createdAt,
    postId: post1.id,
    targetType: 'POST',
  });
  ok('A3. 같은 첫 신고 재처리 시 경고 중복 없음', a1b.warningIssued === false || a1b.action === 'NONE' || a1b.warningDuplicate === true);
  const inbox1b = await modService.listInbox(target);
  ok('A4. 경고 알림 여전히 1회', inbox1b.filter(function (n) { return n.type === 'alien_warn'; }).length === 1);

  results.push('\n[B 2회]');
  const a2 = await h.board.createReport({ userId: r2 }, {
    targetType: 'POST',
    targetId: post2.id,
    reasonCode: 'spam',
  });
  const stB = await memRepo.getModerationState(target);
  ok('B. 2회 외계행 없음', a2.moderation && a2.moderation.action === 'NONE' && stB.citizenshipStatus === 'CITIZEN');

  results.push('\n[C 3회 자동 외계행]');
  const a3 = await h.board.createReport({ userId: r3 }, {
    targetType: 'POST',
    targetId: post3.id,
    reasonCode: 'baiting',
    alignmentScore: 9999,
    politicalScore: -9999,
  });
  const stC = await memRepo.getModerationState(target);
  ok('C. 3회 KANTAPBIYA_RESIDENT', a3.moderation && a3.moderation.action === 'TRANSFER' && stC.citizenshipStatus === 'KANTAPBIYA_RESIDENT');
  ok('C2. territory PIONEER 보존', stC.earthTerritory === 'PIONEER');
  ok('C3. strike 1 · 7일', stC.strikeCount === 1 && stC.returnPolicy === 'DAYS');
  const rel = modCore.calculateAlienReleaseEligibility({
    strikeCount: 1,
    enteredAt: stC.enteredAt,
  });
  ok('E. 첫 외계행 7일', rel.durationDays === 7 && reportCore.resolveReturnPolicy(1).durationDays === 7);

  results.push('\n[D 재처리 중복 없음]');
  const strikeBefore = stC.strikeCount;
  const d = await modService.onReportCreated({
    id: a3.id,
    targetAuthorUserId: target,
    reasonCode: 'baiting',
    reporterUserId: r3,
    status: 'SUBMITTED',
    createdAt: a3.createdAt,
    postId: post3.id,
    targetType: 'POST',
  });
  const stD = await memRepo.getModerationState(target);
  ok('D. 3번째 신고 재처리 strike 유지', d.duplicate === true && stD.strikeCount === strikeBefore);

  results.push('\n[P 정치성향 무관]');
  ok('P. alignment 필드가 있어도 신고만으로 판정', a3.moderation.action === 'TRANSFER');

  results.push('\n[I/J 복귀 후 cycle]');
  const ret = await modService.returnToEarth(target, { operatorForced: true });
  const stRet = await memRepo.getModerationState(target);
  ok('T. 복귀 후 Earth citizenship · territory 유지', ret.ok && stRet.citizenshipStatus === 'CITIZEN' && stRet.earthTerritory === 'PIONEER');
  ok('J. trip count 유지', stRet.strikeCount === 1);
  const countedAfter = reportCore.countValidSimpleReports(await h.boardRepo.listReportsByTargetAuthor(target), {
    targetUserId: target,
    cycleStartAt: stRet.lastReturnedAt,
  });
  ok('I. 복귀 후 simple cycle 0', countedAfter.count === 0);

  const post5 = await seedPost(h.board, target, '복귀 후 글 충분히 긴 제목');
  const afterReturnWarn = await h.board.createReport({ userId: r4 }, {
    targetType: 'POST',
    targetId: post5.id,
    reasonCode: 'misinfo',
  });
  ok('I2. 복귀 후 1회 다시 경고', afterReturnWarn.moderation && afterReturnWarn.moderation.action === 'WARN');

  results.push('\n[F/G/H 페널티]');
  ok('F. 2회 15일', reportCore.resolveReturnPolicy(2).durationDays === 15);
  ok('G. 3회 30일', reportCore.resolveReturnPolicy(3).durationDays === 30);
  ok('H. 4회 SEASON_END', reportCore.resolveReturnPolicy(4).returnPolicy === 'SEASON_END');

  memRepo._seedState(uid(2), { earthTerritory: 'CENTRAL', strikeCount: 1, citizenshipStatus: 'CITIZEN' });
  const h2 = h;
  const t2 = uid(2);
  const p21 = await seedPost(h2.board, t2, '2차대상 글1 충분히');
  const p22 = await seedPost(h2.board, t2, '2차대상 글2 충분히');
  const p23 = await seedPost(h2.board, t2, '2차대상 글3 충분히');
  await h2.board.createReport({ userId: uid(21) }, { targetType: 'POST', targetId: p21.id, reasonCode: 'abuse' });
  await h2.board.createReport({ userId: uid(22) }, { targetType: 'POST', targetId: p22.id, reasonCode: 'abuse' });
  const secondTrip = await h2.board.createReport({ userId: uid(23) }, { targetType: 'POST', targetId: p23.id, reasonCode: 'abuse' });
  ok('F2. 두 번째 외계행 15일', secondTrip.moderation && secondTrip.moderation.durationDays === 15 && secondTrip.moderation.strikeCount === 2);

  memRepo._seedState(uid(3), { earthTerritory: 'GUARDIAN', strikeCount: 2, citizenshipStatus: 'CITIZEN' });
  const t3 = uid(3);
  const p31 = await seedPost(h2.board, t3, '3차대상 글1 충분히');
  const p32 = await seedPost(h2.board, t3, '3차대상 글2 충분히');
  const p33 = await seedPost(h2.board, t3, '3차대상 글3 충분히');
  await h2.board.createReport({ userId: uid(31) }, { targetType: 'POST', targetId: p31.id, reasonCode: 'privacy' });
  await h2.board.createReport({ userId: uid(32) }, { targetType: 'POST', targetId: p32.id, reasonCode: 'privacy' });
  const thirdTrip = await h2.board.createReport({ userId: uid(33) }, { targetType: 'POST', targetId: p33.id, reasonCode: 'privacy' });
  ok('G2. 세 번째 외계행 30일', thirdTrip.moderation && thirdTrip.moderation.durationDays === 30);

  memRepo._seedState(uid(4), { earthTerritory: 'CENTRAL', strikeCount: 3, citizenshipStatus: 'CITIZEN' });
  const t4 = uid(4);
  const p41 = await seedPost(h2.board, t4, '4차대상 글1 충분히');
  const p42 = await seedPost(h2.board, t4, '4차대상 글2 충분히');
  const p43 = await seedPost(h2.board, t4, '4차대상 글3 충분히');
  await h2.board.createReport({ userId: uid(41) }, { targetType: 'POST', targetId: p41.id, reasonCode: 'spam' });
  await h2.board.createReport({ userId: uid(42) }, { targetType: 'POST', targetId: p42.id, reasonCode: 'spam' });
  const fourthTrip = await h2.board.createReport({ userId: uid(43) }, { targetType: 'POST', targetId: p43.id, reasonCode: 'spam' });
  ok('H2. 네 번째 SEASON_END', fourthTrip.moderation && fourthTrip.moderation.returnPolicy === 'SEASON_END');
  const seasonHold = await modService.returnToEarth(t4, { operatorForced: false });
  ok('H3. 시즌종료는 운영자만 복귀', seasonHold.ok === false && seasonHold.error === 'SEASON_END_ADMIN_ONLY');

  results.push('\n[K/L/M 기타신고]');
  memRepo._seedState(uid(5), { earthTerritory: 'CENTRAL', citizenshipStatus: 'CITIZEN', strikeCount: 0 });
  const t5 = uid(5);
  const pOther = await seedPost(h2.board, t5, '기타신고 대상 글 충분히');
  const otherRep = await h2.board.createReport({ userId: uid(51) }, {
    targetType: 'POST',
    targetId: pOther.id,
    reasonCode: 'other',
    reasonDetail: '운영 확인 필요',
  });
  const stOther = await memRepo.getModerationState(t5);
  ok('K. 기타신고 자체 자동 외계행 없음', otherRep.moderation && otherRep.moderation.action === 'ADMIN_REVIEW' && stOther.citizenshipStatus === 'CITIZEN');
  const adminAlien = await modService.applyAdminReportAction(
    { id: otherRep.id, targetAuthorUserId: t5, reasonCode: 'other' },
    'IMMEDIATE_ALIEN',
    uid(99),
  );
  const stAdmin = await memRepo.getModerationState(t5);
  ok('L. admin immediate alien', adminAlien.ok && stAdmin.citizenshipStatus === 'KANTAPBIYA_RESIDENT');
  ok('M. admin trip +1', adminAlien.strikeCount === 1 && adminAlien.transferReason === 'ADMIN_IMMEDIATE_ALIEN');
  const hist = await memRepo.listModerationEvents(t5);
  ok('history AUTO vs ADMIN 구분', hist.items.some(function (e) {
    return e.transferReason === 'ADMIN_IMMEDIATE_ALIEN';
  }));

  results.push('\n[N/O 무효·중복]');
  memRepo._seedState(uid(6), { earthTerritory: 'CENTRAL', citizenshipStatus: 'CITIZEN', strikeCount: 0 });
  const t6 = uid(6);
  const pInv = await seedPost(h2.board, t6, '무효 신고 대상 충분히');
  const inv = await h2.board.createReport({ userId: uid(61) }, {
    targetType: 'POST',
    targetId: pInv.id,
    reasonCode: 'abuse',
  });
  await h2.board.reviewReport({ userId: uid(99) }, inv.id, { status: 'REJECTED', resolutionNote: 'INVALID' });
  const validAfterReject = reportCore.countValidSimpleReports(await h2.boardRepo.listReportsByTargetAuthor(t6), {
    targetUserId: t6,
  });
  ok('N. 무효/취소 신고 count 제외', validAfterReject.count === 0);

  const pDup = await seedPost(h2.board, t6, '중복 신고 대상 충분히');
  await h2.board.createReport({ userId: uid(62) }, {
    targetType: 'POST',
    targetId: pDup.id,
    reasonCode: 'spam',
  });
  let dupErr = null;
  try {
    await h2.board.createReport({ userId: uid(62) }, {
      targetType: 'POST',
      targetId: pDup.id,
      reasonCode: 'spam',
    });
  } catch (e) {
    dupErr = e;
  }
  ok('O. 중복 신고 거부', dupErr && dupErr.code === 'BOARD_REPORT_DUPLICATE');

  const selfErr = await h2.board.createReport({ userId: t6 }, {
    targetType: 'POST',
    targetId: pInv.id,
    reasonCode: 'abuse',
  }).then(function () { return null; }).catch(function (e) { return e; });
  ok('O2. 자기 신고 금지', selfErr && selfErr.code === 'BOARD_REPORT_SELF_FORBIDDEN');

  const fixtureCounted = reportCore.countValidSimpleReports([{
    id: 'fx',
    reporterUserId: uid(70),
    targetAuthorUserId: t6,
    reasonCode: 'abuse',
    status: 'SUBMITTED',
    reasonDetail: 'SC_TEST_FIXTURE',
    createdAt: new Date().toISOString(),
    postId: pInv.id,
    targetType: 'POST',
  }], { targetUserId: t6, includeFixture: false });
  ok('O3. fixture production count 제외', fixtureCounted.count === 0);

  results.push('\n[Q/R/S 인원]');
  const members = [];
  function addMembers(territory, citizenship, n) {
    for (let i = 0; i < n; i++) {
      members.push({ territory: territory, citizenship_status: citizenship });
    }
  }
  addMembers('PIONEER', 'CITIZEN', 10);
  addMembers('CENTRAL', 'CITIZEN', 20);
  addMembers('GUARDIAN', 'CITIZEN', 5);
  addMembers('PIONEER', 'KANTAPBIYA_RESIDENT', 3);
  addMembers('CENTRAL', 'KANTAPBIYA_RESIDENT', 2);
  supabasePop.setAdminClient(createFakeProfilesClient(members));
  supabasePop.invalidateEarthCountCache();
  const pack = await supabasePop.countAllUsersByTerritory({ force: true });
  ok('Q. Earth PIONEER 외계 제외', pack.PIONEER.population === 10);
  ok('Q2. Earth CENTRAL 외계 제외', pack.CENTRAL.population === 20);
  ok('Q3. Earth GUARDIAN 외계 제외', pack.GUARDIAN.population === 5);
  ok('R. ALIEN 실제 인원', pack.ALIEN.available && pack.ALIEN.population === 5);
  const evoPop = evoCore.resolveEvolutionPopulation('CENTRAL', {
    PIONEER: pack.PIONEER.population,
    CENTRAL: pack.CENTRAL.population,
    GUARDIAN: pack.GUARDIAN.population,
    ALIEN: pack.ALIEN.population,
  });
  ok('S. CENTRAL 발전 인원 ALIEN 제외', evoPop === 35);

  popAdapter.setRepository(supabasePop);
  popAdapter.setDataMode('API_OPERATIONAL');
  evoService.setDataMode('API_OPERATIONAL');
  const allEvo = await evoService.getAllTerritoryEvolutions();
  ok('R2. ALIEN HUD 실인원', allEvo.directCounts.ALIEN === 5);
  ok('S2. CENTRAL evo 35', allEvo.territories.CENTRAL.population === 35);
  popAdapter.setDataMode('LEGACY_LOCAL');
  evoService.setDataMode('LEGACY_LOCAL');
  supabasePop.setAdminClient(null);

  results.push('\n[회귀 보호]');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok('U. 신고 모달 reason 유지', /id: 'abuse'/.test(indexHtml) && /id: 'other'/.test(indexHtml));
  ok('auth.js 미변경 확인용 존재', fs.existsSync(path.join(__dirname, '../public/auth.js')));
  const rules = fs.readFileSync(path.join(__dirname, '../.cursor/rules/sentencearena.mdc'), 'utf8');
  ok('rules 파일 존재', rules.indexOf('센텐스아레나') !== -1);

  memRepo._reset();
  modService.setV1Enabled(false);

  console.log('\n=== 외계 moderation V1 테스트 ===');
  results.forEach(function (r) { console.log(r); });
  console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
