/**
 * 개발 전용 보궐 진행 HTTP.
 * 127.0.0.1 에서만 듣는다. 헤더와 클라이언트의 시각, 당선 값으로는 직위를 주지 않는다.
 * JSON 잠금은 단일 프로세스다. PostgreSQL에 접속하지 않는다.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const service = require('./by-election-run-service');

const DEV_HEADER = 'x-sentencearena-dev-by-election';
const PORT = Number(process.env.BY_ELECTION_RUN_DEV_PORT || 3018);

function defaultPaths(root) {
  const dir = root || path.join(__dirname, '..', 'dev-data');
  return {
    vacancy: process.env.IMPEACHMENT_VACANCY_STORE || path.join(dir, 'by-election-vacancy.json'),
    election: process.env.LEADER_ELECTION_STORE || path.join(dir, 'by-election-election.json'),
    filing: process.env.LEADER_FILING_STORE || path.join(dir, 'by-election-filing.json'),
    run: process.env.BY_ELECTION_RUN_STORE || path.join(dir, 'by-election-run.json'),
    rank: process.env.LEADER_APPOINTMENT_RANK_STORE || path.join(dir, 'leader-appointment-rank.json'),
  };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3010');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SentenceArena-Dev-By-Election');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function send(res, status, body) {
  cors(res);
  const payload = body && typeof body === 'object' ? body : { ok: false, reason: 'EMPTY', productionAuth: false };
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

function clockFromQuery(url) {
  if (url.searchParams.get('clockSource') === 'test-fixture' && isFinite(Number(url.searchParams.get('nowMs')))) {
    return Number(url.searchParams.get('nowMs'));
  }
  return Date.now();
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
      send(res, 403, { ok: false, reason: 'DEV_HEADER_NOT_AUTH', officeGranted: false, appointment: false });
      return;
    }
    if (req.method === 'GET' && url.pathname.indexOf('/dev/by-election/runs/') === 0) {
      const ballotId = decodeURIComponent(url.pathname.slice('/dev/by-election/runs/'.length));
      const view = service.publicRun(paths, ballotId, clockFromQuery(url));
      if (!view) {
        send(res, 404, { ok: false, reason: 'REMOVAL_NOT_STORED', officeGranted: false });
        return;
      }
      send(res, 200, view);
      return;
    }
    if (req.method === 'GET' && url.pathname.indexOf('/dev/by-election/elections/') === 0) {
      const electionId = decodeURIComponent(url.pathname.slice('/dev/by-election/elections/'.length));
      const election = require('./leader-election-service');
      const appointment = require('./leader-appointment-service');
      const store = election.readStore(paths.election);
      const row = (store.elections || []).filter(function (item) { return item.id === electionId; })[0];
      const read = appointment.loadAppointmentRead(store, paths, row && row.filingRoundId);
      const view = election.publicElection(store, electionId, clockFromQuery(url), read);
      if (!view) {
        send(res, 404, { ok: false, reason: 'ELECTION_NOT_FOUND', officeGranted: false });
        return;
      }
      view.lock = 'single-process';
      if (!view.appointmentCheck) {
        view.officeGranted = false;
        view.appointmentComplete = false;
        view.appointmentCheck = 'STORES_NOT_CHECKED';
      }
      send(res, 200, view);
      return;
    }
    let body = {};
    try { body = await readBody(req); }
    catch (err) {
      send(res, 400, { ok: false, reason: 'BAD_JSON', officeGranted: false });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/by-election/close') {
      send(res, 403, { ok: false, reason: 'APPOINTMENT_NOT_DONE', officeGranted: false, appointment: false, tieRule: false });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/by-election/advance') {
      const advanced = await service.advanceAndPersist(paths, body, {
        failElectionWrite: body.failElectionWrite === true,
        failRunWrite: body.failRunWrite === true,
      });
      send(res, advanced && advanced.ok ? 200 : 403, advanced || { ok: false, reason: 'ADVANCE_ERROR', officeGranted: false });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/by-election/applications') {
      const filed = await service.fileAndPersist(paths, body);
      send(res, filed && filed.ok ? 200 : 403, filed || { ok: false, reason: 'APPLICATION_ERROR', officeGranted: false });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/by-election/reviews') {
      const reviewed = await service.reviewAndPersist(paths, body);
      send(res, reviewed && reviewed.ok ? 200 : 403, reviewed || { ok: false, reason: 'REVIEW_ERROR', officeGranted: false });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/by-election/votes') {
      const cast = await service.voteAndPersist(paths, body);
      send(res, cast && cast.ok ? 200 : 403, cast || { ok: false, reason: 'VOTE_ERROR', officeGranted: false });
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
  const launch = require('./leader-dev-launch');
  const chosen = launch.choose('by-election', process.env);
  if (!chosen.ok) {
    process.stderr.write(chosen.report);
    process.exit(1);
  }
  if (chosen.hint) process.stdout.write(chosen.hint);
  listen(PORT, chosen.paths).then(function () {
    process.stdout.write('by-election run dev http ' + PORT + '\n');
  });
}

module.exports = { createHandler: createHandler, listen: listen, DEV_HEADER: DEV_HEADER, defaultPaths: defaultPaths };
