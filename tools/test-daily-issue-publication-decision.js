#!/usr/bin/env node
'use strict';

/**
 * 자동 게시 / 수동 검수 판정 + 아침판 흐름 테스트
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const decision = require('../shared/daily-issue-publication-decision-core');
const reviewService = require('../server/daily-issue-review-service');
const lifecycle = require('../shared/daily-issue-lifecycle-core');
const qualityCore = require('../shared/daily-issue-quality-core');
const freshnessCore = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');

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

const AS_OF = '2026-08-06T01:00:00.000Z';

function qualityReadyBundle(title, summary) {
  const sources = [
    {
      id: 's1',
      publisher: '통계청',
      originDomain: 'kostat.go.kr',
      title: '보도자료',
      url: 'https://kostat.go.kr/portal/korea/kor_nw/1/1/index.board',
      publishedAt: '2026-08-05T01:00:00.000Z',
      sourceType: 'OFFICIAL',
      documentType: 'PRESS_RELEASE',
    },
    {
      id: 's2',
      publisher: '연합뉴스',
      originDomain: 'www.yna.co.kr',
      title: '관련 기사',
      url: 'https://www.yna.co.kr/view/AKR20260805000000000',
      publishedAt: '2026-08-05T02:00:00.000Z',
      sourceType: 'NEWS',
      documentType: 'NEWS_REPORT',
    },
  ];
  const evidences = [
    { id: 'e1', sourceId: 's1', text: summary, quotedText: summary },
    { id: 'e2', sourceId: 's2', text: summary, quotedText: summary },
  ];
  const claims = [
    {
      id: 'c1',
      text: summary,
      classification: 'CONFIRMED_FACT',
      evidenceIds: ['e1', 'e2'],
      supportingSourceIds: ['s1', 's2'],
      isCore: true,
    },
  ];
  const built = qualityCore.buildDailyIssueCandidate({
    title: title,
    discussionPrompt: '이 사안을 어떻게 평가하시나요?',
    sources: sources,
    evidences: evidences,
    candidateClaims: claims,
    retrievedAt: AS_OF,
  });
  const gated = freshnessCore.applyFreshnessGateToCandidate(built, { asOf: AS_OF, category: 'korea-economy' });
  return { sources, evidences, claims, built, gated };
}

function baseSafeItem(over) {
  const title = (over && over.title) || '통계청, 7월 고용 통계 공식 발표';
  const summary = (over && over.confirmedSummary) || '통계청이 7월 고용 통계를 공식 발표했다.';
  const bundle = qualityReadyBundle(title, summary);
  const candId = (over && over.candidateId) || 'cand_safe_stats';
  const created = reviewCore.createReviewItem(
    Object.assign({}, bundle.gated, {
      clusterId: 'cl_' + candId,
      category: (over && over.category) || 'korea-economy',
      candidateId: candId,
      contentSignature: (over && over.contentSignature) || 'sig_safe_stats_v1',
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  const item = Object.assign({}, created.item, {
    id: (over && over.id) || created.item.id || 'cand_safe_stats',
    expiresAt: '2099-01-01T00:00:00.000Z',
    lockVersion: 1,
  });
  if (over) {
    Object.keys(over).forEach(function (k) {
      if (k === 'title' || k === 'confirmedSummary') return;
      item[k] = over[k];
    });
    if (over.title) item.title = over.title;
    if (over.confirmedSummary) item.confirmedSummary = over.confirmedSummary;
  }
  return item;
}

/** 사실 안전 신호(보도자료/통계)가 없는 중립 출처로 판정만 검증 */
function classifyNeutral(over) {
  const base = {
    status: 'READY_FOR_REVIEW',
    title: '중립 제목',
    confirmedSummary: '중립 요약입니다.',
    claims: [{ id: 'c1', text: '중립 요약입니다.', classification: 'CONFIRMED_FACT', isCore: true }],
    sourceRefs: [
      {
        id: 's1',
        publisher: '매체A',
        originDomain: 'a.example.org',
        title: '기사1',
        url: 'https://a.example.org/1',
        publishedAt: '2026-08-05T01:00:00.000Z',
        sourceType: 'NEWS',
      },
      {
        id: 's2',
        publisher: '매체B',
        originDomain: 'b.example.org',
        title: '기사2',
        url: 'https://b.example.org/2',
        publishedAt: '2026-08-05T02:00:00.000Z',
        sourceType: 'NEWS',
      },
    ],
    qualityMeta: { ok: true, publicationStatus: 'READY', independentSourceCount: 2 },
    freshnessMeta: { ok: true, freshnessOk: true, freshnessClass: 'RECENT_UPDATE' },
    duplicateMeta: { decision: 'NEW_ISSUE' },
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  return decision.classifyPublicationDecision(Object.assign(base, over || {}), { asOf: AS_OF });
}

function classify(over) {
  return decision.classifyPublicationDecision(baseSafeItem(over), { asOf: AS_OF });
}

async function withTempRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-morning-'));
  try {
    return await fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function main() {
  const builtOk = qualityReadyBundle(
    '통계청, 7월 고용 통계 공식 발표',
    '통계청이 7월 고용 통계를 공식 발표했다.',
  );
  ok('fixture quality gate ready', builtOk.gated.ok === true, (builtOk.gated.qualityFailureReasons || []).join(','));

  ok(
    '안전한 통계 발표 → AUTO',
    classify({}).publicationDecision === decision.DECISION.AUTO_PUBLISH_ELIGIBLE,
  );
  ok(
    '공식 발표 → AUTO',
    classify({
      title: '한국은행 기준금리 동결 공식 발표',
      confirmedSummary: '한국은행이 기준금리를 동결한다고 공식 발표했다.',
    }).publicationDecision === decision.DECISION.AUTO_PUBLISH_ELIGIBLE,
  );
  ok(
    '단일 출처 → MANUAL',
    classifyNeutral({
      sourceRefs: [
        {
          id: 's1',
          publisher: '통계청',
          originDomain: 'kostat.go.kr',
          title: '보도자료',
          url: 'https://kostat.go.kr/1',
          publishedAt: '2026-08-05T01:00:00.000Z',
          sourceType: 'OFFICIAL',
        },
      ],
      qualityMeta: { ok: true, independentSourceCount: 1 },
      title: '통계청 공식 발표',
      confirmedSummary: '통계청이 공식 발표했다.',
    }).publicationDecision === decision.DECISION.MANUAL_REVIEW_REQUIRED,
  );
  ok(
    '정치 갈등 → MANUAL',
    classifyNeutral({ title: '여야 정치 갈등 격화', confirmedSummary: '정치 갈등이 커지고 있다.' })
      .publicationDecision === decision.DECISION.MANUAL_REVIEW_REQUIRED,
  );
  ok(
    '범죄 혐의 → MANUAL',
    classifyNeutral({ title: '유명인 횡령 혐의 기소', confirmedSummary: '검찰이 혐의로 기소했다.' })
      .publicationDecision === decision.DECISION.MANUAL_REVIEW_REQUIRED,
  );
  ok(
    '출처 충돌 → MANUAL',
    classifyNeutral({
      claims: [
        { id: 'c1', text: '수치 A', classification: 'CONFIRMED_FACT' },
        { id: 'c2', text: '수치 B', classification: 'SOURCE_DISAGREEMENT' },
      ],
    }).publicationDecision === decision.DECISION.MANUAL_REVIEW_REQUIRED,
  );
  ok(
    '속보 미확정 → MANUAL',
    classifyNeutral({
      title: '속보 미확정 피해 규모',
      confirmedSummary: '속보로 미확정 수치가 오르내린다.',
    }).publicationDecision === decision.DECISION.MANUAL_REVIEW_REQUIRED,
  );
  ok(
    '사실 주제 아님 → MANUAL(확신 부족)',
    classifyNeutral({
      title: '오늘 날씨가 좋다',
      confirmedSummary: '맑다.',
      claims: [{ id: 'c1', text: '맑다', classification: 'CONFIRMED_FACT' }],
    }).autoPublishBlockedReasons.indexOf('LOW_CLASSIFIER_CONFIDENCE') >= 0,
  );
  ok(
    'quality 실패 → MANUAL',
    classifyNeutral({ qualityMeta: { ok: false } }).publicationDecision ===
      decision.DECISION.MANUAL_REVIEW_REQUIRED,
  );
  ok(
    '애매하면 MANUAL',
    classifyNeutral({ title: '이슈 제목', confirmedSummary: '내용' }).requiresManualReview === true,
  );

  await withTempRepo(async function (dir) {
    const safe = baseSafeItem({ id: 'auto1', candidateId: 'auto1', contentSignature: 'sig_auto_1' });
    const manual = baseSafeItem({
      id: 'man1',
      candidateId: 'man1',
      contentSignature: 'sig_man_1',
      title: '정치 갈등 이슈',
      confirmedSummary: '정치 갈등 상황이다.',
    });
    const held = baseSafeItem({
      id: 'hold1',
      candidateId: 'hold1',
      contentSignature: 'sig_hold_1',
      status: 'HELD',
      holdReason: 'OTHER',
    });

    const repo = reviewService.resolveRepo({ repository: 'json', reviewRoot: dir });
    const attachedSafe = decision.attachDecisionToItem(safe, { asOf: AS_OF });
    const attachedMan = decision.attachDecisionToItem(manual, { asOf: AS_OF });
    const attachedHold = decision.attachDecisionToItem(held, { asOf: AS_OF });
    ok('safe classified AUTO', attachedSafe.decision.publicationDecision === 'AUTO_PUBLISH_ELIGIBLE');
    ok('manual classified MANUAL', attachedMan.decision.publicationDecision === 'MANUAL_REVIEW_REQUIRED');

    await Promise.resolve(
      repo.insertReviewItems(
        [attachedSafe.item, attachedMan.item, attachedHold.item],
        [
          {
            entityId: 'auto1',
            fromStatus: null,
            toStatus: 'READY_FOR_REVIEW',
            action: 'enqueue',
            actorId: 'test',
            timestamp: AS_OF,
          },
          {
            entityId: 'man1',
            fromStatus: null,
            toStatus: 'READY_FOR_REVIEW',
            action: 'enqueue',
            actorId: 'test',
            timestamp: AS_OF,
          },
          {
            entityId: 'hold1',
            fromStatus: null,
            toStatus: 'HELD',
            action: 'hold',
            actorId: 'test',
            timestamp: AS_OF,
          },
        ],
        { dryRun: false },
      ),
    );

    await Promise.resolve(
      reviewService.transitionItem('hold1', 'HELD', {
        repositoryInstance: repo,
        reason: 'OTHER',
        reasonText: 'test hold',
        asOf: '2026-08-06T01:05:00.000Z',
        actorId: 'admin',
      }),
    ).catch(function () {});

    const morning = await Promise.resolve(
      reviewService.runMorningAutoPublish({
        repositoryInstance: repo,
        asOf: '2026-08-06T20:05:00.000Z',
        force: true,
        dryRun: false,
      }),
    );
    ok('morning ok', morning.ok === true, morning.error);
    ok('auto published', (morning.publishedIds || []).indexOf('auto1') >= 0, JSON.stringify(morning));
    ok('manual not published', (morning.publishedIds || []).indexOf('man1') < 0);
    ok('hold not published', (morning.publishedIds || []).indexOf('hold1') < 0);

    const pub = await Promise.resolve(repo.getPublishedIssues({}));
    const autoPub = (pub.items || []).find(function (i) {
      return i.id === 'auto1';
    });
    ok('published item exists', !!autoPub);

    const hist = await Promise.resolve(
      repo.listAuditEvents
        ? repo.listAuditEvents({ entityId: 'auto1', limit: 50 })
        : { ok: true, events: [] },
    );
    const events = (hist && hist.events) || (hist && hist.items) || [];
    const autoActor = events.some(function (e) {
      return e && (e.actorId === decision.ACTOR_AUTO_MORNING || e.reviewer === decision.ACTOR_AUTO_MORNING);
    });
    ok(
      'auto publish audit actor',
      autoActor,
      JSON.stringify(
        events.map(function (e) {
          return { action: e.action, actorId: e.actorId, toStatus: e.toStatus };
        }),
      ),
    );

    const morning2 = await Promise.resolve(
      reviewService.runMorningAutoPublish({
        repositoryInstance: repo,
        asOf: '2026-08-07T20:05:00.000Z',
        force: true,
      }),
    );
    ok('second morning no re-publish auto1', (morning2.publishedIds || []).indexOf('auto1') < 0);

    const apr = await Promise.resolve(
      reviewService.transitionItem('man1', 'APPROVED', {
        repositoryInstance: repo,
        asOf: '2026-08-06T03:00:00.000Z',
        actorId: 'admin',
        reviewer: 'admin',
      }),
    );
    ok('manual approve still works', apr.ok === true, JSON.stringify(apr.reasons || apr.error));
    if (apr.ok) {
      const pub2 = await Promise.resolve(
        reviewService.transitionItem('man1', 'PUBLISHED', {
          repositoryInstance: repo,
          asOf: '2026-08-06T03:01:00.000Z',
          actorId: 'admin',
          reviewer: 'admin',
          expectedStatus: 'APPROVED',
          expectedLockVersion: apr.item.lockVersion,
        }),
      );
      ok('manual publish still works', pub2.ok === true, JSON.stringify(pub2.reasons || pub2.error));

      const ret = await Promise.resolve(
        reviewService.transitionItem('auto1', 'RETIRED', {
          repositoryInstance: repo,
          asOf: '2026-08-06T04:00:00.000Z',
          actorId: 'admin',
          reason: lifecycle.RETIRE_REASONS.MANUAL_RETIRE,
          reasonText: 'post review retire',
        }),
      );
      ok('admin can retire auto-published', ret.ok === true, ret.error);
    }

    const rejectCand = decision.attachDecisionToItem(
      baseSafeItem({
        id: 'rej1',
        candidateId: 'rej1',
        contentSignature: 'sig_rej_1',
        status: 'READY_FOR_REVIEW',
      }),
      { asOf: AS_OF },
    ).item;
    await Promise.resolve(
      repo.insertReviewItems(
        [rejectCand],
        [
          {
            entityId: 'rej1',
            fromStatus: null,
            toStatus: 'READY_FOR_REVIEW',
            action: 'enqueue',
            actorId: 'test',
            timestamp: AS_OF,
          },
        ],
        { dryRun: false },
      ),
    );
    await Promise.resolve(
      reviewService.transitionItem('rej1', 'REJECTED', {
        repositoryInstance: repo,
        reason: lifecycle.REJECT_REASONS.UNSUITABLE_FOR_DAILY_ISSUE,
        reasonText: 'no',
        asOf: '2026-08-06T01:10:00.000Z',
        actorId: 'admin',
      }),
    );
    const morning3 = await Promise.resolve(
      reviewService.runMorningAutoPublish({
        repositoryInstance: repo,
        force: true,
        asOf: '2026-08-08T20:05:00.000Z',
      }),
    );
    ok('rejected never auto-published', (morning3.publishedIds || []).indexOf('rej1') < 0);
  });

  console.log('\nPublication decision results:', passed, 'passed,', failed, 'failed');
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
