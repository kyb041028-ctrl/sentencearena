#!/usr/bin/env node
'use strict';

/**
 * 관리자 API 인증 실패 HTTP 상태: 401 / 403 통일 (500 오인 방지)
 */

const express = require('express');
const {
  createAdminAccessGuard,
  resolveAdminAuthHttpStatus,
  sendAdminAuthFailure,
} = require('../server/daily-issue-admin-auth');
const { mountAdminRoutes } = require('../server/alien-moderation-routes');
const { mountRightsInfringementAdminRoutes } = require('../server/rights-infringement-routes');
const { mountRetentionAdminRoutes } = require('../server/retention-admin-routes');

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

function makeGetUser(map) {
  return async function (token) {
    if (Object.prototype.hasOwnProperty.call(map, token)) return map[token];
    return null;
  };
}

function buildApp(mountPath, routerFactory) {
  const getUserFromAccessToken = makeGetUser({
    'tok-admin': { id: 'admin-1', email: 'a@example.com', app_metadata: { role: 'ADMIN' }, user_metadata: {} },
    'tok-owner': { id: 'owner-1', email: 'o@example.com', app_metadata: { role: 'OWNER' }, user_metadata: { role: 'MEMBER' } },
    'tok-member': { id: 'mem-1', email: 'm@example.com', app_metadata: {}, user_metadata: { role: 'ADMIN' } },
    'tok-member-role': { id: 'mem-2', app_metadata: { role: 'MEMBER' }, user_metadata: { role: 'ADMIN' } },
  });
  const adminAuth = {
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-test-key',
    getUserFromAccessToken: getUserFromAccessToken,
  };
  const app = express();
  app.use(express.json());
  app.use(mountPath, routerFactory(adminAuth));
  app.use(function (err, _req, res, _next) {
    console.error('[test-admin-http] unexpected', err && err.message);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  });
  return app;
}

async function assertAuthMatrix(label, app, path) {
  const noTok = await request(app, 'GET', path, {});
  ok(label + ' A no token → 401', noTok.status === 401 && noTok.body && noTok.body.error && noTok.body.error.code === 'ADMIN_TOKEN_MISSING', noTok.status);

  const bad = await request(app, 'GET', path, { Authorization: 'Bearer not-a-user' });
  ok(label + ' B invalid → 401', bad.status === 401 && bad.body.error.code === 'ADMIN_TOKEN_INVALID', bad.status);

  const member = await request(app, 'GET', path, { Authorization: 'Bearer tok-member' });
  ok(label + ' C member user_metadata ADMIN → 403', member.status === 403 && member.body.error.code === 'ADMIN_ROLE_MISSING', member.status);

  const memberRole = await request(app, 'GET', path, { Authorization: 'Bearer tok-member-role' });
  ok(label + ' D app MEMBER → 403', memberRole.status === 403 && memberRole.body.error.code === 'ADMIN_ROLE_FORBIDDEN', memberRole.status);

  return { noTok: noTok, member: member };
}

