/**
 * 데일리 이슈 — 중복 사건·UPDATE 판정 (순수)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./daily-issue-cluster-core'));
  } else {
    root.DailyIssueDuplicateCore = factory(root.DailyIssueClusterCore);
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueDuplicateCoreFactory(clusterCore) {
  'use strict';

  var DUPLICATE_DECISION = Object.freeze({
    NEW_ISSUE: 'NEW_ISSUE',
    EXACT_DUPLICATE: 'EXACT_DUPLICATE',
    NEAR_DUPLICATE: 'NEAR_DUPLICATE',
    UPDATE_TO_EXISTING: 'UPDATE_TO_EXISTING',
    FOLLOW_UP_CANDIDATE: 'FOLLOW_UP_CANDIDATE',
    INSUFFICIENT_MATCH: 'INSUFFICIENT_MATCH',
  });

  var UPDATE_TYPES = Object.freeze({
    NEW_OFFICIAL_DECISION: 'NEW_OFFICIAL_DECISION',
    NEW_STATISTICAL_UPDATE: 'NEW_STATISTICAL_UPDATE',
    NEW_EVENT_DEVELOPMENT: 'NEW_EVENT_DEVELOPMENT',
    NEW_COURT_DECISION: 'NEW_COURT_DECISION',
    NEW_POLICY_CHANGE: 'NEW_POLICY_CHANGE',
    NEW_CASUALTY_UPDATE: 'NEW_CASUALTY_UPDATE',
    NEW_REPORT_RELEASED: 'NEW_REPORT_RELEASED',
    FOLLOW_UP: 'FOLLOW_UP',
  });

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function stableSort(arr) {
    return (arr || []).slice().map(trimStr).filter(Boolean).sort();
  }

  function hashParts(parts) {
    return clusterCore.contentHash(stableSort(parts).join('|'));
  }

  function normalizeUrlKey(url) {
    try {
      var u = new URL(String(url || ''));
      u.hash = '';
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'at_medium', 'at_campaign'].forEach(
        function (k) {
          u.searchParams.delete(k);
        },
      );
      return (u.origin + u.pathname).toLowerCase().replace(/\/$/, '');
    } catch (_) {
      return trimStr(url).toLowerCase();
    }
  }

  function sourceSetSignature(sources) {
    var keys = (sources || []).map(function (s) {
      return normalizeUrlKey(s.url) || trimStr(s.id) || trimStr(s.publisher);
    });
    return hashParts(keys);
  }

  function claimSetSignature(claims) {
    var keys = (claims || [])
      .filter(function (c) {
        return c && c.classification !== 'REJECTED';
      })
      .map(function (c) {
        return clusterCore.normalizeTitleKey(c.text || '');
      });
    return hashParts(keys);
  }

  function contentSignature(candidate) {
    var title = clusterCore.normalizeTitleKey(candidate && (candidate.title || candidate.topic));
    var claims = claimSetSignature(candidate && candidate.claims);
    var sources = sourceSetSignature(candidate && (candidate.sourceRefs || candidate.normalizedSources || candidate.sources));
    return hashParts([title, claims, sources]);
  }

  function clusterSignature(candidate) {
    if (candidate && candidate.clusterSignature) return trimStr(candidate.clusterSignature);
    if (candidate && candidate.clusterId) return trimStr(candidate.clusterId);
    return contentSignature(candidate);
  }

  function extractPrimaryEntities(text) {
    return clusterCore.extractEntities(String(text || '')).slice(0, 12);
  }

  function buildEventIdentity(candidate) {
    var sources = (candidate && (candidate.sourceRefs || candidate.normalizedSources || candidate.sources)) || [];
    var claims = (candidate && candidate.claims) || [];
    var title = trimStr(candidate && (candidate.title || candidate.topic));
    var confirmed = claims
      .filter(function (c) {
        return c && c.classification === 'CONFIRMED_FACT';
      })
      .map(function (c) {
        return c.text;
      });
    var blob = [title].concat(confirmed).join(' ');
    var entities = extractPrimaryEntities(blob);
    var novelty = ((candidate && candidate.noveltySignals) || []).map(function (n) {
      return n.type || n;
    });
    var eventDates = sources
      .map(function (s) {
        return trimStr(s.sourceEventDate || s.publishedAt);
      })
      .filter(Boolean)
      .sort();
    var official = sources.find(function (s) {
      return String(s.sourceType || '').toUpperCase() === 'OFFICIAL';
    });
    var signature = hashParts([
      entities.slice(0, 5).join(','),
      eventDates[0] || '',
      novelty[0] || '',
      clusterCore.normalizeTitleKey(title).slice(0, 48),
    ]);
    return {
      primaryEntities: entities,
      eventType: novelty[0] || '',
      eventDate: eventDates[0] || null,
      location: '',
      policyOrDocumentId: '',
      primaryOfficialSource: official ? normalizeUrlKey(official.url) : '',
      noveltyType: novelty[0] || '',
      signature: signature,
    };
  }

  function titleSimilarity(a, b) {
    var ta = clusterCore.tokenize(clusterCore.normalizeTitleKey(a || ''));
    var tb = clusterCore.tokenize(clusterCore.normalizeTitleKey(b || ''));
    if (!ta.length || !tb.length) return 0;
    var set = {};
    tb.forEach(function (t) {
      set[t] = 1;
    });
    var hit = 0;
    ta.forEach(function (t) {
      if (set[t]) hit += 1;
    });
    return hit / Math.max(ta.length, tb.length);
  }

  function entityOverlap(a, b) {
    var sa = {};
    (a || []).forEach(function (e) {
      sa[String(e).toLowerCase()] = 1;
    });
    var hit = 0;
    (b || []).forEach(function (e) {
      if (sa[String(e).toLowerCase()]) hit += 1;
    });
    return hit;
  }

  function hasRealNovelty(candidate) {
    var signals = (candidate && candidate.noveltySignals) || [];
    return signals.some(function (n) {
      return n && (n.evidenceIds || []).length > 0;
    });
  }

  function staleOnlyRecirculation(candidate) {
    var stale = (candidate && candidate.staleSignals) || [];
    return stale.some(function (s) {
      var t = typeof s === 'string' ? s : s.type;
      return (
        t === 'RECIRCULATED_URL' ||
        t === 'RECIRCULATED_CONTENT_HASH' ||
        t === 'FEED_REAPPEARANCE_ONLY' ||
        t === 'UPDATE_TIMESTAMP_ONLY'
      );
    });
  }

  function mapNoveltyToUpdateType(signals) {
    var types = (signals || []).map(function (n) {
      return n.type || n;
    });
    if (types.indexOf('NEW_OFFICIAL_DECISION') >= 0) return UPDATE_TYPES.NEW_OFFICIAL_DECISION;
    if (types.indexOf('NEW_STATISTICAL_RELEASE') >= 0) return UPDATE_TYPES.NEW_STATISTICAL_UPDATE;
    if (types.indexOf('NEW_COURT_DECISION') >= 0) return UPDATE_TYPES.NEW_COURT_DECISION;
    if (types.indexOf('NEW_CASUALTY_UPDATE') >= 0) return UPDATE_TYPES.NEW_CASUALTY_UPDATE;
    if (types.indexOf('NEW_REPORT_RELEASED') >= 0) return UPDATE_TYPES.NEW_REPORT_RELEASED;
    if (types.indexOf('NEW_POLICY_ANNOUNCEMENT') >= 0) return UPDATE_TYPES.NEW_POLICY_CHANGE;
    if (types.indexOf('NEW_EVENT_OCCURRED') >= 0) return UPDATE_TYPES.NEW_EVENT_DEVELOPMENT;
    if (types.length) return UPDATE_TYPES.FOLLOW_UP;
    return null;
  }

  /**
   * @param {object} candidate
   * @param {object[]} existingIssues — queue/published/rejected/retired entries with signatures
   */
  function evaluateDuplicate(candidate, existingIssues) {
    var list = Array.isArray(existingIssues) ? existingIssues : [];
    var candId = trimStr(candidate && (candidate.candidateId || candidate.id));
    var candCluster = clusterSignature(candidate);
    var candContent = contentSignature(candidate);
    var candSources = sourceSetSignature(candidate && (candidate.sourceRefs || candidate.normalizedSources || candidate.sources));
    var candClaims = claimSetSignature(candidate && candidate.claims);
    var candIdentity = buildEventIdentity(candidate);
    var candUrls = ((candidate && (candidate.sourceRefs || candidate.normalizedSources || candidate.sources)) || []).map(
      function (s) {
        return normalizeUrlKey(s.url);
      },
    );
    var candHashes = ((candidate && (candidate.sourceRefs || candidate.normalizedSources || candidate.sources)) || [])
      .map(function (s) {
        return trimStr(s.contentHash);
      })
      .filter(Boolean);

    var best = {
      decision: DUPLICATE_DECISION.NEW_ISSUE,
      matchedIssueId: null,
      duplicateScore: 0,
      reasons: [],
      updateEligibility: false,
      updateType: null,
    };

    list.forEach(function (ex) {
      if (!ex) return;
      var reasons = [];
      var score = 0;
      var exId = trimStr(ex.candidateId || ex.id || ex.issueId);
      var exStatus = trimStr(ex.status);

      if (candId && (candId === exId || candId === trimStr(ex.candidateId))) {
        score += 100;
        reasons.push('SAME_CANDIDATE_ID');
      }
      if (candCluster && candCluster === trimStr(ex.clusterSignature || ex.clusterId)) {
        score += 40;
        reasons.push('SAME_CLUSTER_SIGNATURE');
      }
      if (candContent && candContent === trimStr(ex.contentSignature)) {
        score += 50;
        reasons.push('SAME_CONTENT_SIGNATURE');
      }
      if (candSources && candSources === trimStr(ex.sourceSetSignature)) {
        score += 30;
        reasons.push('SAME_SOURCE_SET');
      }
      if (candClaims && candClaims === trimStr(ex.claimSetSignature)) {
        score += 25;
        reasons.push('SAME_CLAIM_SET');
      }

      var exUrls = ((ex.sourceRefs || ex.normalizedSources || []) || []).map(function (s) {
        return normalizeUrlKey(s.url);
      });
      var urlHit = candUrls.some(function (u) {
        return u && exUrls.indexOf(u) >= 0;
      });
      if (urlHit) {
        score += 35;
        reasons.push('SAME_URL');
      }

      var exHashes = ((ex.sourceRefs || []) || [])
        .map(function (s) {
          return trimStr(s.contentHash);
        })
        .filter(Boolean);
      if (
        candHashes.some(function (h) {
          return exHashes.indexOf(h) >= 0;
        })
      ) {
        score += 35;
        reasons.push('SAME_CONTENT_HASH');
      }

      var exIdentity = ex.eventIdentity || buildEventIdentity(ex);
      var entHit = entityOverlap(candIdentity.primaryEntities, exIdentity.primaryEntities);
      if (entHit >= 2) {
        score += 15 + Math.min(10, entHit * 2);
        reasons.push('ENTITY_OVERLAP');
      }
      if (candIdentity.eventDate && candIdentity.eventDate === exIdentity.eventDate) {
        score += 12;
        reasons.push('SAME_EVENT_DATE');
      }
      if (candIdentity.signature && candIdentity.signature === exIdentity.signature) {
        score += 20;
        reasons.push('SAME_EVENT_IDENTITY');
      }

      var sim = titleSimilarity(candidate.title || candidate.topic, ex.title || ex.topic);
      if (sim >= 0.55) {
        score += Math.round(sim * 20);
        reasons.push('TITLE_SIMILAR');
      }

      if (score <= best.duplicateScore) return;

      var decision = DUPLICATE_DECISION.INSUFFICIENT_MATCH;
      var updateEligibility = false;
      var updateType = null;

      if (score >= 90 || reasons.indexOf('SAME_CANDIDATE_ID') >= 0 || reasons.indexOf('SAME_CONTENT_SIGNATURE') >= 0) {
        decision = DUPLICATE_DECISION.EXACT_DUPLICATE;
      } else if (
        (exStatus === 'PUBLISHED' || exStatus === 'RETIRED') &&
        (reasons.indexOf('SAME_EVENT_IDENTITY') >= 0 ||
          (entHit >= 2 && sim >= 0.4) ||
          (sim >= 0.5 && hasRealNovelty(candidate))) &&
        hasRealNovelty(candidate) &&
        !staleOnlyRecirculation(candidate)
      ) {
        // new claims/sources beyond exact match
        var sameClaims = reasons.indexOf('SAME_CLAIM_SET') >= 0;
        var sameSources = reasons.indexOf('SAME_SOURCE_SET') >= 0;
        if (!sameClaims || !sameSources) {
          decision = DUPLICATE_DECISION.UPDATE_TO_EXISTING;
          updateEligibility = true;
          updateType = mapNoveltyToUpdateType(candidate.noveltySignals);
        } else if (staleOnlyRecirculation(candidate) || sameClaims) {
          decision = DUPLICATE_DECISION.NEAR_DUPLICATE;
        } else {
          decision = DUPLICATE_DECISION.FOLLOW_UP_CANDIDATE;
        }
      } else if (score >= 55 && sim >= 0.45) {
        decision = DUPLICATE_DECISION.NEAR_DUPLICATE;
      } else if (score >= 40 && entHit >= 2) {
        decision = DUPLICATE_DECISION.FOLLOW_UP_CANDIDATE;
      } else if (score < 25) {
        decision = DUPLICATE_DECISION.NEW_ISSUE;
      }

      // recirculation against published → never UPDATE
      if (staleOnlyRecirculation(candidate) && (exStatus === 'PUBLISHED' || exStatus === 'RETIRED')) {
        if (decision === DUPLICATE_DECISION.UPDATE_TO_EXISTING) {
          decision = DUPLICATE_DECISION.NEAR_DUPLICATE;
          updateEligibility = false;
          updateType = null;
          reasons.push('RECIRCULATION_NOT_UPDATE');
        }
      }

      best = {
        decision: decision,
        matchedIssueId: exId || trimStr(ex.issueId),
        duplicateScore: score,
        reasons: reasons,
        updateEligibility: updateEligibility,
        updateType: updateType,
        matchedStatus: exStatus,
      };
    });

    if (!list.length) {
      return {
        decision: DUPLICATE_DECISION.NEW_ISSUE,
        matchedIssueId: null,
        duplicateScore: 0,
        reasons: [],
        updateEligibility: false,
        updateType: null,
      };
    }
    if (best.duplicateScore < 25 && best.decision !== DUPLICATE_DECISION.NEW_ISSUE) {
      best.decision = DUPLICATE_DECISION.NEW_ISSUE;
    }
    return best;
  }

  return {
    DUPLICATE_DECISION: DUPLICATE_DECISION,
    UPDATE_TYPES: UPDATE_TYPES,
    normalizeUrlKey: normalizeUrlKey,
    sourceSetSignature: sourceSetSignature,
    claimSetSignature: claimSetSignature,
    contentSignature: contentSignature,
    clusterSignature: clusterSignature,
    buildEventIdentity: buildEventIdentity,
    evaluateDuplicate: evaluateDuplicate,
    titleSimilarity: titleSimilarity,
    mapNoveltyToUpdateType: mapNoveltyToUpdateType,
  };
});
