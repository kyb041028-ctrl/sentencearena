/**
 * 센텐스크래프트 — alignment 배치 처리 브라우저 어댑터
 * - shared/alignment-batch-core.js 를 먼저 로드해야 함
 */
(function (global) {
  'use strict';

  var core = global.AlignmentBatchCore;
  if (!core) {
    throw new Error('AlignmentBatchCore must be loaded before alignment-batch-processor.js');
  }

  var getAlignmentBatchProcessorConfig = core.getAlignmentBatchProcessorConfig;
  var processAlignmentUserBatch = core.processAlignmentUserBatch;
  var processAlignmentBatch = core.processAlignmentBatch;

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function runAlignmentBatchProcessorTests() {
    var results = [];
    var passed = 0;
    function add(name, pass, detail) {
      results.push({ name: name, pass: !!pass, detail: detail || '' });
      if (pass) passed += 1;
    }
    function state(extra) {
      var base = {
        userId: 'u1',
        alignmentScore: 0,
        currentTerritory: 'CENTRAL',
        previousAlignmentSignal: 0,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
        lastProcessedAlignmentBatchId: null,
      };
      var out = clone(base);
      var k;
      extra = extra || {};
      for (k in extra) out[k] = extra[k];
      return out;
    }
    function reaction(extra) {
      var base = {
        reactionId: 'r1',
        actorUserId: 'a1',
        targetUserId: 'u1',
        actorTerritoryAtReaction: 'PIONEER',
        targetTerritoryAtReaction: 'CENTRAL',
        reactionType: 'RECOMMEND',
        createdAt: '2026-01-01T05:00:00.000Z',
        cancelledAt: null,
      };
      var out = clone(base);
      var k;
      extra = extra || {};
      for (k in extra) out[k] = extra[k];
      return out;
    }

    var t1 = '2026-01-02T05:00:00.000Z';
    var t2 = '2026-01-03T05:00:00.000Z';
    var t31 = '2026-02-01T05:00:00.000Z';
    var t100 = '2026-04-11T05:00:00.000Z';

    var n = processAlignmentUserBatch({ batchId: 'b1', batchTime: t1, userState: state(), reactions: [] });
    add('1. 반응 없음 유지', n.success && n.nextState.alignmentScore === 0 && n.nextState.currentTerritory === 'CENTRAL');
    var first = processAlignmentUserBatch({ batchId: 'b1', batchTime: t1, userState: state(), reactions: [reaction({ reactionId: 'r2' })] });
    add('2. 첫 배치 신호 반영', first.success && first.scoreCalculation.currentAlignmentSignal === 120 && first.scoreCalculation.cappedChange === 120);
    var next = processAlignmentUserBatch({ batchId: 'b2', batchTime: t2, userState: first.nextState, reactions: [reaction({ reactionId: 'r2' })] });
    add('3. 같은 반응 반복 가산 없음', next.success && Math.abs(next.scoreCalculation.cappedChange) < 1e-9);
    var withNew = processAlignmentUserBatch({ batchId: 'b3', batchTime: t2, userState: first.nextState, reactions: [reaction({ reactionId: 'r2' }), reaction({ reactionId: 'r3', createdAt: t2 })] });
    add('4. 새 반응 차이만 반영', withNew.success && withNew.scoreCalculation.cappedChange > 0);
    var cancelBase = processAlignmentUserBatch({ batchId: 'b1', batchTime: t1, userState: state(), reactions: [reaction({ reactionId: 'r4' })] });
    var cancelNext = processAlignmentUserBatch({ batchId: 'b2', batchTime: t2, userState: cancelBase.nextState, reactions: [reaction({ reactionId: 'r4', cancelledAt: '2026-01-02T06:00:00.000Z' })] });
    add('5. 취소 차이 반영', cancelNext.success && cancelNext.scoreCalculation.cappedChange < 0);
    var exp30Base = processAlignmentUserBatch({ batchId: 'b1', batchTime: '2026-01-01T05:00:00.000Z', userState: state(), reactions: [reaction({ reactionId: 'r5', createdAt: '2026-01-01T05:00:00.000Z' })] });
    var exp30Next = processAlignmentUserBatch({ batchId: 'b2', batchTime: t31, userState: exp30Base.nextState, reactions: [reaction({ reactionId: 'r5', createdAt: '2026-01-01T05:00:00.000Z' })] });
    add('6. 30일 창 만료 반영', exp30Next.success && exp30Next.scoreCalculation.cappedChange < 0);
    var exp99Next = processAlignmentUserBatch({ batchId: 'b2', batchTime: t100, userState: exp30Base.nextState, reactions: [reaction({ reactionId: 'r5', createdAt: '2026-01-01T05:00:00.000Z' })] });
    add('7. 99일 창 만료 반영', exp99Next.success && exp99Next.scoreCalculation.cappedChange < 0);
    var capPos = processAlignmentUserBatch({ batchId: 'b1', batchTime: t1, userState: state(), reactions: [reaction({ reactionId: 'c1' }), reaction({ reactionId: 'c2' }), reaction({ reactionId: 'c3' }), reaction({ reactionId: 'c4' }), reaction({ reactionId: 'c5' }), reaction({ reactionId: 'c6' }), reaction({ reactionId: 'c7' })] });
    add('8. 양수 상한 적용', capPos.success && capPos.scoreCalculation.cappedChange === 500);
    var capNeg = processAlignmentUserBatch({ batchId: 'b1', batchTime: t1, userState: state(), reactions: [reaction({ reactionId: 'n1', actorTerritoryAtReaction: 'GUARDIAN' }), reaction({ reactionId: 'n2', actorTerritoryAtReaction: 'GUARDIAN' }), reaction({ reactionId: 'n3', actorTerritoryAtReaction: 'GUARDIAN' }), reaction({ reactionId: 'n4', actorTerritoryAtReaction: 'GUARDIAN' }), reaction({ reactionId: 'n5', actorTerritoryAtReaction: 'GUARDIAN' }), reaction({ reactionId: 'n6', actorTerritoryAtReaction: 'GUARDIAN' }), reaction({ reactionId: 'n7', actorTerritoryAtReaction: 'GUARDIAN' })] });
    add('9. 음수 상한 적용', capNeg.success && capNeg.scoreCalculation.cappedChange === -500);
    var p1 = processAlignmentUserBatch({ batchId: 'b1', batchTime: t1, userState: state({ alignmentScore: 1000, previousAlignmentSignal: 0 }), reactions: [reaction({ reactionId: 'p1', createdAt: t1 })] });
    add('10. 중앙 +1001 첫 확인 보류', p1.success && p1.territoryTransition.nextTerritory === 'CENTRAL' && p1.territoryTransition.pendingTerritoryBatchCount === 1);
    var p2 = processAlignmentUserBatch({ batchId: 'b2', batchTime: t2, userState: p1.nextState, reactions: [reaction({ reactionId: 'p1', createdAt: t1 }), reaction({ reactionId: 'p2', createdAt: t2 })] });
    add('11. 중앙 +1001 두 번째 개척', p2.success && p2.territoryTransition.nextTerritory === 'PIONEER');
    var g1 = processAlignmentUserBatch({ batchId: 'b1', batchTime: t1, userState: state({ alignmentScore: -1000, previousAlignmentSignal: 0 }), reactions: [reaction({ reactionId: 'g1', actorTerritoryAtReaction: 'GUARDIAN', createdAt: t1 })] });
    var g2 = processAlignmentUserBatch({ batchId: 'b2', batchTime: t2, userState: g1.nextState, reactions: [reaction({ reactionId: 'g1', actorTerritoryAtReaction: 'GUARDIAN', createdAt: t1 }), reaction({ reactionId: 'g2', actorTerritoryAtReaction: 'GUARDIAN', createdAt: t2 })] });
    add('12. 중앙 -1001 두 번째 수호', g2.success && g2.territoryTransition.nextTerritory === 'GUARDIAN');
    var backP1 = processAlignmentUserBatch({ batchId: 'b1', batchTime: t1, userState: state({ alignmentScore: 801, currentTerritory: 'PIONEER', previousAlignmentSignal: 801 }), reactions: [reaction({ reactionId: 'bp1', actorTerritoryAtReaction: 'GUARDIAN', createdAt: t1 })] });
    var backP2 = processAlignmentUserBatch({ batchId: 'b2', batchTime: t2, userState: backP1.nextState, reactions: [reaction({ reactionId: 'bp1', actorTerritoryAtReaction: 'GUARDIAN', createdAt: t1 }), reaction({ reactionId: 'bp2', actorTerritoryAtReaction: 'GUARDIAN', createdAt: t2 })] });
    add('13. 개척 +800 두 번째 중앙 복귀', backP2.success && backP2.territoryTransition.nextTerritory === 'CENTRAL');
    var backG1 = processAlignmentUserBatch({ batchId: 'b1', batchTime: t1, userState: state({ alignmentScore: -801, currentTerritory: 'GUARDIAN', previousAlignmentSignal: -801 }), reactions: [reaction({ reactionId: 'bg1', actorTerritoryAtReaction: 'PIONEER', createdAt: t1 })] });
    var backG2 = processAlignmentUserBatch({ batchId: 'b2', batchTime: t2, userState: backG1.nextState, reactions: [reaction({ reactionId: 'bg1', actorTerritoryAtReaction: 'PIONEER', createdAt: t1 }), reaction({ reactionId: 'bg2', actorTerritoryAtReaction: 'PIONEER', createdAt: t2 })] });
    add('14. 수호 -800 두 번째 중앙 복귀', backG2.success && backG2.territoryTransition.nextTerritory === 'CENTRAL');
    add('15. 개척에서 수호 직접 이동 없음', backP1.success && backP1.territoryTransition.candidateTerritory !== 'GUARDIAN');
    add('16. 수호에서 개척 직접 이동 없음', backG1.success && backG1.territoryTransition.candidateTerritory !== 'PIONEER');
    var skipped = processAlignmentUserBatch({ batchId: 'same', batchTime: t1, userState: state({ lastProcessedAlignmentBatchId: 'same' }), reactions: [reaction()] });
    add('17. 같은 batchId 스킵', skipped.success && skipped.skipped === true && skipped.skipReason === 'ALIGNMENT_BATCH_ALREADY_PROCESSED');
    add('18. 중복 처리 시 점수 재반영 없음', skipped.success && skipped.nextState.alignmentScore === 0);
    var multi = processAlignmentBatch({ batchId: 'mb1', batchTime: t1, users: [state({ userId: 'ok' }), { bad: true }], reactions: [reaction({ targetUserId: 'ok' })] });
    add('19. 한 명 오류가 전체 중단 안 함', multi.userResults.length === 2 && multi.summary.processedUsers === 1 && multi.summary.failedUsers === 1);
    var alien = processAlignmentUserBatch({ batchId: 'a1', batchTime: t1, userState: state(), reactions: [reaction({ reactionId: 'a1', actorTerritoryAtReaction: 'ALIEN' })] });
    add('20. 외계 반응 제외', alien.success && alien.metrics.excludedAlienReactionCount === 1 && alien.scoreCalculation.currentAlignmentSignal === 0);
    var cancelledBefore = processAlignmentUserBatch({ batchId: 'cbe', batchTime: t2, userState: state(), reactions: [reaction({ reactionId: 'cbe', cancelledAt: t1 })] });
    add('21. 배치 이전 취소 제외', cancelledBefore.success && cancelledBefore.scoreCalculation.currentAlignmentSignal === 0);
    var cancelledAfter = processAlignmentUserBatch({ batchId: 'caf', batchTime: t1, userState: state(), reactions: [reaction({ reactionId: 'caf', cancelledAt: t2 })] });
    add('22. 배치 이후 취소는 포함', cancelledAfter.success && cancelledAfter.scoreCalculation.currentAlignmentSignal !== 0);
    var invalid = processAlignmentUserBatch({ batchId: 'iv1', batchTime: t1, userState: state(), reactions: [reaction({ reactionId: 'iv1', reactionType: 'BAD' }), reaction({ reactionId: 'iv2' })] });
    add('23. 잘못된 반응 제외 + 경고', invalid.success && invalid.metrics.invalidReactionCount === 1 && invalid.warnings.length >= 1);
    var originalState = state();
    var copyState = clone(originalState);
    processAlignmentUserBatch({ batchId: 'm1', batchTime: t1, userState: originalState, reactions: [] });
    add('24. 입력 state 불변', JSON.stringify(originalState) === JSON.stringify(copyState));
    var originalReactions = [reaction({ reactionId: 'm2' })];
    var copyReactions = clone(originalReactions);
    processAlignmentUserBatch({ batchId: 'm2', batchTime: t1, userState: state(), reactions: originalReactions });
    add('25. 입력 reactions 불변', JSON.stringify(originalReactions) === JSON.stringify(copyReactions));
    var sameInput = { batchId: 'det', batchTime: t1, userState: state(), reactions: [reaction({ reactionId: 'det1' })] };
    add('26. 같은 입력 같은 결과', JSON.stringify(processAlignmentUserBatch(sameInput)) === JSON.stringify(processAlignmentUserBatch(sameInput)));
    var det = processAlignmentUserBatch(sameInput);
    add('27. nextState.previousAlignmentSignal 저장', det.success && det.nextState.previousAlignmentSignal === det.scoreCalculation.currentAlignmentSignal);
    add('28. nextState.lastProcessedAlignmentBatchId 저장', det.success && det.nextState.lastProcessedAlignmentBatchId === 'det');
    var sumCheck = processAlignmentBatch({ batchId: 'sum1', batchTime: t1, users: [state({ userId: 's1' }), state({ userId: 's2', lastProcessedAlignmentBatchId: 'sum1' })], reactions: [reaction({ reactionId: 'sr1', targetUserId: 's1' })] });
    add('29. summary 숫자 일치', sumCheck.summary.totalUsers === sumCheck.userResults.length && sumCheck.summary.processedUsers + sumCheck.summary.skippedUsers + sumCheck.summary.failedUsers === sumCheck.summary.totalUsers);
    var terr = typeof global.runAlignmentTerritoryRuleTests === 'function' ? global.runAlignmentTerritoryRuleTests() : { passed: 0, total: 0, allPassed: false };
    add('30. 정렬 영토 판정 테스트 유지', terr.allPassed && terr.total >= 18, terr.passed + '/' + terr.total);
    var forbiddenKeyA = 'orient' + 'ation' + 'Score';
    var forbiddenKeyB = 'previous' + 'Combined' + 'Reaction' + 'Score';
    var forbiddenKeyC = 'last' + 'Processed' + 'Orient' + 'ation' + 'BatchId';
    add('31. nextState 금지 키 없음', det.success && !(forbiddenKeyA in det.nextState) && !(forbiddenKeyB in det.nextState) && !(forbiddenKeyC in det.nextState));

    return {
      passed: passed,
      total: results.length,
      allPassed: passed === results.length,
      results: results,
      config: getAlignmentBatchProcessorConfig(),
    };
  }

  global.getAlignmentBatchProcessorConfig = getAlignmentBatchProcessorConfig;
  global.processAlignmentUserBatch = processAlignmentUserBatch;
  global.processAlignmentBatch = processAlignmentBatch;
  global.runAlignmentBatchProcessorTests = runAlignmentBatchProcessorTests;

  if (typeof global.window !== 'undefined') {
    global.window.__scGetAlignmentBatchProcessorConfig = getAlignmentBatchProcessorConfig;
    global.window.__scProcessAlignmentUserBatch = processAlignmentUserBatch;
    global.window.__scProcessAlignmentBatch = processAlignmentBatch;
    global.window.__scRunAlignmentBatchProcessorTests = runAlignmentBatchProcessorTests;
  } else if (global === globalThis) {
    global.__scGetAlignmentBatchProcessorConfig = getAlignmentBatchProcessorConfig;
    global.__scProcessAlignmentUserBatch = processAlignmentUserBatch;
    global.__scProcessAlignmentBatch = processAlignmentBatch;
    global.__scRunAlignmentBatchProcessorTests = runAlignmentBatchProcessorTests;
  }
})(typeof window !== 'undefined' ? window : globalThis);
