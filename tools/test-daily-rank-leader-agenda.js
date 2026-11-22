'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const formula = require('../shared/rank-formula-core');
const term = require('../shared/leader-term-core');
const agenda = require('../shared/representative-agenda-core');
const agendaStore = require('../server/leader-agenda-store');
const store = require('../server/leader-election-pg-store');

const DB = 'rank_election_session_48872';
let failed = 0;

function check(name, ok) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) failed += 1;
}

function findMidnight(zone, startMs) {
  let ms = startMs;
  for (let i = 0; i < 72; i += 1) {
    if (formula.isLocalMidnight(ms, zone)) return ms;
    ms += 60 * 60 * 1000;
  }
  throw new Error('midnight missing ' + zone);
}

async function main() {
  const client = new Client({ connectionString: 'postgres://127.0.0.1:5432/' + DB, connectionTimeoutMillis: 2000 });
  await client.connect();
  const host = client.connectionParameters && client.connectionParameters.host;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('REMOTE_HOST');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migration_daily_rank_agenda_candidate.sql'), 'utf8');
  await client.query(sql);

  const winter = findMidnight('America/New_York', Date.UTC(2026, 0, 15, 0, 0, 0));
  const summer = findMidnight('America/New_York', Date.UTC(2026, 6, 15, 0, 0, 0));
  check('1. 미국 겨울 자정', formula.isLocalMidnight(winter, 'America/New_York') && new Date(winter).getUTCHours() === 5);
  check('2. 미국 여름 자정은 다른 UTC 시각', formula.isLocalMidnight(summer, 'America/New_York') && new Date(summer).getUTCHours() === 4);
  check('3. 한국 자정은 서울', formula.isLocalMidnight(findMidnight('Asia/Seoul', Date.UTC(2026, 10, 20, 0, 0, 0)), 'Asia/Seoul'));

  const used = await client.query("SELECT round_key FROM leader_rank_rounds WHERE country='KR' AND territory='pioneer'");
  const usedKeys = Object.create(null);
  used.rows.forEach(function (row) { usedKeys[row.round_key] = true; });
  let krMidnight = findMidnight('Asia/Seoul', Date.UTC(2026, 11, 1, 0, 0, 0));
  while (usedKeys[formula.localDateKey(krMidnight, 'Asia/Seoul')]) krMidnight += 24 * 60 * 60 * 1000;
  const nextDay = krMidnight + 24 * 60 * 60 * 1000;

  await client.query(
    "UPDATE leader_rank_members SET rank='leader', elected_leader=true WHERE country='KR' AND territory='pioneer' AND person_id='kr-rep-1'"
  );
  await client.query("UPDATE leader_offices SET leader_id='kr-rep-1' WHERE country='KR' AND territory='pioneer'");
  const beforeOffice = await store.readOffice(client, 'KR', 'pioneer');

  const failedRun = await store.applyRankFormula(client, {
    country: 'KR', territory: 'pioneer', asOfMs: krMidnight, failAfterScore: true,
  });
  const failRows = await client.query(
    "SELECT count(*)::int AS n FROM leader_rank_refresh_failures WHERE country='KR' AND territory='pioneer' AND round_key=$1",
    [formula.localDateKey(krMidnight, 'Asia/Seoul')]
  );
  const roundAfterFail = await client.query(
    'SELECT count(*)::int AS n FROM leader_rank_rounds WHERE country=$1 AND territory=$2 AND round_key=$3',
    ['KR', 'pioneer', formula.localDateKey(krMidnight, 'Asia/Seoul')]
  );
  check('4. 실패는 기록되고 회차는 닫히지 않음', failedRun.reason === 'RANK_FORMULA_FAILED' && failRows.rows[0].n >= 1 && roundAfterFail.rows[0].n === 0);

  const applied = await store.applyRankFormula(client, { country: 'KR', territory: 'pioneer', asOfMs: krMidnight });
  const again = await store.applyRankFormula(client, { country: 'KR', territory: 'pioneer', asOfMs: krMidnight });
  const next = await store.applyRankFormula(client, { country: 'KR', territory: 'pioneer', asOfMs: nextDay });
  const leader = await client.query("SELECT rank, elected_leader FROM leader_rank_members WHERE country='KR' AND territory='pioneer' AND person_id='kr-rep-1'");
  const office = await store.readOffice(client, 'KR', 'pioneer');
  const leaders = await client.query("SELECT count(*)::int AS n FROM leader_rank_members WHERE country='KR' AND territory='pioneer' AND rank='leader'");
  check('5. 같은 날짜는 한 번, 다음 날짜는 다시', applied.applied === true && again.reason === 'ROUND_ALREADY_APPLIED' && next.applied === true);
  check('6. 일일 평가가 현직 지도자와 직위를 유지', leader.rows[0].rank === 'leader' && leader.rows[0].elected_leader === true && office.leader_id === beforeOffice.leader_id && leaders.rows[0].n === 1);

  const usUsed = await client.query("SELECT round_key FROM leader_rank_rounds WHERE country='US' AND territory='pioneer'");
  const usKeys = Object.create(null);
  usUsed.rows.forEach(function (row) { usKeys[row.round_key] = true; });
  let usMidnight = findMidnight('America/New_York', Date.UTC(2027, 0, 15, 0, 0, 0));
  while (usKeys[formula.localDateKey(usMidnight, 'America/New_York')]) usMidnight += 24 * 60 * 60 * 1000;
  const notNight = await store.applyRankFormula(client, { country: 'US', territory: 'pioneer', asOfMs: krMidnight, auto: true });
  const usApplied = await store.applyRankFormula(client, { country: 'US', territory: 'pioneer', asOfMs: usMidnight });
  const usScore = await client.query("SELECT comparison_score FROM leader_rank_members WHERE country='US' AND person_id='us-rep-1'");
  const krScore = await client.query("SELECT comparison_score FROM leader_rank_members WHERE country='KR' AND person_id='kr-rep-1'");
  check('7. 미국 자동도 뉴욕 자정만', notNight.reason === 'NOT_REFRESH_MOMENT' && usApplied.applied === true);
  check('8. 한국 점수와 미국 점수는 다름', String(usScore.rows[0].comparison_score) !== String(krScore.rows[0].comparison_score));

  let quotaError = '';
  try {
    await client.query('BEGIN');
    await client.query("UPDATE leader_rank_members SET rank='leader', elected_leader=true WHERE country='KR' AND territory='pioneer' AND person_id='kr-rep-2'");
    await client.query('COMMIT');
  } catch (err) {
    quotaError = String(err.message || err.code || '');
    await client.query('ROLLBACK');
  }
  await store.storeMemberFacts(client, {
    activityRegion: 'KR', territory: 'guardian', personId: 'kr-guardian-leader', xp: 10, fame: 20,
    achievements: ['kept'], valid: true, lastPostAtMs: krMidnight,
  });
  await client.query(
    "UPDATE leader_rank_members SET rank='leader', elected_leader=true WHERE country='KR' AND territory='guardian' AND person_id='kr-guardian-leader'"
  );
  const byTerritory = await client.query(
    "SELECT territory, count(*)::int AS n FROM leader_rank_members WHERE country='KR' AND rank='leader' GROUP BY territory ORDER BY territory"
  );
  check('9. 같은 진영 2명은 거부, 진영별 1명은 유지', (quotaError.indexOf('LEADER_EXISTS') >= 0 || quotaError.indexOf('23505') >= 0) && byTerritory.rows.length === 2 && byTerritory.rows.every(function (row) { return row.n === 1; }));

  const maxWeek = await client.query('SELECT COALESCE(MAX(week_number), 0)::int AS n FROM leader_agenda_issues');
  let pioneerWeek = maxWeek.rows[0].n + 1;
  if (pioneerWeek % 2 === 0) pioneerWeek += 1;
  const guardianWeekNo = pioneerWeek + 1;
  const vacantWeek = pioneerWeek + 3;
  const offices = [
    { country: 'KR', territory: 'pioneer', leaderId: 'kr-rep-1' },
    { country: 'KR', territory: 'guardian', leaderId: 'kr-guardian-leader' },
  ];
  const repTry = await agendaStore.publish(client, {
    country: 'KR', weekNumber: pioneerWeek, weekday: 'Mon', sessionUserId: 'kr-rep-4', authorRank: 'representative',
    title: '막힘', body: '막힘', offices: offices, atMs: krMidnight,
  });
  const anon = await agendaStore.publish(client, {
    country: 'KR', weekNumber: pioneerWeek, weekday: 'Mon', title: '막힘', body: '막힘', offices: offices, atMs: krMidnight,
  });
  const other = await agendaStore.publish(client, {
    country: 'KR', weekNumber: pioneerWeek, weekday: 'Mon', sessionUserId: 'kr-guardian-leader',
    title: '보수글', body: '보수글', offices: offices, atMs: krMidnight,
  });
  const wrote = await agendaStore.publish(client, {
    country: 'KR', weekNumber: pioneerWeek, weekday: 'Mon', sessionUserId: 'kr-rep-1',
    title: '진보 의제', body: '중앙 토론', offices: offices, atMs: krMidnight,
  });
  const duplicate = await agendaStore.publish(client, {
    country: 'KR', weekNumber: pioneerWeek, weekday: 'Mon', sessionUserId: 'kr-rep-1',
    title: '두번째', body: '두번째', offices: offices, atMs: krMidnight,
  });
  const guardianWeek = await agendaStore.publish(client, {
    country: 'KR', weekNumber: guardianWeekNo, weekday: 'Mon', sessionUserId: 'kr-guardian-leader',
    title: '보수 의제', body: '중앙 토론', offices: offices, atMs: nextDay,
  });
  const usVacant = await agendaStore.publish(client, {
    country: 'US', weekNumber: vacantWeek, weekday: 'Mon', sessionUserId: 'us-rep-1',
    title: '미국 대체', body: '만들면 안 됨', offices: [{ country: 'US', territory: 'pioneer', leaderId: 'us-rep-1' }], atMs: winter,
  });
  const history = await client.query('SELECT country, week_number, published, title FROM leader_agenda_issues ORDER BY country, week_number');
  check('10. 대표와 비로그인과 상대 진영은 작성 불가', repTry.reason === 'REPRESENTATIVE_CANNOT_WRITE' && anon.reason === 'AUTH_NOT_CONNECTED' && other.reason === 'OTHER_FACTION_LEADER');
  check('11. 1주 진보, 2주 보수, 한 회차 한 번', wrote.published === true && wrote.side === 'pioneer' && duplicate.reason === 'DUPLICATE_ROUND' && guardianWeek.published === true && guardianWeek.side === 'guardian');
  check('12. 공석 회차는 미발행이고 다음 주로 당기지 않음', usVacant.published === false && usVacant.reason === 'VACANT_UNPUBLISHED' && usVacant.substitute === false);
  check('13. 발행 이력은 남아 있음', history.rows.filter(function (row) { return row.published === true; }).length >= 2);

  const inaug = Number((await client.query("SELECT at_ms FROM leader_appointments WHERE person_id='kr-rep-1' ORDER BY at_ms LIMIT 1")).rows[0].at_ms);
  const openTerm = term.planTerm({ inauguratedAtMs: inaug, seasonId: null });
  const seasonSim = term.planTerm({ inauguratedAtMs: inaug, seasonId: 'sim-only', seasonEndAtMs: inaug + 1000 });
  const endedWrite = await agenda.decide({
    country: 'KR', weekNumber: 3, weekday: 'Mon', sessionUserId: 'kr-rep-1', title: '만료', body: '만료',
    offices: offices, authorityRevoked: term.authorityAt(openTerm, openTerm.threeMonthAtMs).holdsOffice === false,
  });
  check('14. 시즌 종료일이 없으면 3개월만', openTerm.seasonEndAtMs == null && openTerm.earlierReason === 'THREE_MONTH' && openTerm.seasonLength === 'UNCONFIRMED');
  check('15. 시즌 종료는 시뮬레이션이고 만료 뒤 의제는 막힘', seasonSim.earlierReason === 'SEASON_END' && seasonSim.seasonLength === 'UNCONFIRMED' && endedWrite.reason === 'TERM_ENDED' && endedWrite.published === false);

  const removed = await store.removeOffice(client, { country: 'KR', territory: 'pioneer', nowMs: Date.now(), reason: 'THREE_MONTH' });
  const after = await store.readOffice(client, 'KR', 'pioneer');
  const rankAfter = await client.query("SELECT rank FROM leader_rank_members WHERE country='KR' AND territory='pioneer' AND person_id='kr-rep-1'");
  const blocked = await agenda.decide({
    country: 'KR', weekNumber: 5, weekday: 'Mon', sessionUserId: 'kr-rep-1', title: '해임 후', body: '해임 후',
    offices: [{ country: 'KR', territory: 'guardian', leaderId: 'kr-guardian-leader' }],
  });
  const beforeAppointments = await client.query('SELECT count(*)::int AS n FROM leader_appointments');
  const secondInauguration = await store.resolveRound(client, { roundId: 'round-kr-2', nowMs: openTerm.threeMonthAtMs });
  const afterAppointments = await client.query('SELECT count(*)::int AS n FROM leader_appointments');
  const pioneerLeaders = await client.query("SELECT count(*)::int AS n FROM leader_rank_members WHERE country='KR' AND territory='pioneer' AND rank='leader'");
  check('16. 기존 해임 뒤 직위와 의제 작성 없음', removed.ok === true && after.leader_id == null && rankAfter.rows[0].rank === 'citizen' && blocked.published === false);
  check('17. 끝난 회차를 다시 열어도 취임은 늘지 않음', secondInauguration.appointed !== true && afterAppointments.rows[0].n === beforeAppointments.rows[0].n && pioneerLeaders.rows[0].n === 0);

  const reread = await client.query("SELECT rank FROM leader_rank_members WHERE country='KR' AND territory='guardian' AND person_id='kr-guardian-leader'");
  check('18. 프로필 계급은 다시 읽어도 같음', reread.rows[0].rank === 'leader');
  await client.end();
  console.log('failed=' + failed);
  process.exit(failed ? 1 : 0);
}

main().catch(function (err) {
  console.log('FAIL ' + String(err && err.stack || err));
  process.exit(1);
});
