'use strict';

const core = require('../shared/rights-email-verify-core');

function wrap(error, code) {
  const err = new Error(code);
  err.code = code;
  err.cause = error;
  return err;
}

function fromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    emailHash: row.email_hash,
    codeHash: row.code_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSentAt: row.last_sent_at,
    failCount: row.fail_count,
    verifiedAt: row.verified_at,
    consumedAt: row.consumed_at,
  };
}

function createRightsEmailVerifySupabaseRepository(options) {
  const client = options && options.client;
  if (!client) throw new Error('SUPABASE_CLIENT_REQUIRED');

  async function upsertByEmailHash(row) {
    const { data, error } = await client
      .from('rights_email_challenges')
      .upsert({
        email_hash: row.emailHash,
        code_hash: row.codeHash,
        created_at: row.createdAt,
        expires_at: row.expiresAt,
        last_sent_at: row.lastSentAt,
        fail_count: row.failCount || 0,
        verified_at: row.verifiedAt || null,
        consumed_at: row.consumedAt || null,
      }, { onConflict: 'email_hash' })
      .select('*')
      .single();
    if (error) throw wrap(error, 'RIGHTS_EMAIL_UPSERT_FAILED');
    return fromDb(data);
  }

  async function getByEmailHash(emailHash) {
    const { data, error } = await client
      .from('rights_email_challenges')
      .select('*')
      .eq('email_hash', emailHash)
      .maybeSingle();
    if (error) throw wrap(error, 'RIGHTS_EMAIL_GET_FAILED');
    return fromDb(data);
  }

  async function deleteByEmailHash(emailHash) {
    const { error } = await client.from('rights_email_challenges').delete().eq('email_hash', emailHash);
    if (error) throw wrap(error, 'RIGHTS_EMAIL_DELETE_FAILED');
    return true;
  }

  async function deleteExpired(nowIso) {
    const nowMs = new Date(nowIso || Date.now()).getTime();
    const { data, error } = await client.from('rights_email_challenges').select('*');
    if (error) throw wrap(error, 'RIGHTS_EMAIL_PURGE_LIST_FAILED');
    let n = 0;
    const rows = data || [];
    for (let i = 0; i < rows.length; i++) {
      const mapped = fromDb(rows[i]);
      if (!core.shouldPurge(mapped, nowMs)) continue;
      const del = await client.from('rights_email_challenges').delete().eq('email_hash', mapped.emailHash);
      if (!del.error) n += 1;
    }
    return n;
  }

  return {
    upsertByEmailHash: upsertByEmailHash,
    getByEmailHash: getByEmailHash,
    deleteByEmailHash: deleteByEmailHash,
    deleteExpired: deleteExpired,
  };
}

module.exports = {
  createRightsEmailVerifySupabaseRepository: createRightsEmailVerifySupabaseRepository,
};
