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

  var CLUSTER_GENERIC_KO = Object.freeze({
    영업익: 1, 분기: 1, 감소: 1, 증가: 1, 마감: 1, 전년: 1, 투자: 1, 실적: 1, 상승: 1, 하락: 1,
    신임: 1, 후보: 1, 용퇴: 1, 추천: 1, 예정: 1, 관련: 1, 영향: 1, 효과: 1, 발표: 1, 보도: 1,
    종합: 1, 속보: 1, 단독: 1, 오늘: 1, 내일: 1, 지난: 1, 올해: 1, 작년: 1, 전망: 1, 분석: 1,
    온라인: 1, 플랫폼: 1, 해외직구: 1, 코스피: 1, 코스닥: 1, 주식: 1, 시장: 1, 거래대금: 1,
  });

  var ORG_NAME_SUFFIXES = Object.freeze([
    '프레시웨이', '건설', '전자', '그룹', '은행', '증권', '화학', '물산', '카드', '보험', '리테일',
    '백화점', '자동차', '중공업', '에너지', '통신', '모빌리티', '바이오', '제약', '항공', '철도',
  ]);

  function normalizeTitleForClustering(title) {
    return trimStr(title)
      .replace(/^\[[^\]]{1,28}\]\s*/g, '')
      .replace(/\[(속보|단독|기획|특징주|단신)\]/g, '')
      .replace(/\(종합\d*보?\)|\(단독\)|\(속보\)|\(연합\)/g, '')
      .replace(/^[『「"'“‘\s]+/g, '')
      .replace(/[…⋯]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeTitleKey(title) {
    return normalizeTitleForClustering(title)
      .toLowerCase()
      .replace(/[「」『』"'“”‘’]/g, ' ')
      .replace(/[^\p{L}\p{N}\s.\-%+]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    var raw = normalizeTitleForClustering(text);
    var quoted = preserveQuotedSpans(raw);
    var s = normalizeTitleKey(raw);
    var out = quoted.slice();
    var seen = {};
    var i;
    function pushToken(t) {
      if (!t || t.length < 2) return;
      if (STOPWORDS[t] || CLUSTER_GENERIC_KO[t]) return;
      if (seen[t]) return;
      seen[t] = 1;
      out.push(t);
    }
    var parts = s.split(/\s+/).filter(Boolean);
    for (i = 0; i < parts.length; i++) {
      var part = parts[i];
      var stripped = part.replace(/(은|는|이|가|을|를|의|에|에서|으로|로|과|와|도|만)$/u, '');
      pushToken(stripped);
      pushToken(part);
      var en;
      var enRe = /[a-z][a-z0-9+.-]*/gi;
      while ((en = enRe.exec(part))) pushToken(en[0].toLowerCase());
      var hangul = part.match(/[\uac00-\ud7a3]{2,12}/g) || [];
      hangul.forEach(pushToken);
    }
    return out;
  }

  function properNounKey(v) {
    return normalizeTitleKey(v).replace(/\s+/g, '');
  }

  function isGenericProperNoun(v) {
    var k = properNounKey(v);
    if (!k || k.length < 2) return true;
    if (STOPWORDS[k] || LOW_WEIGHT[k] || CLUSTER_GENERIC_KO[k]) return true;
    return false;
  }

  function addProperNoun(set, value) {
    var k = properNounKey(value);
    if (!k || k.length < 2 || isGenericProperNoun(k)) return;
    set[k] = trimStr(value);
  }

  function extractProperNouns(text) {
    var raw = normalizeTitleForClustering(text);
    var blob = normalizeTitleKey(raw);
    var found = {};
    var i;
    for (i = 0; i < HIGH_WEIGHT_ENTITIES.length; i++) {
      if (blob.indexOf(HIGH_WEIGHT_ENTITIES[i]) >= 0) addProperNoun(found, HIGH_WEIGHT_ENTITIES[i]);
    }
    (raw.match(/[A-Za-z][A-Za-z0-9+.-]{1,20}/g) || []).forEach(function (en) {
      addProperNoun(found, en);
    });
    for (i = 0; i < ORG_NAME_SUFFIXES.length; i++) {
      var suf = ORG_NAME_SUFFIXES[i];
      var reOrg = new RegExp('([\\uac00-\\ud7a3A-Za-z0-9+.-]{1,16})' + suf, 'g');
      var mOrg;
      while ((mOrg = reOrg.exec(raw))) addProperNoun(found, mOrg[0]);
    }
    (raw.match(/[\uac00-\ud7a3]{2,4}\s*(?:상무|사장|대표|회장|부사장|차관|장관|시장|총리|대통령)/g) || []).forEach(function (p) {
      var name = p.replace(/\s*(상무|사장|대표|회장|부사장|차관|장관|시장|총리|대통령).*/, '');
      addProperNoun(found, name);
    });
    preserveQuotedSpans(raw).forEach(function (q) {
      addProperNoun(found, q);
    });
    (raw.split(/[…⋯,·]/)[0].match(/[\uac00-\ud7a3]{3,10}/g) || []).forEach(function (chunk) {
      addProperNoun(found, chunk);
    });
    return Object.keys(found).map(function (k) {
      return found[k];
    });
  }

  function properNounsMatch(a, b) {
    var ka = properNounKey(a);
    var kb = properNounKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    if (ka.length >= 3 && kb.indexOf(ka) >= 0) return true;
    if (kb.length >= 3 && ka.indexOf(kb) >= 0) return true;
    return false;
  }

  function matchProperNouns(leftList, rightList) {
    var matched = [];
    var seen = {};
    (leftList || []).forEach(function (l) {
      (rightList || []).forEach(function (r) {
        if (!properNounsMatch(l, r)) return;
        var key = properNounKey(l) + '|' + properNounKey(r);
        if (seen[key]) return;
        seen[key] = 1;
        matched.push(l.length >= r.length ? l : r);
      });
    });
    return matched;
  }

  function detectSyndicatedCopy(doc) {
    var blob = String((doc && doc.title) || '') + ' ' + String((doc && doc.rawText) || '').slice(0, 400);
    return (
      /\(연합뉴스\)|\[연합뉴스\]|연합뉴스\s*=\s*/.test(blob) ||
      /\(뉴스1\)|\[뉴스1\]/.test(blob) ||
      !!(doc && doc.syndicatedFromWire)
    );
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
    var found = extractProperNouns(text).slice();
    var blob = normalizeTitleKey(text);
    var i;
    for (i = 0; i < HIGH_WEIGHT_ENTITIES.length; i++) {
      var e = HIGH_WEIGHT_ENTITIES[i];
      if (blob.indexOf(e) >= 0 && found.indexOf(e) < 0) found.push(e);
    }
    var paren = String(text || '').match(/\(([^)]{2,40})\)/g) || [];
    paren.forEach(function (p) {
      var inner = normalizeTitleKey(p.replace(/[()]/g, ''));
      if (inner && inner.length >= 2 && inner.length <= 40 && found.indexOf(inner) < 0) found.push(inner);
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
      if (detectSyndicatedCopy(d)) d.syndicatedFromWire = true;
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
    var lTitle = normalizeTitleForClustering(left.title || '');
    var rTitle = normalizeTitleForClustering(right.title || '');
    var lBlob = lTitle + ' ' + String(left.rawText || '').slice(0, 600);
    var rBlob = rTitle + ' ' + String(right.rawText || '').slice(0, 600);
    var lt = tokenize(lBlob);
    var rt = tokenize(rBlob);
    var ov = weightedOverlap(lt, rt);
    var properL = extractProperNouns(lBlob);
    var properR = extractProperNouns(rBlob);
    var matchedProper = matchProperNouns(properL, properR);
    var entsL = extractEntities(lBlob);
    var entsR = extractEntities(rBlob);
    var matchedEntities = entsL.filter(function (e) {
      return entsR.some(function (r) {
        return properNounsMatch(e, r);
      });
    });
    var numsL = extractNumbers(lBlob);
    var numsR = extractNumbers(rBlob);
    var matchedNumbers = numsL.filter(function (n) {
      return numsR.indexOf(n) >= 0;
    });
    var datesL = extractDates(lBlob);
    var datesR = extractDates(rBlob);
    var matchedDates = datesL.filter(function (d) {
      return datesR.indexOf(d) >= 0;
    });
    var titleOv = jaccard(tokenize(lTitle), tokenize(rTitle));
    var titleEnts = matchProperNouns(extractProperNouns(lTitle), extractProperNouns(rTitle));
    var quoted = preserveQuotedSpans(lTitle).filter(function (q) {
      return (
        preserveQuotedSpans(rTitle).indexOf(q) >= 0 ||
        normalizeTitleKey(rTitle).indexOf(q) >= 0
      );
    });
    var clusterScore =
      ov.score +
      matchedProper.length * 2.8 +
      matchedEntities.length * 1.2 +
      matchedNumbers.length * 1.1 +
      matchedDates.length * 1.4 +
      titleOv * 3;
    if (quoted.length) clusterScore += 3;
    if (titleEnts.length) clusterScore += 2;
    var significantTokens = ov.matched.filter(function (t) {
      return t.length >= 3 && !LOW_WEIGHT[t] && !CLUSTER_GENERIC_KO[t];
    });
    var hasStrongIdentifier =
      matchedProper.length >= 2 ||
      (matchedProper.length >= 1 && matchedNumbers.length >= 1) ||
      (matchedProper.length >= 1 && titleOv >= 0.16) ||
      quoted.length > 0 ||
      matchedEntities.length >= 1;
    var genericOnlyOverlap =
      matchedProper.length === 0 &&
      matchedEntities.length === 0 &&
      quoted.length === 0 &&
      significantTokens.length < 2;
    var titleStrongMerge =
      titleEnts.length >= 1 ||
      titleOv >= 0.12 ||
      matchedNumbers.length >= 1 ||
      (quoted.length > 0 && titleOv >= 0.05);
    if (
      clusterScore >= 4.2 &&
      hasStrongIdentifier &&
      !genericOnlyOverlap &&
      titleStrongMerge
    ) {
      decision = 'MERGE';
    } else {
      decision = 'SEPARATE_WEAK';
    }
    var syndicatedLeft = detectSyndicatedCopy(left);
    var syndicatedRight = detectSyndicatedCopy(right);
    return {
      leftDocumentId: left.id,
      rightDocumentId: right.id,
      score: Math.round(clusterScore * 100) / 100,
      clusterScore: Math.round(clusterScore * 100) / 100,
      matchedTokens: ov.matched.slice(0, 12),
      matchedEntities: matchedEntities.concat(matchedProper).slice(0, 12),
      matchedProperNouns: matchedProper.slice(0, 12),
      matchedNumbers: matchedNumbers.slice(0, 8),
      matchedDates: matchedDates.slice(0, 4),
      matchedEventIds: quoted.concat(titleEnts),
      titleOverlap: titleOv,
      syndicatedLeft: syndicatedLeft,
      syndicatedRight: syndicatedRight,
      decision: decision,
      rejectReason:
        decision === 'MERGE'
          ? null
          : mapPairRejectReason(decision, {
              titleOv: titleOv,
              matchedEntities: matchedEntities,
              matchedProper: matchedProper,
              hours: hours,
              ov: ov,
              genericOnlyOverlap: genericOnlyOverlap,
            }),
    };
  }

  function mapPairRejectReason(decision, detail) {
    if (decision === 'SEPARATE_TIME') return 'DATE_WINDOW_MISMATCH';
    if (decision === 'SEPARATE_SAME_PUBLISHER') return 'DUPLICATE_SOURCE';
    if (decision === 'SEPARATE_WEAK') {
      if (detail.genericOnlyOverlap) return 'GENERIC_TOKEN_ONLY';
      if ((detail.matchedProper || []).length === 0 && (detail.matchedEntities || []).length === 0) {
        return 'ENTITY_OVERLAP_LOW';
      }
      if ((detail.titleOv || 0) < 0.12) return 'TOKEN_OVERLAP_LOW';
      if (!(detail.ov && detail.ov.matched && detail.ov.matched.length)) return 'NO_SHARED_EVENT_IDENTIFIER';
      return 'CLUSTER_SCORE_LOW';
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
    CLUSTER_GENERIC_KO: CLUSTER_GENERIC_KO,
    contentHash: contentHash,
    normalizeTitleForClustering: normalizeTitleForClustering,
    normalizeTitleKey: normalizeTitleKey,
    tokenize: tokenize,
    extractProperNouns: extractProperNouns,
    matchProperNouns: matchProperNouns,
    extractNumbers: extractNumbers,
    extractDates: extractDates,
    extractEntities: extractEntities,
    detectSyndicatedCopy: detectSyndicatedCopy,
    scoreDocumentPair: scoreDocumentPair,
    analyzeCrossSourcePairStats: analyzeCrossSourcePairStats,
    deduplicateDocuments: deduplicateDocuments,
    clusterDocuments: clusterDocuments,
    clusterHasIndependentSources: clusterHasIndependentSources,
  };
});
