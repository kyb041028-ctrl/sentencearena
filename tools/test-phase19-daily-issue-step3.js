#!/usr/bin/env node
'use strict';

/**
 * Phase 19 3단계 — 격리 PG 긴급 중지·US SQL scheduler·공개 가시성 (step2 패턴).
 */

const usOps = require('../shared/daily-issue-us-ops-core');
const usRun = require('../server/daily-issue-us-run-service');
const reviewService = require('../server/daily-issue-review-service');
const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const publicVis = require('../shared/daily-issue-public-visibility-core');
const haltSvc = require('../server/daily-issue-emergency-halt-service');
const { createSqlEmergencyHaltStore } = require('../server/daily-issue-emergency-halt-store');
const { createSqlUsSchedulerStore } = require('../server/daily-issue-us-scheduler-sql-store');
const { createDailyIssuePgExecutor, isAllowedTestSchema } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createPgDailyIssueCommentStore } = require('../server/daily-issue-comment-store');
const { createPgDailyIssueAlignmentReactionStore } = require('../server/daily-issue-alignment-reaction-store');
const { assertDailyIssueIsolatedTarget } = require('./lib/daily-issue-isolated-target');
const { qIdent } = require('../server/daily-issue-emergency-halt-store');

const SCHEMA = process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const AS_OF = '2026-09-01T00:00:00.000Z';
const US_SLOT_AS_OF = '2026-01-15T16:00:00.000Z';
const US_PUB_AT = '2026-01-15T17:00:00.000Z';
const US_K_SLOT_AS_OF = '2026-05-20T15:00:00.000Z';
const US_K_PUB_AT = '2026-05-20T15:30:00.000Z';
const US_L_PUB_AT = '2026-04-01T17:00:00.000Z';
const PREFIX = 'p19s3_' + Date.now().toString(36);
const BASE_COMMIT = '861f0e128e61f729f3ecc4e9518900d771074a3b';

const US_ENV_ON = {
  DAILY_ISSUE_US_SCHEDULER_ENABLED: '1',
  DAILY_ISSUE_US_AUTO_PUBLISH: '1',
};
const KR_ENV_ON = {
  DAILY_ISSUE_MORNING_AUTO_PUBLISH: '1',
};

let failed = 0;

function report(key, verdict, detail) {
  const line = 'PHASE19_STEP3 ' + key + ' ' + verdict + (detail ? ' ' + detail : '');
  console.log(line);
  if (verdict === 'ISOLATED DB FAIL') failed += 1;
}

function fresh(url) {
  const ex = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
  return { ex: ex, repo: createSqlDailyIssueReviewRepository({ executor: ex, schemaName: SCHEMA, enabled: true }) };
}

function haltStoreFor(ex) {
  return createSqlEmergencyHaltStore({ executor: ex, schemaName: SCHEMA });
}

function usStoreFor(ex) {
  return createSqlUsSchedulerStore({ executor: ex, schemaName: SCHEMA, leaseMs: 1000 });
}

function dbOpt(url, repo) {
  return { repositoryInstance: repo, databaseUrl: url, schemaName: SCHEMA };
}

