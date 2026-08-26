#!/usr/bin/env node
'use strict';

/**
 * 운영자 중복 처리 방지:
 * - 이의제기 재결정 차단 (409)
 * - 동일 behaviorKey 수동 제재 중복 차단 (409)
 */

process.env.LEGAL_GATE_ENFORCE = '0';

const express = require('express');
const sanctionService = require('../server/user-sanction-service');
const memRepo = require('../server/alien-moderation-memory-repository');
const { mountAdminRoutes } = require('../server/alien-moderation-routes');
const { createBoardService } = require('../server/board-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const reviewCore = require('../shared/board-report-review-core');
const alienMod = require('../server/alien-moderation-service');

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail || '');
  }
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function request(app, method, path, headers, bodyObj) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      const http = require('http');
      const payload = bodyObj != null ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
      const hdrs = Object.assign({}, headers || {});
      if (payload) {
        hdrs['Content-Type'] = 'application/json';
        hdrs['Content-Length'] = String(payload.length);
      }
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: port,
          path: path,
          method: method,
          headers: hdrs,
        },
        function (res) {
          let raw = '';
          res.on('data', function (c) {
            raw += c;
          });
          res.on('end', function () {
            server.close();
            let body = null;
            try {
              body = JSON.parse(raw);
            } catch (_) {
              body = raw;
            }
            resolve({ status: res.statusCode, body: body });
          });
        }
      );
      req.on('error', function (e) {
        server.close();
        resolve({ status: 0, body: String(e && e.message) });
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

async function seedAppeal(userId, sanctionType) {
  memRepo._seedState(userId, {
    currentSanctionType: sanctionType,
    currentSanctionStatus: 'ACTIVE',
    currentSanctionStartsAt: new Date().toISOString(),
    currentSanctionEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  return sanctionService.submitAppeal({ userId: userId, body: '소명합니다. 재검토를 요청합니다.' });
}

function makeBoard(territories) {
  memRepo._reset();
  alienMod.setRepository(memRepo);
  sanctionService.setRepository(memRepo);
  alienMod.setV1Enabled(false);
  const boardRepo = createBoardMemoryRepository();
  alienMod.setBoardReportReader(boardRepo);
  return createBoardService({
    repository: boardRepo,
    userContext: createMockUserContextAdapter({
      defaultTerritory: 'CENTRAL',
      territories: territories || {},
    }),
    operational: true,
    onBehaviorReviewed: function (input) {
      return alienMod.onBehaviorReviewed(input);
    },
  });
}

async function main() {
  console.log('\n=== operator duplicate decision guard ===\n');

  memRepo._reset();
  sanctionService.setRepository(memRepo);
  alienMod.setRepository(memRepo);
  alienMod.setV1Enabled(false);

  const u1 = uid(1);
  const created = await seedAppeal(u1, 'ACCOUNT_RESTRICT_7D');
  const appealId = created.appeal.id;
  const first = await sanctionService.resolveAppeal({
    appealId: appealId,
    decision: 'RELEASED',
    operatorUserId: uid(99),
    operatorReply: '해제',
  });
  ok('A. first RELEASED', first.ok === true && first.appeal.status === 'RELEASED');
  const decidedBy1 = first.appeal.decidedBy;
  const decidedAt1 = first.appeal.decidedAt;

  let secondErr = null;
  try {
    await sanctionService.resolveAppeal({
      appealId: appealId,
      decision: 'RELEASED',
      operatorUserId: uid(98),
      operatorReply: '다시',
    });
  } catch (e) {
    secondErr = e;
  }
  ok('B. second RELEASED → 409', secondErr && secondErr.code === 'APPEAL_ALREADY_DECIDED' && secondErr.status === 409);

  const after = (await memRepo.listSanctionAppeals(u1)).find(function (a) {
    return a.id === appealId;
  });
  ok('B. decidedBy 보존', after && after.decidedBy === decidedBy1);
  ok('B. decidedAt 보존', after && after.decidedAt === decidedAt1);
  ok('B. status 유지 RELEASED', after && after.status === 'RELEASED');

  let crossErr = null;
  try {
    await sanctionService.resolveAppeal({
      appealId: appealId,
      decision: 'UPHELD',
      operatorUserId: uid(97),
    });
  } catch (e) {
    crossErr = e;
  }
  ok('C. RELEASED → UPHELD 409', crossErr && crossErr.code === 'APPEAL_ALREADY_DECIDED');

  memRepo._reset();
  sanctionService.setRepository(memRepo);
  const u2 = uid(2);
  const a2 = await seedAppeal(u2, 'ACCOUNT_RESTRICT_30D');
  await sanctionService.resolveAppeal({
    appealId: a2.appeal.id,
    decision: 'SHORTENED',
    operatorUserId: uid(99),
  });
  let dErr = null;
  try {
    await sanctionService.resolveAppeal({
      appealId: a2.appeal.id,
      decision: 'RELEASED',
      operatorUserId: uid(99),
    });
  } catch (e) {
    dErr = e;
  }
  ok('D. SHORTENED → RELEASED 409', dErr && dErr.code === 'APPEAL_ALREADY_DECIDED');

  memRepo._reset();
  sanctionService.setRepository(memRepo);
  const u3 = uid(3);
  const a3 = await seedAppeal(u3, 'PERMANENT_BAN');
  await sanctionService.resolveAppeal({
    appealId: a3.appeal.id,
    decision: 'UPHELD',
    operatorUserId: uid(99),
  });
  let eErr = null;
  try {
    await sanctionService.resolveAppeal({
      appealId: a3.appeal.id,
      decision: 'SHORTENED',
      operatorUserId: uid(99),
    });
  } catch (e) {
    eErr = e;
  }
  ok('E. UPHELD → SHORTENED 409', eErr && eErr.code === 'APPEAL_ALREADY_DECIDED');

  memRepo._reset();
  sanctionService.setRepository(memRepo);
  const u4 = uid(4);
  const a4 = await seedAppeal(u4, 'ACCOUNT_RESTRICT_7D');
  const concurrent = await Promise.all([
    sanctionService.resolveAppeal({
      appealId: a4.appeal.id,
      decision: 'RELEASED',
      operatorUserId: uid(91),
      operatorReply: 'c1',
    }).then(function (r) {
      return { ok: true, r: r };
    }).catch(function (e) {
      return { ok: false, e: e };
    }),
    sanctionService.resolveAppeal({
      appealId: a4.appeal.id,
      decision: 'UPHELD',
      operatorUserId: uid(92),
      operatorReply: 'c2',
    }).then(function (r) {
      return { ok: true, r: r };
    }).catch(function (e) {
      return { ok: false, e: e };
    }),
  ]);
  const wins = concurrent.filter(function (x) {
    return x.ok;
  });
  const loses = concurrent.filter(function (x) {
    return !x.ok;
  });
  ok('F. concurrent 정확히 1승', wins.length === 1);
  ok('F. concurrent 1패 409', loses.length === 1 && loses[0].e.code === 'APPEAL_ALREADY_DECIDED');
  const finalA4 = (await memRepo.listSanctionAppeals(u4)).find(function (a) {
    return a.id === a4.appeal.id;
  });
  ok('F. 최종 상태 1개', finalA4 && ['RELEASED', 'UPHELD'].indexOf(finalA4.status) >= 0);

  const author = uid(10);
  const board = makeBoard({ [author]: 'CENTRAL' });
  const postAPack = await board.createPost({ userId: author }, { title: '글A 제목입니다', content: '본문A 충분히 긴 내용입니다.' });
  const postA = postAPack.post || postAPack;
  await board.createReport({ userId: uid(11) }, { targetType: 'POST', targetId: postA.id, reasonCode: 'abuse' });
  const keyA = reviewCore.behaviorKeyFromParts('POST', postA.id);
  const firstSanction = await board.reviewBehavior(
    { userId: uid(99) },
    keyA,
    { status: 'ACCEPTED', operatorSanction: 'WARNING', resolutionNote: '수동 경고' }
  );
  ok('manual first WARNING', !!(firstSanction && firstSanction.sanction && firstSanction.sanction.applied), JSON.stringify(firstSanction && firstSanction.sanction));

  let dupManual = null;
  try {
    await board.reviewBehavior(
      { userId: uid(99) },
      keyA,
      { status: 'ACCEPTED', operatorSanction: 'WARNING', resolutionNote: '또 경고' }
    );
  } catch (e) {
    dupManual = e;
  }
  ok('same behavior second WARNING → 409', dupManual && dupManual.code === 'SANCTION_BEHAVIOR_ALREADY_SANCTIONED' && dupManual.status === 409);

  const postBPack = await board.createPost({ userId: author }, { title: '글B 제목입니다', content: '본문B 충분히 긴 내용입니다.' });
  const postB = postBPack.post || postBPack;
  await board.createReport({ userId: uid(12) }, { targetType: 'POST', targetId: postB.id, reasonCode: 'abuse' });
  const keyB = reviewCore.behaviorKeyFromParts('POST', postB.id);
  const secondBehavior = await board.reviewBehavior(
    { userId: uid(99) },
    keyB,
    { status: 'ACCEPTED', operatorSanction: 'WARNING', resolutionNote: '다른 행동' }
  );
  ok('different behavior same type allowed', !!(secondBehavior && secondBehavior.sanction && secondBehavior.sanction.applied));

  const authorC = uid(20);
  const board2 = makeBoard({ [authorC]: 'CENTRAL' });
  const postCPack = await board2.createPost({ userId: authorC }, { title: '글C 제목입니다', content: '본문C 충분히 긴 내용입니다.' });
  const postC = postCPack.post || postCPack;
  await board2.createReport({ userId: uid(21) }, { targetType: 'POST', targetId: postC.id, reasonCode: 'baiting' });
  const keyC = reviewCore.behaviorKeyFromParts('POST', postC.id);
  const concSan = await Promise.all([
    board2.reviewBehavior({ userId: uid(99) }, keyC, { status: 'ACCEPTED', operatorSanction: 'TEMP_SUSPEND' })
      .then(function (r) { return { ok: true, r: r }; })
      .catch(function (e) { return { ok: false, e: e }; }),
    board2.reviewBehavior({ userId: uid(99) }, keyC, { status: 'ACCEPTED', operatorSanction: 'TEMP_SUSPEND' })
      .then(function (r) { return { ok: true, r: r }; })
      .catch(function (e) { return { ok: false, e: e }; }),
  ]);
  const sanWins = concSan.filter(function (x) { return x.ok && x.r && x.r.sanction && x.r.sanction.applied; });
  const sanLose = concSan.filter(function (x) {
    return !x.ok && x.e && x.e.code === 'SANCTION_BEHAVIOR_ALREADY_SANCTIONED';
  });
  const softDup = concSan.filter(function (x) {
    return x.ok && x.r && x.r.sanction && x.r.sanction.duplicate;
  });
  ok(
    'concurrent manual same behavior ≤1 apply',
    sanWins.length === 1 && (sanLose.length + softDup.length) >= 1,
    'wins=' + sanWins.length + ' lose=' + sanLose.length + ' soft=' + softDup.length
  );

  const authorL = uid(30);
  const board3 = makeBoard({ [authorL]: 'CENTRAL' });
  const types = [];
  for (let i = 0; i < 3; i++) {
    const pPack = await board3.createPost({ userId: authorL }, {
      title: '사다리 글' + i + ' 제목입니다',
      content: '사다리 본문' + i + ' 충분히 긴 내용입니다.',
    });
    const p = pPack.post || pPack;
    await board3.createReport({ userId: uid(31 + i) }, { targetType: 'POST', targetId: p.id, reasonCode: 'abuse' });
    const r = await board3.reviewBehavior(
      { userId: uid(99) },
      reviewCore.behaviorKeyFromParts('POST', p.id),
      { status: 'ACCEPTED', operatorSanction: 'AUTO' }
    );
    types.push(r.sanction && r.sanction.sanctionType);
  }
  ok('AUTO ladder 1 WARNING', types[0] === 'WARNING', types.join(','));
  ok('AUTO ladder 2 FINAL_WARNING', types[1] === 'FINAL_WARNING', types.join(','));
  ok('AUTO ladder 3 ALIEN_TRANSFER', types[2] === 'ALIEN_TRANSFER', types.join(','));

  const app = express();
  app.use(express.json());
  app.use(
    '/api/admin/moderation',
    mountAdminRoutes({
      adminAuth: {
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'k',
        getUserFromAccessToken: async function () {
          return { id: uid(99), app_metadata: { role: 'ADMIN' } };
        },
      },
      getBoardService: function () {
        return board3;
      },
    })
  );
  const noTok = await request(app, 'GET', '/api/admin/moderation/reports', {});
  ok('admin no token 401', noTok.status === 401);

  console.log('\nOperator duplicate guard results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
