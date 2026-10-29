'use strict';

const core = require('../shared/legal-gate-core');

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

function shouldEnforce() {
  if (String(process.env.LEGAL_GATE_ENFORCE || '').trim() === '0') return false;
  if (String(process.env.LEGAL_GATE_ENFORCE || '').trim() === '1') return true;
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

const LEGAL_CONSENT_SELECT =
  'user_id, age_requirement_confirmed_at, age_policy_version, age_gate_method, ' +
  'sensitive_political_consented_at, sensitive_political_policy_version, ' +
  'territory_disclosure_consented_at, territory_disclosure_policy_version, ' +
  'political_profile_visibility, updated_at';

function rowFromData(data) {
  if (!data) return null;
  return {
    user_id: data.user_id || data.userId || null,
    age_requirement_confirmed_at: data.age_requirement_confirmed_at || null,
    age_policy_version: data.age_policy_version || null,
    age_gate_method: data.age_gate_method || null,
    sensitive_political_consented_at: data.sensitive_political_consented_at || null,
    sensitive_political_policy_version: data.sensitive_political_policy_version || null,
    territory_disclosure_consented_at: data.territory_disclosure_consented_at || null,
    territory_disclosure_policy_version: data.territory_disclosure_policy_version || null,
    political_profile_visibility: data.political_profile_visibility || core.VISIBILITY_PRIVATE,
    updated_at: data.updated_at || null,
  };
}

function createLegalGateService(options) {
  const opt = options || {};

  async function loadRow(userId) {
    const admin = getAdminClient(opt);
    if (!admin) return { row: null, unavailable: true };
    const res = await admin
      .from('user_legal_consents')
      .select(LEGAL_CONSENT_SELECT)
      .eq('user_id', userId)
      .maybeSingle();
    if (res.error) return { row: null, unavailable: true, error: res.error };
    return { row: rowFromData(res.data), unavailable: false };
  }

  async function getStatus(userId) {
    const loaded = await loadRow(userId);
    return core.toPublicStatus(loaded.row);
  }

  async function assertAuthUserPresent(admin, uid) {
    const authAdmin = admin && admin.auth && admin.auth.admin;
    if (!authAdmin || typeof authAdmin.getUserById !== 'function') return;
    let res;
    try {
      res = await authAdmin.getUserById(uid);
    } catch (_) {
      throw makeError('LEGAL_GATE_SAVE_FAILED', 409);
    }
    const user = res && res.data && res.data.user ? res.data.user : res && res.user;
    if (!res || res.error || !user) throw makeError('LEGAL_GATE_SAVE_FAILED', 409);
  }

  async function assertCompleteForUser(userId) {
    if (!shouldEnforce()) return true;
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const loaded = await loadRow(uid);
    if (loaded.unavailable) throw makeError('LEGAL_GATE_INCOMPLETE', 403);
    if (!core.isComplete(loaded.row)) throw makeError('LEGAL_GATE_INCOMPLETE', 403);
    return true;
  }

  async function confirmAge(userId, body) {
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const parsed = core.parseAgeConfirmBody(body);
    if (!parsed.ok) throw makeError(parsed.error, parsed.status || 400);
    const admin = getAdminClient(opt);
    if (!admin) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    const now = new Date().toISOString();
    const existing = await loadRow(uid);
    if (existing.unavailable) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    await assertAuthUserPresent(admin, uid);
    const agePatch = {
      age_requirement_confirmed_at: now,
      age_policy_version: parsed.policyVersion,
      age_gate_method: parsed.method,
      updated_at: now,
    };
    let res;
    if (existing.row) {
      res = await admin.from('user_legal_consents').update(agePatch).eq('user_id', uid);
    } else {
      agePatch.user_id = uid;
      agePatch.created_at = now;
      res = await admin.from('user_legal_consents').upsert(agePatch, { onConflict: 'user_id' });
    }
    if (!res || res.error) throw makeError('LEGAL_GATE_SAVE_FAILED', 500);
    const status = await getStatus(uid);
    if (core.containsDob(status)) throw makeError('LEGAL_GATE_DOB_LEAK', 500);
    await markSignupCompletedIfLegalComplete(uid, status);
    return status;
  }

  async function markSignupCompletedIfLegalComplete(userId, status) {
    if (!status || status.complete !== true) return;
    const uid = String(userId || '').trim();
    if (!uid) return;
    const admin = getAdminClient(opt);
    if (!admin) return;
    const now = new Date().toISOString();
    try {
      await admin
        .from('profiles')
        .update({ signup_completed_at: now })
        .eq('id', uid)
        .is('signup_completed_at', null);
    } catch (_) {}
  }

  async function consentSensitive(userId, body) {
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const parsed = core.parseSensitiveConsentBody(body);
    if (!parsed.ok) throw makeError(parsed.error, parsed.status || 400);
    const loaded = await loadRow(uid);
    if (loaded.unavailable) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    if (!core.isAgeConfirmed(loaded.row)) throw makeError('AGE_CONFIRM_REQUIRED', 403);
    const admin = getAdminClient(opt);
    if (!admin) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    await assertAuthUserPresent(admin, uid);
    const now = new Date().toISOString();
    const existing = loaded.row || {};
    let query = admin
      .from('user_legal_consents')
      .update({
        sensitive_political_consented_at: existing.sensitive_political_consented_at || now,
        sensitive_political_policy_version:
          existing.sensitive_political_policy_version || parsed.policyVersion,
        territory_disclosure_consented_at: existing.territory_disclosure_consented_at || now,
        territory_disclosure_policy_version:
          existing.territory_disclosure_policy_version || parsed.territoryDisclosurePolicyVersion,
        political_profile_visibility:
          existing.political_profile_visibility || core.VISIBILITY_PRIVATE,
        updated_at: now,
      })
      .eq('user_id', uid);
    if (existing.updated_at) query = query.eq('updated_at', existing.updated_at);
    const res = await query.select('user_id');
    const saved = res && Array.isArray(res.data) ? res.data : res && res.data ? [res.data] : [];
    if (!res || res.error || saved.length !== 1) throw makeError('LEGAL_GATE_SAVE_FAILED', 409);
    const status = await getStatus(uid);
    await markSignupCompletedIfLegalComplete(uid, status);
    return status;
  }

  async function setVisibility(userId, visibility) {
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const loaded = await loadRow(uid);
    if (loaded.unavailable) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    if (!core.isComplete(loaded.row)) throw makeError('LEGAL_GATE_INCOMPLETE', 403);
    const vis = core.normalizeVisibility(visibility);
    const admin = getAdminClient(opt);
    if (!admin) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    const res = await admin
      .from('user_legal_consents')
      .update({
        political_profile_visibility: vis,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', uid);
    if (res.error) throw makeError('LEGAL_GATE_SAVE_FAILED', 500);
    return getStatus(uid);
  }

  async function withdrawSensitiveConsent(userId) {
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const admin = getAdminClient(opt);
    if (!admin || typeof admin.rpc !== 'function') throw makeError('LEGAL_GATE_SAVE_FAILED', 500);
    const rpc = await admin.rpc('withdraw_sensitive_political_consent', { p_user_id: uid });
    if (!rpc || rpc.error) throw makeError('LEGAL_GATE_SAVE_FAILED', 500);
    return getStatus(uid);
  }

  async function filterUserIdsAllowed(userIds) {
    const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
    if (!ids.length) return [];
    if (!shouldEnforce()) return ids;
    const admin = getAdminClient(opt);
    if (!admin) return [];
    const res = await admin
      .from('user_legal_consents')
      .select(LEGAL_CONSENT_SELECT)
      .in('user_id', ids);
    if (res.error) return [];
    const allowed = {};
    (res.data || []).forEach(function (row) {
      if (core.isComplete(rowFromData(row))) allowed[row.user_id] = true;
    });
    return ids.filter(function (id) {
      return !!allowed[id];
    });
  }

  return {
    getStatus: getStatus,
    assertCompleteForUser: assertCompleteForUser,
    confirmAge: confirmAge,
    consentSensitive: consentSensitive,
    setVisibility: setVisibility,
    withdrawSensitiveConsent: withdrawSensitiveConsent,
    filterUserIdsAllowed: filterUserIdsAllowed,
    shouldEnforce: shouldEnforce,
  };
}

module.exports = {
  createLegalGateService: createLegalGateService,
  shouldEnforce: shouldEnforce,
  getAdminClient: getAdminClient,
};
