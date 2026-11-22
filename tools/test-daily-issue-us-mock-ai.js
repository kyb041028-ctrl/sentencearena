'use strict';

/**
 * US Daily Issue mock AI flow. No live model call. No production publish.
 */

const evalCore = require('../shared/daily-issue-ai-eval-core');
const aiService = require('../server/daily-issue-ai-service');
const usOps = require('../shared/daily-issue-us-ops-core');
const { assertDailyIssueIsolatedTarget } = require('./lib/daily-issue-isolated-target');

const AS_OF = '2026-11-22T16:00:00.000Z';
const PUB = '2026-11-21T22:40:00.000Z';
const CONTRACT_TITLE = 'Trump orders federal contractors to check with White House before responding to Congress';
const NPR_SENTENCE = 'President Trump is directing federal contractors to consult the White House about inquiries from Congress and to withhold any communications that his administration considers privileged.';
const PBS_SENTENCE = 'The order is the Republican administration latest effort to resist wide-ranging oversight from Democrats when they take over Congress.';

const env = Object.assign({}, process.env, {
  DAILY_ISSUE_US_AI_API_KEY: 'mock-interface-only',
  DAILY_ISSUE_US_AI_MAX_CALLS_PER_RUN: '5',
  DAILY_ISSUE_US_AI_MAX_USD_PER_RUN: '1',
});
delete env.DAILY_ISSUE_US_SCHEDULER_ENABLED;
delete env.DAILY_ISSUE_US_AUTO_PUBLISH;
delete env.DAILY_ISSUE_MORNING_AUTO_PUBLISH;

function source(id, publisher, network, url, title, text) {
  return {
    id: id,
    publisher: publisher,
    url: url,
    publishedAt: PUB,
    title: title,
    evidenceSnippet: text,
    description: text,
    sourceType: 'NEWS',
    trustTier: publisher === 'NPR' ? 'ESTABLISHED_NEWS' : 'PUBLIC_BROADCAST',
    independentNetworkKey: network,
    sourceRegistryId: network,
  };
}

function candidate(spec) {
  const title = spec.title;
  const id1 = spec.clusterId + '-s1';
  const id2 = spec.clusterId + '-s2';
  const s1 = source(id1, 'NPR', spec.network1 || 'npr-org', spec.url1, spec.title1 || title, spec.text1);
  const s2 = source(id2, 'PBS NewsHour', spec.network2 || 'pbs-newshour', spec.url2, spec.title2 || title, spec.text2);
  const sources = spec.oneSource ? [s1] : [s1, s2];
  const claims = spec.claims || [
    { id: spec.clusterId + '-c1', text: spec.text1, classification: 'UNVERIFIED', isCore: true, supportingSourceIds: [id1] },
    { id: spec.clusterId + '-c2', text: spec.text2, classification: 'UNVERIFIED', isCore: true, supportingSourceIds: [id2] },
  ];
  return {
    ok: false,
    publicationStatus: 'QUARANTINED',
    activityRegion: 'US',
    freshnessOk: spec.freshnessOk !== false,
    freshnessClass: 'RECENT_UPDATE',
    title: title,
    clusterId: spec.clusterId,
    qualityFailureReasons: spec.reasons || ['CONFIRMED_FACT_EMPTY', 'CORE_CLAIM_UNVERIFIED', 'CONFIRMED_SUMMARY_MISSING'],
    claims: spec.oneSource ? [claims[0]] : claims,
    normalizedSources: sources,
    dataKind: spec.dataKind || 'MOCK',
  };
}

function payload(cand, patch) {
  const sources = cand.normalizedSources;
  const fact = patch && patch.fact != null ? patch.fact : cand.title;
  const base = {
    sameEvent: true,
    articleTitle: cand.title,
    factSummary: fact,
    backgroundContext: fact,
    confirmedFacts: [{ text: fact, sourceIds: sources.map(function (s) { return s.id; }) }],
    unverifiedClaims: [],
    discussionQuestion: 'What should readers watch as agencies apply this rule?',
    referenceLinks: sources.map(function (s) {
      return { sourceId: s.id, url: s.url, publisherTitle: s.publisher, publishedDate: PUB.slice(0, 10) };
    }),
    nationalRelevance: 'high',
    debateSuitability: 'yes',
    duplicateOfExisting: false,
    factStatusNote: 'Compared by the mock analyzer.',
    selectionReason: 'Mock analysis only.',
  };
  return Object.assign(base, patch || {});
}

