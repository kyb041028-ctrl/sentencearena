/**
 * =============================================================================
 * 센텐스크래프트 — 영토 발전 Mock 시뮬레이션 / 경계값 검증 (DEV)
 * =============================================================================
 * 사용자 UI 없음. 콘솔에서 __sc* 함수만 직접 실행.
 * 계산 로직을 복제하지 않고 기존 population / hover 함수를 호출한다.
 * =============================================================================
 */
(function (global) {
  'use strict';

  var EVO_KEYS = ['pioneer', 'guardian', 'central', 'alien'];
  var LOG_PREFIX = '[SentensCraft]';

  function normalize(value) {
    if (typeof global.normalizeTerritoryPopulation === 'function') {
      return global.normalizeTerritoryPopulation(value);
    }
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  }

  function getState(territoryKey, populationSource) {
    return global.getTerritoryEvolutionState(territoryKey, populationSource);
  }

  function getNext(territoryKey, population, stage) {
    return global.getTerritoryEvolutionNextStageProgress(territoryKey, population, stage);
  }

  function stageByPop(population) {
    return global.getTerritoryEvolutionStageByPopulation(population);
  }

  function evoPop(territoryKey, source) {
    return global.getTerritoryEvolutionPopulation(territoryKey, source);
  }

  function refreshHover() {
    var hover = global.TerritoryEvolutionHover;
    if (hover && typeof hover.refreshOpenPanel === 'function') {
      return !!hover.refreshOpenPanel();
    }
    return false;
  }

  function backupMock() {
    var src = global.TERRITORY_POPULATION_MOCK_SOURCE || {};
    return {
      pioneer: src.pioneer,
      guardian: src.guardian,
      central: src.central,
      alien: src.alien,
    };
  }

  function restoreMock(snapshot) {
    if (typeof global.resetTerritoryPopulationMockSource === 'function' && !snapshot) {
      global.resetTerritoryPopulationMockSource();
    } else if (typeof global.setTerritoryPopulationMockValues === 'function') {
      global.setTerritoryPopulationMockValues(snapshot || global.TERRITORY_POPULATION_MOCK_DEFAULTS);
    }
    refreshHover();
  }

  function applyMockAndRefresh(partial) {
    var result = global.setTerritoryPopulationMockValues(partial);
    refreshHover();
    return result;
  }

  function __scSetTerritoryPopulation(territoryKey, population) {
    if (typeof global.setTerritoryPopulationMockValue !== 'function') {
      return { ok: false, error: 'mock-api-missing' };
    }
    var setResult = global.setTerritoryPopulationMockValue(territoryKey, population);
    if (!setResult.ok) return setResult;
    refreshHover();
    var evolutionState = getState(territoryKey);
    return {
      ok: true,
      territoryKey: territoryKey,
      directPopulation: setResult.directPopulation,
      evolutionState: {
        population: evolutionState.population,
        stage: evolutionState.stage,
        stageLabel: evolutionState.stageLabel,
        remainingPopulation: evolutionState.remainingPopulation,
        hasNextStage: evolutionState.hasNextStage,
        nextStageLabel: evolutionState.nextStageLabel,
      },
      panelRefreshed: !!global.TerritoryEvolutionHover &&
        global.TerritoryEvolutionHover.getActiveTerritoryKey() === territoryKey,
    };
  }

  function __scSetTerritoryPopulations(partial) {
    var result = applyMockAndRefresh(partial || {});
    return {
      ok: true,
      directCounts: result.directCounts,
      territories: {
        pioneer: getState('pioneer'),
        guardian: getState('guardian'),
        central: getState('central'),
        alien: getState('alien'),
      },
    };
  }

  function __scResetTerritoryPopulations() {
    if (typeof global.resetTerritoryPopulationMockSource === 'function') {
      global.resetTerritoryPopulationMockSource();
    }
    refreshHover();
    return __scGetTerritoryEvolutionDebugState();
  }

  function __scGetTerritoryEvolutionDebugState() {
    var directCounts =
      typeof global.getTerritoryEvolutionDirectCounts === 'function'
        ? global.getTerritoryEvolutionDirectCounts()
        : backupMock();
    return {
      directCounts: directCounts,
      usingMock:
        typeof global.isTerritoryEvolutionUsingMockSource === 'function'
          ? global.isTerritoryEvolutionUsingMockSource()
          : true,
      activeTerritoryKey:
        global.TerritoryEvolutionHover &&
        typeof global.TerritoryEvolutionHover.getActiveTerritoryKey === 'function'
          ? global.TerritoryEvolutionHover.getActiveTerritoryKey()
          : null,
      territories: {
        pioneer: getState('pioneer'),
        guardian: getState('guardian'),
        central: getState('central'),
        alien: getState('alien'),
      },
    };
  }

  function makeResult(name, input, expected, actual, passed, extra) {
    var row = {
      name: name,
      input: input,
      expected: expected,
      actual: actual,
      passed: !!passed,
    };
    if (extra) {
      var k;
      for (k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) row[k] = extra[k];
      }
    }
    return row;
  }

  function __scRunTerritoryEvolutionBoundaryTests() {
    var cases = [
      { input: 0, expectedStage: 1 },
      { input: 100, expectedStage: 1 },
      { input: 101, expectedStage: 2 },
      { input: 300, expectedStage: 2 },
      { input: 301, expectedStage: 3 },
      { input: 1000, expectedStage: 3 },
      { input: 1001, expectedStage: 4 },
      { input: 2000, expectedStage: 4 },
      { input: 2001, expectedStage: 5 },
      { input: 8000, expectedStage: 5 },
      { input: 8001, expectedStage: 6 },
      { input: -10, expectedStage: 1, expectedNormalized: 0 },
      { input: 'abc', expectedStage: 1, expectedNormalized: 0 },
      { input: null, expectedStage: 1, expectedNormalized: 0 },
      { input: undefined, expectedStage: 1, expectedNormalized: 0 },
      { input: 300.9, expectedStage: 2, expectedNormalized: 300 },
      { input: Infinity, expectedStage: 1, expectedNormalized: 0 },
    ];

    var results = [];
    var i;
    for (i = 0; i < cases.length; i++) {
      var c = cases[i];
      var normalizedPopulation = normalize(c.input);
      var actualStage = stageByPop(c.input);
      var expectedNormalized =
        c.expectedNormalized != null ? c.expectedNormalized : normalize(c.input);
      var passed =
        actualStage === c.expectedStage && normalizedPopulation === expectedNormalized;
      results.push(
        makeResult(
          'boundary',
          c.input,
          { stage: c.expectedStage, normalized: expectedNormalized },
          { stage: actualStage, normalized: normalizedPopulation },
          passed,
          {
            normalizedPopulation: normalizedPopulation,
            expectedStage: c.expectedStage,
            actualStage: actualStage,
          }
        )
      );
    }

    var passedCount = results.filter(function (r) {
      return r.passed;
    }).length;
    return {
      passed: passedCount === results.length,
      total: results.length,
      passedCount: passedCount,
      failedCount: results.length - passedCount,
      results: results,
    };
  }

  function __scRunTerritoryEvolutionNextStageTests() {
    var cases = [
      { pop: 100, remain: 1, nextMin: 101, hasNext: true },
      { pop: 101, remain: 200, nextMin: 301, hasNext: true },
      { pop: 300, remain: 1, nextMin: 301, hasNext: true },
      { pop: 301, remain: 700, nextMin: 1001, hasNext: true },
      { pop: 1000, remain: 1, nextMin: 1001, hasNext: true },
      { pop: 1001, remain: 1000, nextMin: 2001, hasNext: true },
      { pop: 2000, remain: 1, nextMin: 2001, hasNext: true },
      { pop: 2001, remain: 6000, nextMin: 8001, hasNext: true },
      { pop: 8000, remain: 1, nextMin: 8001, hasNext: true },
      { pop: 8001, remain: 0, nextMin: null, hasNext: false },
    ];
    var results = [];
    var i;
    for (i = 0; i < cases.length; i++) {
      var c = cases[i];
      var stage = stageByPop(c.pop);
      var next = getNext('central', c.pop, stage);
      var passed =
        next.hasNextStage === c.hasNext &&
        next.remainingPopulation === c.remain &&
        (c.hasNext
          ? next.nextStageMinPopulation === c.nextMin
          : next.nextStageMinPopulation == null);
      results.push(
        makeResult(
          'next-stage',
          c.pop,
          { remain: c.remain, hasNext: c.hasNext, nextMin: c.nextMin },
          {
            remain: next.remainingPopulation,
            hasNext: next.hasNextStage,
            nextMin: next.nextStageMinPopulation,
          },
          passed
        )
      );
    }
    var passedCount = results.filter(function (r) {
      return r.passed;
    }).length;
    return {
      passed: passedCount === results.length,
      total: results.length,
      passedCount: passedCount,
      failedCount: results.length - passedCount,
      results: results,
    };
  }

  function __scRunTerritoryEvolutionProgressTests() {
    var cases = [
      { pop: 0, expectPct: 0, stageStart: true },
      { pop: 100, maxPct: 100 },
      { pop: 101, expectPct: 0 },
      { pop: 300, maxPct: 100 },
      { pop: 301, expectPct: 0 },
      { pop: 820, approxPct: 74.14, tol: 0.05 },
      { pop: 1001, expectPct: 0 },
      { pop: 2001, expectPct: 0 },
      { pop: 8001, complete: true },
    ];
    var results = [];
    var i;
    for (i = 0; i < cases.length; i++) {
      var c = cases[i];
      var stage = stageByPop(c.pop);
      var next = getNext('pioneer', c.pop, stage);
      var pct = next.progressPercent;
      var passed = true;
      var expected = {};
      var actual = { progressPercent: pct, hasNextStage: next.hasNextStage };

      if (c.complete) {
        expected = { hasNextStage: false, progressPercent: 100 };
        passed = !next.hasNextStage && pct === 100;
      } else if (c.expectPct != null) {
        expected = { progressPercent: c.expectPct };
        passed = Math.abs(pct - c.expectPct) < 0.0001 && pct >= 0 && pct <= 100;
      } else if (c.approxPct != null) {
        expected = { progressPercentApprox: c.approxPct };
        passed = Math.abs(pct - c.approxPct) <= (c.tol || 0.1) && pct >= 0 && pct <= 100;
      } else if (c.maxPct != null) {
        expected = { maxPct: c.maxPct };
        passed = pct >= 0 && pct <= c.maxPct;
      }
      results.push(makeResult('progress', c.pop, expected, actual, passed));
    }
    var passedCount = results.filter(function (r) {
      return r.passed;
    }).length;
    return {
      passed: passedCount === results.length,
      total: results.length,
      passedCount: passedCount,
      failedCount: results.length - passedCount,
      results: results,
    };
  }

  function __scRunTerritoryEvolutionRiseAndFallTests() {
    var sequence = [
      { pop: 100, stage: 1 },
      { pop: 101, stage: 2 },
      { pop: 301, stage: 3 },
      { pop: 1001, stage: 4 },
      { pop: 2001, stage: 5 },
      { pop: 8001, stage: 6 },
      { pop: 8000, stage: 5 },
      { pop: 2000, stage: 4 },
      { pop: 1000, stage: 3 },
      { pop: 300, stage: 2 },
      { pop: 100, stage: 1 },
    ];
    var results = [];
    var i;
    for (i = 0; i < sequence.length; i++) {
      var step = sequence[i];
      __scSetTerritoryPopulation('pioneer', step.pop);
      var state = getState('pioneer');
      var passed = state.stage === step.stage && state.population === step.pop;
      if (step.stage < 6) {
        passed = passed && state.hasNextStage === true;
      } else {
        passed = passed && state.hasNextStage === false;
      }
      results.push(
        makeResult(
          'rise-fall',
          step.pop,
          { stage: step.stage },
          { stage: state.stage, label: state.stageLabel, remaining: state.remainingPopulation },
          passed
        )
      );
    }
    var passedCount = results.filter(function (r) {
      return r.passed;
    }).length;
    return {
      passed: passedCount === results.length,
      total: results.length,
      passedCount: passedCount,
      failedCount: results.length - passedCount,
      results: results,
    };
  }

  function __scRunTerritoryEvolutionAlienLabelTests() {
    var sequence = [
      { pop: 0, label: '문명탄생', next: '문명형성', hasNext: true },
      { pop: 101, label: '문명형성', next: '문명발전', hasNext: true },
      { pop: 301, label: '문명발전', next: '문명확장', hasNext: true },
      { pop: 1001, label: '문명확장', next: '문명번영', hasNext: true },
      { pop: 2001, label: '문명번영', next: '문명포화', hasNext: true },
      { pop: 8001, label: '문명포화', next: '', hasNext: false },
    ];
    var forbidden = ['원시', '고대', '중세', '근대', '현대', '미래'];
    var results = [];
    var i;
    for (i = 0; i < sequence.length; i++) {
      var step = sequence[i];
      __scSetTerritoryPopulation('alien', step.pop);
      var state = getState('alien');
      var usesCommon = forbidden.indexOf(state.stageLabel) !== -1;
      var nextOk = step.hasNext
        ? state.nextStageLabel === step.next
        : state.hasNextStage === false;
      var passed = state.stageLabel === step.label && nextOk && !usesCommon;
      results.push(
        makeResult(
          'alien-label',
          step.pop,
          { label: step.label, next: step.next },
          { label: state.stageLabel, next: state.nextStageLabel },
          passed
        )
      );
    }
    var passedCount = results.filter(function (r) {
      return r.passed;
    }).length;
    return {
      passed: passedCount === results.length,
      total: results.length,
      passedCount: passedCount,
      failedCount: results.length - passedCount,
      results: results,
    };
  }

  function __scRunTerritoryEvolutionCentralWeightTests() {
    var cases = [
      {
        name: 'case-A',
        source: { pioneer: 820, guardian: 2480, central: 3830, alien: 310 },
        expected: { pioneer: 820, guardian: 2480, central: 4820, alien: 310 },
      },
      {
        name: 'case-B',
        source: { pioneer: 100, guardian: 100, central: 100, alien: 8001 },
        expected: { pioneer: 100, guardian: 100, central: 160, alien: 8001 },
      },
      {
        name: 'case-C',
        source: { pioneer: 3, guardian: 3, central: 0, alien: 0 },
        expected: { pioneer: 3, guardian: 3, central: 0, alien: 0 },
      },
      {
        name: 'case-D',
        source: { pioneer: 4, guardian: 4, central: 0, alien: 0 },
        expected: { pioneer: 4, guardian: 4, central: 2, alien: 0 },
      },
    ];
    var results = [];
    var i;
    for (i = 0; i < cases.length; i++) {
      var c = cases[i];
      var actual = {
        pioneer: evoPop('pioneer', c.source),
        guardian: evoPop('guardian', c.source),
        central: evoPop('central', c.source),
        alien: evoPop('alien', c.source),
      };
      var passed =
        actual.pioneer === c.expected.pioneer &&
        actual.guardian === c.expected.guardian &&
        actual.central === c.expected.central &&
        actual.alien === c.expected.alien;
      results.push(makeResult('central-weight', c.name, c.expected, actual, passed));
    }
    var passedCount = results.filter(function (r) {
      return r.passed;
    }).length;
    return {
      passed: passedCount === results.length,
      total: results.length,
      passedCount: passedCount,
      failedCount: results.length - passedCount,
      results: results,
    };
  }

  function __scRunTerritoryEvolutionAlienMoveTests() {
    var results = [];

    var beforeA = { pioneer: 1001, guardian: 1000, central: 0, alien: 0 };
    var afterA = { pioneer: 1000, guardian: 1000, central: 0, alien: 1 };
    var beforeState = {
      pioneerPop: evoPop('pioneer', beforeA),
      pioneerStage: stageByPop(evoPop('pioneer', beforeA)),
      centralPop: evoPop('central', beforeA),
    };
    var afterState = {
      pioneerPop: evoPop('pioneer', afterA),
      pioneerStage: stageByPop(evoPop('pioneer', afterA)),
      alienPop: evoPop('alien', afterA),
      alienStage: stageByPop(evoPop('alien', afterA)),
      alienLabel: getState('alien', afterA).stageLabel,
      centralPop: evoPop('central', afterA),
    };
    var passedA =
      beforeState.pioneerPop === 1001 &&
      beforeState.pioneerStage === 4 &&
      beforeState.centralPop === 600 &&
      afterState.pioneerPop === 1000 &&
      afterState.pioneerStage === 3 &&
      afterState.alienPop === 1 &&
      afterState.alienStage === 1 &&
      afterState.alienLabel === '문명탄생' &&
      afterState.centralPop === 600;
    results.push(
      makeResult(
        'alien-move-A',
        { before: beforeA, after: afterA },
        { pioneerStage: 3, central: 600, alienLabel: '문명탄생' },
        afterState,
        passedA
      )
    );

    var beforeB = { pioneer: 1000, guardian: 0, central: 0, alien: 0 };
    var afterB = { pioneer: 999, guardian: 0, central: 0, alien: 1 };
    var centralBefore = evoPop('central', beforeB);
    var centralAfter = evoPop('central', afterB);
    var passedB = centralBefore === 300 && centralAfter === 299;
    results.push(
      makeResult(
        'alien-move-B',
        { before: beforeB, after: afterB },
        { centralBefore: 300, centralAfter: 299 },
        { centralBefore: centralBefore, centralAfter: centralAfter },
        passedB
      )
    );

    var passedCount = results.filter(function (r) {
      return r.passed;
    }).length;
    return {
      passed: passedCount === results.length,
      total: results.length,
      passedCount: passedCount,
      failedCount: results.length - passedCount,
      results: results,
    };
  }

  function collectFailures(sections) {
    var failures = [];
    var name;
    for (name in sections) {
      if (!Object.prototype.hasOwnProperty.call(sections, name)) continue;
      var section = sections[name];
      if (!section || !section.results) continue;
      var i;
      for (i = 0; i < section.results.length; i++) {
        var row = section.results[i];
        if (!row.passed) {
          failures.push({
            section: name,
            name: row.name,
            input: row.input,
            expected: row.expected,
            actual: row.actual,
          });
        }
      }
    }
    return failures;
  }

  function __scRunTerritoryEvolutionSimulation() {
    var backup = backupMock();
    var sections = {};
    var summary = {};
    var passed = true;

    console.groupCollapsed(LOG_PREFIX + ' 영토 발전 Mock 시뮬레이션');
    try {
      sections.boundary = __scRunTerritoryEvolutionBoundaryTests();
      summary.boundary = sections.boundary.passed;
      console.info(
        LOG_PREFIX +
          ' 경계값 ' +
          sections.boundary.passedCount +
          '/' +
          sections.boundary.total +
          (sections.boundary.passed ? ' 통과' : ' 실패')
      );

      sections.nextStage = __scRunTerritoryEvolutionNextStageTests();
      summary.nextStage = sections.nextStage.passed;

      sections.progress = __scRunTerritoryEvolutionProgressTests();
      summary.progress = sections.progress.passed;

      sections.riseAndFall = __scRunTerritoryEvolutionRiseAndFallTests();
      summary.riseAndFall = sections.riseAndFall.passed;
      console.info(
        LOG_PREFIX +
          ' 단계 상승·하락 ' +
          (sections.riseAndFall.passed ? '통과' : '실패')
      );

      sections.alienLabels = __scRunTerritoryEvolutionAlienLabelTests();
      summary.alienLabels = sections.alienLabels.passed;

      sections.centralWeight = __scRunTerritoryEvolutionCentralWeightTests();
      summary.centralWeight = sections.centralWeight.passed;
      console.info(
        LOG_PREFIX +
          ' 중앙광장 가중치 ' +
          (sections.centralWeight.passed ? '통과' : '실패')
      );

      sections.alienMoveScenario = __scRunTerritoryEvolutionAlienMoveTests();
      summary.alienMoveScenario = sections.alienMoveScenario.passed;

      var key;
      for (key in summary) {
        if (Object.prototype.hasOwnProperty.call(summary, key) && !summary[key]) {
          passed = false;
        }
      }

      var failures = collectFailures(sections);
      if (failures.length) {
        console.error(LOG_PREFIX + ' 실패 항목', failures);
        console.table(failures);
      } else {
        console.info(LOG_PREFIX + ' 영토 발전 Mock 시뮬레이션 통과');
      }

      return {
        passed: passed,
        summary: summary,
        failures: failures,
        sections: sections,
      };
    } catch (err) {
      console.error(LOG_PREFIX + ' 시뮬레이션 예외', err);
      return {
        passed: false,
        summary: summary,
        failures: [{ section: 'exception', error: String(err && err.message ? err.message : err) }],
        error: String(err && err.message ? err.message : err),
      };
    } finally {
      restoreMock(backup);
      console.info(LOG_PREFIX + ' Mock 상태 복구 완료', backupMock());
      console.groupEnd();
    }
  }

  global.__scSetTerritoryPopulation = __scSetTerritoryPopulation;
  global.__scSetTerritoryPopulations = __scSetTerritoryPopulations;
  global.__scResetTerritoryPopulations = __scResetTerritoryPopulations;
  global.__scGetTerritoryEvolutionDebugState = __scGetTerritoryEvolutionDebugState;
  global.__scRunTerritoryEvolutionBoundaryTests = __scRunTerritoryEvolutionBoundaryTests;
  global.__scRunTerritoryEvolutionNextStageTests = __scRunTerritoryEvolutionNextStageTests;
  global.__scRunTerritoryEvolutionProgressTests = __scRunTerritoryEvolutionProgressTests;
  global.__scRunTerritoryEvolutionRiseAndFallTests = __scRunTerritoryEvolutionRiseAndFallTests;
  global.__scRunTerritoryEvolutionAlienLabelTests = __scRunTerritoryEvolutionAlienLabelTests;
  global.__scRunTerritoryEvolutionCentralWeightTests = __scRunTerritoryEvolutionCentralWeightTests;
  global.__scRunTerritoryEvolutionAlienMoveTests = __scRunTerritoryEvolutionAlienMoveTests;
  global.__scRunTerritoryEvolutionSimulation = __scRunTerritoryEvolutionSimulation;
})(typeof window !== 'undefined' ? window : globalThis);
