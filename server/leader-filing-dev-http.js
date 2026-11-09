/**
 * 개발 전용 후보 등록·탄핵 발의 HTTP.
 * 127.0.0.1 에서만 듣고, 개발 인증 헤더가 없으면 거절한다.
 * node server/leader-filing-dev-http.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const service = require('./leader-filing-service');

const DEV_HEADER = 'x-sentencearena-dev-filing';
const PORT = Number(process.env.LEADER_FILING_DEV_PORT || 3011);
const STORE_PATH = process.env.LEADER_FILING_STORE || path.join(__dirname, '..', 'dev-data', 'leader-filing-store.json');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3010');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SentenceArena-Dev-Filing');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function send(res, status, body) {
  cors(res);
  const raw = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(raw);
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

function authorized(req) {
  return String(req.headers[DEV_HEADER] || '') === 'preview';
}

function createHandler(storePath) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }
    if (!authorized(req)) {
      send(res, 403, { ok: false, reason: 'DEV_AUTH_REQUIRED' });
      return;
    }
    const store = service.readStore(storePath);
    if (req.method === 'GET' && url.pathname === '/dev/leader-filing/candidacies') {
      send(res, 200, { ok: true, rows: service.listCandidacies(store, url.searchParams.get('country'), url.searchParams.get('territory')) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/dev/leader-filing/impeachments') {
      send(res, 200, { ok: true, rows: service.listImpeachments(store, url.searchParams.get('country'), url.searchParams.get('territory')) });
      return;
    }
    let body = {};
    try { body = await readBody(req); }
    catch (err) {
      send(res, 400, { ok: false, reason: 'BAD_JSON' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/leader-filing/candidacies') {
      const result = service.fileCandidacy(store, body);
      if (result.stored) service.writeStore(storePath, store);
      send(res, result.ok ? 200 : 403, result);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/leader-filing/candidacies/advance') {
      const result = service.advanceCandidacy(store, body);
      if (result.ok) service.writeStore(storePath, store);
      send(res, result.ok ? 200 : 403, result);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/leader-filing/impeachments') {
      const result = service.proposeImpeachment(store, body);
      if (result.stored) service.writeStore(storePath, store);
      send(res, result.ok ? 200 : 403, result);
      return;
    }
    send(res, 404, { ok: false, reason: 'NOT_FOUND' });
  };
}

function listen(port, storePath) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  if (!fs.existsSync(storePath)) service.writeStore(storePath, service.emptyStore());
  const server = http.createServer(createHandler(storePath));
  return new Promise(function (resolve) {
    server.listen(port, '127.0.0.1', function () { resolve(server); });
  });
}

if (require.main === module) {
  listen(PORT, STORE_PATH).then(function () {
    process.stdout.write('leader filing dev http ' + PORT + '\n');
  });
}

module.exports = { createHandler: createHandler, listen: listen, DEV_HEADER: DEV_HEADER };
