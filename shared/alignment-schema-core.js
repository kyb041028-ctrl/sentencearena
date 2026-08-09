/**
 * 센텐스아레나 — alignment 저장 스키마 공용 코어
 * Node(CommonJS)와 브라우저(UMD) 양쪽에서 사용
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlignmentSchemaCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function alignmentSchemaCoreFactory() {
  'use strict';

  var TERRITORY = Object.freeze({
    CENTRAL: 'CENTRAL',
    PIONEER: 'PIONEER',
    GUARDIAN: 'GUARDIAN',
  });

  var BATCH_STATUS = Object.freeze({
    PREPARED: 'PREPARED',
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    PARTIAL_FAILURE: 'PARTIAL_FAILURE',
    FAILED: 'FAILED',
  });

  var STORAGE_SCHEMA = Object.freeze({
    userStatePath: 'users/{userId}.alignment',
    batchCollection: 'alignmentBatches',
    historyCollection: 'alignmentHistory',
    persistenceConnected: false,
    apiConnected: false,
  });

  var FORBIDDEN_PARTS = Object.freeze([
    'polit' + 'ical',
    'polit' + 'ics',
    'orient' + 'ation',
    '\uC815\uCE58',
    '\uC815\uCE58\uC131\uD5A5',
  ]);

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }
  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function isValidDate(v) {
    return v == null ? false : isFinite(new Date(v).getTime());
  }
  function isTerritory(v) {
    return v === TERRITORY.CENTRAL || v === TERRITORY.PIONEER || v === TERRITORY.GUARDIAN;
  }
  function isPendingCountValid(v) {
    return Number.isInteger(v) && v >= 0;
  }
  function getBatchRecordStatus(batchResult) {
    if (!batchResult || batchResult.success === false) return BATCH_STATUS.FAILED;
    if ((batchResult.summary && batchResult.summary.failedUsers > 0) || (batchResult.errors && batchResult.errors.length > 0)) {
      return BATCH_STATUS.PARTIAL_FAILURE;
    }
    return BATCH_STATUS.COMPLETED;
  }

  function getAlignmentStorageSchema() {
    return clone(STORAGE_SCHEMA);
  }

  function createAlignmentStorageState(input) {
    var src = input || {};
    return {
      alignment: {
        score: src.score == null ? 0 : src.score,
        currentTerritory: src.currentTerritory == null ? TERRITORY.CENTRAL : src.currentTerritory,
        previousSignal: src.previousSignal == null ? 0 : src.previousSignal,
        pendingTerritory: src.pendingTerritory == null ? null : src.pendingTerritory,
        pendingBatchCount: src.pendingBatchCount == null ? 0 : src.pendingBatchCount,
        pendingStartedAt: src.pendingStartedAt == null ? null : src.pendingStartedAt,
        lastProcessedBatchId: src.lastProcessedBatchId == null ? null : src.lastProcessedBatchId,
        updatedAt: src.updatedAt == null ? null : src.updatedAt,
      },
    };
  }

  function buildAlignmentStorageUpdate(batchUserResult) {
    if (!batchUserResult || typeof batchUserResult !== 'object') {
      return { success: false, userId: null, update: null, errors: ['ALIGNMENT_UPDATE_INPUT_REQUIRED'] };
    }
    if (batchUserResult.skipped) {
      return { success: true, skipped: true, userId: batchUserResult.userId || null, update: null, errors: [], warnings: batchUserResult.warnings || [] };
    }
    if (!batchUserResult.success) {
      return { success: false, userId: batchUserResult.userId || null, update: null, errors: batchUserResult.errors || ['ALIGNMENT_UPDATE_SOURCE_INVALID'] };
    }

    var nextState = clone(batchUserResult.nextState || {});
    return {
      success: true,
      userId: batchUserResult.userId || nextState.userId || null,
      update: createAlignmentStorageState({
        score: nextState.alignmentScore,
        currentTerritory: nextState.currentTerritory,
        previousSignal: nextState.previousAlignmentSignal,
        pendingTerritory: nextState.pendingTerritory,
        pendingBatchCount: nextState.pendingTerritoryBatchCount,
        pendingStartedAt: nextState.pendingTerritoryStartedAt,
        lastProcessedBatchId: nextState.lastProcessedAlignmentBatchId,
        updatedAt: batchUserResult.batchTime || null,
      }),
      errors: [],
      warnings: batchUserResult.warnings || [],
    };
  }

  function buildAlignmentBatchHistoryRecord(batchUserResult) {
    if (!batchUserResult || !batchUserResult.success || batchUserResult.skipped) return null;
    return {
      batchId: batchUserResult.batchId,
      userId: batchUserResult.userId,
      processedAt: batchUserResult.batchTime,
      previousScore: batchUserResult.previousState.alignmentScore,
      nextScore: batchUserResult.nextState.alignmentScore,
      scoreChange: batchUserResult.scoreCalculation.cappedChange,
      previousSignal: batchUserResult.scoreCalculation.previousAlignmentSignal,
      nextSignal: batchUserResult.scoreCalculation.currentAlignmentSignal,
      previousTerritory: batchUserResult.territoryTransition.previousTerritory,
      nextTerritory: batchUserResult.territoryTransition.nextTerritory,
      territoryChanged: batchUserResult.territoryTransition.territoryChanged,
      candidateTerritory: batchUserResult.territoryTransition.candidateTerritory,
      pendingTerritory: batchUserResult.territoryTransition.pendingTerritory,
      pendingBatchCount: batchUserResult.territoryTransition.pendingTerritoryBatchCount,
      capApplied: batchUserResult.scoreCalculation.capApplied,
      transitionReason: batchUserResult.territoryTransition.transitionReason,
    };
  }

  function buildAlignmentBatchRecord(batchResult) {
    var result = batchResult || {};
    var summary = result.summary || {};
    return {
      batchId: result.batchId || null,
      scheduledAt: result.batchTime || null,
      processedAt: result.batchTime || null,
      status: getBatchRecordStatus(result),
      totalUsers: summary.totalUsers || 0,
      processedUsers: summary.processedUsers || 0,
      skippedUsers: summary.skippedUsers || 0,
      failedUsers: summary.failedUsers || 0,
      territoryChangedUsers: summary.territoryChangedUsers || 0,
      calculationMode: 'DELTA_WINDOW_SCORE',
      completedAt: result.batchTime || null,
    };
  }

  function buildAlignmentBatchPersistencePlan(batchResult) {
    var result = clone(batchResult || {});
    var userUpdates = [];
    var historyRecords = [];
    var skippedUserIds = [];
    var failedUsers = [];
    var userResults = result.userResults || [];
    var i;

    for (i = 0; i < userResults.length; i++) {
      var userResult = userResults[i];
      if (!userResult || !userResult.success) {
        failedUsers.push({
          userId: userResult && userResult.userId ? userResult.userId : null,
          errors: userResult && userResult.errors ? clone(userResult.errors) : ['ALIGNMENT_RESULT_INVALID'],
        });
        continue;
      }
      if (userResult.skipped) {
        skippedUserIds.push(userResult.userId);
        continue;
      }
      var update = buildAlignmentStorageUpdate(userResult);
      var history = buildAlignmentBatchHistoryRecord(userResult);
      if (update && update.update) userUpdates.push(update);
      if (history) historyRecords.push(history);
    }

    return {
      batchId: result.batchId || null,
      processedAt: result.batchTime || null,
      batchRecord: buildAlignmentBatchRecord(result),
      userUpdates: userUpdates,
      historyRecords: historyRecords,
      skippedUserIds: skippedUserIds,
      failedUsers: failedUsers,
      summary: {
        updateCount: userUpdates.length,
        historyRecordCount: historyRecords.length,
        skippedCount: skippedUserIds.length,
        failedCount: failedUsers.length,
        territoryChangeCount: (result.summary && result.summary.territoryChangedUsers) || 0,
      },
    };
  }

  function findForbiddenAlignmentStorageKeys(value) {
    var found = [];

    function walk(node, path) {
      if (!node || typeof node !== 'object') return;
      var keys = Object.keys(node);
      var i;
      for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        var lowered = String(key).toLowerCase();
        var j;
        for (j = 0; j < FORBIDDEN_PARTS.length; j++) {
          if (lowered.indexOf(FORBIDDEN_PARTS[j].toLowerCase()) !== -1) {
            found.push({
              path: path ? path + '.' + key : key,
              key: key,
              match: FORBIDDEN_PARTS[j],
            });
            break;
          }
        }
        walk(node[key], path ? path + '.' + key : key);
      }
    }

    walk(value, '');
    return found;
  }

  function validateAlignmentStorageState(input) {
    var data = clone(input || {});
    var errors = [];
    var alignment = data.alignment;
    if (!alignment || typeof alignment !== 'object') {
      errors.push('ALIGNMENT_STORAGE_OBJECT_REQUIRED');
      return { valid: false, errors: errors, forbiddenKeys: findForbiddenAlignmentStorageKeys(data) };
    }
    if (!isFiniteNumber(alignment.score)) errors.push('ALIGNMENT_STORAGE_SCORE_INVALID');
    if (!isTerritory(alignment.currentTerritory)) errors.push('ALIGNMENT_STORAGE_TERRITORY_INVALID');
    if (!isFiniteNumber(alignment.previousSignal)) errors.push('ALIGNMENT_STORAGE_SIGNAL_INVALID');
    if (alignment.pendingTerritory != null && !isTerritory(alignment.pendingTerritory)) errors.push('ALIGNMENT_STORAGE_PENDING_TERRITORY_INVALID');
    if (!isPendingCountValid(alignment.pendingBatchCount)) errors.push('ALIGNMENT_STORAGE_PENDING_COUNT_INVALID');
    if (alignment.pendingStartedAt != null && !isValidDate(alignment.pendingStartedAt)) errors.push('ALIGNMENT_STORAGE_PENDING_TIME_INVALID');
    if (alignment.lastProcessedBatchId != null && typeof alignment.lastProcessedBatchId !== 'string') errors.push('ALIGNMENT_STORAGE_LAST_BATCH_INVALID');
    if (alignment.updatedAt != null && !isValidDate(alignment.updatedAt)) errors.push('ALIGNMENT_STORAGE_UPDATED_AT_INVALID');
    if (alignment.pendingTerritory == null && alignment.pendingBatchCount !== 0) errors.push('ALIGNMENT_STORAGE_PENDING_STATE_MISMATCH');
    if (alignment.pendingBatchCount === 0 && alignment.pendingStartedAt != null) errors.push('ALIGNMENT_STORAGE_PENDING_TIME_MISMATCH');
    var forbiddenKeys = findForbiddenAlignmentStorageKeys(data);
    if (forbiddenKeys.length) errors.push('ALIGNMENT_STORAGE_FORBIDDEN_KEY_FOUND');
    return { valid: errors.length === 0, errors: errors, forbiddenKeys: forbiddenKeys };
  }

  function validateAlignmentHistoryRecord(input) {
    var record = clone(input || {});
    var errors = [];
    if (!record.batchId || typeof record.batchId !== 'string') errors.push('ALIGNMENT_HISTORY_BATCH_ID_REQUIRED');
    if (!record.userId || typeof record.userId !== 'string') errors.push('ALIGNMENT_HISTORY_USER_ID_REQUIRED');
    if (!isValidDate(record.processedAt)) errors.push('ALIGNMENT_HISTORY_PROCESSED_AT_INVALID');
    if (!isFiniteNumber(record.previousScore) || !isFiniteNumber(record.nextScore) || !isFiniteNumber(record.scoreChange)) errors.push('ALIGNMENT_HISTORY_SCORE_INVALID');
    if (!isFiniteNumber(record.previousSignal) || !isFiniteNumber(record.nextSignal)) errors.push('ALIGNMENT_HISTORY_SIGNAL_INVALID');
    if (!isTerritory(record.previousTerritory) || !isTerritory(record.nextTerritory)) errors.push('ALIGNMENT_HISTORY_TERRITORY_INVALID');
    if (typeof record.territoryChanged !== 'boolean') errors.push('ALIGNMENT_HISTORY_CHANGED_FLAG_INVALID');
    if (record.candidateTerritory != null && !isTerritory(record.candidateTerritory)) errors.push('ALIGNMENT_HISTORY_CANDIDATE_INVALID');
    if (record.pendingTerritory != null && !isTerritory(record.pendingTerritory)) errors.push('ALIGNMENT_HISTORY_PENDING_TERRITORY_INVALID');
    if (!isPendingCountValid(record.pendingBatchCount)) errors.push('ALIGNMENT_HISTORY_PENDING_COUNT_INVALID');
    if (typeof record.capApplied !== 'boolean') errors.push('ALIGNMENT_HISTORY_CAP_FLAG_INVALID');
    if (!record.transitionReason || typeof record.transitionReason !== 'string') errors.push('ALIGNMENT_HISTORY_REASON_REQUIRED');
    if (Math.abs(record.scoreChange - (record.nextScore - record.previousScore)) > 1e-9) errors.push('ALIGNMENT_HISTORY_SCORE_CHANGE_MISMATCH');
    if (record.territoryChanged !== (record.previousTerritory !== record.nextTerritory)) errors.push('ALIGNMENT_HISTORY_TERRITORY_CHANGE_MISMATCH');
    if (record.pendingTerritory == null && record.pendingBatchCount !== 0) errors.push('ALIGNMENT_HISTORY_PENDING_STATE_MISMATCH');
    var forbiddenKeys = findForbiddenAlignmentStorageKeys(record);
    if (forbiddenKeys.length) errors.push('ALIGNMENT_HISTORY_FORBIDDEN_KEY_FOUND');
    return { valid: errors.length === 0, errors: errors, forbiddenKeys: forbiddenKeys };
  }

  function validateAlignmentBatchRecord(input) {
    var record = clone(input || {});
    var errors = [];
    if (!record.batchId || typeof record.batchId !== 'string') errors.push('ALIGNMENT_BATCH_RECORD_ID_REQUIRED');
    if (!isValidDate(record.scheduledAt)) errors.push('ALIGNMENT_BATCH_RECORD_SCHEDULED_AT_INVALID');
    if (!isValidDate(record.processedAt)) errors.push('ALIGNMENT_BATCH_RECORD_PROCESSED_AT_INVALID');
    if (!isValidDate(record.completedAt)) errors.push('ALIGNMENT_BATCH_RECORD_COMPLETED_AT_INVALID');
    if (record.status !== BATCH_STATUS.PREPARED && record.status !== BATCH_STATUS.PROCESSING && record.status !== BATCH_STATUS.COMPLETED && record.status !== BATCH_STATUS.PARTIAL_FAILURE && record.status !== BATCH_STATUS.FAILED) errors.push('ALIGNMENT_BATCH_RECORD_STATUS_INVALID');
    if (!isFiniteNumber(record.totalUsers) || !isFiniteNumber(record.processedUsers) || !isFiniteNumber(record.skippedUsers) || !isFiniteNumber(record.failedUsers) || !isFiniteNumber(record.territoryChangedUsers)) errors.push('ALIGNMENT_BATCH_RECORD_COUNT_INVALID');
    if (record.calculationMode !== 'DELTA_WINDOW_SCORE') errors.push('ALIGNMENT_BATCH_RECORD_MODE_INVALID');
    var forbiddenKeys = findForbiddenAlignmentStorageKeys(record);
    if (forbiddenKeys.length) errors.push('ALIGNMENT_BATCH_RECORD_FORBIDDEN_KEY_FOUND');
    return { valid: errors.length === 0, errors: errors, forbiddenKeys: forbiddenKeys };
  }

  function validateAlignmentPersistencePlan(input) {
    var plan = clone(input || {});
    var errors = [];
    if (!plan.batchId || typeof plan.batchId !== 'string') errors.push('ALIGNMENT_PLAN_BATCH_ID_REQUIRED');
    if (!isValidDate(plan.processedAt)) errors.push('ALIGNMENT_PLAN_PROCESSED_AT_INVALID');
    if (!Array.isArray(plan.userUpdates)) errors.push('ALIGNMENT_PLAN_UPDATES_ARRAY_REQUIRED');
    if (!Array.isArray(plan.historyRecords)) errors.push('ALIGNMENT_PLAN_HISTORY_ARRAY_REQUIRED');
    if (!Array.isArray(plan.skippedUserIds)) errors.push('ALIGNMENT_PLAN_SKIPPED_ARRAY_REQUIRED');
    if (!Array.isArray(plan.failedUsers)) errors.push('ALIGNMENT_PLAN_FAILED_ARRAY_REQUIRED');
    if (!plan.summary || typeof plan.summary !== 'object') errors.push('ALIGNMENT_PLAN_SUMMARY_REQUIRED');

    var i;
    if (plan.userUpdates) {
      for (i = 0; i < plan.userUpdates.length; i++) {
        var update = plan.userUpdates[i];
        if (!update || !update.userId || !update.update) errors.push('ALIGNMENT_PLAN_UPDATE_INVALID');
        else if (!validateAlignmentStorageState(update.update).valid) errors.push('ALIGNMENT_PLAN_UPDATE_STATE_INVALID');
      }
    }
    if (plan.historyRecords) {
      for (i = 0; i < plan.historyRecords.length; i++) {
        if (!validateAlignmentHistoryRecord(plan.historyRecords[i]).valid) {
          errors.push('ALIGNMENT_PLAN_HISTORY_INVALID');
          break;
        }
      }
    }
    if (plan.batchRecord && !validateAlignmentBatchRecord(plan.batchRecord).valid) {
      errors.push('ALIGNMENT_PLAN_BATCH_RECORD_INVALID');
    }
    var forbiddenKeys = findForbiddenAlignmentStorageKeys(plan);
    if (forbiddenKeys.length) errors.push('ALIGNMENT_PLAN_FORBIDDEN_KEY_FOUND');
    return { valid: errors.length === 0, errors: errors, forbiddenKeys: forbiddenKeys };
  }

  return {
    TERRITORY: TERRITORY,
    BATCH_STATUS: BATCH_STATUS,
    getAlignmentStorageSchema: getAlignmentStorageSchema,
    createAlignmentStorageState: createAlignmentStorageState,
    buildAlignmentStorageUpdate: buildAlignmentStorageUpdate,
    buildAlignmentBatchHistoryRecord: buildAlignmentBatchHistoryRecord,
    buildAlignmentBatchRecord: buildAlignmentBatchRecord,
    buildAlignmentBatchPersistencePlan: buildAlignmentBatchPersistencePlan,
    validateAlignmentStorageState: validateAlignmentStorageState,
    validateAlignmentHistoryRecord: validateAlignmentHistoryRecord,
    validateAlignmentBatchRecord: validateAlignmentBatchRecord,
    validateAlignmentPersistencePlan: validateAlignmentPersistencePlan,
    findForbiddenAlignmentStorageKeys: findForbiddenAlignmentStorageKeys,
    clone: clone,
  };
});