async function main() {
  console.log('\n=== admin HTTP auth status ===\n');

  ok('map missing → 401', resolveAdminAuthHttpStatus('ADMIN_TOKEN_MISSING') === 401);
  ok('map invalid → 401', resolveAdminAuthHttpStatus('ADMIN_TOKEN_INVALID') === 401);
  ok('map role missing → 403', resolveAdminAuthHttpStatus('ADMIN_ROLE_MISSING') === 403);
  ok('map role forbidden → 403', resolveAdminAuthHttpStatus('ADMIN_ROLE_FORBIDDEN') === 403);
  ok('map query token → 403', resolveAdminAuthHttpStatus('QUERY_TOKEN_FORBIDDEN') === 403);
  ok('map unknown → null', resolveAdminAuthHttpStatus('DB_DOWN') === null);

  const fakeRes = {
    headersSent: false,
    statusCode: 0,
    body: null,
    locals: { requestId: 'req_test' },
    status: function (s) {
      this.statusCode = s;
      return this;
    },
    json: function (b) {
      this.body = b;
      this.headersSent = true;
      return this;
    },
  };
  ok('sendAdminAuthFailure 401', sendAdminAuthFailure(fakeRes, 'ADMIN_TOKEN_MISSING') === true && fakeRes.statusCode === 401);
  ok('sendAdminAuthFailure ignores unknown', sendAdminAuthFailure({ headersSent: false, status: function () { return this; }, json: function () {} }, 'DB_DOWN') === false);

  const modApp = buildApp('/api/admin/moderation', function (adminAuth) {
    return mountAdminRoutes({
      adminAuth: adminAuth,
      getBoardService: function () {
        return {
          listReports: async function () {
            return [];
          },
          listReportBehaviors: async function () {
            return [];
          },
        };
      },
    });
  });
  await assertAuthMatrix('moderation', modApp, '/api/admin/moderation/reports');

  const adminOk = await request(modApp, 'GET', '/api/admin/moderation/reports', {
    Authorization: 'Bearer tok-admin',
  });
  ok('E app ADMIN → 통과', adminOk.status === 200 && adminOk.body && adminOk.body.ok === true, adminOk.status);

  const ownerOk = await request(modApp, 'GET', '/api/admin/moderation/reports', {
    Authorization: 'Bearer tok-owner',
  });
  ok('F app OWNER → 통과', ownerOk.status === 200 && ownerOk.body.ok === true, ownerOk.status);

  const boomApp = buildApp('/api/admin/moderation', function (adminAuth) {
    return mountAdminRoutes({
      adminAuth: adminAuth,
      getBoardService: function () {
        return {
          listReports: async function () {
            const e = new Error('boom');
            e.code = 'SIMULATED_DB_FAIL';
            throw e;
          },
        };
      },
    });
  });
  const boom = await request(boomApp, 'GET', '/api/admin/moderation/reports', {
    Authorization: 'Bearer tok-admin',
  });
  ok('G ADMIN + DB 오류 → 500', boom.status === 500 && boom.body && boom.body.error === 'SIMULATED_DB_FAIL', boom.status + ' ' + JSON.stringify(boom.body));

  const rightsApp = buildApp('/api/admin/rights-infringement', function (adminAuth) {
    return mountRightsInfringementAdminRoutes({ adminAuth: adminAuth });
  });
  await assertAuthMatrix('rights', rightsApp, '/api/admin/rights-infringement/requests');

  const retentionApp = buildApp('/api/admin/retention', function (adminAuth) {
    return mountRetentionAdminRoutes({ adminAuth: adminAuth });
  });
  const retNo = await request(retentionApp, 'GET', '/api/admin/retention/evidence?id=x', {});
  ok('retention no token → 401', retNo.status === 401 && retNo.body.error.code === 'ADMIN_TOKEN_MISSING', retNo.status);
  const retMem = await request(retentionApp, 'GET', '/api/admin/retention/evidence?id=x', {
    Authorization: 'Bearer tok-member',
  });
  ok('retention member → 403', retMem.status === 403, retMem.status);
  const retAdmin = await request(retentionApp, 'GET', '/api/admin/retention/evidence?id=x', {
    Authorization: 'Bearer tok-admin',
  });
  ok(
    'retention ADMIN 인증 통과(데이터 404 가능)',
    retAdmin.status === 404 || retAdmin.status === 200,
    retAdmin.status
  );
  ok('retention 401/403 본문에 보관 원문 없음', !retNo.body.evidence && !retMem.body.evidence);

  // Alien force-return: auth first, then V1 OFF → 503
  const alienApp = buildApp('/api/admin/moderation', function (adminAuth) {
    return mountAdminRoutes({ adminAuth: adminAuth, getBoardService: function () { return null; } });
  });
  const alienNo = await request(alienApp, 'POST', '/api/admin/moderation/users/u1/return', {}, {});
  ok('H alien no token → 401 (not 503)', alienNo.status === 401, alienNo.status);
  const prevAlien = process.env.ALIEN_MODERATION_V1;
  process.env.ALIEN_MODERATION_V1 = 'false';
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  const alienAdmin = await request(
    alienApp,
    'POST',
    '/api/admin/moderation/users/u1/return',
    { Authorization: 'Bearer tok-admin' },
    {}
  );
  ok(
    'H ADMIN + V1 OFF → 503 ALIEN_SYSTEM_NOT_ACTIVATED',
    alienAdmin.status === 503 && alienAdmin.body && alienAdmin.body.error === 'ALIEN_SYSTEM_NOT_ACTIVATED',
    alienAdmin.status + ' ' + JSON.stringify(alienAdmin.body)
  );
  if (prevAlien === undefined) delete process.env.ALIEN_MODERATION_V1;
  else process.env.ALIEN_MODERATION_V1 = prevAlien;

  // Guard unit: createAdminAccessGuard with inject
  const guard = createAdminAccessGuard({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'k',
    getUserFromAccessToken: async function () {
      return { id: 'x', app_metadata: { role: 'ADMIN' } };
    },
  });
  ok('createAdminAccessGuard export', typeof guard === 'function');

  console.log('\nAdmin HTTP auth status results:', passed, 'passed,', failed, 'failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
