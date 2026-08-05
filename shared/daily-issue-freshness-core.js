/**
 * 데일리 이슈 — 최신성·시의성·재순환 게이트 (순수 로직)
 * Node(CommonJS) · 브라우저(UMD, policy는 주입 가능)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../config/daily-issue-freshness-policy'));
  } else {
    root.DailyIssueFreshnessCore = factory(root.DailyIssueFreshnessPolicy || {});
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueFreshnessCoreFactory(policyMod) {
  'use strict';

  var FRESHNESS_CLASSES = (policyMod && policyMod.FRESHNESS_CLASSES) || {
    BREAKING: 'BREAKING',
    RECENT_UPDATE: 'RECENT_UPDATE',
    ONGOING_WITH_NEW_DEVELOPMENT: 'ONGOING_WITH_NEW_DEVELOPMENT',
    BACKGROUND_CONTEXT: 'BACKGROUND_CONTEXT',
    RECIRCULATED_OLD_EVENT: 'RECIRCULATED_OLD_EVENT',
    STALE: 'STALE',
    UNKNOWN: 'UNKNOWN',
  };

  var ELIGIBLE = (policyMod && policyMod.ELIGIBLE_FRESHNESS_CLASSES) || [
    'BREAKING',
    'RECENT_UPDATE',
    'ONGOING_WITH_NEW_DEVELOPMENT',
  ];

  var FAILURE_REASONS = Object.freeze({
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
  });

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function parseIso(v) {
    var s = trimStr(v);
    if (!s) return null;
    var t = Date.parse(s);
    if (!isFinite(t)) return null;
    return t;
  }

  function hoursBetween(laterMs, earlierMs) {
    if (!isFinite(laterMs) || !isFinite(earlierMs)) return null;
    return (laterMs - earlierMs) / 36e5;
  }

  function daysBetween(laterMs, earlierMs) {
    var h = hoursBetween(laterMs, earlierMs);
    return h == null ? null : h / 24;
  }

  function getPolicy(ctx) {
    if (policyMod && typeof policyMod.getPolicyForContext === 'function') {
      return policyMod.getPolicyForContext(ctx || {});
    }
    return (policyMod && policyMod.POLICY) || {
      futureSkewMinutes: 30,
      defaultMaxPublishedAgeHours: 72,
      maxUpdateAgeHours: 72,
      maxEventAgeHours: 72,
      longRunningEventUpdateHours: 72,
      recirculationLookbackDays: 30,
      staleArticleDays: 14,
      officialMaxPublishedAgeHours: 168,
      statisticsMaxPublishedAgeHours: 168,
      breakingMaxPublishedAgeHours: 48,
      backgroundTitleMarkers: [],
      longRunningMarkers: [],
      noveltyPhraseMap: {},
    };
  }

  /**
   * 시간 필드 정규화 — 서로 대체하지 않음. 없으면 null.
   */
  function normalizeTemporalFields(raw, opts) {
    var row = raw && typeof raw === 'object' ? raw : {};
    var o = opts || {};
    var nowIso = trimStr(o.asOf) || new Date().toISOString();
    var publishedAt = trimStr(row.publishedAt) || null;
    var updatedAt = trimStr(row.updatedAt) || null;
    var feedSeenAt = trimStr(row.feedSeenAt) || null;
    var retrievedAt = trimStr(row.retrievedAt) || null;
    var firstSeenAt = trimStr(row.firstSeenAt) || retrievedAt || null;
    var lastSeenAt = trimStr(row.lastSeenAt) || feedSeenAt || retrievedAt || null;
    var sourceEventDate = trimStr(row.sourceEventDate) || null;
    var sourceEventDateConfidence = row.sourceEventDateConfidence == null
      ? null
      : Number(row.sourceEventDateConfidence);
    // NEVER: retrievedAt → publishedAt, updatedAt → publishedAt, feedSeenAt → event
    return {
      publishedAt: publishedAt,
      updatedAt: updatedAt,
      feedSeenAt: feedSeenAt,
      retrievedAt: retrievedAt,
      firstSeenAt: firstSeenAt,
      lastSeenAt: lastSeenAt,
      sourceEventDate: sourceEventDate,
      sourceEventDateConfidence: isFinite(sourceEventDateConfidence) ? sourceEventDateConfidence : null,
      _asOf: nowIso,
    };
  }

  function validateTemporalConsistency(temporal, opts) {
    var o = opts || {};
    var policy = getPolicy(o);
    var asOfMs = parseIso(temporal && temporal._asOf) || Date.now();
    var reasons = [];
    var publishedMs = parseIso(temporal && temporal.publishedAt);
    var updatedMs = parseIso(temporal && temporal.updatedAt);
    var eventMs = parseIso(temporal && temporal.sourceEventDate);
    var skewMs = (Number(policy.futureSkewMinutes) || 30) * 60 * 1000;

    if (temporal && temporal.publishedAt && publishedMs == null) {
      reasons.push(FAILURE_REASONS.DATE_PARSE_INVALID);
    }
    if (temporal && temporal.updatedAt && updatedMs == null) {
      reasons.push(FAILURE_REASONS.UPDATED_AT_INVALID);
    }
    if (temporal && temporal.sourceEventDate && eventMs == null) {
      reasons.push(FAILURE_REASONS.DATE_PARSE_INVALID);
    }
    if (publishedMs != null && publishedMs > asOfMs + skewMs) {
      reasons.push(FAILURE_REASONS.PUBLISHED_AT_FUTURE);
    }
    if (eventMs != null && eventMs > asOfMs + skewMs) {
      reasons.push(FAILURE_REASONS.EVENT_DATE_FUTURE);
    }
    if (updatedMs != null && publishedMs != null && updatedMs + 24 * 36e5 < publishedMs) {
      // updated 하루 이상 이전 → 비정상
      reasons.push(FAILURE_REASONS.DATE_ORDER_INVALID);
    }
    if (eventMs != null && publishedMs != null && eventMs > publishedMs + 48 * 36e5) {
      reasons.push(FAILURE_REASONS.DATE_ORDER_INVALID);
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  var MONTHS = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  /**
   * 명시적 날짜만 보수 추출. 자동으로 최신 날짜를 사건일로 고르지 않음.
   */
  function detectEventDatesFromEvidence(evidences, opts) {
    var o = opts || {};
    var publishedAt = trimStr(o.publishedAt);
    var publishedMs = parseIso(publishedAt);
    var texts = (evidences || []).map(function (e) {
      return trimStr(e && e.text);
    }).filter(Boolean);
    var blob = texts.join('\n');
    var candidates = [];

    function pushCand(iso, conf, kind) {
      if (!iso) return;
      candidates.push({ date: iso, confidence: conf, kind: kind || 'explicit' });
    }

    var isoRe = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
    var m;
    while ((m = isoRe.exec(blob))) {
      pushCand(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00.000Z', 0.85, 'iso');
    }

    var krRe = /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
    while ((m = krRe.exec(blob))) {
      var mm = String(m[2]).padStart(2, '0');
      var dd = String(m[3]).padStart(2, '0');
      pushCand(m[1] + '-' + mm + '-' + dd + 'T00:00:00.000Z', 0.8, 'kr');
    }

    var enRe = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(20\d{2})\b/gi;
    while ((m = enRe.exec(blob))) {
      var mon = MONTHS[m[1].toLowerCase()];
      if (mon == null) continue;
      var d = new Date(Date.UTC(Number(m[3]), mon, Number(m[2])));
      pushCand(d.toISOString(), 0.75, 'en');
    }

    var en2 = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/gi;
    while ((m = en2.exec(blob))) {
      var mon2 = MONTHS[m[2].toLowerCase()];
      if (mon2 == null) continue;
      var d2 = new Date(Date.UTC(Number(m[3]), mon2, Number(m[1])));
      pushCand(d2.toISOString(), 0.75, 'en2');
    }

    // today/yesterday — publishedAt 기준만
    if (publishedMs != null) {
      if (/\btoday\b|오늘/i.test(blob)) {
        pushCand(new Date(publishedMs).toISOString().slice(0, 10) + 'T00:00:00.000Z', 0.55, 'relative_today');
      }
      if (/\byesterday\b|어제/i.test(blob)) {
        pushCand(new Date(publishedMs - 864e5).toISOString().slice(0, 10) + 'T00:00:00.000Z', 0.5, 'relative_yesterday');
      }
    }

    // 확신이 없으면 null — 여러 날짜면 publishedAt에 가장 가까운 "명시" 날짜만, 단 published보다 먼 과거(>365일)는 배경으로 분리
    if (!candidates.length) {
      return { sourceEventDate: null, sourceEventDateConfidence: null, backgroundDates: [], all: [] };
    }

    var backgroundDates = [];
    var eventCands = [];
    candidates.forEach(function (c) {
      var ms = parseIso(c.date);
      if (ms == null) return;
      if (publishedMs != null && daysBetween(publishedMs, ms) > 365) {
        backgroundDates.push(c);
        return;
      }
      eventCands.push(c);
    });

    if (!eventCands.length) {
      return {
        sourceEventDate: null,
        sourceEventDateConfidence: null,
        backgroundDates: backgroundDates,
        all: candidates,
      };
    }

    // 자동으로 최신만 고르지 않음 — publishedAt과의 거리 최소 + confidence
    eventCands.sort(function (a, b) {
      var da = Math.abs((parseIso(a.date) || 0) - (publishedMs || 0));
      var db = Math.abs((parseIso(b.date) || 0) - (publishedMs || 0));
      if (da !== db) return da - db;
      return (b.confidence || 0) - (a.confidence || 0);
    });
    var best = eventCands[0];
    // 신뢰도 낮으면 null
    if ((best.confidence || 0) < 0.5) {
      return { sourceEventDate: null, sourceEventDateConfidence: null, backgroundDates: backgroundDates, all: candidates };
    }
    return {
      sourceEventDate: best.date,
      sourceEventDateConfidence: best.confidence,
      backgroundDates: backgroundDates,
      all: candidates,
    };
  }

  function textHasAny(text, list) {
    var t = String(text || '').toLowerCase();
    var i;
    for (i = 0; i < (list || []).length; i++) {
      if (t.indexOf(String(list[i]).toLowerCase()) >= 0) return true;
    }
    return false;
  }

  function detectNoveltySignals(clusterCtx) {
    var evidences = (clusterCtx && clusterCtx.evidences) || [];
    var sources = (clusterCtx && clusterCtx.sources) || [];
    var policy = getPolicy(clusterCtx);
    var map = policy.noveltyPhraseMap || {};
    var asOf = trimStr(clusterCtx && clusterCtx.asOf) || new Date().toISOString();
    var out = [];
    var type;
    for (type in map) {
      if (!Object.prototype.hasOwnProperty.call(map, type)) continue;
      var phrases = map[type];
      var matchedEv = [];
      var matchedSrc = {};
      evidences.forEach(function (ev) {
        if (!ev || !ev.text) return;
        if (!textHasAny(ev.text, phrases)) return;
        matchedEv.push(ev.id);
        if (ev.sourceId) matchedSrc[ev.sourceId] = 1;
      });
      if (!matchedEv.length) continue;
      out.push({
        type: type,
        evidenceIds: matchedEv.slice(0, 8),
        sourceIds: Object.keys(matchedSrc),
        detectedAt: asOf,
        confidence: Math.min(0.9, 0.55 + matchedEv.length * 0.05),
      });
    }
    // 근거 없는 novelty 금지 — evidenceIds 필수
    return out.filter(function (s) {
      return s.evidenceIds && s.evidenceIds.length > 0;
    });
  }

  function detectStaleSignals(clusterCtx) {
    var policy = getPolicy(clusterCtx);
    var asOfMs = parseIso(clusterCtx && clusterCtx.asOf) || Date.now();
    var sources = (clusterCtx && clusterCtx.sources) || [];
    var title = trimStr(clusterCtx && clusterCtx.title);
    var history = (clusterCtx && clusterCtx.observationHistory) || {};
    var signals = [];

    sources.forEach(function (src) {
      var pubMs = parseIso(src.publishedAt);
      if (pubMs != null) {
        var ageDays = daysBetween(asOfMs, pubMs);
        if (ageDays != null && ageDays > (policy.staleArticleDays || 14)) {
          signals.push({
            type: 'OLD_PUBLISHED_DATE',
            sourceIds: [src.id],
            detail: 'publishedAgeDays=' + Math.round(ageDays),
          });
        }
        var feedMs = parseIso(src.feedSeenAt);
        if (feedMs != null && ageDays != null && ageDays > (policy.staleArticleDays || 14)) {
          var feedAgeH = hoursBetween(asOfMs, feedMs);
          if (feedAgeH != null && feedAgeH <= 48) {
            signals.push({
              type: 'FEED_REAPPEARANCE_ONLY',
              sourceIds: [src.id],
              detail: 'old published, recent feedSeenAt',
            });
          }
        }
      }
      var evMs = parseIso(src.sourceEventDate);
      if (evMs != null) {
        var evDays = daysBetween(asOfMs, evMs);
        if (evDays != null && evDays > 30) {
          signals.push({
            type: 'OLD_EVENT_DATE',
            sourceIds: [src.id],
            detail: 'eventAgeDays=' + Math.round(evDays),
          });
        }
      }
      var updMs = parseIso(src.updatedAt);
      if (updMs != null && pubMs != null) {
        var pubAge = daysBetween(asOfMs, pubMs);
        var updAgeH = hoursBetween(asOfMs, updMs);
        if (pubAge != null && pubAge > (policy.staleArticleDays || 14) && updAgeH != null && updAgeH <= 72) {
          signals.push({
            type: 'UPDATE_TIMESTAMP_ONLY',
            sourceIds: [src.id],
            detail: 'old publish, recent update stamp',
          });
        }
      }
      var urlKey = trimStr(src.url).toLowerCase();
      if (urlKey && history.urlFirstSeenAt && history.urlFirstSeenAt[urlKey]) {
        var first = parseIso(history.urlFirstSeenAt[urlKey]);
        if (first != null && daysBetween(asOfMs, first) > (policy.recirculationLookbackDays || 30) * 0.5) {
          signals.push({ type: 'RECIRCULATED_URL', sourceIds: [src.id], detail: urlKey });
        }
      }
      var hash = trimStr(src.contentHash);
      if (hash && history.contentHashFirstSeenAt && history.contentHashFirstSeenAt[hash]) {
        var hFirst = parseIso(history.contentHashFirstSeenAt[hash]);
        if (hFirst != null && daysBetween(asOfMs, hFirst) >= 1) {
          signals.push({ type: 'RECIRCULATED_CONTENT_HASH', sourceIds: [src.id], detail: hash.slice(0, 12) });
        }
      }
    });

    if (textHasAny(title, policy.backgroundTitleMarkers || [])) {
      signals.push({ type: 'BACKGROUND_LANGUAGE', sourceIds: [], detail: 'title' });
    }
    if (textHasAny(title + ' ' + ((clusterCtx && clusterCtx.bodySample) || ''), [
      'archive', 'anniversary', 'years ago', '기념', '회고', '아카이브',
    ])) {
      signals.push({ type: 'ARCHIVE_OR_ANNIVERSARY_CONTENT', sourceIds: [], detail: '' });
    }

    return signals;
  }

  function isLongRunningTopic(title, sources) {
    var policy = getPolicy({});
    var blob = title + ' ' + (sources || []).map(function (s) {
      return (s.title || '') + ' ' + (s.publisher || '');
    }).join(' ');
    return textHasAny(blob, policy.longRunningMarkers || []);
  }

  function minMaxIso(list) {
    var times = (list || []).map(parseIso).filter(function (t) {
      return t != null;
    });
    if (!times.length) return { min: null, max: null };
    times.sort(function (a, b) {
      return a - b;
    });
    return {
      min: new Date(times[0]).toISOString(),
      max: new Date(times[times.length - 1]).toISOString(),
    };
  }

  function scoreFreshness(freshnessClass, noveltyCount, staleCount) {
    var base = {
      BREAKING: 0.95,
      RECENT_UPDATE: 0.85,
      ONGOING_WITH_NEW_DEVELOPMENT: 0.75,
      BACKGROUND_CONTEXT: 0.25,
      RECIRCULATED_OLD_EVENT: 0.1,
      STALE: 0.05,
      UNKNOWN: 0.2,
    }[freshnessClass] || 0.2;
    return Math.max(0, Math.min(1, base + noveltyCount * 0.02 - staleCount * 0.05));
  }

  function classifyClusterFreshness(clusterCtx) {
    var policy = getPolicy(clusterCtx);
    var asOf = trimStr(clusterCtx && clusterCtx.asOf) || new Date().toISOString();
    var asOfMs = parseIso(asOf) || Date.now();
    var sources = (clusterCtx && clusterCtx.sources) || [];
    var evidences = (clusterCtx && clusterCtx.evidences) || [];
    var title = trimStr(clusterCtx && clusterCtx.title);
    var noveltySignals = detectNoveltySignals(Object.assign({}, clusterCtx, { asOf: asOf }));
    var staleSignals = detectStaleSignals(Object.assign({}, clusterCtx, { asOf: asOf }));
    var failureReasons = [];

    var publishedList = sources.map(function (s) {
      return s.publishedAt;
    });
    var eventList = sources.map(function (s) {
      return s.sourceEventDate;
    }).filter(Boolean);
    var pubRange = minMaxIso(publishedList);
    var evRange = minMaxIso(eventList);
    var firstSeen = minMaxIso(sources.map(function (s) {
      return s.firstSeenAt || s.retrievedAt;
    }));
    var lastSeen = minMaxIso(sources.map(function (s) {
      return s.lastSeenAt || s.feedSeenAt || s.retrievedAt;
    }));

    // temporal consistency per source
    sources.forEach(function (s) {
      var t = normalizeTemporalFields(s, { asOf: asOf });
      var v = validateTemporalConsistency(t, clusterCtx);
      failureReasons = failureReasons.concat(v.reasons);
    });

    var missingPub = sources.filter(function (s) {
      return !trimStr(s.publishedAt);
    });
    if (missingPub.length === sources.length && sources.length) {
      failureReasons.push(FAILURE_REASONS.PUBLISHED_AT_MISSING_FOR_FRESHNESS);
    }

    var latestPubMs = parseIso(pubRange.max);
    var ageH = latestPubMs != null ? hoursBetween(asOfMs, latestPubMs) : null;
    var maxAge = Number(policy.defaultMaxPublishedAgeHours) || 72;
    var breakingMax = Number(policy.breakingMaxPublishedAgeHours) || 48;
    var longRunning = isLongRunningTopic(title, sources);

    var hasRecirc = staleSignals.some(function (s) {
      return s.type === 'RECIRCULATED_URL' ||
        s.type === 'RECIRCULATED_CONTENT_HASH' ||
        s.type === 'FEED_REAPPEARANCE_ONLY';
    });
    var hasBackgroundLang = staleSignals.some(function (s) {
      return s.type === 'BACKGROUND_LANGUAGE' || s.type === 'ARCHIVE_OR_ANNIVERSARY_CONTENT';
    });
    var updateOnly = staleSignals.some(function (s) {
      return s.type === 'UPDATE_TIMESTAMP_ONLY';
    });
    var oldPub = staleSignals.some(function (s) {
      return s.type === 'OLD_PUBLISHED_DATE';
    });

    var freshnessClass = FRESHNESS_CLASSES.UNKNOWN;

    if (failureReasons.indexOf(FAILURE_REASONS.PUBLISHED_AT_FUTURE) >= 0 ||
        failureReasons.indexOf(FAILURE_REASONS.EVENT_DATE_FUTURE) >= 0 ||
        failureReasons.indexOf(FAILURE_REASONS.DATE_ORDER_INVALID) >= 0 ||
        failureReasons.indexOf(FAILURE_REASONS.DATE_PARSE_INVALID) >= 0) {
      freshnessClass = FRESHNESS_CLASSES.UNKNOWN;
    } else if (hasRecirc && oldPub) {
      freshnessClass = FRESHNESS_CLASSES.RECIRCULATED_OLD_EVENT;
      failureReasons.push(FAILURE_REASONS.RECIRCULATED_OLD_EVENT);
    } else if (updateOnly && oldPub) {
      freshnessClass = FRESHNESS_CLASSES.RECIRCULATED_OLD_EVENT;
      failureReasons.push(FAILURE_REASONS.RECIRCULATED_OLD_EVENT);
    } else if (hasBackgroundLang) {
      freshnessClass = FRESHNESS_CLASSES.BACKGROUND_CONTEXT;
      failureReasons.push(FAILURE_REASONS.BACKGROUND_ONLY);
    } else if (ageH != null && ageH > (Number(policy.staleArticleDays) || 14) * 24) {
      freshnessClass = FRESHNESS_CLASSES.STALE;
      failureReasons.push(FAILURE_REASONS.CONTENT_TOO_OLD);
    } else if (longRunning) {
      if (noveltySignals.length && ageH != null && ageH <= (Number(policy.longRunningEventUpdateHours) || 72)) {
        freshnessClass = FRESHNESS_CLASSES.ONGOING_WITH_NEW_DEVELOPMENT;
      } else if (noveltySignals.length === 0) {
        freshnessClass = FRESHNESS_CLASSES.BACKGROUND_CONTEXT;
        failureReasons.push(FAILURE_REASONS.NO_NEW_DEVELOPMENT);
        staleSignals.push({ type: 'NO_NEW_DEVELOPMENT', sourceIds: [], detail: 'long-running without novelty' });
      } else {
        freshnessClass = FRESHNESS_CLASSES.STALE;
        failureReasons.push(FAILURE_REASONS.CONTENT_TOO_OLD);
      }
    } else if (ageH != null && ageH <= breakingMax && noveltySignals.length) {
      freshnessClass = FRESHNESS_CLASSES.BREAKING;
    } else if (ageH != null && ageH <= maxAge) {
      freshnessClass = FRESHNESS_CLASSES.RECENT_UPDATE;
    } else if (ageH == null && !sources.length) {
      freshnessClass = FRESHNESS_CLASSES.UNKNOWN;
      failureReasons.push(FAILURE_REASONS.PUBLISHED_AT_MISSING_FOR_FRESHNESS);
    } else if (ageH != null && ageH > maxAge) {
      freshnessClass = FRESHNESS_CLASSES.STALE;
      failureReasons.push(FAILURE_REASONS.CONTENT_TOO_OLD);
    } else {
      freshnessClass = FRESHNESS_CLASSES.UNKNOWN;
    }

    // event too old without novelty
    var latestEvMs = parseIso(evRange.max);
    if (latestEvMs != null) {
      var evAgeH = hoursBetween(asOfMs, latestEvMs);
      if (evAgeH != null && evAgeH > (Number(policy.maxEventAgeHours) || 72) * 7 && !noveltySignals.length) {
        failureReasons.push(FAILURE_REASONS.EVENT_TOO_OLD);
        if (freshnessClass === FRESHNESS_CLASSES.RECENT_UPDATE || freshnessClass === FRESHNESS_CLASSES.BREAKING) {
          freshnessClass = FRESHNESS_CLASSES.BACKGROUND_CONTEXT;
        }
      }
    }

    // dedupe reasons
    var seen = {};
    failureReasons = failureReasons.filter(function (r) {
      if (seen[r]) return false;
      seen[r] = 1;
      return true;
    });

    return {
      earliestPublishedAt: pubRange.min,
      latestPublishedAt: pubRange.max,
      earliestEventDate: evRange.min,
      latestEventDate: evRange.max,
      eventDateConfidence: sources.reduce(function (m, s) {
        var c = s.sourceEventDateConfidence;
        return isFinite(c) ? Math.max(m, c) : m;
      }, 0) || null,
      firstSeenAt: firstSeen.min,
      lastSeenAt: lastSeen.max,
      freshnessClass: freshnessClass,
      freshnessScore: scoreFreshness(freshnessClass, noveltySignals.length, staleSignals.length),
      noveltySignals: noveltySignals,
      staleSignals: staleSignals,
      freshnessFailureReasons: failureReasons,
      longRunning: longRunning,
      asOf: asOf,
    };
  }

  function validateDailyIssueFreshness(candidate, opts) {
    var checkedAt = new Date().toISOString();
    try {
      var o = opts || {};
      var asOf = trimStr(o.asOf) || checkedAt;
      var sources = (candidate && (candidate.sources || candidate.normalizedSources)) || [];
      var evidences = (candidate && (candidate.evidences || candidate.normalizedEvidences)) || [];
      var title = trimStr(candidate && (candidate.title || candidate.topic));

      // enrich sources with event dates from their evidences
      var enriched = sources.map(function (src) {
        var t = normalizeTemporalFields(src, { asOf: asOf });
        var srcEvs = evidences.filter(function (e) {
          return e && e.sourceId === src.id;
        });
        var detected = detectEventDatesFromEvidence(srcEvs.length ? srcEvs : evidences, {
          publishedAt: t.publishedAt,
        });
        return Object.assign({}, src, t, {
          sourceEventDate: t.sourceEventDate || detected.sourceEventDate,
          sourceEventDateConfidence: t.sourceEventDateConfidence != null
            ? t.sourceEventDateConfidence
            : detected.sourceEventDateConfidence,
        });
      });

      var classified = classifyClusterFreshness({
        title: title,
        sources: enriched,
        evidences: evidences,
        asOf: asOf,
        observationHistory: o.observationHistory || {},
        category: o.category,
        sourceType: o.sourceType,
        documentType: o.documentType,
        maxAgeHoursOverride: o.maxAgeHours,
        bodySample: (evidences[0] && evidences[0].text) || '',
      });

      var reasons = classified.freshnessFailureReasons.slice();

      // novelty must have evidence
      classified.noveltySignals.forEach(function (ns) {
        if (!ns.evidenceIds || !ns.evidenceIds.length) {
          reasons.push(FAILURE_REASONS.NOVELTY_EVIDENCE_MISSING);
        }
      });

      if (classified.longRunning && classified.noveltySignals.length === 0) {
        if (reasons.indexOf(FAILURE_REASONS.NO_NEW_DEVELOPMENT) < 0) {
          reasons.push(FAILURE_REASONS.NO_NEW_DEVELOPMENT);
        }
      }

      var eligible = ELIGIBLE.indexOf(classified.freshnessClass) >= 0;
      if (!eligible) {
        reasons.push(FAILURE_REASONS.FRESHNESS_CLASS_NOT_ELIGIBLE);
      }

      // dedupe
      var seenR = {};
      reasons = reasons.filter(function (r) {
        if (seenR[r]) return false;
        seenR[r] = 1;
        return true;
      });

      var ok = eligible && reasons.filter(function (r) {
        // CLASS_NOT_ELIGIBLE already covers class; allow empty other reasons only if eligible
        return r !== FAILURE_REASONS.FRESHNESS_CLASS_NOT_ELIGIBLE || !eligible;
      }).length === 0;

      // stricter: ok only if eligible AND no blocking reasons except we already added CLASS_NOT_ELIGIBLE when !eligible
      var blocking = reasons.filter(function (r) {
        return r !== FAILURE_REASONS.EVENT_DATE_MISSING; // event date optional unless long-running handled
      });
      ok = eligible && blocking.filter(function (r) {
        return r !== FAILURE_REASONS.FRESHNESS_CLASS_NOT_ELIGIBLE;
      }).length === 0 && eligible;

      if (!eligible) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.CONTENT_TOO_OLD) >= 0) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.RECIRCULATED_OLD_EVENT) >= 0) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.BACKGROUND_ONLY) >= 0) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.NO_NEW_DEVELOPMENT) >= 0) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.PUBLISHED_AT_FUTURE) >= 0) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.EVENT_DATE_FUTURE) >= 0) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.DATE_ORDER_INVALID) >= 0) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.DATE_PARSE_INVALID) >= 0) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.PUBLISHED_AT_MISSING_FOR_FRESHNESS) >= 0) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.NOVELTY_EVIDENCE_MISSING) >= 0) ok = false;
      if (blocking.indexOf(FAILURE_REASONS.UPDATED_AT_INVALID) >= 0) ok = false;

      return {
        ok: !!ok,
        freshnessClass: classified.freshnessClass,
        freshnessScore: classified.freshnessScore,
        noveltySignals: classified.noveltySignals,
        staleSignals: classified.staleSignals,
        failureReasons: reasons,
        checkedAt: checkedAt,
        temporal: {
          earliestPublishedAt: classified.earliestPublishedAt,
          latestPublishedAt: classified.latestPublishedAt,
          earliestEventDate: classified.earliestEventDate,
          latestEventDate: classified.latestEventDate,
          firstSeenAt: classified.firstSeenAt,
          lastSeenAt: classified.lastSeenAt,
          eventDateConfidence: classified.eventDateConfidence,
        },
        longRunning: classified.longRunning,
        enrichedSources: enriched,
      };
    } catch (e) {
      return {
        ok: false,
        freshnessClass: FRESHNESS_CLASSES.UNKNOWN,
        freshnessScore: 0,
        noveltySignals: [],
        staleSignals: [],
        failureReasons: [FAILURE_REASONS.FRESHNESS_GATE_ERROR],
        checkedAt: checkedAt,
        temporal: {},
        longRunning: false,
        enrichedSources: [],
      };
    }
  }

  function applyFreshnessGateToCandidate(candidate, opts) {
    var freshness = validateDailyIssueFreshness(candidate, opts);
    var qualityOk = !!(candidate && (candidate.ok === true || candidate.publicationStatus === 'READY'));
    var qualityReadyBeforeFreshness = qualityOk;
    var finalOk = qualityOk && freshness.ok;
    var status = finalOk ? 'READY' : 'QUARANTINED';
    var out = Object.assign({}, candidate, {
      qualityReadyBeforeFreshness: qualityReadyBeforeFreshness,
      freshnessOk: freshness.ok,
      freshnessClass: freshness.freshnessClass,
      freshnessScore: freshness.freshnessScore,
      noveltySignals: freshness.noveltySignals,
      staleSignals: freshness.staleSignals,
      freshnessFailureReasons: freshness.failureReasons,
      freshnessCheckedAt: freshness.checkedAt,
      earliestPublishedAt: freshness.temporal.earliestPublishedAt,
      latestPublishedAt: freshness.temporal.latestPublishedAt,
      earliestEventDate: freshness.temporal.earliestEventDate,
      latestEventDate: freshness.temporal.latestEventDate,
      eventDateConfidence: freshness.temporal.eventDateConfidence,
      firstSeenAt: freshness.temporal.firstSeenAt,
      lastSeenAt: freshness.temporal.lastSeenAt,
      lastSourceUpdateAt: freshness.temporal.latestPublishedAt,
      publicationStatus: status,
      ok: finalOk,
      qualityFailureReasons: (candidate.qualityFailureReasons || []).slice(),
      // keep quality reasons separate; append freshness for convenience in quarantine list
      allFailureReasons: (candidate.qualityFailureReasons || []).concat(freshness.failureReasons),
    });
    if (freshness.enrichedSources && freshness.enrichedSources.length) {
      out.normalizedSources = freshness.enrichedSources;
      out.sources = freshness.enrichedSources;
    }
    return out;
  }

  return {
    FRESHNESS_CLASSES: FRESHNESS_CLASSES,
    ELIGIBLE_FRESHNESS_CLASSES: ELIGIBLE,
    FAILURE_REASONS: FAILURE_REASONS,
    normalizeTemporalFields: normalizeTemporalFields,
    validateTemporalConsistency: validateTemporalConsistency,
    detectEventDatesFromEvidence: detectEventDatesFromEvidence,
    detectNoveltySignals: detectNoveltySignals,
    detectStaleSignals: detectStaleSignals,
    classifyClusterFreshness: classifyClusterFreshness,
    validateDailyIssueFreshness: validateDailyIssueFreshness,
    applyFreshnessGateToCandidate: applyFreshnessGateToCandidate,
  };
});
