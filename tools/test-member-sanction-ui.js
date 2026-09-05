#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const core = require('../shared/member-sanction-ui-core');
const sanctionCore = require('../shared/user-sanction-core');
const memRepo = require('../server/alien-moderation-memory-repository');
const sanctionService = require('../server/user-sanction-service');
const { createUserSanctionRouter } = require('../server/user-sanction-routes');
const { requestApp } = require('./daily-issue-api-http-helper');
const { resolveAlienModerationV1Enabled } = require('../server/alien-moderation-v1-flag');

const ROOT = path.join(__dirname, '..');

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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function main() {
  console.log('\n=== member sanction UI ===\n');

  memRepo._reset();
  sanctionService.setRepository(memRepo);

  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createUserSanctionRouter({
      resolveActor: async function (req) {
        if (req.headers['x-user-id']) return { userId: String(req.headers['x-user-id']) };
        return null;
      },
    }),
  );

  const guest = await requestApp(app, 'GET', '/api/me/sanction', {});
  ok('1. Guest 조회 불가', guest.status === 401, guest.status);

  const guestAppeal = await requestApp(app, 'POST', '/api/me/sanctions/appeals', {
    body: { body: '게스트 이의' },
  });
  ok('1b. Guest 이의제기 불가', guestAppeal.status === 401, guestAppeal.status);

  const self = uid(1);
  const other = uid(2);
  await sanctionService.applyRecord(self, { type: 'ACCOUNT_RESTRICT_7D', ladder: 'CONDUCT_ALIEN' }, {});
  await sanctionService.applyRecord(other, { type: 'PERMANENT_BAN', ladder: 'SEVERE' }, {});

  const mine = await requestApp(app, 'GET', '/api/me/sanction', {
    headers: { 'x-user-id': self },
  });
  ok(
    '2. 로그인 회원 자기 sanction만 조회',
    mine.status === 200 && mine.body.sanction && mine.body.sanction.sanctionType === 'ACCOUNT_RESTRICT_7D',
    JSON.stringify(mine.body),
  );

  const otherView = await requestApp(app, 'GET', '/api/me/sanction', {
    headers: { 'x-user-id': other },
  });
  ok(
    '3. 다른 회원 sanction 조회 불가',
    otherView.status === 200 && otherView.body.sanction.sanctionType === 'PERMANENT_BAN' && otherView.body.sanction.sanctionType !== mine.body.sanction.sanctionType,
    JSON.stringify(otherView.body.sanction),
  );
  const sneak = await requestApp(app, 'GET', '/api/me/sanction?userId=' + other, {
    headers: { 'x-user-id': self },
  });
  ok(
    '3b. query userId로 타인 조회 불가',
    sneak.status === 200 && sneak.body.sanction.sanctionType === 'ACCOUNT_RESTRICT_7D',
    JSON.stringify(sneak.body.sanction),
  );

  const hiddenHits = core.containsHiddenPayload(mine.body).concat(core.containsHiddenPayload(otherView.body));
  ok('4. 내부 UUID/decidedBy/관리자정보 미노출', hiddenHits.length === 0 && JSON.stringify(mine.body).indexOf('decidedBy') === -1, hiddenHits.join(','));

  const submitted = await requestApp(app, 'POST', '/api/me/sanctions/appeals', {
    headers: { 'x-user-id': self },
    body: { body: '기간 제한 소명합니다', userId: other },
  });
  ok(
    '5. appeal 가능 sanction 제출 가능',
    submitted.status === 201 && submitted.body.ok === true && submitted.body.appeal && submitted.body.appeal.status === 'SUBMITTED',
    submitted.status + ' ' + JSON.stringify(submitted.body),
  );
  ok(
    '5b. 클라이언트가 다른 userId를 보내도 본인만 제출',
    submitted.body.appeal && JSON.stringify(submitted.body.appeal).indexOf(other) === -1,
    JSON.stringify(submitted.body.appeal),
  );
  ok('4b. 제출 응답에 id/userId/decidedBy 없음', JSON.stringify(submitted.body.appeal).indexOf('decidedBy') === -1 && submitted.body.appeal.userId == null && submitted.body.appeal.id == null);

  const dup = await requestApp(app, 'POST', '/api/me/sanctions/appeals', {
    headers: { 'x-user-id': self },
    body: { body: '중복 제출' },
  });
  ok('6. 진행 중 appeal 중복 → 409', dup.status === 409 && dup.body.error === 'SANCTION_APPEAL_ALREADY_SUBMITTED', dup.status + ' ' + JSON.stringify(dup.body));

  const listed = await requestApp(app, 'GET', '/api/me/sanctions/appeals', {
    headers: { 'x-user-id': self },
  });
  const otherList = await requestApp(app, 'GET', '/api/me/sanctions/appeals', {
    headers: { 'x-user-id': other },
  });
  ok('2b. 이의 목록도 본인만', listed.status === 200 && listed.body.appeals.length === 1 && otherList.body.appeals.length === 0);

  const store = memRepo._getStore();
  store.appeals[0].status = 'SHORTENED';
  store.appeals[0].decidedBy = 'admin-secret';
  store.appeals[0].operatorMemo = '내부 메모';
  const decided = await requestApp(app, 'GET', '/api/me/sanctions/appeals', {
    headers: { 'x-user-id': self },
  });
  ok('7. 처리 완료 outcome 표시', decided.body.appeals[0].status === 'SHORTENED' && core.statusLabel('SHORTENED') === '기간 단축');
  ok(
    '4c. 결정 후에도 decidedBy/메모 미노출',
    JSON.stringify(decided.body).indexOf('decidedBy') === -1 && JSON.stringify(decided.body).indexOf('내부 메모') === -1,
    JSON.stringify(decided.body),
  );

  const ends = mine.body.sanction.endsAt;
  ok('8. endsAt 존재', !!ends);
  ok('8b. endsAt 표시 가능', core.formatDateTime(ends).length > 0, core.formatDateTime(ends));

  const expiredNotice = {
    sanctionType: 'WRITE_RESTRICT_24H',
    status: 'EXPIRED',
    endsAt: new Date(Date.now() - 60 * 1000).toISOString(),
  };
  ok('9. 만료 제재는 current가 아님', core.isExpiredNotice(expiredNotice) === true && core.isActiveRestriction(expiredNotice) === false && core.isCurrentNotice(expiredNotice) === false);
  ok('9b. 활성 제한은 current', core.isActiveRestriction(mine.body.sanction) === true && core.isCurrentNotice(mine.body.sanction) === true);

  ok(
    '10. Alien OFF 상태 유지',
    resolveAlienModerationV1Enabled({ NODE_ENV: 'production', ALIEN_MODERATION_V1: 'false' }) === false,
  );

  const index = read('public/index.html');
  const ui = read('public/member-sanction-ui.js');
  ok('UI 진입점', /제재 및 이의제기/.test(index) && /sc-sanction-dialog/.test(index));
  ok('Guest 버튼은 로그인 바에만', /renderAppUserBarLoggedIn[\s\S]*제재 및 이의제기/.test(index) && !/renderAppUserBarGuest[\s\S]{0,400}제재 및 이의제기/.test(index));
  ok('Guest open 게이트', /__scRequireLoggedInMember/.test(index) && /__scRequireLoggedInMember/.test(ui));
  ok('강제 로그인 이동 없음', ui.indexOf('showLoginOnly') === -1 && ui.indexOf('__scShowAuthHome') === -1);
  ok('기존 API만 사용', ui.indexOf('/api/me/sanction') !== -1 && ui.indexOf('/api/me/sanctions/appeals') !== -1);
  ok('userId 전송 없음', !/JSON\.stringify\(\{[^}]*userId/.test(ui));
  ok('표시 라벨은 기존 type만', core.typeLabel('WRITE_RESTRICT_24H') === '24시간 작성 제한' && core.typeLabel('PERMANENT_BAN') === '영구정지');
  ok('없는 type 신설 없음', !Object.prototype.hasOwnProperty.call(core.TYPE_LABEL, 'WRITE_RESTRICTION') && !Object.prototype.hasOwnProperty.call(core.TYPE_LABEL, 'PERMANENT'));
  ok('서버 type과 라벨 키 일치', Object.keys(core.TYPE_LABEL).every(function (k) { return !!sanctionCore.SANCTION_TYPE[k]; }));

  const warning = sanctionCore.toPublicNotice({ currentSanctionType: 'WARNING', currentSanctionStatus: 'ACTIVE' });
  ok('경고는 제한이 아니라 현재 안내', core.isActiveRestriction(warning) === false && core.isCurrentNotice(warning) === true);

  console.log('\nMember sanction UI results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
