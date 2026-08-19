#!/usr/bin/env node
'use strict';

/**
 * Account withdrawal — Guest/auth/ack/anonymize/audit PII/mapper/UI copy.
 * Does not call Production Auth delete.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const core = require('../shared/account-withdrawal-core');
const { createBoardDataMapper } = require('../server/board-data-mapper');
const commentCore = require('../shared/daily-issue-comment-core');
const { createAccountWithdrawalService } = require('../server/account-withdrawal-service');
const { createAccountWithdrawalRouter } = require('../server/account-withdrawal-routes');
const { requestApp } = require('./daily-issue-api-http-helper');

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

function createMockAdmin(opts) {
  const o = opts || {};
  const jobs = o.jobs || [];
  const audits = o.audits || [];
  o.rpcCalls = o.rpcCalls || [];
  o.deletedAuth = o.deletedAuth || [];
  const admin = {
    rpc: async function (name, args) {
      o.rpcCalls.push({ name: name, args: args });
      if (o.rpcError) return { data: null, error: { message: o.rpcError } };
      return {
        data: o.pack || {
          ok: true,
          anonymized_post_count: 2,
          anonymized_board_comment_count: 3,
          anonymized_daily_issue_comment_count: 1,
          anonymized_report_count: 1,
          deleted_record_counts: { profiles: 1, user_alignment_state: 1 },
        },
        error: null,
      };
    },
    auth: {
      admin: {
        deleteUser: async function (id) {
          o.deletedAuth.push(id);
          if (o.deleteAuthError) return { error: { message: o.deleteAuthError } };
          return { error: null };
        },
      },
    },
    from: function (table) {
      const state = { table: table, filters: {}, payload: null, op: 'select' };
      const api = {
        select: function () {
          return api;
        },
        insert: function (row) {
          state.op = 'insert';
          state.payload = row;
          return api;
        },
        update: function (row) {
          state.op = 'update';
          state.payload = row;
          return api;
        },
        eq: function (col, val) {
          state.filters[col] = val;
          return api;
        },
        maybeSingle: async function () {
          if (state.table === 'account_withdrawal_jobs') {
            if (state.op === 'insert') {
              const row = Object.assign(
                { id: 'job1', status: 'PENDING', last_audit_id: null },
                state.payload,
              );
              jobs.push(row);
              return { data: row, error: null };
            }
            if (state.op === 'update') {
              jobs.forEach(function (j) {
                if (j.user_id === state.filters.user_id || j.id === state.filters.id) {
                  Object.assign(j, state.payload);
                }
              });
              return { data: jobs[0] || { id: state.filters.id }, error: null };
            }
            const found =
              jobs.filter(function (j) {
                return j.user_id === state.filters.user_id;
              })[0] || null;
            return { data: found, error: null };
          }
          if (state.table === 'account_withdrawal_audit') {
            if (state.op === 'insert') {
              ok(
                'audit insert has no forbidden PII keys',
                !core.containsForbiddenAuditKeys(state.payload),
              );
              const row = Object.assign({ id: 'audit1' }, state.payload);
              audits.push(row);
              return { data: { id: row.id }, error: null };
            }
            if (state.op === 'update') {
              audits.forEach(function (a) {
                if (a.id === state.filters.id) Object.assign(a, state.payload);
              });
              return { data: { id: state.filters.id }, error: null };
            }
            const found =
              audits.filter(function (a) {
                return a.id === state.filters.id;
              })[0] || null;
            return { data: found, error: null };
          }
          return { data: null, error: null };
        },
        then: function (onF, onR) {
          return api.maybeSingle().then(onF, onR);
        },
      };
      return api;
    },
  };
  return { admin: admin, opts: o, jobs: jobs, audits: audits };
}

async function main() {
  console.log('\n=== account withdrawal ===\n');

  ok('policy version withdrawal-v1', core.POLICY_VERSION === 'withdrawal-v1');
  ok('display 탈퇴한 사용자', core.WITHDRAWN_DISPLAY_NAME === '탈퇴한 사용자');
  ok('ack false', core.parseWithdrawBody({ acknowledged: false, policyVersion: 'withdrawal-v1' }).status === 400);
  ok(
    'policy mismatch 409',
    core.parseWithdrawBody({ acknowledged: true, policyVersion: 'withdrawal-v0' }).status === 409,
  );
  ok(
    'body userId rejected',
    core.parseWithdrawBody({
      acknowledged: true,
      policyVersion: 'withdrawal-v1',
      userId: 'other',
    }).error === 'WITHDRAW_USER_ID_NOT_ALLOWED',
  );
  ok(
    'valid body',
    core.parseWithdrawBody({ acknowledged: true, policyVersion: 'withdrawal-v1' }).ok === true,
  );

  const mapper = createBoardDataMapper();
  const withdrawnPost = mapper.mapPostForViewer(
    {
      id: 'p1',
      authorUserId: null,
      territory: 'CENTRAL',
      title: 'kept',
      content: 'body-kept',
      status: 'ACTIVE',
      createdAt: '2026-08-19T00:00:00.000Z',
      earthPositiveCount: 4,
    },
    'viewer-1',
  );
  ok('mapper post body kept', withdrawnPost.content === 'body-kept' && withdrawnPost.title === 'kept');
  ok(
    'mapper post author withdrawn + no userId',
    withdrawnPost.author.displayName === '탈퇴한 사용자' && withdrawnPost.author.userId === null,
  );
  ok('mapper snapshot counts kept', withdrawnPost.counts.earthPositive === 4);

  const anonPost = mapper.mapPostForViewer(
    {
      id: 'p2',
      authorUserId: 'u-live',
      isAnonymous: true,
      territory: 'CENTRAL',
      title: 'anon',
      content: 'a',
      status: 'ACTIVE',
      createdAt: '2026-08-19T00:00:00.000Z',
    },
    'other',
  );
  ok('anonymous still 익명 when author id remains', anonPost.author.displayName === '익명' && anonPost.author.userId === null);

  const withdrawnComment = mapper.mapCommentForViewer(
    {
      id: 'c1',
      postId: 'p1',
      authorUserId: null,
      content: 'comment-kept',
      status: 'ACTIVE',
      createdAt: '2026-08-19T00:00:00.000Z',
    },
    'viewer-1',
  );
  ok(
    'mapper comment withdrawn',
    withdrawnComment.content === 'comment-kept' &&
      withdrawnComment.author.displayName === '탈퇴한 사용자' &&
      withdrawnComment.author.userId === null,
  );

  const di = commentCore.toPublicComment(
    { id: 'd1', user_id: null, body: 'di-kept', created_at: '2026-08-19T00:00:00.000Z' },
    'viewer-1',
    'OldName',
  );
  ok(
    'daily issue comment withdrawn',
    di.body === 'di-kept' && di.author.displayName === '탈퇴한 사용자' && di.author.userId === null,
  );

  const mock = createMockAdmin();
  const service = createAccountWithdrawalService({
    getAdminClient: function () {
      return mock.admin;
    },
  });
  const result = await service.withdraw({
    userId: 'user-a',
    body: { acknowledged: true, policyVersion: 'withdrawal-v1' },
  });
  ok('service withdrawn', result.withdrawn === true && result.authDeleted === true);
  ok('rpc before auth delete', mock.opts.rpcCalls.length === 1 && mock.opts.deletedAuth[0] === 'user-a');
  ok('audit completed', mock.audits[0] && mock.audits[0].result === 'COMPLETED' && mock.audits[0].auth_deleted === true);
  ok('audit has no user_id field', mock.audits[0].user_id == null && mock.audits[0].email == null);
  ok(
    'audit json no PII keys',
    !core.containsForbiddenAuditKeys(mock.audits[0]) && !/"user_id"/.test(JSON.stringify(mock.audits[0])),
  );

  const retryMock = createMockAdmin({
    jobs: [{ id: 'job1', user_id: 'user-a', status: 'ANONYMIZED', last_audit_id: 'audit1' }],
    audits: [
      {
        id: 'audit1',
        anonymized_post_count: 2,
        anonymized_board_comment_count: 3,
        anonymized_daily_issue_comment_count: 1,
        anonymized_report_count: 1,
        result: 'ANONYMIZED',
        auth_deleted: false,
      },
    ],
  });
  const retryService = createAccountWithdrawalService({
    getAdminClient: function () {
      return retryMock.admin;
    },
  });
  await retryService.withdraw({
    userId: 'user-a',
    body: { acknowledged: true, policyVersion: 'withdrawal-v1' },
  });
  ok('retry does not re-anonymize', retryMock.opts.rpcCalls.length === 0);
  ok('retry still deletes auth once', retryMock.opts.deletedAuth.length === 1);
  ok('retry does not insert second audit', retryMock.audits.length === 1);

  const failAuth = createMockAdmin({ deleteAuthError: 'auth boom' });
  const failService = createAccountWithdrawalService({
    getAdminClient: function () {
      return failAuth.admin;
    },
  });
  let authFailCode = '';
  try {
    await failService.withdraw({
      userId: 'user-a',
      body: { acknowledged: true, policyVersion: 'withdrawal-v1' },
    });
  } catch (e) {
    authFailCode = e.code;
  }
  ok('auth delete failure surfaces', authFailCode === 'WITHDRAW_AUTH_DELETE_FAILED');
  ok(
    'auth fail audit marked',
    failAuth.audits[0] && failAuth.audits[0].result === 'AUTH_DELETE_FAILED',
  );

  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createAccountWithdrawalRouter({
      resolveActor: async function (req) {
        if (req.headers['x-test-user']) return { userId: req.headers['x-test-user'] };
        return null;
      },
      service: createAccountWithdrawalService({
        getAdminClient: function () {
          return createMockAdmin().admin;
        },
      }),
    }),
  );

  const guest = await requestApp(app, 'POST', '/api/me/withdraw', {
    body: { acknowledged: true, policyVersion: 'withdrawal-v1' },
  });
  ok('A. Guest 401', guest.status === 401);

  const noAck = await requestApp(app, 'POST', '/api/me/withdraw', {
    headers: { 'x-test-user': 'user-a' },
    body: { acknowledged: false, policyVersion: 'withdrawal-v1' },
  });
  ok('B. ack false 400', noAck.status === 400 && noAck.body.error === 'WITHDRAW_ACK_REQUIRED');

  const spoof = await requestApp(app, 'POST', '/api/me/withdraw', {
    headers: { 'x-test-user': 'user-a' },
    body: { acknowledged: true, policyVersion: 'withdrawal-v1', userId: 'user-b' },
  });
  ok('D. client userId spoof 400', spoof.status === 400 && spoof.body.error === 'WITHDRAW_USER_ID_NOT_ALLOWED');

  const mismatch = await requestApp(app, 'POST', '/api/me/withdraw', {
    headers: { 'x-test-user': 'user-a' },
    body: { acknowledged: true, policyVersion: 'nope' },
  });
  ok('policyVersion mismatch 409', mismatch.status === 409);

  const okWithdraw = await requestApp(app, 'POST', '/api/me/withdraw', {
    headers: { 'x-test-user': 'user-a' },
    body: { acknowledged: true, policyVersion: 'withdrawal-v1' },
  });
  ok('C. logged-in withdraw 200', okWithdraw.status === 200 && okWithdraw.body.ok === true);
  ok('C. response has no user id', !core.containsForbiddenAuditKeys(okWithdraw.body));

  const sql = read('supabase/migration_account_withdrawal_v1.sql');
  ok('sql no DROP TABLE/TRUNCATE', !/^\s*(DROP TABLE|TRUNCATE)\b/im.test(sql.replace(/\/\*[\s\S]*?\*\//g, '\n')));
  ok('sql SET NULL authors', /ON DELETE SET NULL/.test(sql) && /ALTER COLUMN author_user_id DROP NOT NULL/.test(sql));
  ok('sql no snapshot count decrement', !/earth_positive_count\s*=/.test(sql));
  const auditCreate = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.account_withdrawal_audit'));
  const auditBlock = auditCreate.slice(0, auditCreate.indexOf('COMMENT ON TABLE public.account_withdrawal_audit'));
  ok('sql audit has no user_id column', !/\buser_id\b/.test(auditBlock));
  ok('fn withdraw_account_anonymize', /withdraw_account_anonymize/.test(sql));

  const diSql = read('supabase/migration_daily_issue_account_withdrawal_v1.sql');
  ok('di sql comments nullable', /ALTER COLUMN user_id DROP NOT NULL/.test(diSql));
  ok('di sql no content delete', !/^\s*DELETE FROM\b/im.test(diSql));

  const indexHtml = read('public/index.html');
  ok('UI 회원탈퇴 안내', indexHtml.indexOf('회원탈퇴 안내') >= 0);
  ok('UI checkbox copy', indexHtml.indexOf('위 내용을 확인했으며 회원탈퇴를 진행합니다.') >= 0);
  ok('UI 탈퇴한 사용자 fallback', /탈퇴한 사용자/.test(indexHtml));
  ok('openScProfileModal empty id guard', /탈퇴한 사용자입니다/.test(indexHtml));
  ok('auth.js not loaded as withdrawal rewrite', /src="\/auth\.js"/.test(indexHtml));

  const authJs = read('public/auth.js');
  const uiJs = read('public/account-withdrawal-ui.js');
  ok('UI calls ScAuth.logout without editing auth.js login', /ScAuth\.logout/.test(uiJs));
  ok('UI does not localStorage.clear', !/localStorage\.clear\(/.test(uiJs));
  ok('auth.js still PKCE', /flowType:\s*'pkce'/.test(authJs) && /signInWithOAuth/.test(authJs));

  const serverJs = read('server.js');
  ok('server mounts /api/me/withdraw', /createAccountWithdrawalRouter/.test(serverJs));
  ok('server does not add cookie auth', !/res\.cookie\(/.test(serverJs));

  console.log('\nOK', passed);
}

main().catch(function (e) {
  console.error('FAIL', e && e.message ? e.message : e);
  process.exit(1);
});
