'use strict';

/**
 * Review item ↔ SQL row / JSONB 직렬화
 */

const crypto = require('crypto');
const contract = require('../shared/daily-issue-review-repository-contract');

function stripRawTextDeep(value) {
  if (Array.isArray(value)) return value.map(stripRawTextDeep);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).forEach(function (k) {
    if (k === 'rawText' || k === 'normalizedText') return;
    out[k] = stripRawTextDeep(value[k]);
  });
  return out;
}

function sanitizeJson(value) {
  return JSON.parse(
    JSON.stringify(stripRawTextDeep(value), function (_k, v) {
      if (typeof v === 'number' && !Number.isFinite(v)) return null;
      if (v === undefined) return undefined;
      if (v instanceof Date) return v.toISOString();
      return v;
    }),
  );
}

/** node-pg는 JS Array를 PG array로 보내 jsonb에 깨질 수 있음 → JSON 문자열로 고정 */
function jsonbParam(value) {
  if (value == null) return null;
  const cleaned = sanitizeJson(value);
  if (cleaned == null) return null;
  return JSON.stringify(cleaned);
}

function toIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function snapshotHash(item) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        id: item && item.id,
        status: item && item.status,
        contentSignature: item && item.contentSignature,
        version: item && item.version,
        lockVersion: item && item.lockVersion,
      }),
    )
    .digest('hex')
    .slice(0, 24);
}

function itemToRow(item) {
  const it = contract.normalizeReviewItem(item);
  const doc = sanitizeJson(it);
  const ei = it.eventIdentity || {};
  return {
    id: it.id,
    candidate_id: it.candidateId || it.id,
    cluster_id: it.clusterId || null,
    status: it.status,
    title: it.title || '',
    category: it.category || 'world',
    version: Number(it.version) || 1,
    lock_version: Number(it.lockVersion) || 1,
    content_signature: it.contentSignature || null,
    cluster_signature: it.clusterSignature || null,
    source_set_signature: it.sourceSetSignature || null,
    claim_set_signature: it.claimSetSignature || null,
    event_identity_signature: it.eventIdentitySignature || ei.signature || null,
    prior_issue_id: it.priorIssueId || null,
    follow_up_of: it.followUpOf || null,
    update_type: it.updateType || null,
    quality_status: it.qualityStatus || (it.qualityMeta && it.qualityMeta.status) || null,
    freshness_status: it.freshnessStatus || (it.freshnessMeta && it.freshnessMeta.status) || null,
    freshness_class: it.freshnessClass || (it.freshnessMeta && it.freshnessMeta.freshnessClass) || null,
    quality_checked_at: toIso(it.qualityCheckedAt),
    freshness_checked_at: toIso(it.freshnessCheckedAt),
    source_count: Number(it.sourceCount) || (it.sourceRefs || []).length || 0,
    independent_source_count:
      Number(it.independentSourceCount) ||
      (it.qualityMeta && it.qualityMeta.independentSourceCount) ||
      0,
    latest_source_published_at: toIso(it.latestSourcePublishedAt || it.latestPublishedAt),
    expires_at: toIso(it.expiresAt),
    publish_expires_at: toIso(it.publishExpiresAt),
    queued_at: toIso(it.queuedAt),
    reviewed_at: toIso(it.reviewedAt),
    approved_at: toIso(it.approvedAt),
    published_at: toIso(it.publishedAt),
    retired_at: toIso(it.retiredAt),
    superseded_at: toIso(it.supersededAt),
    reviewer_id: it.reviewerId || null,
    review_reason: it.reviewReason || null,
    hold_reason: it.holdReason || null,
    reject_reason: it.rejectReason || null,
    retire_reason: it.retireReason || null,
    display_priority: Number(it.displayPriority) || 0,
    lifecycle_meta: jsonbParam(it.lifecycleMeta || {}),
    quality_meta: jsonbParam(it.qualityMeta || {}),
    freshness_meta: jsonbParam(it.freshnessMeta || {}),
    duplicate_meta: jsonbParam(it.duplicateMeta || {}),
    event_identity: jsonbParam(ei),
    update_history: jsonbParam(it.updateHistory || []),
    confirmed_summary: it.confirmedSummary || null,
    discussion_prompt: it.discussionPrompt || null,
    display_groups: jsonbParam(it.displayGroups || null),
    document: jsonbParam(doc),
  };
}

