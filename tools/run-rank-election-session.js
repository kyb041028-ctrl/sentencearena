'use strict';

/**
 * 로컬 시험 세션으로 기존 계급·선거·탄핵 저장을 한 번 실행한다.
 * 실제 Supabase Auth가 아니다. 운영 데이터베이스는 열지 않는다.
 * node tools/run-rank-election-session.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('../server/leader-election-pg-store');
const login = require('../server/leader-election-login');
const adapter = require('../server/leader-election-store-adapter');
const formula = require('../shared/rank-formula-core');
const term = require('../shared/leader-term-core');
const agenda = require('../shared/representative-agenda-core');

const PORT = 3098;
const OUT = 'C:\\Users\\user\\AppData\\Local\\Cursor\\AgentStores\\cursor_agent_stores\\bc-c953b949-98fb-4f5d-8b49-80c8cb69e605\\files\\media\\rank-election-integration';
const result = {};

function note(key, value) {
  result[key] = value;
  process.stdout.write(key + '=' + JSON.stringify(value) + '\n');
}

function wednesdayMs() {
  let ms = Date.UTC(2026, 10, 10, 15, 0, 0);
  for (let i = 0; i < 14; i += 1) {
    if (formula.isSeoulWednesdayMidnight(ms)) return ms;
    ms += formula.DAY_MS;
  }
  throw new Error('wednesday not found');
}

function cookieToken(req) {
  const raw = String(req.headers.cookie || '');
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i += 1) {
    const bit = parts[i].trim();
    if (bit.indexOf('sa_local_session=') === 0) return decodeURIComponent(bit.slice('sa_local_session='.length));
  }
  return '';
}

function pageHtml(state) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>로컬 시험 선거</title>
<style>body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0}main{max-width:40rem;margin:0 auto;padding:1rem}button{min-height:44px;margin:.4rem .4rem 0 0}section{border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:.8rem;margin:.7rem 0}.warn{color:#fbbf24;font-weight:700}</style></head>
<body><main>
<p class="warn" id="auth-label">로컬 시험 세션. 실제 Supabase Auth가 아닙니다.</p>
<h1 id="title">${state.title}</h1>
<p id="season">시즌 길이: 미정</p>
<section><h2>프로필</h2><p id="profile">불러오는 중</p><button type="button" id="refresh-btn">새로고침</button></section>
<section><h2>선거</h2><p id="vote-text">${state.voteText}</p>
<button type="button" id="login-btn">시험 세션 로그인</button>
<button type="button" id="vote-btn">투표</button></section>
<section><h2>개표</h2><p id="count-text">${state.countText}</p></section>
<section><h2>공석</h2><p id="vacancy-text">${state.vacancyText}</p></section>
</main>
<script>
var person = ${JSON.stringify(state.person)};
var choice = ${JSON.stringify(state.choice)};
var nowMs = ${JSON.stringify(state.nowMs)};
var ballotId = ${JSON.stringify(state.ballotId)};
function showProfile() {
  return fetch('/profile?person=' + encodeURIComponent(person) + '&country=KR').then(function (res) { return res.json(); }).then(function (body) {
    document.getElementById('profile').textContent = '계급 ' + body.rank + ' / 다시 읽음 ' + body.rankAgain + ' / 점수 ' + body.score;
  });
}
document.getElementById('refresh-btn').addEventListener('click', function () { showProfile(); });
document.getElementById('login-btn').addEventListener('click', function () {
  fetch('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: person }) })
    .then(function (res) { return res.json(); })
    .then(function (body) {
      document.getElementById('auth-label').textContent = body.ok ? '로컬 시험 세션 로그인됨. 실제 Supabase Auth가 아닙니다.' : '로그인 실패';
    });
});
document.getElementById('vote-btn').addEventListener('click', function () {
  fetch('/dev/leader-election/ballots/' + encodeURIComponent(ballotId) + '/votes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ choice: choice, nowMs: nowMs })
  }).then(function (res) { return res.json(); }).then(function (body) {
    document.getElementById('vote-text').textContent = body.ok ? '투표가 서버에 저장되었습니다.' : ('서버가 막았습니다: ' + (body.reason || '실패'));
  });
});
showProfile();
</script></body></html>`;
}

function startServer(dbUrl, sessions, state) {
  process.env.LEADER_ELECTION_BACKEND = 'postgres';
  process.env.LEADER_ELECTION_PG_ISOLATED = '1';
  process.env.LEADER_ELECTION_PG_URL = dbUrl;
  login.setVerifierForTests(function (req) {
    const userId = sessions.get(cookieToken(req));
    if (!userId) return { ok: false, reason: 'AUTH_NOT_CONNECTED' };
    return { ok: true, user: { id: userId }, authKind: 'local-test-session' };
  });
  login.setMembershipReaderForTests(async function () {
    const Client = require('pg').Client;
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const ranks = await client.query('SELECT person_id, country, territory, rank, valid, last_post_at_ms, fame, xp, achievements FROM leader_rank_members');
      const pop = await client.query('SELECT person_id, country, territory, valid, last_post_at_ms FROM leader_population_records');
      const byId = Object.create(null);
      pop.rows.forEach(function (row) {
        byId[row.country + ':' + row.person_id] = {
          id: row.person_id, activity_region: row.country, territory: row.territory,
          valid: row.valid === true, lastPostAtMs: Number(row.last_post_at_ms), rank: 'citizen', rankSource: 'rank-store',
        };
      });
      ranks.rows.forEach(function (row) {
        const key = row.country + ':' + row.person_id;
        const prev = byId[key] || { id: row.person_id, activity_region: row.country, territory: row.territory, lastPostAtMs: Number(row.last_post_at_ms) };
        prev.valid = row.valid === true;
        prev.rank = row.rank;
        prev.rankSource = 'rank-store';
        prev.fame = row.fame;
        prev.xp = row.xp;
        byId[key] = prev;
      });
      return { rows: Object.keys(byId).map(function (key) { return byId[key]; }), liveSupabase: false };
    } finally {
      await client.end();
    }
  });
  const server = http.createServer(async function (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/vote')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageHtml(state));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/profile') {
      const Client = require('pg').Client;
      const client = new Client({ connectionString: dbUrl });
      await client.connect();
      const first = await client.query(
        'SELECT rank, comparison_score FROM leader_rank_members WHERE country=$1 AND person_id=$2',
        [url.searchParams.get('country'), url.searchParams.get('person')]
      );
      const second = await client.query(
        'SELECT rank, comparison_score FROM leader_rank_members WHERE country=$1 AND person_id=$2',
        [url.searchParams.get('country'), url.searchParams.get('person')]
      );
      await client.end();
      const row = first.rows[0] || {};
      const again = second.rows[0] || {};
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ rank: row.rank || null, rankAgain: again.rank || null, score: row.comparison_score, authKind: 'local-test-session' }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/session') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const token = 'local-' + body.userId;
      sessions.set(token, String(body.userId || ''));
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'sa_local_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly',
      });
      res.end(JSON.stringify({ ok: true, authKind: 'local-test-session', productionAuth: false }));
      return;
    }
    if (req.method === 'POST' && url.pathname.indexOf('/dev/leader-election/ballots/') === 0) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const routed = await adapter.routeElection(url.pathname, body, req);
      res.writeHead(routed && routed.ok ? 200 : 403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(routed));
      return;
    }
    res.writeHead(404);
    res.end('missing');
  });
  return new Promise(function (resolve) {
    server.listen(PORT, '127.0.0.1', function () { resolve(server); });
  });
}

function chromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.filter(function (item) { return fs.existsSync(item); })[0] || '';
}

function cdp(ws, method, params) {
  const id = cdp.next = (cdp.next || 0) + 1;
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () { reject(new Error('cdp timeout ' + method)); }, 15000);
    function onMessage(raw) {
      const msg = JSON.parse(String(raw.data || raw));
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result || {});
    }
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  });
}

async function browserVote(shotName) {
  const chrome = chromePath();
  if (!chrome) return { ok: false, reason: 'CHROME_MISSING' };
  const profile = path.join(process.env.TEMP || 'C:\\Temp', 'sa-rank-session-' + process.pid);
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=9223',
    'http://127.0.0.1:' + PORT + '/vote',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let target = null;
    for (let i = 0; i < 20 && !target; i += 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 300); });
      try {
        const list = await fetch('http://127.0.0.1:9223/json');
        const pages = await list.json();
        target = pages.filter(function (item) { return item.type === 'page' && item.webSocketDebuggerUrl; })[0];
      } catch (_err) { target = null; }
    }
    if (!target) return { ok: false, reason: 'CHROME_DEBUG_MISSING', pid: child.pid };
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    await cdp(ws, 'Page.enable');
    await cdp(ws, 'Runtime.evaluate', { expression: 'new Promise(function(r){setTimeout(r,400)})', awaitPromise: true });
    await cdp(ws, 'Runtime.evaluate', { expression: "document.getElementById('login-btn').click()", awaitPromise: true });
    await cdp(ws, 'Runtime.evaluate', { expression: 'new Promise(function(r){setTimeout(r,300)})', awaitPromise: true });
    await cdp(ws, 'Runtime.evaluate', { expression: "document.getElementById('refresh-btn').click()", awaitPromise: true });
    await cdp(ws, 'Runtime.evaluate', { expression: 'new Promise(function(r){setTimeout(r,200)})', awaitPromise: true });
    await cdp(ws, 'Runtime.evaluate', { expression: "document.getElementById('vote-btn').click()", awaitPromise: true });
    await cdp(ws, 'Runtime.evaluate', { expression: 'new Promise(function(r){setTimeout(r,500)})', awaitPromise: true });
    const text = await cdp(ws, 'Runtime.evaluate', { expression: 'document.getElementById("vote-text").textContent', returnByValue: true });
    const profile = await cdp(ws, 'Runtime.evaluate', { expression: 'document.getElementById("profile").textContent', returnByValue: true });
    const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, shotName), Buffer.from(shot.data, 'base64'));
    return { ok: true, voteText: text.result.value, profileText: profile.result.value, pid: child.pid };
  } finally {
    if (ws) ws.close();
    child.kill();
  }
}

async function shotPage(state, fileName) {
  state.title = fileName.indexOf('count') >= 0 ? '개표' : '공석';
  const chrome = chromePath();
  if (!chrome) return { ok: false, reason: 'CHROME_MISSING' };
  const profile = path.join(process.env.TEMP || 'C:\\Temp', 'sa-rank-shot-' + fileName);
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=9224',
    'http://127.0.0.1:' + PORT + '/vote',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let target = null;
    for (let i = 0; i < 20 && !target; i += 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 300); });
      try {
        const list = await fetch('http://127.0.0.1:9224/json');
        const pages = await list.json();
        target = pages.filter(function (item) { return item.type === 'page' && item.webSocketDebuggerUrl; })[0];
      } catch (_err) { target = null; }
    }
    if (!target) return { ok: false, reason: 'CHROME_DEBUG_MISSING' };
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    await cdp(ws, 'Page.enable');
    await cdp(ws, 'Runtime.evaluate', { expression: 'new Promise(function(r){setTimeout(r,500)})', awaitPromise: true });
    const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, fileName), Buffer.from(shot.data, 'base64'));
    return { ok: true };
  } finally {
    if (ws) ws.close();
    child.kill();
  }
}

async function main() {
  const adminUrl = 'postgres://127.0.0.1:5432/postgres';
  const Client = require('pg').Client;
  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 1500 });
  await admin.connect();
  const host = admin.connectionParameters && admin.connectionParameters.host;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    note('stopped', 'REMOTE_HOST');
    await admin.end();
    process.exit(2);
  }
  const dbName = 'rank_election_session_' + process.pid;
  await admin.query('CREATE DATABASE ' + dbName);
  await admin.end();
  const dbUrl = 'postgres://127.0.0.1:5432/' + dbName;
  note('database', dbName);
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  await store.applyMigration(client);
  const asOf = wednesdayMs();
  const inside = asOf - formula.DAY_MS;
  note('krClock', asOf);

  async function member(country, territory, id, fame, evaluators) {
    const saved = await store.storeMemberFacts(client, {
      activityRegion: country, territory: territory, personId: id, xp: 10, fame: fame,
      achievements: ['kept'], valid: true, lastPostAtMs: asOf,
    });
    if (!saved.ok) throw new Error('member ' + saved.reason);
    await client.query(
      'UPDATE leader_rank_members SET unique_positive_evaluators=$4 WHERE country=$1 AND territory=$2 AND person_id=$3',
      [country, territory, id, evaluators]
    );
  }

  const krReps = [];
  for (let i = 1; i <= 6; i += 1) {
    const id = 'kr-rep-' + i;
    krReps.push(id);
    await member('KR', 'pioneer', id, 600 - (i * 40), 120);
  }
  await member('KR', 'pioneer', 'kr-voter', 5, 0);
  await member('KR', 'pioneer', 'kr-closed', 4, 0);
  await member('US', 'pioneer', 'us-rep-1', 80, 120);
  await member('US', 'pioneer', 'us-voter', 7, 0);
  await client.query(
    `INSERT INTO leader_rank_source_flags (country, territory, reactions_connected, follows_connected) VALUES
     ('KR','pioneer',true,true), ('US','pioneer',true,true)`
  );
  await client.query(
    `INSERT INTO leader_rank_scopes (country, territory, territory_population) VALUES ('KR','pioneer',100), ('US','pioneer',100)`
  );
  const reactionRows = [];
  krReps.forEach(function (id, index) {
    for (let n = 0; n < 4 + index; n += 1) {
      reactionRows.push([countryKey(id, n), 'KR', 'pioneer', 'kr-fan-' + id + '-' + n, id, 1, inside, 0]);
    }
  });
  reactionRows.push(['us-r1', 'US', 'pioneer', 'us-fan-1', 'us-rep-1', 1, inside, 0]);
  for (const row of reactionRows) {
    await client.query(
      `INSERT INTO leader_rank_reactions (id, country, territory, actor_id, target_id, polarity, at_ms, fame_delta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      row
    );
  }
  await client.query(
    `INSERT INTO leader_rank_follows (id, country, territory, follower_id, target_id, at_ms) VALUES
     ('kr-f1','KR','pioneer','kr-voter','kr-rep-1',$1),
     ('us-f1','US','pioneer','us-voter','us-rep-1',$1)`,
    [inside]
  );
  const missing = await store.applyRankFormula(client, { country: 'ZZ', territory: 'pioneer', asOfMs: asOf });
  note('missingCountry', missing.reason);
  const usAuto = await store.applyRankFormula(client, { country: 'US', territory: 'pioneer', asOfMs: asOf, auto: true });
  note('usAuto', usAuto.reason);
  const krRank = await store.applyRankFormula(client, { country: 'KR', territory: 'pioneer', asOfMs: asOf });
  const usRank = await store.applyRankFormula(client, { country: 'US', territory: 'pioneer', asOfMs: asOf });
  note('krRankApplied', krRank.applied === true);
  note('usRankApplied', usRank.applied === true && usRank.reason !== 'US_TIMEZONE_UNCONFIRMED');
  const ranks = await client.query(
    `SELECT country, person_id, rank, comparison_score, fame FROM leader_rank_members ORDER BY country, person_id`
  );
  const again = await client.query(
    `SELECT country, person_id, rank, comparison_score FROM leader_rank_members WHERE person_id='kr-rep-1'`
  );
  note('ranks', ranks.rows);
  note('profileReread', again.rows[0]);
  const krScore = ranks.rows.filter(function (row) { return row.person_id === 'kr-rep-1'; })[0];
  const usScore = ranks.rows.filter(function (row) { return row.person_id === 'us-rep-1'; })[0];
  note('scoresDiffer', krScore && usScore && String(krScore.comparison_score) !== String(usScore.comparison_score));

  const people = ['kr-voter'];
  for (let i = 1; i <= 999; i += 1) people.push('pop-' + i);
  await store.seedPopulation(client, { country: 'KR', territory: 'pioneer', people: people, nowMs: asOf });
  await store.ensureOffice(client, { id: 'office:KR:pioneer', country: 'KR', territory: 'pioneer', vacancyId: 'vacancy-kr-1' });
  const opened = await store.openFilingRound(client, { country: 'KR', territory: 'pioneer', nowMs: asOf, roundId: 'round-kr-1' });
  note('filing', opened.ok === true && opened.stored === true);
  const notRep = await store.fileCandidacy(client, { country: 'KR', territory: 'pioneer', personId: 'kr-voter', nowMs: asOf });
  const fileA = await store.fileCandidacy(client, { country: 'KR', territory: 'pioneer', personId: 'kr-rep-1', nowMs: asOf });
  const fileB = await store.fileCandidacy(client, { country: 'KR', territory: 'pioneer', personId: 'kr-rep-2', nowMs: asOf });
  note('ineligibleFile', notRep.reason);
  note('filed', fileA.ok === true && fileB.ok === true);
  const ballot = await store.openBallot(client, { roundId: 'round-kr-1', nowMs: asOf + store.FILING_MS, ballotId: 'ballot-kr-1' });
  note('ballot', ballot.ok === true);
  const voteAt = asOf + store.FILING_MS + 1000;

  const sessions = new Map();
  const view = {
    title: '투표',
    person: 'kr-voter',
    choice: 'kr-rep-1',
    nowMs: voteAt,
    ballotId: 'ballot-kr-1',
    voteText: '아직 투표하지 않았습니다.',
    countText: '개표 전입니다.',
    vacancyText: '공석이 아닙니다.',
  };
  const server = await startServer(dbUrl, sessions, view);
  note('serverPid', process.pid);
  const clicked = await browserVote('vote-click.png');
  note('browserVote', clicked);
  const savedVote = await client.query('SELECT voter_id, choice FROM leader_casts');
  note('savedVote', savedVote.rows);

  async function postVote(userId, body) {
    const token = 'script-' + userId;
    sessions.set(token, userId);
    return fetch('http://127.0.0.1:' + PORT + '/dev/leader-election/ballots/ballot-kr-1/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'sa_local_session=' + encodeURIComponent(token) },
      body: JSON.stringify(body),
    }).then(function (res) { return res.json(); });
  }
  const anon = await fetch('http://127.0.0.1:' + PORT + '/dev/leader-election/ballots/ballot-kr-1/votes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice: 'kr-rep-1', nowMs: voteAt }),
  }).then(function (res) { return res.json(); });
  const againVote = await postVote('kr-voter', { choice: 'kr-rep-1', nowMs: voteAt + 1 });
  const otherCountry = await postVote('us-voter', { choice: 'kr-rep-1', nowMs: voteAt + 2 });
  await client.query("UPDATE leader_rank_members SET valid=false WHERE person_id='kr-closed'");
  const ineligible = await postVote('kr-closed', { choice: 'kr-rep-1', nowMs: voteAt + 3 });
  const closed = await postVote('pop-1', { choice: 'kr-rep-1', nowMs: ballot.endsAtMs + 1 });
  note('blocks', {
    anon: anon.reason || anon.ok,
    duplicate: againVote.reason || againVote.ok,
    otherCountry: otherCountry.reason || otherCountry.ok,
    ineligible: ineligible.reason || ineligible.ok,
    closed: closed.reason || closed.ok,
  });
  const counted = await store.resolveRound(client, { roundId: 'round-kr-1', nowMs: ballot.endsAtMs });
  const office = await store.readOffice(client, 'KR', 'pioneer');
  const leaders = await client.query("SELECT count(*)::int AS n FROM leader_offices WHERE leader_id IS NOT NULL");
  const appointed = await client.query('SELECT person_id, at_ms FROM leader_appointments');
  note('count', { appointed: counted.appointed, personId: counted.personId, leaders: leaders.rows[0].n, atMs: appointed.rows[0] && appointed.rows[0].at_ms });
  view.countText = counted.appointed ? ('당선 ' + counted.personId + ' 1명. 취임 시각이 저장되었습니다.') : ('개표 실패 ' + (counted.reason || counted.result));
  view.person = 'kr-rep-1';
  await shotPage(view, 'count.png');

  const plan = term.planTerm({ inauguratedAtMs: Number(appointed.rows[0].at_ms), seasonId: null });
  note('termPlan', { seasonLength: plan.seasonLength, seasonEndAtMs: plan.seasonEndAtMs, threeMonthAtMs: plan.threeMonthAtMs, earlierReason: plan.earlierReason });

  const proposed = await store.proposeImpeachment(client, { country: 'KR', territory: 'pioneer', personId: 'kr-rep-2', nowMs: ballot.endsAtMs + 10, proposalId: 'impeach-kr-1' });
  note('proposal', proposed.ok === true);
  const repVotes = [];
  for (let i = 2; i <= 6; i += 1) {
    repVotes.push(await store.castImpeachmentVote(client, {
      proposalId: 'impeach-kr-1', voterId: 'kr-rep-' + i, choice: 'yes', nowMs: ballot.endsAtMs + 20,
    }));
  }
  const repClose = await store.closeImpeachment(client, { proposalId: 'impeach-kr-1', nowMs: ballot.endsAtMs + 30 });
  note('repVote', { votes: repVotes.map(function (row) { return row.ok; }), passed: repClose.passed });
  for (let i = 1; i <= 200; i += 1) {
    const cast = await store.castImpeachmentVote(client, {
      proposalId: 'impeach-kr-1:citizen', voterId: i === 1 ? 'kr-voter' : ('pop-' + i), choice: 'yes', nowMs: ballot.endsAtMs + 40,
    });
    if (!cast.ok) {
      note('citizenVoteFailed', cast.reason);
      break;
    }
  }
  const citizenClose = await store.closeImpeachment(client, { proposalId: 'impeach-kr-1:citizen', nowMs: ballot.endsAtMs + 50 });
  const removed = await store.removeOffice(client, { country: 'KR', territory: 'pioneer', nowMs: ballot.endsAtMs + 60, reason: 'IMPEACHMENT' });
  const afterRemoval = await store.readOffice(client, 'KR', 'pioneer');
  const leaderCount = await client.query("SELECT count(*)::int AS n FROM leader_offices WHERE leader_id IS NOT NULL");
  note('vacancy', { citizenPassed: citizenClose.passed, removed: removed.ok, leaderId: afterRemoval.leader_id, leaders: leaderCount.rows[0].n });
  view.vacancyText = afterRemoval.leader_id == null ? '해임 후 공석입니다. 지도자는 0명입니다.' : '공석이 아닙니다.';
  view.countText = view.countText;
  await shotPage(view, 'vacancy.png');

  const refile = await store.openFilingRound(client, { country: 'KR', territory: 'pioneer', nowMs: ballot.endsAtMs + 60 + store.VACANT_MS, roundId: 'round-kr-2' });
  const byFile = await store.fileCandidacy(client, { country: 'KR', territory: 'pioneer', personId: 'kr-rep-3', nowMs: ballot.endsAtMs + 60 + store.VACANT_MS + 10 });
  const byEnd = ballot.endsAtMs + 60 + store.VACANT_MS + store.FILING_MS;
  const byAppoint = await store.resolveRound(client, { roundId: 'round-kr-2', nowMs: byEnd });
  const afterBy = await client.query("SELECT count(*)::int AS n FROM leader_offices WHERE leader_id IS NOT NULL");
  const byRow = await client.query("SELECT person_id, at_ms FROM leader_appointments ORDER BY at_ms DESC LIMIT 1");
  note('byElection', { opened: refile.ok, filed: byFile.ok, appointed: byAppoint.appointed, personId: byAppoint.personId, leaders: afterBy.rows[0].n });

  const byPlan = term.planTerm({ inauguratedAtMs: Number(byRow.rows[0].at_ms), seasonId: null });
  const agendaOne = agenda.assess({
    country: 'KR', timezone: 'Asia/Seoul', weekIndex: 0, weekday: 'Mon',
    offices: [{ country: 'KR', territory: 'pioneer', leaderId: byAppoint.personId }],
    drafts: [{ country: 'KR', territory: 'pioneer', authorId: byAppoint.personId, weekday: 'Fri', title: '주거', body: '토론' }],
  });
  const agendaUs = agenda.assess({ country: 'US', timezone: 'US_TIMEZONE_UNCONFIRMED', weekIndex: 0, weekday: 'Mon' });
  const agendaMany = agenda.assess({
    country: 'KR', timezone: 'Asia/Seoul', weekIndex: 0, weekday: 'Mon',
    offices: [{ country: 'KR', territory: 'pioneer', leaderId: byAppoint.personId }],
    drafts: [
      { country: 'KR', territory: 'pioneer', authorId: byAppoint.personId, weekday: 'Fri', title: '가', body: '가' },
      { country: 'KR', territory: 'pioneer', authorId: byAppoint.personId, weekday: 'Sat', title: '나', body: '나' },
    ],
  });
  note('agenda', { one: agendaOne.published === true && agendaOne.board === 'central', us: agendaUs.reason, many: agendaMany.reason });
  const ended = await store.removeOffice(client, { country: 'KR', territory: 'pioneer', nowMs: byPlan.earlierAtMs, reason: byPlan.earlierReason });
  const finalOffice = await store.readOffice(client, 'KR', 'pioneer');
  const finalRank = await client.query("SELECT rank FROM leader_rank_members WHERE country='KR' AND person_id=$1", [byAppoint.personId]);
  const finalLeaders = await client.query("SELECT count(*)::int AS n FROM leader_offices WHERE leader_id IS NOT NULL");
  note('termEnd', {
    removed: ended.ok,
    leaderId: finalOffice.leader_id,
    rank: finalRank.rows[0] && finalRank.rows[0].rank,
    leaders: finalLeaders.rows[0].n,
    seasonEnd: byPlan.seasonEndAtMs,
    holdsAfter: term.authorityAt(byPlan, byPlan.earlierAtMs).holdsOffice,
  });
  note('firstTerm', { seasonEnd: plan.seasonEndAtMs, earlierReason: plan.earlierReason });
  await client.end();
  server.close();
  login.clearVerifierForTests();
  login.clearMembershipReaderForTests();
  note('done', true);
}

function countryKey(id, n) {
  return 'rx-' + id + '-' + n;
}

main().catch(function (err) {
  note('error', String(err && err.stack || err));
  process.exit(1);
});
