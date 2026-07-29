'use strict';

const schemaCore = require('../shared/alignment-schema-core');
const {
  getAlignmentSupabaseAdminClient,
  createAlignmentSupabaseAdminClient,
} = require('./alignment-supabase-admin');

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function normalizeFiniteNumber(value, fieldName) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      const err = new Error('ALIGNMENT_NUMERIC_INVALID');
      err.code = 'ALIGNMENT_NUMERIC_INVALID';
      err.field = fieldName;
      throw err;
    }
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === 'nan' || trimmed.toLowerCase() === 'infinity' || trimmed.toLowerCase() === '-infinity') {
      const err = new Error('ALIGNMENT_NUMERIC_INVALID');
      err.code = 'ALIGNMENT_NUMERIC_INVALID';
      err.field = fieldName;
      throw err;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      const err = new Error('ALIGNMENT_NUMERIC_INVALID');
      err.code = 'ALIGNMENT_NUMERIC_INVALID';
      err.field = fieldName;
      throw err;
    }
    return n;
  }
  if (value == null) return value;
  const err = new Error('ALIGNMENT_NUMERIC_INVALID');
  err.code = 'ALIGNMENT_NUMERIC_INVALID';
  err.field = fieldName;
  throw err;
}

function normalizeIntegerCount(value, fieldName) {
  const n = normalizeFiniteNumber(value, fieldName);
  if (!Number.isInteger(n)) {
    const err = new Error('ALIGNMENT_COUNT_INVALID');
    err.code = 'ALIGNMENT_COUNT_INVALID';
    err.field = fieldName;
    throw err;
  }
  return n;
}

function mapBatchRow(row) {
  if (!row) return null;
  return {
    batchId: row.batch_id,
    scheduledAt: row.scheduled_at,
    processedAt: row.processed_at,
    completedAt: row.completed_at,
    status: row.status,
    totalUsers: normalizeIntegerCount(row.total_users, 'totalUsers'),
    processedUsers: normalizeIntegerCount(row.processed_users, 'processedUsers'),
    skippedUsers: normalizeIntegerCount(row.skipped_users, 'skippedUsers'),
    failedUsers: normalizeIntegerCount(row.failed_users, 'failedUsers'),
    territoryChangedUsers: normalizeIntegerCount(row.territory_changed_users, 'territoryChangedUsers'),
    calculationMode: row.calculation_mode,
    createdAt: row.created_at,
  };
}

function mapUserStateRow(row) {
  if (!row) return null;
  return schemaCore.createAlignmentStorageState({
    score: normalizeFiniteNumber(row.score, 'score'),
    currentTerritory: row.current_territory,
    previousSignal: normalizeFiniteNumber(row.previous_signal, 'previousSignal'),
    pendingTerritory: row.pending_territory,
    pendingBatchCount: normalizeIntegerCount(row.pending_batch_count, 'pendingBatchCount'),
    pendingStartedAt: row.pending_started_at,
    lastProcessedBatchId: row.last_processed_batch_id,
    updatedAt: row.updated_at,
  });
}

function mapHistoryRow(row) {
  if (!row) return null;
  return {
    historyId: row.history_id,
    batchId: row.batch_id,
    userId: row.user_id,
    processedAt: row.processed_at,
    previousScore: normalizeFiniteNumber(row.previous_score, 'previousScore'),
    nextScore: normalizeFiniteNumber(row.next_score, 'nextScore'),
    scoreChange: normalizeFiniteNumber(row.score_change, 'scoreChange'),
    previousSignal: normalizeFiniteNumber(row.previous_signal, 'previousSignal'),
    nextSignal: normalizeFiniteNumber(row.next_signal, 'nextSignal'),
    previousTerritory: row.previous_territory,
    nextTerritory: row.next_territory,
    territoryChanged: row.territory_changed,
    candidateTerritory: row.candidate_territory,
    pendingTerritory: row.pending_territory,
    pendingBatchCount: normalizeIntegerCount(row.pending_batch_count, 'pendingBatchCount'),
    capApplied: row.cap_applied,
    transitionReason: row.transition_reason,
    createdAt: row.created_at,
  };
}

function wrapSupabaseError(error, fallbackCode) {
  const err = new Error(fallbackCode || 'ALIGNMENT_RPC_FAILED');
  err.code = fallbackCode || 'ALIGNMENT_RPC_FAILED';
  err.cause = error;
  if (error && error.message) err.details = error.message;
  return err;
}

