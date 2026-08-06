'use strict';

/**
 * 아침판 스케줄러 실행 이력 저장소
 * — JSON 파일 또는 PostgreSQL (unique run_key + advisory lock)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('../shared/daily-issue-morning-scheduler-core');

function emptyRun(partial) {
  const p = partial || {};
  return {
    runKey: p.runKey || '',
    runType: p.runType || '',
    scheduledAt: p.scheduledAt || null,
    startedAt: p.startedAt || null,
    finishedAt: p.finishedAt || null,
    status: p.status || core.RUN_STATUS.STARTED,
    collectedSourceCount: Number(p.collectedSourceCount) || 0,
    candidateCount: Number(p.candidateCount) || 0,
    autoEligibleCount: Number(p.autoEligibleCount) || 0,
    autoPublishedCount: Number(p.autoPublishedCount) || 0,
    manualReviewCount: Number(p.manualReviewCount) || 0,
    skippedDuplicateCount: Number(p.skippedDuplicateCount) || 0,
    errorCode: p.errorCode || null,
    errorSummary: p.errorSummary || null,
    meta: p.meta && typeof p.meta === 'object' ? p.meta : {},
  };
}

function rowToRun(row) {
  if (!row) return null;
  return {
    runKey: row.run_key || row.runKey,
    runType: row.run_type || row.runType,
    scheduledAt: row.scheduled_at || row.scheduledAt,
    startedAt: row.started_at || row.startedAt,
    finishedAt: row.finished_at || row.finishedAt,
    status: row.status,
    collectedSourceCount: Number(row.collected_source_count != null ? row.collected_source_count : row.collectedSourceCount) || 0,
    candidateCount: Number(row.candidate_count != null ? row.candidate_count : row.candidateCount) || 0,
    autoEligibleCount: Number(row.auto_eligible_count != null ? row.auto_eligible_count : row.autoEligibleCount) || 0,
    autoPublishedCount: Number(row.auto_published_count != null ? row.auto_published_count : row.autoPublishedCount) || 0,
    manualReviewCount: Number(row.manual_review_count != null ? row.manual_review_count : row.manualReviewCount) || 0,
    skippedDuplicateCount:
      Number(row.skipped_duplicate_count != null ? row.skipped_duplicate_count : row.skippedDuplicateCount) || 0,
    errorCode: row.error_code != null ? row.error_code : row.errorCode,
    errorSummary: row.error_summary != null ? row.error_summary : row.errorSummary,
    meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
  };
}

function advisoryKey(runKey) {
  const h = crypto.createHash('sha256').update(String(runKey)).digest();
  // two int32 for pg_try_advisory_lock(key1, key2)
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

function createJsonMorningSchedulerStore(options) {
  const opt = options || {};
  const root = opt.reviewRoot || path.join(process.cwd(), 'data', 'daily-issue-review');
  const file = path.join(root, 'morning-scheduler-runs.json');

  function ensureDir() {
    fs.mkdirSync(root, { recursive: true });
  }

  function load() {
    ensureDir();
    if (!fs.existsSync(file)) return { runs: {} };
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      return { runs: {} };
    }
  }

  function save(data) {
    ensureDir();
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  return {
    kind: 'json',
    initialize: function () {
      ensureDir();
      return { ok: true };
    },
    getByRunKey: function (runKey) {
      const data = load();
      const r = data.runs[String(runKey)];
      return Promise.resolve({ ok: true, run: r ? emptyRun(r) : null });
    },
    listRuns: function (filters) {
      const f = filters || {};
      const data = load();
      let list = Object.keys(data.runs).map(function (k) {
        return emptyRun(data.runs[k]);
      });
      if (f.runType) {
        list = list.filter(function (r) {
          return r.runType === f.runType;
        });
      }
      if (f.status) {
        list = list.filter(function (r) {
          return r.status === f.status;
        });
      }
      list.sort(function (a, b) {
        return Date.parse(b.startedAt || b.scheduledAt || 0) - Date.parse(a.startedAt || a.scheduledAt || 0);
      });
      const offset = Number(f.offset) || 0;
      const limit = Math.min(Number(f.limit) || 50, 200);
      return Promise.resolve({ ok: true, items: list.slice(offset, offset + limit), total: list.length });
    },
    /**
     * Atomically claim runKey. Returns { ok, claimed, run, skipped }
     * Failed runs may be retried if allowRetryAfterFailure.
     */
    tryClaimRun: function (spec) {
      const s = spec || {};
      const runKey = String(s.runKey || '');
      const data = load();
      const existing = data.runs[runKey] ? emptyRun(data.runs[runKey]) : null;
      if (existing) {
        if (core.canRetryAfterFailure(existing) && s.allowRetryAfterFailure) {
          // fall through to overwrite STARTED
        } else if (core.isDuplicateSkipStatus(existing.status) || existing.status === core.RUN_STATUS.FAILED) {
          if (existing.status !== core.RUN_STATUS.FAILED || !s.allowRetryAfterFailure) {
            return Promise.resolve({
              ok: true,
              claimed: false,
              skipped: true,
              reason: 'DUPLICATE_RUN_KEY',
              run: existing,
              status: core.RUN_STATUS.SKIPPED_DUPLICATE,
            });
          }
        }
      }
      const run = emptyRun({
        runKey: runKey,
        runType: s.runType,
        scheduledAt: s.scheduledAt,
        startedAt: s.startedAt || new Date().toISOString(),
        status: core.RUN_STATUS.STARTED,
        meta: s.meta || {},
      });
      data.runs[runKey] = run;
      save(data);
      return Promise.resolve({ ok: true, claimed: true, skipped: false, run: run });
    },
    finishRun: function (runKey, patch) {
      const data = load();
      const cur = data.runs[String(runKey)];
      if (!cur) return Promise.resolve({ ok: false, error: 'RUN_NOT_FOUND' });
      const next = emptyRun(Object.assign({}, cur, patch || {}, { runKey: String(runKey) }));
      data.runs[String(runKey)] = next;
      save(data);
      return Promise.resolve({ ok: true, run: next });
    },
    insertMissed: function (spec) {
      const s = spec || {};
      return this.tryClaimRun({
        runKey: s.runKey,
        runType: s.runType,
        scheduledAt: s.scheduledAt,
        startedAt: s.asOf || new Date().toISOString(),
        meta: s.meta || { missed: true },
      }).then(function (claim) {
        if (!claim.claimed) {
          return { ok: true, skipped: true, run: claim.run };
        }
        const finished = Object.assign({}, claim.run, {
          status: core.RUN_STATUS.MISSED,
          finishedAt: s.asOf || new Date().toISOString(),
          errorCode: 'MISSED_CATCHUP_WINDOW',
          errorSummary: 'Catch-up window exceeded; automatic run skipped',
        });
        const data = load();
        data.runs[finished.runKey] = finished;
        save(data);
        return { ok: true, skipped: false, run: finished };
      });
    },
  };
}

