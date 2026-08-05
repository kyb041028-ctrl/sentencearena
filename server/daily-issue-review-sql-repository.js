'use strict';

/**
 * 실 PostgreSQL SQL repository (query/transaction 주입)
 * — 상태 변경 + audit 는 동일 transaction
 * — DAILY_ISSUE_DATABASE_URL / injected executor 만 사용
 */

const crypto = require('crypto');
const lifecycle = require('../shared/daily-issue-lifecycle-core');
const contract = require('../shared/daily-issue-review-repository-contract');
const mapper = require('./daily-issue-review-sql-mapper');

function qIdent(schema, table) {
  const s = String(schema || 'public').replace(/"/g, '');
  const t = String(table).replace(/"/g, '');
  return '"' + s + '"."' + t + '"';
}

function mapPgError(e) {
  const code = e && (e.code || e.constraint);
  const msg = String((e && e.message) || e || '');
  if (code === '23505' || /unique|duplicate/i.test(msg)) {
    return contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION;
  }
  if (e && e.code && Object.prototype.hasOwnProperty.call(contract.ERROR_CODES, e.code)) {
    return e.code;
  }
  return contract.ERROR_CODES.TRANSACTION_FAILED;
}

async function upsertSource(tx, schema, src) {
  const t = qIdent(schema, 'daily_issue_sources');
  const existing = await tx.query('SELECT id, content_hash, url FROM ' + t + ' WHERE id = $1', [src.id]);
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (
      (row.content_hash && src.content_hash && row.content_hash !== src.content_hash) ||
      (row.url && src.url && row.url !== src.url)
    ) {
      throw Object.assign(new Error(contract.ERROR_CODES.SCHEMA_VALIDATION_FAILED), {
        code: contract.ERROR_CODES.SCHEMA_VALIDATION_FAILED,
        message: 'source id collision with different content: ' + src.id,
      });
    }
    return;
  }
  await tx.query(
    'INSERT INTO ' +
      t +
      ' (id, publisher, title, url, normalized_url, published_at, updated_at, feed_seen_at, retrieved_at,' +
      ' first_seen_at, last_seen_at, source_event_date, source_event_date_confidence, source_type, document_type,' +
      ' origin_domain, author, primary_source_url, language, country, content_hash, normalized_text_hash,' +
      ' raw_text_storage_policy, metadata)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)',
    [
      src.id,
      src.publisher,
      src.title,
      src.url,
      src.normalized_url,
      src.published_at,
      src.updated_at,
      src.feed_seen_at,
      src.retrieved_at,
      src.first_seen_at,
      src.last_seen_at,
      src.source_event_date,
      src.source_event_date_confidence,
      src.source_type,
      src.document_type,
      src.origin_domain,
      src.author,
      src.primary_source_url,
      src.language,
      src.country,
      src.content_hash,
      src.normalized_text_hash,
      src.raw_text_storage_policy,
      src.metadata,
    ],
  );
}

async function upsertEvidence(tx, schema, ev) {
  const t = qIdent(schema, 'daily_issue_evidences');
  const existing = await tx.query('SELECT id, text_hash, text FROM ' + t + ' WHERE id = $1', [ev.id]);
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.text && ev.text && row.text !== ev.text) {
      throw Object.assign(new Error(contract.ERROR_CODES.SCHEMA_VALIDATION_FAILED), {
        code: contract.ERROR_CODES.SCHEMA_VALIDATION_FAILED,
        message: 'evidence id collision with different text: ' + ev.id,
      });
    }
    return;
  }
  await tx.query(
    'INSERT INTO ' +
      t +
      ' (id, source_id, text, normalized_text, start_offset, end_offset, speaker, subject, published_at,' +
      ' evidence_type, extraction_confidence, text_hash, metadata)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [
      ev.id,
      ev.source_id,
      ev.text,
      ev.normalized_text,
      ev.start_offset,
      ev.end_offset,
      ev.speaker,
      ev.subject,
      ev.published_at,
      ev.evidence_type,
      ev.extraction_confidence,
      ev.text_hash,
      ev.metadata,
    ],
  );
}