function adapter(body) {
  return {
    callStructured: async function () {
      return body;
    },
  };
}

async function runOne(cand, body) {
  const gate = evalCore.ruleEligibleForAi(cand, 'US');
  if (!gate.ok) {
    return { stage: 'PRE_AI', eligible: false, publishable: false, reason: gate.reason, adapterCalled: false };
  }
  const result = await aiService.evaluateOneCandidate(cand, {
    asOf: AS_OF,
    region: 'US',
    env: env,
    adapter: adapter(body),
  });
  return {
    stage: 'AI',
    eligible: false,
    publishable: result.ok === true,
    outcome: result.outcome,
    reason: result.ok ? 'AI_CONFIRMED' : (result.blockedReasons || [result.errorCode || result.reason]).join(','),
    adapterCalled: true,
    candidate: result.candidate,
    dataKind: cand.dataKind,
  };
}

function pair(clusterId, title, text1, text2, extra) {
  return candidate(Object.assign({
    clusterId: clusterId,
    title: title,
    title1: title,
    title2: title,
    text1: text1,
    text2: text2,
    url1: 'https://www.npr.org/2026/11/21/mock-' + clusterId,
    url2: 'https://www.pbs.org/newshour/politics/mock-' + clusterId,
    dataKind: 'MOCK',
  }, extra || {}));
}

