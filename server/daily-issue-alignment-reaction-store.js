'use strict';

/**
 * Canonical Daily Issue LIKE/DISLIKE store.
 * Not part of review repository CONTRACT_METHODS.
 * Snapshot issue direction at reaction time. Do not rewrite on later admin edits.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const seedCore = require('../shared/daily-issue-alignment-seed-core');

function newId() {
  return 'dirx_' + crypto.randomBytes(8).toString('hex');
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
  return !!(row && !row.cancelledAt);
}

function applyToggle(rows, input) {
  const userId = String(input.userId || '');
  const issueId = String(input.issueId || '');
  const requested = seedCore.normalizeReactionType(input.reactionType);
  const plan = seedCore.nextToggleState(
    (rows.find(function (r) {
      return isActive(r) && r.userId === userId && r.issueId === issueId;
    }) || {}).reactionType,
    requested
  );
  if (!plan.ok) return { ok: false, error: plan.error, rows: rows };
  const at = nowIso(input.now);
  const snapshot = seedCore.normalizeDirection(input.directionSnapshot);
  const next = rows.slice();
  const activeIdx = next.findIndex(function (r) {
    return isActive(r) && r.userId === userId && r.issueId === issueId;
  });

  if (plan.action === 'CANCELLED' && activeIdx >= 0) {
    next[activeIdx] = Object.assign({}, next[activeIdx], {
      cancelledAt: at,
      updatedAt: at,
    });
    return {
      ok: true,
      action: 'CANCELLED',
      active: false,
      reactionType: null,
      snapshotUsed: next[activeIdx].issueAlignmentDirectionAtReaction,
      rows: next,
    };
  }

  if (plan.action === 'REPLACED' && activeIdx >= 0) {
    next[activeIdx] = Object.assign({}, next[activeIdx], {
      cancelledAt: at,
      updatedAt: at,
    });
    const created = {
      id: newId(),
      userId: userId,
      issueId: issueId,
      reactionType: plan.nextType,
      issueAlignmentDirectionAtReaction: snapshot,
      createdAt: at,
      updatedAt: at,
      cancelledAt: null,
    };
    next.push(created);
    return {
      ok: true,
      action: 'REPLACED',
      active: true,
      reactionType: plan.nextType,
      snapshotUsed: snapshot,
      rows: next,
    };
  }

  const created = {
    id: newId(),
    userId: userId,
    issueId: issueId,
    reactionType: plan.nextType,
    issueAlignmentDirectionAtReaction: snapshot,
    createdAt: at,
    updatedAt: at,
    cancelledAt: null,
  };
  next.push(created);
  return {
    ok: true,
    action: 'CREATED',
    active: true,
    reactionType: plan.nextType,
    snapshotUsed: snapshot,
    rows: next,
  };
}

function publicToggleResult(out) {
  return {
    ok: out.ok,
    action: out.action || null,
    active: !!out.active,
    reactionType: out.reactionType || null,
  };
}

function createMemoryDailyIssueAlignmentReactionStore(seedRows) {
  let rows = Array.isArray(seedRows) ? seedRows.map(clone) : [];

  return {
    kind: 'memory',
    async toggle(input) {
      const out = applyToggle(rows, input || {});
      if (!out.ok) return { ok: false, error: out.error };
      rows = out.rows;
      return publicToggleResult(out);
    },
    async getActive(userId, issueId) {
      const row = rows.find(function (r) {
        return isActive(r) && r.userId === String(userId) && r.issueId === String(issueId);
      });
      return row ? clone(row) : null;
    },
    async listActive() {
      return rows.filter(isActive).map(clone);
    },
    async listAll() {
      return rows.map(clone);
    },
  };
}

function createJsonDailyIssueAlignmentReactionStore(options) {
  const opt = options || {};
  const filePath = path.resolve(
    opt.filePath ||
      path.join(opt.reviewRoot || path.join(process.cwd(), '.cache', 'daily-issue', 'review'), 'alignment-reactions.json')
  );

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed.reactions) ? parsed.reactions : [];
    } catch (e) {
      return [];
    }
  }

  function save(rows) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ reactions: rows }, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  return {
    kind: 'json',
    async toggle(input) {
      const rows = load();
      const out = applyToggle(rows, input || {});
      if (!out.ok) return { ok: false, error: out.error };
      save(out.rows);
      return publicToggleResult(out);
    },
    async getActive(userId, issueId) {
      const row = load().find(function (r) {
        return isActive(r) && r.userId === String(userId) && r.issueId === String(issueId);
      });
      return row ? clone(row) : null;
    },
    async listActive() {
      return load().filter(isActive).map(clone);
    },
    async listAll() {
      return load().map(clone);
    },
  };
}

function qIdent(schema, table) {
  const s = String(schema || 'public').replace(/"/g, '');
  const t = String(table).replace(/"/g, '');
  return '"' + s + '"."' + t + '"';
}

function createPgDailyIssueAlignmentReactionStore(options) {
  const opt = options || {};
  const executor = opt.executor;
  const schema = opt.schemaName || (executor && executor.schemaName) || 'public';
  const table = qIdent(schema, 'daily_issue_reactions');

  function mapRow(r) {
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      issueId: r.issue_id,
      reactionType: r.reaction_type,
      issueAlignmentDirectionAtReaction: r.issue_alignment_direction_at_reaction,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      cancelledAt: r.cancelled_at,
    };
  }

  return {
    kind: 'pg',
    async toggle(input) {
      const src = input || {};
      const requested = seedCore.normalizeReactionType(src.reactionType);
      if (!requested) return { ok: false, error: 'REACTION_TYPE_INVALID' };
      const userId = String(src.userId || '');
      const issueId = String(src.issueId || '');
      const snapshot = seedCore.normalizeDirection(src.directionSnapshot);
      const at = nowIso(src.now);
      const found = await executor.query(
        'SELECT * FROM ' +
          table +
          ' WHERE user_id = $1 AND issue_id = $2 AND cancelled_at IS NULL LIMIT 1',
        [userId, issueId]
      );
      const current = found.rows && found.rows[0] ? mapRow(found.rows[0]) : null;
      const plan = seedCore.nextToggleState(current && current.reactionType, requested);
      if (!plan.ok) return { ok: false, error: plan.error };

      if (plan.action === 'CANCELLED' && current) {
        await executor.query(
          'UPDATE ' + table + ' SET cancelled_at = $1, updated_at = $1 WHERE id = $2 AND cancelled_at IS NULL',
          [at, current.id]
        );
        return { ok: true, action: 'CANCELLED', active: false, reactionType: null };
      }

      if (plan.action === 'REPLACED' && current) {
        await executor.query(
          'UPDATE ' + table + ' SET cancelled_at = $1, updated_at = $1 WHERE id = $2 AND cancelled_at IS NULL',
          [at, current.id]
        );
        await executor.query(
          'INSERT INTO ' +
            table +
            ' (id, user_id, issue_id, reaction_type, issue_alignment_direction_at_reaction, created_at, updated_at, cancelled_at)' +
            ' VALUES ($1,$2,$3,$4,$5,$6,$6,NULL)',
          [newId(), userId, issueId, plan.nextType, snapshot, at]
        );
        return { ok: true, action: 'REPLACED', active: true, reactionType: plan.nextType };
      }

      await executor.query(
        'INSERT INTO ' +
          table +
          ' (id, user_id, issue_id, reaction_type, issue_alignment_direction_at_reaction, created_at, updated_at, cancelled_at)' +
          ' VALUES ($1,$2,$3,$4,$5,$6,$6,NULL)',
        [newId(), userId, issueId, plan.nextType, snapshot, at]
      );
      return { ok: true, action: 'CREATED', active: true, reactionType: plan.nextType };
    },
    async getActive(userId, issueId) {
      const found = await executor.query(
        'SELECT * FROM ' +
          table +
          ' WHERE user_id = $1 AND issue_id = $2 AND cancelled_at IS NULL LIMIT 1',
        [String(userId), String(issueId)]
      );
      return found.rows && found.rows[0] ? mapRow(found.rows[0]) : null;
    },
    async listActive() {
      const found = await executor.query('SELECT * FROM ' + table + ' WHERE cancelled_at IS NULL');
      return (found.rows || []).map(mapRow);
    },
    async listAll() {
      const found = await executor.query('SELECT * FROM ' + table);
      return (found.rows || []).map(mapRow);
    },
  };
}

function createDailyIssueAlignmentReactionStore(options) {
  const opt = options || {};
  if (opt.store) return opt.store;
  if (opt.kind === 'pg' || opt.executor) return createPgDailyIssueAlignmentReactionStore(opt);
  if (opt.kind === 'json' || opt.reviewRoot || opt.filePath) return createJsonDailyIssueAlignmentReactionStore(opt);
  return createMemoryDailyIssueAlignmentReactionStore(opt.seedRows);
}

module.exports = {
  createMemoryDailyIssueAlignmentReactionStore: createMemoryDailyIssueAlignmentReactionStore,
  createJsonDailyIssueAlignmentReactionStore: createJsonDailyIssueAlignmentReactionStore,
  createPgDailyIssueAlignmentReactionStore: createPgDailyIssueAlignmentReactionStore,
  createDailyIssueAlignmentReactionStore: createDailyIssueAlignmentReactionStore,
  applyToggle: applyToggle,
};
