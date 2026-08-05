'use strict';

/**
 * 데일리 이슈 API 응답 직렬화 — rawText/비밀/choices/stance 제외
 */

const lifecycle = require('../shared/daily-issue-lifecycle-core');

function stripRawFromSources(sources) {
  return (sources || []).map(function (s) {
    if (!s || typeof s !== 'object') return s;
    return {
      id: s.id,
      publisher: s.publisher,
      title: s.title,
      url: s.url,
      publishedAt: s.publishedAt,
      sourceType: s.sourceType,
      documentType: s.documentType,
      originDomain: s.originDomain,
      author: s.author,
      updatedAt: s.updatedAt,
      feedSeenAt: s.feedSeenAt,
      retrievedAt: s.retrievedAt,
      sourceEventDate: s.sourceEventDate,
    };
  });
}

function slimEvidence(ev) {
  if (!ev || typeof ev !== 'object') return null;
  return {
    id: ev.id,
    sourceId: ev.sourceId,
    evidenceType: ev.evidenceType,
    extractionConfidence: ev.extractionConfidence,
    textPreview: String(ev.text || '').slice(0, 160),
  };
}

function reasonSummary(item) {
  const parts = [];
  if (item.holdReason) parts.push({ type: 'hold', code: item.holdReason, text: item.reviewReason || null });
  if (item.rejectReason) parts.push({ type: 'reject', code: item.rejectReason, text: item.reviewReason || null });
  if (item.retireReason) parts.push({ type: 'retire', code: item.retireReason, text: item.reviewReason || null });
  return parts;
}

function toAdminListItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    candidateId: item.candidateId || null,
    status: item.status,
    title: item.title,
    category: item.category,
    version: item.version != null ? item.version : 1,
    lockVersion: item.lockVersion != null ? item.lockVersion : 1,
    sourceCount: (item.sourceRefs || []).length,
    independentSourceCount:
      (item.qualityMeta && item.qualityMeta.independentSourceCount) ||
      (item.qualityMeta && item.qualityMeta.sourceFactMeta && item.qualityMeta.sourceFactMeta.independentSourceCount) ||
      0,
    freshnessClass: (item.freshnessMeta && item.freshnessMeta.freshnessClass) || null,
    queuedAt: item.queuedAt || null,
    expiresAt: item.expiresAt || null,
    priorIssueId: item.priorIssueId || null,
    duplicateDecision: (item.duplicateMeta && item.duplicateMeta.decision) || null,
    reasonSummary: reasonSummary(item),
  };
}

function toAdminDetail(item) {
  if (!item) return null;
  const allowedNext = (lifecycle.ALLOWED_TRANSITIONS[item.status] || []).slice();
  return {
    id: item.id,
    candidateId: item.candidateId || null,
    status: item.status,
    title: item.title,
    category: item.category,
    version: item.version != null ? item.version : 1,
    lockVersion: item.lockVersion != null ? item.lockVersion : 1,
    discussionPrompt: item.discussionPrompt || null,
    confirmedSummary: item.confirmedSummary || null,
    claims: (Array.isArray(item.claims) ? item.claims : []).map(function (c) {
      return {
        id: c.id,
        text: c.text,
        classification: c.classification,
        evidenceIds: c.evidenceIds || [],
        supportingSourceIds: c.supportingSourceIds || [],
        isCore: !!c.isCore,
      };
    }),
    sourceRefs: stripRawFromSources(item.sourceRefs),
    evidenceSummary: (Array.isArray(item.evidenceRefs)
      ? item.evidenceRefs
      : Array.isArray(item.evidences)
        ? item.evidences
        : []
    )
      .map(slimEvidence)
      .filter(Boolean),
    qualityMeta: item.qualityMeta
      ? {
          passed: item.qualityMeta.passed,
          independentSourceCount:
            item.qualityMeta.independentSourceCount ||
            (item.qualityMeta.sourceFactMeta && item.qualityMeta.sourceFactMeta.independentSourceCount) ||
            null,
          failureReasons: item.qualityMeta.failureReasons || item.qualityMeta.qualityFailureReasons || [],
          qualityCheckedAt: item.qualityMeta.qualityCheckedAt || null,
        }
      : null,
    freshnessMeta: item.freshnessMeta
      ? {
          freshnessClass: item.freshnessMeta.freshnessClass,
          passed: item.freshnessMeta.passed,
          failureReasons: item.freshnessMeta.failureReasons || item.freshnessMeta.freshnessFailureReasons || [],
          freshnessCheckedAt: item.freshnessMeta.freshnessCheckedAt || null,
        }
      : null,
    duplicateMeta: item.duplicateMeta || null,
    eventIdentity: item.eventIdentity || null,
    noveltySignals: Array.isArray(item.noveltySignals) ? item.noveltySignals : [],
    staleSignals: Array.isArray(item.staleSignals) ? item.staleSignals : [],
    updateHistory: Array.isArray(item.updateHistory) ? item.updateHistory : [],
    queuedAt: item.queuedAt || null,
    expiresAt: item.expiresAt || null,
    approvedAt: item.approvedAt || null,
    publishedAt: item.publishedAt || null,
    publishExpiresAt: item.publishExpiresAt || null,
    priorIssueId: item.priorIssueId || null,
    followUpOf: item.followUpOf || null,
    holdReason: item.holdReason || null,
    rejectReason: item.rejectReason || null,
    retireReason: item.retireReason || null,
    reviewReason: item.reviewReason || null,
    reviewerId: item.reviewerId || null,
    allowedNextStatuses: allowedNext,
  };
}