async function main() {
  const rows = [];
  const contractor = pair(
    'contractors',
    CONTRACT_TITLE,
    NPR_SENTENCE,
    PBS_SENTENCE,
    { dataKind: 'REAL_TEXT_MOCK_AI' },
  );

  rows.push(Object.assign({ id: 1, name: '같은 사실 다른 문장' }, await runOne(contractor, { ok: true, payload: payload(contractor), provider: 'mock', model: 'unspecified' })));

  const view = pair('views', 'Federal Reserve announces College Fed Challenge winners', 'The board named the college challenge winners.', 'A separate desk described the same winner list.');
  rows.push(Object.assign({ id: 2, name: '같은 사건 다른 관점' }, await runOne(view, {
    ok: true,
    payload: payload(view, { unverifiedClaims: ['One desk called the field unusually strong.'] }),
    provider: 'mock',
  })));

  const person = pair('person', 'Trump speaks at two unrelated events', 'Trump spoke at a trade signing.', 'Trump spoke at a sports ceremony.');
  rows.push(Object.assign({ id: 3, name: '같은 인물 다른 사건' }, await runOne(person, { ok: true, payload: payload(person, { sameEvent: false, fact: 'Trump spoke at a trade signing.' }) })));

  const agency = pair('agency', 'Federal Reserve issues two releases', 'The board named challenge winners.', 'The board released a bank survey.');
  rows.push(Object.assign({ id: 4, name: '같은 기관 다른 발표' }, await runOne(agency, { ok: true, payload: payload(agency, { sameEvent: false, fact: 'The board named challenge winners.' }) })));

  const clash = pair('clash', 'Agencies counted the same hearing', 'Agencies counted 12 banks.', 'Agencies counted 40 banks.', {
    claims: [
      { id: 'clash-c1', text: 'Agencies counted 12 banks.', classification: 'SOURCE_DISAGREEMENT', isCore: true, supportingSourceIds: ['clash-s1'] },
      { id: 'clash-c2', text: 'Agencies counted 40 banks.', classification: 'SOURCE_DISAGREEMENT', isCore: true, supportingSourceIds: ['clash-s2'] },
    ],
  });
  rows.push(Object.assign({ id: 5, name: '사실 충돌' }, await runOne(clash, { ok: true, payload: payload(clash) })));

  const soloClaim = pair('solo-claim', 'One desk asserts a motive', NPR_SENTENCE, PBS_SENTENCE);
  rows.push(Object.assign({ id: 6, name: '한 언론사 주장' }, await runOne(soloClaim, {
    ok: true,
    payload: payload(soloClaim, { confirmedFacts: [], fact: '', factSummary: 'No shared fact.', unverifiedClaims: [NPR_SENTENCE] }),
  })));

  const oneOutlet = pair('one', CONTRACT_TITLE, NPR_SENTENCE, PBS_SENTENCE, { oneSource: true, network2: 'npr-org' });
  rows.push(Object.assign({ id: 7, name: '독립 언론 1곳' }, await runOne(oneOutlet, { ok: true, payload: payload(oneOutlet) })));

  const stale = pair('stale', CONTRACT_TITLE, NPR_SENTENCE, PBS_SENTENCE, { freshnessOk: false });
  rows.push(Object.assign({ id: 8, name: '오래된 기사' }, await runOne(stale, { ok: true, payload: payload(stale) })));

  const low = pair('low-us', 'A city parade changes its route', 'The parade route changed downtown.', 'The same route change was described again.');
  rows.push(Object.assign({ id: 9, name: '미국 관련 낮음' }, await runOne(low, { ok: true, payload: payload(low, { nationalRelevance: 'low' }) })));

  const local = pair('local', 'A county fair sets its hours', 'The county fair opens at noon.', 'The same fair hours were posted.');
  rows.push(Object.assign({ id: 10, name: '지역 사건' }, await runOne(local, { ok: true, payload: payload(local, { nationalRelevance: 'local', debateSuitability: 'local' }) })));

  const dup = pair('dup', CONTRACT_TITLE, NPR_SENTENCE, PBS_SENTENCE);
  rows.push(Object.assign({ id: 11, name: '기존 이슈 중복' }, await runOne(dup, { ok: true, payload: payload(dup, { duplicateOfExisting: true }) })));

  const miss = pair('miss', CONTRACT_TITLE, NPR_SENTENCE, PBS_SENTENCE);
  rows.push(Object.assign({ id: 12, name: 'AI가 사실을 못 찾음' }, await runOne(miss, {
    ok: true,
    payload: payload(miss, { fact: 'A secret committee dissolved the oversight office.', factSummary: 'A secret committee dissolved the oversight office.' }),
  })));

  const badForm = pair('form', CONTRACT_TITLE, NPR_SENTENCE, PBS_SENTENCE);
  rows.push(Object.assign({ id: 13, name: '형식 오류' }, await runOne(badForm, { ok: true, payload: { sameEvent: true } })));

  const timeoutCand = pair('timeout', CONTRACT_TITLE, NPR_SENTENCE, PBS_SENTENCE);
  rows.push(Object.assign({ id: 14, name: '누락 오류 타임아웃' }, await runOne(timeoutCand, { ok: false, errorCode: 'AI_TIMEOUT', provider: 'mock' })));

  const zeroList = [clash, oneOutlet, stale];
  const zeroRun = await aiService.processReadyCandidatesForAi(zeroList, { asOf: AS_OF, region: 'US', env: env, adapter: adapter({ ok: true, payload: payload(clash) }) });
  rows.push({
    id: 15,
    name: '적격 0건',
    stage: 'BATCH',
    eligible: zeroRun.summary.eligible === 0 && zeroRun.candidates.length === 0,
    publishable: false,
    reason: 'eligible=' + zeroRun.summary.eligible + ',out=' + zeroRun.candidates.length,
    adapterCalled: false,
  });

  const fourTitles = [
    'Senate schedules a hearing on federal housing grants',
    'Coast Guard awards a contract for a new icebreaker',
    'Postal Service files a nationwide rate change',
    'Transportation board opens a runway inspection review',
  ];
  const four = fourTitles.map(function (title, idx) {
    return pair('cap-' + (idx + 1), title, title + ' NPR described the same federal notice.', title + ' PBS described the same federal notice.');
  });
  let call = 0;
  const fourRun = await aiService.processReadyCandidatesForAi(four, {
    asOf: AS_OF,
    region: 'US',
    env: env,
    adapter: {
      callStructured: async function (input) {
        call += 1;
        const title = input.clusterTitle;
        const matched = four.filter(function (c) { return c.title === title; })[0] || four[0];
        return { ok: true, payload: payload(matched), provider: 'mock', model: 'unspecified', estimatedUsd: 0 };
      },
    },
  });
  rows.push({
    id: 16,
    name: '적격 3건 초과',
    stage: 'BATCH',
    eligible: fourRun.candidates.length === 4,
    publishable: fourRun.candidates.length > 3,
    reason: 'aiEligible=' + fourRun.candidates.length + ',calls=' + call,
    candidates: fourRun.candidates,
    adapterCalled: true,
  });

  const invented = await runOne(contractor, {
    ok: true,
    payload: payload(contractor, { fact: 'A secret committee dissolved the oversight office.', factSummary: 'A secret committee dissolved the oversight office.' }),
  });

  const publish = await publishIsolated(fourRun.candidates || []);
  const out = {
    mockNotLiveAi: true,
    betaAutoPublishEnabled: false,
    schedulerEnabled: false,
    slots: usOps.slotFor('2026-11-01T15:00:00.000Z').maxPerDay,
    slotHours: [11, 15, 19],
    rows: rows.map(function (r) {
      return { id: r.id, name: r.name, stage: r.stage, publishable: r.publishable === true, reason: r.reason, dataKind: r.dataKind || 'MOCK', adapterCalled: r.adapterCalled === true };
    }),
    contractorInventedBlocked: invented.publishable === false,
    contractorInventedReason: invented.reason,
    publish: publish,
  };
  console.log(JSON.stringify(out, null, 2));
  if (rows.some(function (r, i) {
    if (r.id === 1 || r.id === 2) return r.publishable !== true;
    if (r.id === 16) return r.eligible !== true;
    if (r.id === 15) return r.eligible !== true;
    return r.publishable === true;
  }) || invented.publishable === true) {
    process.exitCode = 1;
  }
}

