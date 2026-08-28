#!/usr/bin/env node
'use strict';

/**
 * Daily Issue 승인대기 운영 흐름 테스트
 * — 자동공개 금지 · 버전 보존 · 예약 persist · 7일 만료
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const fixtures = require('./daily-issue-api-test-fixtures');
const opsCore = require('../shared/daily-issue-ops-core');
const reviewService = require('../server/daily-issue-review-service');
const opsService = require('../server/daily-issue-ops-service');
const { createRecollectJobStore } = require('../server/daily-issue-recollect-job-store');
const { createDailyIssueReviewRepository } = require('../server/daily-issue-review-repository');

const AS_OF = '2026-09-01T00:00:00.000Z'; // 09:00 KST Sep 1
let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail || '');
  }
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-ops-'));
}

function makeRepo(root) {
  const repo = createDailyIssueReviewRepository({ kind: 'json', reviewRoot: root });
  repo.initialize();
  return repo;
}

function enqueueOne(repo, suffix, asOf) {
  const item = fixtures.makeReady(suffix, { expiresAt: '2099-01-01T00:00:00.000Z' });
  item.expiresAt = '2099-01-01T00:00:00.000Z';
  item.createdAt = asOf || AS_OF;
  item.queuedAt = asOf || AS_OF;
  delete item.issueDate;
  delete item.approvalExpiresAt;
  delete item.purgeEligibleAt;
  if (item.lifecycleMeta) {
    delete item.lifecycleMeta.issueDate;
    delete item.lifecycleMeta.approvalExpiresAt;
    delete item.lifecycleMeta.purgeEligibleAt;
  }
  const withMeta = opsCore.ensureOpsMeta(item, asOf || AS_OF);
  const ins = repo.insertReviewItems(
    [withMeta],
    [
      {
        entityId: item.id,
        fromStatus: null,
        toStatus: item.status,
        action: 'enqueue',
        actorId: 'system',
        timestamp: asOf || AS_OF,
      },
    ],
  );
  return { item: ins.items[0], insert: ins };
}

async function main() {
  const root = tmpRoot();
  const repo = makeRepo(root);
  const jobStore = createRecollectJobStore({ kind: 'json', reviewRoot: root });
  jobStore.initialize();
  const common = {
    repositoryInstance: repo,
    reviewRoot: root,
    jobStore: jobStore,
    skipNetwork: true,
    ingestRunner: async function () {
      return { ok: true, readyCandidates: [], candidates: [] };
    },
  };

  try {
    const a = enqueueOne(repo, 'ops1', AS_OF);
    ok('1. enqueue ok', a.insert && a.insert.ok);
    const loaded0 = await opsService.loadItem(common, a.item.id);
    ok('1b. auto draft v1', loaded0.ok && loaded0.item.draftVersions.length === 1);
    ok('1c. status READY', loaded0.item.status === 'READY_FOR_REVIEW');
    ok('1d. issueDate KST Sep 1', loaded0.item.issueDate === '2026-09-01', loaded0.item.issueDate);

    const morning = await Promise.resolve(
      reviewService.runMorningAutoPublish(Object.assign({}, common, { asOf: AS_OF, force: true })),
    );
    ok('2. morning auto publish skipped', morning.reason === 'OPERATOR_APPROVAL_REQUIRED');
    ok('2b. publishedIds empty', (morning.publishedIds || []).length === 0);
    const still = await Promise.resolve(repo.getById(a.item.id));
    ok('2c. still READY', still.item.status === 'READY_FOR_REVIEW');
    const pub0 = await Promise.resolve(repo.getPublishedIssues({}));
    ok('2d. public empty', !((pub0.items || []).length));

    const blockedAuto = await Promise.resolve(
      reviewService.transitionItem(a.item.id, 'APPROVED', {
        repositoryInstance: repo,
        autoMorning: true,
        actorId: 'AUTO_MORNING_EDITORIAL',
        asOf: AS_OF,
      }),
    );
    ok('2e. autoMorning approve blocked', blockedAuto.error === 'OPERATOR_APPROVAL_REQUIRED');

    const edited = await opsService.manualEdit(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: '2026-09-01T01:00:00.000Z',
        patch: { title: '직접 수정한 제목', confirmedSummary: '수정 요약' },
      }),
    );
    ok('3. manual edit ok', edited.ok, edited.error);
    ok('3b. new version 2', edited.version && edited.version.versionNumber === 2);
    ok('3c. v1 kept', edited.item.draftVersions.length === 2);
    ok('3d. still READY', edited.item.status === 'READY_FOR_REVIEW');
    ok('3e. selected is v2', edited.item.selectedVersionNumber === 2);

    const ai = await opsService.aiRevise(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: '2026-09-01T02:00:00.000Z',
        instruction: '확인되지 않은 내용은 제외해라. 제목이 너무 자극적이다.',
      }),
    );
    ok('4. AI revise ok', ai.ok, ai.error || (ai.reasons && ai.reasons.join(',')));
    ok('4b. version 3', ai.version && ai.version.versionNumber === 3);
    ok('4c. previous kept', ai.item.draftVersions.length === 3);
    ok('4d. still READY', ai.item.status === 'READY_FOR_REVIEW');

    const rec = await opsService.recrawlNow(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: '2026-09-01T03:00:00.000Z',
        instruction: '경찰 공식 발표가 추가됐는지 확인',
      }),
    );
    ok('5. recrawl now ok', rec.ok, rec.error);
    ok('5b. version 4', rec.version && rec.version.versionNumber === 4);
    ok('5c. not published', rec.item.status === 'READY_FOR_REVIEW');

    const schedAt = '2026-09-01T03:00:00.000Z';
    const sched = await opsService.scheduleRecollect(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: schedAt,
        presetMinutes: 30,
        instruction: '한 시간 뒤 새로 나온 내용까지 포함',
      }),
    );
    ok('6. schedule 30m ok', sched.ok && sched.job, sched.error);
    const dupSched = await opsService.scheduleRecollect(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: schedAt,
        presetMinutes: 30,
      }),
    );
    ok('6b. duplicate schedule blocked', dupSched.ok === false && dupSched.error === 'DUPLICATE_JOB', dupSched.error);

    const dueAt = '2026-09-01T03:31:00.000Z';
    const processed = await opsService.processDueRecollectJobs(Object.assign({}, common, { asOf: dueAt }));
    ok('6c. due job processed', processed.ok && processed.processed >= 1, JSON.stringify(processed));
    const afterJob = await opsService.loadItem(common, a.item.id);
    ok('6d. scheduled version added', afterJob.item.draftVersions.length >= 5);
    ok('6e. still not published', afterJob.item.status === 'READY_FOR_REVIEW');

    const processedAgain = await opsService.processDueRecollectJobs(Object.assign({}, common, { asOf: dueAt }));
    const claimedSkip = (processedAgain.results || []).every(function (r) {
      return r.skipped || r.ok;
    });
    ok('6f. no duplicate run', processedAgain.ok && claimedSkip);

    const sched2 = await opsService.scheduleRecollect(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: '2026-09-01T04:00:00.000Z',
        presetMinutes: 60,
      }),
    );
    ok('6g. second different slot ok', sched2.ok, sched2.error);
    const cancelled = await opsService.cancelRecollect(
      Object.assign({}, common, { runKey: sched2.job.runKey, asOf: '2026-09-01T04:05:00.000Z' }),
    );
    ok('6h. cancel ok', cancelled.ok && cancelled.job && cancelled.job.status === 'CANCELLED', cancelled.error);

    const restartStore = createRecollectJobStore({ kind: 'json', reviewRoot: root });
    restartStore.initialize();
    const sched3 = await opsService.scheduleRecollect(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: '2026-09-01T05:00:00.000Z',
        presetMinutes: 30,
        jobStore: restartStore,
      }),
    );
    ok('7. persist schedule ok', sched3.ok, sched3.error);
    const restarted = createRecollectJobStore({ kind: 'json', reviewRoot: root });
    restarted.initialize();
    const listedJobs = restarted.listJobs({ status: 'PENDING' });
    ok(
      '7b. restart still has PENDING',
      (listedJobs.items || []).some(function (j) {
        return j.runKey === sched3.job.runKey;
      }),
    );
    const recovered = await opsService.processDueRecollectJobs(
      Object.assign({}, common, {
        asOf: '2026-09-01T05:31:00.000Z',
        jobStore: restarted,
      }),
    );
    ok('7c. recovered job ran', recovered.ok && recovered.processed >= 1, JSON.stringify(recovered));
    const afterRecover = await opsService.loadItem(common, a.item.id);
    ok('7d. recovered still READY', afterRecover.item.status === 'READY_FOR_REVIEW');

    const approveAt = '2026-09-05T01:00:00.000Z';
    const published = await opsService.approveAndPublish(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: approveAt,
        versionNumber: afterRecover.item.selectedVersionNumber,
        actorId: 'operator',
      }),
    );
    ok('8. approve and publish ok', published.ok && published.published, published.error || (published.reasons && published.reasons.join(',')));
    ok('8b. issueDate stays Sep 1', published.issueDate === '2026-09-01', published.issueDate);
    ok('8c. status PUBLISHED', published.item.status === 'PUBLISHED');
    const pubList = await Promise.resolve(repo.getPublishedIssues({}));
    ok('8d. public has one', (pubList.items || []).some(function (it) {
      return it.id === a.item.id;
    }));

    const dupPub = await opsService.approveAndPublish(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: '2026-09-05T02:00:00.000Z',
        actorId: 'operator',
      }),
    );
    ok('9. second approve is in-place update or blocked', dupPub.ok === true || dupPub.error === 'ALREADY_PUBLISHED_SAME');
    if (dupPub.ok) {
      ok('9b. still same issueDate', dupPub.issueDate === '2026-09-01');
    }

    const b = enqueueOne(repo, 'ops2', AS_OF);
    const expired = await opsService.expirePendingApprovals(
      Object.assign({}, common, { asOf: '2026-09-09T00:00:01.000Z' }),
    );
    ok('10. expire ran', expired.ok);
    const expItem = await Promise.resolve(repo.getById(b.item.id));
    ok('10b. ops2 EXPIRED', expItem.item && expItem.item.status === 'EXPIRED', expItem.item && expItem.item.status);
    const pending = await opsService.listPending(Object.assign({}, common, { asOf: '2026-09-09T00:00:01.000Z' }));
    ok(
      '10c. expired excluded from pending',
      !(pending.items || []).some(function (it) {
        return it.id === b.item.id;
      }),
    );
    const pubAfterExp = await Promise.resolve(repo.getPublishedIssues({}));
    ok(
      '10d. expired not public',
      !(pubAfterExp.items || []).some(function (it) {
        return it.id === b.item.id;
      }),
    );
    const purgeNo = opsCore.isPurgeEligible(expItem.item, '2026-09-20T00:00:00.000Z');
    ok('10e. 30d not yet purge', purgeNo === false);
    const purgeYes = opsCore.isPurgeEligible(expItem.item, '2026-10-10T00:00:00.000Z');
    ok('10f. after 30d purgeEligible', purgeYes === true);

    const upd = await opsService.createUpdateDraft(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: '2026-09-05T03:00:00.000Z',
        instruction: '공식 발표를 우선해서 다시 작성해라',
      }),
    );
    ok('11. update draft ok', upd.ok, upd.error);
    ok('11b. published stays published', upd.item.status === 'PUBLISHED');
    const applyUpd = await opsService.approveAndPublish(
      Object.assign({}, common, {
        id: a.item.id,
        asOf: '2026-09-05T03:10:00.000Z',
        actorId: 'operator',
        versionNumber: upd.version.versionNumber,
      }),
    );
    ok('11c. update approve ok', applyUpd.ok && applyUpd.updatedExisting, applyUpd.error);
    ok('11d. contentUpdatedAt set', !!applyUpd.item.contentUpdatedAt);
    ok('11e. issueDate unchanged', applyUpd.item.issueDate === '2026-09-01');

    const c = enqueueOne(repo, 'ops3', AS_OF);
    const discarded = await opsService.discardItem(
      Object.assign({}, common, { id: c.item.id, asOf: '2026-09-01T06:00:00.000Z' }),
    );
    ok('12. discard ok', discarded.ok && discarded.toStatus === 'REJECTED', discarded.error);
    const recDiscard = await opsService.recrawlNow(
      Object.assign({}, common, { id: c.item.id, asOf: '2026-09-01T06:05:00.000Z' }),
    );
    ok('12b. discarded not recrawled', recDiscard.ok === false, recDiscard.error);
    const enqAgain = reviewService.enqueueCandidates([fixtures.makeReady('ops3', {})], {
      repositoryInstance: repo,
      asOf: AS_OF,
    });
    ok(
      '12c. discarded same id not re-enqueued',
      (enqAgain.results || []).every(function (r) {
        return !r.ok;
      }),
    );

    const d = enqueueOne(repo, 'ops4', AS_OF);
    const man = await Promise.resolve(
      reviewService.transitionItem(d.item.id, 'APPROVED', {
        repositoryInstance: repo,
        asOf: AS_OF,
        actorId: 'admin',
        reviewer: 'admin',
        operatorApproval: true,
      }),
    );
    ok('13. existing approve still works', man.ok, man.error || (man.reasons && man.reasons.join(',')));
    ok('13b. approve is not publish', man.item && man.item.status === 'APPROVED');
    const manPub = await Promise.resolve(
      reviewService.transitionItem(d.item.id, 'PUBLISHED', {
        repositoryInstance: repo,
        asOf: AS_OF,
        actorId: 'admin',
        reviewer: 'admin',
        expectedStatus: 'APPROVED',
        expectedLockVersion: man.item.lockVersion,
        operatorApproval: true,
      }),
    );
    ok('13c. existing publish still works', manPub.ok, manPub.error || (manPub.reasons && manPub.reasons.join(',')));

    const ser = require('../server/daily-issue-api-serializers');
    const publicIssue = ser.toPublicIssue(applyUpd.item, approveAt);
    ok('14. public serializer has lastUpdated', publicIssue && publicIssue.contentUpdatedAt);
    ok('14b. pending not public', ser.toPublicIssue(loaded0.item, AS_OF) == null);
  } finally {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log('daily-issue-ops-workflow passed=' + passed + ' failed=' + failed);
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
