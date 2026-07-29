/**
 * 센텐스크래프트 — 정렬 메모리 저장소
 */
(function (global) {
  'use strict';

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function cloneMap(source) {
    var target = new Map();
    source.forEach(function (value, key) {
      target.set(key, clone(value));
    });
    return target;
  }

  function ensureActiveTransaction(transaction) {
    if (!transaction || transaction.status !== 'ACTIVE') {
      throw { code: 'ALIGNMENT_TRANSACTION_INVALID', errors: ['ALIGNMENT_TRANSACTION_INVALID'] };
    }
  }

  function createAlignmentMemoryRepository(options) {
    var config = options || {};
    var root = {
      userStates: new Map(),
      batchRecords: new Map(),
      historyRecords: new Map(),
    };

    function getMaps(transaction) {
      return transaction ? transaction.working : root;
    }

    function beginTransaction() {
      return {
        status: 'ACTIVE',
        working: {
          userStates: cloneMap(root.userStates),
          batchRecords: cloneMap(root.batchRecords),
          historyRecords: cloneMap(root.historyRecords),
        },
      };
    }

    function getBatchRecord(batchId, transaction) {
      var maps = getMaps(transaction);
      return maps.batchRecords.has(batchId) ? clone(maps.batchRecords.get(batchId)) : null;
    }

    function setBatchRecord(batchId, batchRecord, transaction) {
      ensureActiveTransaction(transaction);
      if (config.failOnBatchId && config.failOnBatchId === batchId) {
        throw { code: 'ALIGNMENT_BATCH_WRITE_FAILED', errors: ['ALIGNMENT_BATCH_WRITE_FAILED'] };
      }
      transaction.working.batchRecords.set(batchId, clone(batchRecord));
    }

    function getUserAlignmentState(userId, transaction) {
      var maps = getMaps(transaction);
      return maps.userStates.has(userId) ? clone(maps.userStates.get(userId)) : null;
    }

    function setUserAlignmentState(userId, alignmentState, transaction) {
      ensureActiveTransaction(transaction);
      if (config.failOnUserId && config.failOnUserId === userId) {
        throw { code: 'ALIGNMENT_USER_WRITE_FAILED', errors: ['ALIGNMENT_USER_WRITE_FAILED'] };
      }
      transaction.working.userStates.set(userId, clone({ userId: userId, alignment: alignmentState.alignment }));
    }

    function getHistoryRecord(historyId, transaction) {
      var maps = getMaps(transaction);
      return maps.historyRecords.has(historyId) ? clone(maps.historyRecords.get(historyId)) : null;
    }

    function setHistoryRecord(historyId, historyRecord, transaction) {
      ensureActiveTransaction(transaction);
      if (config.failOnHistoryId && config.failOnHistoryId === historyId) {
        throw { code: 'ALIGNMENT_HISTORY_WRITE_FAILED', errors: ['ALIGNMENT_HISTORY_WRITE_FAILED'] };
      }
      transaction.working.historyRecords.set(historyId, clone(historyRecord));
    }

    function commitTransaction(transaction) {
      ensureActiveTransaction(transaction);
      if (config.failOnCommit) {
        throw { code: 'ALIGNMENT_TRANSACTION_COMMIT_FAILED', errors: ['ALIGNMENT_TRANSACTION_COMMIT_FAILED'] };
      }
      root.userStates = cloneMap(transaction.working.userStates);
      root.batchRecords = cloneMap(transaction.working.batchRecords);
      root.historyRecords = cloneMap(transaction.working.historyRecords);
      transaction.status = 'COMMITTED';
      return { status: transaction.status };
    }

    function rollbackTransaction(transaction) {
      ensureActiveTransaction(transaction);
      transaction.status = 'ROLLED_BACK';
      transaction.working = null;
      return { status: transaction.status };
    }

    function listBatchRecords() {
      return getAllStoredBatchRecords();
    }
    function listUserAlignmentStates() {
      return getAllStoredUserStates();
    }
    function listHistoryRecords() {
      return getAllStoredHistoryRecords();
    }

    function getStoredUserState(userId) {
      return root.userStates.has(userId) ? clone(root.userStates.get(userId)) : null;
    }
    function getStoredBatchRecord(batchId) {
      return root.batchRecords.has(batchId) ? clone(root.batchRecords.get(batchId)) : null;
    }
    function getStoredHistoryRecord(historyId) {
      return root.historyRecords.has(historyId) ? clone(root.historyRecords.get(historyId)) : null;
    }
    function getAllStoredUserStates() {
      var out = [];
      root.userStates.forEach(function (value) {
        out.push(clone(value));
      });
      return out;
    }
    function getAllStoredBatchRecords() {
      var out = [];
      root.batchRecords.forEach(function (value) {
        out.push(clone(value));
      });
      return out;
    }
    function getAllStoredHistoryRecords() {
      var out = [];
      root.historyRecords.forEach(function (value) {
        out.push(clone(value));
      });
      return out;
    }
    function reset() {
      root.userStates = new Map();
      root.batchRecords = new Map();
      root.historyRecords = new Map();
    }

    return {
      beginTransaction: beginTransaction,
      getBatchRecord: getBatchRecord,
      setBatchRecord: setBatchRecord,
      getUserAlignmentState: getUserAlignmentState,
      setUserAlignmentState: setUserAlignmentState,
      getHistoryRecord: getHistoryRecord,
      setHistoryRecord: setHistoryRecord,
      commitTransaction: commitTransaction,
      rollbackTransaction: rollbackTransaction,
      listBatchRecords: listBatchRecords,
      listUserAlignmentStates: listUserAlignmentStates,
      listHistoryRecords: listHistoryRecords,
      getStoredUserState: getStoredUserState,
      getStoredBatchRecord: getStoredBatchRecord,
      getStoredHistoryRecord: getStoredHistoryRecord,
      getAllStoredUserStates: getAllStoredUserStates,
      getAllStoredBatchRecords: getAllStoredBatchRecords,
      getAllStoredHistoryRecords: getAllStoredHistoryRecords,
      reset: reset,
    };
  }

  global.createAlignmentMemoryRepository = createAlignmentMemoryRepository;

  if (typeof global.window !== 'undefined') {
    global.window.__scCreateAlignmentMemoryRepository = createAlignmentMemoryRepository;
  } else if (global === globalThis) {
    global.__scCreateAlignmentMemoryRepository = createAlignmentMemoryRepository;
  }
})(typeof window !== 'undefined' ? window : globalThis);
