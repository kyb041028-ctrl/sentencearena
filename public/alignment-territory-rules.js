/**
 * 센텐스아레나 — alignment 영토 판정 브라우저 어댑터
 * - shared/alignment-territory-core.js 를 먼저 로드해야 함
 */
(function (global) {
  'use strict';

  var core = global.AlignmentTerritoryCore;
  if (!core) {
    throw new Error('AlignmentTerritoryCore must be loaded before alignment-territory-rules.js');
  }

  var TERRITORY = core.TERRITORY;
  var TRANSITION_REASON = core.TRANSITION_REASON;
  var getAlignmentTerritoryRules = core.getAlignmentTerritoryRules;
  var createAlignmentTerritoryState = core.createAlignmentTerritoryState;
  var resetPendingTerritory = core.resetPendingTerritory;
  var getTerritoryCandidate = core.getTerritoryCandidate;
  var evaluateTerritoryTransition = core.evaluateTerritoryTransition;
  var applyEvaluationToState = core.applyEvaluationToState;

  function runAlignmentTerritoryRuleTests() {
    var results = [];
    var passed = 0;

    function add(name, pass, detail) {
      results.push({ name: name, pass: !!pass, detail: detail || '' });
      if (pass) passed += 1;
    }
    function state(partial) {
      return createAlignmentTerritoryState(partial);
    }
    function step(s, batchTime) {
      var ev = evaluateTerritoryTransition(s, batchTime);
      return { evaluation: ev, next: applyEvaluationToState(s, ev) };
    }

    add('중앙 +1000 유지', evaluateTerritoryTransition(state({ alignmentScore: 1000, currentTerritory: 'CENTRAL' }), 't1').nextTerritory === 'CENTRAL');
    var e2 = evaluateTerritoryTransition(state({ alignmentScore: 1001, currentTerritory: 'CENTRAL' }), 't1');
    add('중앙 +1001 첫 확인 보류', e2.nextTerritory === 'CENTRAL' && e2.pendingTerritory === 'PIONEER' && e2.pendingTerritoryBatchCount === 1);
    var s3 = step(state({ alignmentScore: 1001, currentTerritory: 'CENTRAL' }), 't1');
    var s3b = step(s3.next, 't2');
    add('중앙 +1001 두 번 연속 개척', s3b.evaluation.nextTerritory === 'PIONEER' && s3b.evaluation.territoryChanged);
    add('중앙 -1000 유지', evaluateTerritoryTransition(state({ alignmentScore: -1000, currentTerritory: 'CENTRAL' }), 't1').nextTerritory === 'CENTRAL');
    var s5 = step(state({ alignmentScore: -1001, currentTerritory: 'CENTRAL' }), 't1');
    var s5b = step(s5.next, 't2');
    add('중앙 -1001 두 번 연속 수호', s5b.evaluation.nextTerritory === 'GUARDIAN' && s5b.evaluation.territoryChanged);
    add('개척 +801 유지', evaluateTerritoryTransition(state({ alignmentScore: 801, currentTerritory: 'PIONEER' }), 't1').nextTerritory === 'PIONEER');
    var s7 = step(state({ alignmentScore: 800, currentTerritory: 'PIONEER' }), 't1');
    var s7b = step(s7.next, 't2');
    add('개척 +800 두 번 연속 중앙 복귀', s7b.evaluation.nextTerritory === 'CENTRAL');
    add('수호 -801 유지', evaluateTerritoryTransition(state({ alignmentScore: -801, currentTerritory: 'GUARDIAN' }), 't1').nextTerritory === 'GUARDIAN');
    var s9 = step(state({ alignmentScore: -800, currentTerritory: 'GUARDIAN' }), 't1');
    var s9b = step(s9.next, 't2');
    add('수호 -800 두 번 연속 중앙 복귀', s9b.evaluation.nextTerritory === 'CENTRAL');
    var s10 = step(state({ alignmentScore: 1001, currentTerritory: 'CENTRAL' }), 't1');
    s10.next.alignmentScore = 1000;
    var s10b = step(s10.next, 't2');
    add('두 번째 전 복귀 시 pending 초기화', s10b.evaluation.pendingTerritory == null && s10b.evaluation.nextTerritory === 'CENTRAL');
    var s11 = step(state({ alignmentScore: 1001, currentTerritory: 'CENTRAL' }), 't1');
    s11.next.alignmentScore = -1001;
    var s11b = step(s11.next, 't2');
    add('pending 방향 변경 시 1부터 재시작', s11b.evaluation.pendingTerritory === 'GUARDIAN' && s11b.evaluation.pendingTerritoryBatchCount === 1);
    var s12 = step(state({ alignmentScore: 1001, currentTerritory: 'CENTRAL' }), 't1');
    var s12b = step(s12.next, 't2');
    add('변경 후 pending 초기화', s12b.evaluation.pendingTerritory == null && s12b.evaluation.pendingTerritoryBatchCount === 0);
    var e13 = evaluateTerritoryTransition(state({ alignmentScore: -1500, currentTerritory: 'PIONEER' }), 't1');
    add('개척에서 수호 직접 이동 없음', e13.candidateTerritory === 'CENTRAL' && e13.nextTerritory === 'PIONEER');
    var e14 = evaluateTerritoryTransition(state({ alignmentScore: 1500, currentTerritory: 'GUARDIAN' }), 't1');
    add('수호에서 개척 직접 이동 없음', e14.candidateTerritory === 'CENTRAL' && e14.nextTerritory === 'GUARDIAN');
    var i15 = state({ alignmentScore: 1200, currentTerritory: 'CENTRAL', pendingTerritory: 'PIONEER', pendingTerritoryBatchCount: 1, pendingTerritoryStartedAt: 't1' });
    add('같은 입력은 같은 결과', JSON.stringify(evaluateTerritoryTransition(i15, 't2')) === JSON.stringify(evaluateTerritoryTransition(i15, 't2')));
    var i16 = state({ alignmentScore: 1200, currentTerritory: 'CENTRAL' });
    var before = i16.alignmentScore;
    evaluateTerritoryTransition(i16, 't1');
    add('점수 값 불변', i16.alignmentScore === before);
    var beforeSim = typeof global.getOrientationSimulationState === 'function' ? global.getOrientationSimulationState() : null;
    evaluateTerritoryTransition(state({ alignmentScore: 1001, currentTerritory: 'CENTRAL' }), 't1');
    var afterSim = typeof global.getOrientationSimulationState === 'function' ? global.getOrientationSimulationState() : null;
    add('기존 시뮬 상태 비영향', beforeSim === afterSim);
    var writes = 0;
    var fetchWas = global.fetch;
    var lsWas = global.localStorage;
    var setItem = null;
    try {
      global.fetch = function () {
        writes += 1;
        return Promise.resolve();
      };
      if (lsWas && typeof lsWas.setItem === 'function') {
        setItem = lsWas.setItem.bind(lsWas);
        lsWas.setItem = function () {
          writes += 1;
          return setItem.apply(null, arguments);
        };
      }
      evaluateTerritoryTransition(state({ alignmentScore: 1001, currentTerritory: 'CENTRAL' }), 't1');
      getAlignmentTerritoryRules();
      resetPendingTerritory(state({ pendingTerritory: 'PIONEER', pendingTerritoryBatchCount: 1 }));
      getTerritoryCandidate(state({ alignmentScore: -1500, currentTerritory: 'PIONEER' }));
    } finally {
      if (fetchWas === undefined) {
        try {
          delete global.fetch;
        } catch (e) {
          global.fetch = fetchWas;
        }
      } else {
        global.fetch = fetchWas;
      }
      if (lsWas && setItem) lsWas.setItem = setItem;
    }
    add('쓰기 작업 없음', writes === 0);

    return {
      passed: passed,
      total: results.length,
      allPassed: passed === results.length,
      results: results,
      rules: getAlignmentTerritoryRules(),
    };
  }

  global.ALIGNMENT_TERRITORY = TERRITORY;
  global.ALIGNMENT_TERRITORY_TRANSITION_REASON = TRANSITION_REASON;
  global.getAlignmentTerritoryRules = getAlignmentTerritoryRules;
  global.createAlignmentTerritoryState = createAlignmentTerritoryState;
  global.resetPendingTerritory = resetPendingTerritory;
  global.getTerritoryCandidate = getTerritoryCandidate;
  global.evaluateTerritoryTransition = evaluateTerritoryTransition;
  global.runAlignmentTerritoryRuleTests = runAlignmentTerritoryRuleTests;

  if (typeof global.window !== 'undefined') {
    global.window.__scGetAlignmentTerritoryRules = getAlignmentTerritoryRules;
    global.window.__scEvaluateTerritoryTransition = evaluateTerritoryTransition;
    global.window.__scRunAlignmentTerritoryRuleTests = runAlignmentTerritoryRuleTests;
  } else if (global === globalThis) {
    global.__scGetAlignmentTerritoryRules = getAlignmentTerritoryRules;
    global.__scEvaluateTerritoryTransition = evaluateTerritoryTransition;
    global.__scRunAlignmentTerritoryRuleTests = runAlignmentTerritoryRuleTests;
  }
})(typeof window !== 'undefined' ? window : globalThis);
