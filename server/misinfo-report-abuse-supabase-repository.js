'use strict';

const core = require('../shared/misinfo-report-core');

function wrap(error, code) {
  const err = new Error(code);
  err.code = code;
  err.cause = error;
  return err;
}

function fromDb(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    warningCount: row.warning_count || 0,
    restrictionKind: row.restriction_kind || core.ABUSE_RESTRICTION.NONE,
    restrictedUntil: row.restricted_until || null,
    noticeReason: row.notice_reason || null,
    appealStatus: row.appeal_status || null,
    appealBody: row.appeal_body || null,
    appealReply: row.appeal_reply || null,
    updatedAt: row.updated_at || null,
  };
}

function createMisinfoAbuseSupabaseRepository(options) {
  const client = options && options.client;
  if (!client) throw new Error('SUPABASE_CLIENT_REQUIRED');

  async function getState(userId) {
    const { data, error } = await client
      .from('misinfo_report_abuse_state')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw wrap(error, 'MISINFO_ABUSE_GET_FAILED');
    return fromDb(data) || core.emptyAbuseState(userId);
  }

  async function upsertState(row) {
    const { data, error } = await client
      .from('misinfo_report_abuse_state')
      .upsert({
        user_id: row.userId,
        warning_count: row.warningCount || 0,
        restriction_kind: row.restrictionKind || core.ABUSE_RESTRICTION.NONE,
        restricted_until: row.restrictedUntil || null,
        notice_reason: row.noticeReason || null,
        appeal_status: row.appealStatus || null,
        appeal_body: row.appealBody || null,
        appeal_reply: row.appealReply || null,
        updated_at: row.updatedAt || new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select('*')
      .single();
    if (error) throw wrap(error, 'MISINFO_ABUSE_UPSERT_FAILED');
    return fromDb(data);
  }

  return {
    getState: getState,
    upsertState: upsertState,
  };
}

module.exports = {
  createMisinfoAbuseSupabaseRepository: createMisinfoAbuseSupabaseRepository,
};