function createSqlMorningSchedulerStore(options) {
  const opt = options || {};
  const executor = opt.executor;
  const schema = String(opt.schemaName || process.env.DAILY_ISSUE_DB_SCHEMA || 'daily_issue_test');

  function q(sql, params) {
    return executor.query(sql, params || []);
  }

  function table() {
    return '"' + schema.replace(/"/g, '') + '"."daily_issue_scheduler_runs"';
  }

  return {
    kind: 'sql',
    schemaName: schema,
    initialize: async function () {
      // table must exist via migration; probe
      try {
        await q('SELECT 1 FROM ' + table() + ' LIMIT 1');
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: 'SCHEDULER_TABLE_MISSING',
          message: String(e && e.message ? e.message : e),
        };
      }
    },
    getByRunKey: async function (runKey) {
      const res = await q('SELECT * FROM ' + table() + ' WHERE run_key = $1', [String(runKey)]);
      const row = res.rows && res.rows[0];
      return { ok: true, run: row ? rowToRun(row) : null };
    },
    listRuns: async function (filters) {
      const f = filters || {};
      const params = [];
      let where = 'WHERE 1=1';
      if (f.runType) {
        params.push(f.runType);
        where += ' AND run_type = $' + params.length;
      }
      if (f.status) {
        params.push(f.status);
        where += ' AND status = $' + params.length;
      }
      const countRes = await q('SELECT COUNT(*)::int AS c FROM ' + table() + ' ' + where, params);
      const total = (countRes.rows && countRes.rows[0] && countRes.rows[0].c) || 0;
      const limit = Math.min(Number(f.limit) || 50, 200);
      const offset = Number(f.offset) || 0;
      params.push(limit);
      params.push(offset);
      const res = await q(
        'SELECT * FROM ' +
          table() +
          ' ' +
          where +
          ' ORDER BY COALESCE(started_at, scheduled_at) DESC LIMIT $' +
          (params.length - 1) +
          ' OFFSET $' +
          params.length,
        params,
      );
      return {
        ok: true,
        items: (res.rows || []).map(rowToRun),
        total: total,
      };
    },
    tryClaimRun: async function (spec) {
      const s = spec || {};
      const runKey = String(s.runKey || '');
      const keys = advisoryKey(runKey);

      return executor.withTransaction(async function (tx) {
        const lock = await tx.query('SELECT pg_try_advisory_xact_lock($1, $2) AS ok', keys);
        const locked = !!(lock.rows && lock.rows[0] && lock.rows[0].ok);
        if (!locked) {
          const existing = await tx.query('SELECT * FROM ' + table() + ' WHERE run_key = $1', [runKey]);
          const row = existing.rows && existing.rows[0];
          return {
            ok: true,
            claimed: false,
            skipped: true,
            reason: 'ADVISORY_LOCK_BUSY',
            run: row ? rowToRun(row) : null,
            status: core.RUN_STATUS.SKIPPED_DUPLICATE,
          };
        }

        const existing = await tx.query('SELECT * FROM ' + table() + ' WHERE run_key = $1 FOR UPDATE', [runKey]);
        const row = existing.rows && existing.rows[0];
        if (row) {
          const cur = rowToRun(row);
          if (core.canRetryAfterFailure(cur) && s.allowRetryAfterFailure) {
            await tx.query('DELETE FROM ' + table() + ' WHERE run_key = $1', [runKey]);
          } else {
            return {
              ok: true,
              claimed: false,
              skipped: true,
              reason: 'DUPLICATE_RUN_KEY',
              run: cur,
              status: core.RUN_STATUS.SKIPPED_DUPLICATE,
            };
          }
        }

        const startedAt = s.startedAt || new Date().toISOString();
        const ins = await tx.query(
          'INSERT INTO ' +
            table() +
            ' (run_key, run_type, scheduled_at, started_at, status, meta)' +
            ' VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *',
          [
            runKey,
            s.runType,
            s.scheduledAt,
            startedAt,
            core.RUN_STATUS.STARTED,
            JSON.stringify(s.meta || {}),
          ],
        );
        return { ok: true, claimed: true, skipped: false, run: rowToRun(ins.rows[0]) };
      });
    },
    finishRun: async function (runKey, patch) {
      const p = patch || {};
      const res = await q(
        'UPDATE ' +
          table() +
          ' SET status=$2, finished_at=$3, collected_source_count=$4, candidate_count=$5,' +
          ' auto_eligible_count=$6, auto_published_count=$7, manual_review_count=$8,' +
          ' skipped_duplicate_count=$9, error_code=$10, error_summary=$11, meta=$12::jsonb,' +
          ' updated_at=now() WHERE run_key=$1 RETURNING *',
        [
          String(runKey),
          p.status,
          p.finishedAt || new Date().toISOString(),
          Number(p.collectedSourceCount) || 0,
          Number(p.candidateCount) || 0,
          Number(p.autoEligibleCount) || 0,
          Number(p.autoPublishedCount) || 0,
          Number(p.manualReviewCount) || 0,
          Number(p.skippedDuplicateCount) || 0,
          p.errorCode || null,
          p.errorSummary || null,
          JSON.stringify(p.meta || {}),
        ],
      );
      if (!res.rows || !res.rows[0]) return { ok: false, error: 'RUN_NOT_FOUND' };
      return { ok: true, run: rowToRun(res.rows[0]) };
    },
    insertMissed: async function (spec) {
      const s = spec || {};
      const claim = await this.tryClaimRun({
        runKey: s.runKey,
        runType: s.runType,
        scheduledAt: s.scheduledAt,
        startedAt: s.asOf || new Date().toISOString(),
        meta: Object.assign({ missed: true }, s.meta || {}),
      });
      if (!claim.claimed) return { ok: true, skipped: true, run: claim.run };
      return this.finishRun(s.runKey, {
        status: core.RUN_STATUS.MISSED,
        finishedAt: s.asOf || new Date().toISOString(),
        errorCode: 'MISSED_CATCHUP_WINDOW',
        errorSummary: 'Catch-up window exceeded; automatic run skipped',
        meta: claim.run && claim.run.meta,
      });
    },
  };
}

function createMorningSchedulerStore(options) {
  const opt = options || {};
  if (opt.store) return opt.store;
  if (opt.executor || String(opt.kind || '').toLowerCase() === 'sql' || String(opt.kind || '').toLowerCase() === 'db') {
    return createSqlMorningSchedulerStore(opt);
  }
  return createJsonMorningSchedulerStore(opt);
}

module.exports = {
  createMorningSchedulerStore: createMorningSchedulerStore,
  createJsonMorningSchedulerStore: createJsonMorningSchedulerStore,
  createSqlMorningSchedulerStore: createSqlMorningSchedulerStore,
  emptyRun: emptyRun,
  rowToRun: rowToRun,
  advisoryKey: advisoryKey,
};
