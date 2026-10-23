#!/usr/bin/env node
'use strict';

/**
 * Sensitive-consent withdrawal screen.
 * Confirm step, existing API call, success, failure, account withdrawal left intact.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let passed = 0;

function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? ' — ' + detail : ''));
  passed += 1;
  console.log('PASS', name);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function makeNode(id, tag) {
  return {
    id: id,
    tagName: tag || 'DIV',
    hidden: false,
    disabled: false,
    checked: false,
    textContent: '',
    className: '',
    dataset: {},
    _attrs: {},
    _listeners: {},
    children: [],
    setAttribute: function (k, v) {
      this._attrs[k] = String(v);
    },
    getAttribute: function (k) {
      return this._attrs[k] || null;
    },
    addEventListener: function (type, fn) {
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push(fn);
    },
    focus: function () {},
    click: function () {
      if (this.disabled) return;
      var list = this._listeners.click || [];
      for (var i = 0; i < list.length; i++) list[i]({ preventDefault: function () {} });
    },
    querySelector: function (sel) {
      if (sel === '[data-sc-sensitive-withdraw-close]') return this._backdrop || null;
      return null;
    },
  };
}

function bootUi(options) {
  const opt = options || {};
  const nodes = {};
  function add(id, tag) {
    const node = makeNode(id, tag);
    nodes[id] = node;
    return node;
  }
  const dialog = add('sc-sensitive-withdraw-dialog');
  dialog.hidden = true;
  const backdrop = makeNode('backdrop', 'DIV');
  dialog._backdrop = backdrop;
  add('sc-sensitive-withdraw-ack', 'INPUT');
  add('sc-sensitive-withdraw-ack-label', 'LABEL');
  add('sc-sensitive-withdraw-error', 'P').hidden = true;
  add('sc-sensitive-withdraw-status', 'P').hidden = true;
  add('sc-sensitive-withdraw-cancel', 'BUTTON').textContent = '취소';
  add('sc-sensitive-withdraw-submit', 'BUTTON').textContent = '동의 철회';
  add('sc-settings-panel').hidden = true;
  add('sc-settings-close', 'BUTTON').textContent = '닫기';
  add('sc-settings-backdrop');
  add('sc-map-tab-settings', 'BUTTON').textContent = '설정';
  add('sc-sensitive-consent-status', 'P').textContent = '동의 상태를 확인하는 중...';
  add('sc-sensitive-consent-withdraw', 'BUTTON').textContent = '동의 철회';
  const withdrawDialog = add('sc-withdraw-dialog');
  withdrawDialog.hidden = true;
  add('sc-withdraw-submit', 'BUTTON').textContent = '회원탈퇴';
  add('sc-profile-modal-withdraw', 'BUTTON').textContent = '회원탈퇴';
  const alignmentMap = makeNode('alignment-map', 'DIV');
  alignmentMap.hidden = false;
  alignmentMap.className = 'profile-frame__alignment-map';

  const store = {
    sc_political_scores_v1: JSON.stringify({
      'user-a': { conservative: 40, centrist: 20, progressive: 40, forcedTerritory: 'PROGRESSIVE' },
      'user-b': { conservative: 10, centrist: 80, progressive: 10 },
    }),
    sc_tendency_history_v2: JSON.stringify({
      'user-a': [{ t: 1 }],
      'user-b': [{ t: 2 }],
    }),
  };
  const calls = [];
  const dockCalls = [];
  const skinCalls = [];
  const profileRenders = [];
  let fetchImpl = opt.fetchImpl;

  const document = {
    readyState: 'complete',
    getElementById: function (id) {
      return nodes[id] || null;
    },
    querySelectorAll: function (sel) {
      if (sel === '.profile-frame__alignment-map') return [alignmentMap];
      return [];
    },
    addEventListener: function (type, fn) {
      document._listeners = document._listeners || {};
      document._listeners[type] = document._listeners[type] || [];
      document._listeners[type].push(fn);
    },
  };

  const sandbox = {
    window: null,
    document: document,
    localStorage: {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
      },
      setItem: function (k, v) {
        store[k] = String(v);
      },
    },
    fetch: function () {
      throw new Error('raw fetch should not run when authFetch exists');
    },
    console: console,
  };
  sandbox.window = sandbox;
  sandbox.window.__scAuthUserId = 'user-a';
  sandbox.window.__scPlayer = {
    userId: 'user-a',
    territoryId: 'PROGRESSIVE',
    rank: '시민',
    tendency: '개척',
    tendencyPct: { conservative: 40, centrist: 20, progressive: 40 },
  };
  sandbox.window.ScAuth = {
    authFetch: function (url, req) {
      calls.push({ url: url, req: req });
      var method = req && req.method ? String(req.method).toUpperCase() : 'GET';
      if (method === 'GET') {
        return Promise.resolve({
          status: 200,
          json: function () {
            return Promise.resolve({
              ok: true,
              legal: {
                complete: true,
                ageConfirmed: true,
                sensitiveConsented: true,
                territoryDisclosureConsented: true,
                politicalProfileVisibility: 'private',
              },
            });
          },
        });
      }
      return Promise.resolve(fetchImpl(url, req));
    },
  };
  sandbox.window.__scDockSetMeta = function (userId, tendency, territory, rank, pct) {
    dockCalls.push({ userId: userId, tendency: tendency, territory: territory, rank: rank, pct: pct });
    sandbox.window.__scPlayer = {
      userId: userId,
      territoryId: 'COMMON',
      tendency: tendency,
      rank: rank,
      tendencyPct: pct || { none: true },
    };
  };
  sandbox.window.setProfileTerritorySkin = function (skin) {
    skinCalls.push(skin);
  };
  sandbox.window.ScProfileModal = {
    getUserId: function () {
      return 'user-a';
    },
  };
  sandbox.window.renderProfileFrameInModal = function (id) {
    profileRenders.push(id);
  };

  vm.runInNewContext(read('public/sensitive-consent-withdraw-ui.js'), sandbox, {
    filename: 'sensitive-consent-withdraw-ui.js',
  });

  return {
    sandbox: sandbox,
    nodes: nodes,
    calls: calls,
    dockCalls: dockCalls,
    skinCalls: skinCalls,
    profileRenders: profileRenders,
    alignmentMap: alignmentMap,
    store: store,
    setFetch: function (fn) {
      fetchImpl = fn;
    },
  };
}

function jsonResponse(status, body) {
  return {
    status: status,
    json: function () {
      return Promise.resolve(body);
    },
  };
}

function flush() {
  return new Promise(function (resolve) {
    setImmediate(resolve);
  });
}

function clearedLegal() {
  return {
    ok: true,
    legal: {
      complete: false,
      ageConfirmed: true,
      sensitiveConsented: false,
      territoryDisclosureConsented: false,
      politicalProfileVisibility: 'private',
    },
  };
}

async function main() {
  const indexHtml = read('public/index.html');
  const uiJs = read('public/sensitive-consent-withdraw-ui.js');
  const withdrawJs = read('public/account-withdrawal-ui.js');
  const authJs = read('public/auth.js');
  const routes = read('server/legal-gate-routes.js');

  ok('화면 안내가 계정 유지와 성향 삭제를 말한다', indexHtml.indexOf('민감정보 동의 철회는 회원탈퇴가 아닙니다. 계정은 그대로 유지됩니다.') >= 0);
  ok('확인 체크 문구', indexHtml.indexOf('위 내용을 확인했으며 민감정보 동의를 철회합니다.') >= 0);
  var profileStart = indexHtml.indexOf('id="sc-profile-modal"');
  var profileEnd = indexHtml.indexOf('id="sc-withdraw-dialog"');
  var profileBlock = indexHtml.slice(profileStart, profileEnd);
  ok('프로필 본문에 동의 철회 없음', profileBlock.indexOf('동의 철회') < 0 && profileBlock.indexOf('sc-sensitive') < 0);
  ok('프로필 본문에 회원탈퇴 없음', profileBlock.indexOf('회원탈퇴') < 0 && profileBlock.indexOf('sc-profile-modal-withdraw') < 0);
  ok('설정 입구', indexHtml.indexOf('id="sc-map-tab-settings"') >= 0 && indexHtml.indexOf('개인정보 및 동의') >= 0);
  ok('계정 관리가 동의 구역과 분리', /개인정보 및 동의[\s\S]*계정 관리[\s\S]*id="sc-profile-modal-withdraw" class="sc-btn sc-btn--ghost"/.test(indexHtml));
  ok('상태 다음의 철회 버튼은 ghost', /id="sc-sensitive-consent-withdraw" class="sc-btn sc-btn--ghost"/.test(indexHtml));
  ok('철회 버튼은 danger가 아님', indexHtml.indexOf('sc-sensitive-consent-withdraw" class="sc-btn sc-btn--danger') < 0);
  ok('기존 회원탈퇴 대화상자 id 유지', indexHtml.indexOf('id="sc-withdraw-dialog"') >= 0);
  ok('기존 회원탈퇴 버튼 id 유지', indexHtml.indexOf('id="sc-profile-modal-withdraw"') >= 0);
  ok('회원탈퇴 안내 문구 유지', indexHtml.indexOf('회원탈퇴 안내') >= 0 && indexHtml.indexOf('위 내용을 확인했으며 회원탈퇴를 진행합니다.') >= 0);
  ok('UI는 기존 철회 API만 호출', uiJs.indexOf("'/api/me/legal/withdraw-sensitive-consent'") >= 0);
  ok('UI는 회원탈퇴 API를 호출하지 않는다', uiJs.indexOf('/api/me/withdraw') < 0);
  ok('UI는 로그아웃하지 않는다', uiJs.indexOf('logout') < 0);
  ok('auth.js 미수정 경로', /signInWithOAuth/.test(authJs) && authJs.indexOf('withdraw-sensitive-consent') < 0);
  ok('회원탈퇴 UI는 기존 엔드포인트', withdrawJs.indexOf("'/api/me/withdraw'") >= 0);
  ok('서버 라우트 유지', routes.indexOf("router.post('/me/legal/withdraw-sensitive-consent'") >= 0);

  const idle = bootUi({
    fetchImpl: function () {
      throw new Error('fetch should not run');
    },
  });
  idle.nodes['sc-map-tab-settings'].click();
  await flush();
  ok(
    '설정은 동의 상태만 읽는다',
    idle.calls.length === 1 &&
      idle.calls[0].url === '/api/me/legal/status' &&
      idle.nodes['sc-settings-panel'].hidden === false &&
      idle.nodes['sc-sensitive-withdraw-dialog'].hidden === true,
  );
  ok(
    '철회 전에 동의 상태가 보인다',
    idle.nodes['sc-sensitive-consent-status'].textContent.indexOf('정치 관련 정보 처리: 동의함') >= 0 &&
      idle.nodes['sc-sensitive-consent-status'].textContent.indexOf('소속 영토 공개: 동의함') >= 0,
  );
  idle.nodes['sc-sensitive-consent-withdraw'].click();
  ok('동의 철회는 확인 창만 연다', idle.nodes['sc-sensitive-withdraw-dialog'].hidden === false && idle.calls.length === 1);
  idle.nodes['sc-sensitive-withdraw-submit'].click();
  ok('체크 전 제출은 철회 API를 호출하지 않는다', idle.calls.length === 1 && idle.calls[0].url === '/api/me/legal/status' && idle.nodes['sc-sensitive-withdraw-submit'].disabled === true);
  await idle.sandbox.SensitiveConsentWithdrawUI.submit();
  ok('확인 없이 submit 해도 철회 API를 호출하지 않는다', idle.calls.length === 1 && idle.calls[0].url === '/api/me/legal/status');
  ok('회원탈퇴 대화상자는 열리지 않는다', idle.nodes['sc-withdraw-dialog'].hidden === true);
  ok('회원탈퇴 버튼 문구 유지', idle.nodes['sc-withdraw-submit'].textContent === '회원탈퇴');

  const success = bootUi({
    fetchImpl: function () {
      return jsonResponse(200, clearedLegal());
    },
  });
  success.sandbox.SensitiveConsentWithdrawUI.open();
  success.nodes['sc-sensitive-withdraw-ack'].checked = true;
  success.nodes['sc-sensitive-withdraw-ack']._listeners.change.forEach(function (fn) {
    fn();
  });
  ok('확인 후 제출 버튼이 켜진다', success.nodes['sc-sensitive-withdraw-submit'].disabled === false);
  success.nodes['sc-sensitive-withdraw-submit'].click();
  await new Promise(function (resolve) {
    setImmediate(resolve);
  });
  ok('성공 시 기존 엔드포인트 POST', success.calls.length === 1 && success.calls[0].url === '/api/me/legal/withdraw-sensitive-consent' && success.calls[0].req.method === 'POST');
  ok('성공 문구', success.nodes['sc-sensitive-withdraw-status'].hidden === false && success.nodes['sc-sensitive-withdraw-status'].textContent.indexOf('계정은 유지됩니다') >= 0);
  ok('성공 후 오류 숨김', success.nodes['sc-sensitive-withdraw-error'].hidden === true);
  ok('성공 후 재제출 불가', success.nodes['sc-sensitive-withdraw-submit'].disabled === true);
  const scores = JSON.parse(success.store.sc_political_scores_v1);
  const history = JSON.parse(success.store.sc_tendency_history_v2);
  ok('본인 성향 로컬 기록만 제거', !scores['user-a'] && scores['user-b'] && !history['user-a'] && history['user-b']);
  ok('영토 HUD를 중앙으로 비운다', success.dockCalls.length === 1 && success.dockCalls[0].territory === 'COMMON · 중앙광장' && success.dockCalls[0].pct == null);
  ok('프로필 스킨은 center', success.skinCalls[0] === 'center');
  ok('성향 지도 숨김', success.alignmentMap.hidden === true);
  ok('열린 프로필을 다시 그린다', success.profileRenders[0] === 'user-a');
  ok('성공 후에도 회원탈퇴 문구 유지', success.nodes['sc-profile-modal-withdraw'].textContent === '회원탈퇴' && success.nodes['sc-withdraw-dialog'].hidden === true);
  ok(
    '성공 후 설정 상태가 동의하지 않음',
    success.nodes['sc-sensitive-consent-status'].textContent.indexOf('정치 관련 정보 처리: 동의하지 않음') >= 0 &&
      success.nodes['sc-sensitive-consent-status'].textContent.indexOf('소속 영토 공개: 동의하지 않음') >= 0,
  );
  const beforeSecond = success.calls.length;
  success.nodes['sc-sensitive-withdraw-submit'].click();
  ok('성공 후 한 번 더 눌러도 재호출하지 않는다', success.calls.length === beforeSecond);

  const failure = bootUi({
    fetchImpl: function () {
      return jsonResponse(503, { ok: false, error: 'LEGAL_GATE_UNAVAILABLE' });
    },
  });
  failure.sandbox.SensitiveConsentWithdrawUI.open();
  failure.nodes['sc-sensitive-withdraw-ack'].checked = true;
  failure.nodes['sc-sensitive-withdraw-ack']._listeners.change.forEach(function (fn) {
    fn();
  });
  failure.nodes['sc-sensitive-withdraw-submit'].click();
  await new Promise(function (resolve) {
    setImmediate(resolve);
  });
  ok('실패 문구에 오류 코드', failure.nodes['sc-sensitive-withdraw-error'].textContent.indexOf('LEGAL_GATE_UNAVAILABLE') >= 0);
  ok('실패 시 성공 문구 없음', failure.nodes['sc-sensitive-withdraw-status'].hidden === true);
  ok('실패 시 성향 기록 유지', JSON.parse(failure.store.sc_political_scores_v1)['user-a']);
  ok('실패 시 영토 HUD 유지', failure.dockCalls.length === 0 && failure.sandbox.__scPlayer.territoryId === 'PROGRESSIVE');
  ok('실패 후 다시 제출 가능', failure.nodes['sc-sensitive-withdraw-submit'].disabled === false);
  ok('실패해도 회원탈퇴 버튼은 그대로', failure.nodes['sc-withdraw-submit'].textContent === '회원탈퇴');

  const network = bootUi({
    fetchImpl: function () {
      return Promise.reject(new Error('offline'));
    },
  });
  network.sandbox.SensitiveConsentWithdrawUI.open();
  network.nodes['sc-sensitive-withdraw-ack'].checked = true;
  await network.sandbox.SensitiveConsentWithdrawUI.submit();
  ok('네트워크 실패 안내', network.nodes['sc-sensitive-withdraw-error'].textContent.indexOf('다시 시도') >= 0);
  ok('네트워크 실패 시 계정 유지 표시를 성공으로 바꾸지 않는다', network.nodes['sc-sensitive-withdraw-status'].hidden === true);

  console.log('\nOK', passed);
}

main().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
