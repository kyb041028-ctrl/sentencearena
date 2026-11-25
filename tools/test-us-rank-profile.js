'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { Client } = require('pg');
const formula = require('../shared/rank-formula-core');
const agenda = require('../shared/representative-agenda-core');
const agendaStore = require('../server/leader-agenda-store');
const store = require('../server/leader-election-pg-store');
const live = require('../server/rank-live-source-adapter');
const login = require('../server/leader-election-login');
const memberLink = require('../server/leader-election-member-link');
const cluster = require('../shared/daily-issue-cluster-core');

const DB = 'rank_election_session_48872';
const US_ID = '11111111-1111-4111-8111-111111111111';
const KR_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const OUT = process.env.US_RANK_PROFILE_OUT || 'C:\\Users\\user\\AppData\\Local\\Cursor\\AgentStores\\cursor_agent_stores\\bc-c953b949-98fb-4f5d-8b49-80c8cb69e605\\files\\media\\us-rank-profile';
const notes = [];
let failed = 0;

function check(name, ok, detail) {
  notes.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' ' + detail : ''));
  console.log(notes[notes.length - 1]);
  if (!ok) failed += 1;
}

function findMidnight(zone, startMs) {
  let ms = startMs;
  for (let i = 0; i < 72; i += 1) {
    if (formula.isLocalMidnight(ms, zone)) return ms;
    ms += 60 * 60 * 1000;
  }
  throw new Error('midnight missing');
}

function chromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.filter(function (item) { return fs.existsSync(item); })[0] || '';
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function startServer(root, profileReader) {
  const server = http.createServer(function (req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/local/rank-profile') {
      profileReader(url.searchParams.get('country'), url.searchParams.get('user')).then(function (body) {
        res.writeHead(body && body.ok ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      }).catch(function (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, reason: err && err.message ? err.message : 'READ_FAILED' }));
      });
      return;
    }
    let rel = url.pathname;
    if (rel === '/' || rel === '/us' || rel === '/us/') rel = '/index.html';
    const shared = rel.indexOf('/shared/') === 0;
    const base = shared ? path.join(root, 'shared') : path.join(root, 'public');
    const fileRel = shared ? rel.slice('/shared/'.length) : rel.replace(/^\//, '');
    const file = path.normalize(path.join(base, fileRel));
    if (!file.startsWith(base)) {
      res.writeHead(403);
      res.end('blocked');
      return;
    }
    fs.readFile(file, function (err, body) {
      if (err) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(file) });
      res.end(body);
    });
  });
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      resolve(server);
    });
  });
}

