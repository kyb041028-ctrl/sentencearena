'use strict';

const crypto = require('crypto');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { extractBearer } = require('./daily-issue-admin-auth');
const { isUnavailableDbError } = require('./admin-db-errors');
const hub = require('../shared/admin-hub-core');

const TITLE_MAX = 200;
const BODY_MAX = 4000;
const HOURLY_LIMIT = 5;

function fail(res, status, code) {
  return res.status(status).json({ ok: false, error: { code: code, message: code } });
}

function normalizeText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function contentHash(kind, title, body) {
  return crypto.createHash('sha256').update(kind + '\n' + normalizeText(title) + '\n' + normalizeText(body)).digest('hex');
}

function serializeMemberInquiry(row, withBody) {
  const out = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
  if (withBody) out.body = row.body;
  return out;
}

function createMemberGuard(options) {
  const opt = options || {};
  const inject = typeof opt.getUserFromAccessToken === 'function' ? opt.getUserFromAccessToken : null;
  return async function memberGuard(req, res, next) {
    try {
      if (req.query && (req.query.token != null || req.query.access_token != null)) {
        return fail(res, 403, 'QUERY_TOKEN_FORBIDDEN');
      }
      const token = extractBearer(req);
      if (!token) return fail(res, 401, 'UNAUTHORIZED');
      let user = null;
      if (inject) {
        user = await inject(token, req);
      } else {
        if (!opt.supabaseUrl || !opt.supabaseAnonKey) return fail(res, 401, 'UNAUTHORIZED');
        const client = createClient(opt.supabaseUrl, opt.supabaseAnonKey, {
          global: { headers: { Authorization: 'Bearer ' + token } },
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const got = await client.auth.getUser();
        user = got && got.data && got.data.user;
        if (got.error) user = null;
      }
      if (!user || !hub.isUuid(user.id)) return fail(res, 401, 'UNAUTHORIZED');
      req.inquiryMember = { userId: user.id };
      return next();
    } catch (e) {
      return fail(res, 401, 'UNAUTHORIZED');
    }
  };
}

function mountMemberInquiryRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  router.use(createMemberGuard(opts.auth || {}));

  function storeDown(res) {
    return fail(res, 503, 'INQUIRY_STORE_NOT_AVAILABLE');
  }

  router.get('/status', function (req, res) {
    res.json({ ok: true, intakeEnabled: opts.intakeEnabled === true, kinds: hub.INQUIRY_KINDS, titleMax: TITLE_MAX, bodyMax: BODY_MAX });
  });

  router.post('/', async function (req, res) {
    try {
      if (opts.intakeEnabled !== true) return fail(res, 503, 'INQUIRY_INTAKE_DISABLED');
      if (typeof opts.query !== 'function') return storeDown(res);
      const b = req.body || {};
      const kind = String(b.kind || '').toUpperCase();
      if (hub.INQUIRY_KINDS.indexOf(kind) < 0) return fail(res, 400, 'INQUIRY_KIND_INVALID');
      const title = normalizeText(b.title);
      const body = String(b.body == null ? '' : b.body).trim();
      if (!title || title.length > TITLE_MAX) return fail(res, 400, 'INQUIRY_TITLE_INVALID');
      if (!body || body.length > BODY_MAX) return fail(res, 400, 'INQUIRY_BODY_INVALID');
      const userId = req.inquiryMember.userId;
      let out;
      try {
        const recent = await opts.query(
          "SELECT COUNT(*)::int AS n FROM public.admin_inquiries WHERE author_user_id = $1::uuid AND created_at > now() - interval '1 hour'",
          [userId],
        );
        if (Number(recent.rows[0].n) >= HOURLY_LIMIT) return fail(res, 429, 'INQUIRY_RATE_LIMITED');
        out = await opts.query(
          'INSERT INTO public.admin_inquiries (kind, title, body, author_user_id, content_hash) VALUES ($1, $2, $3, $4::uuid, $5) ' +
            'ON CONFLICT DO NOTHING RETURNING id, kind, title, status, created_at, updated_at',
          [kind, title, body, userId, contentHash(kind, title, body)],
        );
      } catch (e) {
        if (isUnavailableDbError(e)) return storeDown(res);
        throw e;
      }
      if (!out.rows.length) return fail(res, 409, 'INQUIRY_DUPLICATE');
      return res.status(201).json({ ok: true, inquiry: serializeMemberInquiry(out.rows[0], false) });
    } catch (e) {
      return fail(res, 500, 'INQUIRY_CREATE_FAILED');
    }
  });

  router.get('/mine', async function (req, res) {
    try {
      if (typeof opts.query !== 'function') return storeDown(res);
      const paging = hub.parsePaging(req.query);
      let rows;
      try {
        rows = await opts.query(
          'SELECT id, kind, title, status, created_at, updated_at FROM public.admin_inquiries WHERE author_user_id = $1::uuid ' +
            'ORDER BY created_at DESC, id LIMIT ' + paging.pageSize + ' OFFSET ' + paging.offset,
          [req.inquiryMember.userId],
        );
      } catch (e) {
        if (isUnavailableDbError(e)) return storeDown(res);
        throw e;
      }
      return res.json({ ok: true, page: paging.page, pageSize: paging.pageSize, items: rows.rows.map(function (r) { return serializeMemberInquiry(r, false); }) });
    } catch (e) {
      return fail(res, 500, 'INQUIRY_MINE_FAILED');
    }
  });

  router.get('/mine/:id', async function (req, res) {
    try {
      if (!hub.isUuid(req.params.id)) return fail(res, 400, 'INQUIRY_ID_INVALID');
      if (typeof opts.query !== 'function') return storeDown(res);
      let found;
      try {
        found = await opts.query(
          'SELECT id, kind, title, body, status, created_at, updated_at FROM public.admin_inquiries WHERE id = $1::uuid AND author_user_id = $2::uuid',
          [req.params.id, req.inquiryMember.userId],
        );
      } catch (e) {
        if (isUnavailableDbError(e)) return storeDown(res);
        throw e;
      }
      if (!found.rows.length) return fail(res, 404, 'INQUIRY_NOT_FOUND');
      return res.json({ ok: true, inquiry: serializeMemberInquiry(found.rows[0], true) });
    } catch (e) {
      return fail(res, 500, 'INQUIRY_MINE_FAILED');
    }
  });

  return router;
}

module.exports = { mountMemberInquiryRoutes: mountMemberInquiryRoutes, contentHash: contentHash, HOURLY_LIMIT: HOURLY_LIMIT };
