'use strict';

/**
 * 개발/단위 테스트용 메모리 SQL executor
 * — 실 pg 없이도 SQL repository의 transaction·lockVersion·audit 원자성 검증
 */

const mapper = require('./daily-issue-review-sql-mapper');

function clone(v) {
  return JSON.parse(JSON.stringify(v == null ? null : v));
}

function createMemorySqlExecutor(options) {
  const opt = options || {};
  const schemaName = opt.schemaName || 'daily_issue_test';
  const state = {
    review_items: new Map(),
    sources: new Map(),
    evidences: new Map(),
    claims: new Map(),
    item_sources: [],
    item_evidences: [],
    item_claims: [],
    claim_evidences: [],
    claim_sources: [],
    updates: [],
    audits: [],
    meta: new Map([['schema_version', '1']]),
    tablesReady: opt.tablesReady !== false,
  };

  function snapshot() {
    return {
      review_items: new Map(Array.from(state.review_items.entries()).map(function (e) {
        return [e[0], clone(e[1])];
      })),
      sources: new Map(Array.from(state.sources.entries()).map(function (e) {
        return [e[0], clone(e[1])];
      })),
      evidences: new Map(Array.from(state.evidences.entries()).map(function (e) {
        return [e[0], clone(e[1])];
      })),
      claims: new Map(Array.from(state.claims.entries()).map(function (e) {
        return [e[0], clone(e[1])];
      })),
      item_sources: clone(state.item_sources),
      item_evidences: clone(state.item_evidences),
      item_claims: clone(state.item_claims),
      claim_evidences: clone(state.claim_evidences),
      claim_sources: clone(state.claim_sources),
      updates: clone(state.updates),
      audits: clone(state.audits),
      meta: new Map(state.meta),
      tablesReady: state.tablesReady,
    };
  }

  function restore(snap) {
    Object.keys(snap).forEach(function (k) {
      state[k] = snap[k];
    });
  }

  function allItems() {
    return Array.from(state.review_items.values());
  }

  function execQuery(sql, params) {
    const s = String(sql || '').replace(/\s+/g, ' ').trim();
    const p = params || [];

    if (/^SELECT 1 AS ok$/i.test(s)) return { rows: [{ ok: 1 }], rowCount: 1 };

    if (/daily_issue_review_items.*LIMIT 0/i.test(s)) {
      if (!state.tablesReady) {
        const err = new Error('relation does not exist');
        err.code = '42P01';
        throw err;
      }
      return { rows: [], rowCount: 0 };
    }

    if (/daily_issue_review_items["\s]*WHERE id = \$1 FOR UPDATE/i.test(s) ||
        /daily_issue_review_items["\s]*WHERE id = \$1$/i.test(s) ||
        /SELECT id FROM .*daily_issue_review_items["\s]*WHERE id = \$1 FOR UPDATE/i.test(s)) {
      const row = state.review_items.get(String(p[0]));
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }

    if (/daily_issue_review_items["\s]*WHERE candidate_id = \$1/i.test(s)) {
      const rows = allItems().filter(function (r) {
        return r.candidate_id === String(p[0]);
      });
      rows.sort(function (a, b) {
        return Number(b.version) - Number(a.version);
      });
      return { rows: rows.length ? [clone(rows[0])] : [], rowCount: rows.length ? 1 : 0 };
    }

    if (/daily_issue_review_items["\s]*WHERE status = ANY/i.test(s)) {
      const want = p[0] || [];
      const rows = allItems().filter(function (r) {
        return want.indexOf(r.status) >= 0;
      });
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/daily_issue_review_items["\s]*WHERE status = \$1 AND category/i.test(s)) {
      const rows = allItems().filter(function (r) {
        return r.status === p[0] && r.category === p[1];
      });
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/daily_issue_review_items["\s]*WHERE status = \$1$/i.test(s)) {
      const rows = allItems().filter(function (r) {
        return r.status === p[0];
      });
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/daily_issue_review_items["\s]*WHERE status = ANY\(\$1::text\[\]\) AND COALESCE/i.test(s)) {
      const want = p[0] || [];
      const cutoff = Date.parse(p[1]);
      const rows = allItems().filter(function (r) {
        if (want.indexOf(r.status) < 0) return false;
        const t = Date.parse(r.published_at || r.retired_at || r.reviewed_at || r.queued_at || '');
        return Number.isFinite(t) && t >= cutoff;
      });
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/daily_issue_review_items["\s]*WHERE /i.test(s) && /OR/.test(s)) {
      const rows = allItems().filter(function (r) {
        return p.some(function (val) {
          return (
            r.candidate_id === val ||
            r.content_signature === val ||
            r.cluster_signature === val ||
            r.source_set_signature === val ||
            r.claim_set_signature === val ||
            r.event_identity_signature === val
          );
        });
      });
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/daily_issue_review_items["\s]*WHERE status = \$1 ORDER BY/i.test(s)) {
      const rows = allItems().filter(function (r) {
        return r.status === p[0];
      });
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/daily_issue_review_items["\s]*ORDER BY/i.test(s) || /SELECT \* FROM .*daily_issue_review_items["\s]*$/i.test(s)) {
      const rows = allItems();
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/GROUP BY status/i.test(s)) {
      const counts = {};
      allItems().forEach(function (r) {
        counts[r.status] = (counts[r.status] || 0) + 1;
      });
      return {
        rows: Object.keys(counts).map(function (st) {
          return { status: st, n: counts[st] };
        }),
        rowCount: Object.keys(counts).length,
      };
    }

    if (/daily_issue_sources["\s]*WHERE id = \$1/i.test(s)) {
      const row = state.sources.get(String(p[0]));
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (/daily_issue_evidences["\s]*WHERE id = \$1/i.test(s)) {
      const row = state.evidences.get(String(p[0]));
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (/daily_issue_claims["\s]*WHERE id = \$1/i.test(s)) {
      const row = state.claims.get(String(p[0]));
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }

    if (/INSERT INTO .*daily_issue_review_items/i.test(s)) {
      const row = {
        id: p[0],
        candidate_id: p[1],
        cluster_id: p[2],
        status: p[3],
        title: p[4],
        category: p[5],
        version: p[6],
        lock_version: p[7],
        content_signature: p[8],
        cluster_signature: p[9],
        source_set_signature: p[10],
        claim_set_signature: p[11],
        event_identity_signature: p[12],
        prior_issue_id: p[13],
        follow_up_of: p[14],
        update_type: p[15],
        quality_status: p[16],
        freshness_status: p[17],
        freshness_class: p[18],
        quality_checked_at: p[19],
        freshness_checked_at: p[20],
        source_count: p[21],
        independent_source_count: p[22],
        latest_source_published_at: p[23],
        expires_at: p[24],
        publish_expires_at: p[25],
        queued_at: p[26],
        reviewed_at: p[27],
        approved_at: p[28],
        published_at: p[29],
        retired_at: p[30],
        superseded_at: p[31],
        reviewer_id: p[32],
        review_reason: p[33],
        hold_reason: p[34],
        reject_reason: p[35],
        retire_reason: p[36],
        display_priority: p[37],
        lifecycle_meta: p[38],
        quality_meta: p[39],
        freshness_meta: p[40],
        duplicate_meta: p[41],
        event_identity: p[42],
        update_history: p[43],
        confirmed_summary: p[44],
        discussion_prompt: p[45],
        display_groups: p[46],
        document: p[47],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      for (const existing of state.review_items.values()) {
        if (existing.candidate_id === row.candidate_id && Number(existing.version) === Number(row.version)) {
          const err = new Error('duplicate key');
          err.code = '23505';
          throw err;
        }
      }
      if (state.review_items.has(row.id)) {
        const err = new Error('duplicate key');
        err.code = '23505';
        throw err;
      }
      state.review_items.set(row.id, row);
      return { rows: [clone(row)], rowCount: 1 };
    }

    if (/UPDATE .*daily_issue_review_items["\s]*SET/i.test(s)) {
      // last three params: id, expectedStatus, expectedLockVersion
      const id = p[p.length - 3];
      const expectedStatus = p[p.length - 2];
      const expectedLock = Number(p[p.length - 1]);
      const cur = state.review_items.get(String(id));
      if (!cur || cur.status !== expectedStatus || Number(cur.lock_version) !== expectedLock) {
        return { rows: [], rowCount: 0 };
      }
      const next = clone(cur);
      const fields = [
        'status', 'title', 'category', 'content_signature', 'cluster_signature', 'source_set_signature',
        'claim_set_signature', 'event_identity_signature', 'prior_issue_id', 'follow_up_of', 'update_type',
        'quality_status', 'freshness_status', 'freshness_class', 'quality_checked_at', 'freshness_checked_at',
        'source_count', 'independent_source_count', 'latest_source_published_at', 'expires_at', 'publish_expires_at',
        'queued_at', 'reviewed_at', 'approved_at', 'published_at', 'retired_at', 'superseded_at',
        'reviewer_id', 'review_reason', 'hold_reason', 'reject_reason', 'retire_reason', 'display_priority',
        'lifecycle_meta', 'quality_meta', 'freshness_meta', 'duplicate_meta', 'event_identity', 'update_history',
        'confirmed_summary', 'discussion_prompt', 'display_groups', 'document',
      ];
      fields.forEach(function (f, i) {
        next[f] = p[i];
      });
      next.lock_version = Number(cur.lock_version) + 1;
      next.updated_at = new Date().toISOString();
      state.review_items.set(next.id, next);
      return { rows: [clone(next)], rowCount: 1 };
    }

    if (/INSERT INTO .*daily_issue_sources/i.test(s)) {
      const row = {
        id: p[0],
        publisher: p[1],
        title: p[2],
        url: p[3],
        normalized_url: p[4],
        published_at: p[5],
        content_hash: p[20],
        raw_text_storage_policy: p[22],
        metadata: p[23],
      };
      state.sources.set(row.id, row);
      return { rows: [row], rowCount: 1 };
    }

    if (/INSERT INTO .*daily_issue_evidences/i.test(s)) {
      const row = { id: p[0], source_id: p[1], text: p[2], text_hash: p[11], metadata: p[12] };
      state.evidences.set(row.id, row);
      return { rows: [row], rowCount: 1 };
    }

    if (/INSERT INTO .*daily_issue_claims/i.test(s)) {
      const row = {
        id: p[0],
        text: p[1],
        classification: p[2],
        variants: p[8],
        failure_reasons: p[9],
        metadata: p[11],
      };
      state.claims.set(row.id, row);
      return { rows: [row], rowCount: 1 };
    }

    if (/INSERT INTO .*daily_issue_review_item_sources/i.test(s)) {
      state.item_sources = state.item_sources.filter(function (x) {
        return !(x.review_item_id === p[0] && x.source_id === p[1]);
      });
      state.item_sources.push({ review_item_id: p[0], source_id: p[1], sort_order: p[2], relation_type: p[3] });
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO .*daily_issue_review_item_evidences/i.test(s)) {
      state.item_evidences = state.item_evidences.filter(function (x) {
        return !(x.review_item_id === p[0] && x.evidence_id === p[1]);
      });
      state.item_evidences.push({ review_item_id: p[0], evidence_id: p[1], sort_order: p[2] });
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO .*daily_issue_review_item_claims/i.test(s)) {
      state.item_claims = state.item_claims.filter(function (x) {
        return !(x.review_item_id === p[0] && x.claim_id === p[1]);
      });
      state.item_claims.push({ review_item_id: p[0], claim_id: p[1], section_type: p[2], sort_order: p[3] });
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO .*daily_issue_claim_evidences/i.test(s)) {
      state.claim_evidences.push({ claim_id: p[0], evidence_id: p[1] });
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO .*daily_issue_claim_sources/i.test(s)) {
      state.claim_sources.push({ claim_id: p[0], source_id: p[1], role: p[2] });
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO .*daily_issue_audit_logs/i.test(s)) {
      state.audits.push({
        id: p[0],
        entity_id: p[1],
        entity_type: p[2],
        from_status: p[3],
        to_status: p[4],
        action: p[5],
        actor_id: p[6],
        reason_code: p[7],
        reason_text: p[8],
        snapshot_hash: p[9],
        transaction_id: p[10],
        created_at: p[11],
        payload: p[12],
      });
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO .*daily_issue_updates/i.test(s)) {
      state.updates.push({ id: p[0], issue_id: p[1], candidate_id: p[2], update_type: p[3] });
      return { rows: [], rowCount: 1 };
    }

    if (/FROM .*daily_issue_audit_logs/i.test(s)) {
      let rows = state.audits.slice();
      if (/entity_id = \$1/i.test(s)) {
        rows = rows.filter(function (r) {
          return r.entity_id === p[0];
        });
      }
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/^BEGIN$/i.test(s) || /^COMMIT$/i.test(s) || /^ROLLBACK$/i.test(s) || /set_config/i.test(s)) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error('memory sql unsupported: ' + s.slice(0, 120));
  }

  const log = [];
  let chain = Promise.resolve();

  async function query(sql, params) {
    log.push({ sql: String(sql).slice(0, 200), params: params });
    return execQuery(sql, params);
  }

  function withTransaction(callback) {
    const run = chain.then(async function () {
      const snap = snapshot();
      const tx = {
        query: async function (sql, params) {
          log.push({ sql: String(sql).slice(0, 200), params: params, tx: true });
          return execQuery(sql, params);
        },
        schemaName: schemaName,
      };
      try {
        return await callback(tx);
      } catch (e) {
        restore(snap);
        throw e;
      }
    });
    chain = run.then(
      function () {},
      function () {},
    );
    return run;
  }

  return {
    ok: true,
    kind: 'memory-sql',
    schemaName: schemaName,
    query: query,
    withTransaction: withTransaction,
    healthCheck: async function () {
      if (!state.tablesReady) {
        return { ok: false, error: 'DATABASE_UNAVAILABLE' };
      }
      return { ok: true, kind: 'memory-sql', schema: schemaName };
    },
    end: async function () {},
    __log: log,
    __state: state,
    __resetDailyIssueTables: function () {
      state.review_items.clear();
      state.sources.clear();
      state.evidences.clear();
      state.claims.clear();
      state.item_sources = [];
      state.item_evidences = [];
      state.item_claims = [];
      state.claim_evidences = [];
      state.claim_sources = [];
      state.updates = [];
      state.audits = [];
    },
  };
}

module.exports = {
  createMemorySqlExecutor: createMemorySqlExecutor,
};