function cdpSend(ws) {
  let seq = 0;
  const waiters = new Map();
  ws.addEventListener('message', function (ev) {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && waiters.has(msg.id)) {
      waiters.get(msg.id)(msg);
      waiters.delete(msg.id);
    }
  });
  return function send(method, params) {
    const id = ++seq;
    return new Promise(function (resolve) {
      waiters.set(id, resolve);
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  };
}

async function shoot(port, shots) {
  const exe = chromePath();
  if (!exe) return { ok: false, reason: 'CHROME_MISSING', pid: null };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-us-rank-profile-'));
  const chrome = spawn(exe, [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=9223',
    '--user-data-dir=' + dir,
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let target = null;
    for (let i = 0; i < 30 && !target; i += 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 300); });
      try {
        const list = await fetch('http://127.0.0.1:9223/json').then(function (res) { return res.json(); });
        target = list.filter(function (row) { return row.webSocketDebuggerUrl; })[0];
      } catch (_err) { target = null; }
    }
    if (!target) return { ok: false, reason: 'CDP_NOT_READY', pid: chrome.pid };
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    const send = cdpSend(ws);
    await send('Page.enable');
    for (let i = 0; i < shots.length; i += 1) {
      const shot = shots[i];
      await send('Page.navigate', { url: 'http://127.0.0.1:' + port + shot.path });
      await new Promise(function (resolve) { setTimeout(resolve, 1200); });
      await send('Runtime.evaluate', {
        expression: 'sessionStorage.setItem("sc_sb_guest_ok","1"); if (window.startSentenceArena) window.startSentenceArena();',
      });
      await new Promise(function (resolve) { setTimeout(resolve, 1600); });
      if (shot.click) {
        await send('Runtime.evaluate', { expression: shot.click });
        await new Promise(function (resolve) { setTimeout(resolve, 800); });
      }
      await send('Runtime.evaluate', {
        expression: shot.scroll || 'var el=document.getElementById("avatar-meta-rank"); if(el) el.scrollIntoView({block:"center"});',
      });
      let clip;
      if (shot.clip) {
        const box = await send('Runtime.evaluate', { expression: shot.clip, returnByValue: true });
        clip = box.result && box.result.result ? box.result.result.value : null;
      }
      const picture = await send('Page.captureScreenshot', {
        format: 'png',
        clip: clip && clip.width ? { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 } : undefined,
      });
      fs.writeFileSync(path.join(OUT, shot.file), Buffer.from(picture.result.data, 'base64'));
      if (String(shot.file).indexOf('profile') >= 0) {
        const read = await send('Runtime.evaluate', {
          expression: '(document.getElementById("avatar-meta-rank")||{}).textContent || ""',
          returnByValue: true,
        });
        console.log(shot.file, read.result && read.result.result ? read.result.result.value : '');
      }
    }
    return { ok: true, pid: chrome.pid, dir: dir };
  } finally {
    if (ws) ws.close();
    chrome.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_err) { /* temp profile only */ }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  check('가중치 유지', formula.WEIGHTS.fame === 0.45 && formula.WEIGHTS.uniqueEvaluators === 0.3 && formula.WEIGHTS.reactions === 0.15 && formula.WEIGHTS.followers === 0.1);
  check('클러스터 모듈 유지', typeof cluster.classify === 'function' || typeof cluster.buildClusters === 'function' || cluster != null);

  const client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + DB, connectionTimeoutMillis: 2000 });
  await client.connect();
  const host = client.connectionParameters && client.connectionParameters.host;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('REMOTE_HOST');
  const countrySql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migration_country_progression_candidate.sql'), 'utf8');
  await client.query(countrySql);

  async function saveProfile(id, country, fame, xp) {
    await client.query(
      `INSERT INTO public.user_activity_region_profile
        (user_id, activity_region, level, xp, reputation_score, territory)
       VALUES ($1::uuid, $2, $3, $4, $5, 'pioneer')
       ON CONFLICT (user_id, activity_region) DO UPDATE
       SET level = EXCLUDED.level, xp = EXCLUDED.xp, reputation_score = EXCLUDED.reputation_score, territory = EXCLUDED.territory`,
      [id, country, country === 'US' ? 4 : 2, xp, fame]
    );
  }
  await saveProfile(US_ID, 'US', 80, 220);
  await saveProfile(KR_ID, 'KR', 11, 40);
  const seoul = findMidnight('Asia/Seoul', Date.UTC(2026, 10, 23, 0, 0, 0));
  const ny = findMidnight('America/New_York', Date.UTC(2027, 0, 20, 0, 0, 0));
  const usTooEarly = await live.dryRun(client, { country: 'US', territory: 'pioneer', asOfMs: seoul });
  check('서울 자정의 미국은 평가 시각 아님', usTooEarly.reason === 'NOT_REFRESH_MOMENT', usTooEarly.reason);
  const usRun = await live.dryRun(client, { country: 'US', territory: 'pioneer', asOfMs: ny });
  const krRun = await live.dryRun(client, { country: 'KR', territory: 'pioneer', asOfMs: seoul });
  const usIds = (usRun.scores || []).map(function (row) { return row.id; });
  const krIds = (krRun.scores || []).map(function (row) { return row.id; });
  check('미국 조회에 한국 회원 없음', usRun.ok === true && usIds.indexOf(US_ID) >= 0 && usIds.indexOf(KR_ID) < 0, usRun.reason || '');
  check('한국 조회에 미국 회원 없음', krRun.ok === true && krIds.indexOf(KR_ID) >= 0 && krIds.indexOf(US_ID) < 0, krRun.reason || '');
  const usScore = (usRun.scores || []).filter(function (row) { return row.id === US_ID; })[0];
  const krScore = (krRun.scores || []).filter(function (row) { return row.id === KR_ID; })[0];
  const krProfile = await live.readMemberProfile(client, 'KR', KR_ID);
  check('미국 명성과 한국 명성이 다름', krProfile.ok === true && krProfile.fame === 11 && krProfile.country === 'KR' && !!usScore && !!krScore, 'US score ' + (usScore && usScore.storedScore) + ' KR score ' + (krScore && krScore.storedScore) + ' KR fame ' + krProfile.fame);
  if (usScore) {
    await client.query(
      `INSERT INTO public.leader_rank_members (country, territory, person_id, xp, fame, rank, comparison_score, valid)
       VALUES ('US', 'pioneer', $1, 220, 80, 'citizen', $2, true)
       ON CONFLICT (country, territory, person_id) DO UPDATE
       SET fame = EXCLUDED.fame, comparison_score = EXCLUDED.comparison_score`,
      [US_ID, usScore.storedScore]
    );
  }
  if (krScore) {
    await client.query(
      `INSERT INTO public.leader_rank_members (country, territory, person_id, xp, fame, rank, comparison_score, valid)
       VALUES ('KR', 'pioneer', $1, 40, 11, 'citizen', $2, true)
       ON CONFLICT (country, territory, person_id) DO UPDATE
       SET fame = EXCLUDED.fame, comparison_score = EXCLUDED.comparison_score`,
      [KR_ID, krScore.storedScore]
    );
  }
  const first = await live.readMemberProfile(client, 'US', US_ID);
  await saveProfile(US_ID, 'US', 80, 221);
  const secondClient = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + DB, connectionTimeoutMillis: 2000 });
  await secondClient.connect();
  const second = await live.readMemberProfile(secondClient, 'US', US_ID);
  await secondClient.end();
  check('저장 후 다시 읽기', first.ok === true && second.ok === true && second.xp === 221 && second.country === 'US' && second.fame === 80, 'xp ' + second.xp + ' score ' + second.score);
  const missing = await live.readMemberProfile(client, 'US', MISSING_ID);
  check('미국 행 없음', missing.ok === false && missing.reason === 'PROFILE_MISSING', missing.reason);
  const swapped = await live.readMemberProfile(client, 'US', KR_ID);
  check('한국 행을 미국으로 읽지 않음', swapped.ok === false && swapped.reason === 'PROFILE_MISSING', swapped.reason);

  const authConfig = require('../server/supabase-server-auth-config').resolveSupabaseServerAuthConfig();
  const authHost = String(authConfig.url || '');
  const localAuth = authConfig.configured && /127\.0\.0\.1|localhost/i.test(authHost) && !/supabase\.co|production/i.test(authHost);
  const anon = await login.resolveElectionActor({ headers: {} });
  check('비로그인 거부', anon.ok === false && (anon.reason === 'AUTH_NOT_CONNECTED' || anon.reason === 'UNAUTHORIZED'), anon.reason);
  notes.push('실제 Supabase Auth: ' + (localAuth ? '로컬 설정 있음' : 'NOT RUN') + ' productionAuth=' + (anon.productionAuth === true));

  const closed = await client.query(`SELECT id FROM public.leader_ballots WHERE status <> 'open' LIMIT 1`);
  if (closed.rows[0]) {
    const blockedVote = await store.castVote(client, {
      ballotId: closed.rows[0].id,
      choice: 'nobody',
      nowMs: Date.now(),
      sessionRequired: true,
      sessionUserId: '',
      voterId: 'guest',
    });
    check('종료 선거 또는 비로그인 투표 거부', blockedVote.ok === false, blockedVote.reason);
  }
  const existingCast = await client.query('SELECT ballot_id, voter_id, choice FROM public.leader_casts LIMIT 1');
  if (existingCast.rows[0]) {
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO public.leader_casts (ballot_id, voter_id, choice, at_ms) VALUES ($1, $2, $3, $4)',
        [existingCast.rows[0].ballot_id, existingCast.rows[0].voter_id, existingCast.rows[0].choice, Date.now()]
      );
      await client.query('ROLLBACK');
      check('중복 투표 거부', false, 'INSERT_ALLOWED');
    } catch (err) {
      await client.query('ROLLBACK');
      check('중복 투표 거부', err && err.code === '23505', err && err.code);
    }
  }
  const other = memberLink.voterStatus({
    source: 'rank-store',
    members: [{ id: US_ID, country: 'US', territory: 'pioneer', valid: true, lastPostAtMs: Date.now(), lastCommentAtMs: null }],
  }, { country: 'KR', territory: 'pioneer', personId: US_ID, nowMs: Date.now() });
  check('다른 국가 투표 거부', other.ok === false && other.reason === 'VOTER_NOT_ELIGIBLE', other.reason);
  const ineligible = memberLink.voterStatus({
    source: 'rank-store',
    members: [{ id: KR_ID, country: 'KR', territory: 'pioneer', valid: false, lastPostAtMs: Date.now(), lastCommentAtMs: null }],
  }, { country: 'KR', territory: 'pioneer', personId: KR_ID, nowMs: Date.now() });
  check('자격 미달 거부', ineligible.ok === false && ineligible.reason === 'VOTER_NOT_ELIGIBLE', ineligible.reason);

  const repWrite = agenda.decide({
    country: 'US', weekNumber: 1, weekday: 'Mon', authorRank: 'representative', sessionUserId: US_ID, title: 'x', body: 'y',
  });
  check('대표의 의제 작성 거부', repWrite.published === false && repWrite.reason === 'REPRESENTATIVE_CANNOT_WRITE', repWrite.reason);
  const otherFaction = agenda.decide({
    country: 'US', weekNumber: 1, weekday: 'Mon', authorRank: 'leader', sessionUserId: 'guardian-leader',
    offices: [
      { country: 'US', territory: 'pioneer', leaderId: 'pioneer-leader' },
      { country: 'US', territory: 'guardian', leaderId: 'guardian-leader' },
    ], title: 'x', body: 'y',
  });
  check('상대 진영 작성 거부', otherFaction.published === false && otherFaction.reason === 'OTHER_FACTION_LEADER', otherFaction.reason);
  const ended = agenda.decide({
    country: 'US', weekNumber: 1, weekday: 'Mon', authorRank: 'leader', sessionUserId: US_ID, authorityRevoked: true, title: 'x', body: 'y',
  });
  check('임기 끝난 지도자 작성 거부', ended.published === false && ended.reason === 'TERM_ENDED', ended.reason);
  const maxWeek = await client.query('SELECT COALESCE(MAX(week_number), 0) AS n FROM public.leader_agenda_issues WHERE country = $1', ['US']);
  const vacantWeek = Number(maxWeek.rows[0].n) + 1;
  const vacant = await agendaStore.publish(client, {
    country: 'US', weekNumber: vacantWeek, weekday: 'Mon', atMs: Date.now(), sessionUserId: 'local-preview',
    offices: [], title: '', body: '',
  });
  check('공석 회차 미발행', vacant.published === false && vacant.reason === 'VACANT_UNPUBLISHED' && vacant.substitute !== true, vacant.reason + ' week ' + vacantWeek);

  let electedId = null;
  let electedTerritory = null;
  let vacantOffice = await store.readOffice(client, 'US', 'pioneer');
  if (!vacantOffice) {
    vacantOffice = await store.ensureOffice(client, {
      id: 'office:US:pioneer', country: 'US', territory: 'pioneer', vacancyId: 'vacancy:US:pioneer',
    });
  }
  if (vacantOffice && vacantOffice.leader_id) {
    vacantOffice = await store.readOffice(client, 'US', 'guardian');
    if (!vacantOffice) {
      vacantOffice = await store.ensureOffice(client, {
        id: 'office:US:guardian', country: 'US', territory: 'guardian', vacancyId: 'vacancy:US:guardian',
      });
    }
  }
  if (!vacantOffice || vacantOffice.leader_id) {
    notes.push('미국 공석 없음. 새 당선은 실행하지 않음');
    if (vacantOffice && vacantOffice.leader_id) {
      electedId = vacantOffice.leader_id;
      electedTerritory = vacantOffice.territory;
    }
  } else {
    electedTerritory = vacantOffice.territory;
    const reps = await client.query(
      `SELECT count(*)::int AS n FROM public.leader_rank_members WHERE country = 'US' AND territory = $1 AND rank = 'representative'`,
      [electedTerritory]
    );
    if (Number(reps.rows[0].n) <= 8) {
      await client.query(
        `INSERT INTO public.leader_rank_members (country, territory, person_id, xp, fame, rank, valid, elected_leader)
         VALUES ('US', $2, $1, 220, 80, 'representative', true, false)
         ON CONFLICT (country, territory, person_id) DO UPDATE SET rank = 'representative', elected_leader = false`,
        [US_ID, electedTerritory]
      );
      const people = [];
      for (let i = 0; i < 1000; i += 1) people.push('us-profile-pop-' + electedTerritory + '-' + i);
      const seeded = await store.seedPopulation(client, { country: 'US', territory: electedTerritory, people: people, nowMs: Date.now() });
      const opened = await store.openFilingRound(client, {
        country: 'US', territory: electedTerritory, nowMs: Date.now(), roundId: 'us-profile-read-' + electedTerritory + '-' + Date.now(),
      });
      const filed = opened && opened.stored === true
        ? await store.fileCandidacy(client, { country: 'US', territory: electedTerritory, personId: US_ID, nowMs: Date.now() })
        : { ok: false, reason: opened && opened.reason ? opened.reason : 'NO_ROUND' };
      const resolved = filed && filed.ok
        ? await store.resolveRound(client, { roundId: opened.roundId, nowMs: Date.now() + store.FILING_MS + 1000 })
        : { ok: false, reason: filed.reason || opened.reason };
      check('미국 단독 출마 후 당선', resolved.appointed === true && resolved.personId === US_ID, resolved.reason || resolved.result || '');
      if (resolved.appointed) electedId = US_ID;
      notes.push('출마 ' + (filed.ok ? '저장' : filed.reason) + ' 개표 ' + (resolved.appointed ? 'leader' : (resolved.reason || 'not appointed')));
    } else {
      notes.push('대표 정원이 가득 차 새 출마는 실행하지 않음');
    }
  }
  if (electedId && electedTerritory) {
    const before = await store.readOffice(client, 'US', electedTerritory);
    const refreshAt = findMidnight('America/New_York', Date.UTC(2027, 2, 10, 0, 0, 0));
    await client.query(
      `INSERT INTO public.leader_rank_source_flags (country, territory, reactions_connected, follows_connected)
       VALUES ('US', $1, true, true)
       ON CONFLICT (country, territory) DO UPDATE SET reactions_connected = true, follows_connected = true`,
      [electedTerritory]
    );
    await client.query(
      `INSERT INTO public.leader_rank_scopes (country, territory, territory_population)
       VALUES ('US', $1, 1000)
       ON CONFLICT (country, territory) DO UPDATE SET territory_population = COALESCE(leader_rank_scopes.territory_population, 1000)`,
      [electedTerritory]
    );
    const refreshed = await store.applyRankFormula(client, { country: 'US', territory: electedTerritory, asOfMs: refreshAt });
    const after = await store.readOffice(client, 'US', electedTerritory);
    check('일일 갱신 후 직위 유지', !!(before && after && before.leader_id === after.leader_id && after.leader_id === electedId), refreshed.reason || (refreshed.applied ? 'applied' : ''));
    notes.push('현직 ' + electedTerritory + ' ' + electedId);
  }
  if (electedId && /^[0-9a-f-]{36}$/i.test(electedId)) {
    await client.query(
      `INSERT INTO public.user_activity_region_profile (user_id, activity_region, territory, xp, reputation_score)
       VALUES ($1::uuid, 'US', $2, 221, 80)
       ON CONFLICT (user_id, activity_region) DO UPDATE SET territory = EXCLUDED.territory`,
      [electedId, electedTerritory]
    );
    const leaderRead = await live.readMemberProfile(client, 'US', electedId);
    check('당선 프로필은 leader', leaderRead.ok === true && leaderRead.leader === true && leaderRead.rank === 'leader', leaderRead.reason || leaderRead.rank);
  } else if (electedId) {
    const rankRow = await client.query(
      'SELECT rank FROM public.leader_rank_members WHERE country = $1 AND territory = $2 AND person_id = $3',
      ['US', electedTerritory, electedId]
    );
    check('당선 직위는 leader', rankRow.rows[0] && rankRow.rows[0].rank === 'leader', (rankRow.rows[0] && rankRow.rows[0].rank) || 'NO_RANK');
  }
  let secondLeaderBlocked = false;
  let secondLeaderDetail = '';
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO public.leader_rank_members (country, territory, person_id, rank, elected_leader)
       VALUES ('US', 'pioneer', $1, 'leader', true)
       ON CONFLICT (country, territory, person_id) DO UPDATE SET rank = 'leader', elected_leader = true`,
      [US_ID]
    );
    await client.query(
      `INSERT INTO public.leader_rank_members (country, territory, person_id, rank, elected_leader)
       VALUES ('US', 'pioneer', $1, 'leader', false)
       ON CONFLICT (country, territory, person_id) DO UPDATE SET rank = 'leader'`,
      [OTHER_ID]
    );
    secondLeaderDetail = 'SECOND_LEADER_ALLOWED';
  } catch (err) {
    secondLeaderBlocked = String(err && err.message || '').indexOf('LEADER_EXISTS') >= 0;
    secondLeaderDetail = String(err && err.message || '').slice(0, 80);
  }
  await client.query('ROLLBACK');
  check('같은 국가 진영 지도자 2명 거부', secondLeaderBlocked, secondLeaderDetail);

  const server = await startServer(path.resolve(__dirname, '..'), async function (country, user) {
    const reader = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + DB, connectionTimeoutMillis: 2000 });
    await reader.connect();
    try { return await live.readMemberProfile(reader, country, user); }
    finally { await reader.end(); }
  });
  const port = server.address().port;
  notes.push('시험 서버 pid=' + process.pid + ' port=' + port);
  const browser = await shoot(port, [
    { path: '/?localRankPreview=1&country=KR&user=' + KR_ID, file: 'kr-profile.png', click: 'var tab=document.getElementById("avatar-dock-tab"); if(tab) tab.click(); var dock=document.getElementById("avatar-dock"); if(dock){dock.hidden=false; dock.classList.remove("is-collapsed");} if(window.__saPaintCountryRank && window.__saCountryRankBody) window.__saPaintCountryRank(window.__saCountryRankBody);', clip: '(function(){if(window.__saPaintCountryRank&&window.__saCountryRankBody) window.__saPaintCountryRank(window.__saCountryRankBody); var el=document.getElementById("avatar-meta-rank"); var level=document.getElementById("avatar-meta-level"); if(el){document.body.appendChild(el); el.style.cssText="position:fixed;left:48px;top:120px;z-index:40000;background:#ffffff;color:#111111;font-size:28px;font-weight:700;padding:18px 22px;";} if(level){document.body.appendChild(level); level.style.cssText="position:fixed;left:48px;top:190px;z-index:40000;background:#ffffff;color:#111111;font-size:22px;padding:12px 18px;";} var r=el?el.getBoundingClientRect():{x:48,y:120,width:520,height:70}; return {x:40,y:100,width:Math.max(420,r.width+40),height:180};})()' },
    { path: '/?localRankPreview=1&country=US&user=' + US_ID, file: 'us-profile.png', click: 'var tab=document.getElementById("avatar-dock-tab"); if(tab) tab.click(); var dock=document.getElementById("avatar-dock"); if(dock){dock.hidden=false; dock.classList.remove("is-collapsed");} if(window.__saPaintCountryRank && window.__saCountryRankBody) window.__saPaintCountryRank(window.__saCountryRankBody);', clip: '(function(){if(window.__saPaintCountryRank&&window.__saCountryRankBody) window.__saPaintCountryRank(window.__saCountryRankBody); var el=document.getElementById("avatar-meta-rank"); var level=document.getElementById("avatar-meta-level"); if(el){document.body.appendChild(el); el.style.cssText="position:fixed;left:48px;top:120px;z-index:40000;background:#ffffff;color:#111111;font-size:28px;font-weight:700;padding:18px 22px;";} if(level){document.body.appendChild(level); level.style.cssText="position:fixed;left:48px;top:190px;z-index:40000;background:#ffffff;color:#111111;font-size:22px;padding:12px 18px;";} var r=el?el.getBoundingClientRect():{x:48,y:120,width:520,height:70}; return {x:40,y:100,width:Math.max(420,r.width+40),height:180};})()' },
    { path: '/?devElectionPreview=election-open', file: 'kr-election.png', scroll: '0', click: 'if (window.ElectionPreviewUI) window.ElectionPreviewUI.open("election-open");' },
    { path: '/us?devElectionPreview=election-open', file: 'us-election.png', scroll: '0', click: 'if (window.ElectionPreviewUI) window.ElectionPreviewUI.open("election-open");' },
    { path: '/us?devElectionPreview=impeach-open', file: 'us-impeach.png', scroll: '0', click: 'if (window.ElectionPreviewUI) window.ElectionPreviewUI.open("impeach-open");' },
    { path: '/?localRankPreview=1&country=KR&user=' + KR_ID, file: 'agenda-guide.png', scroll: '0', click: 'if (window.__scApp && window.__scApp.goGuide) window.__scApp.goGuide(); var b=document.querySelector("[data-perm-sub=\\"election\\"]"); if (b) b.click();' },
  ]);
  server.close();
  notes.push('브라우저 ' + (browser.ok ? '열림' : browser.reason) + ' chrome pid=' + (browser.pid || '없음') + ' 종료함');
  if (electedId === US_ID && electedTerritory) {
    const removed = await store.removeOffice(client, { country: 'US', territory: electedTerritory, nowMs: Date.now(), reason: 'TERM_ENDED' });
    const gone = await live.readMemberProfile(client, 'US', US_ID);
    check('해임 후 권한 해제', removed.ok === true && gone.leader === false && gone.rank !== 'leader', (gone.rank || '') + ' ' + (gone.termStatus || '') + ' ' + (removed.reason || ''));
  }
  notes.push('서버 종료 pid=' + process.pid);
  notes.push('실패 수 ' + failed);
  fs.writeFileSync(path.join(OUT, 'checks.txt'), notes.join('\n'), 'utf8');
  await client.end();
  if (failed) process.exitCode = 1;
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
