/**
 * US Daily Issue — English publication / fact-safety (Korean path unchanged).
 * No external LLM. No alignment scoring.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./daily-issue-publication-decision-core'),
      require('./daily-issue-source-core'),
    );
  } else {
    root.DailyIssueUsPublicationDecisionCore = factory(
      root.DailyIssuePublicationDecisionCore,
      root.DailyIssueSourceCore,
    );
  }
})(typeof self !== 'undefined' ? self : this, function usPublicationFactory(baseDecision, sourceCore) {
  'use strict';

  var DECISION = baseDecision.DECISION;

  var US_SPECULATIVE = /\b(alleged(ly)?|reportedly|unconfirmed|speculation|speculative|could\s|may\s|might\s|expected to|projected|forecast|sources?\s+say)\b/i;
  var US_EMOTIONAL = /\b(shocking|outrage|slams|blasts|destroy(s|ed)?|devastating)\b/i;
  var US_ELECTION_CONTEXT = /\b(election|midterm|senate\s+race|presidential\s+race|governor\s+race|ballot|primary\s+results)\b/i;
  var US_LEGAL_RISK = /\b(indicted|charged with|convicted|trial|lawsuit|guilty|murder|killed|shooting)\b/i;
  var US_UNSETTLED = /\b(too close to call|uncalled|pending|preliminary|partial results)\b/i;

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function blobOf(item) {
    var parts = [item && item.title, item && item.confirmedSummary];
    (item && item.claims ? item.claims : []).forEach(function (c) {
      if (c && c.text) parts.push(c.text);
    });
    return parts.join('\n');
  }

  function journalismIndependentCount(item) {
    var q = (item && item.qualityMeta) || {};
    if (typeof q.journalismIndependentCount === 'number') return q.journalismIndependentCount;
    var gate = (item && item.independentSourceGate) || {};
    if (typeof gate.journalismIndependentCount === 'number') return gate.journalismIndependentCount;
    var refs = (item && item.sourceRefs) || [];
    if (sourceCore && sourceCore.countIndependentJournalismSources) {
      return sourceCore.countIndependentJournalismSources(refs);
    }
    return journalismFromRefsFallback(refs);
  }

  function journalismFromRefsFallback(refs) {
    var seen = {};
    var cnt = 0;
    (refs || []).forEach(function (s) {
      if (!s) return;
      if (String(s.usMediaClass || '').toUpperCase() === 'OFFICIAL') return;
      if (String(s.sourceType || '').toUpperCase() === 'OFFICIAL') return;
      var key =
        trimStr(s.independentNetworkKey).toLowerCase() ||
        trimStr(s.originDomain).toLowerCase() ||
        trimStr(s.publisher).toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = 1;
      cnt += 1;
    });
    return cnt;
  }

  function hasConfirmedFact(item) {
    var claims = (item && item.claims) || [];
    for (var i = 0; i < claims.length; i++) {
      if (claims[i] && claims[i].classification === 'CONFIRMED_FACT' && trimStr(claims[i].text)) return true;
    }
    return !!trimStr(item && item.confirmedSummary);
  }

  function coreClaims(item) {
    return (item && item.claims ? item.claims : []).filter(function (c) {
      return c && c.isCore;
    });
  }

  function hasSourceDisagreement(item) {
    return (item && item.claims ? item.claims : []).some(function (c) {
      return c && c.classification === 'SOURCE_DISAGREEMENT';
    });
  }

  function allSourcesHavePublishedAtAndUrl(item) {
    var refs = (item && item.sourceRefs) || [];
    if (!refs.length) return false;
    for (var i = 0; i < refs.length; i++) {
      if (!refs[i] || !trimStr(refs[i].publishedAt)) return false;
      if (!trimStr(refs[i].url)) return false;
    }
    return true;
  }

  function titleSummaryOverlap(item) {
    var t = trimStr(item && item.title).toLowerCase();
    var s = trimStr(item && item.confirmedSummary).toLowerCase();
    if (!t || !s) return 1;
    var tw = t.split(/\s+/).filter(function (w) {
      return w.length > 3;
    });
    if (!tw.length) return 1;
    var hit = 0;
    tw.forEach(function (w) {
      if (s.indexOf(w) >= 0) hit += 1;
    });
    return hit / tw.length;
  }

  function classifyUsPublicationDecision(item, opts) {
    var o = opts || {};
    var asOf = o.asOf || new Date().toISOString();
    var blocked = [];
    var blob = blobOf(item);

    if (!baseDecision.qualityPassed(item)) blocked.push('QUALITY_NOT_PASSED');
    if (!baseDecision.freshnessPassed(item)) blocked.push('FRESHNESS_NOT_PASSED');
    if (!baseDecision.duplicatePassed(item)) blocked.push('DUPLICATE_NOT_PASSED');

    var jIndep = journalismIndependentCount(item);
    if (jIndep < 2) blocked.push('JOURNALISM_INDEPENDENT_SOURCES_BELOW_2');

    if (hasSourceDisagreement(item)) blocked.push('SOURCE_DISAGREEMENT');
    if (!hasConfirmedFact(item)) blocked.push('CONFIRMED_FACT_MISSING');
    if (!allSourcesHavePublishedAtAndUrl(item)) blocked.push('SOURCE_PUBLISHED_AT_OR_URL_MISSING');

    if (titleSummaryOverlap(item) < 0.15 && trimStr(item.confirmedSummary)) {
      blocked.push('TITLE_SUMMARY_MISMATCH');
    }

    coreClaims(item).forEach(function (c) {
      var text = trimStr(c.text);
      if (!text) return;
      if (c.classification === 'UNVERIFIED' || c.classification === 'OPINION') {
        blocked.push('US_CORE_UNVERIFIED_OR_OPINION:' + (c.id || 'core'));
      }
      if (c.classification === 'CONFIRMED_FACT' && US_SPECULATIVE.test(text)) {
        blocked.push('US_SPECULATIVE_AS_CONFIRMED:' + (c.id || 'core'));
      }
    });

    if (US_SPECULATIVE.test(blob)) blocked.push('US_SPECULATIVE_LANGUAGE');
    if (US_EMOTIONAL.test(blob)) blocked.push('US_EMOTIONAL_HEADLINE');

    if (US_LEGAL_RISK.test(blob)) {
      var hasOfficial = ((item && item.sourceRefs) || []).some(function (s) {
        return String(s.usMediaClass || '').toUpperCase() === 'OFFICIAL';
      });
      if (!hasOfficial || coreClaims(item).some(function (c) {
        return c.classification === 'UNVERIFIED';
      })) {
        blocked.push('US_LEGAL_ALLEGATION_REVIEW');
      }
    }

    if (US_ELECTION_CONTEXT.test(blob)) {
      var cores = coreClaims(item);
      var electionCoreOk =
        cores.length > 0 &&
        cores.every(function (c) {
          return c.classification === 'CONFIRMED_FACT' && !US_SPECULATIVE.test(c.text || '');
        });
      if (US_UNSETTLED.test(blob) || !electionCoreOk) {
        blocked.push('US_ELECTION_UNVERIFIED_OR_UNSETTLED');
      }
    }

    var fClass = String(((item && item.freshnessMeta) || {}).freshnessClass || '');
    if (fClass === 'BREAKING' && US_UNSETTLED.test(blob)) {
      blocked.push('US_BREAKING_UNSETTLED');
    }

    if (String((item && item.status) || '') === 'HELD' || String((item && item.status) || '') === 'REJECTED') {
      blocked.push('STATUS_' + String(item.status));
    }

    if (blocked.length) {
      return {
        publicationDecision: DECISION.MANUAL_REVIEW_REQUIRED,
        publicationDecisionReasons: blocked.slice(),
        requiresManualReview: true,
        autoPublishEligibleAt: null,
        autoPublishBlockedReasons: blocked,
        decisionVersion: 'pub-decision-us-v1',
        decidedAt: asOf,
      };
    }

    return {
      publicationDecision: DECISION.AUTO_PUBLISH_ELIGIBLE,
      publicationDecisionReasons: [
        'QUALITY_OK',
        'FRESHNESS_OK',
        'DUPLICATE_OK',
        'US_JOURNALISM_INDEPENDENT_GE_2',
        'CONFIRMED_FACT_OK',
        'SOURCE_ATTRIBUTION_OK',
        'US_FACT_SAFETY_OK',
      ],
      requiresManualReview: false,
      autoPublishEligibleAt: asOf,
      autoPublishBlockedReasons: [],
      decisionVersion: 'pub-decision-us-v1',
      decidedAt: asOf,
    };
  }

  return {
    classifyUsPublicationDecision: classifyUsPublicationDecision,
    journalismIndependentCount: journalismIndependentCount,
  };
});
