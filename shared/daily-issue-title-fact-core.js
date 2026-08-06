/**
 * 데일리 이슈 — 제목·RSS 요약 기반 교차출처 fact tuple (quality 미완화)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./daily-issue-cluster-core'));
  } else {
    root.DailyIssueTitleFactCore = factory(root.DailyIssueClusterCore);
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueTitleFactCoreFactory(clusterCore) {
  'use strict';

  var ACTION_PATTERNS = Object.freeze([
    { id: 'EARNINGS_REPORT', re: /영업\s*이?익|영업익|실적|매출|순이익|분기/, label: '실적' },
    { id: 'APPOINTMENT', re: /대표|사장|회장|부사장|임명|용퇴|추천|선임|후보/, label: '인사' },
    { id: 'POLICY_ANNOUNCE', re: /발표|공시|공개|시행|추진|도입|개편/, label: '발표' },
    { id: 'OFFICIAL_DECISION', re: /의결|결정|승인|확정|개최/, label: '결정' },
  ]);

  var FORECAST_RE = /전망|예상|분석|추정|가능성|우려|기대|전망했다|될\s*것/;
  var POLITICAL_INTERP_RE = /여야|與|野|비판|논란|파장|충격|필수|반드시|옳은|잘못/;
  var PERIOD_RE = /(\d+\s*분기|상반기|하반기|올해|작년|\d{4}년)/;
  var HEADLINE_ORG_SUFFIX_RE = /(?:프레시웨이|건설|전자|그룹|은행|증권|화학|물산|카드|보험|리테일|백화점|자동차|중공업|에너지|통신|모빌리티|바이오|제약|항공|철도)/;
  var SUBJECT_REASON_MARKERS = /영향|성장|투자|우려|분석|전망|가능성|필요|대응|확대|축소|감소|증가|하락|상승/;

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function documentTextBlob(doc) {
    var parts = [doc && doc.title, doc && doc.feedSummary, doc && doc.rawText];
    return parts
      .filter(Boolean)
      .map(trimStr)
      .join(' ')
      .slice(0, 600);
  }

  function isTitleOnlyDocument(doc) {
    var raw = trimStr(doc && doc.rawText);
    var from = trimStr(doc && doc.textFrom);
    if (!raw || raw.length < 40) return true;
    if (from === 'summary' || from === 'title') return true;
    return false;
  }

  function extractPeriod(text) {
    var m = String(text || '').match(PERIOD_RE);
    return m ? trimStr(m[1]) : '';
  }

  function headlineSegment(text) {
    return trimStr(String(text || '').split(/[…⋯"“‘]/)[0]);
  }

  function extractHeadlineSubject(text) {
    var head = headlineSegment(text);
    if (!head) return '';
    var m = head.match(
      new RegExp('^([A-Za-z0-9][A-Za-z0-9+\\uac00-\\ud7a3.-]{0,20}' + HEADLINE_ORG_SUFFIX_RE.source + ')'),
    );
    if (m) return trimStr(m[1]);
    m = head.match(new RegExp('^([\\uac00-\\ud7a3A-Za-z0-9+.-]{2,16}' + HEADLINE_ORG_SUFFIX_RE.source + ')'));
    if (m) return trimStr(m[1]);
    m = head.match(/^([A-Za-z0-9][A-Za-z0-9+\uac00-\ud7a3.-]{2,20})/);
    if (m && !SUBJECT_REASON_MARKERS.test(m[1])) return trimStr(m[1]);
    m = head.match(/^([\uac00-\ud7a3]{2,8})/);
    if (m && !SUBJECT_REASON_MARKERS.test(m[1]) && !/분기|영업|실적|고용|물가/.test(m[1])) {
      return trimStr(m[1]);
    }
    return '';
  }

  function scoreSubjectCandidate(name, headline) {
    var compact = trimStr(name).replace(/\s+/g, '');
    if (!compact || compact.length < 2) return -100;
    var score = 0;
    if (HEADLINE_ORG_SUFFIX_RE.test(compact)) score += 45;
    if (/^[A-Za-z0-9]/.test(compact)) score += 35;
    if (headline && headline.indexOf(name) >= 0) score += 30;
    if (/\s/.test(name)) score -= 15;
    if (SUBJECT_REASON_MARKERS.test(name)) score -= 50;
    if (compact.length > 14) score -= 20;
    score += Math.min(compact.length, 10);
    return score;
  }

  function pickPrimarySubject(properNouns, text) {
    var headline = headlineSegment(text);
    var headlineSubject = extractHeadlineSubject(text);
    if (headlineSubject) return headlineSubject;

    var list = (properNouns || []).slice();
    if (!list.length) return '';

    var best = '';
    var bestScore = -Infinity;
    var i;
    for (i = 0; i < list.length; i++) {
      if (/^(與|野|정부|국회)$/.test(list[i])) continue;
      var score = scoreSubjectCandidate(list[i], headline);
      if (score > bestScore) {
        bestScore = score;
        best = list[i];
      }
    }
    return best || list[0] || '';
  }

  function detectActionCategory(text) {
    var blob = String(text || '');
    var i;
    var hit = [];
    for (i = 0; i < ACTION_PATTERNS.length; i++) {
      if (ACTION_PATTERNS[i].re.test(blob)) hit.push(ACTION_PATTERNS[i]);
    }
    if (!hit.length) return null;
    return hit[0];
  }

  function extractFactTuple(doc) {
    var blob = documentTextBlob(doc);
    if (!blob) return null;
    if (FORECAST_RE.test(blob) && !/발표|공시|집계|확정/.test(blob)) {
      return { skipReason: 'FORECAST_ONLY', blob: blob };
    }
    if (POLITICAL_INTERP_RE.test(blob) && !/발표|통계|공식/.test(blob)) {
      return { skipReason: 'POLITICAL_INTERPRETATION', blob: blob };
    }
    var proper = clusterCore.extractProperNouns(blob);
    var subject = pickPrimarySubject(proper, blob);
    if (!subject) return { skipReason: 'SUBJECT_MISSING', blob: blob };
    var actionCat = detectActionCategory(blob);
    if (!actionCat) return { skipReason: 'ACTION_MISSING', blob: blob };
    return {
      subject: subject,
      actionCategory: actionCat.id,
      actionLabel: actionCat.label,
      period: extractPeriod(blob),
      numericFacts: clusterCore.extractNumbers(blob),
      location: '',
      object: '',
      blob: blob,
      titleOnly: isTitleOnlyDocument(doc),
      sourceId: doc.sourceId || doc.id,
      docId: doc.id,
      title: trimStr(doc.title),
    };
  }

  function tuplesAgreeField(a, b, field) {
    var va = trimStr(a && a[field]);
    var vb = trimStr(b && b[field]);
    if (!va || !vb) return field === 'period' ? true : false;
    if (field === 'subject') {
      return clusterCore.matchProperNouns([va], [vb]).length > 0;
    }
    if (field === 'actionCategory') return va === vb;
    if (field === 'period') return va === vb || !va || !vb;
    return va === vb;
  }

  function numericConflict(tuples) {
    var all = [];
    tuples.forEach(function (t) {
      (t.numericFacts || []).forEach(function (n) {
        all.push({ value: n, sourceId: t.sourceId });
      });
    });
    if (all.length < 2) return { conflict: false, reason: '' };
    var values = {};
    all.forEach(function (n) {
      values[n.value] = values[n.value] || [];
      values[n.value].push(n.sourceId);
    });
    var keys = Object.keys(values);
    if (keys.length <= 1) return { conflict: false, reason: '' };
    var hasPercent = keys.some(function (k) {
      return /%/.test(k);
    });
    var hasAmount = keys.some(function (k) {
      return /\d/.test(k) && !/%/.test(k);
    });
    if (hasPercent && hasAmount) {
      return { conflict: true, reason: 'NUMERIC_SCOPE_MISMATCH', variants: keys };
    }
    return { conflict: true, reason: 'NUMERIC_CONFLICT', variants: keys };
  }

  function composeMinimalConfirmedSentence(common) {
    var subject = common.subject;
    var period = common.period;
    var cat = common.actionCategory;
    if (!subject) return '';
    if (cat === 'EARNINGS_REPORT') {
      if (period) return subject + '가 ' + period + ' 실적을 발표했다.';
      return subject + '가 실적을 발표했다.';
    }
    if (cat === 'APPOINTMENT') {
      return subject + ' 관련 인사 보도가 확인됐다.';
    }
    if (cat === 'POLICY_ANNOUNCE' || cat === 'OFFICIAL_DECISION') {
      if (period) return subject + '가 ' + period + ' 관련 내용을 발표했다.';
      return subject + '가 관련 내용을 발표했다.';
    }
    return '';
  }

  /**
   * @param {Array} docs cluster documents (2+)
   * @param {Array} sources normalized sources
   */
  function buildCrossSourceTitleFacts(docs, sources) {
    var out = {
      claims: [],
      evidences: [],
      numericConflicts: [],
      titleOnlyDocCount: 0,
      ok: false,
    };
    if (!docs || docs.length < 2) return out;

    var tuples = [];
    docs.forEach(function (d) {
      if (isTitleOnlyDocument(d)) out.titleOnlyDocCount += 1;
      var t = extractFactTuple(d);
      if (t && !t.skipReason) tuples.push(t);
    });
    if (tuples.length < 2) return out;

    var subjectGroups = {};
    tuples.forEach(function (t) {
      var key = clusterCore.normalizeTitleKey(t.subject);
      if (!subjectGroups[key]) subjectGroups[key] = [];
      subjectGroups[key].push(t);
    });

    var best = null;
    Object.keys(subjectGroups).forEach(function (k) {
      var group = subjectGroups[k];
      if (group.length < 2) return;
      var independent = {};
      group.forEach(function (t) {
        independent[t.sourceId] = 1;
      });
      if (Object.keys(independent).length < 2) return;
      var actionCat = group[0].actionCategory;
      var allSameAction = group.every(function (t) {
        return t.actionCategory === actionCat;
      });
      if (!allSameAction) return;
      var period = group[0].period;
      var periodOk = group.every(function (t) {
        return !period || !t.period || t.period === period;
      });
      if (!periodOk) return;
      if (!best || group.length > best.group.length) {
        best = { group: group, subject: group[0].subject, actionCategory: actionCat, period: period };
      }
    });

    if (!best) return out;

    var numCheck = numericConflict(best.group);
    if (numCheck.conflict) {
      out.numericConflicts.push({
        reason: numCheck.reason,
        variants: numCheck.variants || [],
        subject: best.subject,
      });
    }

    var sentence = composeMinimalConfirmedSentence({
      subject: best.subject,
      actionCategory: best.actionCategory,
      period: best.period,
    });
    if (!sentence || FORECAST_RE.test(sentence) || POLITICAL_INTERP_RE.test(sentence)) return out;

    var evidences = [];
    best.group.forEach(function (t, idx) {
      evidences.push({
        id: 'ev_title_' + t.docId + '_' + idx,
        sourceId: t.sourceId,
        text: trimStr(t.title) || t.blob.slice(0, 200),
        evidenceType: t.titleOnly ? 'TITLE_TEXT' : 'FEED_SUMMARY',
        extractionConfidence: t.titleOnly ? 0.62 : 0.72,
        anonymousAttribution: false,
      });
    });

    var claim = {
      id: 'cl_title_cf_' + clusterCore.contentHash(sentence).slice(0, 12),
      text: sentence,
      classification: 'CONFIRMED_FACT',
      speaker: '',
      subject: best.subject,
      evidenceIds: evidences.map(function (e) {
        return e.id;
      }),
      supportingSourceIds: evidences.map(function (e) {
        return e.sourceId;
      }),
      isCore: true,
      titleFactMeta: {
        actionCategory: best.actionCategory,
        period: best.period || '',
        numericConflict: numCheck.conflict ? numCheck.reason : '',
        titleOnlySources: best.group.filter(function (t) {
          return t.titleOnly;
        }).length,
      },
    };

    if (numCheck.conflict) {
      out.claims.push({
        id: 'cl_title_num_' + clusterCore.contentHash(best.subject).slice(0, 10),
        text: '해당 수치는 출처마다 다르게 보도되고 있다.',
        classification: 'SOURCE_DISAGREEMENT',
        evidenceIds: claim.evidenceIds,
        supportingSourceIds: claim.supportingSourceIds,
        variants: (numCheck.variants || []).map(function (v) {
          return { value: v, unit: '', label: v, sourceIds: claim.supportingSourceIds, evidenceIds: claim.evidenceIds };
        }),
        isCore: false,
        titleFactMeta: { reason: numCheck.reason },
      });
    }

    out.claims.unshift(claim);
    out.evidences = evidences;
    out.ok = true;
    return out;
  }

  return {
    documentTextBlob: documentTextBlob,
    isTitleOnlyDocument: isTitleOnlyDocument,
    extractFactTuple: extractFactTuple,
    numericConflict: numericConflict,
    composeMinimalConfirmedSentence: composeMinimalConfirmedSentence,
    buildCrossSourceTitleFacts: buildCrossSourceTitleFacts,
  };
});
