/**
 * =============================================================================
 * 센텐스크래프트 — 정치 성향 운영용 영토 판정 (순수 함수)
 * =============================================================================
 * 시뮬레이션(1~5차)에서 검증한 규칙을 운영 배치용으로 분리한다.
 *
 * 확정 규칙 (CENTRAL_1000 + hysteresis 200 + 2회 연속):
 * - 중앙 범위: -1000 ~ +1000
 * - CENTRAL → PIONEER: score ≥ +1001, 동일 후보 2회 연속
 * - CENTRAL → GUARDIAN: score ≤ -1001, 동일 후보 2회 연속
 * - PIONEER → CENTRAL: score ≤ +800, 동일 후보 2회 연속
 * - GUARDIAN → CENTRAL: score ≥ -800, 동일 후보 2회 연속
 * - PIONEER ↔ GUARDIAN 직접 이동 금지 (반드시 CENTRAL 경유)
 *
 * 입력은 이미 계산된 orientationScore만 사용한다.
 * 점수 계산(DELTA_WINDOW_SCORE·가중치·상한·배치 시각)은 이 모듈에서 다루지 않는다.
 * 실제 사용자·DB·Firebase·API·UI 미연결.
 * =============================================================================
 */
(function (global) {
  'use strict';

  var TERRITORY = Object.freeze({
    PIONEER: 'PIONEER',
    CENTRAL: 'CENTRAL',
    GUARDIAN: 'GUARDIAN',
  });

  var POLITICAL_TERRITORY_RULES = Object.freeze({
    centralMin: -1000,
    centralMax: 1000,
    pioneerEntryMin: 1001,
    guardianEntryMax: -1001,
    pioneerExitMax: 800,
    guardianExitMin: -800,
    requiredConsecutiveBatches: 2,
    directSideSwitchAllowed: false,
  });

  var TRANSITION_REASON = Object.freeze({
    HOLD: 'HOLD',
    PENDING_START: 'PENDING_START',
    PENDING_CONTINUE: 'PENDING_CONTINUE',
    CONFIRMED: 'CONFIRMED',
    PENDING_CLEARED: 'PENDING_CLEARED',
    PENDING_RESTARTED: 'PENDING_RESTARTED',
  });

  function normalizeTerritory(value) {
    if (value === TERRITORY.PIONEER || value === TERRITORY.GUARDIAN || value === TERRITORY.CENTRAL) {
      return value;
    }
    return TERRITORY.CENTRAL;
  }

  function normalizeScore(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function getPoliticalTerritoryRules() {
    return {
      centralMin: POLITICAL_TERRITORY_RULES.centralMin,
      centralMax: POLITICAL_TERRITORY_RULES.centralMax,
      pioneerEntryMin: POLITICAL_TERRITORY_RULES.pioneerEntryMin,
      guardianEntryMax: POLITICAL_TERRITORY_RULES.guardianEntryMax,
      pioneerExitMax: POLITICAL_TERRITORY_RULES.pioneerExitMax,
      guardianExitMin: POLITICAL_TERRITORY_RULES.guardianExitMin,
      requiredConsecutiveBatches: POLITICAL_TERRITORY_RULES.requiredConsecutiveBatches,
      directSideSwitchAllowed: POLITICAL_TERRITORY_RULES.directSideSwitchAllowed,
    };
  }

  function createPoliticalTerritoryState(partial) {
    var src = partial || {};
    return {
      orientationScore: normalizeScore(src.orientationScore),
      currentTerritory: normalizeTerritory(src.currentTerritory),
      pendingTerritory: src.pendingTerritory == null ? null : normalizeTerritory(src.pendingTerritory),
      pendingTerritoryBatchCount: Math.max(0, Number(src.pendingTerritoryBatchCount) || 0),
      pendingTerritoryStartedAt: src.pendingTerritoryStartedAt == null ? null : src.pendingTerritoryStartedAt,
    };
  }

  function resetPendingPoliticalTerritory(state) {
    var base = createPoliticalTerritoryState(state);
    return {
      orientationScore: base.orientationScore,
      currentTerritory: base.currentTerritory,
      pendingTerritory: null,
      pendingTerritoryBatchCount: 0,
      pendingTerritoryStartedAt: null,
    };
  }

  /**
   * 현재 영토 기준으로 이동 후보만 계산한다. 즉시 확정하지 않는다.
   * PIONEER/GUARDIAN에서는 반대편 직접 이동 후보를 만들지 않는다.
   */
  function getPoliticalTerritoryCandidate(state) {
    var s = createPoliticalTerritoryState(state);
    var score = s.orientationScore;
    var cur = s.currentTerritory;
    var rules = POLITICAL_TERRITORY_RULES;

    if (cur === TERRITORY.CENTRAL) {
      if (score >= rules.pioneerEntryMin) return TERRITORY.PIONEER;
      if (score <= rules.guardianEntryMax) return TERRITORY.GUARDIAN;
      return TERRITORY.CENTRAL;
    }

    if (cur === TERRITORY.PIONEER) {
      if (score <= rules.pioneerExitMax) return TERRITORY.CENTRAL;
      return TERRITORY.PIONEER;
    }

    if (cur === TERRITORY.GUARDIAN) {
      if (score >= rules.guardianExitMin) return TERRITORY.CENTRAL;
      return TERRITORY.GUARDIAN;
    }

    return TERRITORY.CENTRAL;
  }

  /**
   * 이미 계산된 orientationScore로 영토 변경 여부만 판정한다.
   * 입력 state를 변경하지 않는다. 점수 값도 변경하지 않는다.
   */
  function evaluatePoliticalTerritoryTransition(state, batchTime) {
    var current = createPoliticalTerritoryState(state);
    var previousTerritory = current.currentTerritory;
    var candidateTerritory = getPoliticalTerritoryCandidate(current);
    var required = POLITICAL_TERRITORY_RULES.requiredConsecutiveBatches;
    var score = current.orientationScore;
    var batchIso = batchTime == null ? null : batchTime;

    if (candidateTerritory === previousTerritory) {
      var hadPending = current.pendingTerritory != null || current.pendingTerritoryBatchCount > 0;
      return {
        previousTerritory: previousTerritory,
        candidateTerritory: candidateTerritory,
        nextTerritory: previousTerritory,
        territoryChanged: false,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
        requiredConsecutiveBatches: required,
        transitionReason: hadPending ? TRANSITION_REASON.PENDING_CLEARED : TRANSITION_REASON.HOLD,
        orientationScore: score,
      };
    }

    var pendingTerritory = current.pendingTerritory;
    var pendingCount = current.pendingTerritoryBatchCount || 0;
    var pendingStartedAt = current.pendingTerritoryStartedAt;
    var reason;

    if (pendingTerritory !== candidateTerritory) {
      pendingTerritory = candidateTerritory;
      pendingCount = 1;
      pendingStartedAt = batchIso;
      reason =
        current.pendingTerritory != null && current.pendingTerritory !== candidateTerritory
          ? TRANSITION_REASON.PENDING_RESTARTED
          : TRANSITION_REASON.PENDING_START;
    } else {
      pendingCount = pendingCount + 1;
      reason = TRANSITION_REASON.PENDING_CONTINUE;
    }

    if (pendingCount >= required) {
      return {
        previousTerritory: previousTerritory,
        candidateTerritory: candidateTerritory,
        nextTerritory: candidateTerritory,
        territoryChanged: true,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
        requiredConsecutiveBatches: required,
        transitionReason: TRANSITION_REASON.CONFIRMED,
        orientationScore: score,
      };
    }

    return {
      previousTerritory: previousTerritory,
      candidateTerritory: candidateTerritory,
      nextTerritory: previousTerritory,
      territoryChanged: false,
      pendingTerritory: pendingTerritory,
      pendingTerritoryBatchCount: pendingCount,
      pendingTerritoryStartedAt: pendingStartedAt,
      requiredConsecutiveBatches: required,
      transitionReason: reason,
      orientationScore: score,
    };
  }

  function applyEvaluationToState(state, evaluation) {
    return {
      orientationScore: normalizeScore(state && state.orientationScore),
      currentTerritory: evaluation.nextTerritory,
      pendingTerritory: evaluation.pendingTerritory,
      pendingTerritoryBatchCount: evaluation.pendingTerritoryBatchCount,
      pendingTerritoryStartedAt: evaluation.pendingTerritoryStartedAt,
    };
  }

  function runPoliticalTerritoryRuleTests() {
    var results = [];
    var passed = 0;

    function add(name, pass, detail) {
      results.push({ name: name, pass: !!pass, detail: detail || '' });
      if (pass) passed += 1;
    }

    function state(partial) {
      return createPoliticalTerritoryState(partial);
    }

    function step(s, batchTime) {
      var ev = evaluatePoliticalTerritoryTransition(s, batchTime);
      return { evaluation: ev, next: applyEvaluationToState(s, ev) };
    }

    /* 1 */ {
      var e = evaluatePoliticalTerritoryTransition(state({ orientationScore: 1000, currentTerritory: 'CENTRAL' }), 't1');
      add('CENTRAL +1000은 중앙 유지', e.nextTerritory === 'CENTRAL' && !e.territoryChanged && e.pendingTerritory == null);
    }

    /* 2 */ {
      var e2 = evaluatePoliticalTerritoryTransition(state({ orientationScore: 1001, currentTerritory: 'CENTRAL' }), 't1');
      add(
        'CENTRAL +1001 첫 배치는 이동하지 않고 pending 1',
        e2.nextTerritory === 'CENTRAL' &&
          !e2.territoryChanged &&
          e2.candidateTerritory === 'PIONEER' &&
          e2.pendingTerritory === 'PIONEER' &&
          e2.pendingTerritoryBatchCount === 1
      );
    }

    /* 3 */ {
      var s3 = state({ orientationScore: 1001, currentTerritory: 'CENTRAL' });
      var a = step(s3, 't1');
      var b = step(a.next, 't2');
      add(
        'CENTRAL +1001 두 번 연속이면 PIONEER 이동',
        a.evaluation.territoryChanged === false &&
          b.evaluation.territoryChanged === true &&
          b.evaluation.nextTerritory === 'PIONEER' &&
          b.evaluation.pendingTerritory == null
      );
    }

    /* 4 */ {
      var e4 = evaluatePoliticalTerritoryTransition(state({ orientationScore: -1000, currentTerritory: 'CENTRAL' }), 't1');
      add('CENTRAL -1000은 중앙 유지', e4.nextTerritory === 'CENTRAL' && !e4.territoryChanged);
    }

    /* 5 */ {
      var s5 = state({ orientationScore: -1001, currentTerritory: 'CENTRAL' });
      var a5 = step(s5, 't1');
      var b5 = step(a5.next, 't2');
      add(
        'CENTRAL -1001 두 번 연속이면 GUARDIAN 이동',
        b5.evaluation.territoryChanged && b5.evaluation.nextTerritory === 'GUARDIAN'
      );
    }

    /* 6 */ {
      var e6 = evaluatePoliticalTerritoryTransition(state({ orientationScore: 801, currentTerritory: 'PIONEER' }), 't1');
      add('PIONEER +801은 개척 유지', e6.nextTerritory === 'PIONEER' && !e6.territoryChanged && e6.candidateTerritory === 'PIONEER');
    }

    /* 7 */ {
      var s7 = state({ orientationScore: 800, currentTerritory: 'PIONEER' });
      var a7 = step(s7, 't1');
      var b7 = step(a7.next, 't2');
      add(
        'PIONEER +800 두 번 연속이면 CENTRAL 복귀',
        a7.evaluation.candidateTerritory === 'CENTRAL' &&
          b7.evaluation.territoryChanged &&
          b7.evaluation.nextTerritory === 'CENTRAL'
      );
    }

    /* 8 */ {
      var e8 = evaluatePoliticalTerritoryTransition(state({ orientationScore: -801, currentTerritory: 'GUARDIAN' }), 't1');
      add('GUARDIAN -801은 수호 유지', e8.nextTerritory === 'GUARDIAN' && e8.candidateTerritory === 'GUARDIAN');
    }

    /* 9 */ {
      var s9 = state({ orientationScore: -800, currentTerritory: 'GUARDIAN' });
      var a9 = step(s9, 't1');
      var b9 = step(a9.next, 't2');
      add(
        'GUARDIAN -800 두 번 연속이면 CENTRAL 복귀',
        b9.evaluation.territoryChanged && b9.evaluation.nextTerritory === 'CENTRAL'
      );
    }

    /* 10 */ {
      var s10 = state({ orientationScore: 1001, currentTerritory: 'CENTRAL' });
      var a10 = step(s10, 't1');
      a10.next.orientationScore = 1000;
      var b10 = step(a10.next, 't2');
      add(
        '두 번째 확인 전 점수 복귀 시 pending 초기화',
        a10.evaluation.pendingTerritoryBatchCount === 1 &&
          b10.evaluation.pendingTerritory == null &&
          b10.evaluation.pendingTerritoryBatchCount === 0 &&
          b10.evaluation.nextTerritory === 'CENTRAL' &&
          !b10.evaluation.territoryChanged
      );
    }

    /* 11 */ {
      var s11 = state({ orientationScore: 1001, currentTerritory: 'CENTRAL' });
      var a11 = step(s11, 't1');
      a11.next.orientationScore = -1001;
      var b11 = step(a11.next, 't2');
      add(
        'pending 후보 방향이 바뀌면 카운트가 1부터 다시 시작',
        a11.evaluation.pendingTerritory === 'PIONEER' &&
          a11.evaluation.pendingTerritoryBatchCount === 1 &&
          b11.evaluation.pendingTerritory === 'GUARDIAN' &&
          b11.evaluation.pendingTerritoryBatchCount === 1 &&
          !b11.evaluation.territoryChanged
      );
    }

    /* 12 */ {
      var s12 = state({ orientationScore: 1001, currentTerritory: 'CENTRAL' });
      var a12 = step(s12, 't1');
      var b12 = step(a12.next, 't2');
      add(
        '영토 변경 후 pending 상태 초기화',
        b12.evaluation.territoryChanged &&
          b12.evaluation.pendingTerritory == null &&
          b12.evaluation.pendingTerritoryBatchCount === 0 &&
          b12.evaluation.pendingTerritoryStartedAt == null
      );
    }

    /* 13 */ {
      var e13 = evaluatePoliticalTerritoryTransition(
        state({ orientationScore: -1500, currentTerritory: 'PIONEER' }),
        't1'
      );
      add(
        'PIONEER에서 GUARDIAN 직접 이동 금지',
        e13.candidateTerritory === 'CENTRAL' &&
          e13.nextTerritory === 'PIONEER' &&
          e13.pendingTerritory === 'CENTRAL'
      );
    }

    /* 14 */ {
      var e14 = evaluatePoliticalTerritoryTransition(
        state({ orientationScore: 1500, currentTerritory: 'GUARDIAN' }),
        't1'
      );
      add(
        'GUARDIAN에서 PIONEER 직접 이동 금지',
        e14.candidateTerritory === 'CENTRAL' &&
          e14.nextTerritory === 'GUARDIAN' &&
          e14.pendingTerritory === 'CENTRAL'
      );
    }

    /* 15 */ {
      var input = state({
        orientationScore: 1200,
        currentTerritory: 'CENTRAL',
        pendingTerritory: 'PIONEER',
        pendingTerritoryBatchCount: 1,
        pendingTerritoryStartedAt: 't1',
      });
      var r1 = evaluatePoliticalTerritoryTransition(input, 't2');
      var r2 = evaluatePoliticalTerritoryTransition(input, 't2');
      add('같은 입력 상태에서 항상 같은 결과 반환', JSON.stringify(r1) === JSON.stringify(r2));
    }

    /* 16 */ {
      var input16 = state({ orientationScore: 1200, currentTerritory: 'CENTRAL' });
      var before = input16.orientationScore;
      evaluatePoliticalTerritoryTransition(input16, 't1');
      add('점수 자체를 함수가 변경하지 않음', input16.orientationScore === before && before === 1200);
    }

    /* 17 */ {
      var beforeStab = global.territoryStabilizationComparisonState;
      var beforeLarge = global.largeScaleComparisonState;
      var beforeOsc = global.oscillationCauseAnalysisState;
      var beforeSim =
        typeof global.getOrientationSimulationState === 'function' ? global.getOrientationSimulationState() : null;
      var beforeStabGet =
        typeof global.getTerritoryStabilizationComparisonState === 'function'
          ? global.getTerritoryStabilizationComparisonState()
          : null;
      evaluatePoliticalTerritoryTransition(state({ orientationScore: 1001, currentTerritory: 'CENTRAL' }), 't1');
      var afterStab = global.territoryStabilizationComparisonState;
      var afterLarge = global.largeScaleComparisonState;
      var afterOsc = global.oscillationCauseAnalysisState;
      var afterSim =
        typeof global.getOrientationSimulationState === 'function' ? global.getOrientationSimulationState() : null;
      var afterStabGet =
        typeof global.getTerritoryStabilizationComparisonState === 'function'
          ? global.getTerritoryStabilizationComparisonState()
          : null;
      add(
        '기존 시뮬레이션 결과와 상태를 변경하지 않음',
        beforeStab === afterStab &&
          beforeLarge === afterLarge &&
          beforeOsc === afterOsc &&
          beforeSim === afterSim &&
          beforeStabGet === afterStabGet
      );
    }

    /* 18 */ {
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
        evaluatePoliticalTerritoryTransition(state({ orientationScore: 1001, currentTerritory: 'CENTRAL' }), 't1');
        getPoliticalTerritoryRules();
        resetPendingPoliticalTerritory(state({ pendingTerritory: 'PIONEER', pendingTerritoryBatchCount: 1 }));
        getPoliticalTerritoryCandidate(state({ orientationScore: -1500, currentTerritory: 'PIONEER' }));
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
      add('실제 사용자·DB·API에 쓰기 작업이 없음', writes === 0);
    }

    var total = results.length;
    return {
      passed: passed,
      total: total,
      allPassed: passed === total,
      results: results,
      rules: getPoliticalTerritoryRules(),
    };
  }

  /* ─── exports ─── */

  global.POLITICAL_TERRITORY = TERRITORY;
  global.POLITICAL_TERRITORY_TRANSITION_REASON = TRANSITION_REASON;
  global.getPoliticalTerritoryRules = getPoliticalTerritoryRules;
  global.createPoliticalTerritoryState = createPoliticalTerritoryState;
  global.resetPendingPoliticalTerritory = resetPendingPoliticalTerritory;
  global.getPoliticalTerritoryCandidate = getPoliticalTerritoryCandidate;
  global.evaluatePoliticalTerritoryTransition = evaluatePoliticalTerritoryTransition;
  global.runPoliticalTerritoryRuleTests = runPoliticalTerritoryRuleTests;

  if (typeof global.window !== 'undefined') {
    global.window.__scGetPoliticalTerritoryRules = getPoliticalTerritoryRules;
    global.window.__scEvaluatePoliticalTerritoryTransition = evaluatePoliticalTerritoryTransition;
    global.window.__scRunPoliticalTerritoryRuleTests = runPoliticalTerritoryRuleTests;
  } else if (global === globalThis) {
    global.__scGetPoliticalTerritoryRules = getPoliticalTerritoryRules;
    global.__scEvaluatePoliticalTerritoryTransition = evaluatePoliticalTerritoryTransition;
    global.__scRunPoliticalTerritoryRuleTests = runPoliticalTerritoryRuleTests;
  }
})(typeof window !== 'undefined' ? window : globalThis);
