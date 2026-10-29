'use strict';

const express = require('express');
const { createAdminAccessGuard, sendAdminAuthFailure } = require('./daily-issue-admin-auth');
const { isUnavailableDbError } = require('./admin-db-errors');
const hub = require('../shared/admin-hub-core');

const NOTICE_TYPES = Object.freeze(['GENERAL', 'MAINTENANCE', 'INCIDENT', 'UPDATE']);
const TITLE_MAX = 200;
const BODY_MAX = 4000;

const STATE_SQL =
  "CASE WHEN ends_at IS NOT NULL AND ends_at <= now() THEN 'ENDED' WHEN NOT is_public THEN 'PRIVATE' " +
  "WHEN starts_at IS NOT NULL AND starts_at > now() THEN 'SCHEDULED' ELSE 'LIVE' END";
const COLS = 'id, notice_type, title, body, is_public, starts_at, ends_at, created_at, updated_at, ' + STATE_SQL + ' AS state';

function fail(res, status, code) {
  return res.status(status).json({ ok: false, error: { code: code, message: code } });
}

function iso(v) {
  return v ? new Date(v).toISOString() : null;
}

function serializeNotice(r) {
  return {
    id: r.id,
    type: r.notice_type,
    title: r.title,
    body: r.body,
    isPublic: r.is_public === true,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    state: r.state,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function parseTime(v) {
  if (v === null || v === '') return { set: true, value: null };
  const t = Date.parse(String(v));
  if (!isFinite(t)) return { error: true };
  return { set: true, value: new Date(t).toISOString() };
}

function mountAdminNoticesRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  router.use(createAdminAccessGuard(opts.adminAuth || {}));

  function unavailable(res) {
    return res.json({ ok: true, available: false, status: 'NOT_CONFIRMED', items: [] });
  }

  router.get('/', async function (req, res) {
    try {
      if (typeof opts.query !== 'function') return unavailable(res);
      const params = [];
      let where = '';
      const state = String(req.query.state || '').toUpperCase();
      if (state) {
        if (['PRIVATE', 'SCHEDULED', 'LIVE', 'ENDED'].indexOf(state) < 0) return fail(res, 400, 'NOTICE_STATE_INVALID');
        where = ' WHERE (' + STATE_SQL + ') = $1';
        params.push(state);
      }
      let rows;
      try {
        rows = await opts.query('SELECT ' + COLS + ' FROM public.admin_notices' + where + ' ORDER BY created_at DESC, id LIMIT 100', params);
      } catch (e) {
        if (isUnavailableDbError(e)) return unavailable(res);
        throw e;
      }
      return res.json({ ok: true, available: true, items: rows.rows.map(serializeNotice) });
    } catch (e) {
      return fail(res, 500, 'NOTICES_LIST_FAILED');
    }
  });

  router.get('/:id', async function (req, res) {
    try {
      if (!hub.isUuid(req.params.id)) return fail(res, 400, 'NOTICE_ID_INVALID');
      if (typeof opts.query !== 'function') return unavailable(res);
      let found;
      let events;
      try {
        found = await opts.query('SELECT ' + COLS + ' FROM public.admin_notices WHERE id = $1::uuid', [req.params.id]);
        events = await opts.query(
          'SELECT event_type, from_public, to_public, created_at FROM public.admin_notice_events WHERE notice_id = $1::uuid ORDER BY created_at DESC, id LIMIT 50',
          [req.params.id],
        );
      } catch (e) {
        if (isUnavailableDbError(e)) return unavailable(res);
        throw e;
      }
      if (!found.rows.length) return fail(res, 404, 'NOTICE_NOT_FOUND');
      return res.json({
        ok: true,
        notice: serializeNotice(found.rows[0]),
        events: events.rows.map(function (r) {
          return { type: r.event_type, fromPublic: r.from_public, toPublic: r.to_public, at: iso(r.created_at) };
        }),
      });
    } catch (e) {
      return fail(res, 500, 'NOTICE_DETAIL_FAILED');
    }
  });

  router.post('/', async function (req, res) {
    try {
      const b = req.body || {};
      const type = String(b.type || 'GENERAL').toUpperCase();
      if (NOTICE_TYPES.indexOf(type) < 0) return fail(res, 400, 'NOTICE_TYPE_INVALID');
      const title = String(b.title == null ? '' : b.title).trim();
      const body = String(b.body == null ? '' : b.body);
      if (!title || title.length > TITLE_MAX) return fail(res, 400, 'NOTICE_TITLE_INVALID');
      if (body.length > BODY_MAX) return fail(res, 400, 'NOTICE_BODY_INVALID');
      const startsAt = b.startsAt == null ? { value: null } : parseTime(b.startsAt);
      const endsAt = b.endsAt == null ? { value: null } : parseTime(b.endsAt);
      if (startsAt.error || endsAt.error) return fail(res, 400, 'NOTICE_PERIOD_INVALID');
      if (startsAt.value && endsAt.value && Date.parse(endsAt.value) <= Date.parse(startsAt.value)) return fail(res, 400, 'NOTICE_PERIOD_INVALID');
      if (typeof opts.query !== 'function') return fail(res, 503, 'NOTICE_STORE_NOT_AVAILABLE');
      const actor = (req.dailyIssueAdmin && req.dailyIssueAdmin.userId) || null;
      let out;
      try {
        out = await opts.query(
          'WITH ins AS (INSERT INTO public.admin_notices (notice_type, title, body, is_public, starts_at, ends_at, created_by, updated_by) ' +
            'VALUES ($1, $2, $3, $4::boolean, $5::timestamptz, $6::timestamptz, $7::uuid, $7::uuid) RETURNING *), ' +
            "ev AS (INSERT INTO public.admin_notice_events (notice_id, actor_user_id, event_type, to_public) SELECT id, $7::uuid, 'CREATED', is_public FROM ins RETURNING 1) " +
            'SELECT ' + COLS + ' FROM ins',
          [type, title, body, b.isPublic === true, startsAt.value, endsAt.value, actor],
        );
      } catch (e) {
        if (isUnavailableDbError(e)) return fail(res, 503, 'NOTICE_STORE_NOT_AVAILABLE');
        if (e && e.code === '23514') return fail(res, 400, 'NOTICE_PERIOD_INVALID');
        throw e;
      }
      return res.status(201).json({ ok: true, notice: serializeNotice(out.rows[0]) });
    } catch (e) {
      return fail(res, 500, 'NOTICE_CREATE_FAILED');
    }
  });

  router.patch('/:id', async function (req, res) {
    try {
      if (!hub.isUuid(req.params.id)) return fail(res, 400, 'NOTICE_ID_INVALID');
      const b = req.body || {};
      const endNow = b.endNow === true;
      let type = null;
      if (b.type != null) {
        type = String(b.type).toUpperCase();
        if (NOTICE_TYPES.indexOf(type) < 0) return fail(res, 400, 'NOTICE_TYPE_INVALID');
      }
      let title = null;
      if (b.title != null) {
        title = String(b.title).trim();
        if (!title || title.length > TITLE_MAX) return fail(res, 400, 'NOTICE_TITLE_INVALID');
      }
      let body = null;
      if (b.body != null) {
        body = String(b.body);
        if (body.length > BODY_MAX) return fail(res, 400, 'NOTICE_BODY_INVALID');
      }
      if (b.isPublic != null && typeof b.isPublic !== 'boolean') return fail(res, 400, 'NOTICE_VISIBILITY_INVALID');
      const hasStart = Object.prototype.hasOwnProperty.call(b, 'startsAt');
      const hasEnd = Object.prototype.hasOwnProperty.call(b, 'endsAt');
      const startsAt = hasStart ? parseTime(b.startsAt) : { value: null };
      const endsAt = hasEnd ? parseTime(b.endsAt) : { value: null };
      if (startsAt.error || endsAt.error) return fail(res, 400, 'NOTICE_PERIOD_INVALID');
      if (hasStart && hasEnd && startsAt.value && endsAt.value && Date.parse(endsAt.value) <= Date.parse(startsAt.value)) {
        return fail(res, 400, 'NOTICE_PERIOD_INVALID');
      }
      const anyField = type != null || title != null || body != null || b.isPublic != null || hasStart || hasEnd;
      if (endNow && anyField) return fail(res, 400, 'NOTICE_END_ALONE');
      if (!endNow && !anyField) return fail(res, 400, 'NOTICE_NOTHING_TO_UPDATE');
      if (typeof opts.query !== 'function') return fail(res, 503, 'NOTICE_STORE_NOT_AVAILABLE');
      const actor = (req.dailyIssueAdmin && req.dailyIssueAdmin.userId) || null;
      let out;
      try {
        out = await opts.query(
          'WITH old AS (SELECT * FROM public.admin_notices WHERE id = $1::uuid FOR UPDATE), ' +
            'upd AS (UPDATE public.admin_notices n SET notice_type = COALESCE($2::text, n.notice_type), title = COALESCE($3::text, n.title), ' +
            'body = COALESCE($4::text, n.body), is_public = COALESCE($5::boolean, n.is_public), ' +
            'starts_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE n.starts_at END, ' +
            'ends_at = CASE WHEN $10::boolean THEN now() WHEN $8::boolean THEN $9::timestamptz ELSE n.ends_at END, ' +
            'updated_at = now(), updated_by = $11::uuid FROM old WHERE n.id = old.id RETURNING n.*), ' +
            "ev_upd AS (INSERT INTO public.admin_notice_events (notice_id, actor_user_id, event_type) SELECT old.id, $11::uuid, 'UPDATED' FROM old, upd " +
            'WHERE NOT $10::boolean AND (old.notice_type, old.title, old.body, old.starts_at, old.ends_at) IS DISTINCT FROM (upd.notice_type, upd.title, upd.body, upd.starts_at, upd.ends_at) RETURNING 1), ' +
            "ev_vis AS (INSERT INTO public.admin_notice_events (notice_id, actor_user_id, event_type, from_public, to_public) SELECT old.id, $11::uuid, 'VISIBILITY_CHANGED', old.is_public, upd.is_public FROM old, upd " +
            'WHERE old.is_public IS DISTINCT FROM upd.is_public RETURNING 1), ' +
            "ev_end AS (INSERT INTO public.admin_notice_events (notice_id, actor_user_id, event_type) SELECT old.id, $11::uuid, 'ENDED' FROM old, upd WHERE $10::boolean RETURNING 1) " +
            'SELECT ' + COLS + ' FROM upd',
          [req.params.id, type, title, body, b.isPublic == null ? null : b.isPublic, hasStart, startsAt.value, hasEnd, endsAt.value, endNow, actor],
        );
      } catch (e) {
        if (isUnavailableDbError(e)) return fail(res, 503, 'NOTICE_STORE_NOT_AVAILABLE');
        if (e && e.code === '23514') return fail(res, 400, 'NOTICE_PERIOD_INVALID');
        throw e;
      }
      if (!out.rows.length) return fail(res, 404, 'NOTICE_NOT_FOUND');
      return res.json({ ok: true, notice: serializeNotice(out.rows[0]) });
    } catch (e) {
      if (sendAdminAuthFailure(res, e && e.code)) return;
      return fail(res, 500, 'NOTICE_UPDATE_FAILED');
    }
  });

  return router;
}

function mountPublicNoticesRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  router.get('/current', async function (req, res) {
    res.set('Cache-Control', 'no-store');
    if (opts.enabled !== true) return res.json({ ok: true, enabled: false, items: [] });
    if (typeof opts.query !== 'function') return res.json({ ok: true, enabled: true, available: false, items: [] });
    try {
      const rows = await opts.query(
        'SELECT notice_type, title, body, starts_at, ends_at FROM public.admin_notices WHERE is_public ' +
          'AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()) ORDER BY COALESCE(starts_at, created_at) DESC, id LIMIT 20',
        [],
      );
      return res.json({
        ok: true,
        enabled: true,
        available: true,
        items: rows.rows.map(function (r) {
          return { type: r.notice_type, title: r.title, body: r.body, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at) };
        }),
      });
    } catch (e) {
      if (isUnavailableDbError(e)) return res.json({ ok: true, enabled: true, available: false, items: [] });
      return fail(res, 500, 'NOTICES_CURRENT_FAILED');
    }
  });
  return router;
}

module.exports = {
  mountAdminNoticesRoutes: mountAdminNoticesRoutes,
  mountPublicNoticesRoutes: mountPublicNoticesRoutes,
  NOTICE_TYPES: NOTICE_TYPES,
};
