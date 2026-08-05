/**
 * 데일리 이슈 — claim 분류·근거 연결 검증 코어
 * Node(CommonJS) · 브라우저(UMD)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./daily-issue-source-core'));
  } else {
    root.DailyIssueClaimCore = factory(root.DailyIssueSourceCore);
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueClaimCoreFactory(sourceCore) {
  'use strict';

  var CLASSIFICATION = Object.freeze({
    CONFIRMED_FACT: 'CONFIRMED_FACT',
    ATTRIBUTED_CLAIM: 'ATTRIBUTED_CLAIM',
    SOURCE_DISAGREEMENT: 'SOURCE_DISAGREEMENT',
    UNVERIFIED: 'UNVERIFIED',
    ANALYSIS_FORECAST: 'ANALYSIS_FORECAST',
    CONTEXT: 'CONTEXT',
    REJECTED: 'REJECTED',
  });

  var ATTRIBUTION_MARKERS = [
    '주장했다',
    '설명했다',
    '밝혔다',
    '반박했다',
    '비판했다',
    '해명했다',
    '발표했다',
    '강조했다',
    '부인했다',
  ];

  var ANONYMOUS_MARKERS = ['관계자에 따르면', '업계에서는', '일각에서는', '소식통에 따르면'];

  var FORECAST_MARKERS = ['전망', '예상', '분석', '가능성', '우려', '추정', '시나리오', '될 것'];

  var OVERSTATEMENT_PAIRS = [
    { soft: '가능성', hard: '확정' },
    { soft: '가능성이 있다', hard: '확정됐다' },
    { soft: '주장', hard: '사실' },
    { soft: '의혹', hard: '입증' },
  ];

  var CRIME_PREJUDGE = ['유죄', '범죄가 확정', '범인이다', '고의로'];

  var CAUSAL_OVERREACH = ['때문에 경제가', '때문에 실패', '로 인해 국민이'];

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function normalizeText(s) {
    return trimStr(s).replace(/\s+/g, ' ').toLowerCase();
  }

  function extractNumbers(text) {
    var s = String(text || '');
    var out = [];
    var re = /\d+(?:[.,]\d+)?/g;
    var m;
    while ((m = re.exec(s))) out.push(m[0].replace(/,/g, ''));
    return out;
  }

  function extractDates(text) {
    var s = String(text || '');
    var out = [];
    var re = /\d{4}[-./년]\s*\d{1,2}([-./월]\s*\d{1,2})?/g;
    var m;
    while ((m = re.exec(s))) out.push(normalizeText(m[0]));
    return out;
  }

  function hasAny(text, list) {
    var t = String(text || '');
    var i;
    for (i = 0; i < list.length; i++) {
      if (t.indexOf(list[i]) >= 0) return list[i];
    }
    return '';
  }

  function mapEvidenceById(evidences) {
    var map = {};
    (evidences || []).forEach(function (e) {
      if (e && e.id) map[e.id] = e;
    });
    return map;
  }

  function mapSourceById(sources) {
    var map = {};
    (sources || []).forEach(function (s) {
      if (s && s.id) map[s.id] = s;
    });
    return map;
  }

  function collectEvidenceTexts(claim, evidencesById) {
    var texts = [];
    (claim.evidenceIds || []).forEach(function (id) {
      var ev = evidencesById[id];
      if (ev && ev.text) texts.push(ev.text);
    });
    return texts;
  }

  function normalizeClaim(raw, idx) {
    var row = raw && typeof raw === 'object' ? raw : { text: String(raw || '') };
    var classification = trimStr(row.classification).toUpperCase();
    if (!CLASSIFICATION[classification]) classification = '';
    return {
      id: trimStr(row.id) || 'cl_' + (idx || 0),
      text: trimStr(row.text),
      classification: classification,
      subject: trimStr(row.subject),
      speaker: trimStr(row.speaker),
      evidenceIds: Array.isArray(row.evidenceIds) ? row.evidenceIds.slice() : [],
      supportingSourceIds: Array.isArray(row.supportingSourceIds) ? row.supportingSourceIds.slice() : [],
      contradictingSourceIds: Array.isArray(row.contradictingSourceIds) ? row.contradictingSourceIds.slice() : [],
      confidence: isFinite(Number(row.confidence)) ? Number(row.confidence) : 0,
      publicationEligibility: row.publicationEligibility == null ? true : !!row.publicationEligibility,
      failureReasons: Array.isArray(row.failureReasons) ? row.failureReasons.slice() : [],
      variants: Array.isArray(row.variants) ? row.variants.slice() : [],
      isCore: row.isCore !== false,
    };
  }

  function classifyClaimHeuristic(claim, sourcesById, evidencesById) {
    var text = claim.text || '';
    var reasons = [];
    if (!trimStr(text)) {
      return { classification: CLASSIFICATION.REJECTED, reasons: ['CLAIMS_EMPTY'] };
    }
    if (hasAny(text, ANONYMOUS_MARKERS)) {
      return { classification: CLASSIFICATION.UNVERIFIED, reasons: ['ATTRIBUTION_MISSING'] };
    }
    // 주체+귀속 표현이 있으면 ATTRIBUTED_CLAIM 우선.
    // 명시적 전망/분석 동사만 ANALYSIS_FORECAST로 분리한다.
    if (claim.speaker || claim.subject) {
      if (hasAny(text, ['전망했다', '예상했다', '분석했다'])) {
        return { classification: CLASSIFICATION.ANALYSIS_FORECAST, reasons: [] };
      }
      if (hasAny(text, ATTRIBUTION_MARKERS)) {
        return { classification: CLASSIFICATION.ATTRIBUTED_CLAIM, reasons: [] };
      }
    }
    if (hasAny(text, FORECAST_MARKERS)) {
      return { classification: CLASSIFICATION.ANALYSIS_FORECAST, reasons: [] };
    }
    if (hasAny(text, ATTRIBUTION_MARKERS)) {
      if (!claim.speaker && !claim.subject) {
        return { classification: CLASSIFICATION.REJECTED, reasons: ['ATTRIBUTION_MISSING'] };
      }
      return { classification: CLASSIFICATION.ATTRIBUTED_CLAIM, reasons: [] };
    }
    if (claim.variants && claim.variants.length >= 2) {
      return { classification: CLASSIFICATION.SOURCE_DISAGREEMENT, reasons: [] };
    }
    if (claim.classification === CLASSIFICATION.CONTEXT) {
      return { classification: CLASSIFICATION.CONTEXT, reasons: [] };
    }

    // CONFIRMED_FACT candidate checks
    var supportSources = (claim.supportingSourceIds || [])
      .map(function (id) {
        return sourcesById[id];
      })
      .filter(Boolean);
    if (!supportSources.length && claim.evidenceIds.length) {
      claim.evidenceIds.forEach(function (eid) {
        var ev = evidencesById[eid];
        if (ev && sourcesById[ev.sourceId]) supportSources.push(sourcesById[ev.sourceId]);
      });
    }
    var uniqueSupport = sourceCore.deduplicateSources(supportSources);
    var hasOfficial = uniqueSupport.some(function (s) {
      return (
        s.sourceType === 'OFFICIAL' ||
        s.sourceType === 'STATISTICS' ||
        sourceCore.isPrimaryDocumentType(s.documentType)
      );
    });
    var newsLike = uniqueSupport.filter(function (s) {
      return s.sourceType === 'NEWS' || s.sourceType === 'RESEARCH' || s.sourceType === 'STATISTICS';
    });
    var indepNews = sourceCore.countIndependentSources(newsLike);
    var onlyOpinion = uniqueSupport.length > 0 && uniqueSupport.every(function (s) {
      return sourceCore.isOpinionOrSocialType(s.sourceType);
    });
    if (onlyOpinion) {
      return { classification: CLASSIFICATION.REJECTED, reasons: ['OPINION_USED_AS_FACT'] };
    }
    var passA = hasOfficial && indepNews >= 1;
    var passB = indepNews >= 2;
    if (!(passA || passB)) {
      if (uniqueSupport.length <= 1) {
        return { classification: CLASSIFICATION.UNVERIFIED, reasons: ['INDEPENDENT_SOURCES_TOO_LOW'] };
      }
      return { classification: CLASSIFICATION.UNVERIFIED, reasons: ['INDEPENDENT_SOURCES_TOO_LOW'] };
    }
    if (!claim.evidenceIds.length) {
      return { classification: CLASSIFICATION.REJECTED, reasons: ['CLAIM_EVIDENCE_MISSING'] };
    }
    return { classification: CLASSIFICATION.CONFIRMED_FACT, reasons: reasons };
  }

  function validateClaimTextAgainstEvidence(claim, evidencesById) {
    var reasons = [];
    var texts = collectEvidenceTexts(claim, evidencesById);
    var blob = normalizeText(texts.join(' '));
    if (!blob) {
      reasons.push('CLAIM_EVIDENCE_MISSING');
      return { ok: false, reasons: reasons };
    }
    var claimNums = extractNumbers(claim.text);
    var i;
    for (i = 0; i < claimNums.length; i++) {
      if (blob.indexOf(claimNums[i]) < 0) reasons.push('CLAIM_NUMERIC_MISMATCH');
    }
    var claimDates = extractDates(claim.text);
    for (i = 0; i < claimDates.length; i++) {
      if (blob.indexOf(claimDates[i]) < 0 && blob.indexOf(claimDates[i].replace(/\s+/g, '')) < 0) {
        reasons.push('CLAIM_DATE_MISMATCH');
      }
    }
    // entity: if claim has bracketed or quoted org-like tokens already in speaker/subject, skip;
    // simple: require speaker/subject substring in evidence when present
    if (claim.speaker && blob.indexOf(normalizeText(claim.speaker)) < 0) {
      reasons.push('CLAIM_ENTITY_MISMATCH');
    }
    if (claim.subject && blob.indexOf(normalizeText(claim.subject)) < 0) {
      // subject may be event topic; only fail if short proper-like
      if (trimStr(claim.subject).length <= 24) reasons.push('CLAIM_ENTITY_MISMATCH');
    }

    var j;
    for (j = 0; j < OVERSTATEMENT_PAIRS.length; j++) {
      var pair = OVERSTATEMENT_PAIRS[j];
      if (blob.indexOf(normalizeText(pair.soft)) >= 0 && normalizeText(claim.text).indexOf(normalizeText(pair.hard)) >= 0) {
        reasons.push('CLAIM_OVERSTATEMENT');
      }
    }
    // claim asserts confirmation while evidence only has soft language
    if (
      /확정/.test(claim.text) &&
      /가능성|전망|예상|주장/.test(blob) &&
      !/확정/.test(blob)
    ) {
      reasons.push('CLAIM_OVERSTATEMENT');
    }
    if (hasAny(claim.text, CRIME_PREJUDGE) && !/판결|기각|유죄 판결/.test(blob)) {
      reasons.push('CLAIM_OVERSTATEMENT');
    }
    if (hasAny(claim.text, CAUSAL_OVERREACH)) {
      reasons.push('UNSUPPORTED_CAUSALITY');
    }
    // attributed language in evidence but claim drops attribution
    if (/주장|설명|밝혔/.test(blob) && !hasAny(claim.text, ATTRIBUTION_MARKERS) && claim.classification === CLASSIFICATION.CONFIRMED_FACT) {
      reasons.push('CLAIM_OVERSTATEMENT');
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  function validateClaimSourceCoverage(claim, sourcesById, evidencesById) {
    var reasons = [];
    var i;
    for (i = 0; i < (claim.evidenceIds || []).length; i++) {
      var ev = evidencesById[claim.evidenceIds[i]];
      if (!ev) {
        reasons.push('CLAIM_EVIDENCE_MISSING');
        continue;
      }
      if (!sourcesById[ev.sourceId]) reasons.push('EVIDENCE_SOURCE_NOT_FOUND');
      if (
        claim.supportingSourceIds.length &&
        claim.supportingSourceIds.indexOf(ev.sourceId) < 0 &&
        claim.classification === CLASSIFICATION.CONFIRMED_FACT
      ) {
        reasons.push('CLAIM_SOURCE_MISMATCH');
      }
    }
    for (i = 0; i < (claim.supportingSourceIds || []).length; i++) {
      if (!sourcesById[claim.supportingSourceIds[i]]) reasons.push('CLAIM_SOURCE_MISMATCH');
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  function validateClaimClassification(claim) {
    var reasons = [];
    var c = claim.classification;
    if (!CLASSIFICATION[c]) {
      reasons.push('CLAIMS_EMPTY');
      return { ok: false, reasons: reasons };
    }
    if (c === CLASSIFICATION.ATTRIBUTED_CLAIM) {
      if (!claim.speaker && !claim.subject) reasons.push('ATTRIBUTION_MISSING');
      if (!claim.evidenceIds.length) reasons.push('CLAIM_EVIDENCE_MISSING');
    }
    if (c === CLASSIFICATION.CONFIRMED_FACT) {
      if (!claim.evidenceIds.length) reasons.push('CLAIM_EVIDENCE_MISSING');
      if (!claim.supportingSourceIds.length) reasons.push('CLAIM_SOURCE_MISMATCH');
    }
    if (c === CLASSIFICATION.SOURCE_DISAGREEMENT) {
      if (!claim.variants || claim.variants.length < 2) reasons.push('SOURCE_DISAGREEMENT_HIDDEN');
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  function processCandidateClaims(rawClaims, sources, evidences) {
    var sourcesById = mapSourceById(sources);
    var evidencesById = mapEvidenceById(evidences);
    var claims = [];
    var i;
    for (i = 0; i < (rawClaims || []).length; i++) {
      var claim = normalizeClaim(rawClaims[i], i);
      var forced = claim.classification;
      var classed = forced
        ? { classification: forced, reasons: [] }
        : classifyClaimHeuristic(claim, sourcesById, evidencesById);
      claim.classification = classed.classification;
      claim.failureReasons = (claim.failureReasons || []).concat(classed.reasons);

      var cov = validateClaimSourceCoverage(claim, sourcesById, evidencesById);
      var cls = validateClaimClassification(claim);
      var txt = validateClaimTextAgainstEvidence(claim, evidencesById);
      claim.failureReasons = claim.failureReasons.concat(cov.reasons, cls.reasons, txt.reasons);

      // unique reasons
      var seen = {};
      claim.failureReasons = claim.failureReasons.filter(function (r) {
        if (!r || seen[r]) return false;
        seen[r] = 1;
        return true;
      });

      if (claim.failureReasons.length) {
        if (
          claim.classification === CLASSIFICATION.CONFIRMED_FACT ||
          claim.classification === CLASSIFICATION.ATTRIBUTED_CLAIM
        ) {
          claim.classification = CLASSIFICATION.REJECTED;
        }
        claim.publicationEligibility = false;
      }
      claims.push(claim);
    }
    return claims;
  }

  function groupClaimsForDisplay(claims) {
    var groups = {
      CONFIRMED_FACT: [],
      ATTRIBUTED_CLAIM: [],
      SOURCE_DISAGREEMENT: [],
      UNVERIFIED: [],
      ANALYSIS_FORECAST: [],
      CONTEXT: [],
    };
    (claims || []).forEach(function (c) {
      if (!c || c.classification === CLASSIFICATION.REJECTED) return;
      if (groups[c.classification]) groups[c.classification].push(c);
    });
    return groups;
  }

  return {
    CLASSIFICATION: CLASSIFICATION,
    normalizeClaim: normalizeClaim,
    classifyClaimHeuristic: classifyClaimHeuristic,
    validateClaimTextAgainstEvidence: validateClaimTextAgainstEvidence,
    validateClaimSourceCoverage: validateClaimSourceCoverage,
    validateClaimClassification: validateClaimClassification,
    processCandidateClaims: processCandidateClaims,
    groupClaimsForDisplay: groupClaimsForDisplay,
    extractNumbers: extractNumbers,
    extractDates: extractDates,
  };
});
