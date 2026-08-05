/**
 * 데일리 이슈 — 출처·claim 품질 게이트 + buildDailyIssueCandidate
 * Node(CommonJS) · 브라우저(UMD)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./daily-issue-source-core'),
      require('./daily-issue-claim-core'),
    );
  } else {
    root.DailyIssueQualityCore = factory(root.DailyIssueSourceCore, root.DailyIssueClaimCore);
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueQualityCoreFactory(sourceCore, claimCore) {
  'use strict';

  var QUALITY_STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    READY: 'READY',
    PUBLISHED: 'PUBLISHED',
    QUARANTINED: 'QUARANTINED',
    CORRECTED: 'CORRECTED',
  });

  var FAILURE_REASONS = Object.freeze({
    SOURCE_REFS_EMPTY: 'SOURCE_REFS_EMPTY',
    SOURCE_SCHEMA_INVALID: 'SOURCE_SCHEMA_INVALID',
    INDEPENDENT_SOURCES_TOO_LOW: 'INDEPENDENT_SOURCES_TOO_LOW',
    EVIDENCE_EMPTY: 'EVIDENCE_EMPTY',
    EVIDENCE_SOURCE_NOT_FOUND: 'EVIDENCE_SOURCE_NOT_FOUND',
    CLAIMS_EMPTY: 'CLAIMS_EMPTY',
    CONFIRMED_FACT_EMPTY: 'CONFIRMED_FACT_EMPTY',
    CLAIM_EVIDENCE_MISSING: 'CLAIM_EVIDENCE_MISSING',
    CLAIM_SOURCE_MISMATCH: 'CLAIM_SOURCE_MISMATCH',
    CLAIM_NUMERIC_MISMATCH: 'CLAIM_NUMERIC_MISMATCH',
    CLAIM_DATE_MISMATCH: 'CLAIM_DATE_MISMATCH',
    CLAIM_ENTITY_MISMATCH: 'CLAIM_ENTITY_MISMATCH',
    CLAIM_OVERSTATEMENT: 'CLAIM_OVERSTATEMENT',
    ATTRIBUTION_MISSING: 'ATTRIBUTION_MISSING',
    UNSUPPORTED_CAUSALITY: 'UNSUPPORTED_CAUSALITY',
    CORE_CLAIM_UNVERIFIED: 'CORE_CLAIM_UNVERIFIED',
    SOURCE_DISAGREEMENT_HIDDEN: 'SOURCE_DISAGREEMENT_HIDDEN',
    OPINION_USED_AS_FACT: 'OPINION_USED_AS_FACT',
    BIAS_PHRASE: 'BIAS_PHRASE',
    DISCUSSION_PROMPT_LEADING: 'DISCUSSION_PROMPT_LEADING',
    QUALITY_GATE_ERROR: 'QUALITY_GATE_ERROR',
    // freshness (applied after quality; fail-closed)
    PUBLISHED_AT_MISSING_FOR_FRESHNESS: 'PUBLISHED_AT_MISSING_FOR_FRESHNESS',
    PUBLISHED_AT_FUTURE: 'PUBLISHED_AT_FUTURE',
    UPDATED_AT_INVALID: 'UPDATED_AT_INVALID',
    EVENT_DATE_MISSING: 'EVENT_DATE_MISSING',
    EVENT_DATE_FUTURE: 'EVENT_DATE_FUTURE',
    DATE_PARSE_INVALID: 'DATE_PARSE_INVALID',
    DATE_ORDER_INVALID: 'DATE_ORDER_INVALID',
    CONTENT_TOO_OLD: 'CONTENT_TOO_OLD',
    EVENT_TOO_OLD: 'EVENT_TOO_OLD',
    RECIRCULATED_URL: 'RECIRCULATED_URL',
    RECIRCULATED_CONTENT_HASH: 'RECIRCULATED_CONTENT_HASH',
    RECIRCULATED_OLD_EVENT: 'RECIRCULATED_OLD_EVENT',
    BACKGROUND_ONLY: 'BACKGROUND_ONLY',
    NO_NEW_DEVELOPMENT: 'NO_NEW_DEVELOPMENT',
    NOVELTY_EVIDENCE_MISSING: 'NOVELTY_EVIDENCE_MISSING',
    FRESHNESS_CLASS_NOT_ELIGIBLE: 'FRESHNESS_CLASS_NOT_ELIGIBLE',
    FRESHNESS_GATE_ERROR: 'FRESHNESS_GATE_ERROR',
    // legacy-compatible aliases used by index.html gate
    VALID_SOURCE_REFS_EMPTY: 'VALID_SOURCE_REFS_EMPTY',
    INDEPENDENT_SOURCE_POLICY_FAILED: 'INDEPENDENT_SOURCE_POLICY_FAILED',
    TITLE_MISSING: 'TITLE_MISSING',
    CONFIRMED_SUMMARY_MISSING: 'CONFIRMED_SUMMARY_MISSING',
    DISCUSSION_PROMPT_MISSING: 'DISCUSSION_PROMPT_MISSING',
  });

  var QUALITY_GATE_VERSION = 2;

  var BIAS_PHRASES = [
    '반드시 지지해야',
    '반드시 반대해야',
    '당연히',
    '명백한 악',
    '무능한',
    '매국',
    '선동',
    '국민 모두가',
    '정상적인 사람이라면',
    '어느 쪽이 옳은가',
    '찬성해야 하는가',
    '반대해야 하는가',
  ];

  var LEADING_PROMPT_PHRASES = [
    '반대해야 하지 않을까요',
    '동의하십니까',
    '어느 진영',
    '찬성 또는 반대',
    '선택하세요',
    '잘못된 정책',
  ];

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function uniq(arr) {
    var seen = {};
    var out = [];
    (arr || []).forEach(function (x) {
      if (!x || seen[x]) return;
      seen[x] = 1;
      out.push(x);
    });
    return out;
  }

  function detectBias(text) {
    var blob = trimStr(text).toLowerCase();
    var i;
    for (i = 0; i < BIAS_PHRASES.length; i++) {
      if (blob.indexOf(BIAS_PHRASES[i].toLowerCase()) >= 0) return BIAS_PHRASES[i];
    }
    return '';
  }

  function detectLeadingPrompt(text) {
    var t = trimStr(text);
    var i;
    for (i = 0; i < LEADING_PROMPT_PHRASES.length; i++) {
      if (t.indexOf(LEADING_PROMPT_PHRASES[i]) >= 0) return LEADING_PROMPT_PHRASES[i];
    }
    return '';
  }

  function validateIndependentSourcePolicy(validSources) {
    var reasons = [];
    var indep = sourceCore.countIndependentSources(validSources);
    var hasOfficial = validSources.some(function (s) {
      return (
        s.sourceType === 'OFFICIAL' ||
        s.sourceType === 'STATISTICS' ||
        sourceCore.isPrimaryDocumentType(s.documentType)
      );
    });
    var newsLike = validSources.filter(function (s) {
      return s.sourceType === 'NEWS' || s.sourceType === 'RESEARCH' || s.sourceType === 'STATISTICS';
    });
    var indepNews = sourceCore.countIndependentSources(newsLike);
    var passA = hasOfficial && indepNews >= 1;
    var passB = indepNews >= 2;
    if (!(passA || passB)) reasons.push(FAILURE_REASONS.INDEPENDENT_SOURCE_POLICY_FAILED);
    if (indep <= 1) reasons.push(FAILURE_REASONS.INDEPENDENT_SOURCES_TOO_LOW);
    return { ok: reasons.length === 0, reasons: reasons, independentCount: indep };
  }

  /**
   * 외부 수집기/정적 후보 공통 입력 인터페이스.
   * DOM 비의존. 허위 필드를 자동 보완하지 않는다.
   */
  function buildDailyIssueCandidate(input) {
    var checkedAt = new Date().toISOString();
    try {
      var srcIn = input || {};
      var reasons = [];
      var title = trimStr(srcIn.title || srcIn.topic);
      var discussionPrompt = trimStr(srcIn.discussionPrompt || srcIn.question || srcIn.aiQuestion);
      var retrievedAt = trimStr(srcIn.retrievedAt) || checkedAt;

      var normalizedSources = sourceCore.normalizeSourceDocuments(srcIn.sources || srcIn.sourceRefs || []);
      // 문서별 source id는 evidence 연결을 위해 유지한다.
      // 독립 출처 판정은 countIndependentSources로 별도 계산한다.

      if (!normalizedSources.length) reasons.push(FAILURE_REASONS.SOURCE_REFS_EMPTY);

      var schemaValid = [];
      var i;
      for (i = 0; i < normalizedSources.length; i++) {
        if (sourceCore.isSourceSchemaValid(normalizedSources[i])) schemaValid.push(normalizedSources[i]);
        else reasons.push(FAILURE_REASONS.SOURCE_SCHEMA_INVALID);
      }
      var eligible = schemaValid.filter(function (s) {
        if (!sourceCore.isPublicationEligibleSourceType(s.sourceType)) return false;
        if (sourceCore.isOpinionOrSocialType(s.sourceType)) return false;
        var doc = String(s.documentType || '').toUpperCase();
        if (doc === 'COLUMN' || doc === 'EDITORIAL' || doc === 'SOCIAL_POST') return false;
        return true;
      });
      if (!eligible.length) reasons.push(FAILURE_REASONS.VALID_SOURCE_REFS_EMPTY);

      var indepCheck = validateIndependentSourcePolicy(eligible);
      reasons = reasons.concat(indepCheck.reasons);

      var normalizedEvidences = sourceCore.normalizeEvidences(srcIn.evidences || [], normalizedSources);
      if (!normalizedEvidences.length) reasons.push(FAILURE_REASONS.EVIDENCE_EMPTY);
      var evLink = sourceCore.validateEvidenceSourceLinks(normalizedEvidences, normalizedSources);
      reasons = reasons.concat(evLink.reasons);

      var claims = claimCore.processCandidateClaims(
        srcIn.candidateClaims || srcIn.claims || [],
        normalizedSources,
        normalizedEvidences,
      );
      if (!claims.length) reasons.push(FAILURE_REASONS.CLAIMS_EMPTY);

      var confirmed = claims.filter(function (c) {
        return c.classification === claimCore.CLASSIFICATION.CONFIRMED_FACT;
      });
      if (!confirmed.length) reasons.push(FAILURE_REASONS.CONFIRMED_FACT_EMPTY);

      // claim-level failures that are core
      claims.forEach(function (c) {
        if (c.classification === claimCore.CLASSIFICATION.REJECTED && c.isCore) {
          reasons = reasons.concat(c.failureReasons.length ? c.failureReasons : ['CLAIM_EVIDENCE_MISSING']);
        }
        if (c.classification === claimCore.CLASSIFICATION.UNVERIFIED && c.isCore) {
          reasons.push(FAILURE_REASONS.CORE_CLAIM_UNVERIFIED);
        }
        if (
          c.classification === claimCore.CLASSIFICATION.SOURCE_DISAGREEMENT &&
          (!c.variants || c.variants.length < 2)
        ) {
          reasons.push(FAILURE_REASONS.SOURCE_DISAGREEMENT_HIDDEN);
        }
        if (c.classification === claimCore.CLASSIFICATION.ATTRIBUTED_CLAIM) {
          if (!c.speaker && !c.subject) reasons.push(FAILURE_REASONS.ATTRIBUTION_MISSING);
        }
      });

      if (!title) reasons.push(FAILURE_REASONS.TITLE_MISSING);
      if (!discussionPrompt) reasons.push(FAILURE_REASONS.DISCUSSION_PROMPT_MISSING);
      var leading = detectLeadingPrompt(discussionPrompt);
      if (leading) reasons.push(FAILURE_REASONS.DISCUSSION_PROMPT_LEADING);
      var biasHit = detectBias([title, discussionPrompt].concat(claims.map(function (c) { return c.text; })).join(' '));
      if (biasHit) reasons.push(FAILURE_REASONS.BIAS_PHRASE + ':' + biasHit);

      // CONFIRMED_SUMMARY derived only from confirmed claims — never invent
      var confirmedSummary = confirmed
        .map(function (c) {
          return c.text;
        })
        .filter(Boolean)
        .join(' ');
      if (!confirmedSummary) reasons.push(FAILURE_REASONS.CONFIRMED_SUMMARY_MISSING);

      reasons = uniq(reasons);
      var ok = reasons.length === 0;
      var status = ok ? QUALITY_STATUS.READY : QUALITY_STATUS.QUARANTINED;

      return {
        publicationStatus: status,
        normalizedSources: normalizedSources,
        normalizedEvidences: normalizedEvidences,
        claims: claims,
        displayGroups: claimCore.groupClaimsForDisplay(claims),
        sourceFactMeta: {
          primarySourceType: eligible[0] ? eligible[0].sourceType : 'OTHER',
          sourceCount: normalizedSources.length,
          independentSourceCount: indepCheck.independentCount,
          evidenceCount: normalizedEvidences.length,
          claimCount: claims.length,
          confirmedFactCount: confirmed.length,
        },
        qualityFailureReasons: reasons,
        qualityCheckedAt: checkedAt,
        qualityGateVersion: QUALITY_GATE_VERSION,
        title: title,
        discussionPrompt: discussionPrompt,
        confirmedSummary: confirmedSummary,
        retrievedAt: retrievedAt,
        ok: ok,
      };
    } catch (e) {
      return {
        publicationStatus: QUALITY_STATUS.QUARANTINED,
        normalizedSources: [],
        normalizedEvidences: [],
        claims: [],
        displayGroups: claimCore.groupClaimsForDisplay([]),
        sourceFactMeta: {
          primarySourceType: 'OTHER',
          sourceCount: 0,
          independentSourceCount: 0,
          evidenceCount: 0,
          claimCount: 0,
          confirmedFactCount: 0,
        },
        qualityFailureReasons: [FAILURE_REASONS.QUALITY_GATE_ERROR],
        qualityCheckedAt: checkedAt,
        qualityGateVersion: QUALITY_GATE_VERSION,
        title: '',
        discussionPrompt: '',
        confirmedSummary: '',
        retrievedAt: checkedAt,
        ok: false,
      };
    }
  }

  /**
   * 기존 index.html validateDailyIssuePublicationQuality 호환 래퍼.
   * claims/evidences가 없으면 레거시 출처 기준만 검사하고,
   * claims가 있으면 강화 게이트를 적용한다.
   */
  function validateDailyIssuePublicationQuality(issue) {
    try {
      var hasClaims = issue && Array.isArray(issue.claims) && issue.claims.length > 0;
      var hasEvidences = issue && Array.isArray(issue.evidences) && issue.evidences.length > 0;
      if (hasClaims || hasEvidences) {
        var built = buildDailyIssueCandidate({
          title: issue.topic || issue.title,
          discussionPrompt: issue.discussionPrompt || issue.aiQuestion || issue.question,
          sources: issue.sourceRefs || issue.sources,
          evidences: issue.evidences,
          candidateClaims: issue.claims || issue.candidateClaims,
          retrievedAt: issue.updatedAt,
        });
        return {
          ok: built.ok,
          reasons: built.qualityFailureReasons.slice(),
          independentCount: built.sourceFactMeta.independentSourceCount,
          candidate: built,
        };
      }

      // Legacy path: sourceRefs-only (static pool). Still fail-closed without inventing claims.
      var refs = Array.isArray(issue && issue.sourceRefs) ? issue.sourceRefs : [];
      var reasons = [];
      if (!refs.length) reasons.push(FAILURE_REASONS.SOURCE_REFS_EMPTY);
      var normalized = sourceCore.normalizeSourceDocuments(refs);
      var validRefs = normalized.filter(function (r) {
        if (!sourceCore.isSourceSchemaValid(r)) return false;
        if (!sourceCore.isPublicationEligibleSourceType(r.sourceType)) return false;
        if (sourceCore.isOpinionOrSocialType(r.sourceType)) return false;
        return true;
      });
      if (!validRefs.length) reasons.push(FAILURE_REASONS.VALID_SOURCE_REFS_EMPTY);
      var indep = validateIndependentSourcePolicy(validRefs);
      reasons = reasons.concat(indep.reasons);
      // Without evidences/claims, cannot prove CONFIRMED_FACT
      reasons.push(FAILURE_REASONS.EVIDENCE_EMPTY);
      reasons.push(FAILURE_REASONS.CONFIRMED_FACT_EMPTY);
      if (!trimStr(issue && issue.topic)) reasons.push(FAILURE_REASONS.TITLE_MISSING);
      if (!trimStr(issue && (issue.confirmedSummary || issue.factSummary || issue.summary))) {
        reasons.push(FAILURE_REASONS.CONFIRMED_SUMMARY_MISSING);
      }
      if (!trimStr(issue && (issue.discussionPrompt || issue.aiQuestion || issue.question))) {
        reasons.push(FAILURE_REASONS.DISCUSSION_PROMPT_MISSING);
      }
      var bias = detectBias(
        [issue && issue.topic, issue && issue.summary, issue && issue.factSummary, issue && issue.discussionPrompt].join(
          ' ',
        ),
      );
      if (bias) reasons.push(FAILURE_REASONS.BIAS_PHRASE + ':' + bias);
      reasons = uniq(reasons);
      return { ok: false, reasons: reasons, independentCount: indep.independentCount };
    } catch (e) {
      return { ok: false, reasons: [FAILURE_REASONS.QUALITY_GATE_ERROR], independentCount: 0 };
    }
  }

  return {
    QUALITY_STATUS: QUALITY_STATUS,
    FAILURE_REASONS: FAILURE_REASONS,
    QUALITY_GATE_VERSION: QUALITY_GATE_VERSION,
    BIAS_PHRASES: BIAS_PHRASES,
    buildDailyIssueCandidate: buildDailyIssueCandidate,
    validateDailyIssuePublicationQuality: validateDailyIssuePublicationQuality,
    detectBias: detectBias,
    detectLeadingPrompt: detectLeadingPrompt,
  };
});
