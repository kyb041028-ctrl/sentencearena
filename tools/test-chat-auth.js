#!/usr/bin/env node
'use strict';

/**
 * POST /api/chat/messages — 로그인 회원만 write. Guest/미인증 401.
 * server.js 는 listen 하므로 require 하지 않는다.
 * node tools/test-chat-auth.js
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { requireAuthenticatedUser } = require('../server/auth/require-authenticated-user');
const { resolveSupabaseServerAuthConfig } = require('../server/supabase-server-auth-config');
const { requestApp } = require('./daily-issue-api-http-helper');

const root = path.join(__dirname, '..');
let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    console.log('  PASS: ' + label);
    pass += 1;
  } else {
    console.log('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    fail += 1;
  }
}

function section(title) {
  console.log('\n[' + title + ']');
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function sliceBetween(src, start, end) {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  if (i < 0 || j < 0) return '';
  return src.slice(i, j);
}

function createChatWriteProbe() {
  const cfg = resolveSupabaseServerAuthConfig();
  const writes = [];
  const app = express();
  app.use(express.json());
  app.post('/api/chat/messages', async function (req, res) {
    const auth = await requireAuthenticatedUser(req, res, {
      url: cfg.url,
      key: cfg.key,
    });
    if (!auth.ok) {
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }
    const userId = String((auth.user && (auth.user.email || auth.user.id)) || '').trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }
    writes.push({
      userId: userId,
      guestUserId: req.body && req.body.guestUserId,
      text: req.body && req.body.text,
    });
    return res.json({ ok: true, message: { userId: userId } });
  });
  return { app: app, writes: writes, cfg: cfg };
}

async function main() {
  section('소스 가드');
  const serverJs = read('server.js');
  const indexHtml = read('public/index.html');
  const getSlice = sliceBetween(
    serverJs,
    "app.get('/api/chat/messages'",
    "app.post('/api/chat/messages'",
  );
  const postSlice = sliceBetween(
    serverJs,
    "app.post('/api/chat/messages'",
    'app.get(\'/health\'',
  );

  ok('POST /api/chat/messages 존재', postSlice.indexOf("app.post('/api/chat/messages'") === 0);
  ok(
    'POST는 requireAuthenticatedUser 재사용',
    /requireAuthenticatedUser\(req, res, \{/.test(postSlice) &&
      /url: supabaseUrl/.test(postSlice) &&
      /key: supabaseAnonKey/.test(postSlice),
  );
  ok('POST Guest fallback 제거', postSlice.indexOf("guestUserId || 'guest'") < 0);
  ok('POST body guestUserId 미사용', !/req\.body\?\.guestUserId/.test(postSlice));
  ok('POST chatResolveUserId 미사용', postSlice.indexOf('chatResolveUserId') < 0);
  ok('server.js 에 chatResolveUserId 없음', serverJs.indexOf('chatResolveUserId') < 0);
  ok(
    '회원 userId = email || id',
    /auth\.user\.email \|\| auth\.user\.id/.test(postSlice) && /arr\.push\(msg\)/.test(postSlice),
  );
  ok('!auth.ok 이면 status 반환', /res\.status\(auth\.status\)/.test(postSlice));
  ok(
    'GET 읽기 정책 유지(인증 없음)',
    getSlice.indexOf('requireAuthenticatedUser') < 0 &&
      getSlice.indexOf("app.get('/api/chat/messages'") === 0,
  );
  ok(
    'Guest UI 채팅 전송 차단 유지',
    /form\.addEventListener\('submit', async function \(ev\) \{\s*ev\.preventDefault\(\);\s*if \(typeof window\.__scRequireLoggedInMember === 'function' && !window\.__scRequireLoggedInMember\(\)\) \{\s*return;/.test(
      indexHtml,
    ),
  );

  section('requireAuthenticatedUser');
  const noToken = await requireAuthenticatedUser(
    { headers: {} },
    {},
    { url: 'https://example.supabase.co', key: 'anon' },
  );
  ok('무토큰 → 401', noToken.ok === false && noToken.status === 401 && noToken.error === 'UNAUTHORIZED');

  const noBearer = await requireAuthenticatedUser(
    { headers: { authorization: 'Basic abc' } },
    {},
    { url: 'https://example.supabase.co', key: 'anon' },
  );
  ok('Bearer 아님 → 401', noBearer.ok === false && noBearer.status === 401);

  section('HTTP POST 프로브 (동일 canonical helper)');
  const probe = createChatWriteProbe();
  const guestBody = {
    room: 'global',
    text: 'guest bypass',
    guestUserId: 'guest',
  };

  const unauth = await requestApp(probe.app, 'POST', '/api/chat/messages', { body: guestBody });
  ok(
    '무토큰 POST → 401, write 없음',
    unauth.status === 401 &&
      unauth.body &&
      unauth.body.error === 'UNAUTHORIZED' &&
      probe.writes.length === 0,
    'status=' + unauth.status,
  );

  const badTok = await requestApp(probe.app, 'POST', '/api/chat/messages', {
    headers: { Authorization: 'Bearer not-a-valid-jwt' },
    body: guestBody,
  });
  const badOk =
    (probe.cfg.configured && badTok.status === 401 && badTok.body && badTok.body.error === 'UNAUTHORIZED') ||
    (!probe.cfg.configured && badTok.status === 503 && badTok.body && badTok.body.error === 'SUPABASE_NOT_CONFIGURED');
  ok(
    probe.cfg.configured ? '잘못된 토큰 → 401, write 없음' : '잘못된 토큰 + 미설정 → 503, write 없음',
    badOk && probe.writes.length === 0,
    'status=' + badTok.status + ' error=' + (badTok.body && badTok.body.error),
  );

  ok('Guest 상태 서버 write 불가 (프로브 store 비어 있음)', probe.writes.length === 0);
  ok(
    '정상 회원 경로: auth.ok 후 email||id 로 push (소스)',
    /if \(!auth\.ok\)/.test(postSlice) &&
      /auth\.user\.email \|\| auth\.user\.id/.test(postSlice) &&
      /arr\.push\(msg\)/.test(postSlice),
  );

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
  console.log('PASS chat auth');
}

main().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
