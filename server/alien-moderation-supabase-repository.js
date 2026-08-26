'use strict';
/**
 * ALIEN MODERATION V1 Supabase repository.
 * SSOT: board_reports (simple cycle) + profiles.citizenship_status (alien flag).
 * user_moderation_state holds strike/dates/return policy. profiles.territory is never written.
 */

const modCore = require('../shared/alien-moderation-core');
const reportCore = require('../shared/alien-report-moderation-core');

function isUniqueViolation(error) {
  return !!(error && (error.code === '23505' || /duplicate key/i.test(String(error.message || ''))));
}

function toIso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function mapDbSourceType(sourceType) {
  const s = String(sourceType || '').toUpperCase();
  if (s === 'ADMIN' || s === 'OPERATOR') return 'OPERATOR';
  if (s === 'SEASON_END') return 'SEASON_END';
  if (s === 'BEHAVIOR_SIGNAL') return 'BEHAVIOR_SIGNAL';
  if (s === 'REPORT_REVIEW') return 'REPORT_REVIEW';
  return 'SYSTEM';
}

function createAlienModerationSupabaseRepository(options) {
  const opts = options || {};
  const client = opts.client;
  if (!client) {
    const err = new Error('ALIEN_MODERATION_SUPABASE_CLIENT_REQUIRED');
    err.code = 'ALIEN_MODERATION_SUPABASE_CLIENT_REQUIRED';
    throw err;
  }

  let persistEnabled = false;

  function setPersistEnabled(enabled) {
    persistEnabled = !!enabled;
  }

  function isPersistEnabled() {
    return persistEnabled;
  }

  function defaultState(userId, profile) {
    const citizenship = (profile && profile.citizenship_status) || reportCore.CITIZENSHIP.EARTH;
    const isAlien = citizenship === reportCore.CITIZENSHIP.ALIEN;
    return {
      userId: userId,
      status: isAlien ? modCore.STATUS.ALIEN_ACTIVE : modCore.STATUS.EARTH,
      strikeCount: profile && profile.exile_strike_count != null ? Number(profile.exile_strike_count) || 0 : 0,
      enteredAt: null,
      releaseEligibleAt: null,
      returnPolicy: 'NONE',
      citizenshipStatus: citizenship,
      earthTerritory: (profile && profile.territory) || 'CENTRAL',
      lastReturnedAt: null,
      cycleStartAt: null,
      dataStatus: modCore.DATA_STATUS.READY,
    };
  }

  async function loadProfile(userId) {
    const { data, error } = await client
      .from('profiles')
      .select('id, citizenship_status, exile_strike_count, territory')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.log('[alien-moderation] profile load skipped:', error.message || error.code || 'PROFILE_LOAD_FAILED');
      return null;
    }
    return data || null;
  }

  function mapStateRow(row, profile) {
    const base = defaultState(row.user_id, profile);
    const contract = modCore.buildModerationStateContract({
      userId: row.user_id,
      status: row.status || base.status,
      strikeCount: row.alien_strike_count != null ? row.alien_strike_count : base.strikeCount,
      enteredAt: toIso(row.entered_at),
      releaseEligibleAt: toIso(row.release_eligible_at),
      seasonReleaseKey: row.season_release_key || null,
      operatorHold: !!row.operator_hold,
      updatedAt: toIso(row.updated_at),
    });
    contract.citizenshipStatus = (profile && profile.citizenship_status)
      || row.citizenship_status
      || base.citizenshipStatus;
    contract.earthTerritory = (profile && profile.territory) || row.alien_origin_territory || base.earthTerritory;
    contract.returnPolicy = row.return_policy || 'NONE';
    contract.lastReturnedAt = toIso(row.last_returned_at);
    contract.cycleStartAt = toIso(row.cycle_start_at) || contract.lastReturnedAt;
    contract.alienOriginTerritory = row.alien_origin_territory || contract.earthTerritory;
    contract.currentSanctionType = row.current_sanction_type || 'NONE';
    contract.currentSanctionStartsAt = toIso(row.current_sanction_starts_at);
    contract.currentSanctionEndsAt = toIso(row.current_sanction_ends_at);
    contract.currentSanctionPermanent = !!row.current_sanction_permanent;
    contract.currentSanctionStatus = row.current_sanction_status || null;
    contract.currentSanctionReasonCode = row.current_sanction_reason_code || null;
    contract.currentSanctionBehaviorKey = row.current_sanction_behavior_key || null;
    contract.currentSanctionLadder = row.current_sanction_ladder || null;
    contract.pendingPermanentReview = !!row.pending_permanent_review;
    contract.lastSanctionedBehaviorKey = row.last_sanctioned_behavior_key || null;
    return contract;
  }

  async function getModerationState(userId) {
    if (!userId) return null;
    const profile = await loadProfile(userId);
    const { data, error } = await client
      .from('user_moderation_state')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      const err = new Error(error.message || 'MODERATION_STATE_LOAD_FAILED');
      err.code = 'MODERATION_STATE_LOAD_FAILED';
      throw err;
    }
    if (!data) return defaultState(userId, profile);
    return mapStateRow(data, profile);
  }

  function mapEventRow(row) {
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return {
      id: row.id,
      userId: row.user_id,
      eventType: row.event_type,
      transferReason: meta.transferReason || null,
      sourceType: meta.originalSourceType || row.source_type,
      sourceId: row.source_id,
      dedupeKey: meta.dedupeKey || (row.event_type && row.source_id ? row.event_type + ':' + row.source_id : null),
      strikeCount: row.strike_after,
      strikeBefore: row.strike_before,
      strikeAfter: row.strike_after,
      previousStatus: row.previous_status,
      nextStatus: row.next_status,
      citizenshipStatus: meta.citizenshipStatus || null,
      earthTerritory: meta.earthTerritory || null,
      enteredAt: toIso(row.entered_at),
      releaseEligibleAt: toIso(row.release_eligible_at),
      returnPolicy: meta.returnPolicy || null,
      returnedAt: meta.returnedAt || null,
      createdAt: toIso(row.created_at),
      metadata: meta,
    };
  }

  async function listModerationEvents(userId, paging) {
    const page = paging || {};
    const limit = Math.min(Math.max(Number(page.limit) || 20, 1), 100);
    const offset = Math.max(Number(page.offset) || 0, 0);
    let q = client.from('user_moderation_events').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (userId) q = q.eq('user_id', userId);
    q = q.range(offset, offset + limit - 1);
    const { data, error, count } = await q;
    if (error) {
      const err = new Error(error.message || 'MODERATION_EVENT_LIST_FAILED');
      err.code = 'MODERATION_EVENT_LIST_FAILED';
      throw err;
    }
    return { items: (data || []).map(mapEventRow), total: typeof count === 'number' ? count : (data || []).length };
  }

  async function findEventByDedupe(dedupeKey) {
    if (!dedupeKey) return null;
    const { data, error } = await client
      .from('user_moderation_events')
      .select('*')
      .contains('metadata', { dedupeKey: dedupeKey })
      .maybeSingle();
    if (error && error.code !== 'PGRST116') {
      const bySource = await client
        .from('user_moderation_events')
        .select('*')
        .eq('source_id', dedupeKey)
        .maybeSingle();
      if (bySource.error) return null;
      return bySource.data ? mapEventRow(bySource.data) : null;
    }
    return data ? mapEventRow(data) : null;
  }

  async function planAlienTransfer(input) {
    return modCore.buildAlienTransferPlan(input);
  }

  async function persistAlienTransferPlan(plan) {
    if (!persistEnabled) {
      return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'DB_APPLY_FORBIDDEN_IN_THIS_PHASE' };
    }
    if (!plan || !plan.ok) {
      return { ok: false, error: (plan && plan.error) || 'TRANSFER_PLAN_INVALID' };
    }
    const sourceId = plan.sourceId || null;
    const dedupeKey = sourceId
      ? reportCore.transferDedupeKey(sourceId)
      : ('ALIEN_TRANSFERRED:user:' + plan.userId + ':strike:' + plan.strikeAfter + ':' + plan.enteredAt);
    const existing = await findEventBySource(modCore.EVENT_TYPE.ALIEN_TRANSFERRED, sourceId || dedupeKey);
    if (existing) {
      const state = await getModerationState(plan.userId);
      return { ok: true, duplicate: true, state: state, strikeCount: state.strikeCount, event: existing };
    }
    const current = await getModerationState(plan.userId);
    if (current.citizenshipStatus === reportCore.CITIZENSHIP.ALIEN) {
      return {
        ok: true,
        duplicate: true,
        alreadyAlien: true,
        state: current,
        strikeCount: current.strikeCount,
      };
    }

    const eventInsert = {
      user_id: plan.userId,
      event_type: modCore.EVENT_TYPE.ALIEN_TRANSFERRED,
      reason_codes: Array.isArray(plan.reasonCodes) ? plan.reasonCodes : [],
      source_type: mapDbSourceType(plan.sourceType),
      source_id: sourceId || dedupeKey,
      strike_before: plan.strikeBefore != null ? plan.strikeBefore : current.strikeCount,
      strike_after: plan.strikeAfter,
      previous_status: plan.previousStatus || current.status || modCore.STATUS.EARTH,
      next_status: modCore.STATUS.ALIEN_ACTIVE,
      entered_at: plan.enteredAt,
      release_eligible_at: plan.releaseEligibleAt || null,
      metadata: {
        transferReason: plan.transferReason || null,
        originalSourceType: plan.sourceType || null,
        returnPolicy: plan.returnPolicy || (plan.requiresSeasonEnd ? 'SEASON_END' : 'DAYS'),
        durationDays: plan.durationDays != null ? plan.durationDays : null,
        earthTerritory: plan.earthTerritory || current.earthTerritory,
        citizenshipStatus: reportCore.CITIZENSHIP.ALIEN,
        dedupeKey: dedupeKey,
      },
    };
    const inserted = await client.from('user_moderation_events').insert(eventInsert).select('*').maybeSingle();
    if (inserted.error) {
      if (isUniqueViolation(inserted.error)) {
        const state = await getModerationState(plan.userId);
        return { ok: true, duplicate: true, state: state, strikeCount: state.strikeCount };
      }
      const err = new Error(inserted.error.message || 'MODERATION_EVENT_INSERT_FAILED');
      err.code = 'MODERATION_EVENT_INSERT_FAILED';
      throw err;
    }

    const stateRow = {
      user_id: plan.userId,
      status: modCore.STATUS.ALIEN_ACTIVE,
      alien_strike_count: plan.strikeAfter,
      alien_origin_territory: plan.earthTerritory || current.earthTerritory || 'CENTRAL',
      origin_captured_at: plan.enteredAt,
      origin_source: 'MODERATION_TRANSFER_SNAPSHOT',
      entered_at: plan.enteredAt,
      release_eligible_at: plan.releaseEligibleAt || null,
      return_policy: plan.returnPolicy || (plan.requiresSeasonEnd ? 'SEASON_END' : (plan.adminReturnOnly ? 'OPERATOR_REVIEW' : 'DAYS')),
      last_returned_at: current.lastReturnedAt || null,
      cycle_start_at: plan.enteredAt,
      citizenship_status: reportCore.CITIZENSHIP.ALIEN,
      updated_at: new Date().toISOString(),
    };
    const upserted = await client.from('user_moderation_state').upsert(stateRow, { onConflict: 'user_id' });
    if (upserted.error) {
      const err = new Error(upserted.error.message || 'MODERATION_STATE_UPSERT_FAILED');
      err.code = 'MODERATION_STATE_UPSERT_FAILED';
      throw err;
    }
    return {
      ok: true,
      duplicate: false,
      state: await getModerationState(plan.userId),
      event: inserted.data ? mapEventRow(inserted.data) : null,
    };
  }

  async function findEventBySource(eventType, sourceId) {
    if (!sourceId) return null;
    const { data, error } = await client
      .from('user_moderation_events')
      .select('*')
      .eq('event_type', eventType)
      .eq('source_id', sourceId)
      .maybeSingle();
    if (error) return null;
    return data ? mapEventRow(data) : null;
  }

  async function planAlienReturn(input) {
    return modCore.buildAlienReturnPlan(input);
  }

  async function persistAlienReturnPlan(plan) {
    if (!persistEnabled) {
      return { ok: false, error: 'ALIEN_PERSIST_DISABLED', note: 'DB_APPLY_FORBIDDEN_IN_THIS_PHASE' };
    }
    if (!plan || !plan.ok) {
      return { ok: false, error: (plan && plan.error) || 'RETURN_PLAN_INVALID' };
    }
    const prev = await getModerationState(plan.userId);
    const returnedAt = plan.returnedAt || new Date().toISOString();
    const sourceId = 'ALIEN_RETURNED:' + plan.userId + ':' + returnedAt;
    const eventInsert = {
      user_id: plan.userId,
      event_type: modCore.EVENT_TYPE.RETURNED,
      reason_codes: [],
      source_type: 'SYSTEM',
      source_id: sourceId,
      strike_before: prev.strikeCount,
      strike_after: prev.strikeCount,
      previous_status: prev.status,
      next_status: modCore.STATUS.RETURNED,
      metadata: {
        returnedAt: returnedAt,
        citizenshipStatus: reportCore.CITIZENSHIP.EARTH,
        earthTerritory: prev.earthTerritory,
        dedupeKey: sourceId,
      },
    };
    const inserted = await client.from('user_moderation_events').insert(eventInsert).select('*').maybeSingle();
    if (inserted.error && !isUniqueViolation(inserted.error)) {
      const err = new Error(inserted.error.message || 'RETURN_EVENT_INSERT_FAILED');
      err.code = 'RETURN_EVENT_INSERT_FAILED';
      throw err;
    }
    const stateRow = {
      user_id: plan.userId,
      status: modCore.STATUS.RETURNED,
      alien_strike_count: prev.strikeCount,
      entered_at: null,
      release_eligible_at: null,
      return_policy: 'NONE',
      last_returned_at: returnedAt,
      cycle_start_at: returnedAt,
      citizenship_status: reportCore.CITIZENSHIP.EARTH,
      updated_at: returnedAt,
    };
    const upserted = await client.from('user_moderation_state').upsert(stateRow, { onConflict: 'user_id' });
    if (upserted.error) {
      const err = new Error(upserted.error.message || 'RETURN_STATE_UPSERT_FAILED');
      err.code = 'RETURN_STATE_UPSERT_FAILED';
      throw err;
    }
    return { ok: true, state: await getModerationState(plan.userId), event: inserted.data ? mapEventRow(inserted.data) : null };
  }

  async function markReturnEligible(input) {
    if (!persistEnabled) return { ok: false, error: 'ALIEN_PERSIST_DISABLED' };
    const src = input || {};
    const { error } = await client
      .from('user_moderation_state')
      .update({ status: modCore.STATUS.RETURN_ELIGIBLE, updated_at: new Date().toISOString() })
      .eq('user_id', src.userId);
    if (error) return { ok: false, error: 'STATE_NOT_FOUND' };
    return { ok: true, state: await getModerationState(src.userId) };
  }

  async function issueNotification(input) {
    const src = input || {};
    const dedupeKey = src.dedupeKey || null;
    if (dedupeKey) {
      const existing = await client
        .from('user_moderation_notifications')
        .select('*')
        .eq('dedupe_key', dedupeKey)
        .maybeSingle();
      if (existing.data) {
        return { ok: true, duplicate: true, notification: mapNotification(existing.data) };
      }
    }
    const inserted = await client
      .from('user_moderation_notifications')
      .insert({
        user_id: src.userId,
        type: src.type,
        title: src.title || '',
        message: src.message || '',
        dedupe_key: dedupeKey,
      })
      .select('*')
      .maybeSingle();
    if (inserted.error) {
      if (isUniqueViolation(inserted.error) && dedupeKey) {
        const existing = await client
          .from('user_moderation_notifications')
          .select('*')
          .eq('dedupe_key', dedupeKey)
          .maybeSingle();
        return { ok: true, duplicate: true, notification: existing.data ? mapNotification(existing.data) : null };
      }
      const err = new Error(inserted.error.message || 'NOTIFICATION_INSERT_FAILED');
      err.code = 'NOTIFICATION_INSERT_FAILED';
      throw err;
    }
    return { ok: true, duplicate: false, notification: mapNotification(inserted.data) };
  }

  function mapNotification(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      message: row.message,
      dedupeKey: row.dedupe_key,
      createdAt: toIso(row.created_at),
      read: !!row.read_at,
    };
  }

  async function listNotifications(userId) {
    const { data, error } = await client
      .from('user_moderation_notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      const err = new Error(error.message || 'NOTIFICATION_LIST_FAILED');
      err.code = 'NOTIFICATION_LIST_FAILED';
      throw err;
    }
    return (data || []).map(mapNotification);
  }

  async function hasWarningForCycle(userId, cycleKey) {
    const key = reportCore.warningDedupeKey(userId, cycleKey);
    const { data } = await client
      .from('user_moderation_notifications')
      .select('id')
      .eq('dedupe_key', key)
      .maybeSingle();
    if (data) return true;
    const event = await findEventBySource(modCore.EVENT_TYPE.WARNING_ISSUED, key);
    return !!event;
  }

  async function appendWarningEvent(input) {
    const src = input || {};
    const dedupeKey = src.dedupeKey;
    if (!dedupeKey) return { ok: false, error: 'DEDUPE_REQUIRED' };
    const existing = await findEventBySource(modCore.EVENT_TYPE.WARNING_ISSUED, dedupeKey);
    if (existing) return { ok: true, duplicate: true, event: existing };
    const inserted = await client.from('user_moderation_events').insert({
      user_id: src.userId,
      event_type: modCore.EVENT_TYPE.WARNING_ISSUED,
      reason_codes: [],
      source_type: 'SYSTEM',
      source_id: dedupeKey,
      strike_before: 0,
      strike_after: 0,
      previous_status: modCore.STATUS.EARTH,
      next_status: modCore.STATUS.EARTH,
      metadata: { dedupeKey: dedupeKey },
    }).select('*').maybeSingle();
    if (inserted.error) {
      if (isUniqueViolation(inserted.error)) return { ok: true, duplicate: true };
      const err = new Error(inserted.error.message || 'WARNING_EVENT_INSERT_FAILED');
      err.code = 'WARNING_EVENT_INSERT_FAILED';
      throw err;
    }
    return { ok: true, duplicate: false, event: inserted.data ? mapEventRow(inserted.data) : null };
  }

  async function persistUserSanction(input) {
    const src = input || {};
    if (!src.userId) return { ok: false, error: 'USER_ID_REQUIRED' };
    if (src.dedupeKey) {
      const existing = await findEventByDedupe(src.dedupeKey);
      if (existing) {
        return {
          ok: false,
          error: 'SANCTION_BEHAVIOR_ALREADY_SANCTIONED',
          duplicate: true,
          event: existing,
        };
      }
    }
    const patch = {
      current_sanction_type: src.sanctionType || 'NONE',
      current_sanction_starts_at: src.startsAt || null,
      current_sanction_ends_at: src.endsAt || null,
      current_sanction_permanent: !!src.permanent,
      current_sanction_status: src.status || null,
      current_sanction_reason_code: src.reasonCode || null,
      current_sanction_behavior_key: src.behaviorKey || null,
      current_sanction_ladder: src.ladder || null,
      pending_permanent_review: !!src.pendingPermanentReview,
      last_sanctioned_behavior_key: src.behaviorKey || null,
      updated_at: new Date().toISOString(),
    };
    const upsert = await client.from('user_moderation_state').upsert(
      Object.assign({ user_id: src.userId }, patch),
      { onConflict: 'user_id' }
    );
    if (upsert.error) {
      return { ok: false, error: upsert.error.message || 'SANCTION_PERSIST_FAILED', skipped: true };
    }
    if (src.eventType) {
      await client.from('user_moderation_events').insert({
        user_id: src.userId,
        event_type: src.eventType === 'WARNING_ISSUED' ? 'WARNING_ISSUED' : (
          src.eventType === 'OPERATOR_RELEASED' ? 'OPERATOR_RELEASED' : (
            src.eventType === 'PENALTY_EXTENDED' ? 'PENALTY_EXTENDED' : 'OPERATOR_ASSIGNED'
          )
        ),
        reason_codes: src.reasonCode ? [src.reasonCode] : [],
        source_type: src.sourceType === 'OPERATOR' ? 'OPERATOR' : 'REPORT_REVIEW',
        source_id: src.sourceId || src.behaviorKey || null,
        strike_before: 0,
        strike_after: 0,
        previous_status: 'EARTH',
        next_status: 'EARTH',
        metadata: Object.assign({}, src.metadata || {}, { sanctionType: src.sanctionType, dedupeKey: src.dedupeKey }),
      });
    }
    return { ok: true, state: await getModerationState(src.userId) };
  }

  async function createSanctionAppeal(input) {
    const src = input || {};
    const inserted = await client.from('user_sanction_appeals').insert({
      user_id: src.userId,
      sanction_type: src.sanctionType,
      body: src.body || '',
      status: src.status || 'SUBMITTED',
    }).select('*').maybeSingle();
    if (inserted.error) {
      return { ok: false, error: inserted.error.message || 'APPEAL_INSERT_FAILED', skipped: true };
    }
    const row = inserted.data || {};
    return {
      ok: true,
      appeal: {
        id: row.id,
        userId: row.user_id,
        sanctionType: row.sanction_type,
        body: row.body,
        status: row.status,
        operatorReply: row.operator_reply,
        createdAt: toIso(row.created_at),
      },
    };
  }

  function asUuid(value) {
    const s = String(value || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return null;
    return s;
  }

  function mapAppealRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      sanctionType: row.sanction_type,
      body: row.body,
      status: row.status,
      operatorReply: row.operator_reply,
      createdAt: toIso(row.created_at),
      decidedAt: toIso(row.decided_at),
      decidedBy: row.decided_by,
    };
  }

  async function listSanctionAppeals(userId) {
    let query = client.from('user_sanction_appeals').select('*').order('created_at', { ascending: false });
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) return [];
    return (data || []).map(mapAppealRow);
  }

  async function listActiveSanctions() {
    const { data, error } = await client
      .from('user_moderation_state')
      .select('*')
      .neq('current_sanction_type', 'NONE');
    if (error) return [];
    return Promise.all((data || []).map(function (row) {
      return loadProfile(row.user_id).then(function (profile) {
        return mapStateRow(row, profile);
      });
    }));
  }

  async function updateSanctionAppeal(id, patch) {
    const src = patch || {};
    // SUBMITTED 일 때만 갱신 — 동시 요청은 row 0건으로 충돌 판정
    const { data, error } = await client
      .from('user_sanction_appeals')
      .update({
        status: src.status,
        operator_reply: src.operatorReply || null,
        decided_at: src.decidedAt || null,
        decided_by: asUuid(src.decidedBy),
      })
      .eq('id', id)
      .eq('status', 'SUBMITTED')
      .select('*')
      .maybeSingle();
    if (error) return { ok: false, error: error.message || 'APPEAL_UPDATE_FAILED' };
    if (data) {
      return {
        ok: true,
        appeal: mapAppealRow(data),
      };
    }
    const existing = await client
      .from('user_sanction_appeals')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (existing.error || !existing.data) {
      return { ok: false, error: 'APPEAL_NOT_FOUND' };
    }
    return {
      ok: false,
      error: 'APPEAL_ALREADY_DECIDED',
      appeal: mapAppealRow(existing.data),
    };
  }

  async function appendModerationSignal() {
    return { ok: true, note: 'MEMORY_ONLY_NOT_AUTO_DECIDED' };
  }

  async function healthCheck() {
    return {
      ok: true,
      backend: 'supabase',
      autoDecisionEnabled: persistEnabled,
      persistEnabled: persistEnabled,
    };
  }

  return {
    getModerationState,
    listModerationEvents,
    appendModerationSignal,
    planAlienTransfer,
    persistAlienTransferPlan,
    planAlienReturn,
    persistAlienReturnPlan,
    markReturnEligible,
    issueNotification,
    listNotifications,
    hasWarningForCycle,
    appendWarningEvent,
    persistUserSanction,
    createSanctionAppeal,
    listSanctionAppeals,
    listActiveSanctions,
    updateSanctionAppeal,
    healthCheck,
    setPersistEnabled,
    isPersistEnabled,
    findEventByDedupe,
  };
}

module.exports = {
  createAlienModerationSupabaseRepository,
};
