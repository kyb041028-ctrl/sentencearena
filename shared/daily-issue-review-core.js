/**
 * 데일리 이슈 — 검수 후보 정규화·승인/게시 조건·번들 (순수)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./daily-issue-lifecycle-core'),
      require('./daily-issue-duplicate-core'),
      require('./daily-issue-quality-core'),
      require('./daily-issue-freshness-core'),
      require('../config/daily-issue-freshness-policy'),
      require('../config/daily-issue-publication-policy'),
      require('./daily-issue-publication-decision-core'),
    );
  } else {
    root.DailyIssueReviewCore = factory(
      root.DailyIssueLifecycleCore,
      root.DailyIssueDuplicateCore,
      root.DailyIssueQualityCore,
      root.DailyIssueFreshnessCore,
      root.DailyIssueFreshnessPolicy,
      root.DailyIssuePublicationPolicy,
      root.DailyIssuePublicationDecisionCore,
    );
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueReviewCoreFactory(
  lifecycle,
  duplicateCore,
  qualityCore,
  freshnessCore,
  freshnessPolicy,
  publicationPolicy,
  decisionCore,
) {
  'use strict';

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function parseIso(v) {
    var t = Date.parse(trimStr(v));
    return isFinite(t) ? t : null;
  }

  function computeExpiresAt(candidate, asOfIso) {
    var policy = (freshnessPolicy && freshnessPolicy.POLICY) || {};
    var maxAgeH = Number(policy.defaultMaxPublishedAgeHours) || 72;
    var fc = trimStr(candidate && (candidate.freshnessClass || (candidate.freshnessMeta && candidate.freshnessMeta.freshnessClass)));
    if (fc === 'BREAKING') maxAgeH = Number(policy.breakingMaxPublishedAgeHours) || 48;
    if (fc === 'ONGOING_WITH_NEW_DEVELOPMENT') {
      maxAgeH = Number(policy.longRunningEventUpdateHours) || 72;
    }
    var sources = (candidate && (candidate.sourceRefs || candidate.normalizedSources || candidate.sources)) || [];
    var latestPub = null;
    sources.forEach(function (s) {
      var ms = parseIso(s && s.publishedAt);
      if (ms != null && (latestPub == null || ms > latestPub)) latestPub = ms;
    });
    if (latestPub == null) {
      var lp = parseIso(candidate && (candidate.latestPublishedAt || (candidate.freshnessMeta && candidate.freshnessMeta.latestPublishedAt)));
      latestPub = lp;
    }
    // expiresAt = latestPublishedAt + maxAge — queuedAt으로 연장 금지
    if (latestPub == null) return null;
    return new Date(latestPub + maxAgeH * 36e5).toISOString();
  }

  function isExpired(item, asOfIso) {
    var asOf = parseIso(asOfIso) || Date.now();
    var exp = parseIso(item && item.expiresAt);
    if (exp == null) return true; // fail-closed: no expires → treat as expired for approve/publish
    return asOf > exp;
  }

  function stripRawText(sources) {
    return (sources || []).map(function (s) {
      var o = Object.assign({}, s);
      delete o.rawText;
      delete o.normalizedText;
      return o;
    });
  }

  function slimEvidences(evidences) {
    return (evidences || []).slice(0, 24).map(function (e) {
      return {
        id: e.id,
        sourceId: e.sourceId,
        text: String(e.text || '').slice(0, 400),
        evidenceType: e.evidenceType,
        extractionConfidence: e.extractionConfidence,
        startOffset: e.startOffset,
        endOffset: e.endOffset,
        speaker: e.speaker,
      };
    });
  }

  function buildCandidateId(candidate) {
    if (candidate && candidate.candidateId) return trimStr(candidate.candidateId);
    if (candidate && candidate.clusterId) return 'cand_' + trimStr(candidate.clusterId);
    return 'cand_' + duplicateCore.contentSignature(candidate).slice(0, 20);
  }

  function normalizeIncomingCandidate(raw) {
    var c = raw && typeof raw === 'object' ? raw : {};
    var sources = c.sourceRefs || c.normalizedSources || c.sources || [];
    var evidences = c.evidences || c.normalizedEvidences || c.evidenceRefs || [];
    var claims = c.claims || [];
    var title = trimStr(c.title || c.topic);
    var candidateId = buildCandidateId(c);
    return {
      candidateId: candidateId,
      clusterId: trimStr(c.clusterId),
      title: title,
      category: trimStr(c.category) || 'world',
      claims: claims,
      sourceRefs: stripRawText(sources),
      evidenceRefs: slimEvidences(evidences),
      confirmedSummary: trimStr(c.confirmedSummary),
      discussionPrompt: trimStr(c.discussionPrompt || c.aiQuestion),
      displayGroups: c.displayGroups || null,
      qualityMeta: {
        ok: c.ok === true || c.publicationStatus === 'READY' || c.qualityReadyBeforeFreshness === true,
        publicationStatus: c.publicationStatus || (c.ok ? 'READY' : 'QUARANTINED'),
        qualityReadyBeforeFreshness: !!c.qualityReadyBeforeFreshness || (c.ok === true && c.freshnessOk !== false),
        qualityFailureReasons: c.qualityFailureReasons || [],
        qualityCheckedAt: c.qualityCheckedAt || null,
        qualityGateVersion: c.qualityGateVersion || null,
        sourceFactMeta: c.sourceFactMeta || {},
        independentSourceCount:
          (c.sourceFactMeta && c.sourceFactMeta.independentSourceCount) ||
          (c.independentSourceGate && c.independentSourceGate.independentCount) ||
          0,
      },
      freshnessMeta: {
        ok: c.freshnessOk === true || (c.ok === true && c.freshnessClass && ['BREAKING', 'RECENT_UPDATE', 'ONGOING_WITH_NEW_DEVELOPMENT'].indexOf(c.freshnessClass) >= 0),
        freshnessOk: c.freshnessOk === true,
        freshnessClass: c.freshnessClass || null,
        freshnessScore: c.freshnessScore,
        freshnessFailureReasons: c.freshnessFailureReasons || [],
        freshnessCheckedAt: c.freshnessCheckedAt || null,
        latestPublishedAt: c.latestPublishedAt || null,
        earliestPublishedAt: c.earliestPublishedAt || null,
        noveltySignals: c.noveltySignals || [],
        staleSignals: c.staleSignals || [],
      },
      noveltySignals: c.noveltySignals || [],
      staleSignals: c.staleSignals || [],
      ok: c.ok === true,
      freshnessOk: c.freshnessOk === true,
      publicationStatus: c.publicationStatus,
      choices: c.choices,
      stance: c.stance,
      stanceOptions: c.stanceOptions,
    };
  }

  function revalidateGates(item, opts) {
    var o = opts || {};
    var asOf = trimStr(o.asOf) || new Date().toISOString();
    var built = qualityCore.buildDailyIssueCandidate({
      title: item.title,
      discussionPrompt: item.discussionPrompt || '이 사안을 어떻게 평가하시나요?',
      sources: item.sourceRefs,
      evidences: item.evidenceRefs,
      candidateClaims: item.claims,
      retrievedAt: asOf,
    });
    var gated = freshnessCore.applyFreshnessGateToCandidate(built, {
      asOf: asOf,
      category: item.category,
    });
    return {
      qualityOk: built.ok === true,
      freshnessOk: gated.freshnessOk === true,
      finalOk: gated.ok === true,
      qualityFailureReasons: built.qualityFailureReasons || [],
      freshnessFailureReasons: gated.freshnessFailureReasons || [],
      freshnessClass: gated.freshnessClass,
      claims: gated.claims || built.claims,
      displayGroups: gated.displayGroups || built.displayGroups,
      confirmedSummary: gated.confirmedSummary || built.confirmedSummary,
      sourceFactMeta: gated.sourceFactMeta || built.sourceFactMeta,
      noveltySignals: gated.noveltySignals || [],
      staleSignals: gated.staleSignals || [],
      gated: gated,
    };
  }

  function canEnqueueCandidate(candidate, ctx) {
    var reasons = [];
    var norm = normalizeIncomingCandidate(candidate);
    if (!norm.title) reasons.push('TITLE_MISSING');
    if (!(norm.sourceRefs && norm.sourceRefs.length)) reasons.push('SOURCE_REFS_EMPTY');
    if (!(norm.claims && norm.claims.length)) reasons.push('CLAIMS_EMPTY');
    if (!(norm.evidenceRefs && norm.evidenceRefs.length)) reasons.push('EVIDENCE_EMPTY');

    var qualityReady = false;
    if (candidate && candidate.ok === true && candidate.publicationStatus === 'READY') {
      qualityReady = true;
    }
    if (candidate && Array.isArray(candidate.qualityFailureReasons) && candidate.qualityFailureReasons.length) {
      qualityReady = false;
    }
    if (candidate && candidate.qualityReadyBeforeFreshness === false) qualityReady = false;

    var freshnessReady = candidate && candidate.freshnessOk === true;
    if (candidate && candidate.freshnessOk === false) freshnessReady = false;
    // final READY from ingest implies both; still require explicit freshnessOk when present
    if (qualityReady && candidate && candidate.freshnessOk == null && candidate.freshnessClass) {
      var eligible = ['BREAKING', 'RECENT_UPDATE', 'ONGOING_WITH_NEW_DEVELOPMENT'];
      freshnessReady = eligible.indexOf(candidate.freshnessClass) >= 0;
    }

    if (!qualityReady) reasons.push('QUALITY_NOT_READY');
    if (!freshnessReady) reasons.push('FRESHNESS_NOT_READY');

    if (norm.choices || norm.stance || norm.stanceOptions) reasons.push('CHOICES_OR_STANCE_PRESENT');

    var asOf = (ctx && ctx.asOf) || new Date().toISOString();
    var expiresAt = computeExpiresAt(norm, asOf);
    if (!expiresAt || isExpired({ expiresAt: expiresAt }, asOf)) reasons.push('ALREADY_EXPIRED');

    var existing = (ctx && ctx.existingItems) || [];
    var sameId = existing.some(function (e) {
      return trimStr(e.candidateId) === norm.candidateId || trimStr(e.id) === norm.candidateId;
    });
    if (sameId) reasons.push('DUPLICATE_CANDIDATE_ID');

    // rejected same content signature → block re-enqueue
    var contentSig = duplicateCore.contentSignature(norm);
    var rejectedSame = existing.some(function (e) {
      return (
        e.status === lifecycle.REVIEW_STATUS.REJECTED &&
        trimStr(e.contentSignature) === contentSig
      );
    });
    if (rejectedSame) reasons.push('REJECTED_SAME_VERSION');

    var publishedSame = existing.some(function (e) {
      return (
        e.status === lifecycle.REVIEW_STATUS.PUBLISHED &&
        (trimStr(e.contentSignature) === contentSig || trimStr(e.candidateId) === norm.candidateId)
      );
    });
    if (publishedSame) reasons.push('ALREADY_PUBLISHED_SAME');

    var dup = duplicateCore.evaluateDuplicate(
      Object.assign({}, norm, {
        noveltySignals: norm.noveltySignals,
        staleSignals: norm.staleSignals,
      }),
      existing,
    );

    if (dup.decision === duplicateCore.DUPLICATE_DECISION.EXACT_DUPLICATE) {
      reasons.push('EXACT_DUPLICATE');
    }

    return {
      ok: reasons.length === 0,
      reasons: reasons,
      normalized: norm,
      expiresAt: expiresAt,
      contentSignature: contentSig,
      clusterSignature: duplicateCore.clusterSignature(norm),
      sourceSetSignature: duplicateCore.sourceSetSignature(norm.sourceRefs),
      claimSetSignature: duplicateCore.claimSetSignature(norm.claims),
      eventIdentity: duplicateCore.buildEventIdentity(norm),
      duplicate: dup,
    };
  }

  /**
   * claim id는 DB 전역 PK이므로 후보 id로 네임스페이스해 교차 후보 충돌을 막는다.
   * (ingest 산출물 cl_0 등 짧은 id 재사용 대응 — 임계치/품질 기준 변경 없음)
   */
  function namespaceClaimIdsForItem(item) {
    var prefix = trimStr(item && (item.id || item.candidateId));
    if (!prefix) return item;
    var map = {};
    function mapId(id) {
      var s = trimStr(id);
      if (!s) return s;
      if (map[s]) return map[s];
      if (s.indexOf(prefix + '__') === 0) {
        map[s] = s;
        return s;
      }
      var next = prefix + '__' + s;
      map[s] = next;
      return next;
    }
    item.claims = (item.claims || []).map(function (c) {
      return Object.assign({}, c, { id: mapId(c.id) });
    });
    if (item.displayGroups && typeof item.displayGroups === 'object') {
      Object.keys(item.displayGroups).forEach(function (section) {
        item.displayGroups[section] = (item.displayGroups[section] || []).map(function (c) {
          return Object.assign({}, c, { id: mapId(c.id) });
        });
      });
    }
    return item;
  }

  function createReviewItem(candidate, ctx) {
    var check = canEnqueueCandidate(candidate, ctx);
    if (!check.ok) {
      return { ok: false, reasons: check.reasons, item: null };
    }
    var now = trimStr((ctx && ctx.asOf) || new Date().toISOString());
    var dup = check.duplicate;
    var status = lifecycle.REVIEW_STATUS.READY_FOR_REVIEW;
    var updateType = null;
    var priorIssueId = null;
    var norm = check.normalized;
    if (dup.decision === duplicateCore.DUPLICATE_DECISION.UPDATE_TO_EXISTING && dup.updateEligibility) {
      status = lifecycle.REVIEW_STATUS.UPDATE_PENDING;
      updateType = dup.updateType || duplicateCore.UPDATE_TYPES.FOLLOW_UP;
      priorIssueId = dup.matchedIssueId;
    } else if (dup.decision === duplicateCore.DUPLICATE_DECISION.FOLLOW_UP_CANDIDATE) {
      status = lifecycle.REVIEW_STATUS.UPDATE_PENDING;
      updateType = duplicateCore.UPDATE_TYPES.FOLLOW_UP;
      priorIssueId = dup.matchedIssueId;
    } else if (dup.decision === duplicateCore.DUPLICATE_DECISION.NEAR_DUPLICATE) {
      if (dup.matchedStatus === 'PUBLISHED' || dup.matchedStatus === 'RETIRED') {
        if (hasNoveltyEvidence(norm) || (norm.noveltySignals || []).length) {
          status = lifecycle.REVIEW_STATUS.UPDATE_PENDING;
          updateType = duplicateCore.mapNoveltyToUpdateType(norm.noveltySignals) || duplicateCore.UPDATE_TYPES.FOLLOW_UP;
          priorIssueId = dup.matchedIssueId;
        } else {
          return {
            ok: false,
            reasons: ['NEAR_DUPLICATE_BLOCK'],
            item: null,
            duplicate: dup,
          };
        }
      }
    }

    var item = {
      id: norm.candidateId,
      candidateId: norm.candidateId,
      clusterId: norm.clusterId,
      status: status,
      title: norm.title,
      category: norm.category,
      claims: norm.claims,
      sourceRefs: norm.sourceRefs,
      evidenceRefs: norm.evidenceRefs,
      confirmedSummary: norm.confirmedSummary,
      discussionPrompt: norm.discussionPrompt,
      displayGroups: norm.displayGroups,
      qualityMeta: norm.qualityMeta,
      freshnessMeta: norm.freshnessMeta,
      duplicateMeta: {
        decision: dup.decision,
        matchedIssueId: dup.matchedIssueId,
        duplicateScore: dup.duplicateScore,
        reasons: dup.reasons,
        updateEligibility: !!dup.updateEligibility,
      },
      lifecycleMeta: {
        contentSignature: check.contentSignature,
        clusterSignature: check.clusterSignature,
        sourceSetSignature: check.sourceSetSignature,
        claimSetSignature: check.claimSetSignature,
      },
      contentSignature: check.contentSignature,
      clusterSignature: check.clusterSignature,
      sourceSetSignature: check.sourceSetSignature,
      claimSetSignature: check.claimSetSignature,
      eventIdentity: check.eventIdentity,
      noveltySignals: norm.noveltySignals,
      staleSignals: norm.staleSignals,
      createdAt: now,
      queuedAt: now,
      reviewedAt: null,
      approvedAt: null,
      publishedAt: null,
      expiresAt: check.expiresAt,
      publishExpiresAt: null,
      retiredAt: null,
      reviewerId: null,
      reviewReason: null,
      holdReason: null,
      rejectReason: null,
      retireReason: null,
      priorIssueId: priorIssueId,
      updateType: updateType,
      updateHistory: [],
      version: 1,
    };
    namespaceClaimIdsForItem(item);
    if (decisionCore && typeof decisionCore.attachDecisionToItem === 'function') {
      var attached = decisionCore.attachDecisionToItem(item, { asOf: now });
      item = attached.item;
    }
    return { ok: true, reasons: [], item: item, duplicate: dup };
  }

  function canApprove(item, opts) {
    var reasons = [];
    var status = item && item.status;
    if (
      status !== lifecycle.REVIEW_STATUS.READY_FOR_REVIEW &&
      status !== lifecycle.REVIEW_STATUS.UPDATE_PENDING &&
      status !== lifecycle.REVIEW_STATUS.HELD
    ) {
      // HELD must go READY first per transition table — approve from HELD not allowed
    }
    if (status === lifecycle.REVIEW_STATUS.HELD) {
      reasons.push('HELD_MUST_RETURN_TO_READY');
    }
    var tr = lifecycle.assertTransition(status, lifecycle.REVIEW_STATUS.APPROVED);
    if (!tr.ok) reasons.push(tr.error);

    var asOf = (opts && opts.asOf) || new Date().toISOString();
    if (isExpired(item, asOf)) reasons.push('EXPIRED');

    if (item && item.duplicateMeta && item.duplicateMeta.decision === 'EXACT_DUPLICATE') {
      reasons.push('EXACT_DUPLICATE');
    }

    var re = revalidateGates(item, { asOf: asOf });
    if (!re.qualityOk) reasons.push('QUALITY_RECHECK_FAILED');
    if (!re.freshnessOk) reasons.push('FRESHNESS_RECHECK_FAILED');

    var hasRejectedCore = (item.claims || []).some(function (c) {
      return c && c.isCore && c.classification === 'REJECTED';
    });
    if (hasRejectedCore) reasons.push('CORE_CLAIM_REJECTED');

    var hasUnverifiedCore = (item.claims || []).some(function (c) {
      return c && c.isCore !== false && c.classification === 'UNVERIFIED';
    });
    // only block if core unverified without confirmed
    var hasConfirmed = (item.claims || []).some(function (c) {
      return c && c.classification === 'CONFIRMED_FACT';
    });
    if (hasUnverifiedCore && !hasConfirmed) reasons.push('CORE_UNVERIFIED');

    if (!(item.sourceRefs && item.sourceRefs.length)) reasons.push('SOURCE_REFS_EMPTY');
    (item.sourceRefs || []).forEach(function (s) {
      if (!/^https?:\/\//i.test(trimStr(s.url))) reasons.push('SOURCE_URL_INVALID');
    });

    return { ok: reasons.length === 0, reasons: reasons, revalidation: re };
  }

  function canPublish(item, opts) {
    var reasons = [];
    var tr = lifecycle.assertTransition(item && item.status, lifecycle.REVIEW_STATUS.PUBLISHED);
    if (!tr.ok) reasons.push(tr.error);
    if ((item && item.status) !== lifecycle.REVIEW_STATUS.APPROVED) reasons.push('NOT_APPROVED');

    var asOf = (opts && opts.asOf) || new Date().toISOString();
    if (isExpired(item, asOf)) reasons.push('EXPIRED');

    var re = revalidateGates(item, { asOf: asOf });
    if (!re.qualityOk) reasons.push('QUALITY_RECHECK_FAILED');
    if (!re.freshnessOk) reasons.push('FRESHNESS_RECHECK_FAILED');

    if (item && item.duplicateMeta && item.duplicateMeta.decision === 'EXACT_DUPLICATE') {
      reasons.push('EXACT_DUPLICATE');
    }

    var published = (opts && opts.publishedIssues) || [];
    var policy = (publicationPolicy && publicationPolicy.PUBLICATION_POLICY) || {};
    if (published.length >= (Number(policy.maxTotalPublished) || 8)) {
      reasons.push('MAX_TOTAL_PUBLISHED');
    }
    var cat = trimStr(item && item.category) || 'world';
    var catCount = published.filter(function (p) {
      return trimStr(p.category) === cat && p.status === 'PUBLISHED';
    }).length;
    if (catCount >= (Number(policy.maxPublishedPerCategory) || 3)) {
      reasons.push('MAX_CATEGORY_PUBLISHED');
    }

    // duplicate against current published
    var dup = duplicateCore.evaluateDuplicate(item, published);
    if (dup.decision === duplicateCore.DUPLICATE_DECISION.EXACT_DUPLICATE) {
      reasons.push('DUPLICATE_OF_PUBLISHED');
    }
    if (dup.decision === duplicateCore.DUPLICATE_DECISION.NEAR_DUPLICATE && !dup.updateEligibility) {
      reasons.push('NEAR_DUPLICATE_OF_PUBLISHED');
    }

    var hours =
      publicationPolicy && typeof publicationPolicy.resolveDisplayHours === 'function'
        ? publicationPolicy.resolveDisplayHours({
            freshnessClass: item.freshnessMeta && item.freshnessMeta.freshnessClass,
            sourceType: item.qualityMeta && item.qualityMeta.sourceFactMeta && item.qualityMeta.sourceFactMeta.primarySourceType,
          })
        : 24;
    var publishExpiresAt = new Date((parseIso(asOf) || Date.now()) + hours * 36e5).toISOString();

    return {
      ok: reasons.length === 0,
      reasons: reasons,
      revalidation: re,
      publishExpiresAt: publishExpiresAt,
      displayHours: hours,
    };
  }

  function applyUpdateToExisting(publishedIssue, updateItem, opts) {
    var o = opts || {};
    var asOf = trimStr(o.asOf) || new Date().toISOString();
    var existing = publishedIssue && typeof publishedIssue === 'object' ? publishedIssue : null;
    if (!existing || existing.status !== lifecycle.REVIEW_STATUS.PUBLISHED) {
      return { ok: false, error: 'TARGET_NOT_PUBLISHED' };
    }
    var re = revalidateGates(updateItem, { asOf: asOf });
    if (!re.finalOk) {
      return { ok: false, error: 'UPDATE_GATES_FAILED', reasons: (re.qualityFailureReasons || []).concat(re.freshnessFailureReasons || []) };
    }
    if (!hasNoveltyEvidence(updateItem)) {
      return { ok: false, error: 'NO_NEW_DEVELOPMENT' };
    }
    var mergedSources = (existing.sourceRefs || []).slice();
    var seenUrl = {};
    mergedSources.forEach(function (s) {
      seenUrl[duplicateCore.normalizeUrlKey(s.url)] = 1;
    });
    (updateItem.sourceRefs || []).forEach(function (s) {
      var k = duplicateCore.normalizeUrlKey(s.url);
      if (!k || seenUrl[k]) return;
      seenUrl[k] = 1;
      mergedSources.push(s);
    });
    var mergedClaims = (existing.claims || []).concat(updateItem.claims || []);
    var mergedEvidence = (existing.evidenceRefs || []).concat(updateItem.evidenceRefs || []);
    var history = (existing.updateHistory || []).slice();
    history.push({
      at: asOf,
      fromCandidateId: updateItem.candidateId,
      updateType: updateItem.updateType || 'FOLLOW_UP',
      reason: trimStr(o.reasonText) || updateItem.updateType || 'UPDATE',
    });
    var updated = Object.assign({}, existing, {
      sourceRefs: mergedSources,
      claims: mergedClaims,
      evidenceRefs: mergedEvidence,
      updateHistory: history,
      lastUpdatedAt: asOf,
      freshnessMeta: Object.assign({}, existing.freshnessMeta, {
        freshnessClass: re.freshnessClass,
        freshnessCheckedAt: asOf,
        noveltySignals: re.noveltySignals,
      }),
      qualityMeta: Object.assign({}, existing.qualityMeta, {
        qualityCheckedAt: asOf,
        sourceFactMeta: re.sourceFactMeta,
      }),
    });
    // do not change title arbitrarily
    return { ok: true, issue: updated };
  }

  function hasNoveltyEvidence(item) {
    return ((item && item.noveltySignals) || []).some(function (n) {
      return n && (n.evidenceIds || []).length > 0;
    });
  }

  function buildPublishedCentristBundleFromReviewState(input) {
    var src = input || {};
    var generatedAt = trimStr(src.generatedAt) || new Date().toISOString();
    var asOfMs = parseIso(generatedAt) || Date.now();
    var issues = Array.isArray(src.publishedIssues) ? src.publishedIssues : [];
    var byCat = {};
    var included = 0;
    issues.forEach(function (issue, idx) {
      if (!issue || issue.status !== lifecycle.REVIEW_STATUS.PUBLISHED) return;
      var exp = parseIso(issue.publishExpiresAt);
      if (exp != null && asOfMs > exp) return;
      if (issue.status === 'RETIRED' || issue.status === 'SUPERSEDED') return;
      var cat = trimStr(issue.category) || 'world';
      if (!byCat[cat]) byCat[cat] = [];
      var meta = {
        freshnessClass: (issue.freshnessMeta && issue.freshnessMeta.freshnessClass) || null,
        qualityCheckedAt: (issue.qualityMeta && issue.qualityMeta.qualityCheckedAt) || null,
        freshnessCheckedAt: (issue.freshnessMeta && issue.freshnessMeta.freshnessCheckedAt) || null,
        lastSourceUpdateAt: issue.lastUpdatedAt || issue.publishedAt || null,
        sourceCount: (issue.sourceRefs || []).length,
        independentSourceCount:
          (issue.qualityMeta &&
            issue.qualityMeta.sourceFactMeta &&
            issue.qualityMeta.sourceFactMeta.independentSourceCount) ||
          (issue.qualityMeta && issue.qualityMeta.independentSourceCount) ||
          0,
      };
      byCat[cat].push({
        id: issue.id || issue.candidateId || 'pub_' + idx,
        topic: issue.title,
        discussionPrompt: issue.discussionPrompt,
        aiQuestion: issue.discussionPrompt,
        confirmedSummary: issue.confirmedSummary,
        summary: issue.confirmedSummary,
        factSummary: issue.confirmedSummary,
        sourceRefs: (issue.sourceRefs || []).map(function (s) {
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
        }),
        claims: (issue.claims || []).filter(function (cl) {
          return cl.classification !== 'REJECTED';
        }),
        evidences: slimEvidences(issue.evidenceRefs),
        displayGroups: issue.displayGroups,
        publicationStatus: 'PUBLISHED',
        reviewStatus: 'PUBLISHED',
        freshnessClass: meta.freshnessClass,
        qualityCheckedAt: meta.qualityCheckedAt,
        freshnessCheckedAt: meta.freshnessCheckedAt,
        publishedAt: issue.publishedAt,
        publishExpiresAt: issue.publishExpiresAt,
        updateHistory: issue.updateHistory || [],
        followUpOf: issue.priorIssueId || issue.followUpOf || null,
        eventIdentity: issue.eventIdentity || null,
        sourceFactMeta: meta,
        qualityFailureReasons: [],
        updatedAt: issue.lastUpdatedAt || issue.publishedAt || generatedAt,
        comments: [],
      });
      included += 1;
    });
    var categories = {};
    Object.keys(byCat).forEach(function (cat) {
      categories[cat] = { issues: byCat[cat] };
    });
    return {
      bundleVersion: trimStr(src.bundleVersion) || 'review-v1',
      generatedAt: generatedAt,
      publicationMode: 'PUBLISHED_ONLY',
      categories: categories,
      readyCount: included,
      publishedCount: included,
    };
  }

  return {
    computeExpiresAt: computeExpiresAt,
    isExpired: isExpired,
    normalizeIncomingCandidate: normalizeIncomingCandidate,
    canEnqueueCandidate: canEnqueueCandidate,
    createReviewItem: createReviewItem,
    revalidateGates: revalidateGates,
    canApprove: canApprove,
    canPublish: canPublish,
    applyUpdateToExisting: applyUpdateToExisting,
    buildPublishedCentristBundleFromReviewState: buildPublishedCentristBundleFromReviewState,
    buildCandidateId: buildCandidateId,
  };
});
