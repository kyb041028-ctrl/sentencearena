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

const US_LEGAL_TABLE = 'user_activity_region_legal_consents';

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

  async function loadUsRow(userId) {
    const admin = getAdminClient(opt);
    if (!admin) return { row: null, unavailable: true };
    const res = await admin
      .from(US_LEGAL_TABLE)
      .select('*')
      .eq('user_id', userId)
      .eq('activity_region', 'US')
      .maybeSingle();
    if (!res || res.error) return { row: null, unavailable: true, error: res && res.error };
    return { row: res.data || null, unavailable: false };
  }

  async function saveUsRow(uid, existing, patch) {
    const admin = getAdminClient(opt);
    if (!admin) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    const now = new Date().toISOString();
    const next = Object.assign({}, patch, { updated_at: now, activity_region: 'US' });
    let res;
    if (!existing) {
      next.user_id = uid;
      next.created_at = now;
      next.privacy_processing_consent_at = null;
      res = await admin.from(US_LEGAL_TABLE).upsert(next, { onConflict: 'user_id,activity_region' });
    } else {
      let query = admin.from(US_LEGAL_TABLE).update(next).eq('user_id', uid).eq('activity_region', 'US');
      if (existing.updated_at) query = query.eq('updated_at', existing.updated_at);
      res = await query.select('user_id');
      const saved = res && Array.isArray(res.data) ? res.data : res && res.data ? [res.data] : [];
      if (!res || res.error || saved.length !== 1) throw makeError('LEGAL_GATE_SAVE_FAILED', 409);
      return loadUsRow(uid);
    }
    if (!res || res.error) throw makeError('LEGAL_GATE_SAVE_FAILED', 500);
    return loadUsRow(uid);
  }

  async function confirmUsAge(userId, body) {
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const parsed = core.parseUsAgeConfirmBody(body);
    if (!parsed.ok) throw makeError(parsed.error, parsed.status || 400);
    const admin = getAdminClient(opt);
    if (!admin) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    const existing = await loadUsRow(uid);
    if (existing.unavailable) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    await assertAuthUserPresent(admin, uid);
    const now = new Date().toISOString();
    const row = existing.row;
    const saved = await saveUsRow(uid, row, {
      age_requirement_confirmed_at: (row && row.age_requirement_confirmed_at) || now,
      age_policy_version: core.US_AGE_POLICY_VERSION,
      age_policy_region: 'US',
      age_gate_method: parsed.method,
      draft_status: core.DRAFT_REVIEW_STATUS,
    });
    if (saved.unavailable) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    const status = core.toPublicUsStatus(saved.row);
    if (core.containsDob(status) || core.containsDob(saved.row)) throw makeError('LEGAL_GATE_DOB_LEAK', 500);
    return status;
  }

  async function saveUsSignupConsent(userId, body) {
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const parsed = core.parseUsSignupConsent(body);
    if (!parsed.ok) throw makeError(parsed.error, parsed.status || 400);
    const loaded = await loadUsRow(uid);
    if (loaded.unavailable) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    if (!core.isUsAgeConfirmed(loaded.row)) throw makeError('AGE_CONFIRM_REQUIRED', 403);
    const admin = getAdminClient(opt);
    if (!admin) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    await assertAuthUserPresent(admin, uid);
    const now = new Date().toISOString();
    const row = loaded.row;
    const marketingOn = parsed.marketingOptIn === true;
    const saved = await saveUsRow(uid, row, {
      terms_document_version: parsed.termsVersion,
      terms_consented_at: row.terms_consented_at || now,
      privacy_document_version: parsed.privacyVersion,
      privacy_acknowledged_at: row.privacy_acknowledged_at || now,
      privacy_processing_consent_at: null,
      sensitive_political_policy_version: parsed.policyVersion,
      sensitive_political_consented_at: row.sensitive_political_consented_at || now,
      sensitive_applies_to: 'US',
      territory_disclosure_policy_version: parsed.territoryDisclosurePolicyVersion,
      territory_disclosure_consented_at: row.territory_disclosure_consented_at || now,
      territory_disclosure_applies_to: 'US',
      marketing_opt_in: marketingOn,
      marketing_policy_version: parsed.marketingVersion,
      marketing_choice_at: row.marketing_choice_at || now,
      marketing_withdrawn_at: marketingOn ? null : row.marketing_withdrawn_at || null,
      draft_status: core.DRAFT_REVIEW_STATUS,
    });
    if (saved.unavailable || !saved.row) throw makeError('LEGAL_GATE_SAVE_FAILED', 500);
    const status = core.toPublicUsStatus(saved.row);
    if (core.containsDob(status)) throw makeError('LEGAL_GATE_DOB_LEAK', 500);
    await markSignupCompletedIfLegalComplete(uid, { complete: status.complete === true });
    return status;
  }

  async function withdrawUsSensitiveConsent(userId) {
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const loaded = await loadUsRow(uid);
    if (loaded.unavailable) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    if (!loaded.row) throw makeError('LEGAL_GATE_INCOMPLETE', 403);
    const saved = await saveUsRow(uid, loaded.row, {
      sensitive_political_consented_at: null,
      sensitive_political_policy_version: null,
      sensitive_applies_to: null,
      territory_disclosure_consented_at: null,
      territory_disclosure_policy_version: null,
      territory_disclosure_applies_to: null,
    });
    return core.toPublicUsStatus(saved.row);
  }

  async function withdrawUsMarketing(userId) {
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const loaded = await loadUsRow(uid);
    if (loaded.unavailable) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
    if (!loaded.row) throw makeError('LEGAL_GATE_INCOMPLETE', 403);
    const saved = await saveUsRow(uid, loaded.row, {
      marketing_opt_in: false,
      marketing_withdrawn_at: new Date().toISOString(),
    });
    return core.toPublicUsStatus(saved.row);
  }

  async function assertUsCompleteForUser(userId) {
    if (!shouldEnforce()) return true;
    const uid = String(userId || '').trim();
    if (!uid) throw makeError('UNAUTHORIZED', 401);
    const loaded = await loadUsRow(uid);
    if (loaded.unavailable || !core.isUsSignupComplete(loaded.row)) {
      throw makeError('LEGAL_GATE_INCOMPLETE', 403);
    }
    return true;
  }

  async function confirmAge(userId, body, context) {
    if (context && context.appliedRegion === 'US') return confirmUsAge(userId, body);
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
    saveUsSignupConsent: saveUsSignupConsent,
    withdrawUsSensitiveConsent: withdrawUsSensitiveConsent,
    withdrawUsMarketing: withdrawUsMarketing,
    assertUsCompleteForUser: assertUsCompleteForUser,
    getUsStatus: async function (userId) {
      const loaded = await loadUsRow(userId);
      if (loaded.unavailable) throw makeError('LEGAL_GATE_UNAVAILABLE', 503);
      return core.toPublicUsStatus(loaded.row);
    },
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
