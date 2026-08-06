/**
 * 데일리 이슈 아침판 스케줄러 — 순수 정책 (I/O 없음)
 * timezone: Asia/Seoul (UTC+9) 고정. 서버 TZ 의존 금지.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssueMorningSchedulerCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueMorningSchedulerCoreFactory() {
  'use strict';

  var TIMEZONE = 'Asia/Seoul';
  var KST_OFFSET_MS = 9 * 3600 * 1000;

  var RUN_TYPE = Object.freeze({
    COLLECT: 'COLLECT',
    PUBLISH: 'PUBLISH',
  });

  var RUN_STATUS = Object.freeze({
    STARTED: 'STARTED',
    SUCCESS: 'SUCCESS',
    PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
    FAILED: 'FAILED',
    SKIPPED_DUPLICATE: 'SKIPPED_DUPLICATE',
    MISSED: 'MISSED',
    BLOCKED: 'BLOCKED',
  });

  var DEFAULTS = Object.freeze({
    timezone: TIMEZONE,
    collectHour: 4,
    collectMinute: 30,
    publishHour: 5,
    publishMinute: 0,
    catchupMinutes: 30,
  });

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function toDate(asOf) {
    if (asOf instanceof Date) return asOf;
    if (typeof asOf === 'number' && isFinite(asOf)) return new Date(asOf);
    var t = Date.parse(asOf || '');
    return isFinite(t) ? new Date(t) : new Date();
  }

  /** KST calendar parts from absolute instant */
  function kstParts(asOf) {
    var t = toDate(asOf);
    var kst = new Date(t.getTime() + KST_OFFSET_MS);
    return {
      year: kst.getUTCFullYear(),
      month: kst.getUTCMonth() + 1,
      day: kst.getUTCDate(),
      hour: kst.getUTCHours(),
      minute: kst.getUTCMinutes(),
      second: kst.getUTCSeconds(),
      dateKey:
        kst.getUTCFullYear() +
        '-' +
        String(kst.getUTCMonth() + 1).padStart(2, '0') +
        '-' +
        String(kst.getUTCDate()).padStart(2, '0'),
      minutesOfDay: kst.getUTCHours() * 60 + kst.getUTCMinutes(),
    };
  }

  function scheduledAtIso(dateKey, hour, minute) {
    var parts = String(dateKey).split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]) - 1;
    var d = Number(parts[2]);
    var kstUtc = Date.UTC(y, m, d, hour, minute, 0, 0);
    return new Date(kstUtc - KST_OFFSET_MS).toISOString();
  }

  function resolveRunKeyNamespace(opt) {
    var raw = '';
    if (opt && opt.runKeyNamespace != null) raw = opt.runKeyNamespace;
    else if (typeof process !== 'undefined' && process.env) {
      raw = trimStr(process.env.DAILY_ISSUE_MORNING_RUN_KEY_NAMESPACE);
    }
    var ns = trimStr(raw);
    return ns ? ns + ':' : '';
  }

  function collectRunKey(dateKey, opt) {
    return resolveRunKeyNamespace(opt) + 'morning-collect:' + dateKey;
  }

  function publishRunKey(dateKey, opt) {
    return resolveRunKeyNamespace(opt) + 'morning-publish:' + dateKey;
  }

  function parseCronHm(cronExpr, fallbackHour, fallbackMinute) {
    // Supports "M H * * *" only (minute hour)
    var raw = trimStr(cronExpr);
    if (!raw) return { hour: fallbackHour, minute: fallbackMinute };
    var bits = raw.split(/\s+/);
    if (bits.length >= 2 && /^\d+$/.test(bits[0]) && /^\d+$/.test(bits[1])) {
      return { minute: Number(bits[0]), hour: Number(bits[1]) };
    }
    return { hour: fallbackHour, minute: fallbackMinute };
  }

  function resolveScheduleConfig(envOrOpts) {
    var o = envOrOpts || {};
    var catchup = Number(o.catchupMinutes != null ? o.catchupMinutes : o.DAILY_ISSUE_MORNING_CATCHUP_MINUTES);
    if (!isFinite(catchup) || catchup < 0) catchup = DEFAULTS.catchupMinutes;
    var collectHm = parseCronHm(
      o.collectCron || o.DAILY_ISSUE_MORNING_COLLECT_CRON,
      DEFAULTS.collectHour,
      DEFAULTS.collectMinute,
    );
    var publishHm = parseCronHm(
      o.publishCron || o.DAILY_ISSUE_MORNING_PUBLISH_CRON,
      DEFAULTS.publishHour,
      DEFAULTS.publishMinute,
    );
    return {
      timezone: TIMEZONE,
      collectHour: collectHm.hour,
      collectMinute: collectHm.minute,
      publishHour: publishHm.hour,
      publishMinute: publishHm.minute,
      catchupMinutes: catchup,
      enabled: isTruthy(o.enabled != null ? o.enabled : o.DAILY_ISSUE_MORNING_SCHEDULER_ENABLED),
    };
  }

  function isTruthy(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  }

  /**
   * Window relative to scheduled instant.
   * before: too early
   * in_window: [scheduled, scheduled+catchup)
   * missed: >= scheduled+catchup
   */
  function evaluateWindow(asOf, scheduledAtIsoStr, catchupMinutes) {
    var now = toDate(asOf).getTime();
    var scheduled = Date.parse(scheduledAtIsoStr);
    if (!isFinite(scheduled)) return { phase: 'invalid', minutesPast: null };
    var catchMs = (isFinite(Number(catchupMinutes)) ? Number(catchupMinutes) : DEFAULTS.catchupMinutes) * 60 * 1000;
    if (now < scheduled) {
      return { phase: 'before', minutesPast: (now - scheduled) / 60000 };
    }
    if (now < scheduled + catchMs) {
      return { phase: 'in_window', minutesPast: (now - scheduled) / 60000 };
    }
    return { phase: 'missed', minutesPast: (now - scheduled) / 60000 };
  }

  function nextOccurrence(asOf, hour, minute) {
    var p = kstParts(asOf);
    var todayIso = scheduledAtIso(p.dateKey, hour, minute);
    var todayMs = Date.parse(todayIso);
    var now = toDate(asOf).getTime();
    if (now < todayMs) return todayIso;
    // tomorrow
    var kstTomorrow = new Date(toDate(asOf).getTime() + KST_OFFSET_MS + 24 * 3600 * 1000);
    var y = kstTomorrow.getUTCFullYear();
    var m = kstTomorrow.getUTCMonth() + 1;
    var d = kstTomorrow.getUTCDate();
    var key =
      y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    return scheduledAtIso(key, hour, minute);
  }

  function buildEmptyCounters() {
    return {
      collectedSourceCount: 0,
      candidateCount: 0,
      autoEligibleCount: 0,
      autoPublishedCount: 0,
      manualReviewCount: 0,
      skippedDuplicateCount: 0,
    };
  }

  function summarizePublishOutcome(morningResult) {
    var r = morningResult || {};
    var published = (r.publishedIds || []).length;
    var blocked = (r.blocked || []).length;
    var failed = (r.results || []).filter(function (x) {
      return x && x.ok === false;
    }).length;
    var counters = buildEmptyCounters();
    counters.autoPublishedCount = published;
    counters.skippedDuplicateCount = (r.blocked || []).filter(function (b) {
      return b && (b.reasons || []).some(function (x) {
        return String(x).indexOf('ALREADY_PUBLISHED') >= 0;
      });
    }).length;
    counters.manualReviewCount = (r.blocked || []).filter(function (b) {
      return b && (b.reasons || []).some(function (x) {
        return String(x).indexOf('MANUAL') >= 0 || String(x).indexOf('NOT_FACT') >= 0 || String(x) === 'LOW_CLASSIFIER_CONFIDENCE';
      });
    }).length;
    if (r.ok === false) {
      return {
        status: RUN_STATUS.FAILED,
        errorCode: r.error || 'PUBLISH_FAILED',
        errorSummary: String(r.message || r.error || 'publish failed'),
        counters: counters,
      };
    }
    if (failed > 0 && published > 0) {
      return {
        status: RUN_STATUS.PARTIAL_SUCCESS,
        errorCode: 'PARTIAL_PUBLISH_FAILURES',
        errorSummary: failed + ' item(s) failed, ' + published + ' published',
        counters: counters,
      };
    }
    if (failed > 0 && published === 0) {
      return {
        status: RUN_STATUS.FAILED,
        errorCode: 'ALL_PUBLISH_ATTEMPTS_FAILED',
        errorSummary: failed + ' item(s) failed, 0 published',
        counters: counters,
      };
    }
    // 0 published is not hidden as "happy success" when there were eligible attempts that failed;
    // NO_ELIGIBLE (nothing to do) is SUCCESS with zero — caller may override to note warning.
    return {
      status: RUN_STATUS.SUCCESS,
      errorCode: published === 0 ? 'AUTO_PUBLISH_ZERO' : null,
      errorSummary: published === 0 ? 'AUTO publish count is 0' : null,
      counters: counters,
      warningZeroPublish: published === 0,
    };
  }

  function collectAllowsPublish(collectRun) {
    if (!collectRun) {
      return { ok: false, errorCode: 'NO_COLLECT_RUN', status: RUN_STATUS.BLOCKED };
    }
    var st = String(collectRun.status || '');
    if (st === RUN_STATUS.SUCCESS || st === RUN_STATUS.PARTIAL_SUCCESS) {
      return { ok: true };
    }
    if (st === RUN_STATUS.STARTED) {
      return { ok: false, errorCode: 'COLLECT_IN_PROGRESS', status: RUN_STATUS.BLOCKED };
    }
    if (st === RUN_STATUS.FAILED || st === RUN_STATUS.MISSED || st === RUN_STATUS.BLOCKED) {
      return { ok: false, errorCode: 'COLLECT_' + st, status: RUN_STATUS.BLOCKED };
    }
    if (st === RUN_STATUS.SKIPPED_DUPLICATE) {
      // skip means another process owns/owned it — treat as unknown unless finished elsewhere
      return { ok: false, errorCode: 'COLLECT_SKIPPED_UNRESOLVED', status: RUN_STATUS.BLOCKED };
    }
    return { ok: false, errorCode: 'COLLECT_NOT_READY', status: RUN_STATUS.BLOCKED };
  }

  function isTerminalSuccess(status) {
    return status === RUN_STATUS.SUCCESS || status === RUN_STATUS.PARTIAL_SUCCESS;
  }

  function isDuplicateSkipStatus(status) {
    return (
      status === RUN_STATUS.STARTED ||
      status === RUN_STATUS.SUCCESS ||
      status === RUN_STATUS.PARTIAL_SUCCESS ||
      status === RUN_STATUS.SKIPPED_DUPLICATE ||
      status === RUN_STATUS.MISSED ||
      status === RUN_STATUS.BLOCKED
    );
  }

  /** Retry allowed only after FAILED (not after SUCCESS/MISSED/BLOCKED) */
  function canRetryAfterFailure(existing) {
    return existing && String(existing.status) === RUN_STATUS.FAILED;
  }

  function buildAlerts(snapshot) {
    var alerts = [];
    var s = snapshot || {};
    var lastC = s.lastCollect;
    var lastP = s.lastPublish;
    if (lastC && lastC.status === RUN_STATUS.FAILED) {
      alerts.push({ code: 'COLLECT_FAILED', severity: 'error', message: '아침판 수집 실패' });
    }
    if (lastP && lastP.status === RUN_STATUS.FAILED) {
      alerts.push({ code: 'PUBLISH_FAILED', severity: 'error', message: '아침판 게시 실패' });
    }
    if ((lastC && lastC.status === RUN_STATUS.MISSED) || (lastP && lastP.status === RUN_STATUS.MISSED)) {
      alerts.push({ code: 'MISSED', severity: 'error', message: '아침판 실행 누락(MISSED)' });
    }
    if (lastP && lastP.status === RUN_STATUS.BLOCKED) {
      alerts.push({ code: 'PUBLISH_BLOCKED', severity: 'warn', message: '게시가 BLOCKED 상태입니다' });
    }
    if (lastP && Number(lastP.autoPublishedCount || 0) === 0 && isTerminalSuccess(lastP.status)) {
      alerts.push({ code: 'AUTO_PUBLISH_ZERO', severity: 'warn', message: 'AUTO 게시 0건' });
    }
    if (lastC && Number(lastC.manualReviewCount || 0) >= 5) {
      alerts.push({ code: 'MANUAL_SURGE', severity: 'warn', message: 'MANUAL 후보 급증' });
    }
    if (!lastC && !lastP) {
      alerts.push({ code: 'NO_RECENT_RUN', severity: 'warn', message: '최근 아침판 실행 없음' });
    }
    return alerts;
  }

  return {
    TIMEZONE: TIMEZONE,
    RUN_TYPE: RUN_TYPE,
    RUN_STATUS: RUN_STATUS,
    DEFAULTS: DEFAULTS,
    kstParts: kstParts,
    scheduledAtIso: scheduledAtIso,
    collectRunKey: collectRunKey,
    publishRunKey: publishRunKey,
    resolveRunKeyNamespace: resolveRunKeyNamespace,
    parseCronHm: parseCronHm,
    resolveScheduleConfig: resolveScheduleConfig,
    evaluateWindow: evaluateWindow,
    nextOccurrence: nextOccurrence,
    buildEmptyCounters: buildEmptyCounters,
    summarizePublishOutcome: summarizePublishOutcome,
    collectAllowsPublish: collectAllowsPublish,
    isTerminalSuccess: isTerminalSuccess,
    isDuplicateSkipStatus: isDuplicateSkipStatus,
    canRetryAfterFailure: canRetryAfterFailure,
    buildAlerts: buildAlerts,
    isTruthy: isTruthy,
  };
});
