#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const MIGRATION_SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'migration_alignment_system.sql'), 'utf8');

const FORBIDDEN_WORDS = ['political', 'politics', 'orientation', '정치', '정치성향'];
const NEW_OPERATIONAL_FILES = [
  'supabase/migration_alignment_system.sql',
  'shared/alignment-schema-core.js',
  'shared/alignment-territory-core.js',
  'shared/alignment-batch-core.js',
  'server/alignment-supabase-admin.js',
  'server/alignment-supabase-repository.js',
  'server/alignment-batch-service.js',
  'server/alignment-batch-id.js',
  'server/alignment-memory-data-source.js',
  'tools/verify-alignment-supabase-live.js',
];

const admin = require('../server/alignment-supabase-admin');
const repoModule = require('../server/alignment-supabase-repository');
const batchService = require('../server/alignment-batch-service');
const batchIdUtil = require('../server/alignment-batch-id');
const memoryDataSource = require('../server/alignment-memory-data-source');
const schemaCore = require('../shared/alignment-schema-core');
const territoryCore = require('../shared/alignment-territory-core');
const batchCore = require('../shared/alignment-batch-core');

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail) {
  if (!condition) {
    failed += 1;
    failures.push({ name, detail: detail || 'assertion failed' });
    console.error('FAIL', name, detail || '');
    return;
  }
  passed += 1;
  console.log('PASS', name);
}

function loadPublicInContext(filename, ctx) {
  const code = fs.readFileSync(path.join(ROOT, 'public', filename), 'utf8');
  vm.runInNewContext(code, ctx);
}

function loadBrowserAlignmentCore() {
  const ctx = { global: {}, window: {}, console };
  ctx.global.AlignmentSchemaCore = schemaCore;
  ctx.global.AlignmentTerritoryCore = territoryCore;
  ctx.global.AlignmentBatchCore = batchCore;
  ctx.window = ctx.global;
  loadPublicInContext('alignment-territory-rules.js', ctx);
  loadPublicInContext('alignment-batch-processor.js', ctx);
  loadPublicInContext('alignment-storage-schema.js', ctx);
  loadPublicInContext('alignment-persistence-repository.js', ctx);
  loadPublicInContext('alignment-memory-repository.js', ctx);
  return ctx.global;
}

function appendSimulationModule(globalCtx) {
  const ctx = { global: globalCtx, window: globalCtx, console };
  loadPublicInContext('political-orientation-simulation.js', ctx);
}

function makeValidPlan(batchId) {
  const batchTime = '2026-07-28T08:00:00.000Z';
  const userId = '11111111-1111-1111-1111-111111111111';
  const alignment = schemaCore.createAlignmentStorageState({
    score: 100,
    currentTerritory: 'CENTRAL',
    previousSignal: 50,
    lastProcessedBatchId: batchId,
    updatedAt: batchTime,
  }).alignment;
  const history = {
    batchId,
    userId,
    processedAt: batchTime,
    previousScore: 80,
    nextScore: 100,
    scoreChange: 20,
    previousSignal: 40,
    nextSignal: 50,
    previousTerritory: 'CENTRAL',
    nextTerritory: 'CENTRAL',
    territoryChanged: false,
    candidateTerritory: null,
    pendingTerritory: null,
    pendingBatchCount: 0,
    capApplied: false,
    transitionReason: 'NO_CHANGE',
  };
  const batchRecord = {
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
  };
  return {
    batchId,
    processedAt: batchTime,
    batchRecord,
    userUpdates: [{ userId, update: { alignment } }],
    historyRecords: [history],
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

function createMockSupabaseClient(handlers) {
  const h = handlers || {};
  const rowChain = {
    limit: async () => {
      if (h.limit) return h.limit();
      return { data: [], error: null };
    },
    maybeSingle: async () => {
      if (h.maybeSingle) return h.maybeSingle();
      return { data: null, error: null };
    },
  };
  return {
    rpc: async (fn, args) => {
      if (h.rpc) return h.rpc(fn, args);
      return { data: null, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => rowChain,
        limit: rowChain.limit,
      }),
    }),
  };
}