function rowToItem(row) {
  if (!row) return null;
  const doc = row.document && typeof row.document === 'object' ? row.document : {};
  const merged = Object.assign({}, doc, {
    id: row.id,
    candidateId: row.candidate_id || doc.candidateId,
    clusterId: row.cluster_id != null ? row.cluster_id : doc.clusterId,
    status: row.status,
    title: row.title || doc.title,
    category: row.category || doc.category,
    version: Number(row.version) || 1,
    lockVersion: Number(row.lock_version) || 1,
    contentSignature: row.content_signature || doc.contentSignature,
    clusterSignature: row.cluster_signature || doc.clusterSignature,
    sourceSetSignature: row.source_set_signature || doc.sourceSetSignature,
    claimSetSignature: row.claim_set_signature || doc.claimSetSignature,
    eventIdentitySignature: row.event_identity_signature || doc.eventIdentitySignature,
    priorIssueId: row.prior_issue_id || doc.priorIssueId,
    followUpOf: row.follow_up_of || doc.followUpOf,
    updateType: row.update_type || doc.updateType,
    qualityStatus: row.quality_status || doc.qualityStatus,
    freshnessStatus: row.freshness_status || doc.freshnessStatus,
    freshnessClass: row.freshness_class || doc.freshnessClass,
    qualityCheckedAt: toIso(row.quality_checked_at) || doc.qualityCheckedAt,
    freshnessCheckedAt: toIso(row.freshness_checked_at) || doc.freshnessCheckedAt,
    sourceCount: Number(row.source_count) || doc.sourceCount,
    independentSourceCount: Number(row.independent_source_count) || doc.independentSourceCount,
    latestSourcePublishedAt: toIso(row.latest_source_published_at) || doc.latestSourcePublishedAt,
    expiresAt: toIso(row.expires_at) || doc.expiresAt,
    publishExpiresAt: toIso(row.publish_expires_at) || doc.publishExpiresAt,
    queuedAt: toIso(row.queued_at) || doc.queuedAt,
    reviewedAt: toIso(row.reviewed_at) || doc.reviewedAt,
    approvedAt: toIso(row.approved_at) || doc.approvedAt,
    publishedAt: toIso(row.published_at) || doc.publishedAt,
    retiredAt: toIso(row.retired_at) || doc.retiredAt,
    supersededAt: toIso(row.superseded_at) || doc.supersededAt,
    reviewerId: row.reviewer_id || doc.reviewerId,
    reviewReason: row.review_reason || doc.reviewReason,
    holdReason: row.hold_reason || doc.holdReason,
    rejectReason: row.reject_reason || doc.rejectReason,
    retireReason: row.retire_reason || doc.retireReason,
    displayPriority: Number(row.display_priority) || doc.displayPriority || 0,
    lifecycleMeta: row.lifecycle_meta || doc.lifecycleMeta || {},
    qualityMeta: row.quality_meta || doc.qualityMeta || {},
    freshnessMeta: row.freshness_meta || doc.freshnessMeta || {},
    duplicateMeta: row.duplicate_meta || doc.duplicateMeta || {},
    eventIdentity: row.event_identity || doc.eventIdentity || {},
    updateHistory: row.update_history || doc.updateHistory || [],
    confirmedSummary: row.confirmed_summary || doc.confirmedSummary,
    discussionPrompt: row.discussion_prompt || doc.discussionPrompt,
    displayGroups: row.display_groups || doc.displayGroups,
    publicationDecision:
      doc.publicationDecision ||
      ((row.lifecycle_meta || doc.lifecycleMeta || {}).publicationDecision) ||
      null,
    publicationDecisionReasons:
      doc.publicationDecisionReasons ||
      ((row.lifecycle_meta || doc.lifecycleMeta || {}).publicationDecisionReasons) ||
      [],
    requiresManualReview:
      doc.requiresManualReview != null
        ? !!doc.requiresManualReview
        : !!(row.lifecycle_meta || doc.lifecycleMeta || {}).requiresManualReview,
    autoPublishEligibleAt:
      doc.autoPublishEligibleAt ||
      ((row.lifecycle_meta || doc.lifecycleMeta || {}).autoPublishEligibleAt) ||
      null,
    autoPublishBlockedReasons:
      doc.autoPublishBlockedReasons ||
      ((row.lifecycle_meta || doc.lifecycleMeta || {}).autoPublishBlockedReasons) ||
      [],
  });
  return contract.normalizeReviewItem(stripRawTextDeep(merged));
}

