#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 사용자 공개 화면 1차 — mock DOM + mock fetch (jsdom 불필요)
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const apiMod = require('../public/daily-issue-public-api-client.js');
const uiMod = require('../public/daily-issue-public-ui.js');

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

function fakeEl(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    hidden: false,
    textContent: '',
    innerHTML: '',
    className: '',
    children: [],
    _attrs: {},
    _listeners: {},
    appendChild: function (c) {
      this.children.push(c);
      if (c && c.textContent) this.textContent += c.textContent;
      if (c && c.innerHTML) this.innerHTML += c.innerHTML;
      if (c && c.tagName === 'BUTTON' && c._attrs['data-issue-id']) {
        this._btn = c;
      }
      // flatten nested text for assertions
      function gather(n, acc) {
        if (!n) return;
        if (n.textContent) acc.push(n.textContent);
        (n.children || []).forEach(function (ch) {
          gather(ch, acc);
        });
      }
      const parts = [];
      gather(this, parts);
      this.textContent = parts.join(' ');
      return c;
    },
    setAttribute: function (k, v) {
      this._attrs[k] = String(v);
    },
    getAttribute: function (k) {
      return this._attrs[k] || null;
    },
    removeAttribute: function (k) {
      delete this._attrs[k];
    },
    addEventListener: function (type, fn) {
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push(fn);
    },
    click: function () {
      (this._listeners.click || []).forEach(function (fn) {
        fn({ preventDefault: function () {} });
      });
    },
    querySelector: function (sel) {
      if (sel.indexOf('data-issue-id') >= 0) return this._btn || null;
      return null;
    },
  };
  return node;
}

