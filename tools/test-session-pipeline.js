#!/usr/bin/env node
'use strict';

/**
 * Unified post-auth session pipeline tests (provider-agnostic)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const ActivityNameCore = require('../shared/activity-name-core');
const SessionBootstrapCore = require('../shared/session-bootstrap-core');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(method, urlPath) {
  return new Promise(function (resolve, reject) {
    const req = http.request(
      {
        hostname: 'localhost',
        port: Number(process.env.PORT) || 3000,
        path: urlPath,
        method: method || 'GET',
      },
      function (res) {
        let d = '';
        res.on('data', function (c) {
          d += c;
        });
        res.on('end', function () {
          let j = null;
          try {
            j = JSON.parse(d);
          } catch (_) {}
          resolve({ status: res.statusCode, body: d, json: j });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const S = SessionBootstrapCore.STATES;
const root = path.join(__dirname, '..');

// --- pure state machine ---
assert(
  SessionBootstrapCore.resolveSessionState({ authenticated: false }, ActivityNameCore).state ===
    S.UNAUTHENTICATED,
  'CASE1 unauth',
);
assert(
  SessionBootstrapCore.resolveSessionState(
    {
      authenticated: true,
      user: { id: 'g1' },
      profile: { display_name: '푸른개척자' },
    },
    ActivityNameCore,
  ).state === S.READY,
  'CASE2 google ready',
);
assert(
  SessionBootstrapCore.resolveSessionState(
    {
      authenticated: true,
      user: { id: 'g2', email: 'a@b.c' },
      profile: { display_name: '' },
    },
    ActivityNameCore,
  ).state === S.PROFILE_INCOMPLETE,
  'CASE3 google incomplete',
);
assert(
  SessionBootstrapCore.resolveSessionState(
    {
      authenticated: true,
      user: { id: 'k1', email: null },
      profile: { display_name: '' },
    },
    ActivityNameCore,
  ).state === S.PROFILE_INCOMPLETE,
  'CASE4 kakao incomplete email null',
);
assert(
  SessionBootstrapCore.resolveSessionState(
    {
      authenticated: true,
      user: { id: 'k2', email: null },
      profile: { display_name: '새벽논객' },
    },
    ActivityNameCore,
  ).state === S.READY,
  'CASE5 kakao ready email null',
);
assert(
  SessionBootstrapCore.resolveSessionState(
    { authenticated: true, user: { id: 'x' }, profileQueryFailed: true },
    ActivityNameCore,
  ).state === S.ERROR,
  'CASE6 profile 500 → ERROR',
);
assert(
  SessionBootstrapCore.resolveSessionState({ transportError: true }, ActivityNameCore).state ===
    S.ERROR,
  'CASE7 timeout/transport → ERROR',
);
assert(
  SessionBootstrapCore.resolveSessionState({ guest: true, authenticated: false }, ActivityNameCore)
    .state === S.GUEST,
  'CASE8 guest',
);

// email must not drive state
assert(
  SessionBootstrapCore.resolveSessionState(
    {
      authenticated: true,
      user: { id: 'n1' },
      profile: { display_name: '' },
    },
    ActivityNameCore,
  ).state === S.PROFILE_INCOMPLETE,
  'Naver-ready incomplete without email',
);

// --- static structure ---
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const controllerSrc = fs.readFileSync(path.join(root, 'public', 'session-controller.js'), 'utf8');
const bootstrapSrc = fs.readFileSync(path.join(root, 'public', 'app-bootstrap.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert(indexSrc.includes('session-controller.js'), 'index loads session-controller');
assert(indexSrc.includes('session-bootstrap-core.js'), 'index loads session core');
assert(!/href="\/api\/auth\/oauth\/apple"/.test(indexSrc), 'Apple login UI removed');
assert(/href="\/api\/auth\/oauth\/google"/.test(indexSrc), 'Google kept');
assert(/href="\/api\/auth\/oauth\/kakao"/.test(indexSrc), 'Kakao kept');
assert(/href="\/api\/auth\/oauth\/naver"/.test(indexSrc), 'Naver kept');
assert(/id="view-login"[^>]*\bhidden\b/.test(indexSrc), 'login starts hidden (no flash)');
assert(controllerSrc.includes('/api/session/bootstrap'), 'controller uses bootstrap API');
assert(controllerSrc.includes('BOOTSTRAP_TIMEOUT_MS'), 'timeout present');
assert(!controllerSrc.includes('setInterval'), 'no polling');
assert(!controllerSrc.includes('MutationObserver'), 'no mutation observer');
assert(!controllerSrc.includes('sc:auth-ready'), 'no auth-ready handshake');
assert(!/provider\s*===\s*['\"]kakao['\"]/i.test(controllerSrc), 'no kakao branch');
assert(!/provider\s*===\s*['\"]google['\"]/i.test(controllerSrc), 'no google branch');
assert(serverSrc.includes('createSessionBootstrapRouter'), 'bootstrap router mounted');
assert(bootstrapSrc.includes('ScSessionController'), 'app-bootstrap delegates to controller');

// provider oauth lock: kakao scopes file unchanged usage
assert(serverSrc.includes('resolveKakaoOAuthRedirect'), 'kakao oauth path unchanged');
assert(serverSrc.includes("app.get('/api/auth/oauth/:provider'"), 'oauth route unchanged');

function makeDom() {
  const nodes = {};
  function make(id, hidden) {
    nodes[id] = {
      id: id,
      hidden: !!hidden,
      textContent: '',
      classList: { add() {}, remove() {}, toggle() {} },
      style: {},
      dataset: {},
      setAttribute() {},
      querySelector() {
        return null;
      },
      addEventListener() {},
    };
    return nodes[id];
  }
  make('view-login', true);
  make('view-app', true);
  make('sc-activity-name-onboarding', true);
  make('sc-session-boot', true);
  make('sc-session-error', true);
  make('app-user-status', false);
  make('auth-guest-btn', false);
  return {
    nodes: nodes,
    body: { classList: { add() {}, remove() {} }, setAttribute() {} },
    documentElement: { setAttribute() {} },
    getElementById(id) {
      return nodes[id] || null;
    },
    createElement(tag) {
      const n = {
        id: '',
        hidden: true,
        innerHTML: '',
        dataset: {},
        setAttribute() {},
        querySelector(sel) {
          if (sel === '#sc-session-error-retry') {
            return { dataset: {}, addEventListener() {} };
          }
          return null;
        },
        addEventListener() {},
      };
      return n;
    },
    appendChild(n) {
      if (n && n.id) nodes[n.id] = n;
    },
  };
}

function runController(bootstrapJson, guest) {
  return new Promise(function (resolve) {
    const doc = makeDom();
    const mem = guest ? { sc_sb_guest_ok: '1' } : {};
    let onboardCb = null;
    const sandbox = {
      document: Object.assign(doc, {
        readyState: 'complete',
        addEventListener() {},
        body: doc.body,
        documentElement: doc.documentElement,
      }),
      sessionStorage: {
        getItem(k) {
          return mem[k] || null;
        },
        setItem(k, v) {
          mem[k] = String(v);
        },
        removeItem(k) {
          delete mem[k];
        },
      },
      history: { replaceState() {} },
      location: { search: '', pathname: '/', hash: '' },
      URLSearchParams: global.URLSearchParams,
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
      AbortController: global.AbortController,
      addEventListener() {},
      console: global.console,
      SessionBootstrapCore: SessionBootstrapCore,
      ActivityNameCore: ActivityNameCore,
      ScActivityNameOnboarding: {
        show(cb) {
          onboardCb = cb;
          doc.nodes['sc-activity-name-onboarding'].hidden = false;
        },
        hide() {
          doc.nodes['sc-activity-name-onboarding'].hidden = true;
        },
      },
      fetch() {
        return Promise.resolve({
          status: 200,
          json: async () => bootstrapJson,
        });
      },
      startSentenceArenaCore() {
        doc.nodes['view-app'].hidden = false;
        doc.body.classList.add('sc-app-mode');
      },
      __scEnterGuestApp() {
        doc.nodes['view-app'].hidden = false;
      },
      __scApp: {
        showLoginOnly() {
          doc.nodes['view-login'].hidden = false;
          doc.nodes['view-app'].hidden = true;
        },
        enterAppMain() {
          doc.nodes['view-app'].hidden = false;
        },
      },
      ScAuthV2: { wireLoginButtons() {} },
      CustomEvent: global.CustomEvent || function () {},
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    vm.runInNewContext(controllerSrc + '\nScSessionController.start();', sandbox);
    setTimeout(function () {
      resolve({
        state: sandbox.ScSessionController.getState(),
        login: !doc.nodes['view-login'].hidden,
        app: !doc.nodes['view-app'].hidden,
        onboard: !doc.nodes['sc-activity-name-onboarding'].hidden,
        boot: doc.nodes['sc-session-boot'] ? !doc.nodes['sc-session-boot'].hidden : false,
        error: doc.nodes['sc-session-error'] ? !doc.nodes['sc-session-error'].hidden : false,
        onboardCb: onboardCb,
        sandbox: sandbox,
        doc: doc,
      });
    }, 40);
  });
}

function assertExclusive(vis, expected) {
  const keys = ['login', 'app', 'onboard', 'boot', 'error'];
  keys.forEach(function (k) {
    const want = expected[k] === true;
    assert(!!vis[k] === want, 'visibility ' + k + ' want=' + want + ' got=' + !!vis[k]);
  });
}

(async function () {
  {
    const v = await runController({ ok: true, state: 'UNAUTHENTICATED', user: null, profile: null });
    assert(v.state === 'UNAUTHENTICATED', 'DOM unauth state');
    assertExclusive(v, { login: true, app: false, onboard: false, boot: false, error: false });
  }
  {
    const v = await runController({
      ok: true,
      state: 'PROFILE_INCOMPLETE',
      user: { id: 'k1' },
      profile: { display_name: '' },
    });
    assert(v.state === 'PROFILE_INCOMPLETE', 'DOM incomplete');
    assertExclusive(v, { login: false, app: false, onboard: true, boot: false, error: false });
    // CASE9 save → READY
    v.onboardCb({ id: 'k1', display_name: '푸른개척자' });
    await new Promise(function (r) {
      setTimeout(r, 20);
    });
    assert(v.sandbox.ScSessionController.getState() === 'READY', 'CASE9 after save READY');
    assert(v.doc.nodes['view-app'].hidden === false, 'CASE9 app visible');
    assert(v.doc.nodes['sc-activity-name-onboarding'].hidden === true, 'CASE9 onboard hidden');
    assert(v.doc.nodes['view-login'].hidden === true, 'CASE9 login hidden');
  }
  {
    const v = await runController({
      ok: true,
      state: 'READY',
      user: { id: 'g1', email: 'a@b.c' },
      profile: { display_name: 'Sentence99' },
    });
    assert(v.state === 'READY', 'DOM ready');
    assertExclusive(v, { login: false, app: true, onboard: false, boot: false, error: false });
  }
  {
    const v = await runController({ ok: false, state: 'ERROR', error: 'PROFILE_QUERY_FAILED' });
    assert(v.state === 'ERROR', 'DOM error');
    assertExclusive(v, { login: false, app: false, onboard: false, boot: false, error: true });
  }
  {
    const v = await runController({ ok: true, state: 'UNAUTHENTICATED' }, true);
    assert(v.state === 'GUEST', 'guest flag → GUEST');
    assert(v.app === true && v.login === false, 'guest app visible');
  }

  const live = await request('GET', '/api/session/bootstrap');
  assert(live.status === 200, 'bootstrap endpoint live');
  assert(live.json && live.json.state, 'bootstrap returns state');
  assert(
    live.json.state === 'UNAUTHENTICATED' || live.json.state === 'ERROR' || live.json.state === 'READY' || live.json.state === 'PROFILE_INCOMPLETE',
    'bootstrap logical state',
  );

  const idx = await request('GET', '/');
  assert(idx.status === 200, 'index 200');
  assert(idx.body.includes('session-controller.js'), 'index has controller');
  assert(!idx.body.includes('oauth/apple'), 'no apple in served index');

  console.log('PASS session pipeline + DOM exclusivity');
})().catch(function (e) {
  console.error('FAIL', e.message);
  process.exit(1);
});
