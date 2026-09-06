'use strict';

const core = require('../shared/admin-moderation-audit-core');

function wrap(error, code) {
  const err = new Error(code || 'ADMIN_AUDIT_QUERY_FAILED');
  err.code = code || 'ADMIN_AUDIT_QUERY_FAILED';
  if (error && error.message) err.details = error.message;
  return err;
}

function fromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    actorUserId: row.actor_user_id || null,
    actionType: row.action_type,
    targetType: row.target_type,
    targetId: row.target_id,
    targetUserId: row.target_user_id || null,
    reasonCode: row.reason_code,
    operatorNote: row.operator_note || '',
    sanctionId: row.sanction_id || null,
    reportId: row.report_id || null,
    createdAt: row.created_at,
  };
}

function createAdminModerationAuditSupabaseRepository(options) {
  const opts = options || {};
  const client = opts.client;
  if (!client) {
    const err = new Error('ADMIN_AUDIT_CLIENT_REQUIRED');
    err.code = 'ADMIN_AUDIT_CLIENT_REQUIRED';
    throw err;
  }

  async function insertEvent(input) {
    const packed = core.normalizeWrite(input);
    if (!packed.ok) {
      const err = new Error(packed.error);
      err.code = packed.error;
      throw err;
    }
    const ev = packed.event;
    const { data, error } = await client.rpc('admin_insert_moderation_audit_event', {
      p_actor_user_id: ev.actorUserId,
      p_action_type: ev.actionType,
      p_target_type: ev.targetType,
      p_target_id: ev.targetId,
      p_target_user_id: ev.targetUserId,
      p_reason_code: ev.reasonCode,
      p_operator_note: ev.operatorNote,
      p_sanction_id: ev.sanctionId,
      p_report_id: ev.reportId,
    });
    if (error) throw wrap(error, 'ADMIN_AUDIT_INSERT_FAILED');
    const row = data && data.audit ? data.audit : data;
    return fromDb(row);
  }

  async function listEvents(query) {
    const q = query || {};
    let req = client
      .from('admin_moderation_audit_events')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit((q.limit || core.DEFAULT_LIMIT) + 1);

    if (q.from) req = req.gte('created_at', q.from);
    if (q.to) req = req.lte('created_at', q.to);
    if (q.actorUserId) req = req.eq('actor_user_id', q.actorUserId);
    if (q.actionType) req = req.eq('action_type', q.actionType);
    if (q.targetType) req = req.eq('target_type', q.targetType);
    if (q.targetId) req = req.eq('target_id', q.targetId);
    if (q.targetUserId) req = req.eq('target_user_id', q.targetUserId);
    if (q.reasonCode) req = req.eq('reason_code', q.reasonCode);
    if (q.sanctionId) req = req.eq('sanction_id', q.sanctionId);
    if (q.reportId) req = req.eq('report_id', q.reportId);
    if (q.noteKeyword) req = req.ilike('operator_note', '%' + q.noteKeyword.replace(/[%_]/g, '\\$&') + '%');
    if (q.cursor) {
      req = req.or(
        'created_at.lt.' + q.cursor.createdAt +
          ',and(created_at.eq.' + q.cursor.createdAt + ',id.lt.' + q.cursor.id + ')',
      );
    }

    const { data, error } = await req;
    if (error) throw wrap(error, 'ADMIN_AUDIT_LIST_FAILED');
    const rows = (data || []).map(fromDb);
    const limit = q.limit || core.DEFAULT_LIMIT;
    const slice = rows.slice(0, limit);
    const last = slice[slice.length - 1];
    return {
      events: slice,
      nextCursor: rows.length > slice.length && last ? core.encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async function loadDisplayNames(userIds) {
    const ids = (userIds || []).filter(function (id) {
      return !!id;
    });
    const unique = [];
    ids.forEach(function (id) {
      if (unique.indexOf(id) === -1) unique.push(id);
    });
    if (!unique.length) return {};
    const { data, error } = await client.from('profiles').select('id, display_name').in('id', unique);
    if (error) return {};
    const out = Object.create(null);
    (data || []).forEach(function (row) {
      if (row && row.id && row.display_name) out[row.id] = row.display_name;
    });
    return out;
  }

  async function getEvent(id) {
    const { data, error } = await client
      .from('admin_moderation_audit_events')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw wrap(error, 'ADMIN_AUDIT_GET_FAILED');
    return fromDb(data);
  }

  async function getLegalHold(auditEventId) {
    const ev = await getEvent(auditEventId);
    if (!ev) return { ok: false, error: 'ADMIN_AUDIT_NOT_FOUND' };
    const retentionCore = require('../shared/retention-policy-core');
    const { data, error } = await client
      .from('admin_moderation_audit_legal_holds')
      .select('*')
      .eq('audit_event_id', auditEventId)
      .maybeSingle();
    if (error) throw wrap(error, 'ADMIN_AUDIT_HOLD_GET_FAILED');
    return {
      ok: true,
      legalHold: !!(data && data.legal_hold),
      legalHoldReason: data && data.legal_hold ? data.legal_hold_reason : (data && data.legal_hold_reason) || null,
      releasedAt: data && data.released_at ? data.released_at : null,
      retentionUntil: retentionCore.adminAuditRetentionUntil(ev.createdAt),
    };
  }

  async function setLegalHold(input) {
    const src = input || {};
    const { data, error } = await client.rpc('set_admin_moderation_audit_legal_hold', {
      p_audit_event_id: src.auditEventId,
      p_hold: !!src.hold,
      p_reason: src.reason || '',
      p_actor_user_id: src.actorUserId || null,
    });
    if (error) {
      const msg = String(error.message || '');
      if (/ADMIN_AUDIT_NOT_FOUND/i.test(msg)) return { ok: false, error: 'ADMIN_AUDIT_NOT_FOUND' };
      if (/LEGAL_HOLD_REASON_REQUIRED/i.test(msg)) return { ok: false, error: 'LEGAL_HOLD_REASON_REQUIRED' };
      throw wrap(error, 'ADMIN_AUDIT_HOLD_FAILED');
    }
    const row = data || {};
    return {
      ok: true,
      idempotent: !!row.idempotent,
      legalHold: !!row.legal_hold,
      legalHoldReason: row.legal_hold_reason || null,
      releasedAt: row.released_at || null,
    };
  }

  async function purgeExpired() {
    const { data, error } = await client.rpc('purge_expired_admin_moderation_audit_events');
    if (error) throw wrap(error, 'ADMIN_AUDIT_PURGE_FAILED');
    return { ok: true, deleted: Number(data) || 0 };
  }

  async function updateEvent() {
    const err = new Error('ADMIN_AUDIT_APPEND_ONLY');
    err.code = 'ADMIN_AUDIT_APPEND_ONLY';
    throw err;
  }

  async function deleteEvent() {
    const err = new Error('ADMIN_AUDIT_APPEND_ONLY');
    err.code = 'ADMIN_AUDIT_APPEND_ONLY';
    throw err;
  }

  return {
    insertEvent: insertEvent,
    listEvents: listEvents,
    getEvent: getEvent,
    loadDisplayNames: loadDisplayNames,
    getLegalHold: getLegalHold,
    setLegalHold: setLegalHold,
    purgeExpired: purgeExpired,
    updateEvent: updateEvent,
    deleteEvent: deleteEvent,
  };
}

module.exports = {
  createAdminModerationAuditSupabaseRepository: createAdminModerationAuditSupabaseRepository,
};
