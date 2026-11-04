'use strict';

/**
 * US live ingest — 후보별 격리 사유 분류 (QUALITY_FAILED 뭉침 방지)
 */

const QUALITY_CODES = Object.freeze({
  INDEPENDENT_SOURCES_TOO_LOW: 'INDEPENDENT_SOURCE_INSUFFICIENT',
  INDEPENDENT_SOURCE_POLICY_FAILED: 'INDEPENDENT_SOURCE_INSUFFICIENT',
  CONFIRMED_FACT_EMPTY: 'CROSS_VERIFICATION_FAILED',
  CORE_CLAIM_UNVERIFIED: 'EVIDENCE_OR_CLAIM_GAP',
  CONFIRMED_SUMMARY_MISSING: 'EVIDENCE_OR_CLAIM_GAP',
  EMOTIONAL_TITLE_ONLY: 'BIASED_OR_EMOTIONAL_TITLE',
});

const FRESHNESS_CODES = Object.freeze({
  NO_NEW_DEVELOPMENT: 'FRESHNESS_NO_NEW_DEVELOPMENT',
  FRESHNESS_CLASS_NOT_ELIGIBLE: 'FRESHNESS_CLASS_INELIGIBLE',
  CONTENT_TOO_OLD: 'FRESHNESS_STALE',
  PUBLISHED_AT_MISSING_FOR_FRESHNESS: 'DATE_PARSE_OR_MISSING',
  DATE_PARSE_INVALID: 'DATE_PARSE_OR_MISSING',
});

function trim(v) {
  return String(v == null ? '' : v).slice(0, 500);
}

function mapReasons(list, table) {
  const out = [];
  (list || []).forEach(function (code) {
    const key = String(code || '').trim();
    if (!key) return;
    out.push((table && table[key]) || key);
  });
  return out;
}

function primaryQuarantineBucket(candidate, sourceStats) {
  const c = candidate || {};
  const gate = c.independentSourceGate || {};
  if (gate.reason === 'SINGLE_DOC' || gate.independentCount < 2) {
    return 'INDEPENDENT_SOURCE_INSUFFICIENT';
  }
  if (gate.ok !== true) {
    return 'CLUSTER_OR_SOURCE_GATE';
  }
  const fresh = c.freshnessFailureReasons || [];
  if (fresh.length) {
    return mapReasons(fresh, FRESHNESS_CODES)[0] || 'FRESHNESS';
  }
  const qual = c.qualityFailureReasons || [];
  if (qual.length) {
    return mapReasons(qual, QUALITY_CODES)[0] || qual[0];
  }
  if (c.publicationStatus === 'QUARANTINED') {
    return 'RULE_OR_QUALITY_GATE';
  }
  return null;
}

function summarizeLiveCandidate(candidate, documentsById) {
  const c = candidate || {};
  const docs = (c.documents || []).map(function (d) {
    return d;
  });
  if (!docs.length && c.clusterId && documentsById) {
    /* cluster doc list not always on candidate */
  }
  const sources = c.normalizedSources || c.sourceRefs || [];
  const coreFacts = (c.claims || []).filter(function (cl) {
    return cl && cl.isCore;
  });
  const confirmed = (c.claims || []).filter(function (cl) {
    return cl && cl.classification === 'CONFIRMED_FACT';
  });
  const gate = c.independentSourceGate || {};
  return {
    title: trim(c.title),
    clusterId: c.clusterId || null,
    publicationStatus: c.publicationStatus || null,
    ok: c.ok === true,
    urls: (sources.length ? sources : docs).map(function (s) {
      return trim(s.url);
    }),
    sourceRegistryIds: (sources.length ? sources : docs).map(function (s) {
      return s.sourceRegistryId || s.publisher;
    }),
    publishedAt: c.latestPublishedAt || (sources[0] && sources[0].publishedAt) || null,
    retrievedAt: c.qualityCheckedAt || c.freshnessCheckedAt || null,
    qualityFailureReasons: (c.qualityFailureReasons || []).slice(),
    freshnessFailureReasons: (c.freshnessFailureReasons || []).slice(),
    independentSourceCount: gate.independentCount == null ? sources.length : gate.independentCount,
    independentGateReason: gate.reason || null,
    coreFactCount: coreFacts.length,
    confirmedFactCount: confirmed.length,
    quarantinePrimary: primaryQuarantineBucket(c),
    qualityMapped: mapReasons(c.qualityFailureReasons, QUALITY_CODES),
    freshnessMapped: mapReasons(c.freshnessFailureReasons, FRESHNESS_CODES),
  };
}

function classifyUsIngestRun(manifest, candidates, readyCount) {
  const m = manifest || {};
  const errors = m.errors || [];
  const sourceResults = m.sourceResults || [];
  if (errors.length && sourceResults.every(function (s) {
    return !s.ok;
  })) {
    return { outcome: 'COLLECT_FAILED', detail: errors };
  }
  const anyFetchOk = sourceResults.some(function (s) {
    return s.ok && s.feedAcceptedItems > 0;
  });
  if (!anyFetchOk && !errors.length) {
    const allStale = sourceResults.every(function (s) {
      return s.ok && s.feedAcceptedItems === 0 && s.rejectionReasonCounts && s.rejectionReasonCounts.STALE_ITEM;
    });
    if (allStale) {
      return { outcome: 'ZERO_NORMAL', detail: 'ALL_ITEMS_STALE_IN_WINDOW' };
    }
  }
  if (Number(readyCount) > 0) {
    return { outcome: 'READY_CANDIDATES_PRESENT', detail: { readyCount: readyCount } };
  }
  if (anyFetchOk) {
    return { outcome: 'ZERO_NORMAL', detail: 'QUALITY_OR_CLUSTER_QUARANTINE' };
  }
  return { outcome: 'ZERO_NORMAL', detail: 'NO_ELIGIBLE_DOCUMENTS' };
}

function summarizeReadyCandidate(candidate) {
  const c = candidate || {};
  const sources = c.normalizedSources || c.sourceRefs || [];
  const gate = c.independentSourceGate || {};
  const confirmed = (c.claims || []).filter(function (cl) {
    return cl && cl.classification === 'CONFIRMED_FACT';
  });
  return {
    title: trim(c.title),
    urls: sources.map(function (s) {
      return trim(s.url);
    }),
    independentSourceCount: gate.independentCount,
    confirmedFactCount: confirmed.length,
    freshnessOk: c.freshnessOk === true,
    freshnessClass: c.freshnessClass || null,
    publicationDecision: (c.lifecycleMeta && c.lifecycleMeta.publicationDecision) || null,
    qualityFailureReasons: [],
  };
}

module.exports = {
  summarizeLiveCandidate: summarizeLiveCandidate,
  summarizeReadyCandidate: summarizeReadyCandidate,
  classifyUsIngestRun: classifyUsIngestRun,
  primaryQuarantineBucket: primaryQuarantineBucket,
};
