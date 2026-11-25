/**
 * 선거 저장 선택.
 * 기본은 기존 JSON 파일이다. Postgres는 고립 시험 또는 개발 깃발이 둘 다 있을 때만 연다.
 * 운영 주소로는 바뀌지 않는다.
 */
'use strict';

const store = require('./leader-election-pg-store');
const login = require('./leader-election-login');

function postgresSelected(env) {
  const src = env || {};
  if (src.LEADER_ELECTION_BACKEND !== 'postgres') return false;
  if (src.LEADER_ELECTION_PG_ISOLATED !== '1') return false;
  const url = String(src.LEADER_ELECTION_PG_URL || '');
  if (!url) return false;
  if (/supabase|production|amazonaws|render\.com|neon\.tech|pooler/i.test(url)) return false;
  if (!/localhost|127\.0\.0\.1/.test(url)) return false;
  return true;
}

async function withClient(fn) {
  if (!postgresSelected(process.env)) return { ok: false, reason: 'POSTGRES_NOT_SELECTED', productionAuth: false };
  const Client = require('pg').Client;
  const client = new Client({
    connectionString: process.env.LEADER_ELECTION_PG_URL,
    connectionTimeoutMillis: 2000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function signedActor(req, body) {
  const actor = await login.resolveElectionActor(req);
  return login.bindActor(actor, body || {});
}

function routeFiling(pathname, body, req) {
  if (pathname === '/dev/leader-filing/candidacies' || pathname === '/dev/leader-filing/impeachments') {
    return signedActor(req, body).then(function (bound) {
      if (!bound.ok) return bound;
      return login.loadMembership().then(function (loaded) {
        if (!loaded.representativesReady) {
          return { ok: false, reason: loaded.reason || 'CITIZEN_RANK_POLICY_NOT_FINALIZED', stored: false, liveSupabase: false, productionAuth: false };
        }
        const next = Object.assign({}, body || {}, { personId: bound.userId, memberDirectory: loaded.directory });
        delete next.isRepresentative;
        delete next.populationCount;
        delete next.population;
        delete next.actor;
        if (pathname === '/dev/leader-filing/candidacies') {
          return withClient(function (client) { return store.fileCandidacy(client, next); });
        }
        return withClient(function (client) { return store.proposeImpeachment(client, next); });
      });
    });
  }
  if (pathname === '/dev/leader-filing/impeachment-votes') {
    return signedActor(req, body).then(function (bound) {
      if (!bound.ok) return bound;
      return login.loadMembership().then(function (loaded) {
        if (!loaded.directory) {
          return { ok: false, reason: loaded.reason || 'MEMBER_SOURCE_NOT_CONNECTED', stored: false, liveSupabase: false, productionAuth: false };
        }
        const src = body || {};
        return withClient(function (client) {
          return store.castImpeachmentVote(client, {
            proposalId: src.proposalId,
            voterId: src.voterId || src.actor,
            choice: src.choice,
            nowMs: src.nowMs,
            sessionRequired: true,
            sessionUserId: bound.userId,
            memberDirectory: loaded.directory,
          });
        });
      });
    });
  }
  return Promise.resolve({ ok: false, reason: 'NOT_FOUND', productionAuth: false });
}

function routeElection(pathname, body, req) {
  const src = body || {};
  if (pathname === '/dev/leader-election/rounds') return withClient(function (client) { return store.openFilingRound(client, src); });
  const voteMatch = String(pathname || '').match(/^\/dev\/leader-election\/ballots\/(.+)\/(votes|close)$/);
  if (voteMatch && voteMatch[2] === 'votes') {
    return signedActor(req, body).then(function (bound) {
      if (!bound.ok) return bound;
      return login.loadMembership().then(function (loaded) {
        if (!loaded.directory) {
          return { ok: false, reason: loaded.reason || 'MEMBER_SOURCE_NOT_CONNECTED', stored: false, liveSupabase: false, productionAuth: false };
        }
        return withClient(function (client) {
          return store.castVote(client, {
            ballotId: decodeURIComponent(voteMatch[1]),
            voterId: src.actor || src.voterId,
            choice: src.choice,
            nowMs: src.nowMs,
            sessionRequired: true,
            sessionUserId: bound.userId,
            memberDirectory: loaded.directory,
          });
        });
      });
    });
  }
  if (voteMatch && voteMatch[2] === 'close') {
    return withClient(function (client) {
      return store.resolveRound(client, { roundId: src.roundId, nowMs: src.nowMs, outcome: src.outcome });
    });
  }
  return Promise.resolve({ ok: false, reason: 'NOT_FOUND', productionAuth: false });
}

function routeAppointment(pathname, body) {
  const src = body || {};
  if (pathname === '/dev/leader-appointment/appointments') {
    return withClient(function (client) { return store.resolveRound(client, src); });
  }
  if (pathname === '/dev/leader-appointment/removals') {
    return withClient(function (client) { return store.removeOffice(client, src); });
  }
  const officeMatch = String(pathname || '').match(/^\/dev\/leader-appointment\/offices\/([^/]+)\/([^/]+)$/);
  if (officeMatch) {
    return withClient(async function (client) {
      const office = await store.readOffice(client, decodeURIComponent(officeMatch[1]), decodeURIComponent(officeMatch[2]));
      if (!office) return { ok: false, reason: 'NOT_FOUND', officeGranted: false };
      return { ok: true, office: office, officeGranted: office.leader_id != null, productionAuth: false };
    });
  }
  return Promise.resolve({ ok: false, reason: 'NOT_FOUND', officeGranted: false });
}

function tick(input) {
  return withClient(function (client) { return store.tick(client, input || {}); });
}

module.exports = {
  postgresSelected: postgresSelected,
  routeFiling: routeFiling,
  routeElection: routeElection,
  routeAppointment: routeAppointment,
  tick: tick,
  store: store,
};
