/**
 * 개발 전용 단독 당선 임명 HTTP.
 * 127.0.0.1 에서만 듣는다. 클라이언트의 당선 값과 시간대로 직위를 주지 않는다.
 * JSON 잠금은 단일 프로세스다. PostgreSQL에 접속하지 않는다.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const service = require('./leader-appointment-service');

const DEV_HEADER = 'x-sentencearena-dev-leader-appointment';
const PORT = Number(process.env.LEADER_APPOINTMENT_DEV_PORT || 3019);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3010');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SentenceArena-Dev-Leader-Appointment');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function send(res, status, body) {
  cors(res);
  const payload = body && typeof body === 'object' ? body : { ok: false, reason: 'EMPTY' };
  payload.productionAuth = false;
  payload.lock = 'single-process';
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
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

function createHandler(paths) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }
    if (String(req.headers[DEV_HEADER] || '') !== 'preview') {
      send(res, 403, { ok: false, reason: 'DEV_HEADER_NOT_AUTH', officeGranted: false });
      return;
    }
    if (req.method === 'GET' && url.pathname.indexOf('/dev/leader-appointment/offices/') === 0) {
      const parts = url.pathname.slice('/dev/leader-appointment/offices/'.length).split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        send(res, 404, { ok: false, reason: 'NOT_FOUND', officeGranted: false });
        return;
      }
      const view = service.publicScope(paths, decodeURIComponent(parts[0]), decodeURIComponent(parts[1]));
      send(res, view.ok ? 200 : 404, view);
      return;
    }
    let body = {};
    try { body = await readBody(req); }
    catch (err) {
      send(res, 400, { ok: false, reason: 'BAD_JSON', officeGranted: false });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/leader-appointment/appointments') {
      const appointed = await service.appointAndPersist(paths, body, {
        failBeforeWrite: body.failBeforeWrite === true,
        failAfterOffice: body.failAfterOffice === true,
        failBeforeGrant: body.failBeforeGrant === true,
        crashAfterOffice: body.crashAfterOffice === true,
        crashBeforeGrant: body.crashBeforeGrant === true,
        crashBeforeRun: body.crashBeforeRun === true,
        failRecoveryWrite: body.failRecoveryWrite === true,
      });
      send(res, appointed && appointed.ok ? 200 : 403, appointed || { ok: false, reason: 'APPOINTMENT_ERROR', officeGranted: false });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/leader-appointment/removals') {
      const removed = await service.relinquishAndPersist(paths, body, {
        failBeforeWrite: body.failBeforeWrite === true,
        failAfterOffice: body.failAfterOffice === true,
      });
      send(res, removed && removed.ok ? 200 : 403, removed || { ok: false, reason: 'REMOVAL_ERROR', officeGranted: false });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/leader-appointment/refreshes') {
      const refreshed = await service.refreshAndPersist(paths, body);
      send(res, refreshed && refreshed.ok ? 200 : 403, refreshed || { ok: false, reason: 'REFRESH_ERROR', officeGranted: false });
      return;
    }
    send(res, 404, { ok: false, reason: 'NOT_FOUND', officeGranted: false });
  };
}

function listen(port, paths) {
  fs.mkdirSync(path.dirname(paths.vacancy), { recursive: true });
  const server = http.createServer(createHandler(paths));
  return new Promise(function (resolve) {
    server.listen(port, '127.0.0.1', function () { resolve(server); });
  });
}

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'dev-data');
  listen(PORT, {
    vacancy: path.join(dir, 'leader-appointment-vacancy.json'),
    election: path.join(dir, 'leader-appointment-election.json'),
    filing: path.join(dir, 'leader-appointment-filing.json'),
    rank: path.join(dir, 'leader-appointment-rank.json'),
    citizen: path.join(dir, 'leader-appointment-citizen.json'),
    run: path.join(dir, 'leader-appointment-run.json'),
  }).then(function () {
    process.stdout.write('leader appointment dev http ' + PORT + '\n');
  });
}

module.exports = { createHandler: createHandler, listen: listen, DEV_HEADER: DEV_HEADER };
