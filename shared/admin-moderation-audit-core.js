/**
 * 관리자 직접조치 audit — 허용값·검색 정규화.
 * 게시글 본문/email/OAuth/성향/XP/Fame 을 저장하지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AdminModerationAuditCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function adminModerationAuditCoreFactory() {
  'use strict';

  var ACTION_TYPE = Object.freeze({
    POST_SOFT_DELETE: 'POST_SOFT_DELETE',
    POST_RESTORE: 'POST_RESTORE',
    SANCTION_APPLIED: 'SANCTION_APPLIED',
  });

  var TARGET_TYPE = Object.freeze({
    POST: 'POST',
    COMMENT: 'COMMENT',
  });

  var CONTENT_REASON_CODES = Object.freeze(['abuse', 'spam', 'baiting', 'misinfo', 'privacy', 'other']);
  var RESTORE_REASON_CODES = Object.freeze(['OPERATOR_CORRECTION', 'APPEAL_RESULT', 'OTHER']);

  var NOTE_MAX = 500;
  var DEFAULT_LIMIT = 30;
  var MAX_LIMIT = 100;

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isUuid(v) {
    return typeof v === 'string' && UUID_RE.test(v);
  }

  function trimText(v) {
    return String(v == null ? '' : v).trim();
  }

  function isActionType(v) {
    return Object.prototype.hasOwnProperty.call(ACTION_TYPE, String(v || ''));
  }

  function isTargetType(v) {
    return Object.prototype.hasOwnProperty.call(TARGET_TYPE, String(v || ''));
  }

  function reasonCodesFor(actionType) {
    if (actionType === ACTION_TYPE.POST_RESTORE) return RESTORE_REASON_CODES.slice();
    return CONTENT_REASON_CODES.slice();
  }

  function isReasonCode(actionType, code) {
    return reasonCodesFor(actionType).indexOf(String(code || '')) !== -1;
  }

  function noteLooksUnsafe(note) {
    var text = String(note || '');
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return 'ADMIN_AUDIT_NOTE_PII_FORBIDDEN';
    if (/\b\d{6}-?\d{7}\b/.test(text)) return 'ADMIN_AUDIT_NOTE_PII_FORBIDDEN';
    if (/\b01[016789]-?\d{3,4}-?\d{4}\b/.test(text)) return 'ADMIN_AUDIT_NOTE_PII_FORBIDDEN';
    if (/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/i.test(text)) {
      return 'ADMIN_AUDIT_NOTE_SECRET_FORBIDDEN';
    }
    return null;
  }

  function normalizeNote(raw) {
    var note = trimText(raw);
    if (note.length > NOTE_MAX) {
      return { ok: false, error: 'ADMIN_AUDIT_NOTE_TOO_LONG' };
    }
    var unsafe = noteLooksUnsafe(note);
    if (unsafe) return { ok: false, error: unsafe };
    return { ok: true, note: note };
  }

  function optionalUuid(v, emptyOk) {
    if (v == null || v === '') return emptyOk ? { ok: true, value: null } : { ok: false, error: 'ADMIN_AUDIT_UUID_REQUIRED' };
    var s = trimText(v);
    if (!s) return emptyOk ? { ok: true, value: null } : { ok: false, error: 'ADMIN_AUDIT_UUID_REQUIRED' };
    if (!isUuid(s)) return { ok: false, error: 'ADMIN_AUDIT_UUID_INVALID' };
    return { ok: true, value: s };
  }

  function normalizeWrite(input) {
    var src = input || {};
    var actionType = trimText(src.actionType || src.action_type).toUpperCase();
    if (actionType === 'POST_SOFT_DELETE' || actionType === 'POST_RESTORE' || actionType === 'SANCTION_APPLIED') {
      /* keep */
    } else {
      actionType = trimText(src.actionType || src.action_type);
    }
    if (!isActionType(actionType)) {
      return { ok: false, error: 'ADMIN_AUDIT_ACTION_TYPE_INVALID' };
    }

    var targetType = trimText(src.targetType || src.target_type).toUpperCase();
    if (!isTargetType(targetType)) {
      return { ok: false, error: 'ADMIN_AUDIT_TARGET_TYPE_INVALID' };
    }
    if (actionType === ACTION_TYPE.POST_SOFT_DELETE || actionType === ACTION_TYPE.POST_RESTORE) {
      if (targetType !== TARGET_TYPE.POST) {
        return { ok: false, error: 'ADMIN_AUDIT_TARGET_TYPE_INVALID' };
      }
    }

    var actor = optionalUuid(src.actorUserId || src.actor_user_id, false);
    if (!actor.ok) return { ok: false, error: 'ADMIN_AUDIT_ACTOR_REQUIRED' };

    var targetId = optionalUuid(src.targetId || src.target_id, false);
    if (!targetId.ok) return { ok: false, error: 'ADMIN_AUDIT_TARGET_ID_INVALID' };

    var targetUser = optionalUuid(src.targetUserId || src.target_user_id, true);
    if (!targetUser.ok) return { ok: false, error: 'ADMIN_AUDIT_TARGET_USER_INVALID' };

    var reasonCode = trimText(src.reasonCode || src.reason_code);
    if (actionType === ACTION_TYPE.POST_RESTORE) {
      reasonCode = reasonCode.toUpperCase();
    }
    if (!isReasonCode(actionType, reasonCode)) {
      return { ok: false, error: 'ADMIN_AUDIT_REASON_CODE_INVALID' };
    }

    var notePack = normalizeNote(src.operatorNote || src.operator_note);
    if (!notePack.ok) return notePack;

    if (reasonCode === 'other' || reasonCode === 'OTHER') {
      if (!notePack.note) return { ok: false, error: 'ADMIN_AUDIT_NOTE_REQUIRED' };
    }
    if (actionType === ACTION_TYPE.POST_RESTORE && !reasonCode && !notePack.note) {
      return { ok: false, error: 'ADMIN_AUDIT_RESTORE_REASON_REQUIRED' };
    }

    var sanction = optionalUuid(src.sanctionId || src.sanction_id, true);
    if (!sanction.ok) return { ok: false, error: 'ADMIN_AUDIT_SANCTION_ID_INVALID' };
    var report = optionalUuid(src.reportId || src.report_id, true);
    if (!report.ok) return { ok: false, error: 'ADMIN_AUDIT_REPORT_ID_INVALID' };

    return {
      ok: true,
      event: {
        actorUserId: actor.value,
        actionType: actionType,
        targetType: targetType,
        targetId: targetId.value,
        targetUserId: targetUser.value,
        reasonCode: reasonCode,
        operatorNote: notePack.note,
        sanctionId: sanction.value,
        reportId: report.value,
      },
    };
  }

  function parseIso(v) {
    if (v == null || v === '') return null;
    var s = trimText(v);
    if (!s) return null;
    var t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    return new Date(t).toISOString();
  }

  function parseLimit(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
  }

  function encodeCursor(createdAt, id) {
    if (!createdAt || !id) return null;
    return Buffer.from(String(createdAt) + '|' + String(id), 'utf8').toString('base64url');
  }

  function decodeCursor(raw) {
    var s = trimText(raw);
    if (!s) return null;
    try {
      var decoded = Buffer.from(s, 'base64url').toString('utf8');
      var idx = decoded.indexOf('|');
      if (idx < 1) return null;
      var createdAt = decoded.slice(0, idx);
      var id = decoded.slice(idx + 1);
      if (!createdAt || !id) return null;
      return { createdAt: createdAt, id: id };
    } catch (_) {
      return null;
    }
  }

  function normalizeListQuery(input) {
    var src = input || {};
    var from = parseIso(src.from);
    var to = parseIso(src.to);
    if (src.from && !from) return { ok: false, error: 'ADMIN_AUDIT_FROM_INVALID' };
    if (src.to && !to) return { ok: false, error: 'ADMIN_AUDIT_TO_INVALID' };

    var actionType = trimText(src.actionType || src.action_type);
    if (actionType && !isActionType(actionType)) {
      return { ok: false, error: 'ADMIN_AUDIT_ACTION_TYPE_INVALID' };
    }
    var targetType = trimText(src.targetType || src.target_type).toUpperCase();
    if (targetType && !isTargetType(targetType)) {
      return { ok: false, error: 'ADMIN_AUDIT_TARGET_TYPE_INVALID' };
    }

    var actor = optionalUuid(src.actorUserId || src.actor_user_id || src.actor, true);
    if (!actor.ok) return { ok: false, error: 'ADMIN_AUDIT_ACTOR_INVALID' };
    var targetId = optionalUuid(src.targetId || src.target_id, true);
    if (!targetId.ok) return { ok: false, error: 'ADMIN_AUDIT_TARGET_ID_INVALID' };
    var targetUser = optionalUuid(src.targetUserId || src.target_user_id, true);
    if (!targetUser.ok) return { ok: false, error: 'ADMIN_AUDIT_TARGET_USER_INVALID' };
    var sanction = optionalUuid(src.sanctionId || src.sanction_id, true);
    if (!sanction.ok) return { ok: false, error: 'ADMIN_AUDIT_SANCTION_ID_INVALID' };
    var report = optionalUuid(src.reportId || src.report_id, true);
    if (!report.ok) return { ok: false, error: 'ADMIN_AUDIT_REPORT_ID_INVALID' };

    var reasonCode = trimText(src.reasonCode || src.reason_code);
    var note = trimText(src.operatorNote || src.operator_note || src.q || src.note);
    if (note.length > NOTE_MAX) return { ok: false, error: 'ADMIN_AUDIT_NOTE_TOO_LONG' };

    var cursor = null;
    if (src.cursor) {
      cursor = decodeCursor(src.cursor);
      if (!cursor) return { ok: false, error: 'ADMIN_AUDIT_CURSOR_INVALID' };
    }

    return {
      ok: true,
      query: {
        from: from,
        to: to,
        actorUserId: actor.value,
        actionType: actionType || null,
        targetType: targetType || null,
        targetId: targetId.value,
        targetUserId: targetUser.value,
        reasonCode: reasonCode || null,
        sanctionId: sanction.value,
        reportId: report.value,
        noteKeyword: note || null,
        limit: parseLimit(src.limit),
        cursor: cursor,
      },
    };
  }

  function publicEvent(row, names) {
    if (!row) return null;
    var map = names || {};
    return {
      id: row.id,
      actorUserId: row.actorUserId || row.actor_user_id || null,
      actorDisplayName: map[row.actorUserId || row.actor_user_id] || null,
      actionType: row.actionType || row.action_type,
      targetType: row.targetType || row.target_type,
      targetId: row.targetId || row.target_id,
      targetUserId: row.targetUserId || row.target_user_id || null,
      targetDisplayName: map[row.targetUserId || row.target_user_id] || null,
      reasonCode: row.reasonCode || row.reason_code,
      operatorNote: row.operatorNote != null ? row.operatorNote : row.operator_note || '',
      sanctionId: row.sanctionId || row.sanction_id || null,
      reportId: row.reportId || row.report_id || null,
      createdAt: row.createdAt || row.created_at,
    };
  }

  function eventMatches(row, query) {
    var q = query || {};
    var createdAt = row.createdAt || row.created_at;
    if (q.from && createdAt < q.from) return false;
    if (q.to && createdAt > q.to) return false;
    if (q.actorUserId && String(row.actorUserId || row.actor_user_id) !== q.actorUserId) return false;
    if (q.actionType && String(row.actionType || row.action_type) !== q.actionType) return false;
    if (q.targetType && String(row.targetType || row.target_type) !== q.targetType) return false;
    if (q.targetId && String(row.targetId || row.target_id) !== q.targetId) return false;
    if (q.targetUserId && String(row.targetUserId || row.target_user_id) !== q.targetUserId) return false;
    if (q.reasonCode && String(row.reasonCode || row.reason_code) !== q.reasonCode) return false;
    if (q.sanctionId && String(row.sanctionId || row.sanction_id) !== q.sanctionId) return false;
    if (q.reportId && String(row.reportId || row.report_id) !== q.reportId) return false;
    if (q.noteKeyword) {
      var note = String(row.operatorNote != null ? row.operatorNote : row.operator_note || '');
      if (note.toLowerCase().indexOf(q.noteKeyword.toLowerCase()) === -1) return false;
    }
    if (q.cursor) {
      if (createdAt > q.cursor.createdAt) return false;
      if (createdAt === q.cursor.createdAt && String(row.id) >= String(q.cursor.id)) return false;
    }
    return true;
  }

  return {
    ACTION_TYPE: ACTION_TYPE,
    TARGET_TYPE: TARGET_TYPE,
    CONTENT_REASON_CODES: CONTENT_REASON_CODES,
    RESTORE_REASON_CODES: RESTORE_REASON_CODES,
    NOTE_MAX: NOTE_MAX,
    DEFAULT_LIMIT: DEFAULT_LIMIT,
    MAX_LIMIT: MAX_LIMIT,
    isUuid: isUuid,
    trimText: trimText,
    isActionType: isActionType,
    isTargetType: isTargetType,
    reasonCodesFor: reasonCodesFor,
    isReasonCode: isReasonCode,
    normalizeNote: normalizeNote,
    normalizeWrite: normalizeWrite,
    normalizeListQuery: normalizeListQuery,
    encodeCursor: encodeCursor,
    decodeCursor: decodeCursor,
    publicEvent: publicEvent,
    eventMatches: eventMatches,
  };
});
