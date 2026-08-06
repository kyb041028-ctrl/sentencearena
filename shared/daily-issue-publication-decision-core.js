/**
 * 데일리 이슈 — 자동 게시 vs 관리자 검수 판정 (좁은 AUTO 범위, 애매하면 MANUAL)
 * quality/freshness/lifecycle 임계치는 변경하지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssuePublicationDecisionCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssuePublicationDecisionCoreFactory() {
  'use strict';

  var DECISION = Object.freeze({
    AUTO_PUBLISH_ELIGIBLE: 'AUTO_PUBLISH_ELIGIBLE',
    MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED',
  });

  var ACTOR_AUTO_MORNING = 'AUTO_MORNING_EDITORIAL';

  /** 사실 중심·자동 게시 허용 신호(좁게) */
  var FACT_SAFE_SIGNALS = Object.freeze([
    '공식 발표',
    '보도자료',
    '통계',
    '통계청',
    '일정',
    '경기 결과',
    '재난',
    '교통',
    '기상',
    '발표했다',
    '공시',
    '집계',
    '확정',
    '개표',
    '금리 동결',
    '기준금리',
  ]);

  /** 수동 검수 강제 신호 */
  var MANUAL_RISK_SIGNALS = Object.freeze([
    '정치',
    '갈등',
    '논쟁',
    '논란',
    '혐의',
    '기소',
    '체포',
    '구속',
    '살인',
    '사망',
    '사상자',
    '인명',
    '폭행',
    '성폭력',
    '불법',
    '재판',
    '소송',
    '탄핵',
    '대선',
    '총선',
    '시위',
    '집회',
    '전망',
    '추정',
    '관측',
    '분석',
    '해석',
    '가능성',
    '익명',
    '관계자',
    '속보',
    '미확정',
    '오세훈',
    '대통령',
    '국회',
    '여야',
    '부동산 정책',
    '작심',
  ]);

  var SPECULATIVE_OR_EMOTIONAL = Object.freeze([
    '충격',
    '분노',
    '논란',
    '파장',
    '폭주',
    '발칵',
    '굴욕',
    '맹비난',
    '아수라장',
    '추측',
    '카더라',
  ]);

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function blobOf(item) {
    var parts = [
      item && item.title,
      item && item.confirmedSummary,
      item && item.discussionPrompt,
    ];
    (item && item.claims ? item.claims : []).forEach(function (c) {
      if (c && c.text) parts.push(c.text);
      if (c && c.classification) parts.push(c.classification);
    });
    (item && item.sourceRefs ? item.sourceRefs : []).forEach(function (s) {
      if (s && s.title) parts.push(s.title);
      if (s && s.publisher) parts.push(s.publisher);
    });
    return parts.join('\n');
  }

  function hasHangul(text) {
    return /[가-힣]/.test(String(text || ''));
  }

  function containsAny(text, list) {
    var t = String(text || '');
    for (var i = 0; i < list.length; i++) {
      if (t.indexOf(list[i]) >= 0) return list[i];
    }
    return null;
  }

  function qualityPassed(item) {
    var q = (item && item.qualityMeta) || {};
    if (typeof q.passed === 'boolean') return q.passed;
    if (typeof q.ok === 'boolean') return q.ok;
    if (q.publicationStatus === 'READY') return true;
    if (q.qualityReadyBeforeFreshness === true) return true;
    return false;
  }

  function freshnessPassed(item) {
    var f = (item && item.freshnessMeta) || {};
    if (typeof f.passed === 'boolean') return f.passed;
    if (typeof f.freshnessOk === 'boolean') return f.freshnessOk;
    if (typeof f.ok === 'boolean') return f.ok;
    return false;
  }

  function duplicatePassed(item) {
    var d = (item && item.duplicateMeta) || {};
    var decision = String(d.decision || '');
    if (!decision) return false;
    if (decision === 'EXACT_DUPLICATE' || decision === 'NEAR_DUPLICATE_BLOCK') return false;
    if (decision === 'NEW_ISSUE' || decision === 'NEW' || decision === 'ALLOW_NEW') return true;
    // UPDATE paths need manual review for auto-publish morning edition
    if (decision.indexOf('UPDATE') >= 0 || decision.indexOf('FOLLOW') >= 0) return false;
    if (decision.indexOf('NEAR') >= 0) return false;
    return false;
  }

  function independentSourceCount(item) {
    var q = (item && item.qualityMeta) || {};
    if (typeof q.independentSourceCount === 'number') return q.independentSourceCount;
    if (q.sourceFactMeta && typeof q.sourceFactMeta.independentSourceCount === 'number') {
      return q.sourceFactMeta.independentSourceCount;
    }
    var refs = (item && item.sourceRefs) || [];
    var pubs = {};
    refs.forEach(function (s) {
      var k = String((s && (s.originDomain || s.publisher || s.id)) || '').toLowerCase();
      if (k) pubs[k] = 1;
    });
    return Object.keys(pubs).length;
  }

  function hasConfirmedFact(item) {
    var claims = (item && item.claims) || [];
    for (var i = 0; i < claims.length; i++) {
      if (claims[i] && claims[i].classification === 'CONFIRMED_FACT' && trimStr(claims[i].text)) {
        return true;
      }
    }
    return !!trimStr(item && item.confirmedSummary);
  }

  function hasSourceDisagreement(item) {
    var claims = (item && item.claims) || [];
    for (var i = 0; i < claims.length; i++) {
      if (claims[i] && claims[i].classification === 'SOURCE_DISAGREEMENT') return true;
    }
    return false;
  }

  function allSourcesHavePublishedAt(item) {
    var refs = (item && item.sourceRefs) || [];
    if (!refs.length) return false;
    for (var i = 0; i < refs.length; i++) {
      if (!refs[i] || !trimStr(refs[i].publishedAt)) return false;
    }
    return true;
  }

  function isExpired(item, asOf) {
    var exp = Date.parse((item && (item.expiresAt || item.publishExpiresAt)) || '');
    var now = Date.parse(asOf || new Date().toISOString());
    if (!isFinite(exp) || !isFinite(now)) return false;
    return now > exp;
  }

  function hasChoicesOrStance(item) {
    if (item && Array.isArray(item.choices) && item.choices.length) return true;
    if (item && item.stance != null && item.stance !== '') return true;
    return false;
  }

  function isKoreanItem(item) {
    var title = trimStr(item && item.title);
    if (hasHangul(title)) return true;
    var sum = trimStr(item && item.confirmedSummary);
    if (hasHangul(sum)) return true;
    var claims = (item && item.claims) || [];
    for (var i = 0; i < claims.length; i++) {
      if (hasHangul(claims[i] && claims[i].text)) return true;
    }
    var refs = (item && item.sourceRefs) || [];
    for (var j = 0; j < refs.length; j++) {
      var lang = String((refs[j] && refs[j].language) || '').toLowerCase();
      if (lang === 'ko') return true;
    }
    return false;
  }

  function isFactSafeTopic(blob) {
    return !!containsAny(blob, FACT_SAFE_SIGNALS);
  }

  /**
   * @param {object} item review item or candidate-like
   * @param {object} [opts]
   * @returns {object} decision payload
   */
  function classifyPublicationDecision(item, opts) {
    var o = opts || {};
    var asOf = o.asOf || new Date().toISOString();
    var blocked = [];
    var reasons = [];
    var blob = blobOf(item);

    // Hard gate failures → MANUAL
    if (!qualityPassed(item)) {
      blocked.push('QUALITY_NOT_PASSED');
    }
    if (!freshnessPassed(item)) {
      blocked.push('FRESHNESS_NOT_PASSED');
    }
    if (!duplicatePassed(item)) {
      blocked.push('DUPLICATE_NOT_PASSED');
    }
    if (!isKoreanItem(item)) {
      blocked.push('NOT_KOREAN');
    }
    if (independentSourceCount(item) < 2) {
      blocked.push('INDEPENDENT_SOURCES_BELOW_2');
    }
    if (hasSourceDisagreement(item)) {
      blocked.push('SOURCE_DISAGREEMENT');
    }
    if (!hasConfirmedFact(item)) {
      blocked.push('CONFIRMED_FACT_MISSING');
    }
    if (!allSourcesHavePublishedAt(item)) {
      blocked.push('SOURCE_PUBLISHED_AT_MISSING');
    }
    if (isExpired(item, asOf)) {
      blocked.push('EXPIRED');
    }
    if (hasChoicesOrStance(item)) {
      blocked.push('HAS_CHOICES_OR_STANCE');
    }

    var riskHit = containsAny(blob, MANUAL_RISK_SIGNALS);
    if (riskHit) {
      blocked.push('MANUAL_RISK_SIGNAL:' + riskHit);
    }
    var emotHit = containsAny(blob, SPECULATIVE_OR_EMOTIONAL);
    if (emotHit) {
      blocked.push('SPECULATIVE_OR_EMOTIONAL:' + emotHit);
    }

    var status = String((item && item.status) || '');
    if (status === 'HELD' || status === 'REJECTED') {
      blocked.push('STATUS_' + status);
    }

    var factSafe = isFactSafeTopic(blob);
    if (!factSafe) {
      blocked.push('NOT_FACT_SAFE_TOPIC');
      blocked.push('LOW_CLASSIFIER_CONFIDENCE');
    }

    // Breaking with changing numbers → manual (BREAKING alone not enough if fact-safe, but 속보 already in risk)
    var fClass = String(((item && item.freshnessMeta) || {}).freshnessClass || '');
    if (fClass === 'BREAKING' && /미확정|속보|잠정/.test(blob)) {
      blocked.push('BREAKING_UNSETTLED');
    }

    if (blocked.length) {
      reasons = blocked.slice();
      return {
        publicationDecision: DECISION.MANUAL_REVIEW_REQUIRED,
        publicationDecisionReasons: reasons,
        requiresManualReview: true,
        autoPublishEligibleAt: null,
        autoPublishBlockedReasons: blocked,
        decisionVersion: 'pub-decision-v1',
        decidedAt: asOf,
      };
    }

    reasons = [
      'QUALITY_OK',
      'FRESHNESS_OK',
      'DUPLICATE_OK',
      'KOREAN_OK',
      'INDEPENDENT_SOURCES_GE_2',
      'CONFIRMED_FACT_OK',
      'SOURCE_TIMES_OK',
      'FACT_SAFE_TOPIC',
      'NO_RISK_SIGNAL',
    ];
    return {
      publicationDecision: DECISION.AUTO_PUBLISH_ELIGIBLE,
      publicationDecisionReasons: reasons,
      requiresManualReview: false,
      autoPublishEligibleAt: asOf,
      autoPublishBlockedReasons: [],
      decisionVersion: 'pub-decision-v1',
      decidedAt: asOf,
    };
  }

  function attachDecisionToItem(item, opts) {
    var decision = classifyPublicationDecision(item, opts);
    var next = item || {};
    next.publicationDecision = decision.publicationDecision;
    next.publicationDecisionReasons = decision.publicationDecisionReasons;
    next.requiresManualReview = decision.requiresManualReview;
    next.autoPublishEligibleAt = decision.autoPublishEligibleAt;
    next.autoPublishBlockedReasons = decision.autoPublishBlockedReasons;
    next.lifecycleMeta = Object.assign({}, next.lifecycleMeta || {}, {
      publicationDecision: decision.publicationDecision,
      publicationDecisionReasons: decision.publicationDecisionReasons,
      requiresManualReview: decision.requiresManualReview,
      autoPublishEligibleAt: decision.autoPublishEligibleAt,
      autoPublishBlockedReasons: decision.autoPublishBlockedReasons,
      decisionVersion: decision.decisionVersion,
      decidedAt: decision.decidedAt,
    });
    return { item: next, decision: decision };
  }

  function isAutoPublishEligibleItem(item) {
    return (
      item &&
      item.publicationDecision === DECISION.AUTO_PUBLISH_ELIGIBLE &&
      item.requiresManualReview !== true &&
      String(item.status || '') === 'READY_FOR_REVIEW'
    );
  }

  /** next 05:00 KST as ISO UTC */
  function nextMorningEditorialAtKst(fromIso) {
    var from = fromIso ? new Date(fromIso) : new Date();
    // KST = UTC+9
    var kstMs = from.getTime() + 9 * 3600 * 1000;
    var kst = new Date(kstMs);
    var y = kst.getUTCFullYear();
    var m = kst.getUTCMonth();
    var d = kst.getUTCDate();
    var hour = kst.getUTCHours();
    var targetKst = Date.UTC(y, m, d, 5, 0, 0, 0);
    if (hour >= 5) {
      targetKst = Date.UTC(y, m, d + 1, 5, 0, 0, 0);
    }
    return new Date(targetKst - 9 * 3600 * 1000).toISOString();
  }

  function isMorningWindowKst(asOf, opts) {
    var o = opts || {};
    var graceMin = isFinite(Number(o.graceMinutes)) ? Number(o.graceMinutes) : 30;
    var t = new Date(asOf || Date.now());
    var kstMs = t.getTime() + 9 * 3600 * 1000;
    var kst = new Date(kstMs);
    var minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    var start = 5 * 60;
    var end = start + graceMin;
    return minutes >= start && minutes < end;
  }

  return {
    DECISION: DECISION,
    ACTOR_AUTO_MORNING: ACTOR_AUTO_MORNING,
    FACT_SAFE_SIGNALS: FACT_SAFE_SIGNALS,
    MANUAL_RISK_SIGNALS: MANUAL_RISK_SIGNALS,
    classifyPublicationDecision: classifyPublicationDecision,
    attachDecisionToItem: attachDecisionToItem,
    isAutoPublishEligibleItem: isAutoPublishEligibleItem,
    nextMorningEditorialAtKst: nextMorningEditorialAtKst,
    isMorningWindowKst: isMorningWindowKst,
    qualityPassed: qualityPassed,
    freshnessPassed: freshnessPassed,
    duplicatePassed: duplicatePassed,
  };
});
