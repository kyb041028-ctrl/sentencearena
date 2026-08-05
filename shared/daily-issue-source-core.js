/**
 * 데일리 이슈 — 출처·근거(evidence) 정규화 코어
 * Node(CommonJS) · 브라우저(UMD)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssueSourceCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueSourceCoreFactory() {
  'use strict';

  var SOURCE_TYPES = Object.freeze({
    OFFICIAL: 'OFFICIAL',
    NEWS: 'NEWS',
    RESEARCH: 'RESEARCH',
    STATISTICS: 'STATISTICS',
    TRANSCRIPT: 'TRANSCRIPT',
    OPINION: 'OPINION',
    SOCIAL: 'SOCIAL',
    COMMUNITY: 'COMMUNITY',
    OTHER: 'OTHER',
  });

  var DOCUMENT_TYPES = Object.freeze({
    PRESS_RELEASE: 'PRESS_RELEASE',
    LAW: 'LAW',
    BILL: 'BILL',
    COURT_DECISION: 'COURT_DECISION',
    DISCLOSURE: 'DISCLOSURE',
    STATISTICAL_RELEASE: 'STATISTICAL_RELEASE',
    NEWS_REPORT: 'NEWS_REPORT',
    INTERVIEW: 'INTERVIEW',
    COLUMN: 'COLUMN',
    EDITORIAL: 'EDITORIAL',
    RESEARCH_REPORT: 'RESEARCH_REPORT',
    SPEECH: 'SPEECH',
    SOCIAL_POST: 'SOCIAL_POST',
  });

  var EVIDENCE_TYPES = Object.freeze({
    DOCUMENT_TEXT: 'DOCUMENT_TEXT',
    DIRECT_QUOTE: 'DIRECT_QUOTE',
    DATA_POINT: 'DATA_POINT',
    OFFICIAL_STATEMENT: 'OFFICIAL_STATEMENT',
    REPORTED_STATEMENT: 'REPORTED_STATEMENT',
    BACKGROUND: 'BACKGROUND',
    ANALYSIS: 'ANALYSIS',
    FORECAST: 'FORECAST',
  });

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function safeHostFromUrl(url) {
    try {
      if (!url) return '';
      return String(new URL(url).hostname || '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function normalizeSourceType(raw) {
    var key = trimStr(raw).toUpperCase();
    return SOURCE_TYPES[key] || SOURCE_TYPES.OTHER;
  }

  function normalizeDocumentType(raw) {
    var key = trimStr(raw).toUpperCase();
    return DOCUMENT_TYPES[key] || trimStr(raw).toUpperCase();
  }

  function isPublicationEligibleSourceType(t) {
    var k = String(t || '').toUpperCase();
    return k === 'OFFICIAL' || k === 'NEWS' || k === 'RESEARCH' || k === 'STATISTICS' || k === 'TRANSCRIPT';
  }

  function isOpinionOrSocialType(t) {
    var k = String(t || '').toUpperCase();
    return k === 'OPINION' || k === 'SOCIAL' || k === 'COMMUNITY';
  }

  function isPrimaryDocumentType(docType) {
    var d = String(docType || '').toUpperCase();
    return (
      d === 'PRESS_RELEASE' ||
      d === 'LAW' ||
      d === 'BILL' ||
      d === 'COURT_DECISION' ||
      d === 'DISCLOSURE' ||
      d === 'STATISTICAL_RELEASE'
    );
  }

  function normalizeSourceDocument(raw, idx) {
    var row = raw && typeof raw === 'object' ? raw : {};
    var url = trimStr(row.url || row.link || row.sourceUrl);
    var publisher = trimStr(row.publisher || row.label || row.source);
    var title = trimStr(row.title || row.headline);
    // publishedAt만 사용 — retrievedAt/updatedAt/feedSeenAt으로 대체하지 않음
    var publishedAt = trimStr(row.publishedAt || row.date);
    var originDomain = trimStr(row.originDomain) || safeHostFromUrl(url);
    var sourceType = normalizeSourceType(row.sourceType);
    var documentType = normalizeDocumentType(row.documentType || row.articleKind);
    var conf = row.sourceEventDateConfidence == null ? null : Number(row.sourceEventDateConfidence);
    return {
      id: trimStr(row.id) || 'src_' + (idx || 0),
      publisher: publisher,
      title: title,
      url: url,
      publishedAt: publishedAt || null,
      updatedAt: trimStr(row.updatedAt) || null,
      feedSeenAt: trimStr(row.feedSeenAt) || null,
      retrievedAt: trimStr(row.retrievedAt) || null,
      firstSeenAt: trimStr(row.firstSeenAt) || null,
      lastSeenAt: trimStr(row.lastSeenAt) || null,
      sourceEventDate: trimStr(row.sourceEventDate) || null,
      sourceEventDateConfidence: isFinite(conf) ? conf : null,
      sourceType: sourceType,
      originDomain: originDomain,
      author: trimStr(row.author),
      documentType: documentType,
      primarySourceUrl: trimStr(row.primarySourceUrl),
      language: trimStr(row.language),
      country: trimStr(row.country),
      contentHash: trimStr(row.contentHash),
      rawText: trimStr(row.rawText),
      normalizedText: trimStr(row.normalizedText || row.rawText),
    };
  }

  function isSourceSchemaValid(src) {
    if (!src || typeof src !== 'object') return false;
    return !!(trimStr(src.publisher) && trimStr(src.title) && trimStr(src.url) && trimStr(src.publishedAt));
  }

  function normalizeSourceDocuments(list) {
    var arr = Array.isArray(list) ? list : [];
    var out = [];
    var i;
    for (i = 0; i < arr.length; i++) {
      out.push(normalizeSourceDocument(arr[i], i));
    }
    return out;
  }

  function independentSourceKey(src) {
    if (!src || typeof src !== 'object') return '';
    var psrc = trimStr(src.primarySourceUrl).toLowerCase();
    var domain = trimStr(src.originDomain).toLowerCase();
    var publisher = trimStr(src.publisher).toLowerCase();
    var url = trimStr(src.url).toLowerCase();
    return psrc || domain || publisher || url;
  }

  function countIndependentSources(refs) {
    var seen = {};
    var cnt = 0;
    var i;
    for (i = 0; i < (refs || []).length; i++) {
      var key = independentSourceKey(refs[i]);
      if (!key || seen[key]) continue;
      seen[key] = 1;
      cnt += 1;
    }
    return cnt;
  }

  function deduplicateSources(refs) {
    var seen = {};
    var out = [];
    var i;
    for (i = 0; i < (refs || []).length; i++) {
      var s = refs[i];
      var key = independentSourceKey(s) || String(s && s.id);
      if (!key || seen[key]) continue;
      seen[key] = 1;
      out.push(s);
    }
    return out;
  }

  function normalizeEvidence(raw, idx, sourceIdFallback) {
    var row = raw && typeof raw === 'object' ? raw : {};
    var text = trimStr(row.text);
    var evidenceType = trimStr(row.evidenceType).toUpperCase() || EVIDENCE_TYPES.DOCUMENT_TEXT;
    if (!EVIDENCE_TYPES[evidenceType]) evidenceType = EVIDENCE_TYPES.DOCUMENT_TEXT;
    var conf = Number(row.extractionConfidence);
    if (!isFinite(conf)) conf = text ? 0.5 : 0;
    return {
      id: trimStr(row.id) || 'ev_' + (idx || 0),
      sourceId: trimStr(row.sourceId) || trimStr(sourceIdFallback),
      text: text,
      normalizedText: trimStr(row.normalizedText || text).toLowerCase(),
      startOffset: row.startOffset == null ? null : Number(row.startOffset),
      endOffset: row.endOffset == null ? null : Number(row.endOffset),
      speaker: trimStr(row.speaker),
      subject: trimStr(row.subject),
      publishedAt: trimStr(row.publishedAt),
      evidenceType: evidenceType,
      extractionConfidence: conf,
    };
  }

  function normalizeEvidences(list, sources) {
    var srcIds = {};
    (sources || []).forEach(function (s) {
      if (s && s.id) srcIds[s.id] = s;
    });
    var arr = Array.isArray(list) ? list : [];
    var out = [];
    var i;
    for (i = 0; i < arr.length; i++) {
      var ev = normalizeEvidence(arr[i], i, '');
      out.push(ev);
    }
    return out;
  }

  function validateEvidenceSourceLinks(evidences, sources) {
    var byId = {};
    (sources || []).forEach(function (s) {
      if (s && s.id) byId[s.id] = s;
    });
    var reasons = [];
    var i;
    for (i = 0; i < (evidences || []).length; i++) {
      var ev = evidences[i];
      if (!ev || !trimStr(ev.text)) {
        reasons.push('EVIDENCE_EMPTY');
        continue;
      }
      if (!ev.sourceId || !byId[ev.sourceId]) reasons.push('EVIDENCE_SOURCE_NOT_FOUND');
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  return {
    SOURCE_TYPES: SOURCE_TYPES,
    DOCUMENT_TYPES: DOCUMENT_TYPES,
    EVIDENCE_TYPES: EVIDENCE_TYPES,
    normalizeSourceDocument: normalizeSourceDocument,
    normalizeSourceDocuments: normalizeSourceDocuments,
    isSourceSchemaValid: isSourceSchemaValid,
    isPublicationEligibleSourceType: isPublicationEligibleSourceType,
    isOpinionOrSocialType: isOpinionOrSocialType,
    isPrimaryDocumentType: isPrimaryDocumentType,
    independentSourceKey: independentSourceKey,
    countIndependentSources: countIndependentSources,
    deduplicateSources: deduplicateSources,
    normalizeEvidence: normalizeEvidence,
    normalizeEvidences: normalizeEvidences,
    validateEvidenceSourceLinks: validateEvidenceSourceLinks,
    safeHostFromUrl: safeHostFromUrl,
  };
});
