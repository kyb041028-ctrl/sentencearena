#!/usr/bin/env node
'use strict';

/**
 * Phase 19 5단계 — US 동시 quota, halt race trace, halt POST auth, prod store guard.
 */

const cp = require('child_process');
const path = require('path');
const reviewService = require('../server/daily-issue-review-service');
const haltSvc = require('../server/daily-issue-emergency-halt-service');
const usRun = require('../server/daily-issue-us-run-service');
const usOps = require('../shared/daily-issue-us-ops-core');
const { createSqlEmergencyHaltStore } = require('../server/daily-issue-emergency-halt-store');
const { qIdent } = require('../server/daily-issue-emergency-halt-store');
const { createDailyIssuePgExecutor, isAllowedTestSchema } = require('../server/daily-issue-pg-client');
const { createSqlDailyIssueReviewRepository } = require('../server/daily-issue-review-sql-repository');
const { createDailyIssueApiApp } = require('../server/daily-issue-routes');
const { createTestAdminAuthGuard } = require('./daily-issue-api-test-fixtures');
const { requestApp } = require('./daily-issue-api-http-helper');
const { assertDailyIssueIsolatedTarget } = require('./lib/daily-issue-isolated-target');
const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const { startUsScheduler } = require('../server/daily-issue-us-scheduler');

const SCHEMA = process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const BASE_HEAD = '119fd209f750a270ee0baf0123ca322d33d1b780';
const AS_OF = '2026-09-01T00:00:00.000Z';
const PREFIX = 'p19s5_' + Date.now().toString(36);
const US_PUB_DAY = '2026-07-20T15:30:00.000Z';
const US_SLOT_A = '2026-07-20T15:00:00.000Z';
const US_SLOT_B = '2026-07-20T19:00:00.000Z';

const TOKENS = {
  admin: 'p19s5-admin',
  owner: 'p19s5-owner',
  member: 'p19s5-member',
  bad: 'p19s5-bad',
};

let failed = 0;

function report(key, verdict, detail) {
  console.log('PHASE19_STEP5 ' + key + ' ' + verdict + (detail ? ' ' + detail : ''));
  if (verdict === 'FAIL') failed += 1;
}

function fresh(url) {
  const ex = createDailyIssuePgExecutor({ databaseUrl: url, schemaName: SCHEMA });
  return { ex: ex, repo: createSqlDailyIssueReviewRepository({ executor: ex, schemaName: SCHEMA, enabled: true }) };
}

function dbOpt(url, repo, ex, extra) {
  return Object.assign(
    {
      repositoryInstance: repo,
      databaseUrl: url,
      schemaName: SCHEMA,
      executor: ex,
      __trustedInternalPublishOptions: true,
    },
    extra || {},
  );
}

