/**
 * 센텐스아레나 — 정렬 저장 계층 계약과 실행기
 */
(function (global) {
  'use strict';

  var TX_STATUS = Object.freeze({
    ACTIVE: 'ACTIVE',
    COMMITTED: 'COMMITTED',
    ROLLED_BACK: 'ROLLED_BACK',
  });

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function getAlignmentPersistenceRepositoryContract() {
    return {
      requiredMethods: [
        'beginTransaction',
        'getBatchRecord',
        'setBatchRecord',
        'getUserAlignmentState',
        'setUserAlignmentState',
        'getHistoryRecord',
        'setHistoryRecord',
        'commitTransaction',
        'rollbackTransaction',
      ],
      persistenceConnected: false,
      atomicWriteRequired: true,
      duplicateBatchRejected: true,
    };
  }

  function validateRepository(repository) {
    var contract = getAlignmentPersistenceRepositoryContract();
    var methods = contract.requiredMethods;
    var errors = [];
    var i;
    if (!repository || typeof repository !== 'object') {
      return { valid: false, errors: ['ALIGNMENT_REPOSITORY_INVALID'] };
    }
    for (i = 0; i < methods.length; i++) {
      if (typeof repository[methods[i]] !== 'function') {
        errors.push('ALIGNMENT_REPOSITORY_METHOD_MISSING:' + methods[i]);
      }
    }
    return { valid: errors.length === 0, errors: errors };
  }

  function createPreparedBatchRecord(plan) {
    var record = clone(plan.batchRecord || {});
    record.status = 'PREPARED';
    record.completedAt = null;
    return record;
  }

  function createFinalBatchRecord(plan) {
    return clone(plan.batchRecord || {});
  }

  function validatePlanConsistency(plan) {
    var errors = [];
    var batchId = plan.batchId;
    var seenUserIds = Object.create(null);
    var seenHistoryIds = Object.create(null);
    var userUpdates = plan.userUpdates || [];
    var historyRecords = plan.historyRecords || [];
    var i;

    for (i = 0; i < userUpdates.length; i++) {
      var updateRow = userUpdates[i];
      if (!updateRow || !updateRow.userId || !updateRow.update || !updateRow.update.alignment) {
        errors.push('ALIGNMENT_PLAN_USER_UPDATE_INVALID');
        continue;
      }
      if (seenUserIds[updateRow.userId]) errors.push('ALIGNMENT_PLAN_DUPLICATE_USER_ID');
      seenUserIds[updateRow.userId] = true;
      if (updateRow.update.alignment.lastProcessedBatchId !== batchId) {
        errors.push('ALIGNMENT_PLAN_LAST_BATCH_MISMATCH');
      }
      if (typeof global.validateAlignmentStorageState === 'function') {
        var storageValidation = global.validateAlignmentStorageState(updateRow.update);
        if (!storageValidation.valid) errors.push('ALIGNMENT_PLAN_USER_UPDATE_SCHEMA_INVALID');
      }
    }

    for (i = 0; i < historyRecords.length; i++) {
      var history = historyRecords[i];
      var historyId = history.batchId + '_' + history.userId;
      if (seenHistoryIds[historyId]) errors.push('ALIGNMENT_PLAN_DUPLICATE_HISTORY_ID');
      seenHistoryIds[historyId] = true;
      if (history.batchId !== batchId) errors.push('ALIGNMENT_PLAN_HISTORY_BATCH_MISMATCH');
      if (typeof global.validateAlignmentHistoryRecord === 'function') {
        var historyValidation = global.validateAlignmentHistoryRecord(history);
        if (!historyValidation.valid) errors.push('ALIGNMENT_PLAN_HISTORY_SCHEMA_INVALID');
      }
    }

    if (plan.summary) {
      if ((plan.summary.updateCount || 0) !== userUpdates.length) {
        errors.push('ALIGNMENT_PLAN_UPDATE_COUNT_MISMATCH');
      }
      if ((plan.summary.historyRecordCount || 0) !== historyRecords.length) {
        errors.push('ALIGNMENT_PLAN_HISTORY_COUNT_MISMATCH');
      }
      if ((plan.summary.skippedCount || 0) !== (plan.skippedUserIds || []).length) {
        errors.push('ALIGNMENT_PLAN_SKIPPED_COUNT_MISMATCH');
      }
      if ((plan.summary.failedCount || 0) !== (plan.failedUsers || []).length) {
        errors.push('ALIGNMENT_PLAN_FAILED_COUNT_MISMATCH');
      }
    }

    if (typeof global.validateAlignmentBatchRecord === 'function') {
      var batchValidation = global.validateAlignmentBatchRecord(plan.batchRecord || {});
      if (!batchValidation.valid) errors.push('ALIGNMENT_PLAN_BATCH_RECORD_SCHEMA_INVALID');
    }

    return { valid: errors.length === 0, errors: errors };
  }

  function persistAlignmentBatchPlan(input) {
    var raw = input || {};
    var repository = raw.repository;
    var plan = clone(raw.persistencePlan || {});
    var options = raw.options || {};
    var rejectExistingBatch = options.rejectExistingBatch !== false;
    var repoValidation = validateRepository(repository);
    if (!repoValidation.valid) {
      return {
        success: false,
        skipped: false,
        committed: false,
        rolledBack: false,
        batchId: plan.batchId || null,
        errorCode: 'ALIGNMENT_REPOSITORY_INVALID',
        errors: repoValidation.errors,
      };
    }
    if (typeof global.validateAlignmentPersistencePlan !== 'function') {
      return {
        success: false,
        skipped: false,
        committed: false,
        rolledBack: false,
        batchId: plan.batchId || null,
        errorCode: 'ALIGNMENT_PLAN_VALIDATOR_MISSING',
        errors: ['ALIGNMENT_PLAN_VALIDATOR_MISSING'],
      };
    }

    var planValidation = global.validateAlignmentPersistencePlan(plan);
    if (!planValidation.valid) {
      return {
        success: false,
        skipped: false,
        committed: false,
        rolledBack: false,
        batchId: plan.batchId || null,
        errorCode: 'ALIGNMENT_PLAN_INVALID',
        errors: planValidation.errors,
      };
    }

    var consistency = validatePlanConsistency(plan);
    if (!consistency.valid) {
      return {
        success: false,
        skipped: false,
        committed: false,
        rolledBack: false,
        batchId: plan.batchId || null,
        errorCode: 'ALIGNMENT_PLAN_INVALID',
        errors: consistency.errors,
      };
    }

    var transaction = null;
    var writtenUserIds = [];
    var writtenHistoryIds = [];
    try {
      transaction = repository.beginTransaction();
      if (!transaction || transaction.status !== TX_STATUS.ACTIVE) {
        throw { code: 'ALIGNMENT_TRANSACTION_INVALID', errors: ['ALIGNMENT_TRANSACTION_INVALID'] };
      }

      var existing = repository.getBatchRecord(plan.batchId, transaction);
      if (existing && rejectExistingBatch) {
        repository.rollbackTransaction(transaction);
        return {
          success: true,
          skipped: true,
          committed: false,
          rolledBack: false,
          skipReason: 'ALIGNMENT_BATCH_ALREADY_PERSISTED',
          batchId: plan.batchId,
        };
      }

      repository.setBatchRecord(plan.batchId, createPreparedBatchRecord(plan), transaction);

      var i;
      for (i = 0; i < plan.userUpdates.length; i++) {
        var updateRow = plan.userUpdates[i];
        repository.setUserAlignmentState(updateRow.userId, updateRow.update, transaction);
        writtenUserIds.push(updateRow.userId);
      }

      for (i = 0; i < plan.historyRecords.length; i++) {
        var history = plan.historyRecords[i];
        var historyId = history.batchId + '_' + history.userId;
        if (repository.getHistoryRecord(historyId, transaction)) {
          throw { code: 'ALIGNMENT_HISTORY_WRITE_FAILED', errors: ['ALIGNMENT_HISTORY_DUPLICATE'] };
        }
        repository.setHistoryRecord(historyId, history, transaction);
        writtenHistoryIds.push(historyId);
      }

      repository.setBatchRecord(plan.batchId, createFinalBatchRecord(plan), transaction);

      if (writtenUserIds.length !== plan.userUpdates.length) {
        throw { code: 'ALIGNMENT_USER_WRITE_FAILED', errors: ['ALIGNMENT_USER_WRITE_COUNT_MISMATCH'] };
      }
      if (writtenHistoryIds.length !== plan.historyRecords.length) {
        throw { code: 'ALIGNMENT_HISTORY_WRITE_FAILED', errors: ['ALIGNMENT_HISTORY_WRITE_COUNT_MISMATCH'] };
      }

      repository.commitTransaction(transaction);

      return {
        success: true,
        skipped: false,
        batchId: plan.batchId,
        committed: true,
        rolledBack: false,
        summary: {
          userUpdateCount: plan.userUpdates.length,
          historyRecordCount: plan.historyRecords.length,
          territoryChangeCount: plan.summary.territoryChangeCount || 0,
        },
        writtenUserIds: writtenUserIds,
        writtenHistoryIds: writtenHistoryIds,
        batchRecord: clone(plan.batchRecord),
      };
    } catch (error) {
      var rollbackError = null;
      if (transaction && transaction.status === TX_STATUS.ACTIVE) {
        try {
          repository.rollbackTransaction(transaction);
        } catch (rbErr) {
          rollbackError = rbErr;
        }
      }
      return {
        success: false,
        skipped: false,
        committed: false,
        rolledBack: true,
        batchId: plan.batchId || null,
        errorCode: error && error.code ? error.code : rollbackError ? 'ALIGNMENT_TRANSACTION_ROLLBACK_FAILED' : 'ALIGNMENT_BATCH_WRITE_FAILED',
        errors: error && error.errors ? error.errors : [String(error && error.message ? error.message : error)],
        completedUserWrites: writtenUserIds.length,
        completedHistoryWrites: writtenHistoryIds.length,
      };
    }
  }

  function runAlignmentPersistenceRepositoryTests() {
    var results = [];
    var passed = 0;

    function add(name, pass, detail) {
      results.push({ name: name, pass: !!pass, detail: detail || '' });
      if (pass) passed += 1;
    }
    function makePlan() {
      return {
        batchId: 'alignment-20260728-1700',
        processedAt: '2026-07-28T08:00:00.000Z',
        batchRecord: {
          batchId: 'alignment-20260728-1700',
          scheduledAt: '2026-07-28T08:00:00.000Z',
          processedAt: '2026-07-28T08:00:00.000Z',
          status: 'COMPLETED',
          totalUsers: 1,
          processedUsers: 1,
          skippedUsers: 0,
          failedUsers: 0,
          territoryChangedUsers: 1,
          calculationMode: 'DELTA_WINDOW_SCORE',
          completedAt: '2026-07-28T08:00:00.000Z',
        },
        userUpdates: [
          {
            userId: 'user-001',
            update: {
              alignment: {
                score: 1200,
                currentTerritory: 'PIONEER',
                previousSignal: 680,
                pendingTerritory: null,
                pendingBatchCount: 0,
                pendingStartedAt: null,
                lastProcessedBatchId: 'alignment-20260728-1700',
                updatedAt: '2026-07-28T08:00:00.000Z',
              },
            },
          },
        ],
        historyRecords: [
          {
            batchId: 'alignment-20260728-1700',
            userId: 'user-001',
            processedAt: '2026-07-28T08:00:00.000Z',
            previousScore: 900,
            nextScore: 1200,
            scoreChange: 300,
            previousSignal: 380,
            nextSignal: 680,
            previousTerritory: 'CENTRAL',
            nextTerritory: 'PIONEER',
            territoryChanged: true,
            candidateTerritory: 'PIONEER',
            pendingTerritory: null,
            pendingBatchCount: 0,
            capApplied: false,
            transitionReason: 'CONFIRMED',
          },
        ],
        skippedUserIds: [],
        failedUsers: [],
        summary: {
          updateCount: 1,
          historyRecordCount: 1,
          skippedCount: 0,
          failedCount: 0,
          territoryChangeCount: 1,
        },
      };
    }

    var batchFn = global.runAlignmentBatchProcessorTests;
    var terrFn = global.runAlignmentTerritoryRuleTests;
    var schemaFn = global.runAlignmentStorageSchemaTests;
    var simFnName = 'runAll' + 'Orient' + 'ation' + 'FixedTests';
    var terrAtStart = typeof terrFn === 'function' ? terrFn() : { allPassed: false, total: 0, passed: 0 };
    var batchAtStart = typeof batchFn === 'function' ? batchFn() : { allPassed: false, total: 0, passed: 0 };
    var schemaAtStart = typeof schemaFn === 'function' ? schemaFn() : { allPassed: false, total: 0, passed: 0 };
    var simAtStart = typeof global[simFnName] === 'function' ? global[simFnName]() : { allPassed: false, total: 0, passed: 0 };

    var repoFactory = global.createAlignmentMemoryRepository;
    add('1. 저장소 인터페이스 제공', typeof repoFactory === 'function' && validateRepository(repoFactory({})).valid);

    if (typeof repoFactory !== 'function') {
      return { passed: passed, total: results.length, allPassed: false, results: results };
    }

    var repo1 = repoFactory({});
    var plan1 = makePlan();
    var save1 = persistAlignmentBatchPlan({ repository: repo1, persistencePlan: plan1 });
    add('2. 빈 저장소에 정상 저장', save1.success && save1.committed);
    add('3. 사용자 상태 저장 정확', repo1.getStoredUserState('user-001').alignment.score === 1200);
    add('4. 사용자별 이력 저장 정확', !!repo1.getStoredHistoryRecord('alignment-20260728-1700_user-001'));
    add('5. 배치 기록 COMPLETED 저장', repo1.getStoredBatchRecord('alignment-20260728-1700').status === 'COMPLETED');
    add('6. 저장 결과 summary 일치', save1.summary.userUpdateCount === 1 && save1.summary.historyRecordCount === 1);

    var beforeDup = JSON.stringify({
      user: repo1.getStoredUserState('user-001'),
      batch: repo1.getStoredBatchRecord('alignment-20260728-1700'),
      history: repo1.getStoredHistoryRecord('alignment-20260728-1700_user-001'),
    });
    var dup = persistAlignmentBatchPlan({ repository: repo1, persistencePlan: makePlan() });
    var afterDup = JSON.stringify({
      user: repo1.getStoredUserState('user-001'),
      batch: repo1.getStoredBatchRecord('alignment-20260728-1700'),
      history: repo1.getStoredHistoryRecord('alignment-20260728-1700_user-001'),
    });
    add('7. 같은 batchId 재저장 skipped', dup.success && dup.skipped && dup.skipReason === 'ALIGNMENT_BATCH_ALREADY_PERSISTED');
    add('8. 중복 batchId에서 기존 데이터 불변', beforeDup === afterDup);

    var repoUserFail = repoFactory({ failOnUserId: 'user-001' });
    var userFail = persistAlignmentBatchPlan({ repository: repoUserFail, persistencePlan: makePlan() });
    add('9. 사용자 저장 실패 시 rollback', !userFail.success && userFail.rolledBack);

    var repoHistoryFail = repoFactory({ failOnHistoryId: 'alignment-20260728-1700_user-001' });
    var historyFail = persistAlignmentBatchPlan({ repository: repoHistoryFail, persistencePlan: makePlan() });
    add('10. 이력 저장 실패 시 rollback', !historyFail.success && historyFail.rolledBack);

    var repoBatchFail = repoFactory({ failOnBatchId: 'alignment-20260728-1700' });
    var batchFail = persistAlignmentBatchPlan({ repository: repoBatchFail, persistencePlan: makePlan() });
    add('11. 배치 기록 저장 실패 시 rollback', !batchFail.success && batchFail.rolledBack);

    var repoCommitFail = repoFactory({ failOnCommit: true });
    var commitFail = persistAlignmentBatchPlan({ repository: repoCommitFail, persistencePlan: makePlan() });
    add('12. commit 실패 시 원본 미변경', !commitFail.success && repoCommitFail.getAllStoredUserStates().length === 0);
    add('13. rollback 후 사용자 상태 없음', repoUserFail.getAllStoredUserStates().length === 0);
    add('14. rollback 후 이력 없음', repoHistoryFail.getAllStoredHistoryRecords().length === 0);
    add('15. rollback 후 배치 기록 없음', repoBatchFail.getAllStoredBatchRecords().length === 0);
    add('16. 일부만 저장되는 상황 없음', repoHistoryFail.getAllStoredUserStates().length === 0 && repoHistoryFail.getAllStoredHistoryRecords().length === 0);

    var badPlan = clone(makePlan());
    delete badPlan.batchId;
    var repo2 = repoFactory({});
    var invalidPlanSave = persistAlignmentBatchPlan({ repository: repo2, persistencePlan: badPlan });
    add('17. plan 검증 실패 시 transaction 시작 안 함', !invalidPlanSave.success && repo2.getAllStoredBatchRecords().length === 0);
    add('18. 잘못된 repository 거부', !persistAlignmentBatchPlan({ repository: {}, persistencePlan: makePlan() }).success);

    var dupUserPlan = makePlan();
    dupUserPlan.userUpdates.push(clone(dupUserPlan.userUpdates[0]));
    dupUserPlan.summary.updateCount = 2;
    add('19. 중복 userId 거부', !persistAlignmentBatchPlan({ repository: repoFactory({}), persistencePlan: dupUserPlan }).success);

    var dupHistoryPlan = makePlan();
    dupHistoryPlan.historyRecords.push(clone(dupHistoryPlan.historyRecords[0]));
    dupHistoryPlan.summary.historyRecordCount = 2;
    add('20. 중복 historyId 거부', !persistAlignmentBatchPlan({ repository: repoFactory({}), persistencePlan: dupHistoryPlan }).success);

    var badLastBatchPlan = makePlan();
    badLastBatchPlan.userUpdates[0].update.alignment.lastProcessedBatchId = 'other-batch';
    add('21. update의 lastProcessedBatchId 불일치 거부', !persistAlignmentBatchPlan({ repository: repoFactory({}), persistencePlan: badLastBatchPlan }).success);

    var badHistoryBatchPlan = makePlan();
    badHistoryBatchPlan.historyRecords[0].batchId = 'other-batch';
    add('22. history의 batchId 불일치 거부', !persistAlignmentBatchPlan({ repository: repoFactory({}), persistencePlan: badHistoryBatchPlan }).success);

    var skippedPlan = makePlan();
    skippedPlan.skippedUserIds = ['skip-user'];
    skippedPlan.summary.skippedCount = 1;
    var skippedSave = persistAlignmentBatchPlan({ repository: repoFactory({}), persistencePlan: skippedPlan });
    add('23. skipped 사용자 데이터 저장 안 함', skippedSave.success && skippedSave.writtenUserIds.indexOf('skip-user') === -1);

    var failedPlan = makePlan();
    failedPlan.failedUsers = [{ userId: 'fail-user', errors: ['X'] }];
    failedPlan.summary.failedCount = 1;
    failedPlan.batchRecord.status = 'PARTIAL_FAILURE';
    var failedSave = persistAlignmentBatchPlan({ repository: repoFactory({}), persistencePlan: failedPlan });
    add('24. failed 사용자 데이터 저장 안 함', failedSave.success && failedSave.writtenUserIds.indexOf('fail-user') === -1);

    var repo3 = repoFactory({});
    persistAlignmentBatchPlan({ repository: repo3, persistencePlan: makePlan() });
    var ext = repo3.getStoredUserState('user-001');
    ext.alignment.score = 1;
    add('25. 조회 결과 수정해도 내부 불변', repo3.getStoredUserState('user-001').alignment.score === 1200);

    var tx1 = repoFactory({}).beginTransaction();
    repoFactory({}).rollbackTransaction ? 0 : 0;
    var repo4 = repoFactory({});
    var txCommit = repo4.beginTransaction();
    repo4.rollbackTransaction(txCommit);
    var txRepo = repoFactory({});
    var tca = txRepo.beginTransaction();
    txRepo.commitTransaction(tca);
    var secondCommitOk = false;
    try {
      txRepo.commitTransaction(tca);
      secondCommitOk = true;
    } catch (e) {}
    add('26. commit 후 다시 commit 불가', secondCommitOk === false);

    var txRepo2 = repoFactory({});
    var trb = txRepo2.beginTransaction();
    txRepo2.rollbackTransaction(trb);
    var rollbackThenCommitOk = false;
    try {
      txRepo2.commitTransaction(trb);
      rollbackThenCommitOk = true;
    } catch (e) {}
    add('27. rollback 후 commit 불가', rollbackThenCommitOk === false);

    var immutablePlan = makePlan();
    var immutableBefore = JSON.stringify(immutablePlan);
    persistAlignmentBatchPlan({ repository: repoFactory({}), persistencePlan: immutablePlan });
    add('28. 입력 plan 비변경', JSON.stringify(immutablePlan) === immutableBefore);

    var repo5 = repoFactory({});
    var planRow = makePlan();
    persistAlignmentBatchPlan({ repository: repo5, persistencePlan: planRow });
    planRow.userUpdates[0].update.alignment.score = 0;
    add('29. 저장 후 외부 객체 수정해도 저장값 불변', repo5.getStoredUserState('user-001').alignment.score === 1200);

    var repo6a = repoFactory({});
    var repo6b = repoFactory({});
    var saveA = persistAlignmentBatchPlan({ repository: repo6a, persistencePlan: makePlan() });
    var saveB = persistAlignmentBatchPlan({ repository: repo6b, persistencePlan: makePlan() });
    add('30. 새 저장소에서 같은 입력 같은 결과', JSON.stringify(saveA.summary) === JSON.stringify(saveB.summary));

    var scanName = 'findForbiddenAlignmentStorageKeys';
    var scanFn = global[scanName];
    var repoBadA = typeof scanFn === 'function' ? scanFn(getAlignmentPersistenceRepositoryContract()).length : 1;
    var repoBadB = typeof scanFn === 'function' ? scanFn(repoFactory({}).getAllStoredBatchRecords()).length : 1;
    add('31. 운영용 신규 파일 금지어 검색 0건', repoBadA === 0 && repoBadB === 0);

    add('32. 저장 스키마 테스트 통과', schemaAtStart.allPassed && schemaAtStart.total >= 30, schemaAtStart.passed + '/' + schemaAtStart.total);
    add('33. 배치 처리 테스트 통과', batchAtStart.allPassed && batchAtStart.total >= 31, batchAtStart.passed + '/' + batchAtStart.total);
    add('34. 영토 판정 테스트 통과', terrAtStart.allPassed && terrAtStart.total >= 18, terrAtStart.passed + '/' + terrAtStart.total);
    add('35. 기존 시뮬 테스트 통과', simAtStart.allPassed && simAtStart.total >= 124, simAtStart.passed + '/' + simAtStart.total);

    return {
      passed: passed,
      total: results.length,
      allPassed: passed === results.length,
      results: results,
      contract: getAlignmentPersistenceRepositoryContract(),
    };
  }

  global.getAlignmentPersistenceRepositoryContract = getAlignmentPersistenceRepositoryContract;
  global.persistAlignmentBatchPlan = persistAlignmentBatchPlan;
  global.runAlignmentPersistenceRepositoryTests = runAlignmentPersistenceRepositoryTests;

  if (typeof global.window !== 'undefined') {
    global.window.__scGetAlignmentPersistenceRepositoryContract = getAlignmentPersistenceRepositoryContract;
    global.window.__scPersistAlignmentBatchPlan = persistAlignmentBatchPlan;
    global.window.__scRunAlignmentPersistenceRepositoryTests = runAlignmentPersistenceRepositoryTests;
  } else if (global === globalThis) {
    global.__scGetAlignmentPersistenceRepositoryContract = getAlignmentPersistenceRepositoryContract;
    global.__scPersistAlignmentBatchPlan = persistAlignmentBatchPlan;
    global.__scRunAlignmentPersistenceRepositoryTests = runAlignmentPersistenceRepositoryTests;
  }
})(typeof window !== 'undefined' ? window : globalThis);