function makeKrItem(suffix) {
  const s1 = {
    id: PREFIX + '_s1_' + suffix,
    publisher: '통계청',
    title: 't',
    url: 'https://kostat.go.kr/s3/' + suffix,
    publishedAt: '2026-08-31T01:00:00.000Z',
    sourceType: 'OFFICIAL',
    documentType: 'PRESS_RELEASE',
    originDomain: 'kostat.go.kr',
  };
  const s2 = {
    id: PREFIX + '_s2_' + suffix,
    publisher: '연합뉴스',
    title: 't2',
    url: 'https://www.yna.co.kr/s3/' + suffix,
    publishedAt: '2026-08-31T02:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.yna.co.kr',
  };
  const text = '통계청이 고용 통계를 공식 발표했다. ' + suffix;
  const built = quality.buildDailyIssueCandidate({
    title: '고용 통계 ' + suffix,
    discussionPrompt: '평가?',
    sources: [s1, s2],
    evidences: [
      { id: PREFIX + '_e1_' + suffix, sourceId: s1.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
      { id: PREFIX + '_e2_' + suffix, sourceId: s2.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    ],
    candidateClaims: [
      {
        id: PREFIX + '_c1_' + suffix,
        text: text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [PREFIX + '_e1_' + suffix, PREFIX + '_e2_' + suffix],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      id: PREFIX + '_id_' + suffix,
      clusterId: PREFIX + '_cl_' + suffix,
      candidateId: PREFIX + '_cand_' + suffix,
      expiresAt: '2099-12-31T00:00:00.000Z',
      activityRegion: 'KR',
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  if (!created.ok || !created.item) throw new Error('makeKrItem:' + (created.reasons || []).join(','));
  return decisionCore.attachDecisionToItem(created.item, { asOf: AS_OF }).item;
}

function makeUsItem(suffix, categoryOverride) {
  const id = PREFIX + 'us_' + suffix;
  const category = categoryOverride || 'us-national';
  const summary = 'Federal agency published quarterly employment statistics ' + suffix + '.';
  const s1 = {
    id: id + '_s1',
    publisher: 'CBS News',
    title: 't',
    url: 'https://www.cbsnews.com/p19s3/' + id + '/1',
    publishedAt: '2026-08-31T12:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.cbsnews.com',
    independentNetworkKey: 'cbsnews-com',
    usMediaClass: 'COMMERCIAL',
  };
  const s2 = {
    id: id + '_s2',
    publisher: 'KQED',
    title: 't2',
    url: 'https://www.kqed.org/p19s3/' + id + '/2',
    publishedAt: '2026-08-31T13:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.kqed.org',
    independentNetworkKey: 'kqed-org',
    usMediaClass: 'PUBLIC_BROADCAST',
  };
  const built = quality.buildDailyIssueCandidate({
    title: summary,
    discussionPrompt: 'What should readers watch?',
    sources: [s1, s2],
    evidences: [
      { id: id + '_e1', sourceId: s1.id, text: summary, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
      { id: id + '_e2', sourceId: s2.id, text: summary, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    ],
    candidateClaims: [
      {
        id: id + '_c1',
        text: summary,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [id + '_e1', id + '_e2'],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF, category: category });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      id: id,
      candidateId: id + '_cand',
      clusterId: 'cl_us_' + suffix,
      contentSignature: 'sig_us_' + suffix,
      expiresAt: '2099-12-31T00:00:00.000Z',
      activityRegion: 'US',
      category: category,
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  if (!created.ok || !created.item) throw new Error('makeUsItem:' + (created.reasons || []).join(','));
  return decisionCore.attachDecisionToItem(
    Object.assign({}, created.item, { lifecycleMeta: Object.assign({}, created.item.lifecycleMeta || {}, { activityRegion: 'US' }) }),
    { asOf: AS_OF },
  ).item;
}

async function enqueue(repo, item) {
  return repo.insertReviewItems([item], [
    {
      entityId: item.id,
      fromStatus: null,
      toStatus: 'READY_FOR_REVIEW',
      action: 'enqueue',
      actorId: 'p19s3',
      timestamp: AS_OF,
    },
  ]);
}

async function approveAndPublish(repo, id, publishedAt, url) {
  const row = await repo.getById(id);
  if (!row.ok) return row;
  if (String(row.item.status) !== 'APPROVED') {
    const appr = await reviewService.transitionItem(id, 'APPROVED', Object.assign({}, dbOpt(url, repo), {
      operatorApproval: true,
      reviewer: 'admin',
      asOf: AS_OF,
    }));
    if (!appr.ok) return appr;
  }
  return reviewService.transitionItem(id, 'PUBLISHED', Object.assign({}, dbOpt(url, repo), {
    operatorApproval: true,
    reviewer: 'admin',
    asOf: publishedAt || AS_OF,
  }));
}

async function prepareApprovedKr(repo, suffix, url) {
  const item = makeKrItem(suffix);
  const ins = await enqueue(repo, item);
  if (!ins.ok) return { ok: false, error: ins.error };
  const id = (ins.items && ins.items[0] && ins.items[0].id) || item.id;
  const appr = await reviewService.transitionItem(id, 'APPROVED', Object.assign({}, dbOpt(url, repo), {
    operatorApproval: true,
    reviewer: 'admin',
    asOf: AS_OF,
  }));
  return { ok: appr.ok, id: id, error: appr.error };
}

async function prepareApprovedUs(repo, suffix, url, categoryOverride) {
  const item = makeUsItem(suffix, categoryOverride);
  const ins = await enqueue(repo, item);
  if (!ins.ok) return { ok: false, error: ins.error };
  const id = (ins.items && ins.items[0] && ins.items[0].id) || item.id;
  const appr = await reviewService.transitionItem(id, 'APPROVED', Object.assign({}, dbOpt(url, repo), {
    operatorApproval: true,
    reviewer: 'admin',
    asOf: AS_OF,
  }));
  return { ok: appr.ok, id: id, error: appr.error };
}

async function setHalt(haltStore, region, halted, reason) {
  return haltSvc.setEmergencyHalt({
    haltStore: haltStore,
    region: region,
    halted: halted,
    reason: reason || 'phase19-step3',
    actorId: ADMIN,
  });
}

async function loadPublicIssue(repo, id, viewerRegionCode) {
  const found = await repo.getById(id);
  if (!found.ok) return { ok: false, error: 'ITEM_NOT_FOUND' };
  if (viewerRegionCode && !publicVis.isPubliclyAccessible(found.item, viewerRegionCode)) {
    const vis = found.item.lifecycleMeta && found.item.lifecycleMeta.usVisibility;
    return { ok: false, error: vis === 'TEMP_HIDDEN' ? 'TEMP_HIDDEN' : 'ITEM_NOT_FOUND', item: found.item };
  }
  return { ok: true, item: found.item };
}

function createRaceHaltStore(realStore, regionToTrip) {
  let getCalls = 0;
  return {
    kind: 'race-wrap',
    initialize: function () {
      return realStore.initialize();
    },
    getRegion: async function (region) {
      getCalls += 1;
      if (getCalls === 2) {
        await realStore.setRegion({
          region: regionToTrip,
          halted: true,
          reason: 'race-before-persist',
          actorId: ADMIN,
        });
      }
      return realStore.getRegion(region);
    },
    setRegion: function (params) {
      return realStore.setRegion(params);
    },
    listAudit: function (region, limit) {
      return realStore.listAudit(region, limit);
    },
  };
}

async function main() {
  report('baseline_commit', 'INFO', 'user_base=861f0e1 work_head=' + BASE_COMMIT);

  const url = process.env.DAILY_ISSUE_DATABASE_URL;
  const gate = assertDailyIssueIsolatedTarget(url, SCHEMA);
  if (!gate.ok || !isAllowedTestSchema(SCHEMA)) {
    report('isolated_env', 'BLOCKED', gate.reason || 'missing-url');
    console.log('PHASE19_STEP3_VERDICT', 'BLOCKED');
    process.exit(2);
  }

  const boot = fresh(url);
  if (!boot.ex.ok) {
    report('isolated_env', 'BLOCKED', 'executor');
    console.log('PHASE19_STEP3_VERDICT', 'BLOCKED');
    process.exit(2);
  }
  await boot.repo.initialize();
  const haltBoot = haltStoreFor(boot.ex);
  await haltBoot.initialize();
  await setHalt(haltBoot, 'KR', false, 'reset');
  await setHalt(haltBoot, 'US', false, 'reset');

  // --- A KR halt on, US publish OK ---
  try {
    await setHalt(haltBoot, 'KR', true, 'scenario-A');
    await setHalt(haltBoot, 'US', false, 'scenario-A');
    const usPrep = await prepareApprovedUs(boot.repo, 'A', url);
    const pub = await reviewService.transitionItem(usPrep.id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo), {
      operatorApproval: true,
      reviewer: 'admin',
      asOf: US_PUB_AT,
    }));
    const krPrep = await prepareApprovedKr(boot.repo, 'Akr', url);
    const krBlock = await reviewService.transitionItem(krPrep.id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo), {
      operatorApproval: true,
      reviewer: 'admin',
      asOf: AS_OF,
    }));
    report(
      'scenario_A',
      pub.ok && krBlock.ok === false && krBlock.error === 'EMERGENCY_HALT_ACTIVE' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'US_publish=' + pub.ok + ' KR_block=' + (krBlock.error || ''),
    );
    await setHalt(haltBoot, 'KR', false, 'cleanup-A');
  } catch (e) {
    report('scenario_A', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- B US halt on, KR publish still allowed (region isolation) ---
  try {
    await setHalt(haltBoot, 'US', true, 'scenario-B');
    await setHalt(haltBoot, 'KR', false, 'scenario-B');
    const krPrep = await prepareApprovedKr(boot.repo, 'B', url);
    const krPub = await reviewService.transitionItem(krPrep.id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo), {
      operatorApproval: true,
      reviewer: 'admin',
      asOf: AS_OF,
    }));
    const usPrep = await prepareApprovedUs(boot.repo, 'Bus', url);
    const usBlock = await reviewService.transitionItem(usPrep.id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo), {
      operatorApproval: true,
      reviewer: 'admin',
      asOf: US_PUB_AT,
    }));
    report(
      'scenario_B',
      krPub.ok && usBlock.ok === false && usBlock.error === 'EMERGENCY_HALT_ACTIVE' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'KR_publish=' + krPub.ok + ' US_block=' + (usBlock.error || ''),
    );
    await setHalt(haltBoot, 'US', false, 'cleanup-B');
  } catch (e) {
    report('scenario_B', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- C both halted ---
  try {
    await setHalt(haltBoot, 'KR', true, 'scenario-C');
    await setHalt(haltBoot, 'US', true, 'scenario-C');
    const krPrep = await prepareApprovedKr(boot.repo, 'Ckr', url);
    const usPrep = await prepareApprovedUs(boot.repo, 'Cus', url);
    const krPub = await reviewService.transitionItem(krPrep.id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo), {
      operatorApproval: true,
      reviewer: 'admin',
      asOf: AS_OF,
    }));
    const usPub = await reviewService.transitionItem(usPrep.id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo), {
      operatorApproval: true,
      reviewer: 'admin',
      asOf: US_PUB_AT,
    }));
    report(
      'scenario_C',
      krPub.ok === false && usPub.ok === false ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'KR=' + (krPub.error || 'ok') + ' US=' + (usPub.error || 'ok'),
    );
    await setHalt(haltBoot, 'KR', false, 'cleanup-C');
    await setHalt(haltBoot, 'US', false, 'cleanup-C');
  } catch (e) {
    report('scenario_C', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- D forceAutoPublish blocked ---
  try {
    await setHalt(haltBoot, 'KR', true, 'scenario-D');
    const force = await reviewService.runMorningAutoPublish(
      Object.assign({}, dbOpt(url, boot.repo), {
        asOf: '2026-08-06T20:05:00.000Z',
        forceAutoPublish: true,
        ignoreMorningWindow: true,
        dryRun: true,
        env: KR_ENV_ON,
        repositoryInstance: boot.repo,
      }),
    );
    report(
      'scenario_D',
      force.skipped === true && force.reason === 'EMERGENCY_HALT_ACTIVE' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'reason=' + (force.reason || ''),
    );
    await setHalt(haltBoot, 'KR', false, 'cleanup-D');
  } catch (e) {
    report('scenario_D', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- E concurrent publish + halt before persist (recheck) ---
  try {
    await setHalt(haltBoot, 'KR', false, 'scenario-E');
    const prep = await prepareApprovedKr(boot.repo, 'E', url);
    const raceStore = createRaceHaltStore(haltStoreFor(boot.ex), 'KR');
    await raceStore.initialize();
    const pub = await reviewService.transitionItem(prep.id, 'PUBLISHED', Object.assign({}, dbOpt(url, boot.repo), {
      operatorApproval: true,
      reviewer: 'admin',
      asOf: AS_OF,
      haltStore: raceStore,
    }));
    const still = await boot.repo.getById(prep.id);
    report(
      'scenario_E',
      pub.ok === false && pub.error === 'EMERGENCY_HALT_ACTIVE' && still.item.status === 'APPROVED' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'error=' + (pub.error || '') + ' status=' + still.item.status,
    );
  } catch (e) {
    report('scenario_E', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- F new halt connection after set ---
  try {
    const w = fresh(url);
    await w.repo.initialize();
    const hsW = haltStoreFor(w.ex);
    await hsW.initialize();
    await setHalt(hsW, 'US', true, 'scenario-F');
    await w.ex.end();
    const r = fresh(url);
    await r.repo.initialize();
    const hsR = haltStoreFor(r.ex);
    await hsR.initialize();
    const st = await haltSvc.getRegionState('US', { haltStore: hsR });
    await r.ex.end();
    report('scenario_F', st.ok && st.halted === true ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL', 'halted=' + st.halted);
    await setHalt(haltBoot, 'US', false, 'cleanup-F');
  } catch (e) {
    report('scenario_F', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- G set halt off without actorId ---
  try {
    const bad = await haltSvc.setEmergencyHalt({ haltStore: haltBoot, region: 'KR', halted: false, reason: 'no-actor' });
    report(
      'scenario_G',
      bad.ok === false && bad.error === 'ADMIN_ACTOR_REQUIRED' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      bad.error || '',
    );
  } catch (e) {
    report('scenario_G', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- H orphan STARTED expired lease US sql store ---
  try {
    const runKey = PREFIX + ':us-orphan:' + Date.now();
    const usT = qIdent(SCHEMA, 'daily_issue_us_scheduler_runs');
    const startedAt = '2020-01-01T00:00:00.000Z';
    const leaseExp = '2020-01-01T00:00:01.000Z';
    await boot.ex.query(
      'INSERT INTO ' +
        usT +
        ' (run_key, status, started_at, lease_owner, lease_expires_at, meta) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
      [runKey, 'STARTED', startedAt, 'orphan-us', leaseExp, '{}'],
    );
    const store = usStoreFor(boot.ex);
    const first = await store.tryClaimRun({ runKey: runKey, startedAt: new Date().toISOString() });
    const retry = await store.tryClaimRun({
      runKey: runKey,
      startedAt: new Date().toISOString(),
      allowRetryAfterFailure: true,
    });
    report(
      'scenario_H',
      first.claimed === false && first.reason === 'ORPHAN_RECOVERED' && retry.claimed === true ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'first=' + (first.reason || first.claimed) + ' retry=' + retry.claimed,
    );
    await store.finishRun(runKey, { status: 'SUCCESS', publishedCount: 0 });
  } catch (e) {
    report('scenario_H', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- I FAILED allowRetryAfterFailure after halt off ---
  try {
    const runKey = PREFIX + ':us-retry:' + Date.now();
    const store = usStoreFor(boot.ex);
    await setHalt(haltBoot, 'US', true, 'scenario-I');
    const c1 = await store.tryClaimRun({ runKey: runKey, startedAt: new Date().toISOString() });
    await store.finishRun(runKey, { status: 'FAILED', errorCode: 'HALT_SIM', errorSummary: 'during-halt' });
    await setHalt(haltBoot, 'US', false, 'scenario-I-off');
    const retryClaim = await store.tryClaimRun({
      runKey: runKey,
      startedAt: new Date().toISOString(),
      allowRetryAfterFailure: true,
    });
    const slotRun = await usRun.runUsDailyIssueSlot(
      Object.assign({}, dbOpt(url, boot.repo), {
        asOf: US_SLOT_AS_OF,
        forceSlot: true,
        runKey: runKey + ':slot',
        env: US_ENV_ON,
        executor: boot.ex,
        skipNetwork: true,
        ingestRunner: async function () {
          return { ok: true, readyCandidates: [], candidates: [] };
        },
      }),
    );
    report(
      'scenario_I',
      c1.claimed && retryClaim.claimed && slotRun.reason !== 'EMERGENCY_HALT_ACTIVE' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'retryClaim=' + retryClaim.claimed + ' slot=' + (slotRun.outcome || slotRun.reason || ''),
    );
  } catch (e) {
    report('scenario_I', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- J dual connection US scheduler claim ---
  try {
    const runKey = PREFIX + ':us-dual:' + Date.now();
    const at = new Date().toISOString();
    const pairA = fresh(url);
    const pairB = fresh(url);
    const sA = usStoreFor(pairA.ex);
    const sB = usStoreFor(pairB.ex);
    const [c1, c2] = await Promise.all([
      sA.tryClaimRun({ runKey: runKey, startedAt: at }),
      sB.tryClaimRun({ runKey: runKey, startedAt: at }),
    ]);
    const claimCount = (c1.claimed ? 1 : 0) + (c2.claimed ? 1 : 0);
    const byKey = await sA.getByRunKey(runKey);
    await pairA.ex.end();
    await pairB.ex.end();
    report(
      'scenario_J',
      claimCount === 1 && byKey && byKey.status === 'RUNNING' ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'claims=' + claimCount,
    );
    const cleanup = fresh(url);
    await usStoreFor(cleanup.ex).finishRun(runKey, { status: 'SUCCESS', publishedCount: 0 });
    await cleanup.ex.end();
  } catch (e) {
    report('scenario_J', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- K US daily max without override ---
  try {
    for (const pair of [
      ['K1', 'us-national'],
      ['K2', 'us-politics'],
      ['K3', 'us-world'],
    ]) {
      const sfx = pair[0];
      const cat = pair[1];
      const prepK = await prepareApprovedUs(boot.repo, sfx, url, cat);
      if (!prepK.ok) throw new Error(prepK.error || 'prep-' + sfx);
      const pubK = await approveAndPublish(boot.repo, prepK.id, US_K_PUB_AT, url);
      if (!pubK.ok) throw new Error(pubK.error || 'pub-' + sfx);
    }
    const usT = qIdent(SCHEMA, 'daily_issue_us_scheduler_runs');
    const slot = usOps.slotFor(US_K_SLOT_AS_OF);
    const dc = await usRun.countPublishedUsOnDate(boot.repo, slot.dateKey, US_K_SLOT_AS_OF);
    await boot.ex.query('DELETE FROM ' + usT + ' WHERE run_key = $1', [slot.runKey]);
    const fourth = await usRun.runUsDailyIssueSlot(
      Object.assign({}, dbOpt(url, boot.repo), {
        asOf: US_K_SLOT_AS_OF,
        forceSlot: true,
        env: US_ENV_ON,
        executor: boot.ex,
        skipNetwork: true,
        ingestRunner: async function () {
          return { ok: true, readyCandidates: [], candidates: [] };
        },
      }),
    );
    report(
      'scenario_K',
      dc.count === 3 &&
        (fourth.reason === 'DAILY_MAX_REACHED' || fourth.note === 'DAILY_MAX_REACHED')
        ? 'ISOLATED DB PASS'
        : 'ISOLATED DB FAIL',
      'pgCount=' + dc.count + ' reason=' + (fourth.reason || fourth.note || '') + ' dateKey=' + slot.dateKey,
    );
  } catch (e) {
    report('scenario_K', 'ISOLATED DB FAIL', String(e.message || e));
  }

  // --- L TEMP_HIDDEN + comments persist, loadPublicIssue fails ---
  try {
    const prep = await prepareApprovedUs(boot.repo, 'L', url, 'us-world');
    const pub = await approveAndPublish(boot.repo, prep.id, US_L_PUB_AT, url);
    if (!pub.ok) throw new Error(pub.error || 'publish-L');
    const row = await boot.repo.getById(prep.id);
    const hideDec = usOps.decideVisibility(
      { activityRegion: 'US', status: 'PUBLISHED', lifecycleMeta: row.item.lifecycleMeta || {} },
      { coreFactVerifiablyWrong: true },
    );
    const merged = Object.assign({}, row.item, {
      lifecycleMeta: Object.assign({}, row.item.lifecycleMeta || {}, hideDec.meta),
    });
    await boot.repo.applyExistingIssueUpdate({ targetId: prep.id, mergedIssue: merged, auditEvents: [] });
    const cstore = createPgDailyIssueCommentStore({ executor: boot.ex, schemaName: SCHEMA });
    const c1 = await cstore.create({ issueId: prep.id, userId: ADMIN, body: 'us-comment-L' });
    const rConn = fresh(url);
    await rConn.repo.initialize();
    const loaded = await loadPublicIssue(rConn.repo, prep.id, 'US');
    const cl = createPgDailyIssueCommentStore({ executor: rConn.ex, schemaName: SCHEMA });
    const listed = await cl.listByIssueId(prep.id);
    await rConn.ex.end();
    report(
      'scenario_L',
      c1.ok && loaded.ok === false && loaded.error === 'TEMP_HIDDEN' && listed.length >= 1 ? 'ISOLATED DB PASS' : 'ISOLATED DB FAIL',
      'load=' + (loaded.error || 'ok') + ' comments=' + listed.length,
    );
  } catch (e) {
    report('scenario_L', 'ISOLATED DB FAIL', String(e.message || e));
  }

  await setHalt(haltBoot, 'KR', false, 'final-reset');
  await setHalt(haltBoot, 'US', false, 'final-reset');
  await boot.ex.end();

  if (failed) {
    console.log('PHASE19_STEP3_VERDICT', 'FAIL', 'failed=' + failed);
    process.exit(1);
  }
  console.log('PHASE19_STEP3_VERDICT', 'PASS');
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
