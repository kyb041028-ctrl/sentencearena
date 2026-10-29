'use strict';

const express = require('express');
const { createAdminAccessGuard } = require('./daily-issue-admin-auth');
const { isUnavailableDbError } = require('./admin-db-errors');
const hub = require('../shared/admin-hub-core');

const TARGET_TYPES = Object.freeze(['INQUIRY', 'NOTICE']);

/**
 * 문의 처리·공지 변경 기록을 읽기 전용으로 보여 준다.
 * 기존 moderation 감사 기록(admin_moderation_audit_events)과는 다른 표·다른 성격이며 서로 섞지 않는다.
 * legal_hold 와 자동으로 연결되지 않는다.
 */
function mountAdminOpsEventsRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  router.use(createAdminAccessGuard(opts.adminAuth || {}));

  router.get('/', async function (req, res) {
    const source = {
      key: 'ADMIN_OPS_EVENTS',
      label: '문의·공지 운영 기록',
      legalHold: 'NOT_LINKED',
      note: '기존 감사(게시물·댓글·제재 조치) 기록과 다른 별도 기록입니다. 법적 보관(legal hold)과 자동 연결되지 않습니다.',
    };
    try {
      if (typeof opts.query !== 'function') {
        return res.json({ ok: true, available: false, status: 'NOT_CONFIRMED', source: source, items: [] });
      }
      const paging = hub.parsePaging(req.query);
      const params = [];
      let where = '';
      const type = String(req.query.targetType || '').toUpperCase();
      if (type) {
        if (TARGET_TYPES.indexOf(type) < 0) {
          return res.status(400).json({ ok: false, error: { code: 'OPS_EVENT_TYPE_INVALID', message: 'OPS_EVENT_TYPE_INVALID' } });
        }
        params.push(type);
        where = ' WHERE target_type = $1';
      }
      let rows;
      try {
        rows = await opts.query(
          'SELECT target_type, target_id, event_type, actor_user_id, created_at FROM public.admin_ops_events_v' + where +
            ' ORDER BY created_at DESC, target_id LIMIT ' + paging.pageSize + ' OFFSET ' + paging.offset,
          params,
        );
      } catch (e) {
        if (isUnavailableDbError(e)) {
          return res.json({ ok: true, available: false, status: 'NOT_CONFIRMED', source: source, items: [] });
        }
        throw e;
      }
      return res.json({
        ok: true,
        available: true,
        source: source,
        page: paging.page,
        pageSize: paging.pageSize,
        items: rows.rows.map(function (r) {
          return {
            targetType: r.target_type,
            targetId: r.target_id,
            eventType: r.event_type,
            actorUserId: r.actor_user_id,
            at: new Date(r.created_at).toISOString(),
          };
        }),
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: { code: 'OPS_EVENTS_FAILED', message: 'OPS_EVENTS_FAILED' } });
    }
  });

  return router;
}

module.exports = { mountAdminOpsEventsRoutes: mountAdminOpsEventsRoutes };
