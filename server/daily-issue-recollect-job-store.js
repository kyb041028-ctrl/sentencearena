'use strict';

/**
 * 데일리 이슈 예약 재취합 작업 저장소
 * — JSON 파일 또는 PostgreSQL unique run_key
 * — 메모리 타이머 금지. 서버 재시작 후 PENDING 복구.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const opsCore = require('../shared/daily-issue-ops-core');

function emptyJob(partial) {
  const p = partial || {};
  return {
    id: p.id || '',
    reviewItemId: p.reviewItemId || p.review_item_id || '',
    runKey: p.runKey || p.run_key || '',
    scheduledAt: p.scheduledAt || p.scheduled_at || null,
    createdAt: p.createdAt || p.created_at || null,
    claimedAt: p.claimedAt || p.claimed_at || null,
    finishedAt: p.finishedAt || p.finished_at || null,
    status: p.status || opsCore.JOB_STATUS.PENDING,
    delayMinutes: Number(p.delayMinutes != null ? p.delayMinutes : p.delay_minutes) || 0,
    instruction: p.instruction || '',
    originMethod: p.originMethod || p.origin_method || opsCore.ORIGIN.SCHEDULED_RECOLLECT,
    resultVersionNumber:
      p.resultVersionNumber != null
        ? Number(p.resultVersionNumber)
        : p.result_version_number != null
          ? Number(p.result_version_number)
          : null,
    errorCode: p.errorCode != null ? p.errorCode : p.error_code,
    errorSummary: p.errorSummary != null ? p.errorSummary : p.error_summary,
    meta: p.meta && typeof p.meta === 'object' ? p.meta : {},
  };
}

function rowToJob(row) {
  if (!row) return null;
  return emptyJob(row);
}

function createJsonRecollectJobStore(options) {
  const opt = options || {};
  const root = opt.reviewRoot || path.join(process.cwd(), 'data', 'daily-issue-review');
  const file = path.join(root, 'recollect-jobs.json');

  function ensureDir() {
    fs.mkdirSync(root, { recursive: true });
  }

  function load() {
    ensureDir();
    if (!fs.existsSync(file)) return { jobs: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { jobs: raw.jobs && typeof raw.jobs === 'object' ? raw.jobs : {} };
    } catch (_) {
      return { jobs: {} };
    }
  }

  function save(data) {
    ensureDir();
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  return {
    kind: 'json',
    initialize: function () {
      ensureDir();
      if (!fs.existsSync(file)) save({ jobs: {} });
      return { ok: true };
    },
    insertJob: function (partial) {
      const data = load();
      const job = emptyJob(partial);
      if (!job.id) job.id = 'job_' + crypto.randomBytes(8).toString('hex');
      if (!job.runKey) job.runKey = opsCore.recrawlRunKey(job.reviewItemId, job.scheduledAt);
      if (data.jobs[job.runKey] || Object.keys(data.jobs).some(function (k) {
        return data.jobs[k] && data.jobs[k].id === job.id;
      })) {
        return { ok: false, error: 'DUPLICATE_JOB', runKey: job.runKey };
      }
      const samePending = Object.keys(data.jobs).some(function (k) {
        const j = data.jobs[k];
        return (
          j &&
          j.reviewItemId === job.reviewItemId &&
          j.runKey === job.runKey &&
          (j.status === opsCore.JOB_STATUS.PENDING || j.status === opsCore.JOB_STATUS.RUNNING)
        );
      });
      if (samePending) return { ok: false, error: 'DUPLICATE_JOB', runKey: job.runKey };
      data.jobs[job.runKey] = job;
      save(data);
      return { ok: true, job: job };
    },
    getByRunKey: function (runKey) {
      const data = load();
      return { ok: true, job: data.jobs[runKey] || null };
    },
    getById: function (id) {
      const data = load();
      const found = Object.keys(data.jobs)
        .map(function (k) {
          return data.jobs[k];
        })
        .find(function (j) {
          return j && j.id === id;
        });
      return { ok: true, job: found || null };
    },
    listJobs: function (filters) {
      const f = filters || {};
      const data = load();
      let items = Object.keys(data.jobs).map(function (k) {
        return data.jobs[k];
      });
      if (f.reviewItemId) {
        items = items.filter(function (j) {
          return j.reviewItemId === f.reviewItemId;
        });
      }
      if (f.status) {
        items = items.filter(function (j) {
          return j.status === f.status;
        });
      }
      items.sort(function (a, b) {
        return Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '');
      });
      return { ok: true, items: items };
    },
    tryClaimJob: function (runKey, asOf) {
      const data = load();
      const job = data.jobs[runKey];
      if (!job) return { claimed: false, reason: 'NOT_FOUND' };
      if (job.status === opsCore.JOB_STATUS.RUNNING) {
        if (opsCore.jobIsStaleRunning(job, asOf)) {
          job.status = opsCore.JOB_STATUS.PENDING;
          job.claimedAt = null;
        } else {
          return { claimed: false, reason: 'ALREADY_RUNNING', job: job };
        }
      }
      if (job.status !== opsCore.JOB_STATUS.PENDING) {
        return { claimed: false, reason: 'NOT_PENDING', job: job };
      }
      job.status = opsCore.JOB_STATUS.RUNNING;
      job.claimedAt = asOf || new Date().toISOString();
      data.jobs[runKey] = job;
      save(data);
      return { claimed: true, job: job };
    },
    finishJob: function (runKey, patch) {
      const data = load();
      const job = data.jobs[runKey];
      if (!job) return { ok: false, error: 'NOT_FOUND' };
      Object.assign(job, patch || {});
      job.finishedAt = (patch && patch.finishedAt) || new Date().toISOString();
      data.jobs[runKey] = job;
      save(data);
      return { ok: true, job: job };
    },
    cancelJob: function (runKey, asOf) {
      const data = load();
      const job = data.jobs[runKey];
      if (!job) return { ok: false, error: 'NOT_FOUND' };
      if (job.status !== opsCore.JOB_STATUS.PENDING && job.status !== opsCore.JOB_STATUS.RUNNING) {
        return { ok: false, error: 'NOT_CANCELLABLE', job: job };
      }
      job.status = opsCore.JOB_STATUS.CANCELLED;
      job.finishedAt = asOf || new Date().toISOString();
      data.jobs[runKey] = job;
      save(data);
      return { ok: true, job: job };
    },
  };
}

function qIdent(schema, name) {
  return '"' + String(schema).replace(/"/g, '""') + '"."' + String(name).replace(/"/g, '""') + '"';
}

function createSqlRecollectJobStore(options) {
  const opt = options || {};
  const executor = opt.executor;
  const schema = opt.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test';

  async function query(sql, params) {
    return executor.query(sql, params);
  }

  return {
    kind: 'sql',
    initialize: async function () {
      return { ok: true };
    },
    insertJob: async function (partial) {
      const job = emptyJob(partial);
      if (!job.id) job.id = 'job_' + crypto.randomBytes(8).toString('hex');
      if (!job.runKey) job.runKey = opsCore.recrawlRunKey(job.reviewItemId, job.scheduledAt);
      try {
        await query(
          'INSERT INTO ' +
            qIdent(schema, 'daily_issue_recollect_jobs') +
            ' (id, review_item_id, run_key, scheduled_at, created_at, status, delay_minutes, instruction, origin_method, meta)' +
            ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',
          [
            job.id,
            job.reviewItemId,
            job.runKey,
            job.scheduledAt,
            job.createdAt || new Date().toISOString(),
            job.status,
            job.delayMinutes,
            job.instruction || '',
            job.originMethod,
            JSON.stringify(job.meta || {}),
          ],
        );
        return { ok: true, job: job };
      } catch (e) {
        if (e && (e.code === '23505' || String(e.message || '').indexOf('duplicate') >= 0)) {
          return { ok: false, error: 'DUPLICATE_JOB', runKey: job.runKey };
        }
        throw e;
      }
    },
    getByRunKey: async function (runKey) {
      const res = await query(
        'SELECT * FROM ' + qIdent(schema, 'daily_issue_recollect_jobs') + ' WHERE run_key = $1',
        [runKey],
      );
      return { ok: true, job: res.rows[0] ? rowToJob(res.rows[0]) : null };
    },
    getById: async function (id) {
      const res = await query(
        'SELECT * FROM ' + qIdent(schema, 'daily_issue_recollect_jobs') + ' WHERE id = $1',
        [id],
      );
      return { ok: true, job: res.rows[0] ? rowToJob(res.rows[0]) : null };
    },
    listJobs: async function (filters) {
      const f = filters || {};
      const clauses = [];
      const params = [];
      if (f.reviewItemId) {
        params.push(f.reviewItemId);
        clauses.push('review_item_id = $' + params.length);
      }
      if (f.status) {
        params.push(f.status);
        clauses.push('status = $' + params.length);
      }
      const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
      const res = await query(
        'SELECT * FROM ' +
          qIdent(schema, 'daily_issue_recollect_jobs') +
          where +
          ' ORDER BY created_at DESC',
        params,
      );
      return { ok: true, items: (res.rows || []).map(rowToJob) };
    },
    tryClaimJob: async function (runKey, asOf) {
      const t = qIdent(schema, 'daily_issue_recollect_jobs');
      const now = asOf || new Date().toISOString();
      const staleBefore = new Date(Date.parse(now) - opsCore.STALE_JOB_MINUTES * 60 * 1000).toISOString();
      await query(
        'UPDATE ' +
          t +
          " SET status = 'PENDING', claimed_at = NULL WHERE run_key = $1 AND status = 'RUNNING' AND claimed_at < $2",
        [runKey, staleBefore],
      );
      const res = await query(
        'UPDATE ' +
          t +
          " SET status = 'RUNNING', claimed_at = $2 WHERE run_key = $1 AND status = 'PENDING' RETURNING *",
        [runKey, now],
      );
      if (!res.rows[0]) {
        const got = await query('SELECT * FROM ' + t + ' WHERE run_key = $1', [runKey]);
        return { claimed: false, reason: got.rows[0] ? 'NOT_PENDING' : 'NOT_FOUND', job: got.rows[0] ? rowToJob(got.rows[0]) : null };
      }
      return { claimed: true, job: rowToJob(res.rows[0]) };
    },
    finishJob: async function (runKey, patch) {
      const p = patch || {};
      const res = await query(
        'UPDATE ' +
          qIdent(schema, 'daily_issue_recollect_jobs') +
          ' SET status=$2, finished_at=$3, result_version_number=$4, error_code=$5, error_summary=$6, meta=$7::jsonb' +
          ' WHERE run_key=$1 RETURNING *',
        [
          runKey,
          p.status,
          p.finishedAt || new Date().toISOString(),
          p.resultVersionNumber != null ? p.resultVersionNumber : null,
          p.errorCode || null,
          p.errorSummary || null,
          JSON.stringify(p.meta || {}),
        ],
      );
      if (!res.rows[0]) return { ok: false, error: 'NOT_FOUND' };
      return { ok: true, job: rowToJob(res.rows[0]) };
    },
    cancelJob: async function (runKey, asOf) {
      const res = await query(
        'UPDATE ' +
          qIdent(schema, 'daily_issue_recollect_jobs') +
          " SET status = 'CANCELLED', finished_at = $2 WHERE run_key = $1 AND status IN ('PENDING','RUNNING') RETURNING *",
        [runKey, asOf || new Date().toISOString()],
      );
      if (!res.rows[0]) return { ok: false, error: 'NOT_CANCELLABLE' };
      return { ok: true, job: rowToJob(res.rows[0]) };
    },
  };
}

function createRecollectJobStore(options) {
  const opt = options || {};
  if (opt.jobStore) return opt.jobStore;
  if (opt.executor) {
    return createSqlRecollectJobStore(opt);
  }
  const kind = String(opt.kind || opt.repository || process.env.DAILY_ISSUE_REPOSITORY || 'json').toLowerCase();
  if (kind === 'db' || kind === 'sql') {
    if (!opt.executor) {
      const pg = require('./daily-issue-pg-client');
      const executor = pg.createDailyIssuePgExecutor({
        databaseUrl: opt.databaseUrl,
        schemaName: opt.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA,
      });
      return createSqlRecollectJobStore(Object.assign({}, opt, { executor: executor }));
    }
    return createSqlRecollectJobStore(opt);
  }
  return createJsonRecollectJobStore(opt);
}

module.exports = {
  emptyJob: emptyJob,
  createJsonRecollectJobStore: createJsonRecollectJobStore,
  createSqlRecollectJobStore: createSqlRecollectJobStore,
  createRecollectJobStore: createRecollectJobStore,
};