async function upsertClaim(tx, schema, cl) {
  const t = qIdent(schema, 'daily_issue_claims');
  const existing = await tx.query('SELECT id, text FROM ' + t + ' WHERE id = $1', [cl.id]);
  if (existing.rows[0]) {
    if (existing.rows[0].text !== cl.text) {
      throw Object.assign(new Error(contract.ERROR_CODES.SCHEMA_VALIDATION_FAILED), {
        code: contract.ERROR_CODES.SCHEMA_VALIDATION_FAILED,
        message: 'claim id collision with different text: ' + cl.id,
      });
    }
    return;
  }
  await tx.query(
    'INSERT INTO ' +
      t +
      ' (id, text, classification, subject, speaker, confidence, publication_eligibility, is_core,' +
      ' variants, failure_reasons, text_hash, metadata)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [
      cl.id,
      cl.text,
      cl.classification,
      cl.subject,
      cl.speaker,
      cl.confidence,
      cl.publication_eligibility,
      cl.is_core,
      cl.variants,
      cl.failure_reasons,
      cl.text_hash,
      cl.metadata,
    ],
  );
}

async function linkItemGraph(tx, schema, item) {
  const sources = mapper.extractSources(item);
  const evidences = mapper.extractEvidences(item);
  const claims = mapper.extractClaims(item);

  for (let i = 0; i < sources.length; i++) {
    await upsertSource(tx, schema, sources[i]);
    await tx.query(
      'INSERT INTO ' +
        qIdent(schema, 'daily_issue_review_item_sources') +
        ' (review_item_id, source_id, sort_order, relation_type) VALUES ($1,$2,$3,$4)' +
        ' ON CONFLICT (review_item_id, source_id) DO UPDATE SET sort_order = EXCLUDED.sort_order, relation_type = EXCLUDED.relation_type',
      [item.id, sources[i].id, sources[i].sort_order, sources[i].relation_type],
    );
  }

  for (let i = 0; i < evidences.length; i++) {
    if (!evidences[i].source_id) continue;
    await upsertEvidence(tx, schema, evidences[i]);
    await tx.query(
      'INSERT INTO ' +
        qIdent(schema, 'daily_issue_review_item_evidences') +
        ' (review_item_id, evidence_id, sort_order) VALUES ($1,$2,$3)' +
        ' ON CONFLICT (review_item_id, evidence_id) DO UPDATE SET sort_order = EXCLUDED.sort_order',
      [item.id, evidences[i].id, evidences[i].sort_order],
    );
  }

  for (let i = 0; i < claims.length; i++) {
    const cl = claims[i];
    await upsertClaim(tx, schema, cl);
    await tx.query(
      'INSERT INTO ' +
        qIdent(schema, 'daily_issue_review_item_claims') +
        ' (review_item_id, claim_id, section_type, sort_order) VALUES ($1,$2,$3,$4)' +
        ' ON CONFLICT (review_item_id, claim_id) DO UPDATE SET section_type = EXCLUDED.section_type, sort_order = EXCLUDED.sort_order',
      [item.id, cl.id, cl.section_type, cl.sort_order],
    );
    for (let j = 0; j < (cl.evidence_ids || []).length; j++) {
      await tx.query(
        'INSERT INTO ' +
          qIdent(schema, 'daily_issue_claim_evidences') +
          ' (claim_id, evidence_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [cl.id, cl.evidence_ids[j]],
      );
    }
    for (let j = 0; j < (cl.supporting_source_ids || []).length; j++) {
      await tx.query(
        'INSERT INTO ' +
          qIdent(schema, 'daily_issue_claim_sources') +
          ' (claim_id, source_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [cl.id, cl.supporting_source_ids[j], 'SUPPORTING'],
      );
    }
    for (let j = 0; j < (cl.contradicting_source_ids || []).length; j++) {
      await tx.query(
        'INSERT INTO ' +
          qIdent(schema, 'daily_issue_claim_sources') +
          ' (claim_id, source_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [cl.id, cl.contradicting_source_ids[j], 'CONTRADICTING'],
      );
    }
  }
}

