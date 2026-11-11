/**
 * 개발 전용 탄핵 공석 HTTP.
 * 127.0.0.1 에서만 듣는다. 개발 헤더와 클라이언트의 passed, confirmed 로는 해임하지 않는다.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const service = require('./impeachment-vacancy-service');

const DEV_HEADER = 'x-sentencearena-dev-vacancy';
const PORT = Number(process.env.IMPEACHMENT_VACANCY_DEV_PORT || 3016);
const STORE_PATH = process.env.IMPEACHMENT_VACANCY_STORE || path.join(__dirname, '..', 'dev-data', 'impeachment-vacancy-store.json');
const CITIZEN_PATH = process.env.CITIZEN_IMPEACH_VOTE_STORE || path.join(__dirname, '..', 'dev-data', 'citizen-impeach-vote-store.json');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3010');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SentenceArena-Dev-Vacancy');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function send(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function createHandler(storePath, citizenPath) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }
    if (String(req.headers[DEV_HEADER] || '') !== 'preview') {
      send(res, 403, { ok: false, reason: 'DEV_HEADER_NOT_AUTH', productionAuth: false });
      return;
    }
    if (req.method === 'GET' && url.pathname.indexOf('/dev/impeachment-vacancy/offices/') === 0) {
      const parts = url.pathname.slice('/dev/impeachment-vacancy/offices/'.length).split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        send(res, 404, { ok: false, reason: 'NOT_FOUND', productionAuth: false });
        return;
      }
      const view = service.publicOffice(service.readStore(storePath), decodeURIComponent(parts[0]), decodeURIComponent(parts[1]));
      if (!view) {
        send(res, 404, { ok: false, reason: 'OFFICE_NOT_FOUND', productionAuth: false });
        return;
      }
      send(res, 200, { ok: true, office: view, productionAuth: false });
      return;
    }
    let body = {};
    try { body = await readBody(req); }
    catch (err) {
      send(res, 400, { ok: false, reason: 'BAD_JSON', productionAuth: false });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/impeachment-vacancy/shared-election-path') {
      const plan = service.sharedCandidatePath(body.candidateCount, body.electionUse);
      send(res, plan.ok ? 200 : 403, plan);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/impeachment-vacancy/removals') {
      const nowMs = body.clockSource === 'test-fixture' && isFinite(Number(body.nowMs)) ? Number(body.nowMs) : Date.now();
      const removed = await service.removeAndPersist(storePath, citizenPath, { ballotId: body.ballotId, nowMs: nowMs }, {
        failOfficeWrite: body.failOfficeWrite === true && body.clockSource === 'test-fixture',
      });
      if (removed) removed.productionAuth = false;
      send(res, removed && removed.ok ? 200 : 403, removed || { ok: false, reason: 'REMOVAL_ERROR', productionAuth: false });
      return;
    }
    send(res, 404, { ok: false, reason: 'NOT_FOUND', productionAuth: false });
  };
}

function listen(port, storePath, citizenPath) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  if (!fs.existsSync(storePath)) service.writeStore(storePath, service.emptyStore());
  const server = http.createServer(createHandler(storePath, citizenPath || CITIZEN_PATH));
  return new Promise(function (resolve) {
    server.listen(port, '127.0.0.1', function () { resolve(server); });
  });
}

if (require.main === module) {
  listen(PORT, STORE_PATH, CITIZEN_PATH).then(function () {
    process.stdout.write('impeachment vacancy dev http ' + PORT + '\n');
  });
}

module.exports = { createHandler: createHandler, listen: listen, DEV_HEADER: DEV_HEADER };
