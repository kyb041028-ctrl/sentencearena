'use strict';

const crypto = require('crypto');
const { qIdent } = require('./daily-issue-emergency-halt-store');

const DEFAULT_LEASE_MS = 15 * 60 * 1000;

function advisoryKey(runKey) {
  const h = crypto.createHash('sha256').update(String(runKey)).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

function createSqlUsSchedulerStore(options) {
  const opt = options || {};
  const executor = opt.executor;
  const schema = opt.schemaName || 'daily_issue_test';
  const leaseMs = Number(opt.leaseMs) || DEFAULT_LEASE_MS;
  const table = function () {
    return qIdent(schema, 'daily_issue_us_scheduler_runs');
  };

  function rowToRun(row) {
    if (!row) return null;
    return {
      runKey: row.run_key,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      publishedCount: Number(row.published_count) || 0,
      outcome: row.outcome,
      errorCode: row.error_code,
      meta: row.meta || {},
    };
  }

  return {
    kind: 'sql-us',
    schemaName: schema,
    getByRunKey: async function (runKey) {
      const res = await executor.query('SELECT * FROM ' + table() + ' WHERE run_key = $1', [String(runKey)]);
      return rowToRun(res.rows && res.rows[0]);
    },
    tryClaimRun: async function (params) {
      const p = params || {};
      const key = String(p.runKey || '');
      if (!key) return { claimed: false, reason: 'RUN_KEY_MISSING' };
      const owner = p.leaseOwner || 'us-' + crypto.randomBytes(4).toString('hex');
      const now = Date.parse(p.startedAt || new Date().toISOString()) || Date.now();
      const leaseUntil = new Date(now + leaseMs).toISOString();

      return executor.withTransaction(async function (tx) {
        const lock = advisoryKey(key);
        const locked = await tx.query('SELECT pg_try_advisory_xact_lock($1, $2) AS ok', lock);
        if (!locked.rows || !locked.rows[0] || locked.rows[0].ok !== true) {
          return { claimed: false, reason: 'DUPLICATE_RUN_KEY', runKey: key };
        }
        const existing = await tx.query('SELECT * FROM ' + table() + ' WHERE run_key = $1 FOR UPDATE', [key]);
        const row = existing.rows && existing.rows[0];
        if (row) {
          const cur = rowToRun(row);
          if (cur.status === 'SUCCESS' || cur.status === 'RUNNING') {
            if (cur.status === 'RUNNING' && cur.leaseExpiresAt && Date.parse(cur.leaseExpiresAt) > now) {
              return { claimed: false, reason: 'LEASE_HELD', run: cur, runKey: key };
            }
          }
          if (cur.status === 'FAILED' && p.allowRetryAfterFailure !== true) {
            return { claimed: false, reason: 'ALREADY_PUBLISHED', run: cur, runKey: key };
          }
          if (cur.status === 'STARTED' || cur.status === 'RUNNING') {
            const expired = !cur.leaseExpiresAt || Date.parse(cur.leaseExpiresAt) <= now;
            if (!expired && !p.allowRetryAfterFailure) {
              return { claimed: false, reason: 'DUPLICATE_RUN_KEY', run: cur, runKey: key };
            }
            if (expired) {
              await tx.query(
                'UPDATE ' +
                  table() +
                  ' SET status=$2, finished_at=now(), error_code=$3, error_summary=$4, updated_at=now() WHERE run_key=$1',
                [key, 'FAILED', 'ORPHAN_LEASE_EXPIRED', 'lease expired before finish'],
              );
              if (p.allowRetryAfterFailure !== true) {
                const orphan = rowToRun((await tx.query('SELECT * FROM ' + table() + ' WHERE run_key=$1', [key])).rows[0]);
                return { claimed: false, reason: 'ORPHAN_RECOVERED', run: orphan, runKey: key };
              }
            }
          }
          await tx.query('DELETE FROM ' + table() + ' WHERE run_key = $1', [key]);
        }
        const ins = await tx.query(
          'INSERT INTO ' +
            table() +
            ' (run_key, status, started_at, lease_owner, lease_expires_at, meta) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *',
          [key, 'RUNNING', p.startedAt || new Date().toISOString(), owner, leaseUntil, JSON.stringify(p.meta || {})],
        );
        return { claimed: true, run: rowToRun(ins.rows[0]), runKey: key, leaseOwner: owner };
      });
    },
    finishRun: async function (runKey, patch) {
      const p = patch || {};
      const res = await executor.query(
        'UPDATE ' +
          table() +
          ' SET status=$2, finished_at=$3, published_count=$4, outcome=$5, error_code=$6, error_summary=$7, meta=COALESCE($8::jsonb, meta), updated_at=now() WHERE run_key=$1 RETURNING *',
        [
          String(runKey),
          p.status || 'SUCCESS',
          p.finishedAt || new Date().toISOString(),
          Number(p.publishedCount != null ? p.publishedCount : p.published) || 0,
          p.outcome || null,
          p.errorCode || null,
          p.errorSummary || null,
          p.meta ? JSON.stringify(p.meta) : null,
        ],
      );
      if (!res.rows || !res.rows[0]) return { ok: false, error: 'RUN_NOT_FOUND' };
      return { ok: true, run: rowToRun(res.rows[0]) };
    },
    listForDate: async function (dateKey) {
      const prefix = 'us-daily-issue:' + String(dateKey || '') + ':';
      const res = await executor.query('SELECT * FROM ' + table() + ' WHERE run_key LIKE $1', [prefix + '%']);
      return (res.rows || []).map(rowToRun);
    },
  };
}

module.exports = {
  createSqlUsSchedulerStore: createSqlUsSchedulerStore,
  DEFAULT_LEASE_MS: DEFAULT_LEASE_MS,
};
