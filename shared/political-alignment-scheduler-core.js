/**
 * 정치성향 batch scheduler 정책 (I/O 없음, 점수 공식 없음).
 * timezone: Asia/Seoul 명시. 서버 OS TZ 의존 금지.
 * 05:00 / 17:00 slot만 due. missed catch-up 없음.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PoliticalAlignmentSchedulerCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function politicalAlignmentSchedulerCoreFactory() {
  'use strict';

  var TIMEZONE = 'Asia/Seoul';
  var SLOT_HOURS = Object.freeze(['05', '17']);
  var SLOT_MINUTE = '00';
  var ENV_ENABLED_KEY = 'POLITICAL_ALIGNMENT_SCHEDULER_ENABLED';
  var DEFAULT_INTERVAL_MS = 10000;

  var POLICIES = Object.freeze({
    POLITICAL_BATCH_SCHEDULER: 'READY_DISABLED',
    MISSED_BATCH_POLICY: 'PENDING',
    RETRY_POLICY: 'PENDING',
    TERRITORY_MOVE: 'NOT_CONNECTED',
  });

  function pad2(v) {
    return String(v == null ? '' : v).padStart(2, '0');
  }

  function toDate(asOf) {
    if (asOf instanceof Date) return asOf;
    if (typeof asOf === 'number' && isFinite(asOf)) return new Date(asOf);
    var t = Date.parse(asOf || '');
    return isFinite(t) ? new Date(t) : new Date();
  }

  function isTruthy(v) {
    var s = String(v == null ? '' : v)
      .trim()
      .toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  }

  function getSeoulDateParts(asOf) {
    var date = toDate(asOf);
    if (!Number.isFinite(date.getTime())) {
      throw new Error('ALIGNMENT_BATCH_TIME_INVALID');
    }
    var formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    var parts = formatter.formatToParts(date);
    var map = {};
    var i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i].type !== 'literal') map[parts[i].type] = parts[i].value;
    }
    return {
      year: map.year,
      month: map.month,
      day: map.day,
      hour: pad2(map.hour === '24' ? '00' : map.hour),
      minute: pad2(map.minute),
    };
  }

  function buildSlotBatchId(parts, hour, minute) {
    var p = parts || {};
    return 'alignment-' + p.year + p.month + p.day + '-' + pad2(hour) + pad2(minute);
  }

  function getDueSlot(asOf) {
    var p = getSeoulDateParts(asOf);
    var hour = p.hour;
    var minute = p.minute;
    if (minute !== SLOT_MINUTE) return null;
    if (SLOT_HOURS.indexOf(hour) < 0) return null;
    return {
      hour: hour,
      minute: minute,
      slot: hour + minute,
      batchId: buildSlotBatchId(p, hour, minute),
      dateKey: p.year + p.month + p.day,
      timezone: TIMEZONE,
      scheduledLabel: p.year + '-' + p.month + '-' + p.day + ' ' + hour + ':' + minute + ' ' + TIMEZONE,
    };
  }

  function evaluateTick(asOf) {
    var slot = getDueSlot(asOf);
    if (!slot) {
      var p = getSeoulDateParts(asOf);
      return {
        due: false,
        skipReason: 'NOT_SLOT',
        batchId: null,
        slot: null,
        seoulHour: p.hour,
        seoulMinute: p.minute,
        timezone: TIMEZONE,
      };
    }
    return {
      due: true,
      skipReason: null,
      batchId: slot.batchId,
      slot: slot.slot,
      scheduledLabel: slot.scheduledLabel,
      dateKey: slot.dateKey,
      timezone: TIMEZONE,
    };
  }

  function resolveEnabled(envOrOpts) {
    var o = envOrOpts || {};
    if (o.enabled != null) return isTruthy(o.enabled);
    if (o.forceEnabled) return true;
    if (typeof process !== 'undefined' && process.env) {
      return isTruthy(process.env[ENV_ENABLED_KEY]);
    }
    return false;
  }

  function resolveIntervalMs(envOrOpts) {
    var o = envOrOpts || {};
    var raw = o.intervalMs;
    if (raw == null && typeof process !== 'undefined' && process.env) {
      raw = process.env.POLITICAL_ALIGNMENT_SCHEDULER_INTERVAL_MS;
    }
    var n = Number(raw);
    if (Number.isFinite(n) && n >= 1000) return n;
    return DEFAULT_INTERVAL_MS;
  }

  return {
    TIMEZONE: TIMEZONE,
    SLOT_HOURS: SLOT_HOURS,
    SLOT_MINUTE: SLOT_MINUTE,
    ENV_ENABLED_KEY: ENV_ENABLED_KEY,
    DEFAULT_INTERVAL_MS: DEFAULT_INTERVAL_MS,
    POLICIES: POLICIES,
    POLITICAL_BATCH_SCHEDULER: POLICIES.POLITICAL_BATCH_SCHEDULER,
    MISSED_BATCH_POLICY: POLICIES.MISSED_BATCH_POLICY,
    RETRY_POLICY: POLICIES.RETRY_POLICY,
    TERRITORY_MOVE: POLICIES.TERRITORY_MOVE,
    isTruthy: isTruthy,
    getSeoulDateParts: getSeoulDateParts,
    getDueSlot: getDueSlot,
    evaluateTick: evaluateTick,
    buildSlotBatchId: buildSlotBatchId,
    resolveEnabled: resolveEnabled,
    resolveIntervalMs: resolveIntervalMs,
  };
});
