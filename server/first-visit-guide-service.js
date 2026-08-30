'use strict';

const core = require('../shared/first-visit-guide-core');

function makeError(code, status) {
  const err = new Error(code);
  err.code = code;
  err.status = status || 400;
  return err;
}

function getAdminClient(opt) {
  if (opt && typeof opt.getAdminClient === 'function') {
    return opt.getAdminClient();
  }
  try {
    const { getAlignmentSupabaseAdminClient } = require('./alignment-supabase-admin');
    return getAlignmentSupabaseAdminClient();
  } catch (_) {
    return null;
  }
}

function isMissingColumnError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || err.details || '');
  if (code === 'PGRST204' || code === '42703') return true;
  if (/first_visit_guide_|central_plaza_hint_seen_at/i.test(msg) && /does not exist|schema cache/i.test(msg)) {
    return true;
  }
  return false;
}

function createFirstVisitGuideService(options) {
  const opt = options || {};

  async function loadState(userId) {
    const uid = String(userId || '').trim();
    if (!uid) return core.toPublic(null);
    const admin = getAdminClient(opt);
    if (!admin) return core.toPublic(null);
    const res = await admin
      .from('profiles')
      .select(
        'first_visit_guide_eligible_at, first_visit_guide_completed_at, central_plaza_hint_seen_at',
      )
      .eq('id', uid)
      .maybeSingle();
    if (res.error) {
      if (isMissingColumnError(res.error)) return core.toPublic(null);
      return core.toPublic(null);
    }
    return core.toPublicFromProfile(res.data);
  }

  async function stampIfNull(userId, column) {
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const admin = getAdminClient(opt);
    if (!admin) return { ok: true, persisted: false, unavailable: true };
    const now = new Date().toISOString();
    const patch = {};
    patch[column] = now;
    try {
      const res = await admin.from('profiles').update(patch).eq('id', uid).is(column, null);
      if (res.error) {
        if (isMissingColumnError(res.error)) return { ok: true, persisted: false, unavailable: true };
        throw makeError('FIRST_VISIT_SAVE_FAILED', 500);
      }
      return { ok: true, persisted: true, at: now };
    } catch (e) {
      if (e && e.code === 'FIRST_VISIT_SAVE_FAILED') throw e;
      if (isMissingColumnError(e)) return { ok: true, persisted: false, unavailable: true };
      throw makeError('FIRST_VISIT_SAVE_FAILED', 500);
    }
  }

  async function markEligible(userId) {
    return stampIfNull(userId, 'first_visit_guide_eligible_at');
  }

  async function markGuideCompleted(userId) {
    return stampIfNull(userId, 'first_visit_guide_completed_at');
  }

  async function markCentralHintSeen(userId) {
    return stampIfNull(userId, 'central_plaza_hint_seen_at');
  }

  return {
    loadState: loadState,
    markEligible: markEligible,
    markGuideCompleted: markGuideCompleted,
    markCentralHintSeen: markCentralHintSeen,
  };
}

module.exports = {
  createFirstVisitGuideService: createFirstVisitGuideService,
  isMissingColumnError: isMissingColumnError,
};
