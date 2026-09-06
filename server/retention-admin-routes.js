'use strict';

const express = require('express');
const { createAdminAccessGuard } = require('./daily-issue-admin-auth');
const retention = require('./retention-service');
const core = require('../shared/retention-policy-core');

function publicEvidence(row) {
  if (!row) return null;
  return {
    id: row.id,
    contentKind: row.contentKind,
    sourceContentId: row.sourceContentId,
    body: row.body,
    title: row.title,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    deleteReason: row.deleteReason,
    authorUserId: row.authorUserId,
    authorDisplayName: row.authorDisplayName,
    retentionUntil: row.retentionUntil,
    legalHold: !!row.legalHold,
    legalHoldReason: row.legalHoldReason || null,
  };
}

function statusCodeForHoldError(code) {
  const c = String(code || '');
  if (
    c === 'EVIDENCE_NOT_FOUND'
    || c === 'REPORT_NOT_FOUND'
    || c === 'SANCTION_RECORD_NOT_FOUND'
    || c === 'RIGHTS_CASE_NOT_FOUND'
    || c === 'ADMIN_AUDIT_NOT_FOUND'
  ) {
    return 404;
  }
  if (
    c === 'LEGAL_HOLD_REASON_REQUIRED'
    || c === 'LEGAL_HOLD_REASON_TOO_LONG'
    || c === 'HOLD_TARGET_TYPE_INVALID'
    || c === 'HOLD_TARGET_ID_REQUIRED'
    || c === 'HOLD_TARGET_INVALID'
  ) {
    return 400;
  }
  return 400;
}

function mountRetentionAdminRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  const bypass = opts.adminBypass === true;
  const adminGuard = bypass
    ? function (_req, _res, next) { next(); }
    : createAdminAccessGuard(opts.adminAuth || {});
  const ownerGuard = bypass
    ? function (req, _res, next) {
      req.dailyIssueAdmin = req.dailyIssueAdmin || { role: 'OWNER', userId: 'bypass-owner' };
      next();
    }
    : createAdminAccessGuard(Object.assign({}, opts.adminAuth || {}, { allowedRoles: ['OWNER'] }));

  router.use(adminGuard);

  router.get('/evidence', async function (req, res) {
    try {
      const q = req.query || {};
      const row = await retention.getEvidenceForOperator({
        id: q.id,
        contentKind: q.kind || q.contentKind,
        sourceContentId: q.sourceId || q.sourceContentId,
      });
      if (!row) return res.status(404).json({ ok: false, error: 'EVIDENCE_NOT_FOUND' });
      return res.json({ ok: true, evidence: publicEvidence(row) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.code ? e.code : 'EVIDENCE_LOOKUP_FAILED' });
    }
  });

  router.get('/legal-hold', async function (req, res) {
    try {
      const q = req.query || {};
      const result = await retention.getLegalHoldStatus({
        targetType: q.targetType || q.type,
        targetId: q.targetId || q.id,
        evidenceId: q.evidenceId,
        contentKind: q.kind || q.contentKind,
        sourceContentId: q.sourceId || q.sourceContentId,
        reportId: q.reportId,
        sanctionRecordId: q.sanctionRecordId || q.sanctionId,
        rightsCaseId: q.rightsCaseId || q.requestId,
        auditEventId: q.auditEventId || q.adminAuditId,
      });
      if (!result || result.ok === false) {
        const code = (result && result.error) || 'HOLD_STATUS_FAILED';
        return res.status(statusCodeForHoldError(code)).json({ ok: false, error: code });
      }
      return res.json({
        ok: true,
        targetType: result.targetType,
        targetId: result.targetId,
        legalHold: !!result.legalHold,
        legalHoldReason: result.legalHoldReason || null,
        retentionUntil: result.retentionUntil || null,
        releasedAt: result.releasedAt || null,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.code ? e.code : 'HOLD_STATUS_FAILED' });
    }
  });

  router.post('/legal-hold', ownerGuard, async function (req, res) {
    try {
      const body = req.body || {};
      const hold = body.hold !== false && body.legalHold !== false && body.action !== 'RELEASE'
        && body.action !== core.LEGAL_HOLD_ACTION.HOLD_RELEASE;
      const actor = req.dailyIssueAdmin || {};
      const result = await retention.setLegalHold({
        targetType: body.targetType || body.type,
        targetId: body.targetId || body.id,
        evidenceId: body.evidenceId,
        contentKind: body.contentKind || body.kind,
        sourceContentId: body.sourceContentId || body.sourceId,
        reportId: body.reportId,
        sanctionRecordId: body.sanctionRecordId || body.sanctionId,
        rightsCaseId: body.rightsCaseId || body.requestId,
        auditEventId: body.auditEventId || body.adminAuditId,
      }, hold, body.reason || body.legalHoldReason || null, {
        actorUserId: actor.userId || null,
      });
      if (!result || result.ok === false) {
        const code = (result && result.error) || 'HOLD_FAILED';
        return res.status(statusCodeForHoldError(code)).json({ ok: false, error: code });
      }
      return res.json({
        ok: true,
        hold: !!result.hold,
        legalHold: !!result.legalHold,
        idempotent: !!result.idempotent,
        targetType: result.targetType,
        targetId: result.targetId,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.code ? e.code : 'HOLD_FAILED' });
    }
  });

  return router;
}

module.exports = {
  mountRetentionAdminRoutes,
};
