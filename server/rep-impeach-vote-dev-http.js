/**
 * 개발 전용 대표 탄핵투표 HTTP.
 * 127.0.0.1 에서만 듣는다. 개발 헤더는 운영 인증이 아니다.
 * node server/rep-impeach-vote-dev-http.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const service = require('./rep-impeach-vote-service');
const filing = require('./leader-filing-service');

const DEV_HEADER = 'x-sentencearena-dev-vote';
const PORT = Number(process.env.REP_IMPEACH_VOTE_DEV_PORT || 3012);
const STORE_PATH = process.env.REP_IMPEACH_VOTE_STORE || path.join(__dirname, '..', 'dev-data', 'rep-impeach-vote-store.json');
const FILING_PATH = process.env.LEADER_FILING_STORE || path.join(__dirname, '..', 'dev-data', 'leader-filing-store.json');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3010');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SentenceArena-Dev-Vote');
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

function createHandler(storePath, filingPath) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }
    if (String(req.headers[DEV_HEADER] || '') !== 'preview') {
      send(res, 403, { ok: false, reason: 'DEV_HEADER_NOT_AUTH' });
      return;
    }
    const store = service.readStore(storePath);
    if (req.method === 'GET' && url.pathname.indexOf('/dev/rep-impeach-vote/ballots/') === 0) {
      const ballotId = decodeURIComponent(url.pathname.slice('/dev/rep-impeach-vote/ballots/'.length));
      const view = service.publicView(store, ballotId, Date.now());
      if (!view) {
        send(res, 404, { ok: false, reason: 'BALLOT_NOT_FOUND' });
        return;
      }
      send(res, 200, { ok: true, publicView: view });
      return;
    }
    let body = {};
    try { body = await readBody(req); }
    catch (err) {
      send(res, 400, { ok: false, reason: 'BAD_JSON' });
      return;
    }
    const nowMs = body.clockSource === 'test-fixture' && isFinite(Number(body.nowMs)) ? Number(body.nowMs) : Date.now();
    if (req.method === 'POST' && url.pathname === '/dev/rep-impeach-vote/ballots') {
      const filingStore = filing.readStore(filingPath || FILING_PATH);
      const startsAtMs = body.clockSource === 'test-fixture' && isFinite(Number(body.startsAtMs)) ? Number(body.startsAtMs) : Date.now();
      const opened = service.openFromProposal(store, { proposalId: body.proposalId, startsAtMs: startsAtMs }, filingStore);
      if (opened.ok) service.writeStore(storePath, store);
      send(res, opened.ok ? 200 : 403, opened.ok ? {
        ok: true,
        ballotId: opened.ballot.id,
        authKind: 'test-fixture',
        productionAuth: false,
        publicView: service.publicView(store, opened.ballot.id, nowMs),
      } : opened);
      return;
    }
    const voteMatch = url.pathname.match(/^\/dev\/rep-impeach-vote\/ballots\/(.+)\/(votes|close|halt|error)$/);
    if (req.method === 'POST' && voteMatch) {
      const ballotId = decodeURIComponent(voteMatch[1]);
      const action = voteMatch[2];
      const result = await service.withLock(ballotId, function () {
        const fresh = service.readStore(storePath);
        let next;
        if (action === 'votes') next = service.core.castVote(fresh, { ballotId: ballotId, actor: body.actor, choice: body.choice, nowMs: nowMs });
        else if (action === 'close') {
          next = service.core.closeBallot(fresh, { ballotId: ballotId, nowMs: nowMs });
          if (next && next.ok && next.alreadyClosed !== true) {
            const filingStore = filing.readStore(filingPath || FILING_PATH);
            const applied = filing.recordRepresentativeVoteOutcome(filingStore, next.ballot);
            if (applied.ok) filing.writeStore(filingPath || FILING_PATH, filingStore);
            next.filingApplied = applied.alreadyApplied === true ? 'already' : applied.ok;
          }
        } else if (action === 'halt') next = service.haltBallot(fresh, ballotId);
        else next = service.markBallotError(fresh, ballotId);
        if (next && next.ok) service.writeStore(storePath, fresh);
        if (next && next.ok) {
          next.authKind = 'test-fixture';
          next.productionAuth = false;
        }
        return next;
      });
      send(res, result && result.ok ? 200 : 403, result || { ok: false, reason: 'VOTE_ERROR' });
      return;
    }
    send(res, 404, { ok: false, reason: 'NOT_FOUND' });
  };
}

function listen(port, storePath, filingPath) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  if (!fs.existsSync(storePath)) service.writeStore(storePath, service.core.emptyStore());
  const server = http.createServer(createHandler(storePath, filingPath || FILING_PATH));
  return new Promise(function (resolve) {
    server.listen(port, '127.0.0.1', function () { resolve(server); });
  });
}

if (require.main === module) {
  listen(PORT, STORE_PATH).then(function () {
    process.stdout.write('rep impeach vote dev http ' + PORT + '\n');
  });
}

module.exports = { createHandler: createHandler, listen: listen, DEV_HEADER: DEV_HEADER };
