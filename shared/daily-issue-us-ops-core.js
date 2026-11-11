/**
 * 미국 데일리 이슈 운영 규칙. 수집기나 저장소가 아니다.
 * 한국 아침 스케줄과 성향 계산식을 바꾸지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssueUsOpsCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TIMEZONE = 'America/New_York';
  var SLOTS = [11, 15, 19];
  var MAX_PER_DAY = 3;
  var MAX_PER_SLOT = 1;
  var RETRY_DELAYS_MIN = [2, 10];
  var NO_RETRY = {
    FACT_VERIFICATION_FAILED: 1,
    POLICY_BLOCKED: 1,
    AUTH_CONFIG_ERROR: 1,
    ALREADY_PUBLISHED: 1,
    ALREADY_SAVED: 1,
  };

  function issueRegion(item) {
    var raw = item && (item.activityRegion || item.activity_region);
    if (!raw && item && item.lifecycleMeta) raw = item.lifecycleMeta.activityRegion;
    var value = String(raw || '').trim().toUpperCase();
    return value === 'US' ? 'US' : 'KR';
  }

  function normalizeRegion(value) {
    var region = String(value || '').trim().toUpperCase();
    if (region === 'US' || region === 'KR') return region;
    return null;
  }

  function isSchedulerEnabled(env) {
    var raw = String((env && env.DAILY_ISSUE_US_SCHEDULER_ENABLED) || '').trim().toLowerCase();
    return raw === '1' || raw === 'true';
  }

  function etParts(asOf) {
    var when = asOf instanceof Date ? asOf : new Date(asOf || Date.now());
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(when).forEach(function (part) {
      parts[part.type] = part.value;
    });
    return {
      dateKey: parts.year + '-' + parts.month + '-' + parts.day,
      hour: Number(parts.hour),
      minute: Number(parts.minute),
    };
  }

  function slotFor(asOf) {
    var parts = etParts(asOf);
    var hour = SLOTS.indexOf(parts.hour) >= 0 && parts.minute < 30 ? parts.hour : null;
    return {
      timezone: TIMEZONE,
      dateKey: parts.dateKey,
      hour: hour,
      due: hour != null,
      runKey: hour == null ? null : 'us-daily-issue:' + parts.dateKey + ':' + hour,
      maxPerDay: MAX_PER_DAY,
      maxPerSlot: MAX_PER_SLOT,
    };
  }

  function retryDecision(input) {
    var src = input || {};
    var code = String(src.error || '');
    if (src.readBackFound) return { retry: false, error: 'ALREADY_SAVED' };
    if (src.dbStatus === 'UNKNOWN') {
      return { retry: false, action: 'READ_BACK', error: 'DB_STATUS_UNKNOWN' };
    }
    if (NO_RETRY[code]) return { retry: false, error: code };
    var attempt = Number(src.attempt || 0);
    if (attempt >= RETRY_DELAYS_MIN.length) return { retry: false, error: code || 'RETRIES_EXHAUSTED' };
    return { retry: true, delayMinutes: RETRY_DELAYS_MIN[attempt], error: code || 'TRANSIENT' };
  }

  function hostOf(url) {
    var match = String(url || '').match(/^https?:\/\/([^\/]+)/i);
    return match ? match[1].replace(/^www\./, '').toLowerCase() : '';
  }

  function assessCandidate(bundle) {
    var src = bundle || {};
    if (src.liveAiConfirmed !== true) {
      return { ok: false, publish: false, collectionStatus: 'NOT_RUN', error: 'LIVE_AI_NOT_CONFIRMED' };
    }
    if (src.sample === true || src.mock === true) {
      return { ok: false, publish: false, collectionStatus: 'NOT_RUN', error: 'SAMPLE_NOT_COLLECTION' };
    }
    var sources = Array.isArray(src.sources) ? src.sources : [];
    var hosts = {};
    sources.forEach(function (source) {
      var host = hostOf(source && source.url);
      if (host) hosts[host] = (hosts[host] || 0) + 1;
    });
    if (Object.keys(hosts).length < 2) {
      return { ok: false, publish: false, collectionStatus: 'LIVE_AI_REJECTED', error: 'INDEPENDENT_SOURCES_REQUIRED' };
    }
    if (src.collectionPermissionDenied === true) {
      return { ok: false, publish: false, collectionStatus: 'LIVE_AI_REJECTED', error: 'COLLECTION_PERMISSION_DENIED' };
    }
    if (src.factConflict === true) {
      return { ok: false, publish: false, collectionStatus: 'LIVE_AI_REJECTED', error: 'FACT_VERIFICATION_FAILED' };
    }
    if (!src.eventDate || !src.articleDate) {
      return { ok: false, publish: false, collectionStatus: 'LIVE_AI_REJECTED', error: 'EVENT_AND_ARTICLE_DATES_REQUIRED' };
    }
    if (src.partisanSelection === true) {
      return { ok: false, publish: false, collectionStatus: 'LIVE_AI_REJECTED', error: 'PARTISAN_SELECTION_BLOCKED' };
    }
    if (src.relevant !== true) {
      return { ok: false, publish: false, collectionStatus: 'LIVE_AI_REJECTED', error: 'RELEVANCE_NOT_MET' };
    }
    var shape = assessIssueShape(src.issue);
    if (!shape.ok) return { ok: false, publish: false, collectionStatus: 'LIVE_AI_REJECTED', error: shape.error };
    if (src.duplicate === true) return { ok: false, publish: false, collectionStatus: 'LIVE_AI_REJECTED', error: 'DUPLICATE_EXCLUDED' };
    return { ok: true, publish: true, collectionStatus: 'LIVE_AI_ACCEPTED', count: 1 };
  }

  function assessIssueShape(issue) {
    var item = issue || {};
    if (!String(item.title || '').trim()) return { ok: false, error: 'TITLE_REQUIRED' };
    if (!String(item.verifiedFactSummary || item.confirmedSummary || '').trim()) {
      return { ok: false, error: 'VERIFIED_FACT_SUMMARY_REQUIRED' };
    }
    var points = item.keyPoints || item.claims;
    if (!Array.isArray(points) || !points.length) return { ok: false, error: 'KEY_POINTS_REQUIRED' };
    var questions = []
      .concat(item.discussionQuestion || [])
      .concat(item.discussionPrompt || [])
      .filter(Boolean);
    if (questions.length !== 1) return { ok: false, error: 'ONE_NEUTRAL_QUESTION_REQUIRED' };
    if (item.proConVote || item.choices || item.stance) return { ok: false, error: 'PRO_CON_VOTE_FORBIDDEN' };
    if (item.generatedOpposingStance || item.unsupportedFact) return { ok: false, error: 'UNSUPPORTED_CONTENT_FORBIDDEN' };
    var refs = item.sources || item.sourceRefs || [];
    if (!Array.isArray(refs) || refs.some(function (ref) { return !ref || !ref.url || !ref.date; })) {
      return { ok: false, error: 'SOURCE_LINK_AND_DATE_REQUIRED' };
    }
    return { ok: true };
  }

  function decideVisibility(item, body) {
    var src = body || {};
    var region = issueRegion(item);
    if (region !== 'US') return { ok: false, error: 'REGION_MISMATCH' };
    if (src.republish === true) {
      if (src.adminApproved !== true) return { ok: false, error: 'ADMIN_APPROVAL_REQUIRED' };
      return {
        ok: true,
        action: 'REPUBLISH',
        meta: { usVisibility: 'PUBLIC', activityRegion: 'US' },
      };
    }
    if (src.opinionOnly === true || src.rebuttalOnly === true || src.wordingOnly === true) {
      return { ok: true, action: 'ADMIN_REVIEW', meta: { usVisibility: 'ADMIN_REVIEW', activityRegion: 'US' } };
    }
    if (src.autoJudgmentImpossible === true) {
      return { ok: true, action: 'ADMIN_REVIEW', meta: { usVisibility: 'ADMIN_REVIEW', activityRegion: 'US' } };
    }
    if (src.coreFactVerifiablyWrong === true) {
      return { ok: true, action: 'TEMP_HIDE', meta: { usVisibility: 'TEMP_HIDDEN', activityRegion: 'US' } };
    }
    if (src.correctionNote) {
      return {
        ok: true,
        action: 'CORRECTION',
        meta: { usVisibility: 'PUBLIC', correctionNote: String(src.correctionNote), activityRegion: 'US' },
      };
    }
    return { ok: false, error: 'VISIBILITY_REASON_REQUIRED' };
  }

  function noticeDecision(input) {
    var src = input || {};
    var kind = String(src.kind || '');
    if (kind === 'PUBLISHED' || kind === 'ZERO_PUBLISHED') return { send: false, reason: 'NORMAL_QUIET' };
    if (kind !== 'MAJOR_PUBLISH_ERROR' && kind !== 'TEMP_HIDE' && kind !== 'REPEATED_FAILURE' && kind !== 'ADMIN_CORRECTION') {
      return { send: false, reason: 'NOT_NOTICEABLE' };
    }
    if (src.duplicateOf) return { send: false, reason: 'DUPLICATE_NOTICE_SUPPRESSED' };
    return { send: true, kind: kind, dedupeKey: kind + ':' + String(src.runKey || src.issueId || '') };
  }

  return {
    TIMEZONE: TIMEZONE,
    SLOTS: SLOTS,
    issueRegion: issueRegion,
    normalizeRegion: normalizeRegion,
    isSchedulerEnabled: isSchedulerEnabled,
    etParts: etParts,
    slotFor: slotFor,
    retryDecision: retryDecision,
    assessCandidate: assessCandidate,
    assessIssueShape: assessIssueShape,
    decideVisibility: decideVisibility,
    noticeDecision: noticeDecision,
  };
});
