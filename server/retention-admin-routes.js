'use strict';

const express = require('express');
const { createAdminAccessGuard } = require('./daily-issue-admin-auth');
const retention = require('./retention-service');

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

function mountRetentionAdminRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  const bypass = opts.adminBypass === true;
  const guard = bypass
    ? function (_req, _res, next) { next(); }
    : createAdminAccessGuard(opts.adminAuth || {});

  router.use(guard);

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

  router.post('/legal-hold', async function (req, res) {
    try {
      const body = req.body || {};
      const hold = body.hold !== false && body.legalHold !== false;
      const result = await retention.setLegalHold({
        evidenceId: body.evidenceId || body.id,
        contentKind: body.contentKind || body.kind,
        sourceContentId: body.sourceContentId || body.sourceId,
        reportId: body.reportId,
        sanctionRecordId: body.sanctionRecordId,
      }, hold, body.reason || body.legalHoldReason || null);
      if (!result || result.ok === false) {
        return res.status(400).json({ ok: false, error: (result && result.error) || 'HOLD_FAILED' });
      }
      return res.json({ ok: true, hold: hold });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e && e.code ? e.code : 'HOLD_FAILED' });
    }
  });

  return router;
}

module.exports = {
  mountRetentionAdminRoutes,
};
