'use strict';

const express = require('express');
const { createAdminAccessGuard } = require('./daily-issue-admin-auth');
const { isUnavailableDbError } = require('./admin-db-errors');
const hub = require('../shared/admin-hub-core');

function flag(env, key) {
  const v = String((env && env[key]) || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

async function checkDatabase(query) {
  if (typeof query !== 'function') return { status: 'NOT_CONFIRMED', note: 'DB 연결 설정이 없어 확인하지 못했습니다.' };
  try {
    await query('SELECT 1 AS ok', []);
    return { status: 'OK', note: null };
  } catch (e) {
    if (isUnavailableDbError(e) && e.code === 'DB_UNAVAILABLE') return { status: 'NOT_CONFIRMED', note: 'DB 연결 설정이 없어 확인하지 못했습니다.' };
    return { status: 'FAIL', note: 'DB 조회에 실패했습니다.' };
  }
}

async function lastAlignmentBatch(query) {
  if (typeof query !== 'function') return { status: 'NOT_CONFIRMED', value: null };
  try {
    const res = await query(
      'SELECT batch_id, status, scheduled_at, completed_at, processed_at FROM public.alignment_batches ORDER BY processed_at DESC LIMIT 1',
      [],
    );
    const row = res && res.rows && res.rows[0];
    if (!row) return { status: 'NO_RECORD', value: null };
    return {
      status: 'OK',
      value: {
        batchId: row.batch_id,
        batchStatus: row.status,
        scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
        processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null,
      },
    };
  } catch (e) {
    if (isUnavailableDbError(e)) return { status: 'NOT_CONFIRMED', value: null };
    throw e;
  }
}

async function buildSystemStatus(opts, viewer) {
  const env = opts.env || process.env;
  const nowIso = opts.now || new Date().toISOString();
  const runtime = typeof opts.getSchedulerRuntime === 'function' ? opts.getSchedulerRuntime() : null;
  const database = await checkDatabase(opts.query);
  let alignmentLast;
  try {
    alignmentLast = await lastAlignmentBatch(opts.query);
  } catch (_) {
    alignmentLast = { status: 'NOT_CONFIRMED', value: null };
  }
  return {
    ok: true,
    asOf: nowIso,
    viewer: { role: viewer && viewer.role ? String(viewer.role) : null },
    server: {
      status: 'OK',
      uptimeSeconds: Math.round(process.uptime()),
      nodeEnv: String(env.NODE_ENV || '').trim() || null,
    },
    database: database,
    apiErrors: opts.errorLog ? opts.errorLog.snapshot(20) : { scope: 'NOT_CONNECTED', items: [] },
    apiErrorsPersisted: opts.errorStore ? await opts.errorStore.list(20) : { status: 'NOT_COLLECTED', enabled: false, items: [] },
    login: {
      serverAuthConfigured: Boolean(opts.authConfigured),
      serviceClientConfigured: Boolean(opts.serviceClientConfigured),
      providers: { status: 'NOT_CONFIRMED', note: 'Google·Kakao·Naver 설정은 Supabase 콘솔에 있어 이 화면에서 확인하지 않습니다.' },
    },
    visitCollection: { enabled: opts.visitCollectionEnabled === true, toggle: 'NONE' },
    schedulers: {
      timezone: hub.TIME_ZONE,
      alignment: {
        policyEnabled: flag(env, 'POLITICAL_ALIGNMENT_SCHEDULER_ENABLED'),
        runningInThisProcess: runtime ? Boolean(runtime.alignment) : null,
        slots: ['05:00', '17:00'],
        nextSlotAt: hub.nextAlignmentSlot(nowIso),
        lastBatch: alignmentLast,
      },
      dailyIssueMorning: {
        policyEnabled: flag(env, 'DAILY_ISSUE_MORNING_SCHEDULER_ENABLED'),
        autoPublishEnabled: flag(env, 'DAILY_ISSUE_MORNING_AUTO_PUBLISH'),
        runningInThisProcess: runtime ? Boolean(runtime.morning) : null,
        detail: 'Daily Issue 수집·검토·발행 기록은 기존 /api/admin/daily-issues/morning/status 에서 읽습니다.',
      },
    },
  };
}

function mountAdminSystemRoutes(options) {
  const opts = options || {};
  const router = express.Router();
  router.use(createAdminAccessGuard(opts.adminAuth || {}));

  router.get('/status', async function (req, res) {
    try {
      return res.json(await buildSystemStatus(opts, req.dailyIssueAdmin));
    } catch (e) {
      return res.status(500).json({ ok: false, error: { code: 'SYSTEM_STATUS_FAILED', message: 'System status failed' } });
    }
  });

  router.patch('/errors/:id', async function (req, res) {
    try {
      if (!hub.isUuid(req.params.id)) return res.status(400).json({ ok: false, error: { code: 'ERROR_ID_INVALID', message: 'ERROR_ID_INVALID' } });
      if (!opts.errorStore) return res.status(503).json({ ok: false, error: { code: 'ERROR_STORE_NOT_AVAILABLE', message: 'ERROR_STORE_NOT_AVAILABLE' } });
      const out = await opts.errorStore.setHandling(req.params.id, String((req.body && req.body.handling) || '').toUpperCase());
      if (out.ok) return res.json({ ok: true });
      const status = out.code === 'ERROR_HANDLING_INVALID' ? 400 : out.code === 'ERROR_RECORD_NOT_FOUND' ? 404 : 503;
      return res.status(status).json({ ok: false, error: { code: out.code, message: out.code } });
    } catch (e) {
      return res.status(500).json({ ok: false, error: { code: 'ERROR_UPDATE_FAILED', message: 'ERROR_UPDATE_FAILED' } });
    }
  });

  return router;
}

module.exports = { mountAdminSystemRoutes: mountAdminSystemRoutes, buildSystemStatus: buildSystemStatus };
