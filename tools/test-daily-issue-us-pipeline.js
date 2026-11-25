#!/usr/bin/env node
'use strict';

/**
 * 미국 데일리 이슈 10차 — ingest·검수·발행 연결 + 격리 저장소.
 * fixture 수집 ≠ LIVE 수집. LIVE 외부·AI 는 미검증.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const usOps = require('../shared/daily-issue-us-ops-core');
const usRun = require('../server/daily-issue-us-run-service');
const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');
const { requestApp } = require('./daily-issue-api-http-helper');
const { createTestApp, makeReady, authHeaders } = require('./daily-issue-api-test-fixtures');

const NPR_FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'daily-issue-us-npr-fixture.xml'), 'utf8');
const FED_FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'daily-issue-us-fed-fixture.xml'), 'utf8');

const SLOT_11_UTC = '2026-11-04T16:00:00.000Z';
const SLOT_15_UTC = '2026-11-04T20:00:00.000Z';
const SLOT_19_UTC = '2026-11-05T00:00:00.000Z';
const DATE_KEY = '2026-11-04';

function feedBodiesForSlot(suffix) {
  const token = String(suffix || 'x');
  function patch(xml) {
    return xml
      .replace(/joint review of banking/g, 'joint review ' + token + ' of banking')
      .replace(/fixture-capital/g, 'fixture-capital-' + token);
  }
  return {
    'npr-world': patch(NPR_FIX),
    'fed-press': patch(FED_FIX),
  };
}

let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log('CHECK_OK', name);
    return;
  }
  failed += 1;
  console.log('CHECK_FAIL', name, detail || '');
}

async function main() {
  console.log('=== US daily issue pipeline (phase 10) ===');

  const slot11 = usOps.slotFor(SLOT_11_UTC);
  const slot15 = usOps.slotFor(SLOT_15_UTC);
  const dstSummer = usOps.slotFor('2026-07-15T19:00:00.000Z');
  check('ET 11회차 runKey', slot11.due && slot11.hour === 11 && slot11.runKey === 'us-daily-issue:' + DATE_KEY + ':11');
  check('ET 15회차 runKey', slot15.due && slot15.hour === 15);
  check('하루 최대 3', usOps.slotFor(SLOT_11_UTC).maxPerDay === 3);
  check('DST 여름 15시 ET', dstSummer.due && dstSummer.hour === 15);

  const reviewRoot = path.join(os.tmpdir(), 'sa-us-di-pipeline-' + Date.now());
  const repo = createDailyIssueReviewRepository({ kind: 'json', reviewRoot: reviewRoot });
  await repo.initialize();

  const storeSeed = {};
  const baseOpt = {
    repositoryInstance: repo,
    skipNetwork: true,
    feedBodies: feedBodiesForSlot('slot-a'),
    cacheRoot: path.join(reviewRoot, 'cache'),
    forceEnabled: true,
    forceSlot: true,
    forceAutoPublish: true,
    persist: true,
    asOf: SLOT_11_UTC,
    usStoreSeed: storeSeed,
  };

  const first = await usRun.runUsDailyIssueSlot(Object.assign({}, baseOpt, { runKey: slot11.runKey }));
  check(
    'fixture 파이프라인 발행',
    first.outcome === 'PUBLISH_SUCCESS' && first.publishedCount === 1,
    JSON.stringify({ outcome: first.outcome, blocked: first.blocked })
  );

  const dup = await usRun.runUsDailyIssueSlot(Object.assign({}, baseOpt, { runKey: slot11.runKey }));
  check('같은 회차 중복 차단', dup.reason === 'ALREADY_PUBLISHED' || dup.outcome === 'DUPLICATE_BLOCKED');

  const repo15 = createDailyIssueReviewRepository({ kind: 'json', reviewRoot: path.join(reviewRoot, 'slot-b') });
  await repo15.initialize();
  const second = await usRun.runUsDailyIssueSlot(
    Object.assign({}, baseOpt, {
      asOf: SLOT_15_UTC,
      runKey: usOps.slotFor(SLOT_15_UTC).runKey,
      feedBodies: feedBodiesForSlot('slot-b'),
      cacheRoot: path.join(reviewRoot, 'cache-b'),
      repositoryInstance: repo15,
    }),
  );
  check('15시 슬롯 runKey', usOps.slotFor(SLOT_15_UTC).runKey === 'us-daily-issue:' + DATE_KEY + ':15');
  check(
    '15시 fixture 파이프라인(격리 저장소)',
    second.outcome === 'PUBLISH_SUCCESS' && second.publishedCount === 1,
    JSON.stringify({ outcome: second.outcome })
  );

  const repo19 = createDailyIssueReviewRepository({ kind: 'json', reviewRoot: path.join(reviewRoot, 'slot-c') });
  await repo19.initialize();
  const third = await usRun.runUsDailyIssueSlot(
    Object.assign({}, baseOpt, {
      asOf: SLOT_19_UTC,
      runKey: usOps.slotFor(SLOT_19_UTC).runKey,
      feedBodies: feedBodiesForSlot('slot-c'),
      cacheRoot: path.join(reviewRoot, 'cache-c'),
      repositoryInstance: repo19,
    }),
  );
  check('19시 슬롯 runKey', usOps.slotFor(SLOT_19_UTC).runKey === 'us-daily-issue:' + DATE_KEY + ':19');
  check(
    '19시 fixture 파이프라인(격리 저장소)',
    third.outcome === 'PUBLISH_SUCCESS' && third.publishedCount === 1,
    JSON.stringify({ outcome: third.outcome })
  );

  const maxRepo = createDailyIssueReviewRepository({ kind: 'json', reviewRoot: path.join(reviewRoot, 'max-day') });
  await maxRepo.initialize();
  const fourth = await usRun.runUsDailyIssueSlot(
    Object.assign({}, baseOpt, {
      repositoryInstance: maxRepo,
      asOf: SLOT_15_UTC,
      runKey: 'us-daily-issue:' + DATE_KEY + ':15-max',
      feedBodies: feedBodiesForSlot('slot-d'),
      cacheRoot: path.join(reviewRoot, 'cache-d'),
      publishedTodayOverride: 3,
    }),
  );
  check('하루 3건 집계(코드)', usOps.slotFor(SLOT_11_UTC).maxPerDay === 3);
  check('하루 3건 이후 0건', fourth.reason === 'DAILY_MAX_REACHED' || fourth.outcome === 'ZERO_NORMAL');

  const packed = createTestApp({ repositoryInstance: repo });
  const krItem = makeReady('kr-pipeline', {});
  krItem.activityRegion = null;
  repo.insertReviewItems([krItem], [], {});
  const krApprove = await requestApp(packed.app, 'POST', '/api/admin/daily-issues/review/' + krItem.id + '/approve', {
    headers: authHeaders(),
    body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'kr-admin' },
  });
  const krLock = krApprove.body && krApprove.body.data && krApprove.body.data.item.lockVersion;
  await requestApp(packed.app, 'POST', '/api/admin/daily-issues/review/' + krItem.id + '/publish', {
    headers: authHeaders(),
    body: { expectedStatus: 'APPROVED', expectedLockVersion: krLock, reviewerId: 'kr-admin' },
  });
  const krList = await requestApp(packed.app, 'GET', '/api/daily-issues', { headers: { 'accept-language': 'ko' } });
  const usList = await requestApp(packed.app, 'GET', '/api/daily-issues', { headers: { 'accept-language': 'en' } });
  const krIds = ((krList.body && krList.body.data && krList.body.data.items) || []).map(function (i) { return i.id; });
  const usIds = ((usList.body && usList.body.data && usList.body.data.items) || []).map(function (i) { return i.id; });
  check(
    'KR/US 목록 격리',
    krIds.indexOf(krItem.id) >= 0 && usIds.length >= 1 && krIds.every(function (id) {
      return usIds.indexOf(id) < 0;
    }) && usIds.every(function (id) {
      return krIds.indexOf(id) < 0;
    }),
    'kr=' + krIds.join(',') + ' us=' + usIds.join(',')
  );

  const hideTarget = usIds[0];
  const hide = await requestApp(packed.app, 'POST', '/api/admin/daily-issues/review/' + hideTarget + '/us-visibility', {
    headers: authHeaders(),
    body: { coreFactVerifiablyWrong: true, reviewerId: 'us-admin' },
  });
  check('중대 오류 임시 숨김', hide.status === 200 && hide.body && hide.body.ok, JSON.stringify(hide.body));

  const hiddenList = await requestApp(packed.app, 'GET', '/api/daily-issues', { headers: { 'accept-language': 'en' } });
  const visibleAfterHide = ((hiddenList.body && hiddenList.body.data && hiddenList.body.data.items) || []).some(function (i) {
    return i.id === hideTarget;
  });
  check('숨김 후 공개 목록에서 제외', !visibleAfterHide);

  const reopen = await requestApp(packed.app, 'POST', '/api/admin/daily-issues/review/' + hideTarget + '/us-visibility', {
    headers: authHeaders(),
    body: { republish: true, adminApproved: true, reviewerId: 'us-admin' },
  });
  check('관리자 재공개', reopen.status === 200 && reopen.body && reopen.body.ok, JSON.stringify(reopen.body));

  let pgLabel = 'SKIPPED_NO_EMBEDDED_PG';
  try {
    const mod = await import(
      pathToFileURL(path.join(os.tmpdir(), 'sa-local-pg', 'node_modules', 'embedded-postgres', 'dist', 'index.js')).href
    );
    const EmbeddedPostgres = mod.default;
    const dataDir = path.join(os.tmpdir(), 'sa-us-di-pg-' + Date.now());
    const cluster = new EmbeddedPostgres({
      databaseDir: dataDir,
      port: 55433,
      user: 'postgres',
      password: 'password',
      persistent: false,
      onLog: function () {},
      onError: function () {},
    });
    await cluster.initialise();
    await cluster.start();
    await cluster.createDatabase('sentencearena_us_di');
    const client = cluster.getPgClient('sentencearena_us_di');
    await client.connect();
    const lifecycleSql = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'migration_daily_issue_review_lifecycle.sql'),
      'utf8',
    );
    await client.query(lifecycleSql);
    const regionSql = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'migration_daily_issue_us_region_candidate.sql'),
      'utf8',
    );
    await client.query(regionSql);
    const col = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'daily_issue_review_items' AND column_name = 'activity_region'",
    );
    check('로컬 PG activity_region 칸', col.rows.length === 1);
    pgLabel = 'LOCAL_PG_COLUMN_OK';
    await client.end();
    await cluster.stop();
  } catch (e) {
    console.log('CHECK_SKIP', 'embedded postgres', String(e && e.message ? e.message : e).slice(0, 120));
  }

  const zeroCollect = await usRun.runUsDailyIssueSlot(
    Object.assign({}, baseOpt, {
      asOf: '2026-02-01T16:00:00.000Z',
      runKey: 'us-daily-issue:2026-02-01:11',
      feedBodies: {},
      ingestRunner: async function () {
        return { ok: true, readyCandidates: [], candidates: [], sourceResults: [] };
      },
    }),
  );
  check('적격 0건은 정상 0', zeroCollect.outcome === 'ZERO_NORMAL' && zeroCollect.publishedCount === 0);

  console.log('COLLECTION_MODE_FIXTURE', usRun.collectionModeFromOpt(baseOpt));
  console.log('LIVE_EXTERNAL_COLLECTION', 'NOT_VERIFIED');
  console.log('LIVE_AI_API', 'NOT_VERIFIED');
  console.log('ISOLATED_DB', pgLabel);
  console.log('PRODUCTION_FLAGS', 'NOT_ENABLED');
  console.log('KOREA_MORNING_SCHEDULER', 'UNCHANGED');

  if (failed) {
    console.log('US_PIPELINE_FAIL', failed);
    process.exitCode = 1;
    return;
  }
  console.log('US_PIPELINE_OK');
}

main().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
