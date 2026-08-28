/**
 * 데일리 이슈 운영 승인대기 — 순수 정책
 * 자동 공개 금지. 버전/7일 만료/예약 재취합 식별만 담당.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./daily-issue-morning-scheduler-core'));
  } else {
    root.DailyIssueOpsCore = factory(root.DailyIssueMorningSchedulerCore);
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueOpsCoreFactory(schedulerCore) {
  'use strict';

  var APPROVAL_WINDOW_DAYS = 7;
  var INTERNAL_RETENTION_DAYS = 30;
  var STALE_JOB_MINUTES = 15;

  var ORIGIN = Object.freeze({
    AUTO_COLLECT: 'AUTO_COLLECT',
    MANUAL_EDIT: 'MANUAL_EDIT',
    AI_REVISE: 'AI_REVISE',
    RECOLLECT: 'RECOLLECT',
    SCHEDULED_RECOLLECT: 'SCHEDULED_RECOLLECT',
    UPDATE_DRAFT: 'UPDATE_DRAFT',
  });

  var JOB_STATUS = Object.freeze({
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
  });

  var DELAY_PRESETS_MINUTES = Object.freeze([30, 60, 120, 240]);

  var EDITABLE_FIELDS = Object.freeze([
    'title',
    'confirmedSummary',
    'discussionPrompt',
    'claims',
    'sourceRefs',
    'displayGroups',
  ]);

  var SNAPSHOT_FIELDS = Object.freeze([
    'title',
    'confirmedSummary',
    'discussionPrompt',
    'claims',
    'sourceRefs',
    'evidenceRefs',
    'displayGroups',
    'qualityMeta',
    'freshnessMeta',
    'contentSignature',
    'clusterSignature',
    'sourceSetSignature',
    'claimSetSignature',
    'noveltySignals',
    'staleSignals',
  ]);

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function toDate(asOf) {
    if (asOf instanceof Date) return asOf;
    var t = Date.parse(asOf || '');
    return isFinite(t) ? new Date(t) : new Date();
  }

  function addDaysIso(iso, days) {
    var t = Date.parse(iso);
    if (!isFinite(t)) t = Date.now();
    return new Date(t + Number(days) * 864e5).toISOString();
  }

  function issueDateFromAsOf(asOf) {
    if (schedulerCore && typeof schedulerCore.kstParts === 'function') {
      return schedulerCore.kstParts(asOf).dateKey;
    }
    var d = toDate(asOf);
    var kst = new Date(d.getTime() + 9 * 3600 * 1000);
    return (
      kst.getUTCFullYear() +
      '-' +
      String(kst.getUTCMonth() + 1).padStart(2, '0') +
      '-' +
      String(kst.getUTCDate()).padStart(2, '0')
    );
  }

  function cloneJson(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function extractSnapshot(item) {
    var snap = {};
    SNAPSHOT_FIELDS.forEach(function (k) {
      snap[k] = cloneJson(item && item[k]);
    });
    return snap;
  }

  function applySnapshot(item, snapshot) {
    var next = Object.assign({}, item || {});
    var snap = snapshot || {};
    SNAPSHOT_FIELDS.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(snap, k)) {
        next[k] = cloneJson(snap[k]);
      }
    });
    return next;
  }

  function nextVersionNumber(versions) {
    var max = 0;
    (versions || []).forEach(function (v) {
      var n = Number(v && v.versionNumber);
      if (isFinite(n) && n > max) max = n;
    });
    return max + 1;
  }

  function buildVersionRecord(opt) {
    var o = opt || {};
    var now = trimStr(o.asOf) || new Date().toISOString();
    return {
      versionNumber: Number(o.versionNumber) >= 1 ? Math.floor(Number(o.versionNumber)) : 1,
      createdAt: trimStr(o.createdAt) || now,
      revisedAt: trimStr(o.revisedAt) || now,
      originMethod: ORIGIN[o.originMethod] || trimStr(o.originMethod) || ORIGIN.AUTO_COLLECT,
      operatorInstruction: trimStr(o.operatorInstruction).slice(0, 2000),
      selected: o.selected === true,
      snapshot: extractSnapshot(o.snapshotItem || o.snapshot || {}),
    };
  }

  function ensureOpsMeta(item, asOf) {
    var it = item && typeof item === 'object' ? item : {};
    var now = trimStr(asOf) || it.createdAt || it.queuedAt || new Date().toISOString();
    var created = trimStr(it.createdAt) || now;
    var issueDate = trimStr(it.issueDate) || trimStr(it.lifecycleMeta && it.lifecycleMeta.issueDate) || issueDateFromAsOf(created);
    var approvalExpiresAt =
      trimStr(it.approvalExpiresAt) ||
      trimStr(it.lifecycleMeta && it.lifecycleMeta.approvalExpiresAt) ||
      addDaysIso(created, APPROVAL_WINDOW_DAYS);
    var purgeEligibleAt =
      trimStr(it.purgeEligibleAt) ||
      trimStr(it.lifecycleMeta && it.lifecycleMeta.purgeEligibleAt) ||
      addDaysIso(approvalExpiresAt, INTERNAL_RETENTION_DAYS);
    var versions = Array.isArray(it.draftVersions)
      ? it.draftVersions.slice()
      : Array.isArray(it.lifecycleMeta && it.lifecycleMeta.draftVersions)
        ? it.lifecycleMeta.draftVersions.slice()
        : [];
    if (!versions.length) {
      versions.push(
        buildVersionRecord({
          versionNumber: 1,
          createdAt: created,
          revisedAt: created,
          originMethod: ORIGIN.AUTO_COLLECT,
          selected: true,
          snapshotItem: it,
        }),
      );
    }
    var selected = Number(it.selectedVersionNumber);
    if (!isFinite(selected) || selected < 1) {
      var sel = versions.find(function (v) {
        return v && v.selected === true;
      });
      selected = sel ? Number(sel.versionNumber) : 1;
    }
    versions = versions.map(function (v) {
      var copy = Object.assign({}, v);
      copy.selected = Number(copy.versionNumber) === Number(selected);
      return copy;
    });
    it.issueDate = issueDate;
    it.approvalExpiresAt = approvalExpiresAt;
    it.purgeEligibleAt = purgeEligibleAt;
    it.draftVersions = versions;
    it.selectedVersionNumber = selected;
    it.discardedAt = it.discardedAt || (it.lifecycleMeta && it.lifecycleMeta.discardedAt) || null;
    it.contentUpdatedAt = it.contentUpdatedAt || (it.lifecycleMeta && it.lifecycleMeta.contentUpdatedAt) || null;
    it.lifecycleMeta = Object.assign({}, it.lifecycleMeta || {}, {
      issueDate: issueDate,
      approvalExpiresAt: approvalExpiresAt,
      purgeEligibleAt: purgeEligibleAt,
      selectedVersionNumber: selected,
      discardedAt: it.discardedAt,
      contentUpdatedAt: it.contentUpdatedAt,
      autoPublishDisabled: true,
    });
    return it;
  }

  function getVersion(item, versionNumber) {
    var versions = (item && item.draftVersions) || [];
    var n = Number(versionNumber);
    for (var i = 0; i < versions.length; i++) {
      if (Number(versions[i].versionNumber) === n) return versions[i];
    }
    return null;
  }

  function selectVersion(item, versionNumber) {
    var next = ensureOpsMeta(Object.assign({}, item));
    var n = Number(versionNumber);
    var found = getVersion(next, n);
    if (!found) return { ok: false, error: 'VERSION_NOT_FOUND' };
    next.draftVersions = next.draftVersions.map(function (v) {
      var copy = Object.assign({}, v);
      copy.selected = Number(copy.versionNumber) === n;
      return copy;
    });
    next.selectedVersionNumber = n;
    next = applySnapshot(next, found.snapshot);
    next.lifecycleMeta = Object.assign({}, next.lifecycleMeta || {}, { selectedVersionNumber: n });
    return { ok: true, item: next, version: found };
  }

  function appendVersion(item, opt) {
    var next = ensureOpsMeta(Object.assign({}, item), opt && opt.asOf);
    var num = nextVersionNumber(next.draftVersions);
    var rec = buildVersionRecord(
      Object.assign({}, opt || {}, {
        versionNumber: num,
        selected: false,
        snapshotItem: (opt && opt.snapshotItem) || next,
      }),
    );
    next.draftVersions = next.draftVersions.concat([rec]);
    return { ok: true, item: next, version: rec };
  }

  function isPendingQueueStatus(status) {
    var s = String(status || '');
    return s === 'READY_FOR_REVIEW' || s === 'HELD' || s === 'APPROVED' || s === 'UPDATE_PENDING';
  }

  function isApprovalExpired(item, asOf) {
    var it = ensureOpsMeta(Object.assign({}, item || {}), asOf);
    var exp = Date.parse(it.approvalExpiresAt || '');
    var now = toDate(asOf).getTime();
    return isFinite(exp) && now > exp;
  }

  function isPurgeEligible(item, asOf) {
    var it = item || {};
    if (String(it.status || '') !== 'EXPIRED' && String(it.status || '') !== 'REJECTED') return false;
    var at = Date.parse(it.purgeEligibleAt || (it.lifecycleMeta && it.lifecycleMeta.purgeEligibleAt) || '');
    var now = toDate(asOf).getTime();
    return isFinite(at) && now >= at;
  }

  function isDiscarded(item) {
    if (item && item.discardedAt) return true;
    if (item && item.lifecycleMeta && item.lifecycleMeta.discardedAt) return true;
    return String((item && item.status) || '') === 'REJECTED';
  }

  function canOperatorMutate(item, asOf) {
    var reasons = [];
    if (!item) reasons.push('ITEM_MISSING');
    if (isDiscarded(item)) reasons.push('DISCARDED');
    if (isApprovalExpired(item, asOf) && isPendingQueueStatus(item && item.status)) {
      reasons.push('APPROVAL_EXPIRED');
    }
    var st = String((item && item.status) || '');
    if (st === 'EXPIRED' || st === 'RETIRED' || st === 'SUPERSEDED') reasons.push('STATUS_' + st);
    return { ok: reasons.length === 0, reasons: reasons };
  }

  function canOperatorApprove(item, asOf) {
    var base = canOperatorMutate(item, asOf);
    var reasons = base.reasons.slice();
    var st = String((item && item.status) || '');
    if (st !== 'READY_FOR_REVIEW' && st !== 'UPDATE_PENDING' && st !== 'APPROVED' && st !== 'PUBLISHED') {
      reasons.push('NOT_APPROVABLE_STATUS');
    }
    if (st === 'HELD') reasons.push('HELD_MUST_RETURN_TO_READY');
    return { ok: reasons.length === 0, reasons: reasons };
  }

  function resolveDelayMinutes(input) {
    if (input && input.customMinutes != null) {
      var custom = Number(input.customMinutes);
      if (!isFinite(custom) || custom < 1 || custom > 24 * 60) {
        return { ok: false, error: 'INVALID_CUSTOM_DELAY' };
      }
      return { ok: true, minutes: Math.floor(custom) };
    }
    var preset = Number(input && (input.presetMinutes != null ? input.presetMinutes : input.minutes));
    if (DELAY_PRESETS_MINUTES.indexOf(preset) >= 0) return { ok: true, minutes: preset };
    return { ok: false, error: 'INVALID_DELAY_PRESET' };
  }

  function recrawlRunKey(reviewItemId, scheduledAt) {
    return 'recollect:' + trimStr(reviewItemId) + ':' + trimStr(scheduledAt);
  }

  function jobIsDue(job, asOf) {
    if (!job || job.status !== JOB_STATUS.PENDING) return false;
    var sched = Date.parse(job.scheduledAt || '');
    var now = toDate(asOf).getTime();
    return isFinite(sched) && now >= sched;
  }

  function jobIsStaleRunning(job, asOf) {
    if (!job || job.status !== JOB_STATUS.RUNNING) return false;
    var started = Date.parse(job.claimedAt || job.startedAt || '');
    var now = toDate(asOf).getTime();
    return isFinite(started) && now - started >= STALE_JOB_MINUTES * 60 * 1000;
  }

  function formatKstStamp(iso) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return '';
    var kst = new Date(t + 9 * 3600 * 1000);
    var y = kst.getUTCFullYear();
    var m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    var d = String(kst.getUTCDate()).padStart(2, '0');
    var hh = String(kst.getUTCHours()).padStart(2, '0');
    var mm = String(kst.getUTCMinutes()).padStart(2, '0');
    return y + '.' + m + '.' + d + ' ' + hh + ':' + mm;
  }

  function diffSnapshots(prev, next) {
    var a = prev || {};
    var b = next || {};
    var changes = [];
    ['title', 'confirmedSummary', 'discussionPrompt'].forEach(function (k) {
      var left = trimStr(a[k]);
      var right = trimStr(b[k]);
      if (left !== right) {
        changes.push({ field: k, from: left, to: right });
      }
    });
    var ac = JSON.stringify(a.claims || []);
    var bc = JSON.stringify(b.claims || []);
    if (ac !== bc) changes.push({ field: 'claims', from: (a.claims || []).length, to: (b.claims || []).length });
    var asrc = JSON.stringify(a.sourceRefs || []);
    var bsrc = JSON.stringify(b.sourceRefs || []);
    if (asrc !== bsrc) {
      changes.push({ field: 'sourceRefs', from: (a.sourceRefs || []).length, to: (b.sourceRefs || []).length });
    }
    return changes;
  }

  function titleTokens(title) {
    return trimStr(title)
      .toLowerCase()
      .replace(/[^\w가-힣]+/g, ' ')
      .split(/\s+/)
      .filter(function (t) {
        return t.length >= 2;
      });
  }

  function scoreCandidateMatch(item, candidate) {
    var score = 0;
    if (!item || !candidate) return 0;
    if (trimStr(item.clusterId) && trimStr(item.clusterId) === trimStr(candidate.clusterId)) score += 50;
    if (trimStr(item.candidateId) && trimStr(item.candidateId) === trimStr(candidate.candidateId || candidate.id)) {
      score += 80;
    }
    var a = titleTokens(item.title);
    var b = titleTokens(candidate.title || candidate.topic);
    var hit = 0;
    a.forEach(function (t) {
      if (b.indexOf(t) >= 0) hit += 1;
    });
    if (a.length) score += Math.round((hit / a.length) * 40);
    return score;
  }

  function applyInstructionFilters(snapshot, instruction) {
    var next = applySnapshot({}, snapshot);
    var text = trimStr(instruction);
    if (!text) return next;
    if (/확인되지 않|미확인|추측/.test(text) && Array.isArray(next.claims)) {
      next.claims = next.claims.filter(function (c) {
        return !c || String(c.classification || '') !== 'UNVERIFIED';
      });
    }
    if (/자극적|제목/.test(text) && next.confirmedSummary) {
      var calm = trimStr(next.confirmedSummary).split(/[.。]/)[0];
      if (calm.length >= 8 && calm.length <= 80) next.title = calm;
    }
    return next;
  }

  return {
    APPROVAL_WINDOW_DAYS: APPROVAL_WINDOW_DAYS,
    INTERNAL_RETENTION_DAYS: INTERNAL_RETENTION_DAYS,
    STALE_JOB_MINUTES: STALE_JOB_MINUTES,
    ORIGIN: ORIGIN,
    JOB_STATUS: JOB_STATUS,
    DELAY_PRESETS_MINUTES: DELAY_PRESETS_MINUTES,
    EDITABLE_FIELDS: EDITABLE_FIELDS,
    SNAPSHOT_FIELDS: SNAPSHOT_FIELDS,
    issueDateFromAsOf: issueDateFromAsOf,
    addDaysIso: addDaysIso,
    extractSnapshot: extractSnapshot,
    applySnapshot: applySnapshot,
    buildVersionRecord: buildVersionRecord,
    ensureOpsMeta: ensureOpsMeta,
    getVersion: getVersion,
    selectVersion: selectVersion,
    appendVersion: appendVersion,
    isPendingQueueStatus: isPendingQueueStatus,
    isApprovalExpired: isApprovalExpired,
    isPurgeEligible: isPurgeEligible,
    isDiscarded: isDiscarded,
    canOperatorMutate: canOperatorMutate,
    canOperatorApprove: canOperatorApprove,
    resolveDelayMinutes: resolveDelayMinutes,
    recrawlRunKey: recrawlRunKey,
    jobIsDue: jobIsDue,
    jobIsStaleRunning: jobIsStaleRunning,
    formatKstStamp: formatKstStamp,
    diffSnapshots: diffSnapshots,
    scoreCandidateMatch: scoreCandidateMatch,
    applyInstructionFilters: applyInstructionFilters,
  };
});
