/**
 * 개발 전용 지도자 선거 HTTP.
 * 127.0.0.1 에서만 듣는다. 개발 헤더는 운영 인증이 아니다.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const service = require('./leader-election-service');
const filing = require('./leader-filing-service');
const appointment = require('./leader-appointment-service');

const DEV_HEADER = 'x-sentencearena-dev-election';
const PORT = Number(process.env.LEADER_ELECTION_DEV_PORT || 3013);
const STORE_PATH = process.env.LEADER_ELECTION_STORE || path.join(__dirname, '..', 'dev-data', 'leader-election-store.json');
const FILING_PATH = process.env.LEADER_FILING_STORE || path.join(__dirname, '..', 'dev-data', 'leader-filing-store.json');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3010');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SentenceArena-Dev-Election');
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

function defaultAppointmentPaths(electionPath) {
  const dir = path.join(__dirname, '..', 'dev-data');
  return {
    vacancy: process.env.IMPEACHMENT_VACANCY_STORE || path.join(dir, 'impeachment-vacancy-store.json'),
    election: electionPath || STORE_PATH,
    rank: process.env.LEADER_APPOINTMENT_RANK_STORE || path.join(dir, 'leader-appointment-rank.json'),
    run: process.env.BY_ELECTION_RUN_STORE || path.join(dir, 'by-election-run.json'),
  };
}

function appointmentRead(store, electionId, appointmentPaths) {
  const row = (store.elections || []).filter(function (item) { return item.id === electionId; })[0];
  return appointment.loadAppointmentRead(store, appointmentPaths, row && row.filingRoundId);
}

function createHandler(storePath, filingPath, appointmentPaths) {
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
    const store = service.readStore(storePath);
    if (req.method === 'GET' && url.pathname.indexOf('/dev/leader-election/rounds/') === 0) {
      const filingRoundId = decodeURIComponent(url.pathname.slice('/dev/leader-election/rounds/'.length));
      if (!filingRoundId || filingRoundId.indexOf('/') >= 0) {
        send(res, 404, { ok: false, reason: 'NOT_FOUND', productionAuth: false });
        return;
      }
      const roundView = service.roundView(store, filingRoundId);
      if (!roundView) {
        send(res, 404, { ok: false, reason: 'ROUND_NOT_FOUND', productionAuth: false });
        return;
      }
      send(res, 200, { ok: true, round: roundView.round, applications: roundView.applications, reviews: roundView.reviews, election: roundView.election, productionAuth: false });
      return;
    }
    if (req.method === 'GET' && url.pathname.indexOf('/dev/leader-election/elections/') === 0) {
      const electionId = decodeURIComponent(url.pathname.slice('/dev/leader-election/elections/'.length));
      const view = service.publicElection(store, electionId, Date.now(), appointmentRead(store, electionId, appointmentPaths));
      if (!view) {
        send(res, 404, { ok: false, reason: 'ELECTION_NOT_FOUND', productionAuth: false });
        return;
      }
      send(res, 200, { ok: true, publicView: view, productionAuth: false });
      return;
    }
    let body = {};
    try { body = await readBody(req); }
    catch (err) {
      send(res, 400, { ok: false, reason: 'BAD_JSON', productionAuth: false });
      return;
    }
    const nowMs = body.clockSource === 'test-fixture' && isFinite(Number(body.nowMs)) ? Number(body.nowMs) : Date.now();
    if (req.method === 'POST' && url.pathname === '/dev/leader-election/rounds') {
      const openedRound = service.openFilingRound(store, body);
      if (openedRound.stored) service.writeStore(storePath, store);
      openedRound.productionAuth = false;
      send(res, openedRound.ok ? 200 : 403, openedRound);
      return;
    }
    const roundPost = url.pathname.match(/^\/dev\/leader-election\/rounds\/([^/]+)\/(applications|close)$/);
    if (req.method === 'POST' && roundPost) {
      body.filingRoundId = decodeURIComponent(roundPost[1]);
      const filingStore = filing.readStore(filingPath || FILING_PATH);
      const roundResult = roundPost[2] === 'applications'
        ? service.applyToRound(store, filingStore, body)
        : service.closeRegistration(store, body);
      if (roundResult.stored) service.writeStore(storePath, store);
      roundResult.productionAuth = false;
      send(res, roundResult.ok ? 200 : 403, roundResult);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/leader-election/reviews') {
      const filingStore = filing.readStore(filingPath || FILING_PATH);
      const reviewed = service.reviewCandidacy(store, filingStore, body);
      if (reviewed.stored) service.writeStore(storePath, store);
      reviewed.productionAuth = false;
      send(res, reviewed.ok ? 200 : 403, reviewed);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dev/leader-election/elections') {
      body.nowMs = nowMs;
      const opened = service.openElection(store, body);
      if (opened.ok) service.writeStore(storePath, store);
      opened.productionAuth = false;
      send(res, opened.ok ? 200 : 403, opened);
      return;
    }
    const voteMatch = url.pathname.match(/^\/dev\/leader-election\/ballots\/(.+)\/(votes|close)$/);
    if (req.method === 'POST' && voteMatch) {
      const ballotId = decodeURIComponent(voteMatch[1]);
      const action = voteMatch[2];
      const result = await service.withLock(ballotId, function () {
        const fresh = service.readStore(storePath);
        const next = action === 'votes'
          ? service.castVoteUnlocked(fresh, { ballotId: ballotId, actor: body.actor, choice: body.choice, nowMs: nowMs, eligibility: body.eligibility })
          : service.closeBallotUnlocked(fresh, { ballotId: ballotId, nowMs: nowMs });
        if (next && next.ok) service.writeStore(storePath, fresh);
        if (next) next.productionAuth = false;
        return next;
      });
      send(res, result && result.ok ? 200 : 403, result || { ok: false, reason: 'VOTE_ERROR', productionAuth: false });
      return;
    }
    send(res, 404, { ok: false, reason: 'NOT_FOUND', productionAuth: false });
  };
}

function listen(port, storePath, filingPath, appointmentPaths) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  if (!fs.existsSync(storePath)) service.writeStore(storePath, service.emptyStore());
  const server = http.createServer(createHandler(storePath, filingPath || FILING_PATH, appointmentPaths || defaultAppointmentPaths(storePath)));
  return new Promise(function (resolve) {
    server.listen(port, '127.0.0.1', function () { resolve(server); });
  });
}

if (require.main === module) {
  const launch = require('./leader-dev-launch');
  const chosen = launch.choose('election', process.env);
  if (!chosen.ok) {
    process.stderr.write(chosen.report);
    process.exit(1);
  }
  if (chosen.hint) process.stdout.write(chosen.hint);
  listen(PORT, chosen.paths.election, chosen.paths.filing, chosen.paths).then(function () {
    process.stdout.write('leader election dev http ' + PORT + '\n');
  });
}

module.exports = { createHandler: createHandler, listen: listen, DEV_HEADER: DEV_HEADER, defaultAppointmentPaths: defaultAppointmentPaths };
