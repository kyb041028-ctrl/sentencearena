'use strict';
/**
 * 개발용 지도자 선거. 운영 DB를 열지 않는다.
 * node tools/test-leader-election-vote.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const election = require('../server/leader-election-service');
const filing = require('../server/leader-filing-service');
const vote = require('../shared/vote-engine-core');
const legal = require('../shared/legal-gate-core');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) {
    console.log('PASS: ' + label);
    pass += 1;
  } else {
    console.log('FAIL: ' + label);
    fail += 1;
  }
}

const now = 1_700_000_000_000;
const day = vote.DAY_MS;
const windowOpen = { provided: true, open: true };
const windowClose = { provided: true, open: true, closing: true };
const clerk = { id: 'clerk', office: 'dev-clerk', verified: true, authSource: 'test-fixture' };
const usAdult = {
  source: 'test-fixture',
  legalRow: {
    activity_region: 'US',
    age_policy_region: 'US',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: legal.US_AGE_POLICY_VERSION,
  },
};
const krMinor = {
  source: 'test-fixture',
  legalRow: {
    activity_region: 'KR',
    age_policy_region: 'KR',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: legal.AGE_POLICY_VERSION,
    usParticipation: 'read-only',
  },
};

function rep(country, territory, id, name) {
  return { id: id, name: name, country: country, territory: territory, office: 'representative', devAuth: true };
}

function people(count, country, territory) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({ id: 'v' + i, country: country, territory: territory, valid: true, lastPostAtMs: now - 1000 });
  }
  return { source: 'test-fixture', records: rows };
}

function file(box, country, territory, id, name, eligibility) {
  return filing.fileCandidacy(box, {
    actor: rep(country, territory, id, name),
    country: country,
    territory: territory,
    window: windowOpen,
    nowMs: now,
    intentConfirmed: true,
    eligibility: eligibility,
  });
}

function reviewPath(store, filingStore, candidacyId, action, country) {
  return election.reviewCandidacy(store, filingStore, {
    actor: clerk,
    candidacyId: candidacyId,
    action: action,
    window: action === 'close_registration' ? windowClose : windowOpen,
    country: country,
  });
}

(async function () {
  const saved = election.emptyStore();
  const savedFiling = filing.emptyStore();
  const filed = file(savedFiling, 'KR', 'pioneer', 'r1', '한결');
  const started = reviewPath(saved, savedFiling, filed.candidacy.id, 'start_review');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-el-'));
  const filePath = path.join(dir, 'election.json');
  election.writeStore(filePath, saved);
  const reread = election.readStore(filePath);
  const approved = reviewPath(reread, savedFiling, filed.candidacy.id, 'approve');
  election.writeStore(filePath, reread);
  const approvedRead = election.readStore(filePath);
  ok('후보 심사 저장·재조회', started.ok === true && started.review.status === 'in_review' && reread.reviews[0].candidacyId === filed.candidacy.id && approved.ok === true && approvedRead.reviews[0].status === 'approved' && approvedRead.reviews[0].actorName === '한결');

  const noWindow = election.reviewCandidacy(election.emptyStore(), savedFiling, { actor: clerk, candidacyId: filed.candidacy.id, action: 'start_review' });
  ok('기간 없으면 심사 불가', noWindow.reason === 'FILING_WINDOW_UNCONFIRMED');

  const mixed = election.emptyStore();
  const mixedFiling = filing.emptyStore();
  const yes = file(mixedFiling, 'KR', 'pioneer', 'r1', '한결');
  const no = file(mixedFiling, 'KR', 'pioneer', 'r2', '가온');
  const also = file(mixedFiling, 'KR', 'pioneer', 'r3', '하람');
  reviewPath(mixed, mixedFiling, yes.candidacy.id, 'start_review');
  reviewPath(mixed, mixedFiling, yes.candidacy.id, 'approve');
  reviewPath(mixed, mixedFiling, no.candidacy.id, 'start_review');
  reviewPath(mixed, mixedFiling, no.candidacy.id, 'reject');
  reviewPath(mixed, mixedFiling, also.candidacy.id, 'start_review');
  reviewPath(mixed, mixedFiling, also.candidacy.id, 'approve');
  reviewPath(mixed, mixedFiling, yes.candidacy.id, 'close_registration');
  const opened = election.openElection(mixed, {
    country: 'KR', territory: 'pioneer', nowMs: now, window: windowOpen, openKey: 'mixed',
    population: people(1000, 'KR', 'pioneer'), voterIds: ['hacker'],
  });
  const ids = opened.ballot ? opened.ballot.candidates.map(function (row) { return row.id; }).sort().join(',') : '';
  ok('미승인 제외', opened.ok === true && ids === 'r1,r3' && opened.ballot.eligibleRepresentativeIds.indexOf('hacker') < 0);

  const small = election.emptyStore();
  const smallFiling = filing.emptyStore();
  const smallFile = file(smallFiling, 'KR', 'pioneer', 'r1', '한결');
  reviewPath(small, smallFiling, smallFile.candidacy.id, 'start_review');
  reviewPath(small, smallFiling, smallFile.candidacy.id, 'approve');
  reviewPath(small, smallFiling, smallFile.candidacy.id, 'close_registration');
  const below = election.openElection(small, { country: 'KR', territory: 'pioneer', nowMs: now, window: windowOpen, openKey: 'small', population: people(999, 'KR', 'pioneer') });
  ok('인구 1000 미만 거부', below.ok === false && below.reason === 'POPULATION_BELOW_1000' && small.elections.length === 0);

  const none = election.emptyStore();
  const noneFiling = filing.emptyStore();
  const noneFile = file(noneFiling, 'KR', 'pioneer', 'r1', '한결');
  reviewPath(none, noneFiling, noneFile.candidacy.id, 'start_review');
  reviewPath(none, noneFiling, noneFile.candidacy.id, 'reject');
  reviewPath(none, noneFiling, noneFile.candidacy.id, 'close_registration');
  const waiting = election.openElection(none, { country: 'KR', territory: 'pioneer', nowMs: now, window: windowOpen, openKey: 'none', population: people(1000, 'KR', 'pioneer') });
  ok('후보 0 재접수 대기', waiting.ok === true && waiting.election.status === 'weekly_refiling_waiting' && waiting.election.votesOpened === false && none.ballots.length === 0);

  const solo = election.emptyStore();
  const soloFiling = filing.emptyStore();
  const soloFile = file(soloFiling, 'KR', 'pioneer', 'r1', '한결');
  reviewPath(solo, soloFiling, soloFile.candidacy.id, 'start_review');
  reviewPath(solo, soloFiling, soloFile.candidacy.id, 'approve');
  reviewPath(solo, soloFiling, soloFile.candidacy.id, 'close_registration');
  const uncontested = election.openElection(solo, { country: 'KR', territory: 'pioneer', nowMs: now, window: windowOpen, openKey: 'solo', population: people(1000, 'KR', 'pioneer') });
  ok('단독 무투표 결과와 직위 미부여', uncontested.election.status === 'uncontested_recorded' && uncontested.election.officeGranted === false && uncontested.election.votesOpened === false && solo.ballots.length === 0);

  const live = election.emptyStore();
  const liveFiling = filing.emptyStore();
  const a = file(liveFiling, 'KR', 'pioneer', 'r1', '한결');
  const b = file(liveFiling, 'KR', 'pioneer', 'r2', '가온');
  reviewPath(live, liveFiling, a.candidacy.id, 'start_review');
  reviewPath(live, liveFiling, a.candidacy.id, 'approve');
  reviewPath(live, liveFiling, b.candidacy.id, 'start_review');
  reviewPath(live, liveFiling, b.candidacy.id, 'approve');
  reviewPath(live, liveFiling, a.candidacy.id, 'close_registration');
  const liveOpen = election.openElection(live, { country: 'KR', territory: 'pioneer', nowMs: now, window: windowOpen, openKey: 'live', population: people(1000, 'KR', 'pioneer') });
  const voter = { id: 'v0', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' };
  const cast = await election.castVote(live, { ballotId: liveOpen.ballot.id, actor: voter, choice: 'r1', nowMs: now + 1000 });
  ok('정상 투표', cast.ok === true && cast.vote.choice === 'r1' && cast.publicView.countsHidden === true && cast.publicView.candidateTotals == null && cast.publicView.productionAuth === false && liveOpen.ballot.endsAtMs - liveOpen.ballot.startsAtMs === 48 * vote.HOUR_MS);

  const other = await election.castVote(live, { ballotId: liveOpen.ballot.id, actor: { id: 'v0', country: 'US', territory: 'guardian', verified: true, authSource: 'test-fixture' }, choice: 'r1', nowMs: now + 1000 });
  ok('다른 국가·영토 거부', other.reason === 'CROSS_SCOPE');

  const us = election.emptyStore();
  const usFiling = filing.emptyStore();
  const ua = file(usFiling, 'US', 'guardian', 'u1', 'Avery', usAdult);
  const ub = file(usFiling, 'US', 'guardian', 'u2', 'Morgan', usAdult);
  reviewPath(us, usFiling, ua.candidacy.id, 'start_review');
  reviewPath(us, usFiling, ua.candidacy.id, 'approve');
  reviewPath(us, usFiling, ub.candidacy.id, 'start_review');
  reviewPath(us, usFiling, ub.candidacy.id, 'approve');
  reviewPath(us, usFiling, ua.candidacy.id, 'close_registration');
  const usPop = people(1000, 'US', 'guardian');
  const usOpen = election.openElection(us, { country: 'US', territory: 'guardian', nowMs: now, window: windowOpen, openKey: 'us', population: usPop });
  const minorVote = await election.castVote(us, { ballotId: usOpen.ballot.id, actor: { id: 'v0', country: 'US', territory: 'guardian', verified: true, authSource: 'test-fixture' }, choice: 'u1', nowMs: now + 1000, eligibility: krMinor });
  const adultVote = await election.castVote(us, { ballotId: usOpen.ballot.id, actor: { id: 'v1', country: 'US', territory: 'guardian', verified: true, authSource: 'test-fixture' }, choice: 'u1', nowMs: now + 1000, eligibility: usAdult });
  const bareVote = await election.castVote(us, { ballotId: usOpen.ballot.id, actor: { id: 'v2', country: 'US', territory: 'guardian', verified: true, authSource: 'test-fixture', age: 30 }, choice: 'u2', nowMs: now + 1000 });
  ok('미국 참여 제한', minorVote.reason === 'US_PARTICIPATION_READ_ONLY' && adultVote.ok === true && bareVote.reason === 'US_AGE_UNVERIFIED');

  const dup = await election.castVote(live, { ballotId: liveOpen.ballot.id, actor: voter, choice: 'r2', nowMs: now + 1002 });
  ok('중복', dup.reason === 'DUPLICATE_VOTE' && live.votes.length === 1);

  const raceStore = election.emptyStore();
  const raceFiling = filing.emptyStore();
  const ra = file(raceFiling, 'KR', 'pioneer', 'r1', '한결');
  const rb = file(raceFiling, 'KR', 'pioneer', 'r2', '가온');
  reviewPath(raceStore, raceFiling, ra.candidacy.id, 'start_review');
  reviewPath(raceStore, raceFiling, ra.candidacy.id, 'approve');
  reviewPath(raceStore, raceFiling, rb.candidacy.id, 'start_review');
  reviewPath(raceStore, raceFiling, rb.candidacy.id, 'approve');
  reviewPath(raceStore, raceFiling, ra.candidacy.id, 'close_registration');
  const raceOpen = election.openElection(raceStore, { country: 'KR', territory: 'pioneer', nowMs: now, window: windowOpen, openKey: 'race', population: people(1000, 'KR', 'pioneer') });
  const pair = await Promise.all([
    election.castVote(raceStore, { ballotId: raceOpen.ballot.id, actor: voter, choice: 'r1', nowMs: now + 1000 }),
    election.castVote(raceStore, { ballotId: raceOpen.ballot.id, actor: voter, choice: 'r2', nowMs: now + 1000 }),
  ]);
  ok('동시 제출', pair.filter(function (row) { return row.ok; }).length === 1 && pair.some(function (row) { return row.reason === 'DUPLICATE_VOTE'; }) && raceStore.votes.length === 1);

  const before = await election.castVote(live, { ballotId: liveOpen.ballot.id, actor: { id: 'v3', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'r1', nowMs: now - 1 });
  const after = await election.castVote(live, { ballotId: liveOpen.ballot.id, actor: { id: 'v4', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'r1', nowMs: now + 48 * vote.HOUR_MS });
  ok('시작 전·마감 후', before.reason === 'NOT_STARTED' && after.reason === 'CLOSED');

  const inside = await election.castVote(live, { ballotId: liveOpen.ballot.id, actor: { id: 'v5', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'r1', nowMs: now + 48 * vote.HOUR_MS - 1 });
  ok('48시간', inside.ok === true && liveOpen.ballot.endsAtMs - now === 48 * vote.HOUR_MS);

  ok('진행 중 득표 비공개', cast.publicView.countsHidden === true && JSON.stringify(cast.publicView).indexOf('"votes"') < 0);

  await election.castVote(live, { ballotId: liveOpen.ballot.id, actor: { id: 'v6', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'r2', nowMs: now + 2000 });
  const plurality = await election.closeBallot(live, { ballotId: liveOpen.ballot.id, nowMs: now + 48 * vote.HOUR_MS });
  const pluralityAgain = await election.closeBallot(live, { ballotId: liveOpen.ballot.id, nowMs: now + 48 * vote.HOUR_MS + 5 });
  ok('최다 득표', plurality.ballot.result === 'plurality' && plurality.ballot.winnerId === 'r1' && plurality.ballot.officeGranted === false && pluralityAgain.alreadyClosed === true && plurality.publicView.candidateTotals != null);

  const tieStore = election.emptyStore();
  const tieFiling = filing.emptyStore();
  const ta = file(tieFiling, 'KR', 'pioneer', 'r1', '한결');
  const tb = file(tieFiling, 'KR', 'pioneer', 'r2', '가온');
  reviewPath(tieStore, tieFiling, ta.candidacy.id, 'start_review');
  reviewPath(tieStore, tieFiling, ta.candidacy.id, 'approve');
  reviewPath(tieStore, tieFiling, tb.candidacy.id, 'start_review');
  reviewPath(tieStore, tieFiling, tb.candidacy.id, 'approve');
  reviewPath(tieStore, tieFiling, ta.candidacy.id, 'close_registration');
  const tieOpen = election.openElection(tieStore, { country: 'KR', territory: 'pioneer', nowMs: now, window: windowOpen, openKey: 'tie', population: people(1000, 'KR', 'pioneer') });
  await election.castVote(tieStore, { ballotId: tieOpen.ballot.id, actor: { id: 'v0', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'r1', nowMs: now + 1000 });
  await election.castVote(tieStore, { ballotId: tieOpen.ballot.id, actor: { id: 'v1', country: 'KR', territory: 'pioneer', verified: true, authSource: 'test-fixture' }, choice: 'r2', nowMs: now + 1000 });
  const tieClose = await election.closeBallot(tieStore, { ballotId: tieOpen.ballot.id, nowMs: now + 48 * vote.HOUR_MS });
  ok('동점 미확정', tieClose.ballot.result === 'unconfirmed' && tieClose.ballot.failReason === 'TIE' && tieClose.ballot.winnerId == null && tieClose.ballot.officeGranted === false);

  const central = election.openElection(election.emptyStore(), { country: 'KR', territory: 'central', nowMs: now, window: windowOpen, population: people(1000, 'KR', 'pioneer') });
  ok('KR/US 격리', usOpen.ballot.country === 'US' && liveOpen.ballot.country === 'KR' && usOpen.ballot.id !== liveOpen.ballot.id && central.reason === 'TERRITORY_NOT_ELIGIBLE' && adultVote.publicView.country === 'US');

  const noPeriod = election.openElection(election.emptyStore(), { country: 'KR', territory: 'pioneer', nowMs: now, population: people(1000, 'KR', 'pioneer') });
  ok('기간 없으면 선거 개설 거부', noPeriod.reason === 'FILING_WINDOW_UNCONFIRMED');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
