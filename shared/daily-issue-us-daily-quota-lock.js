'use strict';

const crypto = require('crypto');
const usOps = require('./daily-issue-us-ops-core');
const { qIdent } = require('../server/daily-issue-emergency-halt-store');

function advisoryKeyForUsDaily(dateKey) {
  const h = crypto.createHash('sha256').update('US_DAILY_QUOTA:' + String(dateKey || '')).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

function itemRegionFromRow(row) {
  if (!row) return 'KR';
  const meta = row.lifecycle_meta || row.lifecycleMeta;
  if (meta && typeof meta === 'object' && meta.activityRegion) {
    return usOps.normalizeRegion(meta.activityRegion) || 'KR';
  }
  const cat = String(row.category || '');
  if (cat.indexOf('us-') === 0) return 'US';
  const ar = row.activity_region || row.activityRegion;
  if (ar) return usOps.normalizeRegion(ar) || 'KR';
  return 'KR';
}

async function countPublishedUsOnDateKeyInTx(tx, schema, dateKey) {
  const t = qIdent(schema, 'daily_issue_review_items');
  const res = await tx.query(
    'SELECT published_at, lifecycle_meta, category, activity_region FROM ' + t + " WHERE status = 'PUBLISHED'",
  );
  let count = 0;
  (res.rows || []).forEach(function (row) {
    if (itemRegionFromRow(row) !== 'US') return;
    const when = row.published_at;
    if (!when) return;
    const slot = usOps.slotFor(when instanceof Date ? when.toISOString() : String(when));
    if (slot.dateKey === dateKey) count += 1;
  });
  return count;
}

/**
 * US ET dateKey 단위 advisory xact lock + published count (동일 트랜잭션).
 */
async function lockUsDailyPublishQuotaInTx(tx, schema, publishAtIso, trace) {
  const slot = usOps.slotFor(publishAtIso || new Date().toISOString());
  const dateKey = slot.dateKey;
  const maxPerDay = slot.maxPerDay || 3;
  const lock = advisoryKeyForUsDaily(dateKey);
  const locked = await tx.query('SELECT pg_try_advisory_xact_lock($1, $2) AS ok', lock);
  if (!locked.rows || !locked.rows[0] || locked.rows[0].ok !== true) {
    return { ok: false, error: 'US_DAILY_QUOTA_LOCK_BUSY', dateKey: dateKey };
  }
  if (typeof trace === 'function') {
    trace({ phase: 'us_daily_quota_lock', dateKey: dateKey, ts: Date.now() });
  }
  const count = await countPublishedUsOnDateKeyInTx(tx, schema, dateKey);
  if (count >= maxPerDay) {
    return { ok: false, error: 'US_DAILY_MAX_REACHED', dateKey: dateKey, count: count, maxPerDay: maxPerDay };
  }
  return { ok: true, dateKey: dateKey, count: count, maxPerDay: maxPerDay };
}

module.exports = {
  lockUsDailyPublishQuotaInTx: lockUsDailyPublishQuotaInTx,
  countPublishedUsOnDateKeyInTx: countPublishedUsOnDateKeyInTx,
  advisoryKeyForUsDaily: advisoryKeyForUsDaily,
};
