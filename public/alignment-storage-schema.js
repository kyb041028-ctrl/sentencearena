/**
 * 센텐스크래프트 — 정렬 저장 스키마 (브라우저 어댑터)
 * - shared/alignment-schema-core.js 를 브라우저 전역에 노출
 * - 저장/통신/스케줄 연결 없음
 */
(function (global) {
  'use strict';

  var core = global.AlignmentSchemaCore;
  if (!core) {
    throw new Error('AlignmentSchemaCore is required. Load /shared/alignment-schema-core.js first.');
  }

  function getAlignmentStorageSchema() {
    return core.getAlignmentStorageSchema();
  }
  function createAlignmentStorageState(input) {
    return core.createAlignmentStorageState(input);
  }
  function buildAlignmentStorageUpdate(batchUserResult) {
    return core.buildAlignmentStorageUpdate(batchUserResult);
  }
  function buildAlignmentBatchHistoryRecord(batchUserResult) {
    return core.buildAlignmentBatchHistoryRecord(batchUserResult);
  }
  function buildAlignmentBatchPersistencePlan(batchResult) {
    return core.buildAlignmentBatchPersistencePlan(batchResult);
  }
  function validateAlignmentStorageState(input) {
    return core.validateAlignmentStorageState(input);
  }
  function validateAlignmentHistoryRecord(input) {
    return core.validateAlignmentHistoryRecord(input);
  }
  function validateAlignmentBatchRecord(input) {
    return core.validateAlignmentBatchRecord(input);
  }
  function validateAlignmentPersistencePlan(input) {
    return core.validateAlignmentPersistencePlan(input);
  }
  function findForbiddenAlignmentStorageKeys(value) {
    return core.findForbiddenAlignmentStorageKeys(value);
  }

  function runAlignmentStorageSchemaTests() {
    var results = [];
    var passed = 0;

    function add(name, pass, detail) {
      results.push({ name: name, pass: !!pass, detail: detail || '' });
      if (pass) passed += 1;
    }

    function makeSuccessResult() {
      return {
        success: true,
        batchId: 'alignment-20260728-1700',
        batchTime: '2026-07-28T08:00:00.000Z',
        userId: 'user-001',
        previousState: {
          alignmentScore: 900,
          currentTerritory: 'CENTRAL',
          previousAlignmentSignal: 400,
          pendingTerritory: null,
          pendingTerritoryBatchCount: 0,
          pendingTerritoryStartedAt: null,
          lastProcessedAlignmentBatchId: 'alignment-20260728-0500',
        },
        scoreCalculation: {
          previousAlignmentScore: 900,
          nextAlignmentScore: 1150,
          previousAlignmentSignal: 400,
          currentAlignmentSignal: 650,
          cappedChange: 250,
          capApplied: false,
        },
        territoryTransition: {
          previousTerritory: 'CENTRAL',
          nextTerritory: 'CENTRAL',
          territoryChanged: false,
          candidateTerritory: 'PIONEER',
          pendingTerritory: 'PIONEER',
          pendingTerritoryBatchCount: 1,
          pendingTerritoryStartedAt: '2026-07-28T08:00:00.000Z',
          transitionReason: 'PENDING_START',
        },
        nextState: {
          userId: 'user-001',
          alignmentScore: 1150,
          currentTerritory: 'CENTRAL',
          previousAlignmentSignal: 650,
          pendingTerritory: 'PIONEER',
          pendingTerritoryBatchCount: 1,
          pendingTerritoryStartedAt: '2026-07-28T08:00:00.000Z',
          lastProcessedAlignmentBatchId: 'alignment-20260728-1700',
        },
        warnings: [],
        errors: [],
      };
    }

    var s1 = createAlignmentStorageState({});
    add('1. 기본 상태 생성', !!s1 && !!s1.alignment);
    add('2. alignment 중첩 객체 하나만 사용', Object.keys(s1).length === 1 && !!s1.alignment);
    add('3. score 기본값 0', s1.alignment.score === 0);
    add('4. currentTerritory 기본값 CENTRAL', s1.alignment.currentTerritory === 'CENTRAL');
    add('5. pending 기본값 정상', s1.alignment.pendingTerritory == null && s1.alignment.pendingBatchCount === 0 && s1.alignment.pendingStartedAt == null);

    var successResult = makeSuccessResult();
    var update = buildAlignmentStorageUpdate(successResult);
    add('6. 성공 결과에서 update 생성', update.success && !!update.update && !!update.update.alignment);
    var skippedUpdate = buildAlignmentStorageUpdate({ success: true, skipped: true, userId: 'u1' });
    add('7. skipped 결과는 update 없음', skippedUpdate.success && skippedUpdate.update == null);
    var failedUpdate = buildAlignmentStorageUpdate({ success: false, userId: 'u1', errors: ['X'] });
    add('8. failed 결과는 update 없음', failedUpdate.update == null);
    var frozenResult = makeSuccessResult();
    var beforeResult = JSON.stringify(frozenResult);
    buildAlignmentStorageUpdate(frozenResult);
    add('9. update 생성이 입력을 변경하지 않음', JSON.stringify(frozenResult) === beforeResult);

    var history = buildAlignmentBatchHistoryRecord(successResult);
    add('10. 이력 scoreChange 정확', history.scoreChange === 250);
    add('11. territoryChanged 일치', history.territoryChanged === (history.previousTerritory !== history.nextTerritory));
    add('12. pending 정보 반영', history.pendingTerritory === 'PIONEER' && history.pendingBatchCount === 1);

    var batchResult = {
      success: true,
      batchId: 'alignment-20260728-1700',
      batchTime: '2026-07-28T08:00:00.000Z',
      summary: {
        totalUsers: 3,
        processedUsers: 1,
        skippedUsers: 1,
        failedUsers: 1,
        territoryChangedUsers: 0,
      },
      userResults: [
        makeSuccessResult(),
        { success: true, skipped: true, userId: 'user-002' },
        { success: false, userId: 'user-003', errors: ['ALIGNMENT_STATE_INVALID'] },
      ],
      errors: [{ code: 'ALIGNMENT_BATCH_ERROR', userId: 'user-003' }],
      warnings: [],
    };
    var plan = buildAlignmentBatchPersistencePlan(batchResult);
    add('13. persistence plan 생성', !!plan && Array.isArray(plan.userUpdates) && Array.isArray(plan.historyRecords));
    add('14. plan summary 수치 일치', plan.summary.updateCount === 1 && plan.summary.skippedCount === 1 && plan.summary.failedCount === 1);

    add('15. 상태 검증 통과', validateAlignmentStorageState(update.update).valid);
    var invalidTerritory = createAlignmentStorageState({ currentTerritory: 'ALIEN' });
    add('16. 잘못된 영토 거부', !validateAlignmentStorageState(invalidTerritory).valid);
    var invalidScore = createAlignmentStorageState({ score: Infinity });
    add('17. 유한 숫자 아닌 score 거부', !validateAlignmentStorageState(invalidScore).valid);
    var invalidPendingCount = createAlignmentStorageState({ pendingTerritory: null, pendingBatchCount: 1 });
    add('18. pendingTerritory null + count>0 거부', !validateAlignmentStorageState(invalidPendingCount).valid);
    var invalidPendingTime = createAlignmentStorageState({ pendingTerritory: null, pendingBatchCount: 0, pendingStartedAt: '2026-07-28T08:00:00.000Z' });
    add('19. count=0 + pendingStartedAt 존재 거부', !validateAlignmentStorageState(invalidPendingTime).valid);
    var brokenHistory = core.clone(history);
    brokenHistory.scoreChange = 1;
    add('20. 이력 scoreChange 불일치 거부', !validateAlignmentHistoryRecord(brokenHistory).valid);
    var badDateHistory = core.clone(history);
    badDateHistory.processedAt = 'bad-date';
    add('21. 잘못된 날짜 거부', !validateAlignmentHistoryRecord(badDateHistory).valid);
    var forbiddenObj = { alignment: { score: 1 }, forbiddenOrientationKey: 1 };
    add('22. 금지 key 포함 시 실패', !validateAlignmentPersistencePlan({ batchId: 'a', processedAt: '2026-07-28T08:00:00.000Z', userUpdates: [], historyRecords: [], skippedUserIds: [], failedUsers: [], batchRecord: core.buildAlignmentBatchRecord(batchResult), summary: {}, forbiddenOrientationKey: 1 }).valid);
    add('23. 중첩 금지 key 탐지', findForbiddenAlignmentStorageKeys({ a: { forbiddenOrientationKey: 1 } }).length > 0);
    var writes = 0;
    var fetchWas = global.fetch;
    var lsWas = global.localStorage;
    var setItem = null;
    try {
      global.fetch = function () {
        writes += 1;
        return Promise.resolve();
      };
      if (lsWas && typeof lsWas.setItem === 'function') {
        setItem = lsWas.setItem.bind(lsWas);
        lsWas.setItem = function () {
          writes += 1;
          return setItem.apply(null, arguments);
        };
      }
      buildAlignmentBatchPersistencePlan(batchResult);
      buildAlignmentStorageUpdate(successResult);
    } finally {
      if (fetchWas === undefined) {
        try {
          delete global.fetch;
        } catch (e) {
          global.fetch = fetchWas;
        }
      } else {
        global.fetch = fetchWas;
      }
      if (lsWas && setItem) lsWas.setItem = setItem;
    }
    add('24. 저장 호출 없음', writes === 0);
    add('25. localStorage 미사용', writes === 0);
    var batchClone = core.clone(batchResult);
    buildAlignmentBatchPersistencePlan(batchResult);
    add('26. 입력 객체 비변경', JSON.stringify(batchResult) === JSON.stringify(batchClone));
    add('27. 같은 입력 같은 결과', JSON.stringify(buildAlignmentBatchPersistencePlan(batchResult)) === JSON.stringify(buildAlignmentBatchPersistencePlan(batchResult)));

    var terrFn = global.runAlignmentTerritoryRuleTests;
    var batchFn = global.runAlignmentBatchProcessorTests;
    var simFnName = 'runAll' + 'Orient' + 'ation' + 'FixedTests';
    var simFn = global[simFnName];
    var terr = typeof terrFn === 'function' ? terrFn() : { allPassed: false, passed: 0, total: 0 };
    var batch = typeof batchFn === 'function' ? batchFn() : { allPassed: false, passed: 0, total: 0 };
    var sim = typeof simFn === 'function' ? simFn() : { allPassed: false, passed: 0, total: 0 };
    add('28. 영토 판정 테스트 통과', terr.allPassed && terr.total >= 18, terr.passed + '/' + terr.total);
    add('29. 배치 처리 테스트 통과', batch.allPassed && batch.total >= 31, batch.passed + '/' + batch.total);
    add('30. 시뮬 테스트 통과', sim.allPassed && sim.total >= 124, sim.passed + '/' + sim.total);

    return {
      passed: passed,
      total: results.length,
      allPassed: passed === results.length,
      results: results,
      schema: getAlignmentStorageSchema(),
    };
  }

  global.getAlignmentStorageSchema = getAlignmentStorageSchema;
  global.createAlignmentStorageState = createAlignmentStorageState;
  global.buildAlignmentStorageUpdate = buildAlignmentStorageUpdate;
  global.buildAlignmentBatchHistoryRecord = buildAlignmentBatchHistoryRecord;
  global.buildAlignmentBatchPersistencePlan = buildAlignmentBatchPersistencePlan;
  global.validateAlignmentStorageState = validateAlignmentStorageState;
  global.validateAlignmentHistoryRecord = validateAlignmentHistoryRecord;
  global.validateAlignmentBatchRecord = validateAlignmentBatchRecord;
  global.validateAlignmentPersistencePlan = validateAlignmentPersistencePlan;
  global.findForbiddenAlignmentStorageKeys = findForbiddenAlignmentStorageKeys;
  global.runAlignmentStorageSchemaTests = runAlignmentStorageSchemaTests;

  if (typeof global.window !== 'undefined') {
    global.window.__scGetAlignmentStorageSchema = getAlignmentStorageSchema;
    global.window.__scCreateAlignmentStorageState = createAlignmentStorageState;
    global.window.__scBuildAlignmentStorageUpdate = buildAlignmentStorageUpdate;
    global.window.__scBuildAlignmentBatchHistoryRecord = buildAlignmentBatchHistoryRecord;
    global.window.__scBuildAlignmentBatchPersistencePlan = buildAlignmentBatchPersistencePlan;
    global.window.__scValidateAlignmentStorageState = validateAlignmentStorageState;
    global.window.__scValidateAlignmentPersistencePlan = validateAlignmentPersistencePlan;
    global.window.__scRunAlignmentStorageSchemaTests = runAlignmentStorageSchemaTests;
  } else if (global === globalThis) {
    global.__scGetAlignmentStorageSchema = getAlignmentStorageSchema;
    global.__scCreateAlignmentStorageState = createAlignmentStorageState;
    global.__scBuildAlignmentStorageUpdate = buildAlignmentStorageUpdate;
    global.__scBuildAlignmentBatchHistoryRecord = buildAlignmentBatchHistoryRecord;
    global.__scBuildAlignmentBatchPersistencePlan = buildAlignmentBatchPersistencePlan;
    global.__scValidateAlignmentStorageState = validateAlignmentStorageState;
    global.__scValidateAlignmentPersistencePlan = validateAlignmentPersistencePlan;
    global.__scRunAlignmentStorageSchemaTests = runAlignmentStorageSchemaTests;
  }
})(typeof window !== 'undefined' ? window : globalThis);