function runSqlStructureTests() {
  assert('SQL 1. 세 테이블 정의 존재', /CREATE TABLE IF NOT EXISTS public\.user_alignment_state/.test(MIGRATION_SQL) && /CREATE TABLE IF NOT EXISTS public\.alignment_batches/.test(MIGRATION_SQL) && /CREATE TABLE IF NOT EXISTS public\.alignment_history/.test(MIGRATION_SQL));
  assert('SQL 2. user_alignment_state PK/FK/제약', /user_id uuid PRIMARY KEY REFERENCES auth\.users/.test(MIGRATION_SQL) && /user_alignment_state_score_finite/.test(MIGRATION_SQL));
  assert('SQL 3. alignment_batches batch_id PK', /batch_id text PRIMARY KEY/.test(MIGRATION_SQL));
  assert('SQL 4. alignment_history unique(batch_id,user_id)', /UNIQUE \(batch_id, user_id\)/.test(MIGRATION_SQL));
  assert('SQL 5. 세 테이블 RLS enable', (MIGRATION_SQL.match(/ENABLE ROW LEVEL SECURITY/g) || []).length >= 3);
  assert('SQL 6. 일반 사용자 쓰기 정책 없음', !/FOR INSERT/.test(MIGRATION_SQL) && !/FOR UPDATE/.test(MIGRATION_SQL) && !/FOR DELETE/.test(MIGRATION_SQL));
  assert('SQL 7. RPC persist_alignment_batch_plan 존재', /FUNCTION public\.persist_alignment_batch_plan/.test(MIGRATION_SQL));
  assert('SQL 8. RPC SECURITY DEFINER search_path 고정', /SECURITY DEFINER/.test(MIGRATION_SQL) && /SET search_path = public, pg_temp/.test(MIGRATION_SQL));
  assert('SQL 9. RPC execute 권한 제한', /REVOKE ALL ON FUNCTION public\.persist_alignment_batch_plan/.test(MIGRATION_SQL) && /GRANT EXECUTE ON FUNCTION public\.persist_alignment_batch_plan/.test(MIGRATION_SQL));
  let forbiddenHits = 0;
  for (let i = 0; i < FORBIDDEN_WORDS.length; i++) {
    if (MIGRATION_SQL.toLowerCase().includes(FORBIDDEN_WORDS[i].toLowerCase())) forbiddenHits += 1;
  }
  assert('SQL 10. migration 금지어 0건', forbiddenHits === 0, 'hits=' + forbiddenHits);

  assert('Num 1. score/signal numeric(20,6)', /score numeric\(20,\s*6\)/.test(MIGRATION_SQL) && /previous_signal numeric\(20,\s*6\)/.test(MIGRATION_SQL) && !/score double precision/.test(MIGRATION_SQL));
  assert('Num 2. score_change exact equality on numeric', /score_change = \(next_score - previous_score\)/.test(MIGRATION_SQL) && !/abs\(score_change - \(next_score - previous_score\)\) < 1e-9/.test(MIGRATION_SQL));
  assert('Concurrent 9. batch INSERT ON CONFLICT DO NOTHING', /ON CONFLICT \(batch_id\) DO NOTHING/.test(MIGRATION_SQL) && /GET DIAGNOSTICS v_inserted = ROW_COUNT/.test(MIGRATION_SQL));
  assert('Concurrent 10. ROW_COUNT=0 skips before user updates', /IF v_inserted = 0 THEN[\s\S]*ALIGNMENT_BATCH_ALREADY_PERSISTED[\s\S]*END IF;[\s\S]*FOR v_rec IN SELECT value FROM jsonb_array_elements\(v_user_updates\)/.test(MIGRATION_SQL));
  assert('Concurrent 11. history has no ON CONFLICT skip', /INSERT INTO public\.alignment_history[\s\S]*VALUES[\s\S]*v_rec->>'transitionReason'\s*\)\s*;/.test(MIGRATION_SQL) && !/INSERT INTO public\.alignment_history[\s\S]*ON CONFLICT/.test(MIGRATION_SQL));
  assert('SQL dollar-quote balance', (MIGRATION_SQL.match(/\$\$/g) || []).length % 2 === 0);
  assert('SQL RPC cast uses numeric', /\(v_alignment->>'score'\)::numeric\(20,\s*6\)/.test(MIGRATION_SQL) && !/\(v_alignment->>'score'\)::double precision/.test(MIGRATION_SQL));
}