async function insertReviewItemRow(tx, schema, item) {
  const row = mapper.itemToRow(item);
  const t = qIdent(schema, 'daily_issue_review_items');
  await tx.query(
    'INSERT INTO ' +
      t +
      ' (id, candidate_id, cluster_id, status, title, category, version, lock_version,' +
      ' content_signature, cluster_signature, source_set_signature, claim_set_signature, event_identity_signature,' +
      ' prior_issue_id, follow_up_of, update_type, quality_status, freshness_status, freshness_class,' +
      ' quality_checked_at, freshness_checked_at, source_count, independent_source_count, latest_source_published_at,' +
      ' expires_at, publish_expires_at, queued_at, reviewed_at, approved_at, published_at, retired_at, superseded_at,' +
      ' reviewer_id, review_reason, hold_reason, reject_reason, retire_reason, display_priority,' +
      ' lifecycle_meta, quality_meta, freshness_meta, duplicate_meta, event_identity, update_history,' +
      ' confirmed_summary, discussion_prompt, display_groups, document)' +
      ' VALUES (' +
      Array.from({ length: 48 }, function (_, i) {
        return '$' + (i + 1);
      }).join(',') +
      ')',
    [
      row.id,
      row.candidate_id,
      row.cluster_id,
      row.status,
      row.title,
      row.category,
      row.version,
      row.lock_version,
      row.content_signature,
      row.cluster_signature,
      row.source_set_signature,
      row.claim_set_signature,
      row.event_identity_signature,
      row.prior_issue_id,
      row.follow_up_of,
      row.update_type,
      row.quality_status,
      row.freshness_status,
      row.freshness_class,
      row.quality_checked_at,
      row.freshness_checked_at,
      row.source_count,
      row.independent_source_count,
      row.latest_source_published_at,
      row.expires_at,
      row.publish_expires_at,
      row.queued_at,
      row.reviewed_at,
      row.approved_at,
      row.published_at,
      row.retired_at,
      row.superseded_at,
      row.reviewer_id,
      row.review_reason,
      row.hold_reason,
      row.reject_reason,
      row.retire_reason,
      row.display_priority,
      row.lifecycle_meta,
      row.quality_meta,
      row.freshness_meta,
      row.duplicate_meta,
      row.event_identity,
      row.update_history,
      row.confirmed_summary,
      row.discussion_prompt,
      row.display_groups,
      row.document,
    ],
  );
  await linkItemGraph(tx, schema, item);
}

async function updateReviewItemRow(tx, schema, item, expectedStatus, expectedLockVersion) {
  const row = mapper.itemToRow(item);
  const t = qIdent(schema, 'daily_issue_review_items');
  const result = await tx.query(
    'UPDATE ' +
      t +
      ' SET status=$1, title=$2, category=$3, content_signature=$4, cluster_signature=$5,' +
      ' source_set_signature=$6, claim_set_signature=$7, event_identity_signature=$8,' +
      ' prior_issue_id=$9, follow_up_of=$10, update_type=$11, quality_status=$12, freshness_status=$13,' +
      ' freshness_class=$14, quality_checked_at=$15, freshness_checked_at=$16, source_count=$17,' +
      ' independent_source_count=$18, latest_source_published_at=$19, expires_at=$20, publish_expires_at=$21,' +
      ' queued_at=$22, reviewed_at=$23, approved_at=$24, published_at=$25, retired_at=$26, superseded_at=$27,' +
      ' reviewer_id=$28, review_reason=$29, hold_reason=$30, reject_reason=$31, retire_reason=$32,' +
      ' display_priority=$33, lifecycle_meta=$34, quality_meta=$35, freshness_meta=$36, duplicate_meta=$37,' +
      ' event_identity=$38, update_history=$39, confirmed_summary=$40, discussion_prompt=$41, display_groups=$42,' +
      ' document=$43, lock_version = lock_version + 1, updated_at = now()' +
      ' WHERE id=$44 AND status=$45 AND lock_version=$46' +
      ' RETURNING *',
    [
      row.status,
      row.title,
      row.category,
      row.content_signature,
      row.cluster_signature,
      row.source_set_signature,
      row.claim_set_signature,
      row.event_identity_signature,
      row.prior_issue_id,
      row.follow_up_of,
      row.update_type,
      row.quality_status,
      row.freshness_status,
      row.freshness_class,
      row.quality_checked_at,
      row.freshness_checked_at,
      row.source_count,
      row.independent_source_count,
      row.latest_source_published_at,
      row.expires_at,
      row.publish_expires_at,
      row.queued_at,
      row.reviewed_at,
      row.approved_at,
      row.published_at,
      row.retired_at,
      row.superseded_at,
      row.reviewer_id,
      row.review_reason,
      row.hold_reason,
      row.reject_reason,
      row.retire_reason,
      row.display_priority,
      row.lifecycle_meta,
      row.quality_meta,
      row.freshness_meta,
      row.duplicate_meta,
      row.event_identity,
      row.update_history,
      row.confirmed_summary,
      row.discussion_prompt,
      row.display_groups,
      row.document,
      item.id,
      expectedStatus,
      expectedLockVersion,
    ],
  );
  return result;
}

