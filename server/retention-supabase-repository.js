'use strict';

const core = require('../shared/retention-policy-core');

function createRetentionSupabaseRepository(options) {
  const opts = options || {};
  const client = opts.client;
  if (!client) {
    const err = new Error('RETENTION_CLIENT_REQUIRED');
    err.code = 'RETENTION_CLIENT_REQUIRED';
    throw err;
  }

  function wrap(error, code) {
    const err = new Error(code || 'RETENTION_RPC_FAILED');
    err.code = code || 'RETENTION_RPC_FAILED';
    if (error && error.message) err.details = error.message;
    return err;
  }

  function mapEvidence(row) {
    if (!row) return null;
    return {
      id: row.id,
      contentKind: row.content_kind,
      sourceContentId: row.source_content_id,
      body: row.body,
      title: row.title,
      createdAt: row.authored_at,
      deletedAt: row.deleted_at,
      deleteReason: row.delete_reason,
      authorUserId: row.author_user_id,
      authorDisplayName: row.author_display_name,
      retentionUntil: row.retention_until,
      legalHold: !!row.legal_hold,
      legalHoldReason: row.legal_hold_reason || null,
    };
  }

  async function upsertDeletedEvidence(row) {
    const payload = {
      content_kind: row.contentKind,
      source_content_id: row.sourceContentId,
      body: row.body,
      title: row.title,
      authored_at: row.createdAt,
      deleted_at: row.deletedAt,
      delete_reason: row.deleteReason,
      author_user_id: row.authorUserId,
      author_display_name: row.authorDisplayName,
      retention_until: row.retentionUntil,
      legal_hold: !!row.legalHold,
      legal_hold_reason: row.legalHoldReason || null,
    };
    const existing = await client
      .from('deleted_content_evidence')
      .select('*')
      .eq('content_kind', row.contentKind)
      .eq('source_content_id', row.sourceContentId)
      .maybeSingle();
    if (existing.error) throw wrap(existing.error, 'EVIDENCE_LOOKUP_FAILED');
    if (existing.data) {
      const until = core.maxRetention(existing.data.retention_until, row.retentionUntil);
      const patch = {
        retention_until: until,
        updated_at: new Date().toISOString(),
      };
      if (existing.data.legal_hold) patch.legal_hold = true;
      const upd = await client
        .from('deleted_content_evidence')
        .update(patch)
        .eq('id', existing.data.id)
        .select('*')
        .maybeSingle();
      if (upd.error) throw wrap(upd.error, 'EVIDENCE_UPDATE_FAILED');
      return { ok: true, duplicate: true, row: mapEvidence(upd.data || existing.data) };
    }
    const inserted = await client
      .from('deleted_content_evidence')
      .insert(payload)
      .select('*')
      .maybeSingle();
    if (inserted.error) throw wrap(inserted.error, 'EVIDENCE_INSERT_FAILED');
    return { ok: true, duplicate: false, row: mapEvidence(inserted.data) };
  }

  async function getEvidenceBySource(kind, sourceId) {
    const { data, error } = await client
      .from('deleted_content_evidence')
      .select('*')
      .eq('content_kind', kind)
      .eq('source_content_id', sourceId)
      .maybeSingle();
    if (error) throw wrap(error, 'EVIDENCE_LOOKUP_FAILED');
    return mapEvidence(data);
  }

  async function getEvidenceById(id) {
    const { data, error } = await client
      .from('deleted_content_evidence')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw wrap(error, 'EVIDENCE_LOOKUP_FAILED');
    return mapEvidence(data);
  }

  async function listEvidence() {
    const { data, error } = await client.from('deleted_content_evidence').select('*');
    if (error) throw wrap(error, 'EVIDENCE_LIST_FAILED');
    return (data || []).map(mapEvidence);
  }

  async function setEvidenceLegalHold(id, hold, reason) {
    const { data, error } = await client
      .from('deleted_content_evidence')
      .update({
        legal_hold: !!hold,
        legal_hold_reason: hold ? (reason || null) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw wrap(error, 'EVIDENCE_HOLD_FAILED');
    if (!data) return { ok: false, error: 'EVIDENCE_NOT_FOUND' };
    return { ok: true, row: mapEvidence(data) };
  }

  async function deleteEvidence(id) {
    const row = await getEvidenceById(id);
    if (!row) return { ok: true, deleted: 0 };
    const { error } = await client.from('deleted_content_evidence').delete().eq('id', id);
    if (error) throw wrap(error, 'EVIDENCE_DELETE_FAILED');
    return { ok: true, deleted: 1, wiped: { kind: row.contentKind, sourceId: row.sourceContentId } };
  }

  async function upsertReportRetention(reportId, patch) {
    const updates = {
      finalized_at: Object.prototype.hasOwnProperty.call(patch, 'finalizedAt') ? patch.finalizedAt : undefined,
      retention_until: Object.prototype.hasOwnProperty.call(patch, 'retentionUntil') ? patch.retentionUntil : undefined,
      legal_hold: Object.prototype.hasOwnProperty.call(patch, 'legalHold') ? !!patch.legalHold : undefined,
      evidence_id: Object.prototype.hasOwnProperty.call(patch, 'evidenceId') ? patch.evidenceId : undefined,
    };
    Object.keys(updates).forEach(function (k) {
      if (updates[k] === undefined) delete updates[k];
    });
    const { data, error } = await client
      .from('board_reports')
      .update(updates)
      .eq('id', reportId)
      .select('id, status, finalized_at, retention_until, legal_hold, evidence_id')
      .maybeSingle();
    if (error) throw wrap(error, 'REPORT_RETENTION_UPDATE_FAILED');
    return {
      ok: true,
      row: data && {
        id: data.id,
        status: data.status,
        finalizedAt: data.finalized_at,
        retentionUntil: data.retention_until,
        legalHold: !!data.legal_hold,
        evidenceId: data.evidence_id,
      },
    };
  }

  async function getReportRetention(reportId) {
    const { data, error } = await client
      .from('board_reports')
      .select('id, status, finalized_at, retention_until, legal_hold, legal_hold_reason, evidence_id, post_id, comment_id')
      .eq('id', reportId)
      .maybeSingle();
    if (error) throw wrap(error, 'REPORT_RETENTION_GET_FAILED');
    if (!data) return null;
    return {
      id: data.id,
      status: data.status,
      finalizedAt: data.finalized_at,
      retentionUntil: data.retention_until,
      legalHold: !!data.legal_hold,
      legalHoldReason: data.legal_hold_reason,
      evidenceId: data.evidence_id,
      postId: data.post_id,
      commentId: data.comment_id,
    };
  }

  async function listReportRetention() {
    const { data, error } = await client
      .from('board_reports')
      .select('id, status, finalized_at, retention_until, legal_hold, evidence_id, post_id, comment_id');
    if (error) throw wrap(error, 'REPORT_RETENTION_LIST_FAILED');
    return (data || []).map(function (row) {
      return {
        id: row.id,
        status: row.status,
        finalizedAt: row.finalized_at,
        retentionUntil: row.retention_until,
        legalHold: !!row.legal_hold,
        evidenceId: row.evidence_id,
        postId: row.post_id,
        commentId: row.comment_id,
      };
    });
  }

  async function deleteReportRetention(reportId) {
    const { error, count } = await client
      .from('board_reports')
      .delete({ count: 'exact' })
      .eq('id', reportId);
    if (error) throw wrap(error, 'REPORT_RETENTION_DELETE_FAILED');
    return { ok: true, deleted: count || 1 };
  }

  async function insertSanctionRecord(row) {
    const inserted = await client
      .from('user_sanction_records')
      .insert({
        user_id: row.userId,
        sanction_type: row.sanctionType,
        starts_at: row.startsAt,
        ends_at: row.endsAt,
        permanent: !!row.permanent,
        reason_code: row.reasonCode,
        retention_until: row.retentionUntil,
        legal_hold: !!row.legalHold,
      })
      .select('*')
      .maybeSingle();
    if (inserted.error) throw wrap(inserted.error, 'SANCTION_RECORD_INSERT_FAILED');
    return {
      ok: true,
      row: inserted.data && {
        id: inserted.data.id,
        userId: inserted.data.user_id,
        sanctionType: inserted.data.sanction_type,
        startsAt: inserted.data.starts_at,
        endsAt: inserted.data.ends_at,
        permanent: !!inserted.data.permanent,
        reasonCode: inserted.data.reason_code,
        retentionUntil: inserted.data.retention_until,
        legalHold: !!inserted.data.legal_hold,
      },
    };
  }

  async function listSanctionRecords() {
    const { data, error } = await client.from('user_sanction_records').select('*');
    if (error) throw wrap(error, 'SANCTION_RECORD_LIST_FAILED');
    return (data || []).map(function (row) {
      return {
        id: row.id,
        userId: row.user_id,
        sanctionType: row.sanction_type,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        permanent: !!row.permanent,
        reasonCode: row.reason_code,
        retentionUntil: row.retention_until,
        legalHold: !!row.legal_hold,
      };
    });
  }

  async function deleteSanctionRecord(id) {
    const { error } = await client.from('user_sanction_records').delete().eq('id', id);
    if (error) throw wrap(error, 'SANCTION_RECORD_DELETE_FAILED');
    return { ok: true, deleted: 1 };
  }

  async function insertRejoinBlock(row) {
    const inserted = await client
      .from('banned_rejoin_blocks')
      .insert({
        identity_hash: row.identityHash,
        identity_kind: row.identityKind,
        sanction_type: row.sanctionType,
        banned_at: row.bannedAt,
        reason_code: row.reasonCode,
        withdrawn_at: row.withdrawnAt,
        retention_until: row.retentionUntil,
        legal_hold: !!row.legalHold,
      })
      .select('*')
      .maybeSingle();
    if (inserted.error) {
      if (inserted.error.code === '23505') return { ok: true, duplicate: true };
      throw wrap(inserted.error, 'REJOIN_BLOCK_INSERT_FAILED');
    }
    return { ok: true, duplicate: false, row: inserted.data };
  }

  async function listRejoinBlocks() {
    const { data, error } = await client.from('banned_rejoin_blocks').select('*');
    if (error) throw wrap(error, 'REJOIN_BLOCK_LIST_FAILED');
    return (data || []).map(function (row) {
      return {
        id: row.id,
        identityHash: row.identity_hash,
        identityKind: row.identity_kind,
        sanctionType: row.sanction_type,
        bannedAt: row.banned_at,
        reasonCode: row.reason_code,
        withdrawnAt: row.withdrawn_at,
        retentionUntil: row.retention_until,
        legalHold: !!row.legal_hold,
      };
    });
  }

  async function deleteRejoinBlock(id) {
    const { error } = await client.from('banned_rejoin_blocks').delete().eq('id', id);
    if (error) throw wrap(error, 'REJOIN_BLOCK_DELETE_FAILED');
    return { ok: true, deleted: 1 };
  }

  async function wipeBoardSource(kind, sourceId) {
    const table = kind === 'COMMENT' ? 'board_comments' : 'board_posts';
    const patch = kind === 'COMMENT'
      ? { content: '', author_user_id: null, updated_at: new Date().toISOString() }
      : { title: '', content: '', author_user_id: null, updated_at: new Date().toISOString() };
    const { error } = await client.from(table).update(patch).eq('id', sourceId).eq('status', 'DELETED');
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  return {
    upsertDeletedEvidence,
    getEvidenceBySource,
    getEvidenceById,
    listEvidence,
    setEvidenceLegalHold,
    deleteEvidence,
    upsertReportRetention,
    getReportRetention,
    listReportRetention,
    deleteReportRetention,
    insertSanctionRecord,
    listSanctionRecords,
    deleteSanctionRecord,
    insertRejoinBlock,
    listRejoinBlocks,
    deleteRejoinBlock,
    wipeBoardSource,
  };
}

module.exports = {
  createRetentionSupabaseRepository,
};
