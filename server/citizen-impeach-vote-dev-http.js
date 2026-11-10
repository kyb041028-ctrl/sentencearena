/**
 * 개발 전용 시민 탄핵투표 HTTP.
 * 127.0.0.1 에서만 듣는다. 개발 헤더만으로는 투표를 열지 않는다.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const service = require('./citizen-impeach-vote-service');
const filing = require('./leader-filing-service');
const rep = require('./rep-impeach-vote-service');

const DEV_HEADER = 'x-sentencearena-dev-citizen-vote';
const PORT = Number(process.env.CITIZEN_IMPEACH_VOTE_DEV_PORT || 3015);
const STORE_PATH = process.env.CITIZEN_IMPEACH_VOTE_STORE || path.join(__dirname, '..', 'dev-data', 'citizen-impeach-vote-store.json');
const FILING_PATH = process.env.LEADER_FILING_STORE || path.join(__dirname, '..', 'dev-data', 'leader-filing-store.json');
const REP_PATH = process.env.REP_IMPEACH_VOTE_STORE || path.join(__dirname, '..', 'dev-data', 'rep-impeach-vote-store.json');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3010');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SentenceArena-Dev-Citizen-Vote');
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

function createHandler(storePath, filingPath, repPath) {
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
    if (req.method === 'GET' && url.pathname.indexOf('/dev/citizen-impeach-vote/ballots/') === 0) {
      const ballotId = decodeURIComponent(url.pathname.slice('/dev/citizen-impeach-vote/ballots/'.length));
      if (ballotId.indexOf('/') >= 0) {
        send(res, 404, { ok: false, reason: 'NOT_FOUND', productionAuth: false });
        return;
      }
      const view = service.publicView(store, ballotId, Date.now());
      if (!view) {
        send(res, 404, { ok: false, reason: 'BALLOT_NOT_FOUND', productionAuth: false });
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
    if (req.method === 'POST' && url.pathname === '/dev/citizen-impeach-vote/ballots') {
      const filingStore = filing.readStore(filingPath || FILING_PATH);
      const repStore = rep.readStore(repPath || REP_PATH);
      const opened = service.openFromRepresentativeVote(store, {
        proposalId: body.proposalId,
        proposal: body.proposal,
        nowMs: nowMs,
        population: body.population,
        voterIds: body.voterIds,
        eligibleRepresentativeIds: body.eligibleRepresentativeIds,
        eligibleIds: body.eligibleIds,
        eligibleCount: body.eligibleCount,
        voterCount: body.voterCount,
        count: body.count,
      }, repStore, filingStore);
      if (opened.stored) service.writeStore(storePath, store);
      opened.productionAuth = false;
      if (opened.ok) opened.publicView = service.publicView(store, opened.ballot.id, nowMs);
      send(res, opened.ok ? 200 : 403, opened);
      return;
    }
    const voteMatch = url.pathname.match(/^\/dev\/citizen-impeach-vote\/ballots\/(.+)\/(votes|close)$/);
    if (req.method === 'POST' && voteMatch) {
      const ballotId = decodeURIComponent(voteMatch[1]);
      const action = voteMatch[2];
      if (action === 'close') {
        const closed = await service.closeAndPersist(storePath, repPath || REP_PATH, { ballotId: ballotId, nowMs: nowMs }, {
          failCitizenWrite: body.failCitizenWrite === true && body.clockSource === 'test-fixture',
          failBlockWrite: body.failBlockWrite === true && body.clockSource === 'test-fixture',
        });
        if (closed) closed.productionAuth = false;
        send(res, closed && closed.ok ? 200 : 403, closed || { ok: false, reason: 'VOTE_ERROR', productionAuth: false });
        return;
      }
      const result = await service.withLock(ballotId, function () {
        const fresh = service.readStore(storePath);
        const next = service.castVoteUnlocked(fresh, {
          ballotId: ballotId,
          actor: body.actor,
          choice: body.choice,
          nowMs: nowMs,
          eligibility: body.eligibility,
        });
        if (next && next.stored) service.writeStore(storePath, fresh);
        if (next) next.productionAuth = false;
        return next;
      });
      send(res, result && result.ok ? 200 : 403, result || { ok: false, reason: 'VOTE_ERROR', productionAuth: false });
      return;
    }
    send(res, 404, { ok: false, reason: 'NOT_FOUND', productionAuth: false });
  };
}

function listen(port, storePath, filingPath, repPath) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  if (!fs.existsSync(storePath)) service.writeStore(storePath, service.emptyStore());
  const server = http.createServer(createHandler(storePath, filingPath || FILING_PATH, repPath || REP_PATH));
  return new Promise(function (resolve) {
    server.listen(port, '127.0.0.1', function () { resolve(server); });
  });
}

if (require.main === module) {
  listen(PORT, STORE_PATH, FILING_PATH, REP_PATH).then(function () {
    process.stdout.write('citizen impeach vote dev http ' + PORT + '\n');
  });
}

module.exports = { createHandler: createHandler, listen: listen, DEV_HEADER: DEV_HEADER };