async function appendAudits(tx, schema, events, transactionId) {
  const t = qIdent(schema, 'daily_issue_audit_logs');
  for (let i = 0; i < (events || []).length; i++) {
    const p = events[i] || {};
    if (tx.__failAudit) {
      throw Object.assign(new Error(contract.ERROR_CODES.AUDIT_WRITE_FAILED), {
        code: contract.ERROR_CODES.AUDIT_WRITE_FAILED,
      });
    }
    const id = p.id || 'aud_' + crypto.randomBytes(8).toString('hex');
    await tx.query(
      'INSERT INTO ' +
        t +
        ' (id, entity_id, entity_type, from_status, to_status, action, actor_id, reason_code, reason_text,' +
        ' snapshot_hash, transaction_id, created_at, payload)' +
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [
        id,
        p.entityId,
        p.entityType || 'review_item',
        p.fromStatus || null,
        p.toStatus || null,
        p.action || 'unknown',
        p.actorId || null,
        p.reasonCode || null,
        p.reasonText || '',
        p.snapshotHash || null,
        p.transactionId || transactionId || null,
        p.timestamp || new Date().toISOString(),
        p.payload ? mapper.jsonbParam(p.payload) : null,
      ],
    );
  }
}

async function loadItemById(txOrExec, schema, id) {
  const t = qIdent(schema, 'daily_issue_review_items');
  let res = await txOrExec.query('SELECT * FROM ' + t + ' WHERE id = $1', [String(id)]);
  if (!res.rows[0]) {
    res = await txOrExec.query('SELECT * FROM ' + t + ' WHERE candidate_id = $1 ORDER BY version DESC LIMIT 1', [
      String(id),
    ]);
  }
  return res.rows[0] ? mapper.rowToItem(res.rows[0]) : null;
}

/**
 * @param {object} options
 * @param {object} options.executor - { query, withTransaction, schemaName, healthCheck?, end? }
 */