function validateRpcPersistResponse(response, plan) {
  if (!response || typeof response !== 'object') {
    const err = new Error('ALIGNMENT_RPC_RESPONSE_INVALID');
    err.code = 'ALIGNMENT_RPC_RESPONSE_INVALID';
    throw err;
  }
  if (typeof response.success !== 'boolean' || typeof response.skipped !== 'boolean') {
    const err = new Error('ALIGNMENT_RPC_RESPONSE_INVALID');
    err.code = 'ALIGNMENT_RPC_RESPONSE_INVALID';
    throw err;
  }
  if (response.batchId !== plan.batchId) {
    const err = new Error('ALIGNMENT_RPC_RESPONSE_INVALID');
    err.code = 'ALIGNMENT_RPC_RESPONSE_INVALID';
    throw err;
  }
  if (response.skipped) {
    if (response.skipReason !== 'ALIGNMENT_BATCH_ALREADY_PERSISTED') {
      const err = new Error('ALIGNMENT_RPC_RESPONSE_INVALID');
      err.code = 'ALIGNMENT_RPC_RESPONSE_INVALID';
      throw err;
    }
    return {
      success: true,
      skipped: true,
      committed: false,
      skipReason: response.skipReason,
      batchId: response.batchId,
    };
  }
  if (response.committed !== true) {
    const err = new Error('ALIGNMENT_RPC_RESPONSE_INVALID');
    err.code = 'ALIGNMENT_RPC_RESPONSE_INVALID';
    throw err;
  }
  const expectedUpdates = (plan.summary && plan.summary.updateCount) || (plan.userUpdates || []).length;
  const expectedHistory = (plan.summary && plan.summary.historyRecordCount) || (plan.historyRecords || []).length;
  const userUpdateCount = normalizeIntegerCount(response.userUpdateCount, 'userUpdateCount');
  const historyRecordCount = normalizeIntegerCount(response.historyRecordCount, 'historyRecordCount');
  if (userUpdateCount !== expectedUpdates || historyRecordCount !== expectedHistory) {
    const err = new Error('ALIGNMENT_RPC_RESPONSE_INVALID');
    err.code = 'ALIGNMENT_RPC_RESPONSE_INVALID';
    throw err;
  }
  return {
    success: true,
    skipped: false,
    committed: true,
    batchId: response.batchId,
    userUpdateCount,
    historyRecordCount,
  };
}

function createAlignmentSupabaseRepository(options) {
  const opts = options || {};
  const client = opts.client || (opts.lazy === false ? createAlignmentSupabaseAdminClient() : null);

  function resolveClient() {
    if (client) return client;
    return getAlignmentSupabaseAdminClient();
  }

  async function getBatchRecord(batchId) {
    const supabase = resolveClient();
    const { data, error } = await supabase
      .from('alignment_batches')
      .select('*')
      .eq('batch_id', batchId)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, 'ALIGNMENT_RPC_FAILED');
    return mapBatchRow(data);
  }

  async function getUserAlignmentState(userId) {
    const supabase = resolveClient();
    const { data, error } = await supabase
      .from('user_alignment_state')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, 'ALIGNMENT_RPC_FAILED');
    return mapUserStateRow(data);
  }

  async function getHistoryRecord(historyId) {
    const supabase = resolveClient();
    const { data, error } = await supabase
      .from('alignment_history')
      .select('*')
      .eq('history_id', historyId)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, 'ALIGNMENT_RPC_FAILED');
    return mapHistoryRow(data);
  }

  async function persistBatchPlan(persistencePlan) {
    const planSnapshot = clone(persistencePlan || {});
    const validation = schemaCore.validateAlignmentPersistencePlan(planSnapshot);
    if (!validation.valid) {
      const err = new Error('ALIGNMENT_PLAN_BUILD_FAILED');
      err.code = 'ALIGNMENT_PLAN_BUILD_FAILED';
      err.details = validation.errors;
      throw err;
    }

    const supabase = resolveClient();
    const { data, error } = await supabase.rpc('persist_alignment_batch_plan', { plan: planSnapshot });
    if (error) throw wrapSupabaseError(error, 'ALIGNMENT_RPC_FAILED');
    return validateRpcPersistResponse(data, planSnapshot);
  }

  async function healthCheck() {
    try {
      const supabase = resolveClient();
      const { error } = await supabase.from('alignment_batches').select('batch_id').limit(1);
      if (error) {
        return { ok: false, code: 'ALIGNMENT_RPC_FAILED', details: error.message };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, code: e.code || 'ALIGNMENT_SUPABASE_CONFIG_MISSING', details: e.message };
    }
  }

  return {
    getBatchRecord,
    getUserAlignmentState,
    getHistoryRecord,
    persistBatchPlan,
    healthCheck,
  };
}

module.exports = {
  createAlignmentSupabaseRepository,
  mapBatchRow,
  mapUserStateRow,
  mapHistoryRow,
  validateRpcPersistResponse,
  normalizeFiniteNumber,
  normalizeIntegerCount,
};