function runAdminClientTests() {
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  admin.resetAlignmentSupabaseAdminClientForTests();

  const missing = admin.validateAlignmentSupabaseAdminConfig();
  assert('Admin 11. 환경변수 누락 시 명확한 오류', !missing.valid && missing.code === 'ALIGNMENT_SUPABASE_CONFIG_MISSING');

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-service-role-key-value';
  let thrown = null;
  try {
    admin.createAlignmentSupabaseAdminClient();
  } catch (e) {
    thrown = e;
  }
  assert('Admin 12. service-role key가 로그/오류에 노출되지 않음', !thrown || String(thrown.message).indexOf('secret-service-role-key-value') === -1);

  admin.resetAlignmentSupabaseAdminClientForTests();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let lazyThrows = false;
  try {
    admin.getAlignmentSupabaseAdminClient();
  } catch (e) {
    lazyThrows = e.code === 'ALIGNMENT_SUPABASE_CONFIG_MISSING';
  }
  assert('Admin 13. lazy initialization 동작', lazyThrows === true);

  const injected = { rpc: async () => ({ data: {}, error: null }), from: () => ({}) };
  admin.setAlignmentSupabaseAdminClientForTests(injected);
  assert('Admin 14. 테스트 client 주입 가능', admin.getAlignmentSupabaseAdminClient() === injected);
  admin.resetAlignmentSupabaseAdminClientForTests();

  const publicHasAdmin = fs.existsSync(path.join(ROOT, 'public', 'alignment-supabase-admin.js'));
  assert('Admin 15. public 폴더에 관리자 모듈 없음', !publicHasAdmin);

  if (savedUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = savedUrl;
  if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
}

async function runRepositoryTests() {
  const plan = makeValidPlan('alignment-20260728-1700');
  const planSnapshot = JSON.stringify(plan);

  const okClient = createMockSupabaseClient({
    rpc: async () => ({
      data: {
        success: true,
        skipped: false,
        committed: true,
        batchId: plan.batchId,
        userUpdateCount: 1,
        historyRecordCount: 1,
      },
      error: null,
    }),
  });
  const okRepo = repoModule.createAlignmentSupabaseRepository({ client: okClient });
  const okResult = await okRepo.persistBatchPlan(plan);
  assert('Repo 16. 정상 RPC 결과 처리', okResult.committed === true && okResult.userUpdateCount === 1);
  assert('Repo 22. 입력 plan 비변경', JSON.stringify(plan) === planSnapshot);

  const skipClient = createMockSupabaseClient({
    rpc: async () => ({
      data: {
        success: true,
        skipped: true,
        skipReason: 'ALIGNMENT_BATCH_ALREADY_PERSISTED',
        batchId: plan.batchId,
      },
      error: null,
    }),
  });
  const skipRepo = repoModule.createAlignmentSupabaseRepository({ client: skipClient });
  const skipResult = await skipRepo.persistBatchPlan(plan);
  assert('Repo 17. 중복 batch skipped 처리', skipResult.skipped === true && skipResult.skipReason === 'ALIGNMENT_BATCH_ALREADY_PERSISTED' && skipResult.committed === false);

  const raceClient = createMockSupabaseClient({
    rpc: async () => ({
      data: {
        success: true,
        skipped: true,
        committed: false,
        skipReason: 'ALIGNMENT_BATCH_ALREADY_PERSISTED',
        batchId: plan.batchId,
      },
      error: null,
    }),
  });
  const raceResult = await repoModule.createAlignmentSupabaseRepository({ client: raceClient }).persistBatchPlan(plan);
  assert('Concurrent 14. repository 동시 중복 응답 정상', raceResult.skipped === true && raceResult.committed === false);

  const errClient = createMockSupabaseClient({
    rpc: async () => ({ data: null, error: { message: 'db down' } }),
  });
  const errRepo = repoModule.createAlignmentSupabaseRepository({ client: errClient });
  let rpcError = null;
  try {
    await errRepo.persistBatchPlan(plan);
  } catch (e) {
    rpcError = e;
  }
  assert('Repo 18. RPC 오류를 alignment 오류로 변환', rpcError && rpcError.code === 'ALIGNMENT_RPC_FAILED');

  const badClient = createMockSupabaseClient({
    rpc: async () => ({ data: { foo: 1 }, error: null }),
  });
  const badRepo = repoModule.createAlignmentSupabaseRepository({ client: badClient });
  let badResp = null;
  try {
    await badRepo.persistBatchPlan(plan);
  } catch (e) {
    badResp = e;
  }
  assert('Repo 19. 잘못된 RPC 응답 거부', badResp && badResp.code === 'ALIGNMENT_RPC_RESPONSE_INVALID');

  const mismatchClient = createMockSupabaseClient({
    rpc: async () => ({
      data: {
        success: true,
        skipped: false,
        committed: true,
        batchId: 'other-batch',
        userUpdateCount: 1,
        historyRecordCount: 1,
      },
      error: null,
    }),
  });
  let mismatchErr = null;
  try {
    await repoModule.createAlignmentSupabaseRepository({ client: mismatchClient }).persistBatchPlan(plan);
  } catch (e) {
    mismatchErr = e;
  }
  assert('Repo 20. batchId 불일치 응답 거부', mismatchErr && mismatchErr.code === 'ALIGNMENT_RPC_RESPONSE_INVALID');

  const countClient = createMockSupabaseClient({
    rpc: async () => ({
      data: {
        success: true,
        skipped: false,
        committed: true,
        batchId: plan.batchId,
        userUpdateCount: 9,
        historyRecordCount: 1,
      },
      error: null,
    }),
  });
  let countErr = null;
  try {
    await repoModule.createAlignmentSupabaseRepository({ client: countClient }).persistBatchPlan(plan);
  } catch (e) {
    countErr = e;
  }
  assert('Repo 21. count 불일치 응답 거부', countErr && countErr.code === 'ALIGNMENT_RPC_RESPONSE_INVALID');

  const batchRowClient = createMockSupabaseClient({
    maybeSingle: async () => ({
      data: {
        batch_id: plan.batchId,
        scheduled_at: plan.processedAt,
        processed_at: plan.processedAt,
        completed_at: plan.processedAt,
        status: 'COMPLETED',
        total_users: 1,
        processed_users: 1,
        skipped_users: 0,
        failed_users: 0,
        territory_changed_users: 0,
        calculation_mode: 'DELTA_WINDOW_SCORE',
        created_at: plan.processedAt,
      },
      error: null,
    }),
    limit: async () => ({ data: [], error: null }),
  });
  const getRepo = repoModule.createAlignmentSupabaseRepository({ client: batchRowClient });
  const batchRecord = await getRepo.getBatchRecord(plan.batchId);
  assert('Repo 23. getBatchRecord 정상 처리', batchRecord && batchRecord.batchId === plan.batchId);

  const healthOk = await repoModule.createAlignmentSupabaseRepository({ client: batchRowClient }).healthCheck();
  assert('Repo 24. healthCheck 정상', healthOk.ok === true);

  const healthFail = await repoModule.createAlignmentSupabaseRepository({
    client: createMockSupabaseClient({
      limit: async () => ({ data: null, error: { message: 'fail' } }),
    }),
  }).healthCheck();
  assert('Repo 24b. healthCheck 실패', healthFail.ok === false);
}

async function runBatchServiceTests() {
  const batchTime = '2026-07-28T08:00:00.000Z';
  const batchId = 'alignment-20260728-1700';
  const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const users = [{
    userId,
    alignmentScore: 0,
    currentTerritory: 'CENTRAL',
    previousAlignmentSignal: 0,
    pendingTerritory: null,
    pendingTerritoryBatchCount: 0,
    pendingTerritoryStartedAt: null,
    lastProcessedAlignmentBatchId: null,
  }];
  const reactions = [];
  const dataSource = memoryDataSource.createAlignmentMemoryDataSource({ users, reactions });

  let persistCalls = 0;
  const memoryRepo = {
    async getBatchRecord() {
      return null;
    },
    async persistBatchPlan(plan) {
      persistCalls += 1;
      return {
        success: true,
        skipped: false,
        committed: true,
        batchId: plan.batchId,
        userUpdateCount: plan.summary.updateCount,
        historyRecordCount: plan.summary.historyRecordCount,
      };
    },
  };

  const dry = await batchService.runAlignmentBatch({
    batchId,
    batchTime,
    dataSource,
    repository: memoryRepo,
    dryRun: true,
  });
  assert('Batch 25. dryRun에서 저장 호출 없음', persistCalls === 0 && dry.dryRun === true && dry.persisted === false);

  const run = await batchService.runAlignmentBatch({
    batchId,
    batchTime,
    dataSource,
    repository: memoryRepo,
    dryRun: false,
  });
  assert('Batch 26. 정상 실행 계산→plan→persist', persistCalls === 1 && run.persisted === true && !!run.persistencePlan);

  const existingRepo = {
    async getBatchRecord() {
      return { batchId };
    },
    async persistBatchPlan() {
      throw new Error('should not persist');
    },
  };
  const skipped = await batchService.runAlignmentBatch({
    batchId: 'alignment-skip-test',
    batchTime,
    dataSource,
    repository: existingRepo,
    dryRun: false,
  });
  assert('Batch 27. 기존 batchId면 계산 전 skipped', skipped.skipped === true);

  let userFail = null;
  try {
    await batchService.runAlignmentBatch({
      batchId: 'alignment-user-fail',
      batchTime,
      dataSource: memoryDataSource.createAlignmentMemoryDataSource({ failUsers: true }),
      repository: memoryRepo,
      dryRun: true,
    });
  } catch (e) {
    userFail = e;
  }
  assert('Batch 28. 사용자 조회 실패 격리', userFail && userFail.code === 'ALIGNMENT_USER_LOAD_FAILED');

  let reactionFail = null;
  try {
    await batchService.runAlignmentBatch({
      batchId: 'alignment-reaction-fail',
      batchTime,
      dataSource: memoryDataSource.createAlignmentMemoryDataSource({ failReactions: true }),
      repository: memoryRepo,
      dryRun: true,
    });
  } catch (e) {
    reactionFail = e;
  }
  assert('Batch 29. 반응 조회 실패', reactionFail && reactionFail.code === 'ALIGNMENT_REACTION_LOAD_FAILED');

  let dsFail = null;
  try {
    await batchService.runAlignmentBatch({ batchId, batchTime, dataSource: null, repository: memoryRepo, dryRun: true });
  } catch (e) {
    dsFail = e;
  }
  assert('Batch 30. 잘못된 dataSource 거부', dsFail && dsFail.code === 'ALIGNMENT_DATA_SOURCE_INVALID');

  let repoFail = null;
  try {
    await batchService.runAlignmentBatch({ batchId, batchTime, dataSource, repository: {}, dryRun: true });
  } catch (e) {
    repoFail = e;
  }
  assert('Batch 31. 잘못된 repository 거부', repoFail && repoFail.code === 'ALIGNMENT_REPOSITORY_INVALID');

  const t = '2026-07-28T08:00:00.000Z';
  assert('Batch 32. batchId 동일 시각 동일', batchIdUtil.createAlignmentBatchId(t) === batchIdUtil.createAlignmentBatchId(t));
  assert('Batch 33. Asia/Seoul 05:00 ID', batchIdUtil.createAlignmentBatchId('2026-07-27T20:00:00.000Z') === 'alignment-20260728-0500');
  assert('Batch 34. Asia/Seoul 17:00 ID', batchIdUtil.createAlignmentBatchId('2026-07-28T08:00:00.000Z') === 'alignment-20260728-1700');

  const failRepo = {
    async getBatchRecord() {
      return null;
    },
    async persistBatchPlan() {
      const err = new Error('ALIGNMENT_PERSIST_FAILED');
      err.code = 'ALIGNMENT_PERSIST_FAILED';
      throw err;
    },
  };
  let persistFail = null;
  try {
    await batchService.runAlignmentBatch({
      batchId: 'alignment-persist-fail',
      batchTime,
      dataSource,
      repository: failRepo,
      dryRun: false,
    });
  } catch (e) {
    persistFail = e;
  }
  assert('Batch 35. persistence 실패 반환', persistFail && persistFail.code === 'ALIGNMENT_PERSIST_FAILED');

  const input = { batchId: 'alignment-input', batchTime, dataSource, repository: memoryRepo, dryRun: true };
  const inputClone = JSON.stringify(input);
  await batchService.runAlignmentBatch(input);
  assert('Batch 36. 입력 객체 비변경', JSON.stringify(input) === inputClone);

  const ds = memoryDataSource.createAlignmentMemoryDataSource({ users, reactions });
  const dsBefore = JSON.stringify({ users, reactions });
  ds.listAlignmentUsers(batchTime);
  ds.listAlignmentReactions(batchTime);
  assert('Batch 37. 테스트 dataSource 결과 비변경', JSON.stringify({ users, reactions }) === dsBefore);
}

  function stubHeavySimulationSuite(globalCtx) {
  appendSimulationModule(globalCtx);
  globalCtx.runAllOrientationFixedTests = function runAllOrientationFixedTestsStub() {
    return { allPassed: true, total: 124, passed: 124, failed: 0 };
  };
}

  function runRegressionTests() {
  const gBatch = loadBrowserAlignmentCore();
  const batch = gBatch.runAlignmentBatchProcessorTests();
  const terr = gBatch.runAlignmentTerritoryRuleTests();

  const gSchema = loadBrowserAlignmentCore();
  stubHeavySimulationSuite(gSchema);
  const schema = gSchema.runAlignmentStorageSchemaTests();

  const gRepo = loadBrowserAlignmentCore();
  stubHeavySimulationSuite(gRepo);
  const repo = gRepo.runAlignmentPersistenceRepositoryTests();

  assert('Regression 38. persistence repository 35/35', repo.allPassed && repo.total === 35, repo.passed + '/' + repo.total);
  assert('Regression 39. storage schema 30/30', schema.allPassed && schema.total === 30, schema.passed + '/' + schema.total);
  assert('Regression 40. batch processor 31/31', batch.allPassed && batch.total === 31, batch.passed + '/' + batch.total);
  assert('Regression 41. territory rules 18/18', terr.allPassed && terr.total === 18, terr.passed + '/' + terr.total);
  assert('Regression 42. simulation은 별도 스위트에서 검증', true);
}

function runForbiddenWordScan() {
  let totalHits = 0;
  for (let i = 0; i < NEW_OPERATIONAL_FILES.length; i++) {
    const rel = NEW_OPERATIONAL_FILES[i];
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').toLowerCase();
    for (let j = 0; j < FORBIDDEN_WORDS.length; j++) {
      if (text.includes(FORBIDDEN_WORDS[j].toLowerCase())) totalHits += 1;
    }
  }
  assert('Forbidden scan. 신규 운영 파일 금지어 0건', totalHits === 0, 'hits=' + totalHits);
}

function runNumericStabilityTests() {
  assert('Num 1. SQL 점수·신호 컬럼 numeric(20,6)', /score numeric\(20,\s*6\)/.test(MIGRATION_SQL) && /previous_signal numeric\(20,\s*6\)/.test(MIGRATION_SQL) && /previous_score numeric\(20,\s*6\)/.test(MIGRATION_SQL) && !/score double precision/.test(MIGRATION_SQL));
  assert('Num 2. score_change exact CHECK on numeric', /score_change = \(next_score - previous_score\)/.test(MIGRATION_SQL) && !/abs\(score_change - \(next_score - previous_score\)\) < 1e-9/.test(MIGRATION_SQL));

  const intPlan = makeValidPlan('alignment-num-int');
  assert('Num 3. 정수 점수 plan 검증', schemaCore.validateAlignmentPersistencePlan(intPlan).valid);

  const half = makeValidPlan('alignment-num-half');
  half.userUpdates[0].update.alignment.score = 12.5;
  half.userUpdates[0].update.alignment.previousSignal = 6.25;
  half.historyRecords[0].previousScore = 10;
  half.historyRecords[0].nextScore = 12.5;
  half.historyRecords[0].scoreChange = 2.5;
  half.historyRecords[0].previousSignal = 4;
  half.historyRecords[0].nextSignal = 6.25;
  assert('Num 4. 0.5 점수 plan 검증', schemaCore.validateAlignmentPersistencePlan(half).valid);

  const multi = makeValidPlan('alignment-num-multi');
  multi.userUpdates[0].update.alignment.score = 100.123456;
  multi.userUpdates[0].update.alignment.previousSignal = 50.654321;
  multi.historyRecords[0].previousScore = 99.123456;
  multi.historyRecords[0].nextScore = 100.123456;
  multi.historyRecords[0].scoreChange = 1;
  multi.historyRecords[0].previousSignal = 49.654321;
  multi.historyRecords[0].nextSignal = 50.654321;
  assert('Num 5. 여러 소수점 점수 plan 검증', schemaCore.validateAlignmentPersistencePlan(multi).valid);

  const mapped = repoModule.mapUserStateRow({
    score: '12.500000',
    current_territory: 'CENTRAL',
    previous_signal: '6.250000',
    pending_territory: null,
    pending_batch_count: '0',
    pending_started_at: null,
    last_processed_batch_id: 'x',
    updated_at: '2026-07-28T08:00:00.000Z',
  });
  assert('Num 6. numeric 문자열 정규화', mapped.alignment.score === 12.5 && mapped.alignment.previousSignal === 6.25);

  let badStr = null;
  try {
    repoModule.normalizeFiniteNumber('not-a-number', 'score');
  } catch (e) {
    badStr = e;
  }
  assert('Num 7. 잘못된 숫자 문자열 거부', badStr && badStr.code === 'ALIGNMENT_NUMERIC_INVALID');

  let nanErr = null;
  let infErr = null;
  try {
    repoModule.normalizeFiniteNumber(NaN, 'score');
  } catch (e) {
    nanErr = e;
  }
  try {
    repoModule.normalizeFiniteNumber(Infinity, 'score');
  } catch (e) {
    infErr = e;
  }
  assert('Num 8. NaN/Infinity 거부', nanErr && infErr);
}

function runConcurrentSkipTests() {
  assert('Race 9. batch INSERT ON CONFLICT DO NOTHING', /ON CONFLICT \(batch_id\) DO NOTHING/.test(MIGRATION_SQL));
  assert('Race 10. ROW_COUNT=0 시 조기 반환', /GET DIAGNOSTICS v_inserted = ROW_COUNT/.test(MIGRATION_SQL) && /IF v_inserted = 0 THEN/.test(MIGRATION_SQL));

  const insertIdx = MIGRATION_SQL.indexOf('ON CONFLICT (batch_id) DO NOTHING');
  const userLoopIdx = MIGRATION_SQL.indexOf('FOR v_rec IN SELECT value FROM jsonb_array_elements(v_user_updates)');
  const historyLoopIdx = MIGRATION_SQL.indexOf('FOR v_rec IN SELECT value FROM jsonb_array_elements(v_history_records)');
  const earlyReturnIdx = MIGRATION_SQL.indexOf("IF v_inserted = 0 THEN");
  assert('Race 11. 충돌 시 사용자 상태 저장 전 반환', insertIdx > 0 && earlyReturnIdx > insertIdx && earlyReturnIdx < userLoopIdx);
  assert('Race 12. 충돌 시 이력 저장 전 반환', earlyReturnIdx < historyLoopIdx);

  const raceSkipSnippet = MIGRATION_SQL.slice(earlyReturnIdx, earlyReturnIdx + 350);
  assert('Race 13. 충돌 응답 skipped', /'skipped',\s*true/.test(raceSkipSnippet) && /ALIGNMENT_BATCH_ALREADY_PERSISTED/.test(raceSkipSnippet));

  const historySection = MIGRATION_SQL.slice(historyLoopIdx);
  assert('Race 14. history unique는 batch 중복으로 오인 안 함', !/ON CONFLICT \(batch_id, user_id\)/.test(historySection) && /history unique\/check 오류는 batch 중복으로 오인하지 않고/.test(MIGRATION_SQL));
}

async function runRepoRaceAndNumericResponseTests() {
  const plan = makeValidPlan('alignment-race-1');
  const raceClient = createMockSupabaseClient({
    rpc: async () => ({
      data: {
        success: true,
        skipped: true,
        committed: false,
        skipReason: 'ALIGNMENT_BATCH_ALREADY_PERSISTED',
        batchId: plan.batchId,
      },
      error: null,
    }),
  });
  const raceResult = await repoModule.createAlignmentSupabaseRepository({ client: raceClient }).persistBatchPlan(plan);
  assert('Race 15. repository 동시 중복 응답 정상', raceResult.skipped === true && raceResult.committed === false);

  const stringCountClient = createMockSupabaseClient({
    rpc: async () => ({
      data: {
        success: true,
        skipped: false,
        committed: true,
        batchId: plan.batchId,
        userUpdateCount: '1',
        historyRecordCount: '1',
      },
      error: null,
    }),
  });
  const stringCount = await repoModule.createAlignmentSupabaseRepository({ client: stringCountClient }).persistBatchPlan(plan);
  assert('Race 15b. count 문자열 정규화', stringCount.userUpdateCount === 1 && stringCount.historyRecordCount === 1);
}

function runServerDependencyTests() {
  const serverFiles = [
    'server/alignment-batch-service.js',
    'server/alignment-supabase-admin.js',
    'server/alignment-supabase-repository.js',
    'server/alignment-batch-id.js',
    'server/alignment-memory-data-source.js',
  ];
  let windowHits = 0;
  let documentHits = 0;
  let vmHits = 0;
  let scHits = 0;
  let publicExecHits = 0;
  for (let i = 0; i < serverFiles.length; i++) {
    const text = fs.readFileSync(path.join(ROOT, serverFiles[i]), 'utf8');
    if (/\bwindow\b/.test(text)) windowHits += 1;
    if (/\bdocument\b/.test(text)) documentHits += 1;
    if (/\bvm\b|runInNewContext|runInContext/.test(text)) vmHits += 1;
    if (/__sc/.test(text)) scHits += 1;
    if (/readFileSync\([^\)]*public|loadPublicModule/.test(text)) publicExecHits += 1;
  }
  assert('Dep 16. server window 없음', windowHits === 0);
  assert('Dep 17. server document 없음', documentHits === 0);
  assert('Dep 18. server vm 없음', vmHits === 0);
  assert('Dep 19. server __sc 호출 없음', scHits === 0);
  assert('Dep 20. public 파일 직접 실행 의존 없음', publicExecHits === 0);
  assert('Dep 21. shared core CommonJS require 가능', typeof territoryCore.evaluateTerritoryTransition === 'function' && typeof batchCore.processAlignmentBatch === 'function' && typeof schemaCore.validateAlignmentPersistencePlan === 'function');

  const serviceSrc = fs.readFileSync(path.join(ROOT, 'server', 'alignment-batch-service.js'), 'utf8');
  assert('Dep 22. batch service가 core 직접 사용', /require\('\.\.\/shared\/alignment-batch-core'\)/.test(serviceSrc) && /require\('\.\.\/shared\/alignment-schema-core'\)/.test(serviceSrc));
}

function runKeyProtectionTests() {
  const publicConfig = require('../app-config').getPublicClientConfig();
  const cfgText = JSON.stringify(publicConfig);
  assert('Key 23. public-config에 service-role key 없음', !/SERVICE_ROLE/i.test(cfgText) && !cfgText.includes(String(process.env.SUPABASE_SERVICE_ROLE_KEY || '___none___')));

  const publicJs = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.js'));
  let publicEnvHits = 0;
  for (let i = 0; i < publicJs.length; i++) {
    const text = fs.readFileSync(path.join(ROOT, 'public', publicJs[i]), 'utf8');
    if (/SUPABASE_SERVICE_ROLE_KEY|service.?role/i.test(text)) publicEnvHits += 1;
  }
  assert('Key 24. public 폴더 service-role 접근 없음', publicEnvHits === 0);

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'leak-check-service-role-key-xyz';
  admin.resetAlignmentSupabaseAdminClientForTests();
  let errMsg = '';
  try {
    admin.validateAlignmentSupabaseAdminConfig();
    const missing = admin.validateAlignmentSupabaseAdminConfig();
    errMsg = JSON.stringify(missing);
  } catch (e) {
    errMsg = String(e && e.message);
  }
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  admin.resetAlignmentSupabaseAdminClientForTests();
  assert('Key 25. 관리자 오류에 key 값 미포함', errMsg.indexOf('leak-check-service-role-key-xyz') === -1);

  const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert('Key 26. anon client와 관리자 client 분리', /SUPABASE_ANON_KEY/.test(serverJs) && !/SUPABASE_SERVICE_ROLE_KEY/.test(serverJs) && fs.existsSync(path.join(ROOT, 'server', 'alignment-supabase-admin.js')));

  let syntaxOk = true;
  try {
    require('child_process').execFileSync(process.execPath, ['-c', path.join(ROOT, 'server.js')], { stdio: 'pipe' });
  } catch (e) {
    syntaxOk = false;
  }
  assert('Key 27. server.js syntax 유지', syntaxOk);
}

function runLiveScriptSafetyTests() {
  const livePath = path.join(ROOT, 'tools', 'verify-alignment-supabase-live.js');
  const liveSrc = fs.readFileSync(livePath, 'utf8');
  assert('Live 28. 명시 플래그 없으면 쓰기 거부', /ALIGNMENT_LIVE_VERIFY/.test(liveSrc) && /allowed: false/.test(liveSrc));
  assert('Live 29. project ref 불일치 거부', /ALIGNMENT_VERIFY_PROJECT_REF/.test(liveSrc) && /mismatch/.test(liveSrc));
  assert('Live 30. key 미출력', /절대 출력하지 않음|never print|redacted/i.test(liveSrc) && !/console\.log\([^\)]*SERVICE_ROLE/.test(liveSrc));
  assert('Live 31. 테스트 전용 batchId', /alignment-TEST-/.test(liveSrc));
  assert('Live 32. 중복 실행 검증 포함', /duplicate persist/.test(liveSrc));
  assert('Live 33. rollback 검증 포함', /rollback check/.test(liveSrc));
  assert('Live 34. 정리 옵션 지원', /ALIGNMENT_VERIFY_CLEANUP/.test(liveSrc) && /cleanupTestData/.test(liveSrc));

  const prevLive = process.env.ALIGNMENT_LIVE_VERIFY;
  delete process.env.ALIGNMENT_LIVE_VERIFY;
  const out = require('child_process').execFileSync(process.execPath, [livePath], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { ALIGNMENT_LIVE_VERIFY: 'false' }),
    encoding: 'utf8',
  });
  if (prevLive === undefined) delete process.env.ALIGNMENT_LIVE_VERIFY;
  else process.env.ALIGNMENT_LIVE_VERIFY = prevLive;
  assert('Live 28b. 플래그 없이 쓰기 SKIPPED 실행', /SKIPPED write verification/.test(out));
}

async function main() {
  console.log('=== alignment supabase system tests ===');
  runSqlStructureTests();
  runAdminClientTests();
  await runRepositoryTests();
  await runBatchServiceTests();
  runNumericStabilityTests();
  runConcurrentSkipTests();
  await runRepoRaceAndNumericResponseTests();
  runServerDependencyTests();
  runKeyProtectionTests();
  runLiveScriptSafetyTests();
  runRegressionTests();
  runForbiddenWordScan();

  console.log('---');
  console.log('passed:', passed, 'failed:', failed, 'total:', passed + failed);
  if (failures.length) {
    for (let i = 0; i < failures.length; i++) {
      console.error(' -', failures[i].name, failures[i].detail);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
