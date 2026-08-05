#!/usr/bin/env node
'use strict';

/**
 * 관리자 UI ↔ 개발 PG API smoke (화면 로직 + 실 API, npm start 없음)
 */

require('dotenv').config();

const { makeReady, AS_OF, ADMIN_TOKEN } = require('./daily-issue-api-test-fixtures');
const { createDailyIssueApiApp } = require('../server/daily-issue-routes');
const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');
const { requestApp } = require('./daily-issue-api-http-helper');
const ui = require('../public/admin/daily-issues/admin-daily-issue.js');
const http = require('http');

const schema = String(process.env.DAILY_ISSUE_DB_SCHEMA || '').trim();
const url = String(process.env.DAILY_ISSUE_DATABASE_URL || '').trim();

function fetchAgainstApp(app) {
  return function (reqPath, init) {
    return new Promise(function (resolve, reject) {
      const server = app.listen(0, '127.0.0.1', function () {
        const port = server.address().port;
        const headers = Object.assign({}, (init && init.headers) || {});
        let bodyBuf = null;
        if (init && init.body) {
          bodyBuf = Buffer.from(init.body);
          headers['Content-Length'] = String(bodyBuf.length);
        }
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: port,
            path: reqPath,
            method: (init && init.method) || 'GET',
            headers: headers,
          },
          function (res) {
            const chunks = [];
            res.on('data', function (c) {
              chunks.push(c);
            });
            res.on('end', function () {
              const raw = Buffer.concat(chunks).toString('utf8');
              server.close(function () {
                resolve({
                  status: res.statusCode,
                  headers: {
                    get: function (k) {
                      return res.headers[String(k).toLowerCase()] || null;
                    },
                  },
                  text: async function () {
                    return raw;
                  },
                });
              });
            });
          },
        );
        req.on('error', function (err) {
          server.close(function () {
            reject(err);
          });
        });
        if (bodyBuf) req.write(bodyBuf);
        req.end();
      });
    });
  };
}

async function main() {
  if (!url) {
    console.log('SKIP: DAILY_ISSUE_DATABASE_URL not set');
    process.exit(0);
  }
  if (schema !== 'daily_issue_test') {
    console.log('SKIP: schema must be daily_issue_test');
    process.exit(0);
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.log('SKIP: production');
    process.exit(0);
  }

  console.log('\n=== admin UI PG smoke ===\n');

  const token = String(process.env.DAILY_ISSUE_ADMIN_API_TOKEN || ADMIN_TOKEN).trim();
  if (!token) {
    console.error('FAIL: admin token missing');
    process.exit(1);
  }

  const repo = createDailyIssueReviewRepository({
    kind: 'db',
    databaseUrl: url,
    schemaName: schema,
    enabled: true,
  });
  await Promise.resolve(repo.initialize());

  const app = createDailyIssueApiApp({
    repositoryInstance: repo,
    adminToken: token,
    asOf: AS_OF,
    corsOrigins: ['http://localhost:3000'],
  });

  const suffix = 'ui_smoke_' + Date.now();
  const item = makeReady(suffix);
  const ins = await Promise.resolve(repo.insertReviewItems([item], [], {}));
  if (!ins.ok) {
    console.error('FAIL insert', ins.error);
    process.exit(1);
  }
  console.log('PASS fixture insert');

  const mem = {
    data: {},
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null;
    },
    setItem: function (k, v) {
      this.data[k] = String(v);
    },
    removeItem: function (k) {
      delete this.data[k];
    },
  };
  const store = ui.createTokenStore(mem);
  store.set(token);
  const client = ui.createApiClient({
    tokenStore: store,
    fetch: fetchAgainstApp(app),
  });

  const list = await client.listReview({ limit: 50 });
  if (!(list.ok && (list.body.data.items || []).some(function (it) { return it.id === item.id; }))) {
    console.error('FAIL list', list.status, list.errorCode);
    process.exit(1);
  }
  console.log('PASS UI client list');

  const detail = await client.getReview(item.id);
  if (!(detail.ok && detail.body.data.item.lockVersion >= 1)) {
    console.error('FAIL detail', detail.status);
    process.exit(1);
  }
  console.log('PASS UI client detail');

  const lock = detail.body.data.item.lockVersion;
  const body = ui.buildTransitionBody(detail.body.data.item);
  okBody(body);

  const approve = await client.transition(item.id, 'approve', body);
  if (!approve.ok) {
    console.error('FAIL approve', approve.status, approve.errorCode);
    process.exit(1);
  }
  console.log('PASS UI approve');

  // ensure not auto-published
  const mid = await client.getReview(item.id);
  if (mid.body.data.item.status !== 'APPROVED') {
    console.error('FAIL auto-publish leaked', mid.body.data.item.status);
    process.exit(1);
  }
  console.log('PASS approve≠publish');

  const pubBody = ui.buildTransitionBody(mid.body.data.item);
  const publish = await client.transition(item.id, 'publish', pubBody);
  if (!publish.ok) {
    console.error('FAIL publish', publish.status, publish.errorCode);
    process.exit(1);
  }
  console.log('PASS UI publish');

  const pubList = await requestApp(app, 'GET', '/api/daily-issues');
  const ids = ((pubList.body && pubList.body.data && pubList.body.data.items) || []).map(function (i) {
    return i.id;
  });
  if (ids.indexOf(item.id) < 0) {
    console.error('FAIL public exposure');
    process.exit(1);
  }
  console.log('PASS public API exposure');

  const pubItem = publish.body.data.item;
  const retire = await client.transition(item.id, 'retire', {
    expectedStatus: 'PUBLISHED',
    expectedLockVersion: pubItem.lockVersion,
    reviewerId: 'dev-admin',
    reasonCode: 'MANUAL_RETIRE',
    reasonText: 'ui smoke',
  });
  if (!retire.ok) {
    console.error('FAIL retire', retire.status, retire.errorCode);
    process.exit(1);
  }
  console.log('PASS UI retire');

  const pubList2 = await requestApp(app, 'GET', '/api/daily-issues');
  const ids2 = ((pubList2.body && pubList2.body.data && pubList2.body.data.items) || []).map(function (i) {
    return i.id;
  });
  if (ids2.indexOf(item.id) >= 0) {
    console.error('FAIL still public');
    process.exit(1);
  }
  console.log('PASS public removed after retire');

  // ensure token not in any response body
  const raws = [list, detail, approve, publish, retire]
    .map(function (r) {
      return JSON.stringify(r.body || {});
    })
    .join('\n');
  if (raws.indexOf(token) >= 0) {
    console.error('FAIL token leaked in API JSON');
    process.exit(1);
  }
  console.log('PASS token not in response bodies');

  console.log('\nAdmin UI PG smoke PASS');
  process.exit(0);
}

function okBody(body) {
  if (!body.expectedStatus || body.expectedLockVersion == null) {
    console.error('FAIL transition body contract');
    process.exit(1);
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
