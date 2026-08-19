'use strict';

/**
 * Daily Issue public comments store (memory + pg).
 * Not part of review repository. No alignment / territory / board_comments.
 */

const crypto = require('crypto');
const commentCore = require('../shared/daily-issue-comment-core');

function newId() {
  return 'dicmt_' + crypto.randomBytes(8).toString('hex');
}

function nowIso(v) {
  if (v) {
    const d = new Date(v);
    if (isFinite(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function clone(row) {
  return row ? JSON.parse(JSON.stringify(row)) : null;
}

function isActive(row) {
  return !!(row && !row.deletedAt);
}

function createMemoryDailyIssueCommentStore(options) {
  const opt = options || {};
  let rows = Array.isArray(opt.rows) ? opt.rows.map(clone) : [];

  return {
    kind: 'memory',
    async listByIssueId(issueId) {
      const id = String(issueId || '');
      return rows
        .filter(function (r) {
          return isActive(r) && r.issueId === id;
        })
        .sort(function (a, b) {
          return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
        })
        .map(clone);
    },
    async getById(commentId) {
      const id = String(commentId || '');
      const row = rows.find(function (r) {
        return r.id === id;
      });
      return row ? clone(row) : null;
    },
    async create(input) {
      const src = input || {};
      const parsed = commentCore.parseCommentBody(src.body);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const row = {
        id: src.id || newId(),
        issueId: String(src.issueId || ''),
        userId: String(src.userId || ''),
        body: parsed.body,
        createdAt: nowIso(src.now),
        updatedAt: nowIso(src.now),
        deletedAt: null,
      };
      if (!row.issueId || !row.userId) return { ok: false, error: 'VALIDATION_ERROR' };
      rows.push(row);
      return { ok: true, item: clone(row) };
    },
    async softDelete(commentId, userId) {
      const id = String(commentId || '');
      const uid = String(userId || '');
      const idx = rows.findIndex(function (r) {
        return r.id === id;
      });
      if (idx < 0 || rows[idx].deletedAt) return { ok: false, error: 'COMMENT_NOT_FOUND' };
      if (String(rows[idx].userId) !== uid) return { ok: false, error: 'COMMENT_FORBIDDEN' };
      rows[idx] = Object.assign({}, rows[idx], {
        deletedAt: nowIso(),
        updatedAt: nowIso(),
      });
      return { ok: true, item: clone(rows[idx]) };
    },
  };
}

function qIdent(schema, table) {
  const s = String(schema || 'public').replace(/"/g, '');
  const t = String(table).replace(/"/g, '');
  return '"' + s + '"."' + t + '"';
}

function createPgDailyIssueCommentStore(options) {
  const opt = options || {};
  const executor = opt.executor;
  const schema = opt.schemaName || (executor && executor.schemaName) || 'public';
  const table = qIdent(schema, 'daily_issue_comments');

  function mapRow(r) {
    if (!r) return null;
    return {
      id: r.id,
      issueId: r.issue_id,
      userId: r.user_id,
      body: r.body,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at || null,
    };
  }

  return {
    kind: 'pg',
    async listByIssueId(issueId) {
      const res = await executor.query(
        'SELECT * FROM ' + table + ' WHERE issue_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
        [String(issueId || '')],
      );
      return (res.rows || []).map(mapRow);
    },
    async getById(commentId) {
      const res = await executor.query('SELECT * FROM ' + table + ' WHERE id = $1 LIMIT 1', [String(commentId || '')]);
      return res.rows && res.rows[0] ? mapRow(res.rows[0]) : null;
    },
    async create(input) {
      const src = input || {};
      const parsed = commentCore.parseCommentBody(src.body);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const issueId = String(src.issueId || '');
      const userId = String(src.userId || '');
      if (!issueId || !userId) return { ok: false, error: 'VALIDATION_ERROR' };
      const id = src.id || newId();
      const at = nowIso(src.now);
      const res = await executor.query(
        'INSERT INTO ' +
          table +
          ' (id, issue_id, user_id, body, created_at, updated_at, deleted_at) VALUES ($1,$2,$3,$4,$5,$6,NULL) RETURNING *',
        [id, issueId, userId, parsed.body, at, at],
      );
      return { ok: true, item: mapRow(res.rows[0]) };
    },
    async softDelete(commentId, userId) {
      const existing = await this.getById(commentId);
      if (!existing || existing.deletedAt) return { ok: false, error: 'COMMENT_NOT_FOUND' };
      if (String(existing.userId) !== String(userId)) return { ok: false, error: 'COMMENT_FORBIDDEN' };
      const at = nowIso();
      const res = await executor.query(
        'UPDATE ' +
          table +
          ' SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL RETURNING *',
        [at, String(commentId), String(userId)],
      );
      if (!res.rows || !res.rows[0]) return { ok: false, error: 'COMMENT_NOT_FOUND' };
      return { ok: true, item: mapRow(res.rows[0]) };
    },
  };
}

function createDailyIssueCommentStore(options) {
  const opt = options || {};
  const kind = String(opt.kind || '').toLowerCase();
  if (kind === 'pg' || (opt.executor && kind !== 'memory')) {
    return createPgDailyIssueCommentStore(opt);
  }
  return createMemoryDailyIssueCommentStore(opt);
}

module.exports = {
  createDailyIssueCommentStore: createDailyIssueCommentStore,
  createMemoryDailyIssueCommentStore: createMemoryDailyIssueCommentStore,
  createPgDailyIssueCommentStore: createPgDailyIssueCommentStore,
};
