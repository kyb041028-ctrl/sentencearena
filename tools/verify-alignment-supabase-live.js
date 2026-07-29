#!/usr/bin/env node
'use strict';

/**
 * alignment Supabase live 검증 스크립트
 *
 * 안전 규칙:
 * - ALIGNMENT_LIVE_VERIFY=true 가 아니면 쓰기 검증을 실행하지 않음
 * - ALIGNMENT_VERIFY_PROJECT_REF 가 설정되면 SUPABASE_URL의 project ref와 일치해야 함
 * - service-role key 값을 절대 출력하지 않음
 * - 테스트 batchId만 사용: alignment-TEST-YYYYMMDD-HHmmss-<random>
 *
 * 실행 예:
 *   ALIGNMENT_LIVE_VERIFY=true ALIGNMENT_VERIFY_PROJECT_REF=xxxx npm run test:alignment-supabase-live
 */

const crypto = require('crypto');
const { createAlignmentSupabaseAdminClient } = require('../server/alignment-supabase-admin');
const { createAlignmentSupabaseRepository } = require('../server/alignment-supabase-repository');
const schemaCore = require('../shared/alignment-schema-core');

function maskUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol + '//' + u.host + '/';
  } catch (e) {
    return '[invalid-url]';
  }
}

function extractProjectRef(url) {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

function createTestBatchId() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex');
  return 'alignment-TEST-' + y + mo + d + '-' + h + mi + s + '-' + rand;
}

function assertSafetyGates() {
  const live = String(process.env.ALIGNMENT_LIVE_VERIFY || '').trim() === 'true';
  if (!live) {
    return {
      allowed: false,
      reason: 'ALIGNMENT_LIVE_VERIFY is not exactly true — write verification skipped',
    };
  }

  const expectedRef = String(process.env.ALIGNMENT_VERIFY_PROJECT_REF || '').trim();
  const url = String(process.env.SUPABASE_URL || '').trim();
  const actualRef = extractProjectRef(url);

  if (expectedRef) {
    if (!actualRef || actualRef !== expectedRef) {
      return {
        allowed: false,
        reason: 'ALIGNMENT_VERIFY_PROJECT_REF mismatch — write verification refused',
        expectedRef,
        actualRef: actualRef || null,
      };
    }
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      allowed: false,
      reason: 'SUPABASE_SERVICE_ROLE_KEY missing',
    };
  }

  return { allowed: true, projectRef: actualRef, urlHost: maskUrl(url) };
}

function buildTestPlan(batchId, userId) {
  const batchTime = new Date().toISOString();
  const alignment = schemaCore.createAlignmentStorageState({
    score: 12.5,
    currentTerritory: 'CENTRAL',
    previousSignal: 6.25,
    lastProcessedBatchId: batchId,
    updatedAt: batchTime,
  }).alignment;

  return {
    batchId,
    processedAt: batchTime,
    batchRecord: {
      batchId,
      scheduledAt: batchTime,
      processedAt: batchTime,
      completedAt: batchTime,
      status: 'COMPLETED',
      totalUsers: 1,
      processedUsers: 1,
      skippedUsers: 0,
      failedUsers: 0,
      territoryChangedUsers: 0,
      calculationMode: 'DELTA_WINDOW_SCORE',
    },
    userUpdates: [{ userId, update: { alignment } }],
    historyRecords: [
      {
        batchId,
        userId,
        processedAt: batchTime,
        previousScore: 10,
        nextScore: 12.5,
        scoreChange: 2.5,
        previousSignal: 4,
        nextSignal: 6.25,
        previousTerritory: 'CENTRAL',
        nextTerritory: 'CENTRAL',
        territoryChanged: false,
        candidateTerritory: null,
        pendingTerritory: null,
        pendingBatchCount: 0,
        capApplied: false,
        transitionReason: 'HOLD',
      },
    ],
    skippedUserIds: [],
    failedUsers: [],
    summary: {
      updateCount: 1,
      historyRecordCount: 1,
      skippedCount: 0,
      failedCount: 0,
      territoryChangeCount: 0,
    },
  };
}

