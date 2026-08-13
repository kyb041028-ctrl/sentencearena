#!/usr/bin/env node
'use strict';

/**
 * Naver → custom:naver wire (static). Does not call live Naver/Supabase authorize.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const authJs = fs.readFileSync(path.join(root, 'public/auth.js'), 'utf8');
const entryJs = fs.readFileSync(path.join(root, 'public/app-entry.js'), 'utf8');
const callbackHtml = fs.readFileSync(path.join(root, 'public/auth-v2/callback.html'), 'utf8');

assert(!/NAVER_NOT_READY/.test(authJs), 'no NAVER_NOT_READY');
assert(/custom:naver/.test(authJs), 'uses custom:naver');
assert(/CALLBACK_PATH = '\/auth-v2\/callback\.html'/.test(authJs), 'callback path');
assert(/provider: 'kakao'/.test(authJs), 'kakao provider literal kept');
assert(/kakao-resolve-authorize/.test(authJs), 'kakao resolve kept');
assert(!/provider === 'naver'/.test(entryJs), 'app-entry does not block naver click');
assert(/finishOAuthCallback/.test(callbackHtml), 'shared callback unchanged');

const calls = [];
const sandbox = {
  console,
  fetch: function () {
    return Promise.reject(new Error('fetch should not run in this unit'));
  },
  location: {
    origin: 'http://127.0.0.1:3000',
    assign: function () {},
  },
  supabase: {
    createClient: function () {
      return {
        auth: {
          onAuthStateChange: function () {},
          getSession: function () {
            return Promise.resolve({ data: { session: null }, error: null });
          },
          signInWithOAuth: function (opts) {
            calls.push(opts);
            return Promise.resolve({ data: { url: 'https://example.test/authorize' }, error: null });
          },
          signOut: function () {
            return Promise.resolve({});
          },
          exchangeCodeForSession: function () {
            return Promise.resolve({ data: { session: null }, error: null });
          },
        },
      };
    },
  },
};
sandbox.window = sandbox;
sandbox.global = sandbox;

vm.runInNewContext(authJs, sandbox);

sandbox.fetch = function (url) {
  if (String(url).indexOf('/api/supabase-config') !== -1) {
    return Promise.resolve({
      ok: true,
      json: function () {
        return Promise.resolve({
          ok: true,
          url: 'https://example.supabase.co',
          anonKey: 'anon-test',
        });
      },
    });
  }
  return origFetch.apply(this, arguments);
};

sandbox.ScAuth.login('naver')
  .then(function () {
    assert(calls.length === 1, 'one signInWithOAuth call');
    assert(calls[0].provider === 'custom:naver', 'provider=custom:naver');
    assert(
      calls[0].options &&
        calls[0].options.redirectTo === 'http://127.0.0.1:3000/auth-v2/callback.html',
      'redirectTo auth-v2 callback',
    );
    assert(!calls[0].options.skipBrowserRedirect, 'naver does not skip browser redirect');
    return sandbox.ScAuth.login('google');
  })
  .then(function () {
    assert(calls.length === 2, 'google call recorded');
    assert(calls[1].provider === 'google', 'google provider unchanged');
    assert(
      calls[1].options.redirectTo === 'http://127.0.0.1:3000/auth-v2/callback.html',
      'google redirectTo unchanged',
    );
    console.log('PASS naver oauth wire (custom:naver + shared callback)');
  })
  .catch(function (e) {
    console.error('FAIL', e && e.message ? e.message : e);
    process.exit(1);
  });