function extractSources(item) {
  const list = item.sourceRefs || item.normalizedSources || item.sources || [];
  return list.map(function (s, idx) {
    const id = String(s.id || s.sourceId || 'src_' + idx);
    return {
      id: id,
      publisher: String(s.publisher || s.originDomain || 'unknown'),
      title: String(s.title || item.title || ''),
      url: String(s.url || ''),
      normalized_url: s.normalizedUrl || null,
      published_at: toIso(s.publishedAt),
      updated_at: toIso(s.updatedAt),
      feed_seen_at: toIso(s.feedSeenAt),
      retrieved_at: toIso(s.retrievedAt),
      first_seen_at: toIso(s.firstSeenAt),
      last_seen_at: toIso(s.lastSeenAt),
      source_event_date: toIso(s.sourceEventDate),
      source_event_date_confidence: s.sourceEventDateConfidence != null ? Number(s.sourceEventDateConfidence) : null,
      source_type: s.sourceType || null,
      document_type: s.documentType || null,
      origin_domain: s.originDomain || null,
      author: s.author || null,
      primary_source_url: s.primarySourceUrl || null,
      language: s.language || null,
      country: s.country || null,
      content_hash: s.contentHash || null,
      normalized_text_hash: s.normalizedTextHash || null,
      raw_text_storage_policy: 'OMIT_FULL_TEXT',
      metadata: jsonbParam(s.metadata || {}),
      sort_order: idx,
      relation_type: s.relationType || 'SUPPORTING',
    };
  });
}

function extractEvidences(item) {
  const list = item.evidences || item.evidenceRefs || [];
  return list.map(function (e, idx) {
    return {
      id: String(e.id || 'ev_' + idx),
      source_id: String(e.sourceId || e.source_id || ''),
      text: String(e.text || ''),
      normalized_text: null,
      start_offset: e.startOffset != null ? Number(e.startOffset) : null,
      end_offset: e.endOffset != null ? Number(e.endOffset) : null,
      speaker: e.speaker || null,
      subject: e.subject || null,
      published_at: toIso(e.publishedAt),
      evidence_type: e.evidenceType || null,
      extraction_confidence: e.extractionConfidence != null ? Number(e.extractionConfidence) : null,
      text_hash: e.textHash || null,
      metadata: jsonbParam(e.metadata || {}),
      sort_order: idx,
    };
  });
}

function extractClaims(item) {
  return (item.claims || []).map(function (c, idx) {
    return {
      id: String(c.id || 'cl_' + idx),
      text: String(c.text || ''),
      classification: String(c.classification || 'UNVERIFIED'),
      subject: c.subject || null,
      speaker: c.speaker || null,
      confidence: c.confidence != null ? Number(c.confidence) : null,
      publication_eligibility: c.publicationEligibility || null,
      is_core: !!c.isCore,
      variants: jsonbParam(c.variants || []),
      failure_reasons: jsonbParam(c.failureReasons || []),
      text_hash: c.textHash || null,
      metadata: jsonbParam(c.metadata || {}),
      evidence_ids: c.evidenceIds || [],
      supporting_source_ids: c.supportingSourceIds || [],
      contradicting_source_ids: c.contradictingSourceIds || [],
      section_type: c.sectionType || c.classification || null,
      sort_order: idx,
    };
  });
}

module.exports = {
  sanitizeJson: sanitizeJson,
  jsonbParam: jsonbParam,
  stripRawTextDeep: stripRawTextDeep,
  toIso: toIso,
  snapshotHash: snapshotHash,
  itemToRow: itemToRow,
  rowToItem: rowToItem,
  extractSources: extractSources,
  extractEvidences: extractEvidences,
  extractClaims: extractClaims,
};