async function cleanupTestData(client, batchId, userId) {
  if (userId) {
    await client.from('alignment_history').delete().eq('batch_id', batchId).eq('user_id', userId);
    await client.from('user_alignment_state').delete().eq('user_id', userId).eq('last_processed_batch_id', batchId);
  }
  await client.from('alignment_batches').delete().eq('batch_id', batchId);
}

async function main() {
  const gate = assertSafetyGates();
  console.log('[alignment-live-verify] safety gate:', JSON.stringify({
    allowed: gate.allowed,
    reason: gate.reason || null,
    projectRef: gate.projectRef || gate.actualRef || null,
    urlHost: gate.urlHost || null,
  }));

  if (!gate.allowed) {
    console.log('[alignment-live-verify] READ-ONLY / SKIPPED write verification');
    process.exit(0);
  }

  const testUserId = String(process.env.ALIGNMENT_VERIFY_TEST_USER_ID || '').trim();
  if (!testUserId) {
    console.error('[alignment-live-verify] ALIGNMENT_VERIFY_TEST_USER_ID required for write tests');
    process.exit(2);
  }

  const client = createAlignmentSupabaseAdminClient();
  const repo = createAlignmentSupabaseRepository({ client });
  const health = await repo.healthCheck();
  console.log('[alignment-live-verify] healthCheck:', health.ok ? 'ok' : 'fail');
  if (!health.ok) {
    process.exit(3);
  }

  const batchId = createTestBatchId();
  if (!batchId.startsWith('alignment-TEST-')) {
    console.error('[alignment-live-verify] invalid test batchId generator');
    process.exit(4);
  }
  console.log('[alignment-live-verify] test batchId:', batchId);

  const plan = buildTestPlan(batchId, testUserId);
  const first = await repo.persistBatchPlan(plan);
  console.log('[alignment-live-verify] first persist:', first.skipped ? 'skipped' : 'committed');

  const second = await repo.persistBatchPlan(plan);
  console.log('[alignment-live-verify] duplicate persist:', second.skipped ? 'skipped-ok' : 'unexpected');

  let rollbackOk = false;
  try {
    const badPlan = JSON.parse(JSON.stringify(plan));
    badPlan.batchId = createTestBatchId();
    badPlan.batchRecord.batchId = badPlan.batchId;
    badPlan.historyRecords[0].scoreChange = 999;
    badPlan.historyRecords[0].batchId = badPlan.batchId;
    await repo.persistBatchPlan(badPlan);
  } catch (e) {
    rollbackOk = true;
    console.log('[alignment-live-verify] rollback check: exception-as-expected');
  }
  if (!rollbackOk) {
    console.error('[alignment-live-verify] rollback check failed (bad plan accepted)');
    process.exit(5);
  }

  const batch = await repo.getBatchRecord(batchId);
  const state = await repo.getUserAlignmentState(testUserId);
  const history = await repo.getHistoryRecord(batchId + '_' + testUserId);
  console.log('[alignment-live-verify] stored counts:', {
    batchFound: !!batch,
    stateScore: state && state.alignment ? state.alignment.score : null,
    historyFound: !!history,
  });

  if (String(process.env.ALIGNMENT_VERIFY_CLEANUP || '').trim() === 'true') {
    await cleanupTestData(client, batchId, testUserId);
    console.log('[alignment-live-verify] cleanup done');
  } else {
    console.log('[alignment-live-verify] cleanup skipped (set ALIGNMENT_VERIFY_CLEANUP=true to delete test rows)');
  }

  if (!second.skipped || !batch || !history) {
    process.exit(6);
  }
  console.log('[alignment-live-verify] PASS');
  process.exit(0);
}

main().catch((e) => {
  const msg = e && e.message ? e.message : String(e);
  if (msg.includes(process.env.SUPABASE_SERVICE_ROLE_KEY || '___none___')) {
    console.error('[alignment-live-verify] failed (details redacted)');
  } else {
    console.error('[alignment-live-verify] failed:', msg);
  }
  process.exit(1);
});