function toPublicIssue(item, asOf) {
  if (!item || item.status !== lifecycle.REVIEW_STATUS.PUBLISHED) return null;
  const now = Date.parse(asOf || new Date().toISOString());
  const exp = Date.parse(item.publishExpiresAt || '');
  if (isFinite(exp) && isFinite(now) && now > exp) return null;

  return {
    id: item.id,
    title: item.title,
    category: item.category,
    discussionPrompt: item.discussionPrompt || null,
    confirmedSummary: item.confirmedSummary || null,
    claims: (item.claims || [])
      .filter(function (c) {
        return c && c.classification !== 'REJECTED';
      })
      .map(function (c) {
        return {
          id: c.id,
          text: c.text,
          classification: c.classification,
          isCore: !!c.isCore,
        };
      }),
    sourceRefs: stripRawFromSources(item.sourceRefs),
    freshnessClass: (item.freshnessMeta && item.freshnessMeta.freshnessClass) || null,
    publishedAt: item.publishedAt || null,
    publishExpiresAt: item.publishExpiresAt || null,
    lastSourceUpdateAt: item.lastUpdatedAt || item.publishedAt || null,
    sourceCount: (item.sourceRefs || []).length,
    independentSourceCount:
      (item.qualityMeta && item.qualityMeta.independentSourceCount) ||
      (item.qualityMeta && item.qualityMeta.sourceFactMeta && item.qualityMeta.sourceFactMeta.independentSourceCount) ||
      0,
    updateHistory: (Array.isArray(item.updateHistory) ? item.updateHistory : []).map(function (u) {
      return {
        at: u.at || u.updatedAt || null,
        type: u.type || u.updateType || null,
        note: u.note || null,
      };
    }),
    followUpOf: item.followUpOf || item.priorIssueId || null,
  };
}

function toPublicAuditEvent(ev) {
  if (!ev) return null;
  return {
    action: ev.action || null,
    fromStatus: ev.fromStatus || null,
    toStatus: ev.toStatus || null,
    actorId: ev.actorId || null,
    reasonCode: ev.reasonCode || null,
    timestamp: ev.timestamp || ev.createdAt || null,
    transactionId: ev.transactionId || null,
    requestId: ev.requestId || null,
  };
}

function containsForbiddenKeys(obj) {
  const raw = JSON.stringify(obj);
  return /"rawText"|"choices"|"stance"|"DATABASE_URL"|"SERVICE_ROLE"|Bearer\s/i.test(raw);
}

module.exports = {
  toAdminListItem: toAdminListItem,
  toAdminDetail: toAdminDetail,
  toPublicIssue: toPublicIssue,
  toPublicAuditEvent: toPublicAuditEvent,
  stripRawFromSources: stripRawFromSources,
  containsForbiddenKeys: containsForbiddenKeys,
};