async function main() {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  ok('index loads public api script', html.indexOf('/daily-issue-public-api-client.js') >= 0);
  ok('index loads public ui script', html.indexOf('/daily-issue-public-ui.js') >= 0);
  ok('index keeps centrist hub', html.indexOf('id="centrist-hub-wrap"') >= 0);
  ok('index keeps map screen-main', html.indexOf('id="screen-main"') >= 0);
  ok('index wires ensureDailyPublicUi / refresh', html.indexOf('ensureDailyPublicUi') >= 0 && html.indexOf('pubUi.refresh') >= 0);
  ok('no admin link in user html', !/href=["']\/admin\/daily-issues/.test(html));
  ok('admin files untouched path exists', fs.existsSync(path.join(root, 'public/admin/daily-issues/index.html')));

  const sampleItem = {
    id: 'pub_1',
    title: '테스트 이슈',
    confirmedSummary: '확인된 요약',
    claims: [
      { id: 'c1', text: '핵심 사실 A', classification: 'CONFIRMED_FACT', isCore: true },
      { id: 'c2', text: '확인 중 B', classification: 'UNVERIFIED', isCore: false },
    ],
    sourceRefs: [{ publisher: '연합뉴스', title: '기사', url: 'https://example.com/a' }],
    publishedAt: '2026-08-06T01:00:00.000Z',
    publishExpiresAt: '2026-08-08T01:00:00.000Z',
    discussionPrompt: '어떻게 생각하나요?',
  };

  const calls = [];
  global.fetch = async function (url) {
    calls.push(String(url));
    if (String(url).indexOf('/api/daily-issues/pub_1') >= 0) {
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify({ ok: true, data: { item: sampleItem } });
        },
      };
    }
    if (String(url).indexOf('/api/daily-issues') >= 0) {
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify({ ok: true, data: { items: [sampleItem], total: 1, count: 1 } });
        },
      };
    }
    return {
      ok: false,
      status: 404,
      text: async function () {
        return '{}';
      },
    };
  };
  global.URLSearchParams = URLSearchParams;
  global.document = {
    createElement: function (tag) {
      return fakeEl(tag);
    },
  };

  const listData = await apiMod.listPublished({ limit: 5 });
  ok('api list returns item', listData.items && listData.items[0] && listData.items[0].id === 'pub_1');
  const detailData = await apiMod.getPublished('pub_1');
  ok('api detail returns item', detailData.item && detailData.item.title === '테스트 이슈');

  const panel = fakeEl('div');
  const tabs = fakeEl('div');
  const more = fakeEl('button');
  const bar = fakeEl('div');
  const ui = uiMod.create({
    api: apiMod,
    panel: panel,
    tabs: tabs,
    moreBtn: more,
    editionBar: bar,
  });

  ui.refresh();
  await new Promise(function (r) {
    setTimeout(r, 40);
  });
  ok('list shows title', panel.textContent.indexOf('테스트 이슈') >= 0);
  ok('tabs hidden', tabs.hidden === true);
  ok('more hidden', more.hidden === true);
  ok('list state has item', ui.getState().list && ui.getState().list[0] && ui.getState().list[0].id === 'pub_1');

  const callsBeforeDetail = calls.length;
  ui.openDetail('pub_1');
  ok('detail paints list payload immediately', panel.textContent.indexOf('테스트 이슈') >= 0);
  ok(
    'detail not blocked on fetch',
    ui.getState().loading === false && ui.getState().detail && ui.getState().detail.title === '테스트 이슈',
  );
  ok('guest cached detail skips extra fetch', calls.length === callsBeforeDetail);
  ok('immediate claim text from list', panel.textContent.indexOf('핵심 사실 A') >= 0);

  await new Promise(function (r) {
    setTimeout(r, 40);
  });
  ok('detail 핵심 사실', panel.textContent.indexOf('핵심 사실') >= 0);
  ok('detail claim text', panel.textContent.indexOf('핵심 사실 A') >= 0);
  ok('detail 확인 중', panel.textContent.indexOf('확인 중인 내용') >= 0);
  ok('detail source', panel.textContent.indexOf('연합뉴스') >= 0);
  ok('detail 게시/만료', panel.textContent.indexOf('게시') >= 0 && panel.textContent.indexOf('만료') >= 0);
  ok('no forbidden fields in detail text blob', !/rawText|reviewerId|choices|stance/.test(panel.textContent + panel.innerHTML));
  ok('detail view active', ui.getState().view === 'detail');

  global.ScAuth = {
    getAccessTokenSync: function () {
      return 'test-access-token';
    },
    getAccessToken: function () {
      return Promise.resolve('test-access-token');
    },
  };
  const callsBeforeHydrate = calls.length;
  ui.openDetail('pub_1');
  ok('logged-in still paints cached body first', panel.textContent.indexOf('테스트 이슈') >= 0);
  await new Promise(function (r) {
    setTimeout(r, 40);
  });
  ok(
    'logged-in hydrates viewerReaction via detail GET',
    calls.slice(callsBeforeHydrate).some(function (u) {
      return String(u).indexOf('/api/daily-issues/pub_1') >= 0;
    }),
  );
  delete global.ScAuth;

  // empty
  global.fetch = async function () {
    return {
      ok: true,
      status: 200,
      text: async function () {
        return JSON.stringify({ ok: true, data: { items: [], total: 0, count: 0 } });
      },
    };
  };
  const panel2 = fakeEl('div');
  const ui2 = uiMod.create({
    api: apiMod,
    panel: panel2,
    tabs: fakeEl('div'),
    moreBtn: fakeEl('button'),
    editionBar: fakeEl('div'),
  });
  ui2.refresh();
  await new Promise(function (r) {
    setTimeout(r, 40);
  });
  ok('empty copy', panel2.textContent.indexOf('현재 게시된 데일리 이슈가 없습니다') >= 0);

  // error
  global.fetch = async function () {
    return {
      ok: false,
      status: 503,
      text: async function () {
        return JSON.stringify({ ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'x' } });
      },
    };
  };
  const panel3 = fakeEl('div');
  const ui3 = uiMod.create({
    api: apiMod,
    panel: panel3,
    tabs: fakeEl('div'),
    moreBtn: fakeEl('button'),
    editionBar: fakeEl('div'),
  });
  ui3.refresh();
  await new Promise(function (r) {
    setTimeout(r, 40);
  });
  ok('error copy', panel3.textContent.indexOf('불러오지 못했습니다') >= 0);

  // serializer public fields check
  const ser = require('../server/daily-issue-api-serializers');
  const pub = ser.toPublicIssue(
    {
      id: 'x',
      status: 'PUBLISHED',
      title: 't',
      claims: [{ id: '1', text: 'a', classification: 'CONFIRMED_FACT' }],
      sourceRefs: [{ publisher: 'P', url: 'https://ex.com' }],
      publishedAt: '2026-08-06T00:00:00.000Z',
      publishExpiresAt: '2099-01-01T00:00:00.000Z',
      reviewerId: 'secret-reviewer',
      qualityMeta: { ok: true },
      freshnessMeta: { freshnessOk: true },
    },
    '2026-08-06T12:00:00.000Z',
  );
  ok('public serializer omits reviewerId', pub && pub.reviewerId === undefined);
  ok('public serializer omits choices', pub && pub.choices === undefined);
  ok('public has title/sources/times', !!(pub.title && pub.sourceRefs && pub.publishedAt && pub.publishExpiresAt));
  ok('expired filtered', ser.toPublicIssue({ id: 'y', status: 'PUBLISHED', publishExpiresAt: '2020-01-01T00:00:00.000Z' }, '2026-08-06T00:00:00.000Z') === null);
  ok('non-published filtered', ser.toPublicIssue({ id: 'z', status: 'READY_FOR_REVIEW' }, '2026-08-06T00:00:00.000Z') === null);

  console.log('\nPublic UI results:', passed, 'passed,', failed, 'failed');
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
