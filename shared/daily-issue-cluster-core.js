/**
 * 데일리 이슈 — 문서 중복 제거 · 보수적 사건 군집화 (2차 보강)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssueClusterCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueClusterCoreFactory() {
  'use strict';

  var STOPWORDS = Object.freeze({
    the: 1, a: 1, an: 1, and: 1, or: 1, of: 1, to: 1, in: 1, on: 1, for: 1, with: 1, by: 1,
    from: 1, at: 1, is: 1, are: 1, was: 1, were: 1, be: 1, as: 1, that: 1, this: 1, it: 1,
    및: 1, 그리고: 1, 또는: 1, 등: 1, 관련: 1, 대한: 1, 위한: 1, 통해: 1, 있는: 1, 없는: 1,
    하다: 1, 한다: 1, 했다: 1, 발표: 1, 보도: 1, 소식: 1, news: 1, press: 1, release: 1,
    after: 1, over: 1, into: 1, about: 1, says: 1, say: 1, new: 1,
  });

  var LOW_WEIGHT = Object.freeze({
    정부: 1, 대통령: 1, 국회: 1, government: 1, president: 1, ministry: 1, korea: 1,
    korean: 1, world: 1, people: 1, year: 1, years: 1, today: 1, 한국: 1, 서울: 1,
  });

  var HIGH_WEIGHT_ENTITIES = Object.freeze([
    '한국은행', 'bank of korea', '금융통화위원회', '외환보유액', 'foreign reserves',
    'who', 'world health organization', 'ceuta', 'hormuz', 'federal reserve', 'ecb',
    '기획재정부', '통계청', '금융위원회', '금융감독원', 'gdp', '기준금리', 'interest rate',
    'gaza', 'ukraine', 'un news', 'malaria', 'ebola', 'yonhap',
    // 국내 교차매칭용 고유명사(임계치 완화 없이 titleStrong 엔티티 합의만 보강)
    '모건스탠리', 'morgan stanley', '두산퓨얼셀', '오세훈', '김용범',
  ]);

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function contentHash(text) {
    var s = String(text || '');
    try {
      if (typeof require === 'function') {
        return require('crypto').createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 40);
      }
    } catch (_) {}
    var h = 5381;
    var i;
    for (i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return 'h' + (h >>> 0).toString(16);
  }

  function normalizeTitleKey(title) {
    return trimStr(title)
      .toLowerCase()
      .replace(/[「」『』"'“”]/g, ' ')
      .replace(/[^\p{L}\p{N}\s.\-%]/gu, ' ')
      .replace(/\s+/g, ' ');
  }

  function preserveQuotedSpans(text) {
    var s = String(text || '');
    var out = [];
    var re = /[「『"“]([^」』"”]{2,80})[」』"”]/g;
    var m;
    while ((m = re.exec(s))) out.push(normalizeTitleKey(m[1]));
    return out;
  }

  function tokenize(text) {
    var quoted = preserveQuotedSpans(text);
    var s = normalizeTitleKey(text);
    var parts = s.split(/\s+/).filter(Boolean);
    var out = quoted.slice();
    var i;
    for (i = 0; i < parts.length; i++) {
      var t = parts[i];
      if (t.length < 2) continue;
      if (STOPWORDS[t]) continue;
      t = t.replace(/(은|는|이|가|을|를|의|에|에서|으로|로|과|와|도|만)$/u, '');
      if (t.length < 2 || STOPWORDS[t]) continue;
      out.push(t);
    }
    return out;
  }

  function extractNumbers(text) {
    var s = String(text || '');
    var out = [];
    var re = /\d+(?:[.,]\d+)?%?/g;
    var m;
    while ((m = re.exec(s))) out.push(m[0].replace(/,/g, ''));
    return out;
  }

  function extractDates(text) {
    var s = String(text || '');
    var out = [];
    var re = /\d{4}[-./년]\s*\d{1,2}([-./월]\s*\d{1,2})?/g;
    var m;
    while ((m = re.exec(s))) out.push(normalizeTitleKey(m[0]));
    return out;
  }

  function extractEntities(text) {
    var blob = normalizeTitleKey(text);
    var found = [];
    var i;
    for (i = 0; i < HIGH_WEIGHT_ENTITIES.length; i++) {
      var e = HIGH_WEIGHT_ENTITIES[i];
      if (blob.indexOf(e) >= 0) found.push(e);
    }
    // Parenthetical aliases
    var paren = String(text || '').match(/\(([^)]{2,40})\)/g) || [];
    paren.forEach(function (p) {
      var inner = normalizeTitleKey(p.replace(/[()]/g, ''));
      if (inner && inner.length >= 2 && inner.length <= 40) found.push(inner);
    });
    return found;
  }

  function tokenWeight(t) {
    if (LOW_WEIGHT[t]) return 0.25;
    if (HIGH_WEIGHT_ENTITIES.indexOf(t) >= 0) return 2.5;
    if (t.length >= 6) return 1.4;
    return 1;
  }

  function weightedOverlap(aTokens, bTokens) {
    var sb = {};
    bTokens.forEach(function (t) {
      sb[t] = 1;
    });
    var score = 0;
    var matched = [];
    var seen = {};
    aTokens.forEach(function (t) {
      if (!sb[t] || seen[t]) return;
      seen[t] = 1;
      matched.push(t);
      score += tokenWeight(t);
    });
    return { score: score, matched: matched };
  }

  function jaccard(a, b) {
    var sa = {};
    var sb = {};
    a.forEach(function (x) {
      sa[x] = 1;
    });
    b.forEach(function (x) {
      sb[x] = 1;
    });
    var inter = 0;
    var uni = 0;
    Object.keys(sa).forEach(function (k) {
      uni += 1;
      if (sb[k]) inter += 1;
    });
    Object.keys(sb).forEach(function (k) {
      if (!sa[k]) uni += 1;
    });
    return uni ? inter / uni : 0;
  }

  function hoursBetween(aIso, bIso) {
    var a = Date.parse(aIso);
    var b = Date.parse(bIso);
    if (!isFinite(a) || !isFinite(b)) return Infinity;
    return Math.abs(a - b) / 36e5;
  }

  function deduplicateDocuments(docs) {
    var list = Array.isArray(docs) ? docs.slice() : [];
    var groups = [];
    var canonical = [];
    var seenUrl = {};
    var seenHash = {};
    var seenPrimary = {};
    var seenTitlePub = {};
    var i;
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d || !d.id) continue;
      var url = trimStr(d.url).toLowerCase();
      var hash = trimStr(d.contentHash);
      var primary = trimStr(d.primarySourceUrl).toLowerCase();
      var titleKey = normalizeTitleKey(d.title) + '|' + trimStr(d.publisher).toLowerCase();
      var dupOf = '';
      var reason = '';
      if (url && seenUrl[url]) {
        dupOf = seenUrl[url];
        reason = 'SAME_URL';
      } else if (primary && seenPrimary[primary]) {
        dupOf = seenPrimary[primary];
        reason = 'SAME_PRIMARY_SOURCE_URL';
      } else if (hash && seenHash[hash]) {
        dupOf = seenHash[hash];
        reason = 'SAME_CONTENT_HASH';
      } else if (titleKey && seenTitlePub[titleKey]) {
        dupOf = seenTitlePub[titleKey];
        reason = 'SAME_PUBLISHER_TITLE';
      }
      if (dupOf) {
        groups.push({
          canonicalDocumentId: dupOf,
          duplicateDocumentIds: [d.id],
          duplicateReason: reason,
        });
        continue;
      }
      if (url) seenUrl[url] = d.id;
      if (primary) seenPrimary[primary] = d.id;
      if (hash) seenHash[hash] = d.id;
      if (titleKey) seenTitlePub[titleKey] = d.id;
      canonical.push(d);
    }
    return { documents: canonical, duplicates: groups };
  }

  function scoreDocumentPair(left, right, opts) {
    var o = opts || {};
    var maxHours = isFinite(Number(o.maxHoursApart)) ? Number(o.maxHoursApart) : 72;
    var hours = hoursBetween(left.publishedAt, right.publishedAt);
    var decision = 'SEPARATE';
    if (hours > maxHours) {
      return {
        leftDocumentId: left.id,
        rightDocumentId: right.id,
        score: 0,
        matchedTokens: [],
        matchedEntities: [],
        matchedNumbers: [],
        matchedEventIds: [],
        decision: 'SEPARATE_TIME',
        rejectReason: 'DATE_WINDOW_MISMATCH',
      };
    }
    // never merge solely same publisher
    if (
      trimStr(left.publisher).toLowerCase() &&
      trimStr(left.publisher).toLowerCase() === trimStr(right.publisher).toLowerCase()
    ) {
      return {
        leftDocumentId: left.id,
        rightDocumentId: right.id,
        score: 0,
        matchedTokens: [],
        matchedEntities: [],
        matchedNumbers: [],
        matchedEventIds: [],
        decision: 'SEPARATE_SAME_PUBLISHER',
        rejectReason: 'DUPLICATE_SOURCE',
      };
    }
    var lBlob = (left.title || '') + ' ' + String(left.rawText || '').slice(0, 600);
    var rBlob = (right.title || '') + ' ' + String(right.rawText || '').slice(0, 600);
    var lt = tokenize(lBlob);
    var rt = tokenize(rBlob);
    var ov = weightedOverlap(lt, rt);
    var entsL = extractEntities(lBlob);
    var entsR = extractEntities(rBlob);
    var matchedEntities = entsL.filter(function (e) {
      return entsR.indexOf(e) >= 0;
    });
    var numsL = extractNumbers(lBlob);
    var numsR = extractNumbers(rBlob);
    var matchedNumbers = numsL.filter(function (n) {
      return numsR.indexOf(n) >= 0;
    });
    var titleOv = jaccard(tokenize(left.title || ''), tokenize(right.title || ''));
    var titleEnts = extractEntities(left.title || '').filter(function (e) {
      return extractEntities(right.title || '').indexOf(e) >= 0;
    });
    var quoted = preserveQuotedSpans(left.title || '').filter(function (q) {
      return (
        preserveQuotedSpans(right.title || '').indexOf(q) >= 0 ||
        normalizeTitleKey(right.title || '').indexOf(q) >= 0
      );
    });
    var score = ov.score + matchedEntities.length * 2.2 + matchedNumbers.length * 0.8 + titleOv * 2;
    if (quoted.length) score += 3;
    if (titleEnts.length) score += 2.5;
    // Require title-level agreement — body-only shared tokens must not merge unrelated stories
    var titleStrong = titleEnts.length >= 1 || titleOv >= 0.34 || quoted.length > 0;
    var bodyStrong =
      matchedEntities.length >= 1 &&
      ov.matched.filter(function (t) {
        return t.length >= 4 && !LOW_WEIGHT[t];
      }).length >= 2;
    if (score >= 4.5 && titleStrong && (bodyStrong || titleOv >= 0.28 || titleEnts.length >= 1 || quoted.length)) {
      decision = 'MERGE';
    } else {
      decision = 'SEPARATE_WEAK';
    }
    return {
      leftDocumentId: left.id,
      rightDocumentId: right.id,
      score: Math.round(score * 100) / 100,
      matchedTokens: ov.matched.slice(0, 12),
      matchedEntities: matchedEntities,
      matchedNumbers: matchedNumbers.slice(0, 8),
      matchedEventIds: quoted.concat(titleEnts),
      titleOverlap: titleOv,
      decision: decision,
      rejectReason: decision === 'MERGE' ? null : mapPairRejectReason(decision, {
        titleOv: titleOv,
        matchedEntities: matchedEntities,
        hours: hours,
        ov: ov,
      }),
    };
  }

  function mapPairRejectReason(decision, detail) {
    if (decision === 'SEPARATE_TIME') return 'DATE_WINDOW_MISMATCH';
    if (decision === 'SEPARATE_SAME_PUBLISHER') return 'DUPLICATE_SOURCE';
    if (decision === 'SEPARATE_WEAK') {
      if ((detail.matchedEntities || []).length === 0) return 'ENTITY_OVERLAP_LOW';
      if ((detail.titleOv || 0) < 0.2) return 'TOKEN_OVERLAP_LOW';
      if (!(detail.ov && detail.ov.matched && detail.ov.matched.length)) return 'NO_SHARED_EVENT_IDENTIFIER';
      return 'TOKEN_OVERLAP_LOW';
    }
    return decision || 'SEPARATE_WEAK';
  }

  /**
   * 교차 출처 pair 후보 집계 (기준 완화 없이 원인 수치화)
   */
  function analyzeCrossSourcePairStats(docs, opts) {
    var list = Array.isArray(docs) ? docs : [];
    var bySource = {};
    var rejectedPairReasons = {};
    var crossSourcePairCandidates = 0;
    var i;
    var j;
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      var sid = trimStr(d.sourceRegistryId) || trimStr(d.publisher) || 'unknown';
      if (!bySource[sid]) {
        bySource[sid] = {
          sourceId: sid,
          fetched: 0,
          accepted: 0,
          evidenceEligible: 0,
          recentEligible: 0,
          eventDateDetected: 0,
          clusterParticipated: 0,
          crossSourcePairCandidates: 0,
          rejectedPairReasons: {},
        };
      }
      bySource[sid].fetched += 1;
      bySource[sid].accepted += 1;
      if (String(d.rawText || '').length >= 40) bySource[sid].evidenceEligible += 1;
      if (trimStr(d.publishedAt)) {
        var ageH = hoursBetween(new Date().toISOString(), d.publishedAt);
        if (ageH <= 168) bySource[sid].recentEligible += 1;
      }
      if (trimStr(d.sourceEventDate)) bySource[sid].eventDateDetected += 1;
    }
    for (i = 0; i < list.length; i++) {
      for (j = i + 1; j < list.length; j++) {
        var a = list[i];
        var b = list[j];
        var sa = trimStr(a.sourceRegistryId) || trimStr(a.publisher);
        var sb = trimStr(b.sourceRegistryId) || trimStr(b.publisher);
        if (!sa || sa === sb) continue;
        crossSourcePairCandidates += 1;
        if (bySource[sa]) bySource[sa].crossSourcePairCandidates += 1;
        if (bySource[sb]) bySource[sb].crossSourcePairCandidates += 1;
        var pair = scoreDocumentPair(a, b, opts);
        if (pair.decision === 'MERGE') continue;
        var reason = pair.rejectReason || 'TOKEN_OVERLAP_LOW';
        rejectedPairReasons[reason] = (rejectedPairReasons[reason] || 0) + 1;
        if (bySource[sa]) {
          bySource[sa].rejectedPairReasons[reason] = (bySource[sa].rejectedPairReasons[reason] || 0) + 1;
        }
        if (bySource[sb]) {
          bySource[sb].rejectedPairReasons[reason] = (bySource[sb].rejectedPairReasons[reason] || 0) + 1;
        }
      }
    }
    return {
      bySource: bySource,
      crossSourcePairCandidates: crossSourcePairCandidates,
      rejectedPairReasons: rejectedPairReasons,
    };
  }

  function clusterDocuments(docs, opts) {
    var list = Array.isArray(docs) ? docs.slice() : [];
    var assigned = {};
    var clusters = [];
    var pairwise = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d || !d.id || assigned[d.id]) continue;
      var members = [d];
      assigned[d.id] = 1;
      var reasons = ['SEED'];
      var j;
      for (j = i + 1; j < list.length; j++) {
        var other = list[j];
        if (!other || !other.id || assigned[other.id]) continue;
        var pair = scoreDocumentPair(d, other, opts);
        pairwise.push(pair);
        // also allow merge if strongly matches any current member
        var matchMember = false;
        if (pair.decision === 'MERGE') matchMember = true;
        else {
          var k;
          for (k = 1; k < members.length; k++) {
            var p2 = scoreDocumentPair(members[k], other, opts);
            pairwise.push(p2);
            if (p2.decision === 'MERGE') {
              matchMember = true;
              pair = p2;
              break;
            }
          }
        }
        if (!matchMember) continue;
        members.push(other);
        assigned[other.id] = 1;
        reasons.push('PAIR:' + pair.score + ':' + (pair.matchedEntities[0] || pair.matchedTokens[0] || ''));
      }
      var times = members
        .map(function (m) {
          return m.publishedAt;
        })
        .filter(Boolean)
        .sort();
      var sharedTokens = [];
      if (members.length > 1) {
        var base = tokenize(members[0].title || '');
        sharedTokens = base.filter(function (t) {
          return members.every(function (m) {
            return tokenize(m.title || '').indexOf(t) >= 0;
          });
        });
      }
      var conf = members.length === 1 ? 0.35 : Math.min(0.95, 0.55 + sharedTokens.length * 0.08);
      clusters.push({
        id: 'cl_' + members[0].id,
        documentIds: members.map(function (m) {
          return m.id;
        }),
        sourceIds: members.map(function (m) {
          return m.sourceId || m.id;
        }),
        category: (members[0].categories && members[0].categories[0]) || '',
        startedAt: times[0] || '',
        latestAt: times[times.length - 1] || '',
        sharedTokens: sharedTokens.slice(0, 12),
        sharedEntities: extractEntities(
          members
            .map(function (m) {
              return m.title;
            })
            .join(' '),
        ),
        clusteringConfidence: conf,
        clusteringReasons: reasons,
        pairwise: pairwise.filter(function (p) {
          return members.some(function (m) {
            return m.id === p.leftDocumentId || m.id === p.rightDocumentId;
          });
        }),
      });
    }
    return clusters;
  }

  function clusterHasIndependentSources(cluster, docsById, sourceCore) {
    var docs = (cluster.documentIds || [])
      .map(function (id) {
        return docsById[id];
      })
      .filter(Boolean);
    if (docs.length < 2) return { ok: false, independentCount: docs.length, reason: 'SINGLE_DOC' };
    var pubs = {};
    docs.forEach(function (d) {
      pubs[trimStr(d.publisher).toLowerCase()] = 1;
    });
    if (Object.keys(pubs).length < 2) return { ok: false, independentCount: 1, reason: 'SAME_PUBLISHER' };
    var hashes = {};
    var urls = {};
    var primary = {};
    docs.forEach(function (d) {
      if (d.contentHash) hashes[d.contentHash] = 1;
      if (d.url) urls[String(d.url).toLowerCase()] = 1;
      if (d.primarySourceUrl) primary[String(d.primarySourceUrl).toLowerCase()] = 1;
    });
    if (Object.keys(hashes).length === 1 && docs.length > 1)
      return { ok: false, independentCount: 1, reason: 'SAME_CONTENT_HASH' };
    if (Object.keys(primary).length === 1 && docs.every(function (d) {
      return d.primarySourceUrl;
    }))
      return { ok: false, independentCount: 1, reason: 'SAME_PRIMARY' };
    var asSources = docs.map(function (d) {
      return {
        id: d.sourceId || d.id,
        publisher: d.publisher,
        originDomain: d.originDomain,
        primarySourceUrl: d.primarySourceUrl,
        url: d.url,
        sourceType: d.sourceType,
      };
    });
    var indep = sourceCore ? sourceCore.countIndependentSources(asSources) : Object.keys(pubs).length;
    if (indep < 2) return { ok: false, independentCount: indep, reason: 'INDEPENDENT_TOO_LOW' };
    return { ok: true, independentCount: indep, reason: '' };
  }

  return {
    STOPWORDS: STOPWORDS,
    HIGH_WEIGHT_ENTITIES: HIGH_WEIGHT_ENTITIES,
    contentHash: contentHash,
    normalizeTitleKey: normalizeTitleKey,
    tokenize: tokenize,
    extractNumbers: extractNumbers,
    extractDates: extractDates,
    extractEntities: extractEntities,
    scoreDocumentPair: scoreDocumentPair,
    analyzeCrossSourcePairStats: analyzeCrossSourcePairStats,
    deduplicateDocuments: deduplicateDocuments,
    clusterDocuments: clusterDocuments,
    clusterHasIndependentSources: clusterHasIndependentSources,
  };
});
