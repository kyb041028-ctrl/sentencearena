'use strict';

const express = require('express');
const { createAdminAccessGuard, sendAdminAuthFailure } = require('./daily-issue-admin-auth');
const { isUnavailableDbError } = require('./admin-db-errors');
const hub = require('../shared/admin-hub-core');

const INTAKE = Object.freeze({
  enabled: false,
  reason: 'POLICY_PENDING',
  note: '접수 보관기간 정책이 확정되지 않아 회원 접수는 열려 있지 않습니다.',
});

const INTAKE_ON = Object.freeze({
  enabled: true,
  reason: null,
  note: '로그인한 회원만 접수할 수 있습니다. 비회원 접수와 첨부파일은 받지 않습니다.',
});

function intakeInfo(opts) {
  return opts && opts.intakeEnabled === true ? INTAKE_ON : INTAKE;
}

function likePattern(q) {
  return '%' + String(q).replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%';
}

function fail(res, status, code) {
  return res.status(status).json({ ok: false, error: { code: code, message: code } });
}

function mountAdminInquiriesRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  router.use(createAdminAccessGuard(opts.adminAuth || {}));

  function unavailable(res) {
    return res.json({ ok: true, available: false, status: 'NOT_CONFIRMED', intake: intakeInfo(opts), items: [], total: null });
  }

  router.get('/', async function (req, res) {
    try {
      if (typeof opts.query !== 'function') return unavailable(res);
      const paging = hub.parsePaging(req.query);
      const params = [];
      const where = [];
      const kind = String(req.query.kind || '').toUpperCase();
      const status = String(req.query.status || '').toUpperCase();
      const q = String(req.query.q || '').trim().slice(0, 100);
      if (kind) {
        if (hub.INQUIRY_KINDS.indexOf(kind) < 0) return fail(res, 400, 'INQUIRY_KIND_INVALID');
        params.push(kind);
        where.push('kind = $' + params.length);
      }
      if (status) {
        if (hub.INQUIRY_STATUSES.indexOf(status) < 0) return fail(res, 400, 'INQUIRY_STATUS_INVALID');
        params.push(status);
        where.push('status = $' + params.length);
      }
      if (q) {
        params.push(likePattern(q));
        where.push("(title ILIKE $" + params.length + " ESCAPE '\\' OR body ILIKE $" + params.length + " ESCAPE '\\')");
      }
      const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
      let rows;
      let total;
      try {
        rows = await opts.query(
          'SELECT id, kind, title, status, internal_note, created_at, updated_at FROM public.admin_inquiries' + whereSql +
            ' ORDER BY created_at DESC, id LIMIT ' + paging.pageSize + ' OFFSET ' + paging.offset,
          params,
        );
        total = await opts.query('SELECT COUNT(*)::int AS n FROM public.admin_inquiries' + whereSql, params);
      } catch (e) {
        if (isUnavailableDbError(e)) return unavailable(res);
        throw e;
      }
      return res.json({
        ok: true,
        available: true,
        intake: intakeInfo(opts),
        items: rows.rows.map(function (r) { return hub.serializeInquiry(r, false); }),
        page: paging.page,
        pageSize: paging.pageSize,
        total: Number(total.rows[0].n),
      });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return fail(res, 500, 'INQUIRIES_LIST_FAILED');
    }
  });

  router.get('/:id', async function (req, res) {
    try {
      if (!hub.isUuid(req.params.id)) return fail(res, 400, 'INQUIRY_ID_INVALID');
      if (typeof opts.query !== 'function') return unavailable(res);
      let found;
      let events;
      try {
        found = await opts.query(
          'SELECT id, kind, title, body, status, internal_note, created_at, updated_at FROM public.admin_inquiries WHERE id = $1::uuid',
          [req.params.id],
        );
        events = await opts.query(
          'SELECT event_type, from_status, to_status, created_at FROM public.admin_inquiry_events WHERE inquiry_id = $1::uuid ORDER BY created_at DESC LIMIT 50',
          [req.params.id],
        );
      } catch (e) {
        if (isUnavailableDbError(e)) return unavailable(res);
        throw e;
      }
      if (!found.rows.length) return fail(res, 404, 'INQUIRY_NOT_FOUND');
      return res.json({
        ok: true,
        inquiry: hub.serializeInquiry(found.rows[0], true),
        events: events.rows.map(function (r) {
          return { type: r.event_type, from: r.from_status, to: r.to_status, at: new Date(r.created_at).toISOString() };
        }),
      });
    } catch (e) {
      return fail(res, 500, 'INQUIRY_DETAIL_FAILED');
    }
  });

  router.patch('/:id', async function (req, res) {
    try {
      if (!hub.isUuid(req.params.id)) return fail(res, 400, 'INQUIRY_ID_INVALID');
      const body = req.body || {};
      const hasStatus = body.status != null;
      const hasNote = body.internalNote != null;
      if (!hasStatus && !hasNote) return fail(res, 400, 'INQUIRY_NOTHING_TO_UPDATE');
      const status = hasStatus ? String(body.status).toUpperCase() : null;
      if (hasStatus && hub.INQUIRY_STATUSES.indexOf(status) < 0) return fail(res, 400, 'INQUIRY_STATUS_INVALID');
      const note = hasNote ? String(body.internalNote) : null;
      if (hasNote && note.length > hub.INTERNAL_NOTE_MAX) return fail(res, 400, 'INQUIRY_NOTE_TOO_LONG');
      if (typeof opts.query !== 'function') return fail(res, 503, 'INQUIRY_STORE_NOT_AVAILABLE');
      const actor = (req.dailyIssueAdmin && req.dailyIssueAdmin.userId) || null;
      let out;
      try {
        out = await opts.query(
          'WITH old AS (SELECT id, status, internal_note FROM public.admin_inquiries WHERE id = $1::uuid FOR UPDATE), ' +
            'upd AS (UPDATE public.admin_inquiries i SET status = COALESCE($2::text, i.status), ' +
            'internal_note = CASE WHEN $3::boolean THEN $4::text ELSE i.internal_note END, updated_at = now(), updated_by = $5::uuid ' +
            'FROM old WHERE i.id = old.id RETURNING i.*), ' +
            "ev1 AS (INSERT INTO public.admin_inquiry_events (inquiry_id, actor_user_id, event_type, from_status, to_status) " +
            "SELECT old.id, $5::uuid, 'STATUS_CHANGED', old.status, upd.status FROM old, upd WHERE old.status IS DISTINCT FROM upd.status RETURNING 1), " +
            "ev2 AS (INSERT INTO public.admin_inquiry_events (inquiry_id, actor_user_id, event_type) " +
            "SELECT old.id, $5::uuid, 'NOTE_UPDATED' FROM old, upd WHERE $3::boolean AND old.internal_note IS DISTINCT FROM upd.internal_note RETURNING 1) " +
            'SELECT upd.id, upd.kind, upd.title, upd.body, upd.status, upd.internal_note, upd.created_at, upd.updated_at FROM upd',
          [req.params.id, status, hasNote, note, actor],
        );
      } catch (e) {
        if (isUnavailableDbError(e)) return fail(res, 503, 'INQUIRY_STORE_NOT_AVAILABLE');
        throw e;
      }
      if (!out.rows.length) return fail(res, 404, 'INQUIRY_NOT_FOUND');
      return res.json({ ok: true, inquiry: hub.serializeInquiry(out.rows[0], true) });
    } catch (e) {
      return fail(res, 500, 'INQUIRY_UPDATE_FAILED');
    }
  });

  return router;
}

module.exports = { mountAdminInquiriesRoutes: mountAdminInquiriesRoutes, INTAKE: INTAKE, intakeInfo: intakeInfo };
