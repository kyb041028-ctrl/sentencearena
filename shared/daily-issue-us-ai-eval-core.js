/**
 * US Daily Issue — AI eval contract, rule pre-gate, response validation (no HTTP).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./daily-issue-source-core'),
      require('./daily-issue-publication-decision-core'),
    );
  } else {
    root.DailyIssueUsAiEvalCore = factory(
      root.DailyIssueSourceCore,
      root.DailyIssuePublicationDecisionCore,
    );
  }
})(typeof self !== 'undefined' ? self : this, function usAiEvalFactory(sourceCore, decisionCore) {
  'use strict';

  var OUTCOME = Object.freeze({
    SKIPPED_NOT_ELIGIBLE: 'SKIPPED_NOT_ELIGIBLE',
    BLOCKED_NOT_CONFIGURED: 'BLOCKED_NOT_CONFIGURED',
    AI_CALL_OK: 'AI_CALL_OK',
    AI_CALL_FAILED: 'AI_CALL_FAILED',
    AI_OUTPUT_VALIDATION_FAILED: 'AI_OUTPUT_VALIDATION_FAILED',
    AI_COST_LIMIT: 'AI_COST_LIMIT',
    AI_AUTH_ERROR: 'AI_AUTH_ERROR',
    AI_RATE_LIMIT: 'AI_RATE_LIMIT',
    AI_TIMEOUT: 'AI_TIMEOUT',
  });

  var FORBIDDEN_QUESTION = /\b(vote for|which side|pick a side|are you for or against|pro or con vote)\b/i;
  var PROMPT_INJECTION_MARKERS = /\b(ignore (all )?previous|system prompt|you are now|disregard (the )?policy)\b/i;

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function sourcesFromCandidate(cand) {
    return (cand && (cand.normalizedSources || cand.sourceRefs)) || [];
  }

  function ruleEligibleForAi(cand) {
    if (!cand || cand.ok !== true || cand.publicationStatus !== 'READY') {
      return { ok: false, reason: 'NOT_READY' };
    }
    if (cand.freshnessOk === false) return { ok: false, reason: 'FRESHNESS_FAILED' };
    var qual = cand.qualityFailureReasons || [];
    if (qual.length) return { ok: false, reason: 'QUALITY_' + qual[0] };
    var gate = cand.independentSourceGate || {};
    var j =
      typeof gate.journalismIndependentCount === 'number'
        ? gate.journalismIndependentCount
        : sourceCore && sourceCore.countIndependentJournalismSources
          ? sourceCore.countIndependentJournalismSources(sourcesFromCandidate(cand))
          : 0;
    if (j < 2) return { ok: false, reason: 'JOURNALISM_INDEPENDENT_TOO_LOW' };
    return { ok: true, journalismIndependentCount: j };
  }

  function sanitizeFeedText(text) {
    var t = trimStr(text).slice(0, 4000);
    if (PROMPT_INJECTION_MARKERS.test(t)) {
      return t.replace(PROMPT_INJECTION_MARKERS, '[filtered]');
    }
    return t;
  }

  function buildModelInput(cand, opts) {
    var o = opts || {};
    var sources = sourcesFromCandidate(cand).map(function (s) {
      return {
        id: s.id,
        publisher: s.publisher,
        url: s.url,
        publishedAt: s.publishedAt,
        title: sanitizeFeedText(s.title),
        excerpt: sanitizeFeedText(s.evidenceSnippet || s.description || ''),
      };
    });
    var claims = (cand.claims || []).map(function (c) {
      return {
        id: c.id,
        text: sanitizeFeedText(c.text),
        classification: c.classification,
        isCore: !!c.isCore,
        supportingSourceIds: c.supportingSourceIds || [],
      };
    });
    return {
      activityRegion: 'US',
      asOf: o.asOf || cand.retrievedAt || new Date().toISOString(),
      clusterTitle: sanitizeFeedText(cand.title),
      confirmedSummary: sanitizeFeedText(cand.confirmedSummary),
      claims: claims,
      sources: sources,
      instructions:
        'Analyze ONLY the provided sources and claims. Output JSON matching the schema. Do not invent facts, people, numbers, or quotes. Neutral discussion question only — no vote-for-side wording. English only.',
    };
  }

  function sourceIdSet(cand) {
    var set = {};
    sourcesFromCandidate(cand).forEach(function (s) {
      if (s && s.id) set[String(s.id)] = s;
    });
    return set;
  }

  function estimateUsd(usage, model) {
    var u = usage || {};
    var prompt = Number(u.prompt_tokens) || 0;
    var completion = Number(u.completion_tokens) || 0;
    var m = String(model || '').toLowerCase();
    var inRate = m.indexOf('gpt-4o') >= 0 ? 2.5e-6 : 0.15e-6;
    var outRate = m.indexOf('gpt-4o') >= 0 ? 10e-6 : 0.6e-6;
    return prompt * inRate + completion * outRate;
  }

  function validateStructuredOutput(cand, payload) {
    var blocked = [];
    var p = payload || {};
    if (!p || typeof p !== 'object') blocked.push('NOT_OBJECT');

    var required = [
      'titleEn',
      'factSummaryEn',
      'discussionQuestionEn',
      'confirmedFacts',
      'referenceLinks',
    ];
    required.forEach(function (k) {
      if (p[k] == null || (typeof p[k] === 'string' && !trimStr(p[k]))) blocked.push('MISSING_' + k);
    });

    if (!Array.isArray(p.confirmedFacts) || !p.confirmedFacts.length) blocked.push('CONFIRMED_FACTS_EMPTY');
    if (!Array.isArray(p.referenceLinks) || !p.referenceLinks.length) blocked.push('REFERENCE_LINKS_EMPTY');

    var ids = sourceIdSet(cand);
    (p.confirmedFacts || []).forEach(function (f, i) {
      if (!f || !trimStr(f.text)) blocked.push('FACT_TEXT_EMPTY_' + i);
      (f.sourceIds || []).forEach(function (sid) {
        if (!ids[sid]) blocked.push('UNKNOWN_SOURCE_ID_' + sid);
      });
      if (!(f.sourceIds || []).length) blocked.push('FACT_WITHOUT_SOURCE_' + i);
    });

    (p.referenceLinks || []).forEach(function (ref, i) {
      var sid = ref && ref.sourceId;
      var src = sid && ids[sid];
      if (!src) blocked.push('REF_UNKNOWN_SOURCE_' + i);
      else if (trimStr(ref.url) !== trimStr(src.url)) blocked.push('REF_URL_MISMATCH_' + i);
    });

    if (FORBIDDEN_QUESTION.test(String(p.discussionQuestionEn || ''))) blocked.push('BIASED_QUESTION');
    if (p.generatedOpposingStance || p.unverifiedFactPresentedAsConfirmed) blocked.push('UNSUPPORTED_CONTENT');

    var blob = JSON.stringify(p);
    if (/[가-힣]/.test(blob)) blocked.push('NON_ENGLISH_OUTPUT');

    if (decisionCore && typeof decisionCore.classifyPublicationDecision === 'function') {
      var probe = Object.assign({}, cand, {
        activityRegion: 'US',
        title: p.titleEn || cand.title,
        confirmedSummary: p.factSummaryEn || cand.confirmedSummary,
        discussionPrompt: p.discussionQuestionEn,
      });
      var d = decisionCore.classifyPublicationDecision(probe, { asOf: cand.retrievedAt });
      if (d && d.publicationDecision === 'MANUAL_REVIEW_REQUIRED') {
        var hard = (d.autoPublishBlockedReasons || []).filter(function (r) {
          return (
            String(r).indexOf('US_CORE_UNVERIFIED') >= 0 ||
            String(r).indexOf('US_SPECULATIVE') >= 0 ||
            String(r).indexOf('JOURNALISM') >= 0
          );
        });
        if (hard.length) blocked.push('RULE_ENGINE_REJECT:' + hard.join(','));
      }
    }

    return { ok: blocked.length === 0, blockedReasons: blocked };
  }

  function applyAiContentToCandidate(cand, payload) {
    var p = payload || {};
    var next = Object.assign({}, cand);
    next.title = trimStr(p.titleEn) || next.title;
    next.confirmedSummary = trimStr(p.factSummaryEn) || next.confirmedSummary;
    next.discussionPrompt = trimStr(p.discussionQuestionEn) || next.discussionPrompt;
    next.usAiContent = {
      backgroundEn: trimStr(p.backgroundEn),
      unverifiedClaims: p.unverifiedClaims || [],
      nationalRelevance: p.nationalRelevance,
      debateSuitability: p.debateSuitability,
      factStatusNote: trimStr(p.factStatusNote),
      referenceLinks: p.referenceLinks || [],
    };
    return next;
  }

  function classifyRunAiSummary(summary) {
    var s = summary || {};
    if (s.blockedNotConfigured) return 'AI_NOT_CONFIGURED';
    if (s.validationFailed > 0 && s.aiCallOk === 0) return 'AI_OUTPUT_VALIDATION_FAILED';
    if (s.callFailed > 0 && s.aiCallOk === 0) return 'AI_CALL_FAILED';
    if (s.costLimited > 0) return 'AI_COST_LIMIT';
    if (s.eligible === 0 && s.readyBeforeAi > 0) return 'ZERO_NORMAL';
    return null;
  }

  return {
    OUTCOME: OUTCOME,
    ruleEligibleForAi: ruleEligibleForAi,
    buildModelInput: buildModelInput,
    validateStructuredOutput: validateStructuredOutput,
    applyAiContentToCandidate: applyAiContentToCandidate,
    estimateUsd: estimateUsd,
    classifyRunAiSummary: classifyRunAiSummary,
    sanitizeFeedText: sanitizeFeedText,
  };
});
