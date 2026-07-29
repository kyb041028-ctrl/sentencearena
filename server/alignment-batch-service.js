'use strict';

const schemaCore = require('../shared/alignment-schema-core');
const batchCore = require('../shared/alignment-batch-core');
const { createAlignmentBatchId } = require('./alignment-batch-id');

function loadAlignmentBatchRuntime() {
  return {
    processAlignmentBatch: batchCore.processAlignmentBatch,
    buildAlignmentBatchPersistencePlan: schemaCore.buildAlignmentBatchPersistencePlan,
    validateAlignmentPersistencePlan: schemaCore.validateAlignmentPersistencePlan,
  };
}

function validateDataSource(dataSource) {
  if (!dataSource || typeof dataSource !== 'object') return false;
  if (typeof dataSource.listAlignmentUsers !== 'function') return false;
  if (typeof dataSource.listAlignmentReactions !== 'function') return false;
  return true;
}

function validateRepository(repository) {
  if (!repository || typeof repository !== 'object') return false;
  if (typeof repository.persistBatchPlan !== 'function') return false;
  if (typeof repository.getBatchRecord !== 'function') return false;
  return true;
}

async function runAlignmentBatch(input) {
  const raw = input || {};
  const inputSnapshot = JSON.parse(JSON.stringify(raw));
  const batchId = raw.batchId;
  const batchTime = raw.batchTime;
  const dataSource = raw.dataSource;
  const repository = raw.repository;
  const dryRun = !!raw.dryRun;

  if (!batchId || typeof batchId !== 'string') {
    const err = new Error('ALIGNMENT_BATCH_ID_REQUIRED');
    err.code = 'ALIGNMENT_BATCH_ID_REQUIRED';
    throw err;
  }
  if (!batchTime || !Number.isFinite(new Date(batchTime).getTime())) {
    const err = new Error('ALIGNMENT_BATCH_TIME_INVALID');
    err.code = 'ALIGNMENT_BATCH_TIME_INVALID';
    throw err;
  }
  if (!validateDataSource(dataSource)) {
    const err = new Error('ALIGNMENT_DATA_SOURCE_INVALID');
    err.code = 'ALIGNMENT_DATA_SOURCE_INVALID';
    throw err;
  }
  if (!validateRepository(repository)) {
    const err = new Error('ALIGNMENT_REPOSITORY_INVALID');
    err.code = 'ALIGNMENT_REPOSITORY_INVALID';
    throw err;
  }

  const existing = await repository.getBatchRecord(batchId);
  if (existing) {
    return {
      success: true,
      skipped: true,
      skipReason: 'ALIGNMENT_BATCH_ALREADY_PERSISTED',
      batchId,
      persisted: false,
    };
  }

  let users;
  let reactions;
  try {
    users = dataSource.listAlignmentUsers(batchTime);
  } catch (e) {
    const err = new Error('ALIGNMENT_USER_LOAD_FAILED');
    err.code = 'ALIGNMENT_USER_LOAD_FAILED';
    err.cause = e;
    throw err;
  }
  try {
    reactions = dataSource.listAlignmentReactions(batchTime);
  } catch (e) {
    const err = new Error('ALIGNMENT_REACTION_LOAD_FAILED');
    err.code = 'ALIGNMENT_REACTION_LOAD_FAILED';
    err.cause = e;
    throw err;
  }

  const runtime = loadAlignmentBatchRuntime();
  let batchResult;
  try {
    batchResult = runtime.processAlignmentBatch({
      batchId,
      batchTime,
      users,
      reactions,
    });
  } catch (e) {
    const err = new Error('ALIGNMENT_BATCH_CALCULATION_FAILED');
    err.code = 'ALIGNMENT_BATCH_CALCULATION_FAILED';
    err.cause = e;
    throw err;
  }

  let persistencePlan;
  try {
    persistencePlan = runtime.buildAlignmentBatchPersistencePlan(batchResult);
    const planValidation = runtime.validateAlignmentPersistencePlan(persistencePlan);
    if (!planValidation.valid) {
      const err = new Error('ALIGNMENT_PLAN_BUILD_FAILED');
      err.code = 'ALIGNMENT_PLAN_BUILD_FAILED';
      err.details = planValidation.errors;
      throw err;
    }
  } catch (e) {
    if (e.code === 'ALIGNMENT_PLAN_BUILD_FAILED') throw e;
    const err = new Error('ALIGNMENT_PLAN_BUILD_FAILED');
    err.code = 'ALIGNMENT_PLAN_BUILD_FAILED';
    err.cause = e;
    throw err;
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      persisted: false,
      batchId,
      batchResult,
      persistencePlan,
      code: 'ALIGNMENT_DRY_RUN_COMPLETED',
    };
  }

  let persistResult;
  try {
    persistResult = await repository.persistBatchPlan(persistencePlan);
  } catch (e) {
    const err = new Error('ALIGNMENT_PERSIST_FAILED');
    err.code = 'ALIGNMENT_PERSIST_FAILED';
    err.cause = e;
    throw err;
  }

  return {
    success: true,
    dryRun: false,
    persisted: !persistResult.skipped,
    skipped: !!persistResult.skipped,
    skipReason: persistResult.skipReason || null,
    batchId,
    batchResult,
    persistencePlan,
    persistResult,
    inputUnchanged: JSON.stringify(raw) === JSON.stringify(inputSnapshot),
  };
}

module.exports = {
  runAlignmentBatch,
  loadAlignmentBatchRuntime,
  createAlignmentBatchId,
  validateDataSource,
  validateRepository,
};