function makeKrItem(suffix) {
  const s1 = {
    id: PREFIX + '_ks1_' + suffix,
    publisher: '통계청',
    title: 't',
    url: 'https://kostat.go.kr/s5/' + suffix,
    publishedAt: '2026-08-31T01:00:00.000Z',
    sourceType: 'OFFICIAL',
    documentType: 'PRESS_RELEASE',
    originDomain: 'kostat.go.kr',
  };
  const s2 = {
    id: PREFIX + '_ks2_' + suffix,
    publisher: '연합',
    title: 't2',
    url: 'https://www.yna.co.kr/s5/' + suffix,
    publishedAt: '2026-08-31T02:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.yna.co.kr',
  };
  const text = '통계청 발표 ' + suffix;
  const built = quality.buildDailyIssueCandidate({
    title: 'KR ' + suffix,
    discussionPrompt: 'Q',
    sources: [s1, s2],
    evidences: [
      { id: PREFIX + '_ke1_' + suffix, sourceId: s1.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
      { id: PREFIX + '_ke2_' + suffix, sourceId: s2.id, text: text, evidenceType: 'DOCUMENT_TEXT', extractionConfidence: 0.9 },
    ],
    candidateClaims: [
      {
        id: PREFIX + '_kc1_' + suffix,
        text: text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [PREFIX + '_ke1_' + suffix, PREFIX + '_ke2_' + suffix],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      id: PREFIX + '_kr_' + suffix,
      candidateId: PREFIX + '_kcand_' + suffix,
      clusterId: PREFIX + '_kcl_' + suffix,
      contentSignature: 'sig_kr_' + suffix,
      expiresAt: '2099-12-31T00:00:00.000Z',
      activityRegion: 'KR',
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  if (!created.ok || !created.item) throw new Error('makeKrItem');
  return decisionCore.attachDecisionToItem(created.item, { asOf: AS_OF }).item;
}

async function approveKr(repo, url, ex, suffix) {
  const item = makeKrItem(suffix);
  const ins = await enqueue(repo, item);
  if (!ins.ok) return { ok: false, error: ins.error };
  const id = (ins.items && ins.items[0] && ins.items[0].id) || item.id;
  const appr = await reviewService.transitionItem(id, 'APPROVED', dbOpt(url, repo, ex, {
    operatorApproval: true,
    reviewer: 'admin',
    asOf: AS_OF,
  }));
  if (!appr.ok) return { ok: false, error: appr.error, id: id };
  return { ok: true, id: id, lockVersion: appr.item.lockVersion };
}

function makeUsItem(suffix, category) {
  const id = PREFIX + 'us_' + suffix;
  const summary = 'US agency report ' + suffix + ' confirmed.';
  const s1 = {
    id: id + '_s1',
    publisher: 'CBS',
    title: 't',
    url: 'https://www.cbsnews.com/s5/' + id,
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
    url: 'https://www.kqed.org/s5/' + id,
    publishedAt: '2026-08-31T13:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'www.kqed.org',
    independentNetworkKey: 'kqed-org',
    usMediaClass: 'PUBLIC_BROADCAST',
  };
  const cat = category || 'us-national';
  const built = quality.buildDailyIssueCandidate({
    title: summary,
    discussionPrompt: 'Q',
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
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF, category: cat });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      id: id,
      candidateId: id + '_cand',
      clusterId: 'cl_' + suffix,
      contentSignature: 'sig_us_' + suffix,
      expiresAt: '2099-12-31T00:00:00.000Z',
      activityRegion: 'US',
      category: cat,
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  if (!created.ok || !created.item) throw new Error('makeUsItem');
  return decisionCore.attachDecisionToItem(
    Object.assign({}, created.item, { lifecycleMeta: { activityRegion: 'US' } }),
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
      actorId: 'p19s5',
      timestamp: AS_OF,
    },
  ]);
}

async function approveUs(repo, url, ex, suffix, category) {
  const item = makeUsItem(suffix, category);
  const ins = await enqueue(repo, item);
  if (!ins.ok) return { ok: false, error: ins.error };
  const id = (ins.items && ins.items[0] && ins.items[0].id) || item.id;
  const appr = await reviewService.transitionItem(id, 'APPROVED', dbOpt(url, repo, ex, {
    operatorApproval: true,
    reviewer: 'admin',
    asOf: AS_OF,
  }));
  if (!appr.ok) return { ok: false, error: appr.error, id: id };
  return { ok: true, id: id, lockVersion: appr.item.lockVersion };
}

async function publishUs(repo, url, ex, prep, publishedAt) {
  return reviewService.transitionItem(prep.id, 'PUBLISHED', dbOpt(url, repo, ex, {
    operatorApproval: true,
    reviewer: 'admin',
    expectedStatus: 'APPROVED',
    expectedLockVersion: prep.lockVersion,
    asOf: publishedAt || US_PUB_DAY,
  }));
}

async function setHalt(store, region, halted, reason) {
  return haltSvc.setEmergencyHalt({
    haltStore: store,
    region: region,
    halted: halted,
    reason: reason || 'step5',
    actorId: ADMIN,
  });
}

async function countUsPublished(repo, dateKey) {
  const dc = await usRun.countPublishedUsOnDate(repo, dateKey, US_PUB_DAY);
  return dc.count;
}

async function main() {
  report('baseline_head', 'INFO', BASE_HEAD);

  const url = process.env.DAILY_ISSUE_DATABASE_URL;
  const gate = assertDailyIssueIsolatedTarget(url, SCHEMA);
  if (!gate.ok || !isAllowedTestSchema(SCHEMA)) {
    report('isolated_env', 'BLOCKED', gate.reason || 'missing-url');
    console.log('PHASE19_STEP5_VERDICT BLOCKED');
    process.exit(2);
  }

  const boot = fresh(url);
  if (!boot.ex.ok) {
    report('isolated_env', 'BLOCKED', 'executor');
    console.log('PHASE19_STEP5_VERDICT BLOCKED');
    process.exit(2);
  }
  await boot.repo.initialize();
  const haltStore = createSqlEmergencyHaltStore({ executor: boot.ex, schemaName: SCHEMA });
  await haltStore.initialize();
  await setHalt(haltStore, 'KR', false, 'reset');
  const dateKey = usOps.slotFor(US_PUB_DAY).dateKey;

  // --- 1a regression: 3 then block ---
  try {
    for (const pair of [
      ['r1', 'us-national'],
      ['r2', 'us-politics'],
      ['r3', 'us-world'],
    ]) {
      const prep = await approveUs(boot.repo, url, boot.ex, pair[0], pair[1]);
      if (!prep.ok) throw new Error(prep.error);
      const pub = await publishUs(boot.repo, url, boot.ex, prep, US_PUB_DAY);
      if (!pub.ok) throw new Error(pub.error);
    }
    const prep4 = await approveUs(boot.repo, url, boot.ex, 'r4', 'us-national');
    const block = await publishUs(boot.repo, url, boot.ex, prep4, US_PUB_DAY);
    const c = await countUsPublished(boot.repo, dateKey);
    report(
      'us_daily_three_then_block',
      c === 3 && block.ok === false && block.error === 'US_DAILY_MAX_REACHED' ? 'PASS' : 'FAIL',
      'count=' + c + ' err=' + (block.error || 'ok'),
    );
  } catch (e) {
    report('us_daily_three_then_block', 'FAIL', String(e.message || e));
  }

  // --- 1b two published + concurrent dual publish (different candidates) ---
  try {
    const freshBoot = fresh(url);
    await freshBoot.repo.initialize();
    const dk = usOps.slotFor('2026-08-10T15:30:00.000Z').dateKey;
    const pubAt = '2026-08-10T15:30:00.000Z';
    for (const pair of [
      ['c1', 'us-national'],
      ['c2', 'us-politics'],
    ]) {
      const prep = await approveUs(freshBoot.repo, url, freshBoot.ex, pair[0], pair[1]);
      const pub = await publishUs(freshBoot.repo, url, freshBoot.ex, prep, pubAt);
      if (!pub.ok) throw new Error(pub.error);
    }
    const p3 = await approveUs(freshBoot.repo, url, freshBoot.ex, 'c3', 'us-world');
    const p4 = await approveUs(freshBoot.repo, url, freshBoot.ex, 'c4', 'us-national');
    const traceA = [];
    const traceB = [];
    const results = await Promise.all([
      reviewService.transitionItem(p3.id, 'PUBLISHED', dbOpt(url, freshBoot.repo, freshBoot.ex, {
        operatorApproval: true,
        reviewer: 'admin',
        expectedStatus: 'APPROVED',
        expectedLockVersion: p3.lockVersion,
        asOf: pubAt,
        __haltPublishTrace: function (e) {
          traceA.push(e);
        },
      })),
      reviewService.transitionItem(p4.id, 'PUBLISHED', dbOpt(url, freshBoot.repo, freshBoot.ex, {
        operatorApproval: true,
        reviewer: 'admin',
        expectedStatus: 'APPROVED',
        expectedLockVersion: p4.lockVersion,
        asOf: pubAt,
        __haltPublishTrace: function (e) {
          traceB.push(e);
        },
      })),
    ]);
    const okCount = results.filter(function (r) {
      return r.ok;
    }).length;
    const failMax = results.filter(function (r) {
      return !r.ok && r.error === 'US_DAILY_MAX_REACHED';
    }).length;
    const total = await countUsPublished(freshBoot.repo, dk);
    const slotA = usOps.slotFor(US_SLOT_A);
    const slotB = usOps.slotFor(US_SLOT_B);
    const runKeyA = slotA.runKey || 'us-daily-issue:' + dk + ':11';
    const runKeyB = slotB.runKey || 'us-daily-issue:' + dk + ':19';
    const parallelRuns = await Promise.all([
      usRun.runUsDailyIssueSlot(
        dbOpt(url, freshBoot.repo, freshBoot.ex, {
          asOf: US_SLOT_A,
          forceSlot: true,
          runKey: runKeyA + ':' + PREFIX,
          env: { DAILY_ISSUE_US_SCHEDULER_ENABLED: '1', DAILY_ISSUE_US_AUTO_PUBLISH: '1' },
          skipNetwork: true,
          ingestRunner: async function () {
            return { ok: true, readyCandidates: [], candidates: [] };
          },
        }),
      ),
      usRun.runUsDailyIssueSlot(
        dbOpt(url, freshBoot.repo, freshBoot.ex, {
          asOf: US_SLOT_B,
          forceSlot: true,
          runKey: runKeyB + ':' + PREFIX,
          env: { DAILY_ISSUE_US_SCHEDULER_ENABLED: '1', DAILY_ISSUE_US_AUTO_PUBLISH: '1' },
          skipNetwork: true,
          ingestRunner: async function () {
            return { ok: true, readyCandidates: [], candidates: [] };
          },
        }),
      ),
    ]);
    const totalAfterRuns = await countUsPublished(freshBoot.repo, dk);
    report(
      'us_daily_concurrent_two_of_three',
      total === 3 && okCount === 1 && failMax === 1 && totalAfterRuns === 3 ? 'PASS' : 'FAIL',
      'total=' + total + ' ok=' + okCount + ' maxFail=' + failMax + ' runs=' + parallelRuns.map(function (r) {
        return r.reason || r.outcome || '';
      }).join(','),
    );
    await freshBoot.ex.end();
  } catch (e) {
    report('us_daily_concurrent_two_of_three', 'FAIL', String(e.message || e));
  }

  // --- 2 halt race + lock trace ---
  try {
    await setHalt(haltStore, 'KR', false, 'race');
    const prepKr = await approveKr(boot.repo, url, boot.ex, 'haltRace');
    if (!prepKr.ok) throw new Error(prepKr.error);
    const traces = [];
    let haltAuditTs = null;
    const haltT = qIdent(SCHEMA, 'daily_issue_emergency_halt_audit');
    const race = await Promise.all([
      (async function () {
        await setHalt(haltStore, 'KR', true, 'race-concurrent');
        const aud = await boot.ex.query('SELECT created_at FROM ' + haltT + " WHERE action='HALT_ON' ORDER BY created_at DESC LIMIT 1");
        haltAuditTs = aud.rows[0] && aud.rows[0].created_at;
      })(),
      reviewService.transitionItem(prepKr.id, 'PUBLISHED', dbOpt(url, boot.repo, boot.ex, {
        operatorApproval: true,
        reviewer: 'admin',
        expectedStatus: 'APPROVED',
        expectedLockVersion: prepKr.lockVersion,
        asOf: AS_OF,
        __haltPublishTrace: function (e) {
          traces.push(e);
        },
      })),
    ]);
    const pub = race[1];
    const row = await boot.repo.getById(prepKr.id);
    const haltLocked = traces.find(function (t) {
      return t.phase === 'halt_row_locked';
    });
    const okRace =
      pub.ok === false &&
      pub.error === 'EMERGENCY_HALT_ACTIVE' &&
      row.ok &&
      row.item.status === 'APPROVED' &&
      haltLocked &&
      haltLocked.halted === true;
    report(
      'halt_race_lock_trace',
      okRace ? 'PASS' : 'FAIL',
      'pub=' + (pub.error || 'ok') + ' traceHalt=' + (haltLocked && haltLocked.halted) + ' audit=' + (haltAuditTs != null),
    );
    await setHalt(haltStore, 'KR', false, 'race-off');
  } catch (e) {
    report('halt_race_lock_trace', 'FAIL', String(e.message || e));
  }

  // --- 3 halt admin GET/POST mock auth ---
  try {
    const roleMap = {
      [TOKENS.admin]: 'ADMIN',
      [TOKENS.owner]: 'OWNER',
      [TOKENS.member]: 'MEMBER',
    };
    const app = createDailyIssueApiApp({
      repositoryInstance: boot.repo,
      executor: boot.ex,
      schemaName: SCHEMA,
      repositoryKind: 'db',
      databaseUrl: url,
      adminAuthGuard: createTestAdminAuthGuard(roleMap),
    });
    const cases = [
      ['halt_get_none', 'GET', null, 401],
      ['halt_get_bad', 'GET', TOKENS.bad, 401],
      ['halt_get_member', 'GET', TOKENS.member, 403],
      ['halt_get_admin', 'GET', TOKENS.admin, 200],
      ['halt_get_owner', 'GET', TOKENS.owner, 200],
      ['halt_post_member', 'POST', TOKENS.member, 403],
      ['halt_post_admin', 'POST', TOKENS.admin, 200],
      ['halt_post_owner', 'POST', TOKENS.owner, 200],
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const c = cases[i];
      const headers = { 'Content-Type': 'application/json' };
      if (c[2]) headers.Authorization = 'Bearer ' + c[2];
      const body = c[1] === 'POST' ? { halted: true, reason: 'step5-post' } : undefined;
      const res = await requestApp(app, c[1], '/api/admin/daily-issues/emergency-halt/KR', { headers: headers, body: body });
      report(c[0], res.status === c[3] ? 'MOCK PASS' : 'FAIL', 'status=' + res.status);
    }
    const realConfigured =
      String(process.env.DAILY_ISSUE_REAL_AUTH_INTEGRATION || '').trim() === '1' &&
      String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    report('halt_auth_real', realConfigured ? 'NOT_RUN' : 'REAL AUTH BLOCKED', 'mock-only');
    await setHalt(haltStore, 'KR', false, 'post-cleanup');
  } catch (e) {
    report('halt_admin_auth', 'FAIL', String(e.message || e));
  }

  // --- 4 production store: no silent memory ---
  try {
    const script = `
      process.env.NODE_ENV='production';
      delete process.env.DAILY_ISSUE_DATABASE_URL;
      const usRun=require(${JSON.stringify(path.join(__dirname, '..', 'server', 'daily-issue-us-run-service.js'))});
      const { startUsScheduler }=require(${JSON.stringify(path.join(__dirname, '..', 'server', 'daily-issue-us-scheduler.js'))});
      const s=usRun.resolveUsSchedulerStore({});
      const started=startUsScheduler({ forceEnabled:true });
      console.log('PROD_STORE', s.unavailable?'unavailable':'bad', s.reason||'', started.started===false?'no-start':'started');
    `;
    const sub = cp.spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: Object.assign({}, process.env, { NODE_ENV: 'production' }) });
    const out = (sub.stdout || '') + (sub.stderr || '');
    const okProd = out.indexOf('unavailable') >= 0 && out.indexOf('no-start') >= 0;
    report('us_prod_no_memory_fallback', okProd ? 'PASS' : 'FAIL', out.trim().slice(0, 120));
    const mem = usRun.resolveUsSchedulerStore({ allowMemoryUsStore: true });
    report('us_dev_memory_allowed', mem && mem.kind !== 'unavailable' ? 'PASS' : 'FAIL', 'kind=' + (mem && mem.kind));
  } catch (e) {
    report('us_prod_no_memory_fallback', 'FAIL', String(e.message || e));
  }

  await boot.ex.end();
  if (failed) {
    console.log('PHASE19_STEP5_VERDICT FAIL failed=' + failed);
    process.exit(1);
  }
  console.log('PHASE19_STEP5_VERDICT PASS');
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
