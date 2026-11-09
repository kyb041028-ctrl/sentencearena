'use strict';
/**
 * 개발용 후보 등록·탄핵 발의. 운영 DB를 열지 않는다.
 * node tools/test-leader-filing.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const service = require('../server/leader-filing-service');
const devHttp = require('../server/leader-filing-dev-http');
const legal = require('../shared/legal-gate-core');

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
  if (cond) {
    console.log('  PASS: ' + label);
    pass += 1;
  } else {
    console.log('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    fail += 1;
  }
}

function rep(country, territory, id) {
  return { id: id || 'rep-' + country, country: country, territory: territory, office: 'representative', devAuth: true };
}
const openWindow = { provided: true, open: true };
const now = Date.UTC(2026, 10, 9);
const usAdultEligibility = {
  source: 'test-fixture',
  legalRow: {
    activity_region: 'US',
    age_policy_region: 'US',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: legal.US_AGE_POLICY_VERSION,
  },
};
const krMinorEligibility = {
  source: 'test-fixture',
  legalRow: {
    activity_region: 'KR',
    age_policy_region: 'KR',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: legal.AGE_POLICY_VERSION,
    usParticipation: 'read-only',
  },
};

function fresh() {
  return service.emptyStore();
}

console.log('\n[candidacy]');
const kr = fresh();
const filed = service.fileCandidacy(kr, { actor: rep('KR', 'pioneer'), country: 'KR', territory: 'pioneer', window: openWindow, nowMs: now, intentConfirmed: true });
ok('KR pioneer representative can file', filed.ok === true && filed.candidacy.status === 'submitted');
ok('KR filing does not require a US age record', filed.ok === true && filed.candidacy.country === 'KR');
const minorDob = { year: 2010, month: 1, day: 1 };
const minorUs = legal.evaluateAgeForRegion(minorDob, 'US', now);
const minorKr = legal.evaluateAgeForRegion(minorDob, 'KR', now);
ok('existing US age gate still rejects age 16', minorUs.ok === false && minorUs.error === 'AGE_UNDER_18' && minorUs.policyVersion == null);
ok('existing KR age gate still accepts that birth date', minorKr.ok === true && minorKr.policyVersion === 'age-policy-v1');
const minorFile = service.fileCandidacy(fresh(), { actor: rep('US', 'guardian', 'kr-minor'), country: 'US', territory: 'guardian', window: openWindow, nowMs: now, intentConfirmed: true, eligibility: krMinorEligibility });
ok('KR minor cannot file a US candidacy', minorFile.ok === false && minorFile.reason === 'US_PARTICIPATION_READ_ONLY' && minorFile.stored === false);
const minorImpeach = service.proposeImpeachment(fresh(), { actor: rep('US', 'guardian', 'kr-minor'), country: 'US', territory: 'guardian', leader: { id: 'leader-us', name: 'Avery', country: 'US', territory: 'guardian' }, reason: 'reason', nowMs: now, eligibility: krMinorEligibility });
ok('KR minor cannot propose a US impeachment', minorImpeach.ok === false && minorImpeach.reason === 'US_PARTICIPATION_READ_ONLY' && minorImpeach.stored === false);
const adultFile = service.fileCandidacy(fresh(), { actor: rep('US', 'guardian', 'us-adult'), country: 'US', territory: 'guardian', window: openWindow, nowMs: now, intentConfirmed: true, eligibility: usAdultEligibility });
ok('US adult fixture can file', adultFile.ok === true && adultFile.candidacy.status === 'submitted' && adultFile.candidacy.country === 'US');
const adultImpeach = service.proposeImpeachment(fresh(), { actor: rep('US', 'guardian', 'us-adult'), country: 'US', territory: 'guardian', leader: { id: 'leader-us', name: 'Avery', country: 'US', territory: 'guardian' }, reason: 'reason', nowMs: now, eligibility: usAdultEligibility });
ok('US adult fixture can propose impeachment', adultImpeach.ok === true && adultImpeach.proposal.status === 'received');
const unverified = service.fileCandidacy(fresh(), { actor: rep('US', 'guardian', 'no-age'), country: 'US', territory: 'guardian', window: openWindow, nowMs: now, intentConfirmed: true, eligibility: { source: 'member-auth', age: 30 } });
ok('unverified age cannot file', unverified.ok === false && unverified.reason === 'US_AGE_UNVERIFIED' && unverified.stored === false);
ok('duplicate filing is blocked', service.fileCandidacy(kr, { actor: rep('KR', 'pioneer'), country: 'KR', territory: 'pioneer', window: openWindow, nowMs: now, intentConfirmed: true }).reason === 'DUPLICATE_CANDIDACY');
ok('central has no leader filing', service.fileCandidacy(fresh(), { actor: rep('KR', 'central'), country: 'KR', territory: 'central', window: openWindow }).reason === 'TERRITORY_NOT_ELIGIBLE');
ok('alien has no leader filing', service.fileCandidacy(fresh(), { actor: rep('US', 'alien'), country: 'US', territory: 'alien', window: openWindow }).reason === 'TERRITORY_NOT_ELIGIBLE');
ok('citizen cannot file', service.fileCandidacy(fresh(), { actor: { id: 'c', country: 'KR', territory: 'pioneer', office: 'citizen', devAuth: true }, country: 'KR', territory: 'pioneer', window: openWindow }).reason === 'NOT_REPRESENTATIVE');
ok('cross country is blocked', service.fileCandidacy(fresh(), { actor: rep('KR', 'pioneer'), country: 'US', territory: 'pioneer', window: openWindow }).reason === 'CROSS_SCOPE');
ok('cross territory is blocked', service.fileCandidacy(fresh(), { actor: rep('KR', 'pioneer'), country: 'KR', territory: 'guardian', window: openWindow }).reason === 'CROSS_SCOPE');
const unconfirmed = service.fileCandidacy(fresh(), { actor: rep('US', 'guardian'), country: 'US', territory: 'guardian', intentConfirmed: true, eligibility: usAdultEligibility });
ok('missing window stays unconfirmed', unconfirmed.reason === 'FILING_WINDOW_UNCONFIRMED' && unconfirmed.stored === false);
ok('filing without a confirmed intent is rejected', service.fileCandidacy(fresh(), { actor: rep('KR', 'pioneer'), country: 'KR', territory: 'pioneer', window: openWindow }).reason === 'INTENT_NOT_CONFIRMED');
ok('closed injected window is outside', service.fileCandidacy(fresh(), { actor: rep('US', 'guardian'), country: 'US', territory: 'guardian', window: { provided: true, open: false }, eligibility: usAdultEligibility }).reason === 'OUTSIDE_WINDOW');
ok('real login without dev auth is rejected', service.fileCandidacy(fresh(), { actor: { id: 'real', country: 'KR', territory: 'pioneer', office: 'representative', devAuth: false }, country: 'KR', territory: 'pioneer', window: openWindow }).reason === 'DEV_AUTH_REQUIRED');

const us = fresh();
service.fileCandidacy(us, { actor: rep('US', 'guardian', 'us-rep'), country: 'US', territory: 'guardian', window: openWindow, nowMs: now, intentConfirmed: true, eligibility: usAdultEligibility });
ok('US filing does not appear in KR list', service.listCandidacies(us, 'KR', 'pioneer').length === 0 && service.listCandidacies(us, 'US', 'guardian').length === 1);
const closeTry = service.advanceCandidacy(us, { actor: { id: 'clerk', devAuth: true, office: 'dev-clerk' }, candidacyId: us.candidacies[0].id, action: 'close_registration' });
ok('closing without an injected deadline is unconfirmed', closeTry.reason === 'FILING_WINDOW_UNCONFIRMED');
ok('review can start without electing anyone', service.advanceCandidacy(us, { actor: { id: 'clerk', devAuth: true, office: 'dev-clerk' }, candidacyId: us.candidacies[0].id, action: 'start_review' }).candidacy.status === 'in_review');

console.log('\n[impeachment]');
const leader = { id: 'leader-kr', country: 'KR', territory: 'pioneer' };
const opened = service.proposeImpeachment(fresh(), { actor: rep('KR', 'pioneer', 'rep-a'), country: 'KR', territory: 'pioneer', leader: leader, reason: '사유', nowMs: now });
ok('representative can file against the sitting leader', opened.ok === true && opened.proposal.status === 'received' && opened.proposal.nextStep === 'representative_vote_24h' && opened.proposal.confirmed === false && opened.proposal.tally === null);
const named = service.proposeImpeachment(fresh(), { actor: rep('KR', 'pioneer', 'rep-a'), country: 'KR', territory: 'pioneer', leader: { id: 'leader-kr', name: '가온', country: 'KR', territory: 'pioneer' }, reason: '사유', nowMs: now, preview: true });
ok('preview returns the sitting leader and no choice list', named.ok === true && named.leaderView.name === '가온' && named.leaderView.country === 'KR' && named.leaderView.territory === 'pioneer' && named.choices == null);
ok('no leader blocks the proposal', service.proposeImpeachment(fresh(), { actor: rep('US', 'guardian'), country: 'US', territory: 'guardian', leader: null, reason: 'reason', nowMs: now, eligibility: usAdultEligibility }).reason === 'NO_SITTING_LEADER');
const dupStore = fresh();
service.proposeImpeachment(dupStore, { actor: rep('KR', 'pioneer'), country: 'KR', territory: 'pioneer', leader: leader, reason: '사유', nowMs: now });
ok('a second open proposal conflicts', service.proposeImpeachment(dupStore, { actor: rep('KR', 'pioneer', 'rep-b'), country: 'KR', territory: 'pioneer', leader: leader, reason: '다른 사유', nowMs: now }).reason === 'PROCEDURE_CONFLICT');
const blocked = fresh();
blocked.impeachments.push({ leaderId: 'leader-kr', country: 'KR', territory: 'pioneer', status: 'failed', failedAtMs: now - 10 * 24 * 60 * 60 * 1000 });
ok('28 day block after failure', service.proposeImpeachment(blocked, { actor: rep('KR', 'pioneer'), country: 'KR', territory: 'pioneer', leader: leader, reason: '사유', nowMs: now }).reason === 'REPROPOSAL_BLOCKED_28D');
const expired = fresh();
expired.impeachments.push({ leaderId: 'leader-kr', country: 'KR', territory: 'pioneer', status: 'failed', failedAtMs: now - 29 * 24 * 60 * 60 * 1000 });
ok('28 day block ends after the duration', service.proposeImpeachment(expired, { actor: rep('KR', 'pioneer'), country: 'KR', territory: 'pioneer', leader: leader, reason: '사유', nowMs: now }).ok === true);
ok('other country failure does not block', service.proposeImpeachment(blocked, { actor: rep('US', 'guardian'), country: 'US', territory: 'guardian', leader: { id: 'leader-us', country: 'US', territory: 'guardian' }, reason: 'reason', nowMs: now, eligibility: usAdultEligibility }).ok === true);
ok('post impeachment schedule is the confirmed intervals only', service.POST_IMPEACHMENT_SCHEDULE.vacantDays === 7 && service.POST_IMPEACHMENT_SCHEDULE.filingDays === 3 && service.POST_IMPEACHMENT_SCHEDULE.reviewDays === 2 && service.POST_IMPEACHMENT_SCHEDULE.electionHours === 48);

console.log('\n[isolated file store]');
const file = path.join(os.tmpdir(), 'sa-leader-filing-' + Date.now() + '.json');
const disk = service.emptyStore();
service.fileCandidacy(disk, { actor: rep('KR', 'guardian', 'kr-g'), country: 'KR', territory: 'guardian', window: openWindow, nowMs: now, intentConfirmed: true });
service.writeStore(file, disk);
const loaded = service.readStore(file);
ok('file insert can be read back', loaded.candidacies.length === 1 && loaded.candidacies[0].country === 'KR' && loaded.candidacies[0].territory === 'guardian');
fs.unlinkSync(file);

function request(port, method, urlPath, body, header) {
  return new Promise(function (resolve, reject) {
    const req = http.request({ hostname: '127.0.0.1', port: port, method: method, path: urlPath, headers: header || {} }, function (res) {
      let raw = '';
      res.on('data', function (chunk) { raw += chunk; });
      res.on('end', function () { resolve({ status: res.statusCode, body: JSON.parse(raw) }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async function () {
  const storePath = path.join(os.tmpdir(), 'sa-leader-filing-http-' + Date.now() + '.json');
  const server = await devHttp.listen(3017, storePath);
  ok('dev filing http listens on localhost only', server.address().address === '127.0.0.1');
  const denied = await request(3017, 'POST', '/dev/leader-filing/candidacies', { actor: rep('KR', 'pioneer'), country: 'KR', territory: 'pioneer', window: openWindow });
  ok('http without dev header is rejected', denied.status === 403 && denied.body.reason === 'DEV_AUTH_REQUIRED');
  const saved = await request(3017, 'POST', '/dev/leader-filing/candidacies', { actor: rep('KR', 'pioneer'), country: 'KR', territory: 'pioneer', window: openWindow, nowMs: now, intentConfirmed: true }, { 'Content-Type': 'application/json', 'X-SentenceArena-Dev-Filing': 'preview' });
  ok('http dev header can store a filing', saved.status === 200 && saved.body.stored === true);
  const listed = await request(3017, 'GET', '/dev/leader-filing/candidacies?country=KR&territory=pioneer', null, { 'X-SentenceArena-Dev-Filing': 'preview' });
  ok('http read returns only that scope', listed.body.rows.length === 1);
  server.close();
  fs.unlinkSync(storePath);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