function createSqlDailyIssueReviewRepository(options) {
  const opt = options || {};
  const executor = opt.executor;
  if (!executor || typeof executor.withTransaction !== 'function' || typeof executor.query !== 'function') {
    throw new Error('SQL repository requires executor with query + withTransaction');
  }
  const schema = executor.schemaName || opt.schemaName || 'public';
  let initialized = false;
  let failAudit = false;
  let failWrite = false;
  let failSource = false;

  function setTestHooks(hooks) {
    const h = hooks || {};
    failAudit = !!h.failAppend || !!h.failAudit;
    failWrite = !!h.failPersist || !!h.failWrite;
    failSource = !!h.failSource;
  }

  function clearTestHooks() {
    failAudit = false;
    failWrite = false;
    failSource = false;
  }

  async function runTxn(mutator) {
    try {
      return await executor.withTransaction(async function (tx) {
        tx.__failAudit = failAudit;
        tx.__failWrite = failWrite;
        tx.__failSource = failSource;
        if (failWrite) {
          throw Object.assign(new Error(contract.ERROR_CODES.PERSIST_FAILED), {
            code: contract.ERROR_CODES.PERSIST_FAILED,
          });
        }
        return await mutator(tx);
      });
    } catch (e) {
      return {
        ok: false,
        error: mapPgError(e),
        message: String(e.message || e),
        rolledBack: true,
      };
    }
  }

  const repo = {
    kind: contract.REPOSITORY_KINDS.DB,
    schemaName: schema,
    setTestHooks: setTestHooks,
    clearTestHooks: clearTestHooks,
    snapshotHash: mapper.snapshotHash,
    end: function () {
      return executor.end ? executor.end() : Promise.resolve();
    },

    initialize: async function () {
      const hc = await (executor.healthCheck ? executor.healthCheck() : Promise.resolve({ ok: true }));
      if (!hc.ok) return hc;
      // Verify table exists
      try {
        await executor.query('SELECT 1 FROM ' + qIdent(schema, 'daily_issue_review_items') + ' LIMIT 0');
      } catch (e) {
        return contract.repoError(
          contract.ERROR_CODES.MIGRATION_REQUIRED,
          'daily_issue_review_items missing — apply migration first',
        );
      }
      initialized = true;
      return { ok: true, kind: repo.kind, schema: schema };
    },

    healthCheck: async function () {
      if (executor.healthCheck) {
        const hc = await executor.healthCheck();
        if (!hc.ok) return hc;
      }
      try {
        await executor.query('SELECT 1 FROM ' + qIdent(schema, 'daily_issue_review_items') + ' LIMIT 0');
        return { ok: true, kind: repo.kind, initialized: initialized, schema: schema };
      } catch (e) {
        return contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE, String(e.message || e));
      }
    },

    getById: async function (id) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      try {
        const item = await loadItemById(executor, schema, id);
        if (!item) return contract.repoError(contract.ERROR_CODES.ITEM_NOT_FOUND);
        return { ok: true, item: item };
      } catch (e) {
        return contract.repoError(mapPgError(e), String(e.message || e));
      }
    },

    getByCandidateId: async function (candidateId) {
      return repo.getById(candidateId);
    },

    findByStatus: async function (statuses) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const want = Array.isArray(statuses) ? statuses : [statuses];
      const res = await executor.query(
        'SELECT * FROM ' + qIdent(schema, 'daily_issue_review_items') + ' WHERE status = ANY($1::text[])',
        [want],
      );
      return { ok: true, items: res.rows.map(mapper.rowToItem) };
    },

    list: async function (filters) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const f = filters || {};
      let sql = 'SELECT * FROM ' + qIdent(schema, 'daily_issue_review_items');
      const params = [];
      if (f.status) {
        params.push(f.status);
        sql += ' WHERE status = $1';
      }
      sql += ' ORDER BY queued_at DESC NULLS LAST';
      const res = await executor.query(sql, params);
      const items = res.rows.map(mapper.rowToItem);
      return { ok: true, items: items, count: items.length };
    },

    findDuplicateMatches: async function (signatures) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const sig = signatures || {};
      const clauses = [];
      const params = [];
      function push(col, val) {
        if (!val) return;
        params.push(val);
        clauses.push(col + ' = $' + params.length);
      }
      push('candidate_id', sig.candidateId);
      push('content_signature', sig.contentSignature);
      push('cluster_signature', sig.clusterSignature);
      push('source_set_signature', sig.sourceSetSignature);
      push('claim_set_signature', sig.claimSetSignature);
      push('event_identity_signature', sig.eventIdentitySignature);
      if (!clauses.length) return { ok: true, items: [] };
      const res = await executor.query(
        'SELECT * FROM ' + qIdent(schema, 'daily_issue_review_items') + ' WHERE ' + clauses.join(' OR '),
        params,
      );
      return { ok: true, items: res.rows.map(mapper.rowToItem) };
    },

    insertReviewItems: async function (items, auditEvents, opts) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      if (opts && opts.dryRun) {
        return { ok: true, dryRun: true, items: (items || []).map(contract.normalizeReviewItem) };
      }
      return runTxn(async function (tx) {
        const txnId = 'txn_' + crypto.randomBytes(6).toString('hex');
        const normalized = [];
        for (let i = 0; i < (items || []).length; i++) {
          const item = contract.normalizeReviewItem(items[i]);
          if (tx.__failSource) {
            throw Object.assign(new Error(contract.ERROR_CODES.PERSIST_FAILED), {
              code: contract.ERROR_CODES.PERSIST_FAILED,
              message: 'forced source insert failure',
            });
          }
          try {
            await insertReviewItemRow(tx, schema, item);
          } catch (e) {
            if (e && e.code === '23505') {
              throw Object.assign(new Error(contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION), {
                code: contract.ERROR_CODES.DUPLICATE_CANDIDATE_VERSION,
              });
            }
            throw e;
          }
          normalized.push(item);
        }
        await appendAudits(tx, schema, auditEvents, txnId);
        return { ok: true, items: normalized, transactionId: txnId };
      });
    },

    transitionReviewItem: async function (params) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const p = params || {};
      if (p.dryRun) {
        return { ok: true, dryRun: true, item: contract.normalizeReviewItem(p.nextItem) };
      }
      return runTxn(async function (tx) {
        const txnId = 'txn_' + crypto.randomBytes(6).toString('hex');
        const t = qIdent(schema, 'daily_issue_review_items');
        // Row lock
        let curRes = await tx.query('SELECT * FROM ' + t + ' WHERE id = $1 FOR UPDATE', [p.id]);
        if (!curRes.rows[0]) {
          curRes = await tx.query('SELECT * FROM ' + t + ' WHERE candidate_id = $1 FOR UPDATE', [p.id]);
        }
        if (!curRes.rows[0]) {
          throw Object.assign(new Error(contract.ERROR_CODES.ITEM_NOT_FOUND), {
            code: contract.ERROR_CODES.ITEM_NOT_FOUND,
          });
        }
        const cur = mapper.rowToItem(curRes.rows[0]);
        if (p.expectedStatus != null && cur.status !== p.expectedStatus) {
          throw Object.assign(new Error(contract.ERROR_CODES.STATUS_CHANGED), {
            code: contract.ERROR_CODES.STATUS_CHANGED,
          });
        }
        if (p.expectedLockVersion != null && Number(cur.lockVersion) !== Number(p.expectedLockVersion)) {
          throw Object.assign(new Error(contract.ERROR_CODES.STALE_VERSION), {
            code: contract.ERROR_CODES.STALE_VERSION,
          });
        }
        const next = contract.normalizeReviewItem(p.nextItem || cur);
        next.id = cur.id;
        next.candidateId = cur.candidateId;
        const upd = await updateReviewItemRow(tx, schema, next, cur.status, cur.lockVersion);
        if (!upd.rowCount) {
          throw Object.assign(new Error(contract.ERROR_CODES.CONCURRENT_MODIFICATION), {
            code: contract.ERROR_CODES.CONCURRENT_MODIFICATION,
          });
        }
        await linkItemGraph(tx, schema, next);
        await appendAudits(tx, schema, p.auditEvents, txnId);
        const saved = mapper.rowToItem(upd.rows[0]);
        return { ok: true, item: saved, fromStatus: cur.status, toStatus: saved.status, transactionId: txnId };
      });
    },

    applyExistingIssueUpdate: async function (params) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const p = params || {};
      if (p.dryRun) return { ok: true, dryRun: true, issue: p.mergedIssue };
      return runTxn(async function (tx) {
        const txnId = 'txn_' + crypto.randomBytes(6).toString('hex');
        const merged = contract.normalizeReviewItem(p.mergedIssue);
        const t = qIdent(schema, 'daily_issue_review_items');
        await tx.query('SELECT id FROM ' + t + ' WHERE id = $1 FOR UPDATE', [merged.id]);
        const expectedLock = Number(merged.lockVersion) || 1;
        // applyUpdate increments lock in repo; merged may already include content
        const baseLock = expectedLock;
        merged.lockVersion = baseLock;
        const upd = await updateReviewItemRow(tx, schema, merged, 'PUBLISHED', baseLock);
        if (!upd.rowCount) {
          // try without status constraint if already merged status
          throw Object.assign(new Error(contract.ERROR_CODES.CONCURRENT_MODIFICATION), {
            code: contract.ERROR_CODES.CONCURRENT_MODIFICATION,
          });
        }
        await linkItemGraph(tx, schema, merged);
        if (p.closedItem) {
          const closed = contract.normalizeReviewItem(p.closedItem);
          const curClosed = await loadItemById(tx, schema, closed.id);
          if (curClosed) {
            await updateReviewItemRow(tx, schema, closed, curClosed.status, curClosed.lockVersion);
          }
        }
        if (p.updateRow) {
          const u = p.updateRow;
          await tx.query(
            'INSERT INTO ' +
              qIdent(schema, 'daily_issue_updates') +
              ' (id, issue_id, candidate_id, update_type, title, novelty_signals, added_source_ids,' +
              ' added_evidence_ids, added_claim_ids, update_reason, created_by, created_at)' +
              ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
            [
              u.id || 'upd_' + crypto.randomBytes(6).toString('hex'),
              u.issueId || merged.id,
              u.candidateId || null,
              u.updateType || 'FOLLOW_UP',
              u.title || merged.title,
              mapper.jsonbParam(u.noveltySignals || []),
              mapper.jsonbParam(u.addedSourceIds || []),
              mapper.jsonbParam(u.addedEvidenceIds || []),
              mapper.jsonbParam(u.addedClaimIds || []),
              u.updateReason || u.reasonText || null,
              u.createdBy || null,
              u.createdAt || new Date().toISOString(),
            ],
          );
        }
        await appendAudits(tx, schema, p.auditEvents, txnId);
        return { ok: true, issue: mapper.rowToItem(upd.rows[0]), transactionId: txnId };
      });
    },

    getPublishedIssues: async function (filters) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const f = filters || {};
      const params = ['PUBLISHED'];
      let sql = 'SELECT * FROM ' + qIdent(schema, 'daily_issue_review_items') + ' WHERE status = $1';
      if (f.category) {
        params.push(f.category);
        sql += ' AND category = $2';
      }
      const res = await executor.query(sql, params);
      return { ok: true, items: res.rows.map(mapper.rowToItem) };
    },

    getRecentHistoricalIssues: async function (filters) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const lookbackDays = Number((filters && filters.lookbackDays) || 30);
      const asOfMs = Date.parse((filters && filters.asOf) || new Date().toISOString()) || Date.now();
      const cutoff = new Date(asOfMs - lookbackDays * 864e5).toISOString();
      const res = await executor.query(
        'SELECT * FROM ' +
          qIdent(schema, 'daily_issue_review_items') +
          " WHERE status = ANY($1::text[]) AND COALESCE(published_at, retired_at, reviewed_at, queued_at) >= $2::timestamptz",
        [['PUBLISHED', 'RETIRED', 'REJECTED', 'SUPERSEDED', 'EXPIRED'], cutoff],
      );
      return { ok: true, items: res.rows.map(mapper.rowToItem) };
    },

    listAuditEvents: async function (filters) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const params = [];
      let sql = 'SELECT * FROM ' + qIdent(schema, 'daily_issue_audit_logs');
      if (filters && filters.entityId) {
        params.push(filters.entityId);
        sql += ' WHERE entity_id = $1';
      }
      sql += ' ORDER BY created_at ASC';
      const res = await executor.query(sql, params);
      return {
        ok: true,
        events: res.rows.map(function (r) {
          return {
            id: r.id,
            entityId: r.entity_id,
            entityType: r.entity_type,
            fromStatus: r.from_status,
            toStatus: r.to_status,
            action: r.action,
            actorId: r.actor_id,
            reasonCode: r.reason_code,
            reasonText: r.reason_text,
            snapshotHash: r.snapshot_hash,
            transactionId: r.transaction_id,
            createdAt: mapper.toIso(r.created_at),
            payload: r.payload,
          };
        }),
      };
    },

    buildManifestSnapshot: async function () {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      const res = await executor.query(
        'SELECT status, COUNT(*)::int AS n FROM ' + qIdent(schema, 'daily_issue_review_items') + ' GROUP BY status',
      );
      const counts = {};
      res.rows.forEach(function (r) {
        counts[r.status] = r.n;
      });
      let queueCount = 0;
      Object.keys(counts).forEach(function (st) {
        if (lifecycle.isQueueStatus(st)) queueCount += counts[st];
      });
      return {
        ok: true,
        manifest: {
          updatedAt: new Date().toISOString(),
          queueCount: queueCount,
          publishedCount: counts.PUBLISHED || 0,
          rejectedCount: counts.REJECTED || 0,
          retiredCount: (counts.RETIRED || 0) + (counts.SUPERSEDED || 0),
        },
      };
    },

    withTransaction: async function (callback) {
      if (!initialized) return contract.repoError(contract.ERROR_CODES.REPOSITORY_NOT_INITIALIZED);
      return runTxn(async function (tx) {
        return callback(tx);
      });
    },
  };

  return repo;
}

module.exports = {
  createSqlDailyIssueReviewRepository: createSqlDailyIssueReviewRepository,
  qIdent: qIdent,
  mapPgError: mapPgError,
};
