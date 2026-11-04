'use strict';

const haltCore = require('../shared/daily-issue-emergency-halt-core');

function qIdent(schema, table) {
  const s = String(schema || 'public').replace(/"/g, '');
  const t = String(table).replace(/"/g, '');
  return '"' + s + '"."' + t + '"';
}

function createSqlEmergencyHaltStore(options) {
  const opt = options || {};
  const executor = opt.executor;
  const schema = opt.schemaName || 'daily_issue_test';
  if (!executor || !executor.query) {
    throw new Error('SQL_HALT_STORE_REQUIRES_EXECUTOR');
  }

  const haltT = qIdent(schema, 'daily_issue_emergency_halt');
  const auditT = qIdent(schema, 'daily_issue_emergency_halt_audit');

  async function ensureRegion(region) {
    const r = haltCore.normalizeRegion(region);
    if (!r) return { ok: false, error: 'INVALID_REGION' };
    await executor.query(
      'INSERT INTO ' + haltT + ' (region, halted, reason) VALUES ($1, false, $2) ON CONFLICT (region) DO NOTHING',
      [r, 'init'],
    );
    return { ok: true, region: r };
  }

  return {
    kind: 'sql',
    schemaName: schema,
    initialize: async function () {
      await executor.query('SELECT 1 FROM ' + haltT + ' LIMIT 0');
      await ensureRegion('KR');
      await ensureRegion('US');
      return { ok: true };
    },
    getRegion: async function (region) {
      const prep = await ensureRegion(region);
      if (!prep.ok) return prep;
      try {
        const res = await executor.query('SELECT * FROM ' + haltT + ' WHERE region = $1', [prep.region]);
        const row = res.rows && res.rows[0];
        if (!row) return { ok: false, error: 'HALT_ROW_MISSING' };
        return {
          ok: true,
          region: row.region,
          halted: row.halted === true,
          reason: row.reason,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
          lockVersion: Number(row.lock_version) || 1,
        };
      } catch (e) {
        return { ok: false, error: 'HALT_READ_FAILED', message: String(e.message || e) };
      }
    },
    setRegion: async function (params) {
      const p = params || {};
      const prep = await ensureRegion(p.region);
      if (!prep.ok) return prep;
      const halted = p.halted === true;
      const reason = p.reason != null ? String(p.reason).slice(0, 500) : null;
      const actorId = p.actorId || null;
      try {
        return await executor.withTransaction(async function (tx) {
          const cur = await tx.query('SELECT * FROM ' + haltT + ' WHERE region = $1 FOR UPDATE', [prep.region]);
          const row = cur.rows && cur.rows[0];
          const lv = Number(row && row.lock_version) || 1;
          if (p.expectedLockVersion != null && Number(p.expectedLockVersion) !== lv) {
            return { ok: false, error: 'STALE_HALT_VERSION' };
          }
          const upd = await tx.query(
            'UPDATE ' +
              haltT +
              ' SET halted=$2, reason=$3, updated_at=now(), updated_by=$4, lock_version=$5 WHERE region=$1 RETURNING *',
            [prep.region, halted, reason, actorId, lv + 1],
          );
          await tx.query(
            'INSERT INTO ' +
              auditT +
              ' (region, action, halted, reason, actor_id, meta) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
            [
              prep.region,
              halted ? 'HALT_ON' : 'HALT_OFF',
              halted,
              reason,
              actorId,
              JSON.stringify(p.meta || {}),
            ],
          );
          const saved = upd.rows && upd.rows[0];
          return {
            ok: true,
            region: saved.region,
            halted: saved.halted === true,
            reason: saved.reason,
            updatedAt: saved.updated_at,
            updatedBy: saved.updated_by,
            lockVersion: Number(saved.lock_version) || 1,
          };
        });
      } catch (e) {
        return { ok: false, error: 'HALT_WRITE_FAILED', message: String(e.message || e) };
      }
    },
    listAudit: async function (region, limit) {
      const prep = await ensureRegion(region);
      if (!prep.ok) return prep;
      const lim = Math.min(Number(limit) || 20, 100);
      const res = await executor.query(
        'SELECT * FROM ' + auditT + ' WHERE region = $1 ORDER BY created_at DESC LIMIT $2',
        [prep.region, lim],
      );
      return { ok: true, items: res.rows || [] };
    },
  };
}

async function lockAndAssertPublishAllowedInTx(tx, schema, region, publishKind) {
  const haltCore = require('../shared/daily-issue-emergency-halt-core');
  const r = haltCore.normalizeRegion(region);
  if (!r) return { ok: false, error: 'INVALID_REGION' };
  const haltT = qIdent(schema, 'daily_issue_emergency_halt');
  await tx.query(
    'INSERT INTO ' + haltT + ' (region, halted, reason) VALUES ($1, false, $2) ON CONFLICT (region) DO NOTHING',
    [r, 'init'],
  );
  const res = await tx.query('SELECT * FROM ' + haltT + ' WHERE region = $1 FOR UPDATE', [r]);
  const row = res.rows && res.rows[0];
  if (!row) {
    return { ok: false, error: 'HALT_STATE_UNAVAILABLE', failClosed: true };
  }
  if (haltCore.blocksNewPublish(row.halted === true, publishKind)) {
    return { ok: false, error: 'EMERGENCY_HALT_ACTIVE', region: r, halted: true };
  }
  return { ok: true, region: r, halted: false };
}

module.exports = {
  createSqlEmergencyHaltStore: createSqlEmergencyHaltStore,
  qIdent: qIdent,
  lockAndAssertPublishAllowedInTx: lockAndAssertPublishAllowedInTx,
};