async function publishIsolated(eligible) {
  const { Client } = require('pg');
  const harness = require('./lib/daily-issue-local-pg-harness');
  const orders = require('../shared/migration-preflight-orders');
  const { createDailyIssuePgExecutor } = require('../server/daily-issue-pg-client');
  const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
  const { createSqlEmergencyHaltStore } = require('../server/daily-issue-emergency-halt-store');
  const reviewService = require('../server/daily-issue-review-service');
  const dbName = 'us_daily_mock_ai';
  const url = 'postgres://127.0.0.1:5432/' + dbName;
  const gate = assertDailyIssueIsolatedTarget(url, 'daily_issue_test');
  if (!gate.ok || gate.host !== '127.0.0.1' || gate.database !== dbName) {
    return { ok: false, error: gate.reason || 'REFUSED_HOST', host: gate.host || null };
  }
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 2000 });
  await admin.connect();
  const addr = await admin.query('SELECT COALESCE(inet_server_addr()::text, \'127.0.0.1\') AS host');
  const serverHost = String(addr.rows[0].host);
  if (serverHost.indexOf('127.0.0.1') < 0 && serverHost.indexOf('::1') < 0) {
    await admin.end();
    return { ok: false, error: 'REFUSED_NON_LOCAL_HOST', host: serverHost };
  }
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]);
    await admin.query('DROP DATABASE "' + dbName + '"');
  }
  await admin.query('CREATE DATABASE "' + dbName + '"');
  await admin.end();

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('CREATE SCHEMA IF NOT EXISTS auth');
  await client.query("CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb)");
  await client.query('INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', ['11111111-1111-4111-8111-111111111111', 'us-mock-ai@example.com']);
  await client.query('CREATE SCHEMA IF NOT EXISTS daily_issue_test');
  await harness.ensureSupabaseStubRoles(client);
  for (let i = 0; i < orders.STAGING_DAILY_ISSUE_ALL.length; i += 1) {
    const file = orders.STAGING_DAILY_ISSUE_ALL[i];
    const applied = await harness.applySql(client, file, file, 'daily_issue_test');
    if (!applied.ok) {
      await client.end();
      await dropOnly(dbName);
      return { ok: false, error: applied.error, migration: file };
    }
  }
  const ex = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: 'daily_issue_test' });
  if (!ex.ok) {
    await client.end();
    await dropOnly(dbName);
    return { ok: false, error: ex.error || 'EXECUTOR_FAILED' };
  }
  const repo = createSqlDailyIssueReviewRepository({ executor: ex, schemaName: 'daily_issue_test', enabled: true });
  await repo.initialize();
  const haltStore = createSqlEmergencyHaltStore({ executor: ex, schemaName: 'daily_issue_test' });
  await haltStore.initialize();
  const enq = await reviewService.enqueueCandidates(eligible, { repositoryInstance: repo, activityRegion: 'US', asOf: AS_OF });
  const pubGuard = require('../shared/daily-issue-publish-internal-guard');
  const pub = await reviewService.runMorningAutoPublish(pubGuard.markInternalForceApproved({
    repositoryInstance: repo,
    haltStore: haltStore,
    executor: ex,
    databaseUrl: url,
    schemaName: 'daily_issue_test',
    asOf: AS_OF,
    ignoreMorningWindow: true,
    forceAutoPublish: true,
    activityRegion: 'US',
    maxPublishCount: 3,
    env: env,
  }));
  const again = await reviewService.enqueueCandidates(eligible.slice(0, 1), { repositoryInstance: repo, activityRegion: 'US', asOf: AS_OF });
  const saved = await repo.getPublishedIssues({});
  const items = (saved && saved.items) || [];
  const us = items.filter(function (it) { return usOps.issueRegion(it) === 'US'; });
  const kr = items.filter(function (it) { return usOps.issueRegion(it) !== 'US'; });
  const sourcesKept = us.length > 0 && us.every(function (it) { return (it.sourceRefs || []).length >= 2; });
  const { closeAllDailyIssuePools } = require('../server/daily-issue-pg-client');
  await closeAllDailyIssuePools();
  await client.end();
  await dropOnly(dbName);
  return {
    ok: pub && pub.ok !== false,
    host: '127.0.0.1',
    database: dbName,
    schema: 'daily_issue_test',
    enqueueError: enq.error || null,
    enqueueMessage: enq.message || null,
    enqueued: enq.enqueuedCount,
    enqueueFailed: (enq.results || []).filter(function (r) { return !r.ok; }).map(function (r) { return r.reasons; }),
    blockedReasons: (pub.blocked || []).map(function (b) { return b.reasons; }),
    publishResults: (pub.results || []).map(function (r) { return { ok: r.ok, stage: r.stage, error: r.error, reasons: r.reasons }; }),
    published: (pub.publishedIds || []).length,
    blocked: (pub.blocked || []).length,
    publishReason: pub.reason || null,
    duplicateBlocked: (again.results || []).some(function (r) { return r && !r.ok; }),
    usSaved: us.length,
    krSaved: kr.length,
    sourcesKept: sourcesKept,
    droppedDatabase: true,
    betaAutoPublishEnabled: false,
  };
}

async function dropOnly(dbName) {
  if (dbName !== 'us_daily_mock_ai') return;
  const { Client } = require('pg');
  const admin = new Client({ connectionString: 'postgres://127.0.0.1:5432/postgres', connectionTimeoutMillis: 2000 });
  await admin.connect();
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]);
  await admin.query('DROP DATABASE IF EXISTS "' + dbName + '"');
  await admin.end();
}

main().catch(function (err) {
  console.error(String(err && err.stack ? err.stack : err).slice(0, 1200));
  process.exit(1);
});
