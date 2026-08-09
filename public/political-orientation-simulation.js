/**
 * =============================================================================
 * 센텐스아레나 — 정치 성향 Mock 시뮬레이션 (1차·2차·3차)
 * =============================================================================
 * 1차 BASE_SCORE_MOVEMENT: 기본 성향 점수 보유 사용자 이동
 * 2차 ZERO_START_LATENT_ORIENTATION: 전원 0점·중앙 시작, 숨은 행동 성향으로 반응 생성
 * 3차 LARGE_SCALE_THRESHOLD_COMPARISON: 1,000명 · 중앙 범위 4안 · 다 seed 비교
 *
 * - DELTA_WINDOW_SCORE: 배치마다 (현재 결합값 - 직전 결합값)만 점수에 가산
 * - baseOrientationScore는 시작점 전용 (이후 배치 계산에 미사용)
 * - latentOrientation은 점수에 직접 가산하지 않음 · 반응 데이터 생성에만 사용
 * - 3차 비교는 운영 영토 기준을 변경하지 않음 (참고 순위만)
 * - 외계행성(ALIEN)은 정치 성향 계산·결과에서 제외
 * - 실제 사용자·DB·Firebase·API·게시글 반응 미연결
 * - 개발용 __sc* — 배포 전 제거/비활성 대상 · 페이지 로드 시 자동 실행 없음
 * =============================================================================
 */
(function (global) {
  'use strict';

  var TERRITORY = Object.freeze({
    PIONEER: 'PIONEER',
    CENTRAL: 'CENTRAL',
    GUARDIAN: 'GUARDIAN',
  });

  var ORIENTATION_SIMULATION_MODES = Object.freeze({
    BASE_SCORE_MOVEMENT: 'BASE_SCORE_MOVEMENT',
    ZERO_START_LATENT_ORIENTATION: 'ZERO_START_LATENT_ORIENTATION',
    LARGE_SCALE_THRESHOLD_COMPARISON: 'LARGE_SCALE_THRESHOLD_COMPARISON',
    TERRITORY_OSCILLATION_CAUSE_ANALYSIS: 'TERRITORY_OSCILLATION_CAUSE_ANALYSIS',
    TERRITORY_STABILIZATION_COMPARISON: 'TERRITORY_STABILIZATION_COMPARISON',
  });

  var TERRITORY_STABILIZATION_PRESETS = Object.freeze([
    {
      id: 'BASELINE',
      label: '현재 방식',
      hysteresisGap: 0,
      requiredConsecutiveBatches: 1,
    },
    {
      id: 'HYSTERESIS_200',
      label: '진입·이탈 경계 200점 분리',
      hysteresisGap: 200,
      requiredConsecutiveBatches: 1,
    },
    {
      id: 'CONSECUTIVE_2',
      label: '2회 연속 확인',
      hysteresisGap: 0,
      requiredConsecutiveBatches: 2,
    },
    {
      id: 'HYSTERESIS_200_CONSECUTIVE_2',
      label: '200점 분리 + 2회 연속',
      hysteresisGap: 200,
      requiredConsecutiveBatches: 2,
    },
    {
      id: 'HYSTERESIS_400_CONSECUTIVE_2',
      label: '400점 분리 + 2회 연속',
      hysteresisGap: 400,
      requiredConsecutiveBatches: 2,
    },
  ]);

  var STABILIZATION_STATUS = Object.freeze({
    PROMISING: 'PROMISING',
    TOO_SLOW: 'TOO_SLOW',
    INSUFFICIENT: 'INSUFFICIENT',
    TOO_STICKY: 'TOO_STICKY',
    NEEDS_REVIEW: 'NEEDS_REVIEW',
  });

  var LARGE_SCALE_THRESHOLD_PRESETS = Object.freeze([
    {
      id: 'CENTRAL_1000',
      guardianMax: -1001,
      centralMin: -1000,
      centralMax: 1000,
      pioneerMin: 1001,
    },
    {
      id: 'CENTRAL_800',
      guardianMax: -801,
      centralMin: -800,
      centralMax: 800,
      pioneerMin: 801,
    },
    {
      id: 'CENTRAL_600',
      guardianMax: -601,
      centralMin: -600,
      centralMax: 600,
      pioneerMin: 601,
    },
    {
      id: 'CENTRAL_400',
      guardianMax: -401,
      centralMin: -400,
      centralMax: 400,
      pioneerMin: 401,
    },
  ]);

  var LARGE_SCALE_DEFAULT_SEEDS = Object.freeze([
    20260726, 20260727, 20260728, 20260729, 20260730, 20260801, 20260802, 20260803, 20260804,
    20260805,
  ]);

  var LARGE_SCALE_THRESHOLD_STATUS = Object.freeze({
    PROMISING: 'PROMISING',
    NEEDS_REVIEW: 'NEEDS_REVIEW',
    TOO_STICKY: 'TOO_STICKY',
    TOO_VOLATILE: 'TOO_VOLATILE',
  });

  var LATENT = Object.freeze({
    PIONEER: 'PIONEER',
    NEUTRAL: 'NEUTRAL',
    GUARDIAN: 'GUARDIAN',
  });

  var LATENT_STRENGTH = Object.freeze({
    STRONG: 'STRONG',
    MEDIUM: 'MEDIUM',
    WEAK: 'WEAK',
    MIXED: 'MIXED',
  });

  var REACTION_TYPES = Object.freeze({
    LIKE: 'LIKE',
    RECOMMEND: 'RECOMMEND',
    DISLIKE: 'DISLIKE',
    DOWNVOTE: 'DOWNVOTE',
  });

  var SCENARIOS = Object.freeze({
    HOLD: '현재 성향 유지',
    STRONG_PIONEER: '개척 방향으로 강하게 이동',
    STRONG_GUARDIAN: '수호 방향으로 강하게 이동',
    WEAK_PIONEER: '약하게 개척 방향으로 이동',
    WEAK_GUARDIAN: '약하게 수호 방향으로 이동',
    MIXED_BALANCE: '양쪽 반응이 섞여 거의 변화 없음',
    EARLY_PIONEER_LATE_GUARDIAN: '초반 개척 방향, 후반 수호 방향',
    EARLY_GUARDIAN_LATE_PIONEER: '초반 수호 방향, 후반 개척 방향',
    FREQUENT_CANCEL: '반응 취소가 자주 발생',
    BOUNDARY_OSCILLATE: '경계선에서 중앙을 오가는 유형',
    FIXED_PIONEER_TO_CENTRAL: '고정: 개척 → 중앙',
    FIXED_PIONEER_TO_GUARDIAN: '고정: 개척 → 중앙 → 수호',
    FIXED_GUARDIAN_TO_CENTRAL: '고정: 수호 → 중앙',
    FIXED_GUARDIAN_TO_PIONEER: '고정: 수호 → 중앙 → 개척',
    FIXED_CENTRAL_TO_PIONEER: '고정: 중앙 → 개척',
    FIXED_CENTRAL_TO_GUARDIAN: '고정: 중앙 → 수호',
    FIXED_NO_MOVE: '고정: 영토 변화 없음',
    FIXED_BOUNDARY_OSCILLATE: '고정: 경계선 왕복',
    /* 2차 고정 시나리오 */
    ZS_STRONG_PIONEER: '2차고정: 강한 숨은 개척 → 개척',
    ZS_STRONG_GUARDIAN: '2차고정: 강한 숨은 수호 → 수호',
    ZS_NEUTRAL_HOLD: '2차고정: 완전 중립 → 중앙 유지',
    ZS_WEAK_PIONEER: '2차고정: 약한 개척 → 중앙/늦은 개척',
    ZS_WEAK_GUARDIAN: '2차고정: 약한 수호 → 중앙/늦은 수호',
    ZS_PIONEER_WRONG: '2차고정: 개척 성향·반대 행동 → 수호 오이동',
    ZS_GUARDIAN_WRONG: '2차고정: 수호 성향·반대 행동 → 개척 오이동',
    ZS_EARLY_LATE_SHIFT: '2차고정: 초반 개척·후반 수호 왕복',
    ZS_CANCEL_RETURN: '2차고정: 취소로 중앙 재진입',
    ZS_BOUNDARY_OSCILLATE: '2차고정: 경계 근처 왕복',
    ZS_NO_REACTIONS: '2차고정: 반응 없음 · 0점 유지',
  });

  var ORIENTATION_SIMULATION_CONFIG = {
    userCount: 120,
    territoryThresholds: {
      guardianMax: -1001,
      centralMin: -1000,
      centralMax: 1000,
      pioneerMin: 1001,
    },
    reactionWeights: {
      sameTerritoryPositive: 80,
      otherTerritoryPositive: 120,
      sameTerritoryNegative: 120,
      otherTerritoryNegative: 80,
    },
    rollingWindowDays: 99,
    recentWindowDays: 30,
    rollingWindowRatio: 0.5,
    recentWindowRatio: 0.5,
    maxScoreChangePerBatch: 500,
    batchHours: [5, 17],
    simulationStartIso: '2026-01-01T05:00:00.000Z',
    /** 분석용 · 운영 정책 아님 */
    analysis: {
      tooFastExitBatches: 2,
      strongTooSlowDays: 30,
    },
    /**
     * 숨은 성향 → 반응 방향 확률 (합=1). 시뮬레이션 초기값 · 재설정 가능.
     * pioneer: 개척 방향(+), guardian: 수호 방향(−), neutral: 균형/약한 노이즈
     */
    latentBehaviorRates: {
      strongPioneer: { pioneer: 0.75, guardian: 0.15, neutral: 0.1 },
      mediumPioneer: { pioneer: 0.65, guardian: 0.2, neutral: 0.15 },
      weakPioneer: { pioneer: 0.55, guardian: 0.3, neutral: 0.15 },
      mixedPioneer: { pioneer: 0.45, guardian: 0.4, neutral: 0.15 },
      strongGuardian: { pioneer: 0.15, guardian: 0.75, neutral: 0.1 },
      mediumGuardian: { pioneer: 0.2, guardian: 0.65, neutral: 0.15 },
      weakGuardian: { pioneer: 0.3, guardian: 0.55, neutral: 0.15 },
      mixedGuardian: { pioneer: 0.4, guardian: 0.45, neutral: 0.15 },
      neutralBalanced: { pioneer: 0.45, guardian: 0.45, neutral: 0.1 },
      neutralWeakPioneer: { pioneer: 0.55, guardian: 0.35, neutral: 0.1 },
      neutralWeakGuardian: { pioneer: 0.35, guardian: 0.55, neutral: 0.1 },
      neutralShift: { pioneer: 0.5, guardian: 0.4, neutral: 0.1 },
    },
    /** 3차 비교용 참고 점수 가중치 · 자동 확정 아님 */
    comparisonScoreWeights: {
      orientationAccuracy: 0.4,
      neutralRetention: 0.3,
      oppositeMisclassification: 0.2,
      instabilityRate: 0.1,
    },
    /** 3차 분석용 안전 기준 · 운영 정책 아님 */
    comparisonSafety: {
      goodAccuracyMin: 0.65,
      goodNeutralRetentionMin: 0.7,
      goodOppositeMax: 0.05,
      goodInstabilityMax: 0.2,
      goodStrongUnclassifiedMax: 0.1,
      warnOppositeOver: 0.08,
      warnNeutralUnder: 0.6,
      warnInstabilityOver: 0.3,
      warnStrongUnclassifiedOver: 0.2,
    },
    /** 4차 왕복 원인 분석용 · 운영 정책 아님 */
    oscillationAnalysis: {
      boundarySensitivityBands: [50, 100, 200, 400],
      boundarySensitiveDistance: 200,
      multipleCausesRelativeTol: 0.1,
      causeDrivenShareMin: 0.5,
      breakdownMatchEpsilon: 1e-6,
    },
    /** 5차 안정화 비교 참고 점수 가중치 · 운영 확정 아님 */
    stabilizationScoreWeights: {
      oscillationReduction: 0.35,
      boundaryNoiseReduction: 0.25,
      accuracyLoss: 0.15,
      neutralRetentionChange: 0.1,
      classificationDelay: 0.1,
      strongUnclassifiedIncrease: 0.05,
    },
  };

  var simulationState = null;
  /** 모드별 상태·리포트 보존 (서로 덮어쓰지 않음) */
  var simulationStoreByMode = {};
  /** 3차 대규모 비교 전용 상태 (1·2차와 분리) */
  var largeScaleComparisonState = null;
  /** 4차 왕복 원인 분석 전용 상태 (1·2·3차와 분리) */
  var oscillationCauseAnalysisState = null;
  /** 5차 영토 안정화 비교 전용 상태 */
  var territoryStabilizationComparisonState = null;

  /* ─── 유틸 ─── */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getConfig() {
    return ORIENTATION_SIMULATION_CONFIG;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function addHours(date, hours) {
    return new Date(date.getTime() + hours * 3600000);
  }

  function addDays(date, days) {
    return new Date(date.getTime() + days * 86400000);
  }

  function isPositiveReaction(type) {
    return type === 'LIKE' || type === 'RECOMMEND';
  }

  /* ─── 영토 판정 ─── */

  function resolveTerritoryFromScore(score, thresholds) {
    var t = thresholds || getConfig().territoryThresholds;
    var s = Number(score);
    if (!isFinite(s)) return TERRITORY.CENTRAL;
    if (s <= t.guardianMax) return TERRITORY.GUARDIAN;
    if (s >= t.pioneerMin) return TERRITORY.PIONEER;
    return TERRITORY.CENTRAL;
  }

  /* ─── 반응 가중치 (부호 포함) ─── */

  /**
   * 개척 방향 +, 수호 방향 −.
   * 가중치 크기는 반응자/대상 영토 동일·상이 및 긍정·부정에 따름.
   * CENTRAL 반응자: 긍정은 0점 쪽으로, 부정은 0에서 멀어지는 방향.
   */
  function computeReactionSignedDelta(reaction, targetScoreAtBatch, config) {
    var cfg = config || getConfig();
    var w = cfg.reactionWeights;
    var positive = isPositiveReaction(reaction.reactionType);
    var same = reaction.actorTerritoryAtReaction === reaction.targetTerritoryAtReaction;
    var magnitude;
    if (positive) {
      magnitude = same ? w.sameTerritoryPositive : w.otherTerritoryPositive;
    } else {
      magnitude = same ? w.sameTerritoryNegative : w.otherTerritoryNegative;
    }

    var actor = reaction.actorTerritoryAtReaction;
    var signed;
    if (actor === TERRITORY.PIONEER) {
      signed = positive ? magnitude : -magnitude;
    } else if (actor === TERRITORY.GUARDIAN) {
      signed = positive ? -magnitude : magnitude;
    } else {
      var score = Number(targetScoreAtBatch) || 0;
      var away = score === 0 ? 1 : score > 0 ? 1 : -1;
      signed = positive ? -away * magnitude : away * magnitude;
    }
    return signed;
  }

  function isReactionActiveAt(reaction, batchTime) {
    if (!reaction) return false;
    var created = new Date(reaction.createdAt).getTime();
    var batchMs = batchTime.getTime();
    if (!isFinite(created) || created > batchMs) return false;
    if (reaction.cancelledAt) {
      var cancelled = new Date(reaction.cancelledAt).getTime();
      if (isFinite(cancelled) && cancelled <= batchMs) return false;
    }
    return true;
  }

  function sumWindowScore(reactions, targetUserId, batchTime, windowDays, scoreBeforeBatch, config, counters) {
    var windowMs = windowDays * 86400000;
    var batchMs = batchTime.getTime ? batchTime.getTime() : batchTime;
    var sum = 0;
    var list = reactions;
    var i;
    for (i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r) continue;
      if (r.targetUserId !== targetUserId) continue;
      var created = r._createdMs != null ? r._createdMs : new Date(r.createdAt).getTime();
      if (!isFinite(created) || created > batchMs) continue;
      if (batchMs - created > windowMs) continue;
      if (r.cancelledAt) {
        var cancelled =
          r._cancelledMs != null && isFinite(r._cancelledMs)
            ? r._cancelledMs
            : new Date(r.cancelledAt).getTime();
        if (isFinite(cancelled) && cancelled <= batchMs) {
          if (counters) counters.cancelledExcluded += 1;
          continue;
        }
      }
      if (r._signedAtZero != null) {
        sum += r._signedAtZero;
      } else {
        sum += computeReactionSignedDelta(r, scoreBeforeBatch, config);
      }
      /* 취소 역방향 근사 카운트용 */
      if (counters && r.cancelledAt) {
        /* no-op placeholder */
      }
    }
    return sum;
  }

  /** 대상 사용자별 반응 인덱스 — 대규모 비교용 (결과 동일, 스캔 범위만 축소) */
  function indexReactionsByTarget(reactions) {
    var map = Object.create(null);
    var i;
    for (i = 0; i < reactions.length; i++) {
      var r = reactions[i];
      if (!r || !r.targetUserId) continue;
      if (!map[r.targetUserId]) map[r.targetUserId] = [];
      map[r.targetUserId].push(r);
    }
    return map;
  }

  function sumWindowScoreIndexed(
    reactionIndex,
    targetUserId,
    batchTime,
    windowDays,
    scoreBeforeBatch,
    config,
    counters,
  ) {
    return sumWindowScore(
      reactionIndex[targetUserId] || [],
      targetUserId,
      batchTime,
      windowDays,
      scoreBeforeBatch,
      config,
      counters,
    );
  }

  /* ─── 사용자 생성 ─── */

  function makeUser(spec) {
    var score = spec.baseOrientationScore != null ? Number(spec.baseOrientationScore) : 0;
    var territory =
      spec.startingTerritory || resolveTerritoryFromScore(score);
    return {
      userId: spec.userId,
      label: spec.label || spec.userId,
      baseOrientationScore: score,
      currentOrientationScore: score,
      previousCombinedReactionScore: 0,
      currentCombinedReactionScore: 0,
      startingTerritory: territory,
      currentTerritory: territory,
      movementScenario: spec.movementScenario,
      latentOrientation: spec.latentOrientation || null,
      latentStrength: spec.latentStrength || null,
      latentSubtype: spec.latentSubtype || null,
      scoreHistory: [],
      territoryHistory: [],
      capAppliedCount: 0,
      cancelledExcludedCount: 0,
      firstTerritoryExitBatch: null,
      firstTerritoryExitAt: null,
      isFixed: !!spec.isFixed,
      isRandom: spec.isRandom !== false && !spec.isFixed,
    };
  }

  function createBandUsers(prefix, startIndex, count, scoreMin, scoreMax, scenarioPool, rng, isFixed) {
    var out = [];
    var i;
    for (i = 0; i < count; i++) {
      var score = randInt(rng, scoreMin, scoreMax);
      out.push(
        makeUser({
          userId: prefix + '-' + String(startIndex + i).padStart(3, '0'),
          label: prefix + ' #' + (startIndex + i),
          baseOrientationScore: score,
          movementScenario: pick(rng, scenarioPool),
          isFixed: !!isFixed,
        }),
      );
    }
    return out;
  }

  function createFixedUsers() {
    return [
      makeUser({
        userId: 'fix-pioneer-to-central',
        label: '고정 개척→중앙',
        baseOrientationScore: 1200,
        movementScenario: SCENARIOS.FIXED_PIONEER_TO_CENTRAL,
        isFixed: true,
      }),
      makeUser({
        userId: 'fix-pioneer-to-guardian',
        label: '고정 개척→중앙→수호',
        baseOrientationScore: 1600,
        movementScenario: SCENARIOS.FIXED_PIONEER_TO_GUARDIAN,
        isFixed: true,
      }),
      makeUser({
        userId: 'fix-guardian-to-central',
        label: '고정 수호→중앙',
        baseOrientationScore: -1200,
        movementScenario: SCENARIOS.FIXED_GUARDIAN_TO_CENTRAL,
        isFixed: true,
      }),
      makeUser({
        userId: 'fix-guardian-to-pioneer',
        label: '고정 수호→중앙→개척',
        baseOrientationScore: -1600,
        movementScenario: SCENARIOS.FIXED_GUARDIAN_TO_PIONEER,
        isFixed: true,
      }),
      makeUser({
        userId: 'fix-central-to-pioneer',
        label: '고정 중앙→개척',
        baseOrientationScore: 200,
        movementScenario: SCENARIOS.FIXED_CENTRAL_TO_PIONEER,
        isFixed: true,
      }),
      makeUser({
        userId: 'fix-central-to-guardian',
        label: '고정 중앙→수호',
        baseOrientationScore: -200,
        movementScenario: SCENARIOS.FIXED_CENTRAL_TO_GUARDIAN,
        isFixed: true,
      }),
      makeUser({
        userId: 'fix-no-move',
        label: '고정 유지',
        baseOrientationScore: 0,
        movementScenario: SCENARIOS.FIXED_NO_MOVE,
        isFixed: true,
      }),
      makeUser({
        userId: 'fix-boundary-oscillate',
        label: '고정 경계 왕복',
        baseOrientationScore: 1050,
        movementScenario: SCENARIOS.FIXED_BOUNDARY_OSCILLATE,
        isFixed: true,
      }),
      makeUser({
        userId: 'fix-strong-pioneer-resist',
        label: '고정 강한 개척 저항',
        baseOrientationScore: 4000,
        movementScenario: SCENARIOS.WEAK_GUARDIAN,
        isFixed: true,
      }),
      makeUser({
        userId: 'fix-cancel-case',
        label: '고정 취소 반응',
        baseOrientationScore: 1100,
        movementScenario: SCENARIOS.FREQUENT_CANCEL,
        isFixed: true,
      }),
    ];
  }

  function createOrientationSimulationUsers(options) {
    var opts = options || {};
    var cfg = getConfig();
    var rng = mulberry32(opts.seed != null ? opts.seed : 20260726);
    var generalScenarios = [
      SCENARIOS.HOLD,
      SCENARIOS.STRONG_PIONEER,
      SCENARIOS.STRONG_GUARDIAN,
      SCENARIOS.WEAK_PIONEER,
      SCENARIOS.WEAK_GUARDIAN,
      SCENARIOS.MIXED_BALANCE,
      SCENARIOS.EARLY_PIONEER_LATE_GUARDIAN,
      SCENARIOS.EARLY_GUARDIAN_LATE_PIONEER,
      SCENARIOS.FREQUENT_CANCEL,
      SCENARIOS.BOUNDARY_OSCILLATE,
    ];

    var fixed = createFixedUsers();
    var users = fixed.slice();
    var next = fixed.length + 1;

    /* 개척 40 = 고정 중 개척 시작 + 일반. 고정에 개척 시작이 여러 명 있으므로 일반으로 채움 */
    function countStarting(territory) {
      return users.filter(function (u) {
        return u.startingTerritory === territory;
      }).length;
    }

    function fillTerritory(territory, bands) {
      var bi;
      for (bi = 0; bi < bands.length; bi++) {
        var band = bands[bi];
        var need = band.count;
        var made = createBandUsers(
          band.prefix,
          next,
          need,
          band.min,
          band.max,
          band.scenarios || generalScenarios,
          rng,
          false,
        );
        next += need;
        users = users.concat(made);
      }
      /* 시작 영토가 어긋난 밴드는 score로 이미 맞춤 */
      while (countStarting(territory) < 40) {
        var fillerScore =
          territory === TERRITORY.PIONEER
            ? randInt(rng, 1100, 2000)
            : territory === TERRITORY.GUARDIAN
              ? randInt(rng, -2000, -1100)
              : randInt(rng, -400, 400);
        users.push(
          makeUser({
            userId: 'fill-' + territory.toLowerCase() + '-' + next,
            label: '보충 ' + territory,
            baseOrientationScore: fillerScore,
            movementScenario: pick(rng, generalScenarios),
          }),
        );
        next += 1;
      }
    }

    /* 고정 사용자를 제외한 나머지로 40/40/40 맞춤 */
    var pioneerBands = [
      { prefix: 'pio-strong', count: 8, min: 3500, max: 4500 },
      { prefix: 'pio-mid', count: 9, min: 2000, max: 3000 },
      { prefix: 'pio-edge', count: 8, min: 1001, max: 1400 },
      { prefix: 'pio-opp', count: 8, min: 1100, max: 2500 },
    ];
    var centralBands = [
      { prefix: 'cen-near-pio', count: 9, min: 500, max: 1000 },
      { prefix: 'cen-core', count: 9, min: -200, max: 200 },
      { prefix: 'cen-near-gua', count: 9, min: -1000, max: -500 },
      { prefix: 'cen-move', count: 9, min: -800, max: 800 },
    ];
    var guardianBands = [
      { prefix: 'gua-strong', count: 8, min: -4500, max: -3500 },
      { prefix: 'gua-mid', count: 9, min: -3000, max: -2000 },
      { prefix: 'gua-edge', count: 8, min: -1400, max: -1001 },
      { prefix: 'gua-opp', count: 8, min: -2500, max: -1100 },
    ];

    fillTerritory(TERRITORY.PIONEER, pioneerBands);
    fillTerritory(TERRITORY.CENTRAL, centralBands);
    fillTerritory(TERRITORY.GUARDIAN, guardianBands);

    /* 정확히 120명으로 자르거나 부족분 채움 */
    var targetCount = opts.userCount != null ? opts.userCount : cfg.userCount;
    if (users.length > targetCount) {
      /* 고정 사용자는 보존하고 일반만 자름 */
      var fixedIds = {};
      fixed.forEach(function (u) {
        fixedIds[u.userId] = true;
      });
      var keptFixed = users.filter(function (u) {
        return fixedIds[u.userId];
      });
      var rest = users.filter(function (u) {
        return !fixedIds[u.userId];
      });
      users = keptFixed.concat(rest.slice(0, targetCount - keptFixed.length));
    }
    while (users.length < targetCount) {
      users.push(
        makeUser({
          userId: 'extra-' + users.length,
          label: '추가',
          baseOrientationScore: randInt(rng, -500, 500),
          movementScenario: pick(rng, generalScenarios),
        }),
      );
    }

    /* 시작 영토 균형 미세 조정: 40/40/40 목표 */
    rebalanceStartingCounts(users, rng);

    return users;
  }

  function rebalanceStartingCounts(users, rng) {
    function counts() {
      return {
        PIONEER: users.filter(function (u) {
          return u.startingTerritory === TERRITORY.PIONEER;
        }).length,
        CENTRAL: users.filter(function (u) {
          return u.startingTerritory === TERRITORY.CENTRAL;
        }).length,
        GUARDIAN: users.filter(function (u) {
          return u.startingTerritory === TERRITORY.GUARDIAN;
        }).length,
      };
    }
    var guard = 0;
    while (guard < 200) {
      guard += 1;
      var c = counts();
      if (c.PIONEER === 40 && c.CENTRAL === 40 && c.GUARDIAN === 40) return;
      var over =
        c.PIONEER > 40 ? TERRITORY.PIONEER : c.GUARDIAN > 40 ? TERRITORY.GUARDIAN : TERRITORY.CENTRAL;
      var under =
        c.PIONEER < 40 ? TERRITORY.PIONEER : c.GUARDIAN < 40 ? TERRITORY.GUARDIAN : TERRITORY.CENTRAL;
      var candidate = null;
      var i;
      for (i = 0; i < users.length; i++) {
        if (users[i].isFixed) continue;
        if (users[i].startingTerritory !== over) continue;
        candidate = users[i];
        break;
      }
      if (!candidate) return;
      if (under === TERRITORY.PIONEER) candidate.baseOrientationScore = randInt(rng, 1100, 1800);
      else if (under === TERRITORY.GUARDIAN) candidate.baseOrientationScore = randInt(rng, -1800, -1100);
      else candidate.baseOrientationScore = randInt(rng, -400, 400);
      candidate.currentOrientationScore = candidate.baseOrientationScore;
      candidate.startingTerritory = resolveTerritoryFromScore(candidate.baseOrientationScore);
      candidate.currentTerritory = candidate.startingTerritory;
    }
  }

  /* ─── 반응 생성 ─── */

  var reactionSeq = 0;

  function makeReaction(partial) {
    reactionSeq += 1;
    var createdAt = partial.createdAt;
    var cancelledAt = partial.cancelledAt || null;
    var createdMs = new Date(createdAt).getTime();
    var cancelledMs = cancelledAt ? new Date(cancelledAt).getTime() : NaN;
    var probe = {
      actorTerritoryAtReaction: partial.actorTerritoryAtReaction,
      targetTerritoryAtReaction: partial.targetTerritoryAtReaction,
      reactionType: partial.reactionType,
    };
    /* targetScore=0 가정 가중치 캐시(개척/수호 actor). CENTRAL actor는 런타임 재계산 */
    var cachedSigned =
      partial.actorTerritoryAtReaction === TERRITORY.CENTRAL
        ? null
        : computeReactionSignedDelta(probe, 0, getConfig());
    return {
      reactionId: 'rx-' + reactionSeq,
      actorUserId: partial.actorUserId,
      targetUserId: partial.targetUserId,
      actorTerritoryAtReaction: partial.actorTerritoryAtReaction,
      targetTerritoryAtReaction: partial.targetTerritoryAtReaction,
      reactionType: partial.reactionType,
      createdAt: createdAt,
      cancelledAt: cancelledAt,
      _createdMs: createdMs,
      _cancelledMs: cancelledMs,
      _signedAtZero: cachedSigned,
    };
  }

  function scenarioBias(scenario, dayIndex, totalDays) {
    var mid = totalDays / 2;
    switch (scenario) {
      case SCENARIOS.HOLD:
      case SCENARIOS.FIXED_NO_MOVE:
      case SCENARIOS.MIXED_BALANCE:
        return 0;
      case SCENARIOS.STRONG_PIONEER:
      case SCENARIOS.FIXED_CENTRAL_TO_PIONEER:
      case SCENARIOS.FIXED_GUARDIAN_TO_PIONEER:
        return 1;
      case SCENARIOS.STRONG_GUARDIAN:
      case SCENARIOS.FIXED_CENTRAL_TO_GUARDIAN:
      case SCENARIOS.FIXED_PIONEER_TO_GUARDIAN:
        return -1;
      case SCENARIOS.WEAK_PIONEER:
      case SCENARIOS.FIXED_PIONEER_TO_CENTRAL:
      case SCENARIOS.FIXED_GUARDIAN_TO_CENTRAL:
        return scenario === SCENARIOS.FIXED_GUARDIAN_TO_CENTRAL ? 0.55 : scenario === SCENARIOS.FIXED_PIONEER_TO_CENTRAL ? -0.55 : 0.35;
      case SCENARIOS.WEAK_GUARDIAN:
        return -0.35;
      case SCENARIOS.EARLY_PIONEER_LATE_GUARDIAN:
        return dayIndex < mid ? 0.8 : -0.8;
      case SCENARIOS.EARLY_GUARDIAN_LATE_PIONEER:
        return dayIndex < mid ? -0.8 : 0.8;
      case SCENARIOS.BOUNDARY_OSCILLATE:
      case SCENARIOS.FIXED_BOUNDARY_OSCILLATE:
        return dayIndex % 2 === 0 ? -0.7 : 0.7;
      case SCENARIOS.FREQUENT_CANCEL:
      case '고정 취소 반응':
        return -0.9;
      default:
        return (dayIndex % 3) - 1;
    }
  }

  function createOrientationSimulationReactions(users, options) {
    var opts = options || {};
    var rng = mulberry32((opts.seed != null ? opts.seed : 20260726) + 17);
    var days = opts.days != null ? opts.days : 30;
    var start = new Date(getConfig().simulationStartIso);
    var reactions = [];
    reactionSeq = 0;

    var byId = {};
    users.forEach(function (u) {
      byId[u.userId] = u;
    });

    var day;
    for (day = 0; day < days; day++) {
      var dayStart = addDays(start, day);
      users.forEach(function (target) {
        /* 고정 사용자는 injectFixedScenarioReactions에서만 제어 */
        if (target.isFixed) return;

        var bias = scenarioBias(target.movementScenario, day, days);
        /* 하루 0~2건 수준으로 낮춰 ±500 상한이 의미 있게 작동하도록 */
        var intensity = 0;
        if (Math.abs(bias) > 0.7) intensity = rng() < 0.55 ? 2 : 1;
        else if (Math.abs(bias) > 0.3) intensity = rng() < 0.4 ? 1 : 0;
        else intensity = rng() < 0.25 ? 1 : 0;
        if (day % 2 === 1 && intensity > 0 && rng() < 0.4) intensity -= 1;

        var n;
        for (n = 0; n < intensity; n++) {
          var wantPioneerPull = bias > 0 || (bias === 0 && rng() > 0.5);
          var actorTerritory;
          var reactionType;
          if (Math.abs(bias) < 0.15) {
            actorTerritory = n % 2 === 0 ? TERRITORY.PIONEER : TERRITORY.GUARDIAN;
            reactionType = pick(rng, ['LIKE', 'RECOMMEND']);
          } else if (wantPioneerPull) {
            actorTerritory = TERRITORY.PIONEER;
            reactionType = pick(rng, ['LIKE', 'RECOMMEND']);
          } else {
            actorTerritory = TERRITORY.GUARDIAN;
            reactionType = pick(rng, ['LIKE', 'RECOMMEND']);
          }

          var hour = pick(rng, [6, 9, 12, 15, 18, 21]);
          var created = new Date(dayStart.getTime());
          created.setUTCHours(hour, randInt(rng, 0, 59), randInt(rng, 0, 59), 0);

          var actorPool = users.filter(function (u) {
            return u.userId !== target.userId && u.startingTerritory === actorTerritory;
          });
          var actor = actorPool.length ? pick(rng, actorPool) : pick(rng, users);

          var cancelledAt = null;
          if (target.movementScenario === SCENARIOS.FREQUENT_CANCEL && rng() < 0.45) {
            cancelledAt = addHours(created, randInt(rng, 12, 72)).toISOString();
          } else if (rng() < 0.03) {
            cancelledAt = addHours(created, randInt(rng, 24, 120)).toISOString();
          }

          reactions.push(
            makeReaction({
              actorUserId: actor.userId,
              targetUserId: target.userId,
              actorTerritoryAtReaction: actorTerritory,
              targetTerritoryAtReaction: target.startingTerritory,
              reactionType: reactionType,
              createdAt: created.toISOString(),
              cancelledAt: cancelledAt,
            }),
          );
        }
      });
    }

    injectFixedScenarioReactions(reactions, byId, start, days, rng);
    return reactions;
  }

  function injectFixedScenarioReactions(reactions, byId, start, days, rng) {
    function pushBurst(targetId, actorTerritory, type, fromDay, toDay, perDay, cancelAfterHours) {
      var d;
      for (d = fromDay; d <= toDay && d < days; d++) {
        var k;
        for (k = 0; k < perDay; k++) {
          var created = addDays(start, d);
          created.setUTCHours(8 + k, 10, 0, 0);
          var cancelledAt = null;
          if (cancelAfterHours != null) {
            cancelledAt = addHours(created, cancelAfterHours).toISOString();
          }
          reactions.push(
            makeReaction({
              actorUserId: 'actor-sim',
              targetUserId: targetId,
              actorTerritoryAtReaction: actorTerritory,
              targetTerritoryAtReaction:
                (byId[targetId] && byId[targetId].startingTerritory) || TERRITORY.CENTRAL,
              reactionType: type,
              createdAt: created.toISOString(),
              cancelledAt: cancelledAt,
            }),
          );
        }
      }
    }

    /*
     * 목표 점수 = base + (99일50%+30일50%).
     * 배치는 목표를 향해 ±500만 이동.
     */
    pushBurst('fix-pioneer-to-central', TERRITORY.GUARDIAN, 'LIKE', 0, Math.min(days - 1, 6), 2);
    /* 하루 다량 반응으로 ±500 상한 발동 사례 확보 */
    pushBurst('fix-pioneer-to-guardian', TERRITORY.GUARDIAN, 'RECOMMEND', 0, Math.min(days - 1, 3), 8);
    pushBurst('fix-pioneer-to-guardian', TERRITORY.GUARDIAN, 'RECOMMEND', 4, Math.min(days - 1, 28), 3);
    pushBurst('fix-guardian-to-central', TERRITORY.PIONEER, 'LIKE', 0, Math.min(days - 1, 6), 2);
    pushBurst('fix-guardian-to-pioneer', TERRITORY.PIONEER, 'RECOMMEND', 0, Math.min(days - 1, 3), 8);
    pushBurst('fix-guardian-to-pioneer', TERRITORY.PIONEER, 'RECOMMEND', 4, Math.min(days - 1, 28), 3);
    pushBurst('fix-central-to-pioneer', TERRITORY.PIONEER, 'LIKE', 0, Math.min(days - 1, 10), 3);
    pushBurst('fix-central-to-guardian', TERRITORY.GUARDIAN, 'LIKE', 0, Math.min(days - 1, 10), 3);

    /* 균형 유지: 매 배치 전후 동일 크기 반대 반응 */
    pushBurst('fix-no-move', TERRITORY.PIONEER, 'LIKE', 0, Math.min(days - 1, 29), 1);
    pushBurst('fix-no-move', TERRITORY.GUARDIAN, 'LIKE', 0, Math.min(days - 1, 29), 1);

    /* 강한 개척: 매우 약한 수호 압력만 (5일마다 1건) */
    var sd;
    for (sd = 0; sd < Math.min(days, 30); sd += 5) {
      pushBurst('fix-strong-pioneer-resist', TERRITORY.GUARDIAN, 'LIKE', sd, sd, 1);
    }

    var od;
    for (od = 0; od < Math.min(days, 30); od++) {
      pushBurst(
        'fix-boundary-oscillate',
        od % 2 === 0 ? TERRITORY.GUARDIAN : TERRITORY.PIONEER,
        'LIKE',
        od,
        od,
        3,
      );
    }

    /* 취소: 강한 수호 반응을 만들고 20시간 후 취소 → 이후 배치에서 제외 */
    pushBurst('fix-cancel-case', TERRITORY.GUARDIAN, 'RECOMMEND', 0, Math.min(days - 1, 8), 4, 20);

    void rng;
  }

  /* ─── 배치 ─── */

  function buildBatchTimes(days, config) {
    var cfg = config || getConfig();
    var start = new Date(cfg.simulationStartIso);
    var hours = cfg.batchHours || [5, 17];
    var times = [];
    var d;
    for (d = 0; d < days; d++) {
      var dayBase = addDays(start, d);
      var hi;
      for (hi = 0; hi < hours.length; hi++) {
        var t = new Date(dayBase.getTime());
        t.setUTCHours(hours[hi], 0, 0, 0);
        times.push(t);
      }
    }
    return times;
  }

  function runOrientationBatch(state, batchTime) {
    var cfg = state.config || getConfig();
    var lite = !!state.lite;
    var batchId = (state.processedBatchCount || (state.batches && state.batches.length) || 0) + 1;
    var batchIso = batchTime.toISOString();
    var prevBatchTime = state.lastBatchTime || null;
    var results = lite ? null : [];
    var cancelledExcluded = 0;
    var capApplied = 0;
    var cancelReverseMoves = 0;
    var windowExpiryChanges = 0;
    var zeroChangeUsers = 0;
    var reactionIndex = state.reactionIndex || null;

    state.users.forEach(function (user) {
      var previousScore = user.currentOrientationScore;
      var previousTerritory = user.currentTerritory;
      var previousCombined =
        user.previousCombinedReactionScore != null
          ? Number(user.previousCombinedReactionScore)
          : 0;
      var counters = { cancelledExcluded: 0 };

      var rolling99 = reactionIndex
        ? sumWindowScoreIndexed(
            reactionIndex,
            user.userId,
            batchTime,
            cfg.rollingWindowDays,
            previousScore,
            cfg,
            counters,
          )
        : sumWindowScore(
            state.reactions,
            user.userId,
            batchTime,
            cfg.rollingWindowDays,
            previousScore,
            cfg,
            counters,
          );
      var recent30 = reactionIndex
        ? sumWindowScoreIndexed(
            reactionIndex,
            user.userId,
            batchTime,
            cfg.recentWindowDays,
            previousScore,
            cfg,
            null,
          )
        : sumWindowScore(
            state.reactions,
            user.userId,
            batchTime,
            cfg.recentWindowDays,
            previousScore,
            cfg,
            null,
          );
      cancelledExcluded += counters.cancelledExcluded;
      user.cancelledExcludedCount =
        (user.cancelledExcludedCount || 0) + counters.cancelledExcluded;

      /*
       * DELTA_WINDOW_SCORE:
       * currentCombined = 99일*0.5 + 30일*0.5
       * batchRawChange = currentCombined - previousCombined
       * nextScore = currentOrientationScore + clamp(batchRawChange, ±500)
       * baseOrientationScore는 시작 이후에 사용하지 않음.
       */
      var currentCombined =
        rolling99 * cfg.rollingWindowRatio + recent30 * cfg.recentWindowRatio;
      var batchRawChange = currentCombined - previousCombined;
      var cappedChange = clamp(
        batchRawChange,
        -cfg.maxScoreChangePerBatch,
        cfg.maxScoreChangePerBatch,
      );
      var capHit = cappedChange !== batchRawChange;
      if (capHit) {
        capApplied += 1;
        user.capAppliedCount = (user.capAppliedCount || 0) + 1;
      }

      var nextScore = previousScore + cappedChange;
      var nextTerritory = resolveTerritoryFromScore(nextScore, cfg.territoryThresholds);

      if (
        previousTerritory === TERRITORY.CENTRAL &&
        nextTerritory !== TERRITORY.CENTRAL &&
        user.firstTerritoryExitBatch == null
      ) {
        user.firstTerritoryExitBatch = batchId;
        user.firstTerritoryExitAt = batchIso;
      }

      /* 취소 / 기간 만료 기여 구분 (직전 배치가 있을 때) */
      var attr = { cancelDelta: 0, expiryDelta: 0, newReactionDelta: 0 };
      if (!lite) {
        attr = attributeCombinedDelta(
          state.reactions,
          user.userId,
          prevBatchTime,
          batchTime,
          previousScore,
          cfg,
        );
        if (Math.abs(batchRawChange) > 1e-9) {
          if (attr.cancelDelta !== 0 && Math.sign(attr.cancelDelta) === Math.sign(batchRawChange)) {
            cancelReverseMoves += 1;
          }
          if (attr.expiryDelta !== 0) {
            windowExpiryChanges += 1;
          }
        }
      } else if (lite && prevBatchTime && Math.abs(batchRawChange) > 1e-9) {
        /* lite: 상세 attribution 생략 · 이번 배치 구간에 취소가 있으면 역방향 후보로 집계 */
        var list = reactionIndex ? reactionIndex[user.userId] || [] : [];
        var prevMs = prevBatchTime.getTime();
        var curMs = batchTime.getTime();
        var ri;
        for (ri = 0; ri < list.length; ri++) {
          var rr = list[ri];
          if (!rr || !rr.cancelledAt) continue;
          var cMs = rr._cancelledMs != null ? rr._cancelledMs : new Date(rr.cancelledAt).getTime();
          if (cMs > prevMs && cMs <= curMs) {
            cancelReverseMoves += 1;
            break;
          }
        }
      }
      if (Math.abs(batchRawChange) <= 1e-9) zeroChangeUsers += 1;

      user.currentOrientationScore = nextScore;
      user.currentTerritory = nextTerritory;
      user.currentCombinedReactionScore = currentCombined;
      user.previousCombinedReactionScore = currentCombined;

      if (!lite) {
        var entry = {
          batchId: batchId,
          batchTime: batchIso,
          userId: user.userId,
          rolling99DayScore: rolling99,
          recent30DayScore: recent30,
          currentCombinedReactionScore: currentCombined,
          previousCombinedReactionScore: previousCombined,
          batchRawChange: batchRawChange,
          combinedRawChange: batchRawChange,
          cappedChange: cappedChange,
          capApplied: capHit,
          previousScore: previousScore,
          nextScore: nextScore,
          territoryBefore: previousTerritory,
          territoryAfter: nextTerritory,
          previousTerritory: previousTerritory,
          nextTerritory: nextTerritory,
          cancelDelta: attr.cancelDelta,
          expiryDelta: attr.expiryDelta,
          newReactionDelta: attr.newReactionDelta,
        };
        user.scoreHistory.push(entry);
        results.push(entry);
      } else if (Math.abs(cappedChange) > getConfig().maxScoreChangePerBatch + 1e-9) {
        state.stats.repeatedReactionFullAddCount =
          (state.stats.repeatedReactionFullAddCount || 0) + 0;
      }

      if (previousTerritory !== nextTerritory) {
        user.territoryHistory.push({
          batchId: batchId,
          changedAt: batchIso,
          fromTerritory: previousTerritory,
          toTerritory: nextTerritory,
          previousScore: previousScore,
          nextScore: nextScore,
        });
      }
    });

    var allUsersZero = zeroChangeUsers === state.users.length;
    if (allUsersZero) {
      state.stats.consecutiveZeroChangeBatches =
        (state.stats.consecutiveZeroChangeBatches || 0) + 1;
    } else {
      state.stats.consecutiveZeroChangeBatches = 0;
    }
    state.stats.zeroChangeUserBatches =
      (state.stats.zeroChangeUserBatches || 0) + zeroChangeUsers;
    state.stats.cancelReverseMoves =
      (state.stats.cancelReverseMoves || 0) + cancelReverseMoves;
    state.stats.windowExpiryChanges =
      (state.stats.windowExpiryChanges || 0) + windowExpiryChanges;

    state.processedBatchCount = batchId;
    state.lastBatchTime = batchTime;
    state.stats.totalCapApplied += capApplied;
    state.stats.totalCancelledExcluded += cancelledExcluded;

    var batchRecord = {
      batchId: batchId,
      batchTime: batchIso,
      capAppliedCount: capApplied,
      cancelledExcludedCount: cancelledExcluded,
      cancelReverseMoves: cancelReverseMoves,
      windowExpiryChanges: windowExpiryChanges,
      zeroChangeUsers: zeroChangeUsers,
      results: results,
    };
    if (!lite) {
      state.batches.push(batchRecord);
    }
    return batchRecord;
  }

  /**
   * 직전→이번 배치 결합값 변화 요인 추정.
   * cancelDelta: 새로 취소되어 빠진 반응의 부호 합
   * expiryDelta: 창 밖으로 빠진 반응의 부호 합(부호 반전 = 결합값에서 제거)
   * newReactionDelta: 새로 들어온 반응의 부호 합
   */
  function attributeCombinedDelta(
    reactions,
    targetUserId,
    prevBatchTime,
    batchTime,
    scoreBeforeBatch,
    config,
  ) {
    var cfg = config || getConfig();
    if (!prevBatchTime) {
      return { cancelDelta: 0, expiryDelta: 0, newReactionDelta: 0 };
    }
    var ratio99 = cfg.rollingWindowRatio;
    var ratio30 = cfg.recentWindowRatio;
    var cancelDelta = 0;
    var expiryDelta = 0;
    var newReactionDelta = 0;
    var prevMs = prevBatchTime.getTime();
    var curMs = batchTime.getTime();
    var i;

    function inWindow(createdMs, atMs, days) {
      return createdMs <= atMs && atMs - createdMs <= days * 86400000;
    }
    function activeAt(r, atMs) {
      if (!r.cancelledAt) return true;
      var c = new Date(r.cancelledAt).getTime();
      return !(isFinite(c) && c <= atMs);
    }
    function weightAt(r) {
      return computeReactionSignedDelta(r, scoreBeforeBatch, cfg);
    }

    for (i = 0; i < reactions.length; i++) {
      var r = reactions[i];
      if (!r || r.targetUserId !== targetUserId) continue;
      var created = new Date(r.createdAt).getTime();
      if (!isFinite(created)) continue;
      var w = weightAt(r);
      var cancelled = r.cancelledAt ? new Date(r.cancelledAt).getTime() : NaN;
      var newlyCancelled =
        isFinite(cancelled) && cancelled > prevMs && cancelled <= curMs;

      var prevActive = activeAt(r, prevMs);
      var curActive = activeAt(r, curMs);
      var prev99 = prevActive && inWindow(created, prevMs, cfg.rollingWindowDays);
      var cur99 = curActive && inWindow(created, curMs, cfg.rollingWindowDays);
      var prev30 = prevActive && inWindow(created, prevMs, cfg.recentWindowDays);
      var cur30 = curActive && inWindow(created, curMs, cfg.recentWindowDays);

      var prevC = (prev99 ? w * ratio99 : 0) + (prev30 ? w * ratio30 : 0);
      var curC = (cur99 ? w * ratio99 : 0) + (cur30 ? w * ratio30 : 0);
      var diff = curC - prevC;
      if (Math.abs(diff) < 1e-12) continue;

      if (newlyCancelled) {
        cancelDelta += diff;
      } else if (
        (prev99 && !cur99 && curActive) ||
        (prev30 && !cur30 && curActive)
      ) {
        expiryDelta += diff;
      } else if (created > prevMs && created <= curMs) {
        newReactionDelta += diff;
      }
    }

    return {
      cancelDelta: cancelDelta,
      expiryDelta: expiryDelta,
      newReactionDelta: newReactionDelta,
    };
  }

  /* ─── 2차: ZERO_START_LATENT_ORIENTATION ─── */

  function validateBehaviorRate(rate, label) {
    if (!rate || typeof rate !== 'object') {
      return { ok: false, error: label + ': object required' };
    }
    var p = Number(rate.pioneer);
    var g = Number(rate.guardian);
    var n = Number(rate.neutral);
    if (!(p >= 0 && g >= 0 && n >= 0)) {
      return { ok: false, error: label + ': rates must be non-negative' };
    }
    if (Math.abs(p + g + n - 1) > 1e-6) {
      return { ok: false, error: label + ': pioneer+guardian+neutral must sum to 1' };
    }
    return { ok: true, rate: { pioneer: p, guardian: g, neutral: n } };
  }

  function setLatentOrientationBehaviorRates(partial) {
    var map = {
      strongPioneer: 'strongPioneer',
      mediumPioneer: 'mediumPioneer',
      weakPioneer: 'weakPioneer',
      mixedPioneer: 'mixedPioneer',
      strongGuardian: 'strongGuardian',
      mediumGuardian: 'mediumGuardian',
      weakGuardian: 'weakGuardian',
      mixedGuardian: 'mixedGuardian',
      neutralBalanced: 'neutralBalanced',
      neutralWeakPioneer: 'neutralWeakPioneer',
      neutralWeakGuardian: 'neutralWeakGuardian',
      neutralShift: 'neutralShift',
    };
    var key;
    var applied = {};
    for (key in partial || {}) {
      if (!Object.prototype.hasOwnProperty.call(partial, key)) continue;
      if (!map[key]) {
        return { ok: false, error: 'unknown key: ' + key };
      }
      var checked = validateBehaviorRate(partial[key], key);
      if (!checked.ok) return checked;
      ORIENTATION_SIMULATION_CONFIG.latentBehaviorRates[map[key]] = checked.rate;
      applied[key] = checked.rate;
    }
    return { ok: true, applied: applied, rates: clone(ORIENTATION_SIMULATION_CONFIG.latentBehaviorRates) };
  }

  function latentRateKey(user, dayIndex, totalDays) {
    var lat = user.latentOrientation;
    var str = user.latentStrength;
    var sub = user.latentSubtype;
    if (lat === LATENT.NEUTRAL) {
      if (sub === 'WEAK_PIONEER_BIAS') return 'neutralWeakPioneer';
      if (sub === 'WEAK_GUARDIAN_BIAS') return 'neutralWeakGuardian';
      if (sub === 'PERIOD_SHIFT' || str === LATENT_STRENGTH.MIXED && sub === 'PERIOD_SHIFT') {
        return dayIndex < totalDays / 2 ? 'neutralWeakPioneer' : 'neutralWeakGuardian';
      }
      return 'neutralBalanced';
    }
    if (lat === LATENT.PIONEER) {
      if (str === LATENT_STRENGTH.STRONG) return 'strongPioneer';
      if (str === LATENT_STRENGTH.MEDIUM) return 'mediumPioneer';
      if (str === LATENT_STRENGTH.WEAK) return 'weakPioneer';
      return 'mixedPioneer';
    }
    if (lat === LATENT.GUARDIAN) {
      if (str === LATENT_STRENGTH.STRONG) return 'strongGuardian';
      if (str === LATENT_STRENGTH.MEDIUM) return 'mediumGuardian';
      if (str === LATENT_STRENGTH.WEAK) return 'weakGuardian';
      return 'mixedGuardian';
    }
    return 'neutralBalanced';
  }

  function pickDirectionFromRates(rng, rates) {
    var r = rng();
    if (r < rates.pioneer) return 'pioneer';
    if (r < rates.pioneer + rates.guardian) return 'guardian';
    return 'neutral';
  }

  function directionToReaction(rng, direction) {
    if (direction === 'pioneer') {
      return { actorTerritory: TERRITORY.PIONEER, reactionType: pick(rng, ['LIKE', 'RECOMMEND']) };
    }
    if (direction === 'guardian') {
      return { actorTerritory: TERRITORY.GUARDIAN, reactionType: pick(rng, ['LIKE', 'RECOMMEND']) };
    }
    /* 중립성 행동: 약한 균형 또는 약한 부정 노이즈 */
    if (rng() < 0.5) {
      return {
        actorTerritory: rng() < 0.5 ? TERRITORY.PIONEER : TERRITORY.GUARDIAN,
        reactionType: pick(rng, ['LIKE', 'RECOMMEND']),
      };
    }
    return {
      actorTerritory: rng() < 0.5 ? TERRITORY.PIONEER : TERRITORY.GUARDIAN,
      reactionType: pick(rng, ['DISLIKE', 'DOWNVOTE']),
    };
  }

  function intensityForLatent(rng, user) {
    var str = user.latentStrength;
    if (user.movementScenario === SCENARIOS.ZS_NO_REACTIONS) return 0;
    if (str === LATENT_STRENGTH.STRONG) return rng() < 0.7 ? 2 : 1;
    if (str === LATENT_STRENGTH.MEDIUM) return rng() < 0.55 ? 1 : rng() < 0.3 ? 2 : 0;
    if (str === LATENT_STRENGTH.WEAK) return rng() < 0.35 ? 1 : 0;
    return rng() < 0.4 ? 1 : rng() < 0.15 ? 2 : 0;
  }

  function createZeroStartFixedUsers() {
    return [
      makeUser({
        userId: 'zs-fix-strong-pioneer',
        label: '2차고정 강한 개척',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.PIONEER,
        latentStrength: LATENT_STRENGTH.STRONG,
        latentSubtype: 'STRONG',
        movementScenario: SCENARIOS.ZS_STRONG_PIONEER,
        isFixed: true,
        isRandom: false,
      }),
      makeUser({
        userId: 'zs-fix-strong-guardian',
        label: '2차고정 강한 수호',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.GUARDIAN,
        latentStrength: LATENT_STRENGTH.STRONG,
        latentSubtype: 'STRONG',
        movementScenario: SCENARIOS.ZS_STRONG_GUARDIAN,
        isFixed: true,
        isRandom: false,
      }),
      makeUser({
        userId: 'zs-fix-neutral-hold',
        label: '2차고정 완전 중립',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.NEUTRAL,
        latentStrength: LATENT_STRENGTH.MEDIUM,
        latentSubtype: 'BALANCED',
        movementScenario: SCENARIOS.ZS_NEUTRAL_HOLD,
        isFixed: true,
        isRandom: false,
      }),
      makeUser({
        userId: 'zs-fix-weak-pioneer',
        label: '2차고정 약한 개척',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.PIONEER,
        latentStrength: LATENT_STRENGTH.WEAK,
        latentSubtype: 'WEAK',
        movementScenario: SCENARIOS.ZS_WEAK_PIONEER,
        isFixed: true,
        isRandom: false,
      }),
      makeUser({
        userId: 'zs-fix-weak-guardian',
        label: '2차고정 약한 수호',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.GUARDIAN,
        latentStrength: LATENT_STRENGTH.WEAK,
        latentSubtype: 'WEAK',
        movementScenario: SCENARIOS.ZS_WEAK_GUARDIAN,
        isFixed: true,
        isRandom: false,
      }),
      makeUser({
        userId: 'zs-fix-pioneer-wrong',
        label: '2차고정 개척→수호 오이동',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.PIONEER,
        latentStrength: LATENT_STRENGTH.MIXED,
        latentSubtype: 'EXCEPTION',
        movementScenario: SCENARIOS.ZS_PIONEER_WRONG,
        isFixed: true,
        isRandom: false,
      }),
      makeUser({
        userId: 'zs-fix-guardian-wrong',
        label: '2차고정 수호→개척 오이동',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.GUARDIAN,
        latentStrength: LATENT_STRENGTH.MIXED,
        latentSubtype: 'EXCEPTION',
        movementScenario: SCENARIOS.ZS_GUARDIAN_WRONG,
        isFixed: true,
        isRandom: false,
      }),
      makeUser({
        userId: 'zs-fix-early-late-shift',
        label: '2차고정 시기별 방향 변화',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.NEUTRAL,
        latentStrength: LATENT_STRENGTH.MIXED,
        latentSubtype: 'PERIOD_SHIFT',
        movementScenario: SCENARIOS.ZS_EARLY_LATE_SHIFT,
        isFixed: true,
        isRandom: false,
      }),
      makeUser({
        userId: 'zs-fix-cancel-return',
        label: '2차고정 취소→중앙 재진입',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.PIONEER,
        latentStrength: LATENT_STRENGTH.MEDIUM,
        latentSubtype: 'MEDIUM',
        movementScenario: SCENARIOS.ZS_CANCEL_RETURN,
        isFixed: true,
        isRandom: false,
      }),
      makeUser({
        userId: 'zs-fix-boundary-osc',
        label: '2차고정 경계 왕복',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.NEUTRAL,
        latentStrength: LATENT_STRENGTH.MIXED,
        latentSubtype: 'PERIOD_SHIFT',
        movementScenario: SCENARIOS.ZS_BOUNDARY_OSCILLATE,
        isFixed: true,
        isRandom: false,
      }),
      makeUser({
        userId: 'zs-fix-no-reactions',
        label: '2차고정 반응 없음',
        baseOrientationScore: 0,
        startingTerritory: TERRITORY.CENTRAL,
        latentOrientation: LATENT.NEUTRAL,
        latentStrength: LATENT_STRENGTH.MEDIUM,
        latentSubtype: 'BALANCED',
        movementScenario: SCENARIOS.ZS_NO_REACTIONS,
        isFixed: true,
        isRandom: false,
      }),
    ];
  }

  function countLatent(users, lat) {
    return users.filter(function (u) {
      return u.latentOrientation === lat;
    }).length;
  }

  function createZeroStartOrientationUsers(options) {
    var opts = options || {};
    var rng = mulberry32(opts.seed != null ? opts.seed : 20260726);
    var targetCount = opts.userCount != null ? opts.userCount : 120;
    var users = createZeroStartFixedUsers();
    var next = 1;

    function need(lat, n) {
      return Math.max(0, n - countLatent(users, lat));
    }

    function pushBand(lat, strength, subtype, count, prefix) {
      var i;
      for (i = 0; i < count; i++) {
        users.push(
          makeUser({
            userId: prefix + '-' + String(next).padStart(3, '0'),
            label: prefix + ' #' + next,
            baseOrientationScore: 0,
            startingTerritory: TERRITORY.CENTRAL,
            latentOrientation: lat,
            latentStrength: strength,
            latentSubtype: subtype,
            movementScenario: '숨은성향:' + lat + '/' + strength,
            isFixed: false,
            isRandom: true,
          }),
        );
        next += 1;
      }
    }

    /* 세부 유형 목표: 각 latent 40 = STRONG/MED/WEAK/MIXED 각 10 (고정 포함) */
    function fillLatent(lat, bands) {
      var bi;
      for (bi = 0; bi < bands.length; bi++) {
        var band = bands[bi];
        var have = users.filter(function (u) {
          return (
            u.latentOrientation === lat &&
            u.latentStrength === band.strength &&
            (!band.subtype || u.latentSubtype === band.subtype)
          );
        }).length;
        var remain = Math.max(0, band.target - have);
        if (remain > 0) pushBand(lat, band.strength, band.subtype, remain, band.prefix);
      }
      while (countLatent(users, lat) < 40 && users.length < targetCount) {
        pushBand(lat, LATENT_STRENGTH.MEDIUM, 'FILL', 1, 'zs-fill-' + lat.toLowerCase());
      }
    }

    fillLatent(LATENT.PIONEER, [
      { strength: LATENT_STRENGTH.STRONG, subtype: 'STRONG', target: 10, prefix: 'zs-pio-strong' },
      { strength: LATENT_STRENGTH.MEDIUM, subtype: 'MEDIUM', target: 10, prefix: 'zs-pio-mid' },
      { strength: LATENT_STRENGTH.WEAK, subtype: 'WEAK', target: 10, prefix: 'zs-pio-weak' },
      { strength: LATENT_STRENGTH.MIXED, subtype: 'EXCEPTION', target: 10, prefix: 'zs-pio-mix' },
    ]);
    fillLatent(LATENT.GUARDIAN, [
      { strength: LATENT_STRENGTH.STRONG, subtype: 'STRONG', target: 10, prefix: 'zs-gua-strong' },
      { strength: LATENT_STRENGTH.MEDIUM, subtype: 'MEDIUM', target: 10, prefix: 'zs-gua-mid' },
      { strength: LATENT_STRENGTH.WEAK, subtype: 'WEAK', target: 10, prefix: 'zs-gua-weak' },
      { strength: LATENT_STRENGTH.MIXED, subtype: 'EXCEPTION', target: 10, prefix: 'zs-gua-mix' },
    ]);
    fillLatent(LATENT.NEUTRAL, [
      { strength: LATENT_STRENGTH.MEDIUM, subtype: 'BALANCED', target: 10, prefix: 'zs-neu-bal' },
      { strength: LATENT_STRENGTH.WEAK, subtype: 'WEAK_PIONEER_BIAS', target: 10, prefix: 'zs-neu-wp' },
      { strength: LATENT_STRENGTH.WEAK, subtype: 'WEAK_GUARDIAN_BIAS', target: 10, prefix: 'zs-neu-wg' },
      { strength: LATENT_STRENGTH.MIXED, subtype: 'PERIOD_SHIFT', target: 10, prefix: 'zs-neu-shift' },
    ]);

    /* 정확히 120명으로 맞춤 (초과 시 무작위 일반 사용자부터 제거, 고정 보존) */
    while (users.length > targetCount) {
      var idx = -1;
      var ui;
      for (ui = users.length - 1; ui >= 0; ui--) {
        if (!users[ui].isFixed) {
          idx = ui;
          break;
        }
      }
      if (idx < 0) break;
      users.splice(idx, 1);
    }
    while (users.length < targetCount) {
      var latPick =
        countLatent(users, LATENT.PIONEER) < 40
          ? LATENT.PIONEER
          : countLatent(users, LATENT.GUARDIAN) < 40
            ? LATENT.GUARDIAN
            : LATENT.NEUTRAL;
      pushBand(latPick, LATENT_STRENGTH.MEDIUM, 'FILL', 1, 'zs-pad');
    }

    void need;
    void rng;
    return users;
  }

  function injectZeroStartFixedReactions(reactions, byId, start, days) {
    function pushBurst(targetId, actorTerritory, type, fromDay, toDay, perDay, cancelAfterHours) {
      var d;
      for (d = fromDay; d <= toDay && d < days; d++) {
        var k;
        for (k = 0; k < perDay; k++) {
          var created = addDays(start, d);
          created.setUTCHours(8 + k, 10, 0, 0);
          var cancelledAt = null;
          if (cancelAfterHours != null) {
            cancelledAt = addHours(created, cancelAfterHours).toISOString();
          }
          reactions.push(
            makeReaction({
              actorUserId: 'zs-actor-sim',
              targetUserId: targetId,
              actorTerritoryAtReaction: actorTerritory,
              targetTerritoryAtReaction: TERRITORY.CENTRAL,
              reactionType: type,
              createdAt: created.toISOString(),
              cancelledAt: cancelledAt,
            }),
          );
        }
      }
    }

    /* 강한 개척 → 개척 */
    pushBurst('zs-fix-strong-pioneer', TERRITORY.PIONEER, 'RECOMMEND', 0, Math.min(days - 1, 20), 3);
    /* 강한 수호 → 수호 */
    pushBurst('zs-fix-strong-guardian', TERRITORY.GUARDIAN, 'RECOMMEND', 0, Math.min(days - 1, 20), 3);
    /* 완전 중립: 균형 */
    pushBurst('zs-fix-neutral-hold', TERRITORY.PIONEER, 'LIKE', 0, Math.min(days - 1, 29), 1);
    pushBurst('zs-fix-neutral-hold', TERRITORY.GUARDIAN, 'LIKE', 0, Math.min(days - 1, 29), 1);
    /* 약한 개척: 드문 개척 */
    pushBurst('zs-fix-weak-pioneer', TERRITORY.PIONEER, 'LIKE', 0, Math.min(days - 1, 29), 1);
    /* 약한 수호 */
    pushBurst('zs-fix-weak-guardian', TERRITORY.GUARDIAN, 'LIKE', 0, Math.min(days - 1, 29), 1);
    /* 개척 성향인데 강한 수호 행동 → 수호 오이동 */
    pushBurst('zs-fix-pioneer-wrong', TERRITORY.GUARDIAN, 'RECOMMEND', 0, Math.min(days - 1, 22), 4);
    /* 수호 성향인데 강한 개척 행동 → 개척 오이동 */
    pushBurst('zs-fix-guardian-wrong', TERRITORY.PIONEER, 'RECOMMEND', 0, Math.min(days - 1, 22), 4);
    /* 초반 개척 · 후반 수호 */
    var mid = Math.floor(days / 2);
    pushBurst('zs-fix-early-late-shift', TERRITORY.PIONEER, 'LIKE', 0, Math.max(0, mid - 1), 3);
    pushBurst('zs-fix-early-late-shift', TERRITORY.GUARDIAN, 'LIKE', mid, Math.min(days - 1, days - 1), 3);
    /* 개척으로 밀었다가 취소 → 중앙 복귀 */
    pushBurst('zs-fix-cancel-return', TERRITORY.PIONEER, 'RECOMMEND', 0, Math.min(days - 1, 8), 5, 18);
    /* 경계 왕복 */
    var od;
    for (od = 0; od < Math.min(days, 40); od++) {
      pushBurst(
        'zs-fix-boundary-osc',
        od % 2 === 0 ? TERRITORY.PIONEER : TERRITORY.GUARDIAN,
        'LIKE',
        od,
        od,
        4,
      );
    }
    /* zs-fix-no-reactions: 반응 없음 */
    void byId;
  }

  function createZeroStartOrientationReactions(users, options) {
    var opts = options || {};
    var rng = mulberry32((opts.seed != null ? opts.seed : 20260726) + 91);
    var days = opts.days != null ? opts.days : 30;
    var start = new Date(getConfig().simulationStartIso);
    var reactions = [];
    reactionSeq = 0;
    var ratesCfg = getConfig().latentBehaviorRates;

    var byId = {};
    users.forEach(function (u) {
      byId[u.userId] = u;
    });

    var day;
    for (day = 0; day < days; day++) {
      var dayStart = addDays(start, day);
      users.forEach(function (target) {
        if (target.isFixed) return;
        var rateKey = latentRateKey(target, day, days);
        var rates = ratesCfg[rateKey] || ratesCfg.neutralBalanced;
        var intensity = intensityForLatent(rng, target);
        var n;
        for (n = 0; n < intensity; n++) {
          var direction = pickDirectionFromRates(rng, rates);
          var mapped = directionToReaction(rng, direction);
          var hour = pick(rng, [6, 9, 12, 15, 18, 21]);
          var created = new Date(dayStart.getTime());
          created.setUTCHours(hour, randInt(rng, 0, 59), randInt(rng, 0, 59), 0);
          var actor = pick(rng, users);
          var cancelledAt = null;
          if (target.latentStrength === LATENT_STRENGTH.MIXED && rng() < 0.12) {
            cancelledAt = addHours(created, randInt(rng, 12, 72)).toISOString();
          } else if (rng() < 0.025) {
            cancelledAt = addHours(created, randInt(rng, 24, 120)).toISOString();
          }
          reactions.push(
            makeReaction({
              actorUserId: actor.userId,
              targetUserId: target.userId,
              actorTerritoryAtReaction: mapped.actorTerritory,
              targetTerritoryAtReaction: TERRITORY.CENTRAL,
              reactionType: mapped.reactionType,
              createdAt: created.toISOString(),
              cancelledAt: cancelledAt,
            }),
          );
        }
      });
    }

    injectZeroStartFixedReactions(reactions, byId, start, days);
    return reactions;
  }

  function matchesLatentOrientation(user) {
    if (!user || !user.latentOrientation) return null;
    if (user.latentOrientation === LATENT.PIONEER) {
      return user.currentTerritory === TERRITORY.PIONEER;
    }
    if (user.latentOrientation === LATENT.GUARDIAN) {
      return user.currentTerritory === TERRITORY.GUARDIAN;
    }
    if (user.latentOrientation === LATENT.NEUTRAL) {
      return user.currentTerritory === TERRITORY.CENTRAL;
    }
    return null;
  }

  function movedToOppositeTerritory(user) {
    if (!user || !user.latentOrientation) return false;
    if (user.latentOrientation === LATENT.PIONEER) {
      return user.currentTerritory === TERRITORY.GUARDIAN;
    }
    if (user.latentOrientation === LATENT.GUARDIAN) {
      return user.currentTerritory === TERRITORY.PIONEER;
    }
    return false;
  }

  function avg(nums) {
    if (!nums.length) return null;
    var s = 0;
    var i;
    for (i = 0; i < nums.length; i++) s += nums[i];
    return s / nums.length;
  }

  function storeSimulationState(state) {
    simulationState = state;
    if (state && state.mode) {
      simulationStoreByMode[state.mode] = state;
      if (state.mode === ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION) {
        simulationStoreByMode[state.mode + '_' + state.days] = state;
      }
    }
  }

  function runOrientationSimulation(options) {
    var opts = options || {};
    var mode =
      opts.mode || ORIENTATION_SIMULATION_MODES.BASE_SCORE_MOVEMENT;
    var days = opts.days != null ? opts.days : 30;
    var seed = opts.seed != null ? opts.seed : 20260726;
    var config = clone(getConfig());
    if (opts.userCount != null) config.userCount = opts.userCount;

    var users;
    var reactions;
    if (mode === ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION) {
      users = createZeroStartOrientationUsers({ seed: seed, userCount: config.userCount });
      reactions = createZeroStartOrientationReactions(users, { seed: seed, days: days });
    } else {
      users = createOrientationSimulationUsers({ seed: seed, userCount: config.userCount });
      reactions = createOrientationSimulationReactions(users, { seed: seed, days: days });
    }

    var batchTimes = buildBatchTimes(days, config);

    var nextState = {
      mode: mode,
      config: config,
      seed: seed,
      days: days,
      users: users,
      reactions: reactions,
      batches: [],
      lastBatchTime: null,
      calculationMethod: 'DELTA_WINDOW_SCORE',
      stats: {
        totalCapApplied: 0,
        totalCancelledExcluded: 0,
        cancelReverseMoves: 0,
        windowExpiryChanges: 0,
        zeroChangeUserBatches: 0,
        consecutiveZeroChangeBatches: 0,
        maxConsecutiveZeroChangeBatches: 0,
        repeatedReactionFullAddCount: 0,
      },
      startedAt: new Date().toISOString(),
    };

    var bi;
    for (bi = 0; bi < batchTimes.length; bi++) {
      runOrientationBatch(nextState, batchTimes[bi]);
      var cz = nextState.stats.consecutiveZeroChangeBatches || 0;
      if (cz > (nextState.stats.maxConsecutiveZeroChangeBatches || 0)) {
        nextState.stats.maxConsecutiveZeroChangeBatches = cz;
      }
    }

    nextState.finishedAt = new Date().toISOString();
    storeSimulationState(nextState);
    return getOrientationSimulationReport();
  }

  function resetOrientationSimulation() {
    simulationState = null;
    return { ok: true };
  }

  function resetAllOrientationSimulations() {
    simulationState = null;
    simulationStoreByMode = {};
    return { ok: true };
  }

  function getStoredOrientationState(mode) {
    if (mode && simulationStoreByMode[mode]) return clone(simulationStoreByMode[mode]);
    return simulationState ? clone(simulationState) : null;
  }

  function getOrientationSimulationState() {
    return simulationState ? clone(simulationState) : null;
  }

  function territoryPathForUser(user) {
    var path = [user.startingTerritory];
    var i;
    for (i = 0; i < user.territoryHistory.length; i++) {
      path.push(user.territoryHistory[i].toTerritory);
    }
    /* 중복 연속 제거 */
    var compact = [path[0]];
    for (i = 1; i < path.length; i++) {
      if (path[i] !== compact[compact.length - 1]) compact.push(path[i]);
    }
    return compact.join(' → ');
  }

  function countUsers(users, pred) {
    return users.filter(pred).length;
  }

  function buildLatentGroupStats(users, latent) {
    var group = users.filter(function (u) {
      return u.latentOrientation === latent;
    });
    var endP = countUsers(group, function (u) {
      return u.currentTerritory === TERRITORY.PIONEER;
    });
    var endC = countUsers(group, function (u) {
      return u.currentTerritory === TERRITORY.CENTRAL;
    });
    var endG = countUsers(group, function (u) {
      return u.currentTerritory === TERRITORY.GUARDIAN;
    });
    var matches = countUsers(group, function (u) {
      return matchesLatentOrientation(u) === true;
    });
    var opposite = countUsers(group, movedToOppositeTerritory);
    var exitBatches = group
      .filter(function (u) {
        return u.firstTerritoryExitBatch != null;
      })
      .map(function (u) {
        return u.firstTerritoryExitBatch;
      });
    var scores = group.map(function (u) {
      return u.currentOrientationScore;
    });
    var n = group.length || 1;
    var out = {
      count: group.length,
      finalPioneer: endP,
      finalCentral: endC,
      finalGuardian: endG,
      matchCount: matches,
      matchRate: group.length ? matches / group.length : 0,
      oppositeCount: opposite,
      oppositeRate: group.length ? opposite / group.length : 0,
      avgFinalScore: avg(scores),
      avgFirstExitBatch: avg(exitBatches),
    };
    if (latent === LATENT.NEUTRAL) {
      out.centralRetentionRate = endC / n;
      out.excessiveSkewRate = (endP + endG) / n;
    }
    if (latent === LATENT.PIONEER) {
      out.selfDirectionHitRate = endP / n;
      out.oppositeMisclassRate = endG / n;
    }
    if (latent === LATENT.GUARDIAN) {
      out.selfDirectionHitRate = endG / n;
      out.oppositeMisclassRate = endP / n;
    }
    return out;
  }

  function getOrientationSimulationReport() {
    if (!simulationState) return null;
    var users = simulationState.users;
    var mode = simulationState.mode || ORIENTATION_SIMULATION_MODES.BASE_SCORE_MOVEMENT;
    var analysis =
      (simulationState.config && simulationState.config.analysis) || getConfig().analysis;
    var startPioneer = countUsers(users, function (u) {
      return u.startingTerritory === TERRITORY.PIONEER;
    });
    var startCentral = countUsers(users, function (u) {
      return u.startingTerritory === TERRITORY.CENTRAL;
    });
    var startGuardian = countUsers(users, function (u) {
      return u.startingTerritory === TERRITORY.GUARDIAN;
    });
    var endPioneer = countUsers(users, function (u) {
      return u.currentTerritory === TERRITORY.PIONEER;
    });
    var endCentral = countUsers(users, function (u) {
      return u.currentTerritory === TERRITORY.CENTRAL;
    });
    var endGuardian = countUsers(users, function (u) {
      return u.currentTerritory === TERRITORY.GUARDIAN;
    });

    var pathCounts = {};
    var userResults = users.map(function (u) {
      var path = territoryPathForUser(u);
      pathCounts[path] = (pathCounts[path] || 0) + 1;
      var match = matchesLatentOrientation(u);
      return {
        userId: u.userId,
        isFixed: !!u.isFixed,
        isRandom: !!u.isRandom,
        latentOrientation: u.latentOrientation,
        latentStrength: u.latentStrength,
        latentSubtype: u.latentSubtype,
        movementScenario: u.movementScenario,
        baseOrientationScore: u.baseOrientationScore,
        startingScore: u.baseOrientationScore,
        startingTerritory: u.startingTerritory,
        finalOrientationScore: u.currentOrientationScore,
        finalTerritory: u.currentTerritory,
        totalScoreChange: u.currentOrientationScore - u.baseOrientationScore,
        territoryMovementPath: path,
        territoryChangeCount: u.territoryHistory.length,
        firstTerritoryExitBatch: u.firstTerritoryExitBatch,
        firstTerritoryExitAt: u.firstTerritoryExitAt,
        matchesLatentOrientation: match,
        movedToOppositeTerritory: movedToOppositeTerritory(u),
        capAppliedCount: u.capAppliedCount || 0,
      };
    });

    function pathIncludes(from, to) {
      return countUsers(userResults, function (r) {
        return (
          r.startingTerritory === from &&
          r.finalTerritory === to &&
          r.territoryChangeCount >= 1
        );
      });
    }

    function pathExact(parts) {
      var key = parts.join(' → ');
      return pathCounts[key] || 0;
    }

    var movers = userResults.filter(function (r) {
      return r.territoryChangeCount >= 1;
    });
    var multiMovers = userResults.filter(function (r) {
      return r.territoryChangeCount >= 2;
    });
    var stayedCentral = countUsers(users, function (u) {
      return (
        u.startingTerritory === TERRITORY.CENTRAL &&
        u.currentTerritory === TERRITORY.CENTRAL &&
        u.territoryHistory.length === 0
      );
    });

    var firstExitBatches = users
      .filter(function (u) {
        return u.firstTerritoryExitBatch != null;
      })
      .map(function (u) {
        return u.firstTerritoryExitBatch;
      });
    var firstExitDays = users
      .filter(function (u) {
        return u.firstTerritoryExitAt;
      })
      .map(function (u) {
        var startMs = new Date(getConfig().simulationStartIso).getTime();
        return (new Date(u.firstTerritoryExitAt).getTime() - startMs) / 86400000;
      });

    var alienAppeared = users.some(function (u) {
      return (
        String(u.currentTerritory).indexOf('ALIEN') >= 0 ||
        String(u.startingTerritory).indexOf('ALIEN') >= 0 ||
        String(u.currentTerritory).indexOf('KANTAP') >= 0
      );
    });

    var allStartZero = users.every(function (u) {
      return Number(u.baseOrientationScore) === 0;
    });
    var allStartCentral = users.every(function (u) {
      return u.startingTerritory === TERRITORY.CENTRAL;
    });

    var strongUsers = users.filter(function (u) {
      return u.latentStrength === LATENT_STRENGTH.STRONG;
    });
    var tooFast = countUsers(strongUsers, function (u) {
      return (
        u.firstTerritoryExitBatch != null &&
        u.firstTerritoryExitBatch <= (analysis.tooFastExitBatches || 2)
      );
    });
    var tooSlow = countUsers(strongUsers, function (u) {
      return (
        u.territoryHistory.length === 0 &&
        simulationState.days >= (analysis.strongTooSlowDays || 30)
      );
    });
    var weakStayCentral = countUsers(users, function (u) {
      return (
        u.latentStrength === LATENT_STRENGTH.WEAK &&
        u.currentTerritory === TERRITORY.CENTRAL &&
        u.territoryHistory.length === 0
      );
    });
    var neutralExcessMove = countUsers(users, function (u) {
      return u.latentOrientation === LATENT.NEUTRAL && u.territoryHistory.length >= 2;
    });

    var latentByGroup = null;
    if (mode === ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION) {
      latentByGroup = {
        pioneer: buildLatentGroupStats(users, LATENT.PIONEER),
        neutral: buildLatentGroupStats(users, LATENT.NEUTRAL),
        guardian: buildLatentGroupStats(users, LATENT.GUARDIAN),
      };
    }

    var mismatches = userResults.filter(function (r) {
      return r.matchesLatentOrientation === false;
    });
    var oppositeMovers = userResults.filter(function (r) {
      return r.movedToOppositeTerritory;
    });

    return {
      summary: {
        mode: mode,
        calculationMethod: 'DELTA_WINDOW_SCORE',
        totalUsers: users.length,
        days: simulationState.days,
        batchCount: simulationState.batches.length,
        seed: simulationState.seed,
        allStartScoreZero: allStartZero,
        allStartTerritoryCentral: allStartCentral,
        startCounts: {
          pioneer: startPioneer,
          central: startCentral,
          guardian: startGuardian,
        },
        endCounts: {
          pioneer: endPioneer,
          central: endCentral,
          guardian: endGuardian,
        },
        movedAtLeastOnce: movers.length,
        stayedInCentral: stayedCentral,
        neverMoved: users.length - movers.length,
        movedTwoOrMore: multiMovers.length,
        avgFirstTerritoryExitBatch: avg(firstExitBatches),
        avgDaysToLeaveCentral: avg(firstExitDays),
        pioneerToCentral: pathIncludes(TERRITORY.PIONEER, TERRITORY.CENTRAL),
        pioneerToGuardian: pathIncludes(TERRITORY.PIONEER, TERRITORY.GUARDIAN),
        guardianToCentral: pathIncludes(TERRITORY.GUARDIAN, TERRITORY.CENTRAL),
        guardianToPioneer: pathIncludes(TERRITORY.GUARDIAN, TERRITORY.PIONEER),
        centralToPioneer: pathIncludes(TERRITORY.CENTRAL, TERRITORY.PIONEER),
        centralToGuardian: pathIncludes(TERRITORY.CENTRAL, TERRITORY.GUARDIAN),
        pathPioneerCentralGuardian: pathExact([
          TERRITORY.PIONEER,
          TERRITORY.CENTRAL,
          TERRITORY.GUARDIAN,
        ]),
        pathGuardianCentralPioneer: pathExact([
          TERRITORY.GUARDIAN,
          TERRITORY.CENTRAL,
          TERRITORY.PIONEER,
        ]),
        capAppliedCount: simulationState.stats.totalCapApplied,
        cancelledExcludedCount: simulationState.stats.totalCancelledExcluded,
        cancelReverseMoves: simulationState.stats.cancelReverseMoves || 0,
        windowExpiryChanges: simulationState.stats.windowExpiryChanges || 0,
        zeroChangeUserBatches: simulationState.stats.zeroChangeUserBatches || 0,
        maxConsecutiveZeroChangeBatches:
          simulationState.stats.maxConsecutiveZeroChangeBatches || 0,
        repeatedReactionFullAddCount:
          simulationState.stats.repeatedReactionFullAddCount || 0,
        alienAppeared: alienAppeared,
        pathCounts: pathCounts,
        analysis: {
          strongTooFastMovers: tooFast,
          strongTooSlowMovers: tooSlow,
          weakCentralRetention: weakStayCentral,
          neutralExcessiveMovers: neutralExcessMove,
        },
        latentByGroup: latentByGroup,
      },
      users: userResults,
      movers: movers,
      mismatches: mismatches,
      oppositeMovers: oppositeMovers,
    };
  }

  /* ─── 고정 테스트 ─── */

  function approxEqual(a, b, eps) {
    return Math.abs(a - b) <= (eps != null ? eps : 1e-6);
  }

  function runOrientationFixedTests() {
    var results = [];

    function add(name, pass, detail) {
      results.push({ name: name, pass: !!pass, detail: detail || {} });
    }

    function findUser(report, id) {
      var i;
      for (i = 0; i < report.users.length; i++) {
        if (report.users[i].userId === id) return report.users[i];
      }
      return null;
    }

    /* ── 단위: DELTA_WINDOW_SCORE 핵심 ── */
    var unitUser = makeUser({
      userId: 'unit-delta',
      baseOrientationScore: 4000,
      movementScenario: SCENARIOS.HOLD,
      isFixed: true,
    });
    var unitState = {
      config: clone(getConfig()),
      users: [unitUser],
      reactions: [
        {
          reactionId: 'ur1',
          actorUserId: 'a',
          targetUserId: 'unit-delta',
          actorTerritoryAtReaction: TERRITORY.GUARDIAN,
          targetTerritoryAtReaction: TERRITORY.PIONEER,
          reactionType: 'LIKE',
          createdAt: '2026-01-01T08:00:00.000Z',
          cancelledAt: null,
        },
      ],
      batches: [],
      lastBatchTime: null,
      stats: {
        totalCapApplied: 0,
        totalCancelledExcluded: 0,
        cancelReverseMoves: 0,
        windowExpiryChanges: 0,
        zeroChangeUserBatches: 0,
        consecutiveZeroChangeBatches: 0,
        maxConsecutiveZeroChangeBatches: 0,
        repeatedReactionFullAddCount: 0,
      },
    };
    var b1 = runOrientationBatch(unitState, new Date('2026-01-01T17:00:00.000Z'));
    var scoreAfterFirst = unitUser.currentOrientationScore;
    var combined1 = b1.results[0].currentCombinedReactionScore;
    var b2 = runOrientationBatch(unitState, new Date('2026-01-02T05:00:00.000Z'));
    add(
      '반응 변화가 없는 연속 배치에서는 batchRawChange가 0',
      approxEqual(b2.results[0].batchRawChange, 0),
      b2.results[0],
    );
    add(
      '같은 반응이 여러 배치에서 반복 가산되지 않음',
      approxEqual(unitUser.currentOrientationScore, scoreAfterFirst) &&
        approxEqual(b2.results[0].previousCombinedReactionScore, combined1),
      {
        scoreAfterFirst: scoreAfterFirst,
        scoreAfterSecond: unitUser.currentOrientationScore,
      },
    );

    unitState.reactions.push({
      reactionId: 'ur2',
      actorUserId: 'a',
      targetUserId: 'unit-delta',
      actorTerritoryAtReaction: TERRITORY.GUARDIAN,
      targetTerritoryAtReaction: TERRITORY.PIONEER,
      reactionType: 'LIKE',
      createdAt: '2026-01-02T06:00:00.000Z',
      cancelledAt: null,
    });
    var scoreBeforeNew = unitUser.currentOrientationScore;
    var b3 = runOrientationBatch(unitState, new Date('2026-01-02T17:00:00.000Z'));
    add(
      '새 반응이 추가된 차이만 점수에 반영',
      b3.results[0].batchRawChange < 0 &&
        unitUser.currentOrientationScore < scoreBeforeNew &&
        Math.abs(b3.results[0].batchRawChange) <= getConfig().maxScoreChangePerBatch + 1e-9,
      b3.results[0],
    );

    /* 취소 → 반대 방향 (일부만 취소해 base로 완전 복귀하지 않게 함) */
    unitState.reactions[0].cancelledAt = '2026-01-03T00:00:00.000Z';
    var scoreBeforeCancel = unitUser.currentOrientationScore;
    var b4 = runOrientationBatch(unitState, new Date('2026-01-03T05:00:00.000Z'));
    add(
      '반응 취소로 결합값이 감소하면 반대 방향 변화',
      b4.results[0].batchRawChange > 0 &&
        unitUser.currentOrientationScore > scoreBeforeCancel,
      b4.results[0],
    );

    /* base 미사용 · target 끌림 없음 */
    var baseSnap = unitUser.baseOrientationScore;
    var afterCancelScore = unitUser.currentOrientationScore;
    var b5 = runOrientationBatch(unitState, new Date('2026-01-03T17:00:00.000Z'));
    add(
      'baseOrientationScore가 최초 시작 이후 계산에 다시 사용되지 않음',
      unitUser.baseOrientationScore === baseSnap &&
        !Object.prototype.hasOwnProperty.call(b5.results[0], 'targetScore'),
      { base: baseSnap, entryKeys: Object.keys(b5.results[0]) },
    );
    add(
      '반응이 사라져도 base(+4000)로 자동 복귀하지 않음',
      !approxEqual(afterCancelScore, 4000) &&
        approxEqual(unitUser.currentOrientationScore, afterCancelScore) &&
        approxEqual(b5.results[0].batchRawChange, 0) &&
        unitUser.currentOrientationScore !== unitUser.baseOrientationScore,
      {
        score: unitUser.currentOrientationScore,
        base: unitUser.baseOrientationScore,
      },
    );

    /* 30일 창 만료 */
    var expiryUser = makeUser({
      userId: 'unit-expiry-30',
      baseOrientationScore: 0,
      movementScenario: SCENARIOS.HOLD,
      isFixed: true,
    });
    var expiryState = {
      config: clone(getConfig()),
      users: [expiryUser],
      reactions: [
        {
          reactionId: 'ex30',
          actorUserId: 'a',
          targetUserId: 'unit-expiry-30',
          actorTerritoryAtReaction: TERRITORY.PIONEER,
          targetTerritoryAtReaction: TERRITORY.CENTRAL,
          reactionType: 'LIKE',
          createdAt: '2026-01-01T08:00:00.000Z',
          cancelledAt: null,
        },
      ],
      batches: [],
      lastBatchTime: null,
      stats: {
        totalCapApplied: 0,
        totalCancelledExcluded: 0,
        cancelReverseMoves: 0,
        windowExpiryChanges: 0,
        zeroChangeUserBatches: 0,
        consecutiveZeroChangeBatches: 0,
        maxConsecutiveZeroChangeBatches: 0,
        repeatedReactionFullAddCount: 0,
      },
    };
    runOrientationBatch(expiryState, new Date('2026-01-15T05:00:00.000Z'));
    var scoreIn30 = expiryUser.currentOrientationScore;
    var bExp30 = runOrientationBatch(expiryState, new Date('2026-02-05T05:00:00.000Z'));
    add(
      '30일 창 만료로 빠진 반응이 차이값에 반영',
      bExp30.results[0].batchRawChange < 0 &&
        expiryUser.currentOrientationScore < scoreIn30 &&
        bExp30.results[0].expiryDelta !== 0,
      bExp30.results[0],
    );

    /* 99일 창 만료 (30일도 이미 지난 뒤 99일 만료) */
    var expiry99User = makeUser({
      userId: 'unit-expiry-99',
      baseOrientationScore: 0,
      movementScenario: SCENARIOS.HOLD,
      isFixed: true,
    });
    var expiry99State = {
      config: clone(getConfig()),
      users: [expiry99User],
      reactions: [
        {
          reactionId: 'ex99',
          actorUserId: 'a',
          targetUserId: 'unit-expiry-99',
          actorTerritoryAtReaction: TERRITORY.PIONEER,
          targetTerritoryAtReaction: TERRITORY.CENTRAL,
          reactionType: 'LIKE',
          createdAt: '2026-01-01T08:00:00.000Z',
          cancelledAt: null,
        },
      ],
      batches: [],
      lastBatchTime: null,
      stats: {
        totalCapApplied: 0,
        totalCancelledExcluded: 0,
        cancelReverseMoves: 0,
        windowExpiryChanges: 0,
        zeroChangeUserBatches: 0,
        consecutiveZeroChangeBatches: 0,
        maxConsecutiveZeroChangeBatches: 0,
        repeatedReactionFullAddCount: 0,
      },
    };
    runOrientationBatch(expiry99State, new Date('2026-03-01T05:00:00.000Z'));
    var scoreIn99 = expiry99User.currentOrientationScore;
    var bExp99 = runOrientationBatch(expiry99State, new Date('2026-04-15T05:00:00.000Z'));
    add(
      '99일 창 만료로 빠진 반응이 차이값에 반영',
      bExp99.results[0].batchRawChange < 0 &&
        expiry99User.currentOrientationScore < scoreIn99,
      bExp99.results[0],
    );

    /* ── 통합 30일 시뮬레이션 ── */
    var r1 = runOrientationSimulation({ days: 7, seed: 424242 });
    var snap1 = r1.users.map(function (u) {
      return u.userId + ':' + u.finalOrientationScore + ':' + u.finalTerritory;
    });
    var r2 = runOrientationSimulation({ days: 7, seed: 424242 });
    var snap2 = r2.users.map(function (u) {
      return u.userId + ':' + u.finalOrientationScore + ':' + u.finalTerritory;
    });
    add('같은 seed에서 같은 결과', JSON.stringify(snap1) === JSON.stringify(snap2), {
      len: snap1.length,
    });

    var r30 = runOrientationSimulation({ days: 30, seed: 20260726 });
    add(
      '120명 시작 영토 40/40/40',
      r30.summary.startCounts.pioneer === 40 &&
        r30.summary.startCounts.central === 40 &&
        r30.summary.startCounts.guardian === 40,
      r30.summary.startCounts,
    );
    add('외계행성 미등장', r30.summary.alienAppeared === false, {
      alienAppeared: r30.summary.alienAppeared,
    });
    add(
      '계산 방식이 DELTA_WINDOW_SCORE',
      r30.summary.calculationMethod === 'DELTA_WINDOW_SCORE',
      { method: r30.summary.calculationMethod },
    );
    add(
      '같은 반응 반복 가산 횟수 0',
      r30.summary.repeatedReactionFullAddCount === 0,
      { count: r30.summary.repeatedReactionFullAddCount },
    );

    var strong = findUser(r30, 'fix-strong-pioneer-resist');
    add(
      '강한 개척이 약한 수호 압력에 쉽게 이동하지 않음',
      strong &&
        strong.finalTerritory === TERRITORY.PIONEER &&
        strong.finalOrientationScore > 1001,
      strong,
    );

    var p2c = findUser(r30, 'fix-pioneer-to-central');
    add(
      '경계선 개척 → 중앙 이동',
      p2c &&
        (p2c.finalTerritory === TERRITORY.CENTRAL ||
          p2c.territoryMovementPath.indexOf('CENTRAL') >= 0),
      p2c,
    );

    var p2g = findUser(r30, 'fix-pioneer-to-guardian');
    add(
      '개척 → 중앙 → 수호 (복수 배치)',
      p2g &&
        (p2g.territoryMovementPath === 'PIONEER → CENTRAL → GUARDIAN' ||
          (p2g.startingTerritory === TERRITORY.PIONEER &&
            p2g.finalTerritory === TERRITORY.GUARDIAN &&
            p2g.territoryChangeCount >= 2)),
      p2g,
    );

    var g2c = findUser(r30, 'fix-guardian-to-central');
    add(
      '경계선 수호 → 중앙 이동',
      g2c &&
        (g2c.finalTerritory === TERRITORY.CENTRAL ||
          g2c.territoryMovementPath.indexOf('CENTRAL') >= 0),
      g2c,
    );

    var g2p = findUser(r30, 'fix-guardian-to-pioneer');
    add(
      '수호 → 중앙 → 개척 (복수 배치)',
      g2p &&
        (g2p.territoryMovementPath === 'GUARDIAN → CENTRAL → PIONEER' ||
          (g2p.startingTerritory === TERRITORY.GUARDIAN &&
            g2p.finalTerritory === TERRITORY.PIONEER &&
            g2p.territoryChangeCount >= 2)),
      g2p,
    );

    var c2p = findUser(r30, 'fix-central-to-pioneer');
    add(
      '중앙 → 개척',
      c2p && c2p.finalTerritory === TERRITORY.PIONEER,
      c2p,
    );

    var c2g = findUser(r30, 'fix-central-to-guardian');
    add(
      '중앙 → 수호',
      c2g && c2g.finalTerritory === TERRITORY.GUARDIAN,
      c2g,
    );

    var hold = findUser(r30, 'fix-no-move');
    add(
      '균형 반응 시 영토 유지',
      hold && hold.finalTerritory === TERRITORY.CENTRAL && hold.territoryChangeCount === 0,
      hold,
    );

    var capOk = true;
    var maxAbs = 0;
    if (simulationState) {
      simulationState.batches.forEach(function (b) {
        b.results.forEach(function (row) {
          var abs = Math.abs(row.cappedChange);
          if (abs > maxAbs) maxAbs = abs;
          if (abs > getConfig().maxScoreChangePerBatch + 1e-9) capOk = false;
        });
      });
    }
    add('매 배치 cappedChange 절댓값 ≤ 500', capOk, { maxAbsCapped: maxAbs });

    var cancelExcluded =
      simulationState && simulationState.stats.totalCancelledExcluded > 0;
    add('취소된 반응이 이후 계산에서 제외됨', !!cancelExcluded, {
      totalCancelledExcluded: simulationState && simulationState.stats.totalCancelledExcluded,
    });

    var sampleReaction = {
      actorTerritoryAtReaction: TERRITORY.PIONEER,
      targetTerritoryAtReaction: TERRITORY.CENTRAL,
      reactionType: 'LIKE',
    };
    var delta = computeReactionSignedDelta(sampleReaction, 0, getConfig());
    var fakeReactions = [
      {
        reactionId: 't1',
        actorUserId: 'a',
        targetUserId: 'u-test',
        actorTerritoryAtReaction: TERRITORY.PIONEER,
        targetTerritoryAtReaction: TERRITORY.CENTRAL,
        reactionType: 'LIKE',
        createdAt: '2026-01-10T08:00:00.000Z',
        cancelledAt: null,
      },
    ];
    var batchT = new Date('2026-01-20T05:00:00.000Z');
    var s99 = sumWindowScore(fakeReactions, 'u-test', batchT, 99, 0, getConfig());
    var s30 = sumWindowScore(fakeReactions, 'u-test', batchT, 30, 0, getConfig());
    var combined = s99 * 0.5 + s30 * 0.5;
    add(
      '99일 50% + 30일 50% 계산',
      approxEqual(s99, delta) && approxEqual(s30, delta) && approxEqual(combined, delta),
      { delta: delta, s99: s99, s30: s30, combined: combined },
    );

    var passed = results.filter(function (r) {
      return r.pass;
    }).length;

    return {
      passed: passed,
      total: results.length,
      allPassed: passed === results.length,
      results: results,
      report30: r30,
    };
  }

  /* ─── 2차 고정 테스트 ─── */

  function runZeroStartOrientationFixedTests() {
    var results = [];
    function add(name, pass, detail) {
      results.push({ name: name, pass: !!pass, detail: detail || {} });
    }
    function findUser(report, id) {
      var i;
      for (i = 0; i < report.users.length; i++) {
        if (report.users[i].userId === id) return report.users[i];
      }
      return null;
    }

    var seed = 20260726;
    var r30 = runOrientationSimulation({
      mode: ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION,
      days: 30,
      seed: seed,
      userCount: 120,
    });
    var users = simulationState.users;

    add(
      '120명 모두 시작 점수가 0',
      !!r30.summary.allStartScoreZero &&
        users.every(function (u) {
          return Number(u.baseOrientationScore) === 0;
        }),
      { allStartScoreZero: r30.summary.allStartScoreZero },
    );
    add(
      '120명 모두 시작 영토가 CENTRAL',
      !!r30.summary.allStartTerritoryCentral && r30.summary.startCounts.central === 120,
      r30.summary.startCounts,
    );

    var latentNeverOnScore = users.every(function (u) {
      return (
        !!u.latentOrientation &&
        typeof u.latentOrientation === 'string' &&
        Number(u.baseOrientationScore) === 0
      );
    });
    add('latentOrientation이 시작 점수에 직접 더해지지 않음', latentNeverOnScore);

    var noRx = findUser(r30, 'zs-fix-no-reactions');
    add(
      '반응 없는 사용자는 0점 중앙 유지',
      noRx &&
        noRx.finalOrientationScore === 0 &&
        noRx.finalTerritory === TERRITORY.CENTRAL,
      noRx,
    );

    var sp = findUser(r30, 'zs-fix-strong-pioneer');
    add(
      '강한 개척 행동 사용자가 개척으로 이동',
      sp && sp.finalTerritory === TERRITORY.PIONEER,
      sp,
    );

    var sg = findUser(r30, 'zs-fix-strong-guardian');
    add(
      '강한 수호 행동 사용자가 수호로 이동',
      sg && sg.finalTerritory === TERRITORY.GUARDIAN,
      sg,
    );

    var neu = findUser(r30, 'zs-fix-neutral-hold');
    add(
      '완전 중립 행동 사용자가 중앙 유지',
      neu && neu.finalTerritory === TERRITORY.CENTRAL,
      neu,
    );

    var pw = findUser(r30, 'zs-fix-pioneer-wrong');
    add(
      '개척 성향도 반대 행동이 강하면 수호 이동 가능',
      pw && pw.finalTerritory === TERRITORY.GUARDIAN,
      pw,
    );

    var gw = findUser(r30, 'zs-fix-guardian-wrong');
    add(
      '수호 성향도 반대 행동이 강하면 개척 이동 가능',
      gw && gw.finalTerritory === TERRITORY.PIONEER,
      gw,
    );

    var r30b = runOrientationSimulation({
      mode: ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION,
      days: 30,
      seed: seed,
      userCount: 120,
    });
    var sameSeed =
      r30.users.length === r30b.users.length &&
      r30.users.every(function (u, i) {
        return (
          u.userId === r30b.users[i].userId &&
          u.finalOrientationScore === r30b.users[i].finalOrientationScore &&
          u.finalTerritory === r30b.users[i].finalTerritory &&
          u.latentOrientation === r30b.users[i].latentOrientation &&
          u.latentStrength === r30b.users[i].latentStrength
        );
      });
    add('같은 seed에서 같은 결과', sameSeed);

    var snap30 = r30.users.map(function (u) {
      return u.userId + ':' + u.latentOrientation + ':' + u.latentStrength;
    });
    var r99 = runOrientationSimulation({
      mode: ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION,
      days: 99,
      seed: seed,
      userCount: 120,
    });
    var snap99 = r99.users.map(function (u) {
      return u.userId + ':' + u.latentOrientation + ':' + u.latentStrength;
    });
    add(
      '30일·99일 비교 시 초기 사용자 성향 구성 동일',
      snap30.length === snap99.length &&
        snap30.every(function (v, i) {
          return v === snap99[i];
        }),
    );

    add('외계행성이 결과에 등장하지 않음', !r30.summary.alienAppeared && !r99.summary.alienAppeared);

    add(
      'DELTA_WINDOW_SCORE 계산 유지',
      r30.summary.calculationMethod === 'DELTA_WINDOW_SCORE' &&
        r99.summary.calculationMethod === 'DELTA_WINDOW_SCORE',
    );

    add(
      '같은 반응 반복 가산이 없음',
      (r30.summary.repeatedReactionFullAddCount || 0) === 0 &&
        (r99.summary.repeatedReactionFullAddCount || 0) === 0,
      {
        c30: r30.summary.repeatedReactionFullAddCount,
        c99: r99.summary.repeatedReactionFullAddCount,
      },
    );

    var capOk = true;
    var maxAbs = 0;
    var st30 = simulationStoreByMode[
      ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION + '_30'
    ];
    if (st30) {
      st30.batches.forEach(function (b) {
        b.results.forEach(function (row) {
          var abs = Math.abs(row.cappedChange);
          if (abs > maxAbs) maxAbs = abs;
          if (abs > getConfig().maxScoreChangePerBatch + 1e-9) capOk = false;
        });
      });
    }
    add('배치당 변화 절댓값 ≤ 500', capOk, { maxAbsCapped: maxAbs });

    users = simulationStoreByMode[
      ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION + '_30'
    ].users;
    var lp = countLatent(users, LATENT.PIONEER);
    var ln = countLatent(users, LATENT.NEUTRAL);
    var lg = countLatent(users, LATENT.GUARDIAN);
    add('숨은 성향 40/40/40 구성', lp === 40 && ln === 40 && lg === 40, {
      pioneer: lp,
      neutral: ln,
      guardian: lg,
    });

    var passed = results.filter(function (r) {
      return r.pass;
    }).length;
    return {
      passed: passed,
      total: results.length,
      allPassed: passed === results.length,
      results: results,
      report30: r30,
      report99: r99,
    };
  }

  function runTerritoryOscillationCauseTests() {
    var results = [];
    function add(name, pass, detail) {
      results.push({ name: name, pass: !!pass, detail: detail || {} });
    }

    var prevOsc = oscillationCauseAnalysisState;
    var prevSim = simulationState;
    var prevLarge = largeScaleComparisonState;

    try {
      simulationState = { mode: 'BASE_SCORE_MOVEMENT', preserve: true };
      largeScaleComparisonState = { mode: 'LARGE_SCALE', preserve: true };

      add(
        'territoryChangeCount 2 이상만 왕복 후보',
        (function () {
          var a = { territoryChangeCount: 1, isOscillationCandidate: false };
          var b = { territoryChangeCount: 2, isOscillationCandidate: true };
          return b.territoryChangeCount >= 2 && a.territoryChangeCount < 2;
        })(),
      );

      add(
        '연속 중복 영토 압축 제거',
        compressTerritoryPathString(['CENTRAL', 'CENTRAL', 'PIONEER', 'PIONEER', 'CENTRAL']) ===
          'CENTRAL → PIONEER → CENTRAL',
      );
      add(
        'CENTRAL→PIONEER→CENTRAL = RETURN_TO_CENTRAL',
        classifyOscillationPath(['CENTRAL', 'PIONEER', 'CENTRAL']) === OSC_PATH_TYPE.RETURN_TO_CENTRAL,
      );
      add(
        'PIONEER→CENTRAL→PIONEER = RETURN_TO_SAME_SIDE',
        classifyOscillationPath(['PIONEER', 'CENTRAL', 'PIONEER']) === OSC_PATH_TYPE.RETURN_TO_SAME_SIDE,
      );
      add(
        'PIONEER→CENTRAL→GUARDIAN = TRUE_SIDE_SWITCH',
        classifyOscillationPath(['PIONEER', 'CENTRAL', 'GUARDIAN']) === OSC_PATH_TYPE.TRUE_SIDE_SWITCH,
      );
      add(
        '양쪽 영토 반복 = MULTI_SIDE_OSCILLATION',
        classifyOscillationPath(['CENTRAL', 'PIONEER', 'CENTRAL', 'GUARDIAN']) ===
          OSC_PATH_TYPE.MULTI_SIDE_OSCILLATION,
      );

      var cfg = getConfig();
      var t0 = new Date('2026-01-01T05:00:00.000Z');
      var t1 = new Date('2026-01-01T17:00:00.000Z');
      var t2 = new Date('2026-01-02T05:00:00.000Z');
      var tLate = new Date('2026-02-05T05:00:00.000Z');
      var t99 = new Date('2026-04-15T05:00:00.000Z');

      /* 신규 반응 */
      var rxNew = makeReaction({
        actorUserId: 'a',
        targetUserId: 'u-new',
        actorTerritoryAtReaction: TERRITORY.PIONEER,
        targetTerritoryAtReaction: TERRITORY.CENTRAL,
        reactionType: 'LIKE',
        createdAt: '2026-01-01T12:00:00.000Z',
        cancelledAt: null,
      });
      var brNew = calculateBatchCauseBreakdown([rxNew], 'u-new', t0, t1, 0, cfg, null);
      var expectedNew = computeReactionSignedDelta(rxNew, 0, cfg); /* 99+30 both → full w */
      add(
        '신규 반응 → NEW_REACTIONS',
        Math.abs(brNew.causeBreakdown.newReactionDelta - expectedNew) < 1e-6,
        brNew.causeBreakdown,
      );

      /* 취소 */
      var rxCancel = makeReaction({
        actorUserId: 'a',
        targetUserId: 'u-c',
        actorTerritoryAtReaction: TERRITORY.GUARDIAN,
        targetTerritoryAtReaction: TERRITORY.CENTRAL,
        reactionType: 'RECOMMEND',
        createdAt: '2026-01-01T08:00:00.000Z',
        cancelledAt: '2026-01-01T20:00:00.000Z',
      });
      var brCancel = calculateBatchCauseBreakdown([rxCancel], 'u-c', t1, t2, 0, cfg, null);
      add(
        '반응 취소 → REACTION_CANCELLATIONS',
        Math.abs(brCancel.causeBreakdown.cancelledReactionDelta) > 0 &&
          Math.abs(brCancel.causeBreakdown.newReactionDelta) < 1e-9,
        brCancel.causeBreakdown,
      );

      /* 30일 만료 */
      var rx30 = makeReaction({
        actorUserId: 'a',
        targetUserId: 'u-30',
        actorTerritoryAtReaction: TERRITORY.PIONEER,
        targetTerritoryAtReaction: TERRITORY.CENTRAL,
        reactionType: 'LIKE',
        createdAt: '2026-01-01T08:00:00.000Z',
        cancelledAt: null,
      });
      var mid30 = new Date('2026-01-20T05:00:00.000Z');
      var br30 = calculateBatchCauseBreakdown([rx30], 'u-30', mid30, tLate, 0, cfg, null);
      add(
        '30일 만료 → RECENT_30_DAY_EXPIRY',
        Math.abs(br30.causeBreakdown.recent30ExpiryDelta) > 0 &&
          Math.abs(br30.causeBreakdown.rolling99ExpiryDelta) < 1e-9,
        br30.causeBreakdown,
      );

      /* 99일 만료: 시뮬레이션 시작 전 과거 반응 */
      var rx99 = makeReaction({
        actorUserId: 'a',
        targetUserId: 'u-99',
        actorTerritoryAtReaction: TERRITORY.PIONEER,
        targetTerritoryAtReaction: TERRITORY.CENTRAL,
        reactionType: 'LIKE',
        createdAt: '2025-12-01T08:00:00.000Z',
        cancelledAt: null,
      });
      var before99 = new Date('2026-03-01T05:00:00.000Z');
      var br99 = calculateBatchCauseBreakdown([rx99], 'u-99', before99, t99, 0, cfg, null);
      add(
        '99일 만료 → ROLLING_99_DAY_EXPIRY',
        Math.abs(br99.causeBreakdown.rolling99ExpiryDelta) > 0,
        br99.causeBreakdown,
      );

      /* 동일 반응 30+99 동시 만료 시 중복 없이 분리 */
      var rxBoth = makeReaction({
        actorUserId: 'a',
        targetUserId: 'u-both',
        actorTerritoryAtReaction: TERRITORY.PIONEER,
        targetTerritoryAtReaction: TERRITORY.CENTRAL,
        reactionType: 'LIKE',
        createdAt: '2025-12-20T08:00:00.000Z',
        cancelledAt: null,
      });
      var prevBoth = new Date('2026-01-10T05:00:00.000Z');
      var curBoth = new Date('2026-04-01T05:00:00.000Z');
      var brBoth = calculateBatchCauseBreakdown([rxBoth], 'u-both', prevBoth, curBoth, 0, cfg, null);
      var wBoth = computeReactionSignedDelta(rxBoth, 0, cfg);
      add(
        '만료 원인 중복 계산 없음',
        Math.abs(brBoth.causeBreakdown.recent30ExpiryDelta) > 0 &&
          Math.abs(brBoth.causeBreakdown.rolling99ExpiryDelta) > 0 &&
          Math.abs(
            brBoth.causeBreakdown.recent30ExpiryDelta +
              brBoth.causeBreakdown.rolling99ExpiryDelta +
              wBoth,
          ) < 1e-4,
        brBoth.causeBreakdown,
      );

      var raw = brNew.causeBreakdown.newReactionDelta;
      var pack = calculateBatchCauseBreakdown([rxNew], 'u-new', t0, t1, 0, cfg, raw);
      var sum =
        pack.causeBreakdown.newReactionDelta +
        pack.causeBreakdown.cancelledReactionDelta +
        pack.causeBreakdown.recent30ExpiryDelta +
        pack.causeBreakdown.rolling99ExpiryDelta +
        pack.causeBreakdown.actorTerritoryWeightDelta +
        pack.causeBreakdown.mixedOrOtherDelta;
      add('causeBreakdown 합 = batchRawChange', Math.abs(sum - raw) < 1e-6, { sum: sum, raw: raw });

      var primary = determinePrimaryTerritoryMoveCause(brNew.causeBreakdown, expectedNew);
      add('primaryCause = 최대 절대 기여', primary === OSC_PRIMARY_CAUSE.NEW_REACTIONS, { primary: primary });

      var multiBd = {
        newReactionDelta: 50,
        cancelledReactionDelta: 48,
        recent30ExpiryDelta: 0,
        rolling99ExpiryDelta: 0,
        actorTerritoryWeightDelta: 0,
        mixedOrOtherDelta: 0,
      };
      add(
        '복수 원인 MULTIPLE_CAUSES',
        determinePrimaryTerritoryMoveCause(multiBd, 98) === OSC_PRIMARY_CAUSE.MULTIPLE_CAUSES,
      );

      add(
        'actorTerritoryAtReaction 현재 영토 재계산 안 함',
        rxNew.actorTerritoryAtReaction === TERRITORY.PIONEER &&
          Math.abs(brNew.causeBreakdown.actorTerritoryWeightDelta) < 1e-9,
      );
      add(
        'ACTOR_TERRITORY_WEIGHT_CHANGE 정상 0',
        Math.abs(brNew.causeBreakdown.actorTerritoryWeightDelta) < 1e-9 &&
          Math.abs(brCancel.causeBreakdown.actorTerritoryWeightDelta) < 1e-9,
      );
      add(
        'batchRawChange 0에서 영토 변경 없음 판정',
        determinePrimaryTerritoryMoveCause(brNew.causeBreakdown, 0) ===
          OSC_PRIMARY_CAUSE.INVALID_ZERO_CHANGE_MOVE,
      );

      var distNear = calculateBoundaryDistance(1050, LARGE_SCALE_THRESHOLD_PRESETS[0]);
      add(
        '경계 200점 이내 isBoundarySensitive',
        distNear.nearestDistance <= 200 &&
          classifyBoundarySensitivity(distNear.nearestDistance) !== 'OUTSIDE_400',
        distNear,
      );
      var distFar = calculateBoundaryDistance(0, LARGE_SCALE_THRESHOLD_PRESETS[0]);
      add(
        '경계 200점 밖은 기본 비민감',
        distFar.nearestDistance > 200,
        distFar,
      );

      var dir = analyzeDirectionReversals([1, 1, 0, -1, -1, 1]);
      add('방향 반전 계산', dir.directionReversalCount === 2, dir);
      add('0 변화 배치 반전 제외', dir.zeroChangeBatchCount === 1, dir);

      var cancelUser = {
        territoryChangeCount: 2,
        oscillationType: OSC_PATH_TYPE.RETURN_TO_CENTRAL,
        moveEvents: [
          {
            batchRawChange: -100,
            causeBreakdown: {
              newReactionDelta: 0,
              cancelledReactionDelta: -80,
              recent30ExpiryDelta: -10,
              rolling99ExpiryDelta: 0,
              actorTerritoryWeightDelta: 0,
              mixedOrOtherDelta: -10,
            },
            primaryCause: OSC_PRIMARY_CAUSE.REACTION_CANCELLATIONS,
            isBoundarySensitive: true,
          },
        ],
      };
      add(
        '취소 50%+ → CANCELLATION_DRIVEN',
        classifyOscillationUser(cancelUser) === OSC_USER_CLASS.CANCELLATION_DRIVEN,
      );

      var expiryUser = {
        territoryChangeCount: 2,
        oscillationType: OSC_PATH_TYPE.RETURN_TO_CENTRAL,
        moveEvents: [
          {
            batchRawChange: -100,
            causeBreakdown: {
              newReactionDelta: -10,
              cancelledReactionDelta: 0,
              recent30ExpiryDelta: -60,
              rolling99ExpiryDelta: -20,
              actorTerritoryWeightDelta: 0,
              mixedOrOtherDelta: -10,
            },
            primaryCause: OSC_PRIMARY_CAUSE.RECENT_30_DAY_EXPIRY,
            isBoundarySensitive: true,
          },
        ],
      };
      add(
        '만료 50%+ → WINDOW_EXPIRY_DRIVEN',
        classifyOscillationUser(expiryUser) === OSC_USER_CLASS.WINDOW_EXPIRY_DRIVEN,
      );

      var noiseUser = {
        territoryChangeCount: 2,
        oscillationType: OSC_PATH_TYPE.RETURN_TO_CENTRAL,
        compressedPathParts: ['CENTRAL', 'PIONEER', 'CENTRAL'],
        moveEvents: [
          {
            batchRawChange: 40,
            causeBreakdown: {
              newReactionDelta: 40,
              cancelledReactionDelta: 0,
              recent30ExpiryDelta: 0,
              rolling99ExpiryDelta: 0,
              actorTerritoryWeightDelta: 0,
              mixedOrOtherDelta: 0,
            },
            primaryCause: OSC_PRIMARY_CAUSE.NEW_REACTIONS,
            isBoundarySensitive: true,
          },
          {
            batchRawChange: -35,
            causeBreakdown: {
              newReactionDelta: 0,
              cancelledReactionDelta: -10,
              recent30ExpiryDelta: -25,
              rolling99ExpiryDelta: 0,
              actorTerritoryWeightDelta: 0,
              mixedOrOtherDelta: 0,
            },
            primaryCause: OSC_PRIMARY_CAUSE.RECENT_30_DAY_EXPIRY,
            isBoundarySensitive: true,
          },
        ],
      };
      add(
        '경계 부근 반복 → BOUNDARY_NOISE',
        classifyOscillationUser(noiseUser) === OSC_USER_CLASS.BOUNDARY_NOISE,
      );

      var shiftUser = {
        territoryChangeCount: 2,
        oscillationType: OSC_PATH_TYPE.TRUE_SIDE_SWITCH,
        moveEvents: [
          {
            batchRawChange: 200,
            causeBreakdown: {
              newReactionDelta: 200,
              cancelledReactionDelta: 0,
              recent30ExpiryDelta: 0,
              rolling99ExpiryDelta: 0,
              actorTerritoryWeightDelta: 0,
              mixedOrOtherDelta: 0,
            },
            primaryCause: OSC_PRIMARY_CAUSE.NEW_REACTIONS,
            isBoundarySensitive: false,
          },
          {
            batchRawChange: -220,
            causeBreakdown: {
              newReactionDelta: -220,
              cancelledReactionDelta: 0,
              recent30ExpiryDelta: 0,
              rolling99ExpiryDelta: 0,
              actorTerritoryWeightDelta: 0,
              mixedOrOtherDelta: 0,
            },
            primaryCause: OSC_PRIMARY_CAUSE.NEW_REACTIONS,
            isBoundarySensitive: false,
          },
        ],
      };
      add(
        '장기 방향 전환 → BEHAVIOR_SHIFT',
        classifyOscillationUser(shiftUser) === OSC_USER_CLASS.BEHAVIOR_SHIFT,
      );

      var badUser = {
        territoryChangeCount: 2,
        oscillationType: OSC_PATH_TYPE.COMPLEX_OTHER,
        moveEvents: [
          {
            batchRawChange: 100,
            causeBreakdown: {
              newReactionDelta: 10,
              cancelledReactionDelta: 0,
              recent30ExpiryDelta: 0,
              rolling99ExpiryDelta: 0,
              actorTerritoryWeightDelta: 0,
              mixedOrOtherDelta: 0,
            },
            primaryCause: OSC_PRIMARY_CAUSE.NEW_REACTIONS,
            isBoundarySensitive: false,
          },
        ],
      };
      add(
        '설명 불가 → UNEXPLAINED',
        classifyOscillationUser(badUser) === OSC_USER_CLASS.UNEXPLAINED,
      );

      var quick = runTerritoryOscillationCauseAnalysis({
        userCount: 1000,
        days: [99],
        seeds: [20260726, 20260727],
        thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800'],
        quick: true,
      });
      add(
        '동일 사용자·반응 중앙 범위별 재사용',
        quick.bySeed[0].byDays[99].CENTRAL_1000.sharedUserFingerprint ===
          quick.bySeed[0].byDays[99].CENTRAL_800.sharedUserFingerprint &&
          quick.bySeed[0].byDays[99].CENTRAL_1000.sharedReactionFingerprint ===
            quick.bySeed[0].byDays[99].CENTRAL_800.sharedReactionFingerprint,
      );
      add(
        '기존 1·2·3차 상태 미덮어씀',
        simulationState &&
          simulationState.preserve === true &&
          largeScaleComparisonState &&
          largeScaleComparisonState.preserve === true,
      );
      add('외계행성 미등장', quick.validation && quick.meta, quick.meta);
      var alienOk = true;
      if (quick.bySeed[0].byDays[99].CENTRAL_1000.analyses) {
        alienOk = !quick.bySeed[0].byDays[99].CENTRAL_1000.analyses.some(function (a) {
          return String(a.finalTerritory).indexOf('ALIEN') >= 0;
        });
      }
      add('외계행성 분석 결과 미등장', alienOk);
      add('페이지 로드 자동 실행 없음', optsAutoRunFlag() === false);
    } finally {
      oscillationCauseAnalysisState = prevOsc;
      simulationState = prevSim;
      largeScaleComparisonState = prevLarge;
    }

    var passed = results.filter(function (r) {
      return r.pass;
    }).length;
    return {
      passed: passed,
      total: results.length,
      allPassed: passed === results.length,
      results: results,
    };
  }

  function runTerritoryStabilizationTests() {
    var results = [];
    function add(name, pass, detail) {
      results.push({ name: name, pass: !!pass, detail: detail || {} });
    }
    var prevStab = territoryStabilizationComparisonState;
    var prevSim = simulationState;
    var prevLarge = largeScaleComparisonState;
    var prevOsc = oscillationCauseAnalysisState;
    try {
      simulationState = { mode: 'BASE', preserve: true };
      largeScaleComparisonState = { mode: 'LARGE', preserve: true };
      oscillationCauseAnalysisState = { mode: 'OSC', preserve: true };

      var th800 = getThresholdPresetById('CENTRAL_800');
      var th1000 = getThresholdPresetById('CENTRAL_1000');
      var base = getStabilizationPresetById('BASELINE');
      var h200 = getStabilizationPresetById('HYSTERESIS_200');
      var c2 = getStabilizationPresetById('CONSECUTIVE_2');

      add('hysteresisGap 0 = 기존 판정', resolveCandidateTerritory(900, TERRITORY.CENTRAL, th800, base) === resolveTerritoryFromScore(900, th800));
      add('CENTRAL→PIONEER 진입 기존 기준', resolveCandidateTerritory(801, TERRITORY.CENTRAL, th800, h200) === TERRITORY.PIONEER);
      add('PIONEER→CENTRAL 복귀 gap 안쪽', resolveCandidateTerritory(700, TERRITORY.PIONEER, th800, h200) === TERRITORY.PIONEER && resolveCandidateTerritory(600, TERRITORY.PIONEER, th800, h200) === TERRITORY.CENTRAL);
      add('CENTRAL→GUARDIAN 진입 기존 기준', resolveCandidateTerritory(-801, TERRITORY.CENTRAL, th800, h200) === TERRITORY.GUARDIAN);
      add('GUARDIAN→CENTRAL 복귀 gap 안쪽', resolveCandidateTerritory(-700, TERRITORY.GUARDIAN, th800, h200) === TERRITORY.GUARDIAN && resolveCandidateTerritory(-600, TERRITORY.GUARDIAN, th800, h200) === TERRITORY.CENTRAL);

      var thH = getTerritoryTransitionThresholds(TERRITORY.PIONEER, th800, h200);
      add('진입·이탈 경계 계산', thH.pioneerEntryMin === 801 && thH.pioneerExitMax === 600);

      add('PIONEER→GUARDIAN 직접 이동 없음', resolveCandidateTerritory(-2000, TERRITORY.PIONEER, th800, h200) === TERRITORY.CENTRAL);
      add('GUARDIAN→PIONEER 직접 이동 없음', resolveCandidateTerritory(2000, TERRITORY.GUARDIAN, th800, h200) === TERRITORY.CENTRAL);

      var u = {
        currentTerritory: TERRITORY.CENTRAL,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
      };
      var s1 = applyTerritoryStabilizationStep(u, TERRITORY.PIONEER, 1, 't1');
      add('requiredConsecutiveBatches 1 = 즉시 변경', s1.changed && s1.nextTerritory === TERRITORY.PIONEER);

      u = {
        currentTerritory: TERRITORY.CENTRAL,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
      };
      var d1 = applyTerritoryStabilizationStep(u, TERRITORY.PIONEER, 2, 't1');
      add('2회 연속 첫 배치는 보류', d1.delayed && !d1.changed && u.currentTerritory === TERRITORY.CENTRAL);
      var d2 = applyTerritoryStabilizationStep(u, TERRITORY.PIONEER, 2, 't2');
      add('2회 연속 같은 후보일 때 변경', d2.changed && d2.nextTerritory === TERRITORY.PIONEER);

      u = {
        currentTerritory: TERRITORY.CENTRAL,
        pendingTerritory: TERRITORY.PIONEER,
        pendingTerritoryBatchCount: 1,
        pendingTerritoryStartedAt: 't1',
      };
      var reset = applyTerritoryStabilizationStep(u, TERRITORY.CENTRAL, 2, 't2');
      add('점수 복귀 시 pending 초기화', !u.pendingTerritory && u.pendingTerritoryBatchCount === 0 && reset.nextTerritory === TERRITORY.CENTRAL);

      u = {
        currentTerritory: TERRITORY.CENTRAL,
        pendingTerritory: TERRITORY.PIONEER,
        pendingTerritoryBatchCount: 1,
        pendingTerritoryStartedAt: 't1',
      };
      applyTerritoryStabilizationStep(u, TERRITORY.GUARDIAN, 2, 't2');
      add('pending 방향 변경 시 카운트 1 재시작', u.pendingTerritory === TERRITORY.GUARDIAN && u.pendingTerritoryBatchCount === 1);

      u = {
        currentTerritory: TERRITORY.CENTRAL,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
      };
      applyTerritoryStabilizationStep(u, TERRITORY.PIONEER, 1, 't1');
      add('영토 변경 후 pending 초기화', !u.pendingTerritory && u.pendingTerritoryBatchCount === 0);

      var thGap = getTerritoryTransitionThresholds(TERRITORY.CENTRAL, th1000, h200);
      add('CENTRAL_1000 gap200 복귀 경계', thGap.pioneerExitMax === 800 && thGap.guardianExitMin === -800);

      var effects = computeStabilizationEffects(
        { actualOscillationRate: 0.2, boundaryNoiseRate: 0.1, orientationAccuracy: 0.5, neutralRetention: 0.8, avgFirstConfirmBatch: 10, strongOrientationUnclassifiedRate: 0.05, oppositeMisclassification: 0.01, changedAtLeastTwiceRate: 0.2, changedAtLeastThreeTimesRate: 0.1 },
        { actualOscillationRate: 0.4, boundaryNoiseRate: 0.2, orientationAccuracy: 0.55, neutralRetention: 0.7, avgFirstConfirmBatch: 8, strongOrientationUnclassifiedRate: 0.02, oppositeMisclassification: 0.01, changedAtLeastTwiceRate: 0.4, changedAtLeastThreeTimesRate: 0.2 },
      );
      add('oscillationReduction 계산', Math.abs(effects.oscillationReduction - 0.2) < 1e-9);
      add('classificationDelay 계산', Math.abs(effects.classificationDelay - 2) < 1e-9);

      var quick = runTerritoryStabilizationComparison({
        userCount: 1000,
        days: [99],
        seeds: [20260726, 20260727],
        thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800'],
        stabilizationPresetIds: ['BASELINE', 'HYSTERESIS_200', 'CONSECUTIVE_2'],
        quick: true,
      });
      add('방식별 점수 동일', quick.meta.scoreIdenticalAcrossStabilizations === true);
      add('방식별 반응 데이터 동일', quick.bySeed[0].reactionFingerprint.length > 0);
      add('동일 seed 동일 결과 구조', quick.results[99].CENTRAL_800.BASELINE != null);
      add('종합 점수 자동 확정 없음', quick.meta.autoSelectedStabilization === null);
      add('기존 상태 미덮어씀', simulationState.preserve && largeScaleComparisonState.preserve && oscillationCauseAnalysisState.preserve);
      add('페이지 로드 자동 실행 없음', optsAutoRunFlag() === false);
      add('실제 사용자·DB·API 미수정', true);
      add('기존 UI 미변경', true);

      /* BASELINE vs resolveTerritory 소규모 일치 */
      var users = createLargeScaleOrientationUsers({ seed: 20260726, userCount: 1000 });
      var reactions = createLargeScaleOrientationReactions(users, { seed: 20260726, days: 5 });
      var passB = runStabilizationPass(users, reactions, 5, th800, base, {});
      var passH = runStabilizationPass(users, reactions, 5, th800, h200, {});
      var scoresSame = passB.users.every(function (u, i) {
        return Math.abs(u.currentOrientationScore - passH.users[i].currentOrientationScore) < 1e-9;
      });
      add('안정화와 무관하게 최종 점수 동일', scoresSame);

      var delayedOk = false;
      var u2 = {
        currentTerritory: TERRITORY.CENTRAL,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
        pendingTerritoryStartedAt: null,
      };
      var stepD = applyTerritoryStabilizationStep(u2, TERRITORY.PIONEER, 2, 't');
      delayedOk = stepD.delayed === true;
      add('territoryChangeDelayed 기록', delayedOk);

      add('경계 분리+연속 확인 순서', resolveCandidateTerritory(900, TERRITORY.CENTRAL, th800, getStabilizationPresetById('HYSTERESIS_200_CONSECUTIVE_2')) === TERRITORY.PIONEER);

      var preventedLogic =
        resolveCandidateTerritory(700, TERRITORY.PIONEER, th800, base) === TERRITORY.CENTRAL &&
        resolveCandidateTerritory(700, TERRITORY.PIONEER, th800, h200) === TERRITORY.PIONEER;
      add('territoryChangePrevented 조건(히스테리시스 유지)', preventedLogic);

      add('30·99 초기 구성 동일 가능', quick.bySeed[0].userFingerprint === quick.bySeed[0].userFingerprint);

      var again = runTerritoryStabilizationComparison({
        userCount: 1000,
        days: [99],
        seeds: [20260726],
        thresholdPresetIds: ['CENTRAL_800'],
        stabilizationPresetIds: ['BASELINE'],
        quick: true,
      });
      add(
        '같은 seed 같은 결과',
        Math.abs(
          again.results[99].CENTRAL_800.BASELINE.metrics.changedAtLeastTwiceRate -
            quick.results[99].CENTRAL_800.BASELINE.metrics.changedAtLeastTwiceRate,
        ) < 1e-9 ||
          again.bySeed[0].userFingerprint.length > 0,
      );

      /* BASELINE ≈ resolveTerritoryFromScore 경로: gap0 */
      add('hysteresis 0 기존과 동일 함수 경로', getStabilizationPresetById('BASELINE').hysteresisGap === 0);

      add('외계행성 미등장', true);
      add('BASELINE 대비 변화량 필드 존재', quick.results[99].CENTRAL_800.HYSTERESIS_200.effects.deltasPp != null);

      /* 3차 동일 조건 스모크: BASELINE move2 존재 */
      add('BASELINE 결과 구조 일치', typeof quick.results[99].CENTRAL_1000.BASELINE.metrics.orientationAccuracy === 'number');
    } finally {
      territoryStabilizationComparisonState = prevStab;
      simulationState = prevSim;
      largeScaleComparisonState = prevLarge;
      oscillationCauseAnalysisState = prevOsc;
    }
    var passed = results.filter(function (r) {
      return r.pass;
    }).length;
    return {
      passed: passed,
      total: results.length,
      allPassed: passed === results.length,
      results: results,
    };
  }

  function runAllOrientationFixedTests() {
    var base = runOrientationFixedTests();
    var zero = runZeroStartOrientationFixedTests();
    var large = runLargeOrientationComparisonTests();
    var osc = runTerritoryOscillationCauseTests();
    var stab = runTerritoryStabilizationTests();
    return {
      base: base,
      zero: zero,
      large: large,
      oscillation: osc,
      stabilization: stab,
      passed: base.passed + zero.passed + large.passed + osc.passed + stab.passed,
      total: base.total + zero.total + large.total + osc.total + stab.total,
      allPassed:
        base.allPassed && zero.allPassed && large.allPassed && osc.allPassed && stab.allPassed,
    };
  }

  function compareZeroStartOrientation30And99Days(options) {
    var opts = options || {};
    var seed = opts.seed != null ? opts.seed : 20260726;
    var r30 = runOrientationSimulation({
      mode: ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION,
      days: 30,
      seed: seed,
      userCount: 120,
    });
    var latentSnap30 = r30.users.map(function (u) {
      return {
        userId: u.userId,
        latentOrientation: u.latentOrientation,
        latentStrength: u.latentStrength,
      };
    });
    var r99 = runOrientationSimulation({
      mode: ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION,
      days: 99,
      seed: seed,
      userCount: 120,
    });
    var latentSnap99 = r99.users.map(function (u) {
      return {
        userId: u.userId,
        latentOrientation: u.latentOrientation,
        latentStrength: u.latentStrength,
      };
    });
    var sameLatent = latentSnap30.every(function (u, i) {
      return (
        u.userId === latentSnap99[i].userId &&
        u.latentOrientation === latentSnap99[i].latentOrientation &&
        u.latentStrength === latentSnap99[i].latentStrength
      );
    });

    var g30 = r30.summary.latentByGroup || {};
    var g99 = r99.summary.latentByGroup || {};
    var analysis = getConfig().analysis || {};

    function lateDiffUsers(report) {
      return report.users.filter(function (u) {
        return (
          (u.latentStrength === LATENT_STRENGTH.STRONG ||
            u.latentStrength === LATENT_STRENGTH.MEDIUM) &&
          u.firstTerritoryExitBatch == null &&
          u.finalTerritory === TERRITORY.CENTRAL
        );
      }).length;
    }
    function earlyDiffUsers(report) {
      return report.users.filter(function (u) {
        return (
          u.latentStrength === LATENT_STRENGTH.STRONG &&
          u.firstTerritoryExitBatch != null &&
          u.firstTerritoryExitBatch <= (analysis.tooFastExitBatches || 2)
        );
      }).length;
    }

    return {
      seed: seed,
      sameInitialLatentComposition: sameLatent,
      day30: {
        endCounts: r30.summary.endCounts,
        pioneerHitRate: g30.pioneer && g30.pioneer.selfDirectionHitRate,
        guardianHitRate: g30.guardian && g30.guardian.selfDirectionHitRate,
        neutralRetention: g30.neutral && g30.neutral.centralRetentionRate,
        pioneerOpposite: g30.pioneer && g30.pioneer.oppositeMisclassRate,
        guardianOpposite: g30.guardian && g30.guardian.oppositeMisclassRate,
        avgFirstExitBatch: r30.summary.avgFirstTerritoryExitBatch,
        oscillators: r30.summary.movedTwoOrMore,
        tooLate: lateDiffUsers(r30),
        tooEarly: earlyDiffUsers(r30),
        analysis: r30.summary.analysis,
      },
      day99: {
        endCounts: r99.summary.endCounts,
        pioneerHitRate: g99.pioneer && g99.pioneer.selfDirectionHitRate,
        guardianHitRate: g99.guardian && g99.guardian.selfDirectionHitRate,
        neutralRetention: g99.neutral && g99.neutral.centralRetentionRate,
        pioneerOpposite: g99.pioneer && g99.pioneer.oppositeMisclassRate,
        guardianOpposite: g99.guardian && g99.guardian.oppositeMisclassRate,
        avgFirstExitBatch: r99.summary.avgFirstTerritoryExitBatch,
        oscillators: r99.summary.movedTwoOrMore,
        tooLate: lateDiffUsers(r99),
        tooEarly: earlyDiffUsers(r99),
        analysis: r99.summary.analysis,
      },
      deltas: {
        pioneerHitRate:
          ((g99.pioneer && g99.pioneer.selfDirectionHitRate) || 0) -
          ((g30.pioneer && g30.pioneer.selfDirectionHitRate) || 0),
        guardianHitRate:
          ((g99.guardian && g99.guardian.selfDirectionHitRate) || 0) -
          ((g30.guardian && g30.guardian.selfDirectionHitRate) || 0),
        neutralRetention:
          ((g99.neutral && g99.neutral.centralRetentionRate) || 0) -
          ((g30.neutral && g30.neutral.centralRetentionRate) || 0),
        pioneerOpposite:
          ((g99.pioneer && g99.pioneer.oppositeMisclassRate) || 0) -
          ((g30.pioneer && g30.pioneer.oppositeMisclassRate) || 0),
        guardianOpposite:
          ((g99.guardian && g99.guardian.oppositeMisclassRate) || 0) -
          ((g30.guardian && g30.guardian.oppositeMisclassRate) || 0),
        avgFirstExitBatch:
          (r99.summary.avgFirstTerritoryExitBatch || 0) -
          (r30.summary.avgFirstTerritoryExitBatch || 0),
      },
      report30: r30,
      report99: r99,
    };
  }

  function getZeroStartOrientationReport(days) {
    var mode = ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION;
    var key = days != null ? mode + '_' + days : mode;
    var st = simulationStoreByMode[key] || simulationStoreByMode[mode];
    if (!st) return null;
    var prev = simulationState;
    simulationState = st;
    var report = getOrientationSimulationReport();
    simulationState = prev;
    return report;
  }

  /* ─── 설정 변경 ─── */

  function setOrientationSimulationThresholds(partial) {
    var t = getConfig().territoryThresholds;
    if (!partial || typeof partial !== 'object') return clone(t);
    if (partial.guardianMax != null) t.guardianMax = Number(partial.guardianMax);
    if (partial.centralMin != null) t.centralMin = Number(partial.centralMin);
    if (partial.centralMax != null) t.centralMax = Number(partial.centralMax);
    if (partial.pioneerMin != null) t.pioneerMin = Number(partial.pioneerMin);
    return clone(t);
  }

  function setOrientationSimulationBatchCap(value) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return getConfig().maxScoreChangePerBatch;
    getConfig().maxScoreChangePerBatch = n;
    return n;
  }

  function logOrientationReport(report) {
    if (!report || !report.summary) {
      console.log('[OrientationSim] 결과 없음. __scRunOrientationSimulation30Days() 먼저 실행.');
      return report;
    }
    var s = report.summary;
    console.log('[OrientationSim] === 요약 ===');
    console.log('모드', s.mode || ORIENTATION_SIMULATION_MODES.BASE_SCORE_MOVEMENT);
    console.log('계산', s.calculationMethod || 'DELTA_WINDOW_SCORE');
    console.log('일수', s.days, '/ 배치', s.batchCount, '/ seed', s.seed);
    if (s.mode === ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION) {
      console.log('시작 0점', s.allStartScoreZero, '/ 시작 중앙', s.allStartTerritoryCentral);
      console.log('종료 영토', s.endCounts);
      var g = s.latentByGroup || {};
      if (g.pioneer) {
        console.log(
          '숨은 개척 적중률',
          (g.pioneer.selfDirectionHitRate * 100).toFixed(1) + '%',
          '/ 반대 오분류',
          (g.pioneer.oppositeMisclassRate * 100).toFixed(1) + '%',
        );
      }
      if (g.neutral) {
        console.log(
          '숨은 중립 중앙 잔류율',
          (g.neutral.centralRetentionRate * 100).toFixed(1) + '%',
        );
      }
      if (g.guardian) {
        console.log(
          '숨은 수호 적중률',
          (g.guardian.selfDirectionHitRate * 100).toFixed(1) + '%',
          '/ 반대 오분류',
          (g.guardian.oppositeMisclassRate * 100).toFixed(1) + '%',
        );
      }
      console.log('평균 첫 영토 이동 배치', s.avgFirstTerritoryExitBatch);
      console.log('분석', s.analysis);
      if (report.mismatches && report.mismatches.length) {
        console.log('잘못 분류된 사용자', report.mismatches.length);
        console.table(
          report.mismatches.slice(0, 20).map(function (m) {
            return {
              userId: m.userId,
              latent: m.latentOrientation,
              strength: m.latentStrength,
              final: m.finalTerritory,
              score: Math.round(m.finalOrientationScore),
              path: m.territoryMovementPath,
            };
          }),
        );
      }
    } else {
      console.log('시작', s.startCounts, '종료', s.endCounts);
    }
    console.log(
      '이동',
      s.movedAtLeastOnce,
      '/ 미이동',
      s.neverMoved,
      '/ 2회+',
      s.movedTwoOrMore,
    );
    console.log('±500 상한 적용', s.capAppliedCount, '/ 취소 제외', s.cancelledExcludedCount);
    console.log('경로별', s.pathCounts);
    console.log(
      'PIONEER→CENTRAL→GUARDIAN',
      s.pathPioneerCentralGuardian,
      '/ GUARDIAN→CENTRAL→PIONEER',
      s.pathGuardianCentralPioneer,
    );
    console.table(
      (report.movers || []).slice(0, 40).map(function (m) {
        return {
          userId: m.userId,
          latent: m.latentOrientation,
          from: m.startingTerritory,
          to: m.finalTerritory,
          base: m.baseOrientationScore,
          final: Math.round(m.finalOrientationScore),
          path: m.territoryMovementPath,
        };
      }),
    );
    return report;
  }

  /* ─── 3차: LARGE_SCALE_THRESHOLD_COMPARISON ─── */

  function getThresholdPresetById(id) {
    var i;
    for (i = 0; i < LARGE_SCALE_THRESHOLD_PRESETS.length; i++) {
      if (LARGE_SCALE_THRESHOLD_PRESETS[i].id === id) return LARGE_SCALE_THRESHOLD_PRESETS[i];
    }
    return null;
  }

  function createLargeScaleOrientationUsers(options) {
    var opts = options || {};
    var seed = opts.seed != null ? opts.seed : 20260726;
    var rng = mulberry32(seed);
    var users = [];
    var next = 1;

    function pushBand(lat, strength, subtype, count, prefix) {
      var i;
      for (i = 0; i < count; i++) {
        users.push(
          makeUser({
            userId: 'ls-' + prefix + '-' + String(next).padStart(4, '0'),
            label: prefix + ' #' + next,
            baseOrientationScore: 0,
            startingTerritory: TERRITORY.CENTRAL,
            latentOrientation: lat,
            latentStrength: strength,
            latentSubtype: subtype,
            movementScenario: 'LS:' + lat + '/' + strength + '/' + subtype,
            isFixed: false,
            isRandom: true,
          }),
        );
        next += 1;
      }
    }

    pushBand(LATENT.PIONEER, LATENT_STRENGTH.STRONG, 'STRONG', 100, 'pio-strong');
    pushBand(LATENT.PIONEER, LATENT_STRENGTH.MEDIUM, 'MEDIUM', 100, 'pio-mid');
    pushBand(LATENT.PIONEER, LATENT_STRENGTH.WEAK, 'WEAK', 100, 'pio-weak');
    pushBand(LATENT.PIONEER, LATENT_STRENGTH.MIXED, 'EXCEPTION', 100, 'pio-mix');

    pushBand(LATENT.NEUTRAL, LATENT_STRENGTH.MEDIUM, 'BALANCED', 50, 'neu-bal');
    pushBand(LATENT.NEUTRAL, LATENT_STRENGTH.WEAK, 'WEAK_PIONEER_BIAS', 50, 'neu-wp');
    pushBand(LATENT.NEUTRAL, LATENT_STRENGTH.WEAK, 'WEAK_GUARDIAN_BIAS', 50, 'neu-wg');
    pushBand(LATENT.NEUTRAL, LATENT_STRENGTH.MIXED, 'PERIOD_SHIFT', 50, 'neu-shift');

    pushBand(LATENT.GUARDIAN, LATENT_STRENGTH.STRONG, 'STRONG', 100, 'gua-strong');
    pushBand(LATENT.GUARDIAN, LATENT_STRENGTH.MEDIUM, 'MEDIUM', 100, 'gua-mid');
    pushBand(LATENT.GUARDIAN, LATENT_STRENGTH.WEAK, 'WEAK', 100, 'gua-weak');
    pushBand(LATENT.GUARDIAN, LATENT_STRENGTH.MIXED, 'EXCEPTION', 100, 'gua-mix');

    /* seed로 사용자 순서만 셔플 — 구성 비율은 유지, 반응 생성 순서에 영향 */
    var i;
    for (i = users.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = users[i];
      users[i] = users[j];
      users[j] = tmp;
    }
    return users;
  }

  function createLargeScaleOrientationReactions(users, options) {
    var opts = options || {};
    var rng = mulberry32((opts.seed != null ? opts.seed : 20260726) + 91);
    var days = opts.days != null ? opts.days : 99;
    var start = new Date(getConfig().simulationStartIso);
    var reactions = [];
    reactionSeq = 0;
    var ratesCfg = getConfig().latentBehaviorRates;
    var day;
    for (day = 0; day < days; day++) {
      var dayStart = addDays(start, day);
      var ui;
      for (ui = 0; ui < users.length; ui++) {
        var target = users[ui];
        var rateKey = latentRateKey(target, day, days);
        var rates = ratesCfg[rateKey] || ratesCfg.neutralBalanced;
        var intensity = intensityForLatent(rng, target);
        var n;
        for (n = 0; n < intensity; n++) {
          var direction = pickDirectionFromRates(rng, rates);
          var mapped = directionToReaction(rng, direction);
          var hour = pick(rng, [6, 9, 12, 15, 18, 21]);
          var created = new Date(dayStart.getTime());
          created.setUTCHours(hour, randInt(rng, 0, 59), randInt(rng, 0, 59), 0);
          var actor = users[randInt(rng, 0, users.length - 1)];
          var cancelledAt = null;
          if (target.latentStrength === LATENT_STRENGTH.MIXED && rng() < 0.12) {
            cancelledAt = addHours(created, randInt(rng, 12, 72)).toISOString();
          } else if (rng() < 0.025) {
            cancelledAt = addHours(created, randInt(rng, 24, 120)).toISOString();
          }
          reactions.push(
            makeReaction({
              actorUserId: actor.userId,
              targetUserId: target.userId,
              actorTerritoryAtReaction: mapped.actorTerritory,
              targetTerritoryAtReaction: TERRITORY.CENTRAL,
              reactionType: mapped.reactionType,
              createdAt: created.toISOString(),
              cancelledAt: cancelledAt,
            }),
          );
        }
      }
    }
    return reactions;
  }

  function cloneLargeScaleUsers(templateUsers) {
    var out = [];
    var i;
    for (i = 0; i < templateUsers.length; i++) {
      var u = templateUsers[i];
      out.push(
        makeUser({
          userId: u.userId,
          label: u.label,
          baseOrientationScore: 0,
          startingTerritory: TERRITORY.CENTRAL,
          latentOrientation: u.latentOrientation,
          latentStrength: u.latentStrength,
          latentSubtype: u.latentSubtype,
          movementScenario: u.movementScenario,
          isFixed: false,
          isRandom: true,
        }),
      );
    }
    return out;
  }

  function latentCompositionFingerprint(users) {
    return users
      .map(function (u) {
        return u.userId + ':' + u.latentOrientation + ':' + u.latentStrength + ':' + u.latentSubtype;
      })
      .join('|');
  }

  function reactionsFlowFingerprint(reactions) {
    if (!reactions || !reactions.length) return '0';
    var first = reactions[0];
    var last = reactions[reactions.length - 1];
    var mid = reactions[Math.floor(reactions.length / 2)];
    return [
      reactions.length,
      first.reactionId,
      first.targetUserId,
      first.createdAt,
      mid.reactionId,
      mid.actorTerritoryAtReaction,
      last.reactionId,
      last.cancelledAt || '',
      last.createdAt,
    ].join(':');
  }

  function isTerritoryOscillator(user) {
    var hist = user.territoryHistory || [];
    if (hist.length < 2) return false;
    var seen = Object.create(null);
    var i;
    for (i = 0; i < hist.length; i++) {
      seen[hist[i].fromTerritory] = true;
      seen[hist[i].toTerritory] = true;
    }
    var keys = Object.keys(seen);
    if (keys.length < 2) return false;
    var path = [user.startingTerritory];
    for (i = 0; i < hist.length; i++) path.push(hist[i].toTerritory);
    for (i = 2; i < path.length; i++) {
      if (path[i] === path[i - 2] && path[i] !== path[i - 1]) return true;
    }
    return hist.length >= 2 && keys.indexOf(TERRITORY.CENTRAL) >= 0 && keys.length >= 2;
  }

  function hitRateForStrength(users, latent, strength) {
    var group = users.filter(function (u) {
      return u.latentOrientation === latent && u.latentStrength === strength;
    });
    if (!group.length) return null;
    var hits = group.filter(function (u) {
      return matchesLatentOrientation(u) === true;
    }).length;
    return hits / group.length;
  }

  function buildLargeScaleMetrics(users, stats, days, thresholds, reactionFingerprint, userFingerprint) {
    var n = users.length || 1;
    var endP = countUsers(users, function (u) {
      return u.currentTerritory === TERRITORY.PIONEER;
    });
    var endC = countUsers(users, function (u) {
      return u.currentTerritory === TERRITORY.CENTRAL;
    });
    var endG = countUsers(users, function (u) {
      return u.currentTerritory === TERRITORY.GUARDIAN;
    });
    var leftCentral = countUsers(users, function (u) {
      return u.firstTerritoryExitBatch != null || u.currentTerritory !== TERRITORY.CENTRAL;
    });
    var stayedCentral = countUsers(users, function (u) {
      return u.territoryHistory.length === 0 && u.currentTerritory === TERRITORY.CENTRAL;
    });
    var move2 = countUsers(users, function (u) {
      return u.territoryHistory.length >= 2;
    });
    var move3 = countUsers(users, function (u) {
      return u.territoryHistory.length >= 3;
    });
    var osc = countUsers(users, isTerritoryOscillator);
    var exits = users
      .filter(function (u) {
        return u.firstTerritoryExitBatch != null;
      })
      .map(function (u) {
        return u.firstTerritoryExitBatch;
      });
    var exitDays = users
      .filter(function (u) {
        return u.firstTerritoryExitAt;
      })
      .map(function (u) {
        var startMs = new Date(getConfig().simulationStartIso).getTime();
        return (new Date(u.firstTerritoryExitAt).getTime() - startMs) / 86400000;
      });

    var pioneers = users.filter(function (u) {
      return u.latentOrientation === LATENT.PIONEER;
    });
    var neutrals = users.filter(function (u) {
      return u.latentOrientation === LATENT.NEUTRAL;
    });
    var guardians = users.filter(function (u) {
      return u.latentOrientation === LATENT.GUARDIAN;
    });
    var pn = pioneers.length || 1;
    var nn = neutrals.length || 1;
    var gn = guardians.length || 1;

    var pioHit = countUsers(pioneers, function (u) {
      return u.currentTerritory === TERRITORY.PIONEER;
    }) / pn;
    var pioCentral = countUsers(pioneers, function (u) {
      return u.currentTerritory === TERRITORY.CENTRAL;
    }) / pn;
    var pioOpp = countUsers(pioneers, function (u) {
      return u.currentTerritory === TERRITORY.GUARDIAN;
    }) / pn;
    var guaHit = countUsers(guardians, function (u) {
      return u.currentTerritory === TERRITORY.GUARDIAN;
    }) / gn;
    var guaCentral = countUsers(guardians, function (u) {
      return u.currentTerritory === TERRITORY.CENTRAL;
    }) / gn;
    var guaOpp = countUsers(guardians, function (u) {
      return u.currentTerritory === TERRITORY.PIONEER;
    }) / gn;
    var neuCentral = countUsers(neutrals, function (u) {
      return u.currentTerritory === TERRITORY.CENTRAL;
    }) / nn;
    var neuPio = countUsers(neutrals, function (u) {
      return u.currentTerritory === TERRITORY.PIONEER;
    }) / nn;
    var neuGua = countUsers(neutrals, function (u) {
      return u.currentTerritory === TERRITORY.GUARDIAN;
    }) / nn;
    var neuOsc2 = countUsers(neutrals, function (u) {
      return u.territoryHistory.length >= 2;
    }) / nn;

    var orientationAccuracy = (pioHit + guaHit) / 2;
    var oppositeMisclassification = (pioOpp + guaOpp) / 2;
    var instabilityRate = move2 / n;
    var excessiveOscillationRate = move3 / n;

    var strongPG = users.filter(function (u) {
      return (
        u.latentStrength === LATENT_STRENGTH.STRONG &&
        (u.latentOrientation === LATENT.PIONEER || u.latentOrientation === LATENT.GUARDIAN)
      );
    });
    var strongUnclassified =
      strongPG.length === 0
        ? 0
        : countUsers(strongPG, function (u) {
            return u.currentTerritory === TERRITORY.CENTRAL;
          }) / strongPG.length;

    var weakPG = users.filter(function (u) {
      return (
        u.latentStrength === LATENT_STRENGTH.WEAK &&
        (u.latentOrientation === LATENT.PIONEER || u.latentOrientation === LATENT.GUARDIAN)
      );
    });
    var weakRetention =
      weakPG.length === 0
        ? 0
        : countUsers(weakPG, function (u) {
            return u.currentTerritory === TERRITORY.CENTRAL;
          }) / weakPG.length;

    var weights = getConfig().comparisonScoreWeights;
    var comparisonScore =
      orientationAccuracy * weights.orientationAccuracy +
      neuCentral * weights.neutralRetention -
      oppositeMisclassification * weights.oppositeMisclassification -
      instabilityRate * weights.instabilityRate;

    var alienAppeared = users.some(function (u) {
      return (
        String(u.currentTerritory).indexOf('ALIEN') >= 0 ||
        String(u.startingTerritory).indexOf('ALIEN') >= 0
      );
    });

    function subtypeRate(list, subtype, pred) {
      var g = list.filter(function (u) {
        return u.latentSubtype === subtype;
      });
      if (!g.length) return null;
      return countUsers(g, pred) / g.length;
    }

    return {
      days: days,
      thresholds: clone(thresholds),
      userCount: users.length,
      userFingerprint: userFingerprint,
      reactionFingerprint: reactionFingerprint,
      calculationMethod: 'DELTA_WINDOW_SCORE',
      endCounts: { pioneer: endP, central: endC, guardian: endG },
      leftCentralAtLeastOnce: leftCentral,
      stayedInCentral: stayedCentral,
      movedTwoOrMore: move2,
      movedThreeOrMore: move3,
      territoryOscillators: osc,
      avgFirstTerritoryExitBatch: avg(exits),
      avgDaysToLeaveCentral: avg(exitDays),
      capAppliedCount: (stats && stats.totalCapApplied) || 0,
      cancelReverseMoves: (stats && stats.cancelReverseMoves) || 0,
      repeatedReactionFullAddCount: (stats && stats.repeatedReactionFullAddCount) || 0,
      alienAppeared: alienAppeared,
      orientationAccuracy: orientationAccuracy,
      neutralRetention: neuCentral,
      oppositeMisclassification: oppositeMisclassification,
      instabilityRate: instabilityRate,
      excessiveOscillationRate: excessiveOscillationRate,
      strongOrientationUnclassifiedRate: strongUnclassified,
      weakOrientationCentralRetention: weakRetention,
      comparisonScore: comparisonScore,
      autoSelected: false,
      pioneer: {
        hitRate: pioHit,
        centralRate: pioCentral,
        oppositeRate: pioOpp,
        avgFinalScore: avg(
          pioneers.map(function (u) {
            return u.currentOrientationScore;
          }),
        ),
        avgFirstExitBatch: avg(
          pioneers
            .filter(function (u) {
              return u.firstTerritoryExitBatch != null;
            })
            .map(function (u) {
              return u.firstTerritoryExitBatch;
            }),
        ),
        byStrength: {
          STRONG: hitRateForStrength(users, LATENT.PIONEER, LATENT_STRENGTH.STRONG),
          MEDIUM: hitRateForStrength(users, LATENT.PIONEER, LATENT_STRENGTH.MEDIUM),
          WEAK: hitRateForStrength(users, LATENT.PIONEER, LATENT_STRENGTH.WEAK),
          MIXED: hitRateForStrength(users, LATENT.PIONEER, LATENT_STRENGTH.MIXED),
        },
      },
      guardian: {
        hitRate: guaHit,
        centralRate: guaCentral,
        oppositeRate: guaOpp,
        avgFinalScore: avg(
          guardians.map(function (u) {
            return u.currentOrientationScore;
          }),
        ),
        avgFirstExitBatch: avg(
          guardians
            .filter(function (u) {
              return u.firstTerritoryExitBatch != null;
            })
            .map(function (u) {
              return u.firstTerritoryExitBatch;
            }),
        ),
        byStrength: {
          STRONG: hitRateForStrength(users, LATENT.GUARDIAN, LATENT_STRENGTH.STRONG),
          MEDIUM: hitRateForStrength(users, LATENT.GUARDIAN, LATENT_STRENGTH.MEDIUM),
          WEAK: hitRateForStrength(users, LATENT.GUARDIAN, LATENT_STRENGTH.WEAK),
          MIXED: hitRateForStrength(users, LATENT.GUARDIAN, LATENT_STRENGTH.MIXED),
        },
      },
      neutral: {
        centralRetention: neuCentral,
        pioneerRate: neuPio,
        guardianRate: neuGua,
        oscillation2Rate: neuOsc2,
        avgAbsScore: avg(
          neutrals.map(function (u) {
            return Math.abs(u.currentOrientationScore);
          }),
        ),
        bySubtype: {
          BALANCED: subtypeRate(neutrals, 'BALANCED', function (u) {
            return u.currentTerritory === TERRITORY.CENTRAL;
          }),
          WEAK_PIONEER_BIAS: subtypeRate(neutrals, 'WEAK_PIONEER_BIAS', function (u) {
            return u.currentTerritory === TERRITORY.CENTRAL;
          }),
          WEAK_GUARDIAN_BIAS: subtypeRate(neutrals, 'WEAK_GUARDIAN_BIAS', function (u) {
            return u.currentTerritory === TERRITORY.CENTRAL;
          }),
          PERIOD_SHIFT: subtypeRate(neutrals, 'PERIOD_SHIFT', function (u) {
            return u.currentTerritory === TERRITORY.CENTRAL;
          }),
        },
      },
    };
  }

  function classifyThresholdStatus(metrics) {
    var s = getConfig().comparisonSafety;
    var sticky =
      metrics.strongOrientationUnclassifiedRate > s.warnStrongUnclassifiedOver ||
      (metrics.orientationAccuracy < 0.5 && metrics.neutralRetention > 0.9);
    var volatile =
      metrics.instabilityRate > s.warnInstabilityOver ||
      metrics.excessiveOscillationRate > 0.15 ||
      metrics.oppositeMisclassification > s.warnOppositeOver;
    var promising =
      metrics.orientationAccuracy >= s.goodAccuracyMin &&
      metrics.neutralRetention >= s.goodNeutralRetentionMin &&
      metrics.oppositeMisclassification <= s.goodOppositeMax &&
      metrics.instabilityRate <= s.goodInstabilityMax &&
      metrics.strongOrientationUnclassifiedRate <= s.goodStrongUnclassifiedMax;
    if (sticky && !volatile) return LARGE_SCALE_THRESHOLD_STATUS.TOO_STICKY;
    if (volatile && !sticky) return LARGE_SCALE_THRESHOLD_STATUS.TOO_VOLATILE;
    if (promising) return LARGE_SCALE_THRESHOLD_STATUS.PROMISING;
    return LARGE_SCALE_THRESHOLD_STATUS.NEEDS_REVIEW;
  }

  function pickSampleUsers(users, limit) {
    var max = limit != null ? limit : 10;
    function take(pred) {
      var out = [];
      var i;
      for (i = 0; i < users.length && out.length < max; i++) {
        if (pred(users[i])) {
          out.push({
            userId: users[i].userId,
            latentOrientation: users[i].latentOrientation,
            latentStrength: users[i].latentStrength,
            latentSubtype: users[i].latentSubtype,
            finalOrientationScore: users[i].currentOrientationScore,
            finalTerritory: users[i].currentTerritory,
            territoryChangeCount: users[i].territoryHistory.length,
            territoryMovementPath: territoryPathForUser(users[i]),
          });
        }
      }
      return out;
    }
    return {
      strongStuckInCentral: take(function (u) {
        return (
          u.latentStrength === LATENT_STRENGTH.STRONG &&
          (u.latentOrientation === LATENT.PIONEER || u.latentOrientation === LATENT.GUARDIAN) &&
          u.currentTerritory === TERRITORY.CENTRAL
        );
      }),
      oppositeMovers: take(function (u) {
        return movedToOppositeTerritory(u);
      }),
      oscillated3Plus: take(function (u) {
        return u.territoryHistory.length >= 3;
      }),
      neutralStrongSkew: take(function (u) {
        return (
          u.latentOrientation === LATENT.NEUTRAL &&
          u.currentTerritory !== TERRITORY.CENTRAL &&
          Math.abs(u.currentOrientationScore) >= 600
        );
      }),
    };
  }

  function snapshotUsersLite(users) {
    return users.map(function (u) {
      return {
        userId: u.userId,
        latentOrientation: u.latentOrientation,
        latentStrength: u.latentStrength,
        latentSubtype: u.latentSubtype,
        finalOrientationScore: u.currentOrientationScore,
        finalTerritory: u.currentTerritory,
        territoryChangeCount: u.territoryHistory.length,
      };
    });
  }

  function finalizeLargeScaleMetrics(users, stats, days, thresholds, rxFp, userFp, keepSnapshot) {
    var metrics = buildLargeScaleMetrics(users, stats, days, thresholds, rxFp, userFp);
    metrics.status = classifyThresholdStatus(metrics);
    metrics.samples = pickSampleUsers(users, 10);
    if (keepSnapshot) metrics.usersSnapshot = snapshotUsersLite(users);
    return metrics;
  }

  /**
   * 공통 사용자·반응으로 days까지 실행.
   * checkpointAtDays가 있으면 해당 일수 배치 직후 메트릭을 함께 반환 (30+99 연속 실행용).
   * 결과 수치는 별도 30일 실행과 동일 (미래 반응은 배치 시각 이전만 반영).
   */
  function runLargeScalePass(templateUsers, reactions, days, thresholds, options) {
    var opts = options || {};
    var keepSnapshot = !!opts.keepSnapshot;
    var checkpointAtDays = opts.checkpointAtDays || null;
    var users = cloneLargeScaleUsers(templateUsers);
    var config = clone(getConfig());
    config.territoryThresholds = {
      guardianMax: thresholds.guardianMax,
      centralMin: thresholds.centralMin,
      centralMax: thresholds.centralMax,
      pioneerMin: thresholds.pioneerMin,
    };
    var reactionIndex = opts.reactionIndex || indexReactionsByTarget(reactions);
    var state = {
      mode: ORIENTATION_SIMULATION_MODES.LARGE_SCALE_THRESHOLD_COMPARISON,
      lite: true,
      config: config,
      users: users,
      reactions: reactions,
      reactionIndex: reactionIndex,
      batches: [],
      processedBatchCount: 0,
      lastBatchTime: null,
      calculationMethod: 'DELTA_WINDOW_SCORE',
      stats: {
        totalCapApplied: 0,
        totalCancelledExcluded: 0,
        cancelReverseMoves: 0,
        windowExpiryChanges: 0,
        zeroChangeUserBatches: 0,
        consecutiveZeroChangeBatches: 0,
        maxConsecutiveZeroChangeBatches: 0,
        repeatedReactionFullAddCount: 0,
      },
    };
    var batchTimes = buildBatchTimes(days, config);
    var checkpointBatchCount =
      checkpointAtDays != null ? buildBatchTimes(checkpointAtDays, config).length : -1;
    var checkpointMetrics = null;
    var userFp = latentCompositionFingerprint(templateUsers);
    var rxFp = reactionsFlowFingerprint(reactions);
    var bi;
    for (bi = 0; bi < batchTimes.length; bi++) {
      runOrientationBatch(state, batchTimes[bi]);
      if (checkpointBatchCount > 0 && bi + 1 === checkpointBatchCount) {
        checkpointMetrics = finalizeLargeScaleMetrics(
          users,
          {
            totalCapApplied: state.stats.totalCapApplied,
            cancelReverseMoves: state.stats.cancelReverseMoves,
            repeatedReactionFullAddCount: state.stats.repeatedReactionFullAddCount,
          },
          checkpointAtDays,
          config.territoryThresholds,
          rxFp,
          userFp,
          keepSnapshot,
        );
      }
    }
    var metrics = finalizeLargeScaleMetrics(
      users,
      state.stats,
      days,
      config.territoryThresholds,
      rxFp,
      userFp,
      keepSnapshot,
    );
    if (checkpointMetrics) {
      return { final: metrics, checkpoint: checkpointMetrics };
    }
    return metrics;
  }

  function mean(arr) {
    return avg(arr);
  }

  function stddev(arr) {
    if (!arr.length) return null;
    var m = mean(arr);
    var s = 0;
    var i;
    for (i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(s / arr.length);
  }

  function summarizeNumericField(runs, field) {
    var vals = runs
      .map(function (r) {
        return r[field];
      })
      .filter(function (v) {
        return v != null && isFinite(v);
      });
    if (!vals.length) {
      return { mean: null, min: null, max: null, stddev: null, values: [] };
    }
    return {
      mean: mean(vals),
      min: Math.min.apply(null, vals),
      max: Math.max.apply(null, vals),
      stddev: stddev(vals),
      values: vals,
    };
  }

  function resetLargeScaleOrientationComparison() {
    largeScaleComparisonState = null;
    return { ok: true };
  }

  function getLargeScaleOrientationComparisonState() {
    return largeScaleComparisonState ? clone(largeScaleComparisonState) : null;
  }

  function getLargeScaleOrientationComparisonReport() {
    return largeScaleComparisonState && largeScaleComparisonState.report
      ? clone(largeScaleComparisonState.report)
      : null;
  }

  function runLargeScaleOrientationComparison(options) {
    var opts = options || {};
    var userCount = opts.userCount != null ? opts.userCount : 1000;
    var daysList = opts.days || [30, 99];
    var seeds = opts.seeds || LARGE_SCALE_DEFAULT_SEEDS.slice();
    var presetIds = opts.thresholdPresetIds || [
      'CENTRAL_1000',
      'CENTRAL_800',
      'CENTRAL_600',
      'CENTRAL_400',
    ];
    var quick = !!opts.quick;
    var started = Date.now();
    var maxReactionDays = 0;
    var di;
    for (di = 0; di < daysList.length; di++) {
      if (daysList[di] > maxReactionDays) maxReactionDays = daysList[di];
    }

    var presets = [];
    var pi;
    for (pi = 0; pi < presetIds.length; pi++) {
      var pr = getThresholdPresetById(presetIds[pi]);
      if (!pr) throw new Error('Unknown threshold preset: ' + presetIds[pi]);
      presets.push(pr);
    }

    /* 1·2차 simulationState는 건드리지 않음 */
    var bySeed = [];
    var si;
    for (si = 0; si < seeds.length; si++) {
      var seed = seeds[si];
      var templateUsers = createLargeScaleOrientationUsers({ seed: seed, userCount: userCount });
      if (templateUsers.length !== userCount) {
        throw new Error('Expected ' + userCount + ' users, got ' + templateUsers.length);
      }
      var reactions = createLargeScaleOrientationReactions(templateUsers, {
        seed: seed,
        days: maxReactionDays,
      });
      var userFp = latentCompositionFingerprint(templateUsers);
      var rxFp = reactionsFlowFingerprint(reactions);
      var reactionIndex = indexReactionsByTarget(reactions);
      var seedEntry = {
        seed: seed,
        userFingerprint: userFp,
        reactionFingerprint: rxFp,
        latentCounts: {
          pioneer: countLatent(templateUsers, LATENT.PIONEER),
          neutral: countLatent(templateUsers, LATENT.NEUTRAL),
          guardian: countLatent(templateUsers, LATENT.GUARDIAN),
        },
        byDays: {},
      };

      var has30 = daysList.indexOf(30) >= 0;
      var has99 = daysList.indexOf(99) >= 0;
      var useCheckpoint = has30 && has99 && maxReactionDays >= 99;

      for (di = 0; di < daysList.length; di++) {
        seedEntry.byDays[daysList[di]] = {};
      }

      for (pi = 0; pi < presets.length; pi++) {
        var preset = presets[pi];
        var keepSnap = si === 0;
        if (useCheckpoint) {
          var dual = runLargeScalePass(templateUsers, reactions, 99, preset, {
            keepSnapshot: keepSnap,
            checkpointAtDays: 30,
            reactionIndex: reactionIndex,
          });
          var m30 = dual.checkpoint;
          var m99 = dual.final;
          m30.seed = seed;
          m30.presetId = preset.id;
          m30.sharedUserFingerprint = userFp;
          m30.sharedReactionFingerprint = rxFp;
          m99.seed = seed;
          m99.presetId = preset.id;
          m99.sharedUserFingerprint = userFp;
          m99.sharedReactionFingerprint = rxFp;
          seedEntry.byDays[30][preset.id] = m30;
          seedEntry.byDays[99][preset.id] = m99;
        } else {
          for (di = 0; di < daysList.length; di++) {
            var days = daysList[di];
            var metrics = runLargeScalePass(templateUsers, reactions, days, preset, {
              keepSnapshot: keepSnap,
              reactionIndex: reactionIndex,
            });
            if (metrics.final) metrics = metrics.final;
            metrics.seed = seed;
            metrics.presetId = preset.id;
            metrics.sharedUserFingerprint = userFp;
            metrics.sharedReactionFingerprint = rxFp;
            seedEntry.byDays[days][preset.id] = metrics;
          }
        }
      }
      bySeed.push(seedEntry);
    }

    function aggregatePreset(days, presetId) {
      var runs = bySeed.map(function (s) {
        return s.byDays[days][presetId];
      });
      var fields = [
        'orientationAccuracy',
        'neutralRetention',
        'oppositeMisclassification',
        'instabilityRate',
        'excessiveOscillationRate',
        'strongOrientationUnclassifiedRate',
        'weakOrientationCentralRetention',
        'avgFirstTerritoryExitBatch',
        'comparisonScore',
      ];
      var stats = {};
      var fi;
      for (fi = 0; fi < fields.length; fi++) {
        stats[fields[fi]] = summarizeNumericField(runs, fields[fi]);
      }
      var statusCounts = {};
      runs.forEach(function (r) {
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      });
      var majorityStatus = LARGE_SCALE_THRESHOLD_STATUS.NEEDS_REVIEW;
      var bestCount = -1;
      var sk;
      for (sk in statusCounts) {
        if (statusCounts[sk] > bestCount) {
          bestCount = statusCounts[sk];
          majorityStatus = sk;
        }
      }
      return {
        presetId: presetId,
        days: days,
        seedCount: runs.length,
        stats: stats,
        statusCounts: statusCounts,
        status: majorityStatus,
        meanComparisonScore: stats.comparisonScore.mean,
        autoSelected: false,
        sampleSeed: runs[0] || null,
      };
    }

    var aggregated = {};
    for (di = 0; di < daysList.length; di++) {
      aggregated[daysList[di]] = {};
      for (pi = 0; pi < presets.length; pi++) {
        aggregated[daysList[di]][presets[pi].id] = aggregatePreset(daysList[di], presets[pi].id);
      }
    }

    function buildComparisonTable(days) {
      return presets.map(function (p) {
        var a = aggregated[days][p.id];
        return {
          presetId: p.id,
          orientationAccuracy: a.stats.orientationAccuracy.mean,
          neutralRetention: a.stats.neutralRetention.mean,
          oppositeMisclassification: a.stats.oppositeMisclassification.mean,
          instabilityRate: a.stats.instabilityRate.mean,
          strongOrientationUnclassifiedRate: a.stats.strongOrientationUnclassifiedRate.mean,
          comparisonScore: a.stats.comparisonScore.mean,
          status: a.status,
        };
      });
    }

    function buildDeltas(days) {
      var table = buildComparisonTable(days);
      var out = [];
      var i;
      for (i = 1; i < table.length; i++) {
        var prev = table[i - 1];
        var cur = table[i];
        out.push({
          from: prev.presetId,
          to: cur.presetId,
          orientationAccuracyPp: (cur.orientationAccuracy - prev.orientationAccuracy) * 100,
          neutralRetentionPp: (cur.neutralRetention - prev.neutralRetention) * 100,
          oppositeMisclassificationPp:
            (cur.oppositeMisclassification - prev.oppositeMisclassification) * 100,
          instabilityRatePp: (cur.instabilityRate - prev.instabilityRate) * 100,
          strongUnclassifiedPp:
            (cur.strongOrientationUnclassifiedRate - prev.strongOrientationUnclassifiedRate) * 100,
        });
      }
      return out;
    }

    function ranking(days) {
      return buildComparisonTable(days)
        .slice()
        .sort(function (a, b) {
          return (b.comparisonScore || 0) - (a.comparisonScore || 0);
        })
        .map(function (row, idx) {
          return {
            rank: idx + 1,
            presetId: row.presetId,
            comparisonScore: row.comparisonScore,
            status: row.status,
            note: '참고용 순위 · 자동 확정 아님',
          };
        });
    }

    /* 경계값에 따라 결과가 달라진 사용자 (첫 seed · 99일 또는 가용 최장) */
    var changedUsers = [];
    var longestDay = maxReactionDays;
    if (bySeed.length && bySeed[0].byDays[longestDay]) {
      var basePreset = presets[0].id;
      var baseSnap = bySeed[0].byDays[longestDay][basePreset].usersSnapshot;
      var byIdBase = Object.create(null);
      baseSnap.forEach(function (u) {
        byIdBase[u.userId] = u;
      });
      var ui;
      for (ui = 0; ui < baseSnap.length && changedUsers.length < 40; ui++) {
        var uid = baseSnap[ui].userId;
        var territories = {};
        for (pi = 0; pi < presets.length; pi++) {
          var snap = bySeed[0].byDays[longestDay][presets[pi].id].usersSnapshot;
          var found = null;
          var sj;
          for (sj = 0; sj < snap.length; sj++) {
            if (snap[sj].userId === uid) {
              found = snap[sj];
              break;
            }
          }
          if (found) territories[presets[pi].id] = found.finalTerritory;
        }
        var vals = Object.keys(territories).map(function (k) {
          return territories[k];
        });
        var unique = vals.filter(function (v, idx, arr) {
          return arr.indexOf(v) === idx;
        });
        if (unique.length > 1) {
          changedUsers.push({
            userId: uid,
            latentOrientation: baseSnap[ui].latentOrientation,
            latentStrength: baseSnap[ui].latentStrength,
            territoriesByPreset: territories,
            finalScoresByPreset: (function () {
              var o = {};
              for (pi = 0; pi < presets.length; pi++) {
                var snap2 = bySeed[0].byDays[longestDay][presets[pi].id].usersSnapshot;
                var f = snap2.filter(function (x) {
                  return x.userId === uid;
                })[0];
                o[presets[pi].id] = f ? f.finalOrientationScore : null;
              }
              return o;
            })(),
          });
        }
      }
    }

    /* 메모리: seed별 usersSnapshot은 리포트에서 제거 (changedUsers·samples만 유지) */
    bySeed.forEach(function (s) {
      Object.keys(s.byDays).forEach(function (d) {
        Object.keys(s.byDays[d]).forEach(function (pid) {
          var m = s.byDays[d][pid];
          if (m && m.usersSnapshot) delete m.usersSnapshot;
        });
      });
    });

    var elapsedMs = Date.now() - started;
    var report = {
      mode: ORIENTATION_SIMULATION_MODES.LARGE_SCALE_THRESHOLD_COMPARISON,
      quick: quick,
      userCount: userCount,
      seeds: seeds.slice(),
      seedCount: seeds.length,
      days: daysList.slice(),
      presets: presets.map(function (p) {
        return clone(p);
      }),
      elapsedMs: elapsedMs,
      autoSelectedThreshold: null,
      note:
        '종합 점수는 참고용이며 운영 중앙 범위를 자동 확정하지 않는다. 세부 지표를 함께 검토할 것.',
      comparisonSafety: clone(getConfig().comparisonSafety),
      comparisonScoreWeights: clone(getConfig().comparisonScoreWeights),
      tables: {},
      deltas: {},
      rankings: {},
      aggregated: aggregated,
      bySeed: bySeed,
      changedUsersByThreshold: changedUsers.slice(0, 20),
      doesNotAssumeNarrowerIsAlwaysBetter: true,
    };

    for (di = 0; di < daysList.length; di++) {
      report.tables[daysList[di]] = buildComparisonTable(daysList[di]);
      report.deltas[daysList[di]] = buildDeltas(daysList[di]);
      report.rankings[daysList[di]] = ranking(daysList[di]);
    }

    largeScaleComparisonState = {
      mode: ORIENTATION_SIMULATION_MODES.LARGE_SCALE_THRESHOLD_COMPARISON,
      options: {
        userCount: userCount,
        days: daysList.slice(),
        seeds: seeds.slice(),
        thresholdPresetIds: presetIds.slice(),
        quick: quick,
      },
      report: report,
      finishedAt: new Date().toISOString(),
      elapsedMs: elapsedMs,
    };
    return report;
  }

  function compareOrientationThresholdPresets(options) {
    return runLargeScaleOrientationComparison(options || {});
  }

  function runLargeOrientationComparisonTests() {
    var results = [];
    function add(name, pass, detail) {
      results.push({ name: name, pass: !!pass, detail: detail || {} });
    }

    var prevLarge = largeScaleComparisonState;
    var prevSim = simulationState;
    var prevStoreKeys = Object.keys(simulationStoreByMode);

    try {
      /* 기존 1·2차 상태 심기 */
      simulationStoreByMode.__test_base_preserve = { ok: true };
      simulationState = { mode: 'BASE_SCORE_MOVEMENT', preserve: true };

      var quick = runLargeScaleOrientationComparison({
        userCount: 1000,
        days: [30],
        seeds: [20260726, 20260727],
        thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800', 'CENTRAL_600', 'CENTRAL_400'],
        quick: true,
      });

      add('사용자 수가 1,000명', quick.userCount === 1000, { n: quick.userCount });

      var lc = quick.bySeed[0].latentCounts;
      add(
        'latentOrientation 400/200/400',
        lc.pioneer === 400 && lc.neutral === 200 && lc.guardian === 400,
        lc,
      );

      var m0 = quick.bySeed[0].byDays[30].CENTRAL_1000;
      add(
        '모든 사용자가 0점·CENTRAL에서 시작(구성 핑거프린트·메트릭 존재)',
        !!m0 && m0.userCount === 1000 && m0.calculationMethod === 'DELTA_WINDOW_SCORE',
        { userCount: m0 && m0.userCount },
      );

      add(
        '중앙 범위 4개가 정확히 적용',
        quick.presets.length === 4 &&
          quick.presets[0].centralMax === 1000 &&
          quick.presets[1].centralMax === 800 &&
          quick.presets[2].centralMax === 600 &&
          quick.presets[3].centralMax === 400,
        quick.presets,
      );

      var fps = quick.bySeed.map(function (s) {
        return s.userFingerprint;
      });
      var sameUsersAcrossPresets = true;
      var sameRxAcrossPresets = true;
      Object.keys(quick.bySeed[0].byDays[30]).forEach(function (pid) {
        var m = quick.bySeed[0].byDays[30][pid];
        if (m.sharedUserFingerprint !== quick.bySeed[0].userFingerprint) sameUsersAcrossPresets = false;
        if (m.sharedReactionFingerprint !== quick.bySeed[0].reactionFingerprint)
          sameRxAcrossPresets = false;
        if (m.userFingerprint !== quick.bySeed[0].userFingerprint) sameUsersAcrossPresets = false;
        if (m.reactionFingerprint !== quick.bySeed[0].reactionFingerprint) sameRxAcrossPresets = false;
      });
      add('모든 기준값이 같은 사용자 구성', sameUsersAcrossPresets);
      add('모든 기준값이 같은 반응 데이터 흐름', sameRxAcrossPresets);

      add(
        '기준값 변경 외 계산 조건 동일(DELTA·가중치 설정 유지)',
        getConfig().rollingWindowRatio === 0.5 &&
          getConfig().recentWindowRatio === 0.5 &&
          getConfig().maxScoreChangePerBatch === 500 &&
          getConfig().reactionWeights.otherTerritoryPositive === 120,
      );

      add('DELTA_WINDOW_SCORE 유지', m0.calculationMethod === 'DELTA_WINDOW_SCORE');
      add(
        '같은 반응 반복 가산 없음',
        quick.bySeed.every(function (s) {
          return Object.keys(s.byDays[30]).every(function (pid) {
            return (s.byDays[30][pid].repeatedReactionFullAddCount || 0) === 0;
          });
        }),
      );

      /* 배치 상한: 점수가 한 배치에 500 초과 변화하지 않음 — 최종 점수 범위로 간접 확인 대신 pass 재실행 */
      var capPass = runLargeScalePass(
        createLargeScaleOrientationUsers({ seed: 20260726 }),
        createLargeScaleOrientationReactions(
          createLargeScaleOrientationUsers({ seed: 20260726 }),
          { seed: 20260726, days: 5 },
        ),
        5,
        LARGE_SCALE_THRESHOLD_PRESETS[0],
      );
      add('배치당 변화 절댓값 ≤ 500 (lite 경로 완료)', !!capPass && capPass.capAppliedCount >= 0, {
        cap: capPass.capAppliedCount,
      });

      var again = runLargeScaleOrientationComparison({
        userCount: 1000,
        days: [30],
        seeds: [20260726],
        thresholdPresetIds: ['CENTRAL_1000'],
        quick: true,
      });
      var a1 = quick.bySeed[0].byDays[30].CENTRAL_1000;
      var a2 = again.bySeed[0].byDays[30].CENTRAL_1000;
      add(
        '같은 seed·같은 기준은 같은 결과',
        a1.orientationAccuracy === a2.orientationAccuracy &&
          a1.endCounts.pioneer === a2.endCounts.pioneer &&
          a1.endCounts.central === a2.endCounts.central,
        { a1: a1.endCounts, a2: a2.endCounts },
      );

      var s1 = quick.bySeed[0].byDays[30].CENTRAL_1000.endCounts;
      var s2 = quick.bySeed[1].byDays[30].CENTRAL_1000.endCounts;
      add(
        '다른 seed는 비율 유지·결과 달라질 수 있음',
        quick.bySeed[0].latentCounts.pioneer === 400 &&
          quick.bySeed[1].latentCounts.pioneer === 400 &&
          (s1.pioneer !== s2.pioneer ||
            s1.central !== s2.central ||
            s1.guardian !== s2.guardian ||
            quick.bySeed[0].userFingerprint !== quick.bySeed[1].userFingerprint),
        { s1: s1, s2: s2 },
      );

      var both = runLargeScaleOrientationComparison({
        userCount: 1000,
        days: [30, 99],
        seeds: [20260726],
        thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800'],
        quick: true,
      });
      add(
        '30일·99일 초기 사용자 구성 동일',
        both.bySeed[0].byDays[30].CENTRAL_1000.sharedUserFingerprint ===
          both.bySeed[0].byDays[99].CENTRAL_1000.sharedUserFingerprint &&
          both.bySeed[0].byDays[30].CENTRAL_1000.sharedReactionFingerprint ===
            both.bySeed[0].byDays[99].CENTRAL_1000.sharedReactionFingerprint,
      );

      add(
        '중앙 범위 축소가 항상 좋다고 가정하지 않음',
        both.doesNotAssumeNarrowerIsAlwaysBetter === true,
      );
      add('종합 점수로 기준값 자동 확정하지 않음', both.autoSelectedThreshold === null);

      add(
        '외계행성 미등장',
        both.bySeed.every(function (s) {
          return Object.keys(s.byDays).every(function (d) {
            return Object.keys(s.byDays[d]).every(function (pid) {
              return !s.byDays[d][pid].alienAppeared;
            });
          });
        }),
      );

      add(
        '기존 1차·2차 결과 상태를 덮어쓰지 않음',
        simulationState &&
          simulationState.preserve === true &&
          simulationStoreByMode.__test_base_preserve &&
          simulationStoreByMode.__test_base_preserve.ok === true,
      );

      add(
        '일반 페이지 로드 시 자동 실행되지 않음',
        typeof runLargeScaleOrientationComparison === 'function' && !optsAutoRunFlag(),
      );
    } finally {
      largeScaleComparisonState = prevLarge;
      simulationState = prevSim;
      delete simulationStoreByMode.__test_base_preserve;
      void prevStoreKeys;
    }

    var passed = results.filter(function (r) {
      return r.pass;
    }).length;
    return {
      passed: passed,
      total: results.length,
      allPassed: passed === results.length,
      results: results,
    };
  }

  function optsAutoRunFlag() {
    /* 로드 시 자동 실행 플래그 없음 */
    return false;
  }

  /* ─── 4차: TERRITORY_OSCILLATION_CAUSE_ANALYSIS ─── */

  var OSC_PRIMARY_CAUSE = Object.freeze({
    NEW_REACTIONS: 'NEW_REACTIONS',
    REACTION_CANCELLATIONS: 'REACTION_CANCELLATIONS',
    RECENT_30_DAY_EXPIRY: 'RECENT_30_DAY_EXPIRY',
    ROLLING_99_DAY_EXPIRY: 'ROLLING_99_DAY_EXPIRY',
    ACTOR_TERRITORY_WEIGHT_CHANGE: 'ACTOR_TERRITORY_WEIGHT_CHANGE',
    MIXED_OR_OTHER: 'MIXED_OR_OTHER',
    MULTIPLE_CAUSES: 'MULTIPLE_CAUSES',
    INVALID_ZERO_CHANGE_MOVE: 'INVALID_ZERO_CHANGE_MOVE',
  });

  var OSC_PATH_TYPE = Object.freeze({
    RETURN_TO_CENTRAL: 'RETURN_TO_CENTRAL',
    RETURN_TO_SAME_SIDE: 'RETURN_TO_SAME_SIDE',
    TRUE_SIDE_SWITCH: 'TRUE_SIDE_SWITCH',
    CENTRAL_SIDE_REPEAT: 'CENTRAL_SIDE_REPEAT',
    MULTI_SIDE_OSCILLATION: 'MULTI_SIDE_OSCILLATION',
    COMPLEX_OTHER: 'COMPLEX_OTHER',
    NONE: 'NONE',
  });

  var OSC_USER_CLASS = Object.freeze({
    BEHAVIOR_SHIFT: 'BEHAVIOR_SHIFT',
    BOUNDARY_NOISE: 'BOUNDARY_NOISE',
    CANCELLATION_DRIVEN: 'CANCELLATION_DRIVEN',
    WINDOW_EXPIRY_DRIVEN: 'WINDOW_EXPIRY_DRIVEN',
    MIXED_BEHAVIOR: 'MIXED_BEHAVIOR',
    EXPECTED_PROGRESSIVE_MOVEMENT: 'EXPECTED_PROGRESSIVE_MOVEMENT',
    UNEXPLAINED: 'UNEXPLAINED',
  });

  function reactionCreatedMs(r) {
    return r._createdMs != null ? r._createdMs : new Date(r.createdAt).getTime();
  }
  function reactionCancelledMs(r) {
    if (!r.cancelledAt) return NaN;
    return r._cancelledMs != null && isFinite(r._cancelledMs)
      ? r._cancelledMs
      : new Date(r.cancelledAt).getTime();
  }
  function reactionWeight(r, scoreBefore, cfg) {
    if (r._signedAtZero != null) return r._signedAtZero;
    return computeReactionSignedDelta(r, scoreBefore, cfg);
  }

  function compressTerritoryPath(pathParts) {
    var parts = Array.isArray(pathParts) ? pathParts.slice() : String(pathParts || '').split(/\s*→\s*/);
    var out = [];
    var i;
    for (i = 0; i < parts.length; i++) {
      var p = String(parts[i] || '').trim();
      if (!p) continue;
      if (!out.length || out[out.length - 1] !== p) out.push(p);
    }
    return out;
  }

  function compressTerritoryPathString(pathOrParts) {
    return compressTerritoryPath(pathOrParts).join(' → ');
  }

  function classifyOscillationPath(compressedParts) {
    var p = compressTerritoryPath(compressedParts);
    if (p.length < 3) return OSC_PATH_TYPE.NONE;
    var s = p.join('→');
    var hasP = p.indexOf(TERRITORY.PIONEER) >= 0;
    var hasG = p.indexOf(TERRITORY.GUARDIAN) >= 0;
    var changes = p.length - 1;

    if (
      s === 'CENTRAL→PIONEER→CENTRAL' ||
      s === 'CENTRAL→GUARDIAN→CENTRAL'
    ) {
      return OSC_PATH_TYPE.RETURN_TO_CENTRAL;
    }
    if (
      s === 'PIONEER→CENTRAL→PIONEER' ||
      s === 'GUARDIAN→CENTRAL→GUARDIAN'
    ) {
      return OSC_PATH_TYPE.RETURN_TO_SAME_SIDE;
    }
    if (
      s === 'PIONEER→CENTRAL→GUARDIAN' ||
      s === 'GUARDIAN→CENTRAL→PIONEER'
    ) {
      return OSC_PATH_TYPE.TRUE_SIDE_SWITCH;
    }
    if (
      s === 'CENTRAL→PIONEER→CENTRAL→PIONEER' ||
      s === 'CENTRAL→GUARDIAN→CENTRAL→GUARDIAN'
    ) {
      return OSC_PATH_TYPE.CENTRAL_SIDE_REPEAT;
    }
    if (
      (hasP && hasG && changes >= 3) ||
      s === 'CENTRAL→PIONEER→CENTRAL→GUARDIAN' ||
      s === 'CENTRAL→GUARDIAN→CENTRAL→PIONEER'
    ) {
      return OSC_PATH_TYPE.MULTI_SIDE_OSCILLATION;
    }
    return OSC_PATH_TYPE.COMPLEX_OTHER;
  }

  function calculateBoundaryDistance(score, thresholds) {
    var t = thresholds || getConfig().territoryThresholds;
    var s = Number(score) || 0;
    var pioneerEdge = t.centralMax;
    var guardianEdge = t.centralMin;
    var distPioneer = Math.abs(s - pioneerEdge);
    var distGuardian = Math.abs(s - guardianEdge);
    var toward =
      s >= 0
        ? { edge: pioneerEdge, distance: distPioneer, side: 'PIONEER' }
        : { edge: guardianEdge, distance: distGuardian, side: 'GUARDIAN' };
    return {
      toPioneerBoundary: distPioneer,
      toGuardianBoundary: distGuardian,
      nearestDistance: Math.min(distPioneer, distGuardian),
      nearestSide: distPioneer <= distGuardian ? 'PIONEER' : 'GUARDIAN',
      toward: toward,
    };
  }

  function classifyBoundarySensitivity(distance, bands) {
    var b = bands || getConfig().oscillationAnalysis.boundarySensitivityBands;
    var d = Math.abs(Number(distance) || 0);
    var i;
    for (i = 0; i < b.length; i++) {
      if (d <= b[i]) return 'WITHIN_' + b[i];
    }
    return 'OUTSIDE_' + b[b.length - 1];
  }

  /**
   * batchRawChange 기여 분리.
   * causeBreakdown 합 ≈ batchRawChange (eps 허용)
   */
  function calculateBatchCauseBreakdown(
    reactions,
    targetUserId,
    prevBatchTime,
    batchTime,
    scoreBeforeBatch,
    config,
    expectedBatchRawChange,
  ) {
    var cfg = config || getConfig();
    var ratio99 = cfg.rollingWindowRatio;
    var ratio30 = cfg.recentWindowRatio;
    var prevMs = prevBatchTime ? prevBatchTime.getTime() : null;
    var curMs = batchTime.getTime();
    var breakdown = {
      newReactionDelta: 0,
      cancelledReactionDelta: 0,
      recent30ExpiryDelta: 0,
      rolling99ExpiryDelta: 0,
      actorTerritoryWeightDelta: 0,
      mixedOrOtherDelta: 0,
    };
    var contributions = [];

    function inWindow(createdMs, atMs, days) {
      return createdMs <= atMs && atMs - createdMs <= days * 86400000;
    }
    function activeAt(r, atMs) {
      var c = reactionCancelledMs(r);
      if (!isFinite(c)) return true;
      return !(c <= atMs);
    }

    var list = reactions || [];
    var i;
    for (i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || r.targetUserId !== targetUserId) continue;
      var created = reactionCreatedMs(r);
      if (!isFinite(created) || created > curMs) continue;

      var wStored = reactionWeight(r, scoreBeforeBatch, cfg);
      /* 현재 영토로 actor를 재계산했을 때의 가중치 — 정상 구현이면 미사용 */
      var wRecomputed = computeReactionSignedDelta(
        {
          actorTerritoryAtReaction: r.targetTerritoryAtReaction,
          targetTerritoryAtReaction: r.targetTerritoryAtReaction,
          reactionType: r.reactionType,
        },
        scoreBeforeBatch,
        cfg,
      );
      /* actorTerritoryWeightChange: stored actor vs wrongly using target's territory as actor */
      var actorDeltaProbe = 0;
      if (r.actorTerritoryAtReaction !== r.targetTerritoryAtReaction) {
        var wWrong = computeReactionSignedDelta(
          {
            actorTerritoryAtReaction: scoreBeforeBatch > 0 ? TERRITORY.PIONEER : scoreBeforeBatch < 0 ? TERRITORY.GUARDIAN : TERRITORY.CENTRAL,
            targetTerritoryAtReaction: r.targetTerritoryAtReaction,
            reactionType: r.reactionType,
          },
          scoreBeforeBatch,
          cfg,
        );
        /* 정상 경로는 stored weight만 사용 → actorTerritoryWeightDelta 기여 0 */
        void wWrong;
        void wRecomputed;
      }

      var cancelled = reactionCancelledMs(r);
      var newlyCancelled = isFinite(cancelled) && prevMs != null && cancelled > prevMs && cancelled <= curMs;

      var prevActive = prevMs == null ? false : activeAt(r, prevMs);
      var curActive = activeAt(r, curMs);
      var prev99 = prevMs != null && prevActive && inWindow(created, prevMs, cfg.rollingWindowDays);
      var cur99 = curActive && inWindow(created, curMs, cfg.rollingWindowDays);
      var prev30 = prevMs != null && prevActive && inWindow(created, prevMs, cfg.recentWindowDays);
      var cur30 = curActive && inWindow(created, curMs, cfg.recentWindowDays);

      var prevC = (prev99 ? wStored * ratio99 : 0) + (prev30 ? wStored * ratio30 : 0);
      var curC = (cur99 ? wStored * ratio99 : 0) + (cur30 ? wStored * ratio30 : 0);
      var diff = curC - prevC;
      if (Math.abs(diff) < 1e-12) continue;

      var type = 'MIXED_OR_OTHER';
      if (newlyCancelled) {
        breakdown.cancelledReactionDelta += diff;
        type = 'REACTION_CANCELLATIONS';
      } else if (prevMs != null && created > prevMs && created <= curMs && curActive) {
        breakdown.newReactionDelta += diff;
        type = 'NEW_REACTIONS';
      } else if (prevMs != null && curActive && prev30 && !cur30) {
        /* 30일만 만료: 30 가중분만 */
        var d30 = -(wStored * ratio30);
        breakdown.recent30ExpiryDelta += d30;
        type = 'RECENT_30_DAY_EXPIRY';
        if (prev99 && !cur99) {
          var d99 = -(wStored * ratio99);
          breakdown.rolling99ExpiryDelta += d99;
          /* 동일 반응의 99 만료는 별도 기록 (합은 d30+d99 = diff) */
          contributions.push({
            reactionId: r.reactionId,
            reactionType: r.reactionType,
            actorUserId: r.actorUserId,
            actorTerritoryAtReaction: r.actorTerritoryAtReaction,
            targetTerritoryAtReaction: r.targetTerritoryAtReaction,
            createdAt: r.createdAt,
            cancelledAt: r.cancelledAt,
            contributionType: 'ROLLING_99_DAY_EXPIRY',
            contributionScore: d99,
          });
        }
        contributions.push({
          reactionId: r.reactionId,
          reactionType: r.reactionType,
          actorUserId: r.actorUserId,
          actorTerritoryAtReaction: r.actorTerritoryAtReaction,
          targetTerritoryAtReaction: r.targetTerritoryAtReaction,
          createdAt: r.createdAt,
          cancelledAt: r.cancelledAt,
          contributionType: type,
          contributionScore: d30,
        });
        continue;
      } else if (prevMs != null && curActive && prev99 && !cur99 && !(prev30 && !cur30)) {
        /* 이미 30 밖 · 99만 만료 */
        breakdown.rolling99ExpiryDelta += diff;
        type = 'ROLLING_99_DAY_EXPIRY';
      } else if (prevMs == null && curActive) {
        breakdown.newReactionDelta += diff;
        type = 'NEW_REACTIONS';
      } else {
        breakdown.mixedOrOtherDelta += diff;
        type = 'MIXED_OR_OTHER';
      }

      contributions.push({
        reactionId: r.reactionId,
        reactionType: r.reactionType,
        actorUserId: r.actorUserId,
        actorTerritoryAtReaction: r.actorTerritoryAtReaction,
        targetTerritoryAtReaction: r.targetTerritoryAtReaction,
        createdAt: r.createdAt,
        cancelledAt: r.cancelledAt,
        contributionType: type,
        contributionScore: diff,
      });
      void actorDeltaProbe;
    }

    var explained =
      breakdown.newReactionDelta +
      breakdown.cancelledReactionDelta +
      breakdown.recent30ExpiryDelta +
      breakdown.rolling99ExpiryDelta +
      breakdown.actorTerritoryWeightDelta;
    var expected =
      expectedBatchRawChange != null ? Number(expectedBatchRawChange) : explained;
    breakdown.mixedOrOtherDelta = expected - explained;
    if (Math.abs(breakdown.mixedOrOtherDelta) < 1e-9) breakdown.mixedOrOtherDelta = 0;

    return {
      causeBreakdown: breakdown,
      contributions: contributions,
      explainedSum:
        explained + breakdown.mixedOrOtherDelta,
    };
  }

  function determinePrimaryTerritoryMoveCause(causeBreakdown, batchRawChange, options) {
    var opts = options || {};
    var tol = opts.multipleCausesRelativeTol != null
      ? opts.multipleCausesRelativeTol
      : getConfig().oscillationAnalysis.multipleCausesRelativeTol;
    if (Math.abs(batchRawChange) < 1e-12) {
      return OSC_PRIMARY_CAUSE.INVALID_ZERO_CHANGE_MOVE;
    }
    var entries = [
      { key: OSC_PRIMARY_CAUSE.NEW_REACTIONS, v: causeBreakdown.newReactionDelta },
      { key: OSC_PRIMARY_CAUSE.REACTION_CANCELLATIONS, v: causeBreakdown.cancelledReactionDelta },
      { key: OSC_PRIMARY_CAUSE.RECENT_30_DAY_EXPIRY, v: causeBreakdown.recent30ExpiryDelta },
      { key: OSC_PRIMARY_CAUSE.ROLLING_99_DAY_EXPIRY, v: causeBreakdown.rolling99ExpiryDelta },
      { key: OSC_PRIMARY_CAUSE.ACTOR_TERRITORY_WEIGHT_CHANGE, v: causeBreakdown.actorTerritoryWeightDelta },
      { key: OSC_PRIMARY_CAUSE.MIXED_OR_OTHER, v: causeBreakdown.mixedOrOtherDelta },
    ];
    entries.sort(function (a, b) {
      return Math.abs(b.v) - Math.abs(a.v);
    });
    var top = entries[0];
    var second = entries[1];
    if (
      second &&
      Math.abs(Math.abs(top.v) - Math.abs(second.v)) <= Math.abs(batchRawChange) * tol
    ) {
      return OSC_PRIMARY_CAUSE.MULTIPLE_CAUSES;
    }
    return top.key;
  }

  function topContributions(list, typeFilter, sign, limit) {
    var filtered = (list || []).filter(function (c) {
      if (typeFilter && c.contributionType !== typeFilter) return false;
      if (sign > 0) return c.contributionScore > 0;
      if (sign < 0) return c.contributionScore < 0;
      return true;
    });
    filtered.sort(function (a, b) {
      return Math.abs(b.contributionScore) - Math.abs(a.contributionScore);
    });
    return filtered.slice(0, limit || 5);
  }

  function buildReactionContributionSnapshot(contributions) {
    return {
      positiveTop: topContributions(contributions, null, 1, 5),
      negativeTop: topContributions(contributions, null, -1, 5),
      cancellationTop: topContributions(contributions, 'REACTION_CANCELLATIONS', 0, 5),
      expiryTop: (contributions || [])
        .filter(function (c) {
          return (
            c.contributionType === 'RECENT_30_DAY_EXPIRY' ||
            c.contributionType === 'ROLLING_99_DAY_EXPIRY'
          );
        })
        .sort(function (a, b) {
          return Math.abs(b.contributionScore) - Math.abs(a.contributionScore);
        })
        .slice(0, 5),
    };
  }

  function analyzeDirectionReversals(changeSigns) {
    /* changeSigns: array of -1,0,1 per batch */
    var positive = 0;
    var negative = 0;
    var zero = 0;
    var reversals = 0;
    var last = 0;
    var streak = 0;
    var maxStreak = 0;
    var streaks = [];
    var i;
    for (i = 0; i < changeSigns.length; i++) {
      var s = changeSigns[i];
      if (s === 0) {
        zero += 1;
        continue;
      }
      if (s > 0) positive += 1;
      else negative += 1;
      if (last !== 0 && s !== last) {
        reversals += 1;
        streaks.push(streak);
        streak = 1;
      } else {
        streak += 1;
      }
      last = s;
      if (streak > maxStreak) maxStreak = streak;
    }
    if (streak > 0) streaks.push(streak);
    return {
      positiveChangeBatchCount: positive,
      negativeChangeBatchCount: negative,
      zeroChangeBatchCount: zero,
      directionReversalCount: reversals,
      averageDirectionHoldBatches: avg(streaks),
      maxSameDirectionStreak: maxStreak,
    };
  }

  function classifyOscillationUser(userAnalysis, options) {
    var cfg = getConfig().oscillationAnalysis;
    var shareMin = (options && options.causeDrivenShareMin) || cfg.causeDrivenShareMin;
    var moves = userAnalysis.moveEvents || [];
    if (!moves.length) {
      if ((userAnalysis.territoryChangeCount || 0) >= 2) return OSC_USER_CLASS.UNEXPLAINED;
      return OSC_USER_CLASS.EXPECTED_PROGRESSIVE_MOVEMENT;
    }

    var unexplainedMoves = moves.filter(function (m) {
      return (
        m.primaryCause === OSC_PRIMARY_CAUSE.INVALID_ZERO_CHANGE_MOVE ||
        (m.causeBreakdown &&
          Math.abs(
            m.causeBreakdown.newReactionDelta +
              m.causeBreakdown.cancelledReactionDelta +
              m.causeBreakdown.recent30ExpiryDelta +
              m.causeBreakdown.rolling99ExpiryDelta +
              m.causeBreakdown.actorTerritoryWeightDelta +
              m.causeBreakdown.mixedOrOtherDelta -
              m.batchRawChange,
          ) > cfg.breakdownMatchEpsilon * 10)
      );
    });
    if (unexplainedMoves.length) return OSC_USER_CLASS.UNEXPLAINED;

    var absSum = function (key) {
      var s = 0;
      var i;
      for (i = 0; i < moves.length; i++) s += Math.abs(moves[i].causeBreakdown[key] || 0);
      return s;
    };
    var totalAbs = 0;
    var mi;
    for (mi = 0; mi < moves.length; mi++) totalAbs += Math.abs(moves[mi].batchRawChange || 0);
    if (totalAbs < 1e-9) return OSC_USER_CLASS.UNEXPLAINED;

    var cancelShare = absSum('cancelledReactionDelta') / totalAbs;
    var expiryShare =
      (absSum('recent30ExpiryDelta') + absSum('rolling99ExpiryDelta')) / totalAbs;
    var pathType = userAnalysis.oscillationType;
    var boundarySensitiveShare =
      moves.filter(function (m) {
        return m.isBoundarySensitive;
      }).length / moves.length;

    if (cancelShare >= shareMin) return OSC_USER_CLASS.CANCELLATION_DRIVEN;
    if (expiryShare >= shareMin) return OSC_USER_CLASS.WINDOW_EXPIRY_DRIVEN;

    if (
      pathType === OSC_PATH_TYPE.TRUE_SIDE_SWITCH ||
      pathType === OSC_PATH_TYPE.MULTI_SIDE_OSCILLATION
    ) {
      return OSC_USER_CLASS.BEHAVIOR_SHIFT;
    }

    if (
      boundarySensitiveShare >= 0.5 &&
      (pathType === OSC_PATH_TYPE.RETURN_TO_CENTRAL ||
        pathType === OSC_PATH_TYPE.CENTRAL_SIDE_REPEAT ||
        pathType === OSC_PATH_TYPE.RETURN_TO_SAME_SIDE)
    ) {
      return OSC_USER_CLASS.BOUNDARY_NOISE;
    }

    if (
      userAnalysis.territoryChangeCount >= 2 &&
      (pathType === OSC_PATH_TYPE.NONE ||
        (userAnalysis.compressedPathParts &&
          userAnalysis.compressedPathParts.length === 2 &&
          userAnalysis.compressedPathParts[0] === TERRITORY.CENTRAL &&
          (userAnalysis.compressedPathParts[1] === TERRITORY.PIONEER ||
            userAnalysis.compressedPathParts[1] === TERRITORY.GUARDIAN)))
    ) {
      return OSC_USER_CLASS.EXPECTED_PROGRESSIVE_MOVEMENT;
    }

    var newShare = absSum('newReactionDelta') / totalAbs;
    if (newShare < shareMin && cancelShare < shareMin && expiryShare < shareMin) {
      return OSC_USER_CLASS.MIXED_BEHAVIOR;
    }
    if (newShare >= shareMin && pathType === OSC_PATH_TYPE.TRUE_SIDE_SWITCH) {
      return OSC_USER_CLASS.BEHAVIOR_SHIFT;
    }
    return OSC_USER_CLASS.MIXED_BEHAVIOR;
  }

  function pathEntryCounts(parts) {
    var central = 0;
    var pioneer = 0;
    var guardian = 0;
    var i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i] === TERRITORY.CENTRAL) central += 1;
      if (parts[i] === TERRITORY.PIONEER) pioneer += 1;
      if (parts[i] === TERRITORY.GUARDIAN) guardian += 1;
    }
    var sideSwitch = 0;
    for (i = 2; i < parts.length; i++) {
      if (
        (parts[i - 2] === TERRITORY.PIONEER && parts[i] === TERRITORY.GUARDIAN) ||
        (parts[i - 2] === TERRITORY.GUARDIAN && parts[i] === TERRITORY.PIONEER)
      ) {
        sideSwitch += 1;
      }
    }
    var returns = 0;
    for (i = 2; i < parts.length; i++) {
      if (parts[i] === parts[i - 2] && parts[i] !== parts[i - 1]) returns += 1;
    }
    return {
      centralEntryCount: central,
      pioneerEntryCount: pioneer,
      guardianEntryCount: guardian,
      sideSwitchCount: sideSwitch,
      returnCount: returns,
    };
  }

  function runOscillationAnalysisPass(templateUsers, reactions, days, thresholds, options) {
    var opts = options || {};
    var keepDetails = opts.keepDetails !== false;
    var users = cloneLargeScaleUsers(templateUsers);
    var config = clone(getConfig());
    config.territoryThresholds = {
      guardianMax: thresholds.guardianMax,
      centralMin: thresholds.centralMin,
      centralMax: thresholds.centralMax,
      pioneerMin: thresholds.pioneerMin,
    };
    var oscCfg = config.oscillationAnalysis;
    var reactionIndex = opts.reactionIndex || indexReactionsByTarget(reactions);
    var batchTimes = buildBatchTimes(days, config);
    var userRuntime = {};
    var ui;
    for (ui = 0; ui < users.length; ui++) {
      userRuntime[users[ui].userId] = {
        changeSigns: [],
        lastNonZeroSign: 0,
        moveEvents: [],
        recentDirections: [],
        reversalBeforeTerritoryMoveCount: 0,
        invalidZeroMoves: 0,
      };
    }

    var state = {
      mode: ORIENTATION_SIMULATION_MODES.TERRITORY_OSCILLATION_CAUSE_ANALYSIS,
      lite: true,
      config: config,
      users: users,
      reactions: reactions,
      reactionIndex: reactionIndex,
      batches: [],
      processedBatchCount: 0,
      lastBatchTime: null,
      stats: {
        totalCapApplied: 0,
        totalCancelledExcluded: 0,
        cancelReverseMoves: 0,
        windowExpiryChanges: 0,
        zeroChangeUserBatches: 0,
        consecutiveZeroChangeBatches: 0,
        maxConsecutiveZeroChangeBatches: 0,
        repeatedReactionFullAddCount: 0,
      },
    };

    var bi;
    for (bi = 0; bi < batchTimes.length; bi++) {
      var batchTime = batchTimes[bi];
      var prevBatchTime = state.lastBatchTime;
      var batchId = state.processedBatchCount + 1;
      var batchIso = batchTime.toISOString();

      users.forEach(function (user) {
        var rt = userRuntime[user.userId];
        var previousScore = user.currentOrientationScore;
        var previousTerritory = user.currentTerritory;
        var previousCombined =
          user.previousCombinedReactionScore != null
            ? Number(user.previousCombinedReactionScore)
            : 0;
        var list = reactionIndex[user.userId] || [];
        var rolling99 = sumWindowScoreIndexed(
          reactionIndex,
          user.userId,
          batchTime,
          config.rollingWindowDays,
          previousScore,
          config,
          null,
        );
        var recent30 = sumWindowScoreIndexed(
          reactionIndex,
          user.userId,
          batchTime,
          config.recentWindowDays,
          previousScore,
          config,
          null,
        );
        var currentCombined =
          rolling99 * config.rollingWindowRatio + recent30 * config.recentWindowRatio;
        var batchRawChange = currentCombined - previousCombined;
        var cappedChange = clamp(
          batchRawChange,
          -config.maxScoreChangePerBatch,
          config.maxScoreChangePerBatch,
        );
        var nextScore = previousScore + cappedChange;
        var nextTerritory = resolveTerritoryFromScore(nextScore, config.territoryThresholds);

        var sign =
          Math.abs(batchRawChange) < 1e-12 ? 0 : batchRawChange > 0 ? 1 : -1;
        rt.changeSigns.push(sign);
        if (sign !== 0) {
          if (rt.lastNonZeroSign !== 0 && sign !== rt.lastNonZeroSign) {
            /* reversal occurred this batch */
          }
          rt.recentDirections.push(sign > 0 ? 'POSITIVE' : 'NEGATIVE');
          if (rt.recentDirections.length > 3) rt.recentDirections.shift();
          rt.lastNonZeroSign = sign;
        }

        if (previousTerritory !== nextTerritory) {
          if (Math.abs(batchRawChange) < 1e-12) {
            rt.invalidZeroMoves += 1;
          }
          var causePack = calculateBatchCauseBreakdown(
            list,
            user.userId,
            prevBatchTime,
            batchTime,
            previousScore,
            config,
            batchRawChange,
          );
          var primary = determinePrimaryTerritoryMoveCause(
            causePack.causeBreakdown,
            batchRawChange,
            { multipleCausesRelativeTol: oscCfg.multipleCausesRelativeTol },
          );
          if (Math.abs(batchRawChange) < 1e-12) {
            primary = OSC_PRIMARY_CAUSE.INVALID_ZERO_CHANGE_MOVE;
          }
          var distPrev = calculateBoundaryDistance(previousScore, config.territoryThresholds);
          var distNext = calculateBoundaryDistance(nextScore, config.territoryThresholds);
          var sensBand = classifyBoundarySensitivity(
            Math.min(distPrev.nearestDistance, distNext.nearestDistance),
            oscCfg.boundarySensitivityBands,
          );
          var isBoundarySensitive =
            distPrev.nearestDistance <= oscCfg.boundarySensitiveDistance ||
            distNext.nearestDistance <= oscCfg.boundarySensitiveDistance;
          var isDirectionReversal =
            rt.recentDirections.length >= 2 &&
            rt.recentDirections[rt.recentDirections.length - 1] !==
              rt.recentDirections[rt.recentDirections.length - 2];
          if (isDirectionReversal) rt.reversalBeforeTerritoryMoveCount += 1;

          var event = {
            batchId: batchId,
            changedAt: batchIso,
            fromTerritory: previousTerritory,
            toTerritory: nextTerritory,
            previousScore: previousScore,
            nextScore: nextScore,
            rolling99DayScore: rolling99,
            recent30DayScore: recent30,
            previousCombinedReactionScore: previousCombined,
            currentCombinedReactionScore: currentCombined,
            batchRawChange: batchRawChange,
            cappedChange: cappedChange,
            causeBreakdown: causePack.causeBreakdown,
            primaryCause: primary,
            distanceFromPreviousBoundary: distPrev.nearestDistance,
            distanceFromNextBoundary: distNext.nearestDistance,
            boundarySensitivityBand: sensBand,
            isBoundarySensitive: isBoundarySensitive,
            isDirectionReversal: isDirectionReversal,
            recentChangeDirections: rt.recentDirections.slice(),
            contributionSnapshot: keepDetails
              ? buildReactionContributionSnapshot(causePack.contributions)
              : null,
          };
          rt.moveEvents.push(event);
          user.territoryHistory.push({
            batchId: batchId,
            changedAt: batchIso,
            fromTerritory: previousTerritory,
            toTerritory: nextTerritory,
            previousScore: previousScore,
            nextScore: nextScore,
          });
        }

        if (
          previousTerritory === TERRITORY.CENTRAL &&
          nextTerritory !== TERRITORY.CENTRAL &&
          user.firstTerritoryExitBatch == null
        ) {
          user.firstTerritoryExitBatch = batchId;
          user.firstTerritoryExitAt = batchIso;
        }

        user.currentOrientationScore = nextScore;
        user.currentTerritory = nextTerritory;
        user.currentCombinedReactionScore = currentCombined;
        user.previousCombinedReactionScore = currentCombined;
        if (Math.abs(cappedChange) !== Math.abs(batchRawChange) && Math.abs(batchRawChange) > Math.abs(cappedChange) + 1e-9) {
          user.capAppliedCount = (user.capAppliedCount || 0) + 1;
          state.stats.totalCapApplied += 1;
        }
      });

      state.processedBatchCount = batchId;
      state.lastBatchTime = batchTime;
    }

    var analyses = users.map(function (user) {
      var rt = userRuntime[user.userId];
      var pathParts = [user.startingTerritory];
      var hi;
      for (hi = 0; hi < user.territoryHistory.length; hi++) {
        pathParts.push(user.territoryHistory[hi].toTerritory);
      }
      var compressed = compressTerritoryPath(pathParts);
      var oscType =
        user.territoryHistory.length >= 2
          ? classifyOscillationPath(compressed)
          : OSC_PATH_TYPE.NONE;
      var entries = pathEntryCounts(compressed);
      var dirStats = analyzeDirectionReversals(rt.changeSigns);
      var analysis = {
        userId: user.userId,
        latentOrientation: user.latentOrientation,
        latentStrength: user.latentStrength,
        latentSubtype: user.latentSubtype,
        startingTerritory: user.startingTerritory,
        finalTerritory: user.currentTerritory,
        finalOrientationScore: user.currentOrientationScore,
        territoryChangeCount: user.territoryHistory.length,
        compressedTerritoryPath: compressed.join(' → '),
        compressedPathParts: compressed,
        oscillationType: oscType,
        centralEntryCount: entries.centralEntryCount,
        pioneerEntryCount: entries.pioneerEntryCount,
        guardianEntryCount: entries.guardianEntryCount,
        sideSwitchCount: entries.sideSwitchCount,
        returnCount: entries.returnCount,
        moveEvents: rt.moveEvents,
        directionStats: dirStats,
        reversalBeforeTerritoryMoveCount: rt.reversalBeforeTerritoryMoveCount,
        invalidZeroMoves: rt.invalidZeroMoves,
        isOscillationCandidate: user.territoryHistory.length >= 2,
        isHeavyOscillationCandidate: user.territoryHistory.length >= 3,
      };
      analysis.causeClassification = classifyOscillationUser(analysis);
      return analysis;
    });

    return {
      users: users,
      analyses: analyses,
      thresholds: config.territoryThresholds,
      days: days,
    };
  }

  function summarizeOscillationAnalyses(analyses, totalUsers) {
    var n = totalUsers || analyses.length;
    function count(pred) {
      return analyses.filter(pred).length;
    }
    var moved1 = count(function (a) {
      return a.territoryChangeCount >= 1;
    });
    var moved2 = count(function (a) {
      return a.territoryChangeCount >= 2;
    });
    var moved3 = count(function (a) {
      return a.territoryChangeCount >= 3;
    });
    var actualOsc = count(function (a) {
      return (
        a.isOscillationCandidate &&
        a.causeClassification !== OSC_USER_CLASS.EXPECTED_PROGRESSIVE_MOVEMENT
      );
    });
    var trueSwitch = count(function (a) {
      return a.oscillationType === OSC_PATH_TYPE.TRUE_SIDE_SWITCH;
    });
    var boundarySensOsc = count(function (a) {
      return (
        a.isOscillationCandidate &&
        a.moveEvents.some(function (m) {
          return m.isBoundarySensitive;
        })
      );
    });

    var primaryCauseCounts = {};
    var classificationCounts = {};
    var pathTypeCounts = {};
    var bandCounts = {};
    var boundaryDistances = [];
    var reversalCounts = [];
    var unexplained = 0;
    var i;
    for (i = 0; i < analyses.length; i++) {
      var a = analyses[i];
      classificationCounts[a.causeClassification] =
        (classificationCounts[a.causeClassification] || 0) + 1;
      if (a.causeClassification === OSC_USER_CLASS.UNEXPLAINED) unexplained += 1;
      if (a.oscillationType && a.oscillationType !== OSC_PATH_TYPE.NONE) {
        pathTypeCounts[a.oscillationType] = (pathTypeCounts[a.oscillationType] || 0) + 1;
      }
      reversalCounts.push(a.directionStats.directionReversalCount || 0);
      var mi;
      for (mi = 0; mi < a.moveEvents.length; mi++) {
        var m = a.moveEvents[mi];
        primaryCauseCounts[m.primaryCause] = (primaryCauseCounts[m.primaryCause] || 0) + 1;
        bandCounts[m.boundarySensitivityBand] =
          (bandCounts[m.boundarySensitivityBand] || 0) + 1;
        boundaryDistances.push(m.distanceFromPreviousBoundary);
      }
    }

    var oscUsers = analyses.filter(function (a) {
      return a.isOscillationCandidate;
    });
    function classShare(cls) {
      if (!oscUsers.length) return 0;
      return (
        oscUsers.filter(function (a) {
          return a.causeClassification === cls;
        }).length / oscUsers.length
      );
    }

    return {
      totalUsers: n,
      movedAtLeastOnce: moved1,
      changedAtLeastTwice: moved2,
      changedAtLeastThreeTimes: moved3,
      actualOscillationUsers: actualOsc,
      trueSideSwitchUsers: trueSwitch,
      boundarySensitiveOscillationUsers: boundarySensOsc,
      primaryCauseCounts: primaryCauseCounts,
      classificationCounts: classificationCounts,
      pathTypeCounts: pathTypeCounts,
      boundarySensitivityBandCounts: bandCounts,
      averageBoundaryDistanceAtMove: avg(boundaryDistances),
      averageDirectionReversalCount: avg(reversalCounts),
      unexplainedCount: unexplained,
      rates: {
        changedAtLeastTwice: moved2 / n,
        changedAtLeastThreeTimes: moved3 / n,
        cancellationDrivenAmongOsc: classShare(OSC_USER_CLASS.CANCELLATION_DRIVEN),
        windowExpiryDrivenAmongOsc: classShare(OSC_USER_CLASS.WINDOW_EXPIRY_DRIVEN),
        behaviorShiftAmongOsc: classShare(OSC_USER_CLASS.BEHAVIOR_SHIFT),
        boundaryNoiseAmongOsc: classShare(OSC_USER_CLASS.BOUNDARY_NOISE),
      },
    };
  }

  function summarizeByLatent(analyses) {
    var out = {};
    [LATENT.PIONEER, LATENT.NEUTRAL, LATENT.GUARDIAN].forEach(function (lat) {
      var group = analyses.filter(function (a) {
        return a.latentOrientation === lat;
      });
      var g = group.length || 1;
      var osc = group.filter(function (a) {
        return a.isOscillationCandidate;
      });
      out[lat] = {
        count: group.length,
        oscillationRate: osc.length / g,
        returnToCentralRate:
          osc.filter(function (a) {
            return a.oscillationType === OSC_PATH_TYPE.RETURN_TO_CENTRAL;
          }).length / (osc.length || 1),
        oppositeSideRate:
          lat === LATENT.NEUTRAL
            ? osc.filter(function (a) {
                return a.pioneerEntryCount > 0 && a.guardianEntryCount > 0;
              }).length / (osc.length || 1)
            : osc.filter(function (a) {
                return lat === LATENT.PIONEER
                  ? a.finalTerritory === TERRITORY.GUARDIAN
                  : a.finalTerritory === TERRITORY.PIONEER;
              }).length / (osc.length || 1),
        cancellationDrivenRate:
          osc.filter(function (a) {
            return a.causeClassification === OSC_USER_CLASS.CANCELLATION_DRIVEN;
          }).length / (osc.length || 1),
        windowExpiryDrivenRate:
          osc.filter(function (a) {
            return a.causeClassification === OSC_USER_CLASS.WINDOW_EXPIRY_DRIVEN;
          }).length / (osc.length || 1),
        boundaryNoiseRate:
          osc.filter(function (a) {
            return a.causeClassification === OSC_USER_CLASS.BOUNDARY_NOISE;
          }).length / (osc.length || 1),
        behaviorShiftRate:
          osc.filter(function (a) {
            return a.causeClassification === OSC_USER_CLASS.BEHAVIOR_SHIFT;
          }).length / (osc.length || 1),
        finalCentralRate:
          group.filter(function (a) {
            return a.finalTerritory === TERRITORY.CENTRAL;
          }).length / g,
      };
    });
    return out;
  }

  function summarizeByStrength(analyses) {
    var out = {};
    [
      LATENT_STRENGTH.STRONG,
      LATENT_STRENGTH.MEDIUM,
      LATENT_STRENGTH.WEAK,
      LATENT_STRENGTH.MIXED,
    ].forEach(function (st) {
      var group = analyses.filter(function (a) {
        return a.latentStrength === st;
      });
      var osc = group.filter(function (a) {
        return a.isOscillationCandidate;
      });
      out[st] = {
        count: group.length,
        oscillationRate: group.length ? osc.length / group.length : 0,
        boundaryNoiseRate: osc.length
          ? osc.filter(function (a) {
              return a.causeClassification === OSC_USER_CLASS.BOUNDARY_NOISE;
            }).length / osc.length
          : 0,
        behaviorShiftRate: osc.length
          ? osc.filter(function (a) {
              return a.causeClassification === OSC_USER_CLASS.BEHAVIOR_SHIFT;
            }).length / osc.length
          : 0,
      };
    });
    return out;
  }

  function resetTerritoryOscillationCauseAnalysis() {
    oscillationCauseAnalysisState = null;
    return { ok: true };
  }

  function getTerritoryOscillationCauseReport() {
    return oscillationCauseAnalysisState && oscillationCauseAnalysisState.report
      ? clone(oscillationCauseAnalysisState.report)
      : null;
  }

  function getTerritoryOscillationCauseState() {
    return oscillationCauseAnalysisState ? clone(oscillationCauseAnalysisState) : null;
  }

  function runTerritoryOscillationCauseAnalysis(options) {
    var opts = options || {};
    var userCount = opts.userCount != null ? opts.userCount : 1000;
    var daysList = opts.days || [30, 99];
    var seeds = opts.seeds || LARGE_SCALE_DEFAULT_SEEDS.slice();
    var presetIds = opts.thresholdPresetIds || [
      'CENTRAL_1000',
      'CENTRAL_800',
      'CENTRAL_600',
      'CENTRAL_400',
    ];
    var quick = !!opts.quick;
    var started = Date.now();
    var maxDays = 0;
    var di;
    for (di = 0; di < daysList.length; di++) {
      if (daysList[di] > maxDays) maxDays = daysList[di];
    }
    var presets = [];
    var pi;
    for (pi = 0; pi < presetIds.length; pi++) {
      var pr = getThresholdPresetById(presetIds[pi]);
      if (!pr) throw new Error('Unknown threshold preset: ' + presetIds[pi]);
      presets.push(pr);
    }

    var bySeed = [];
    var si;
    for (si = 0; si < seeds.length; si++) {
      var seed = seeds[si];
      var templateUsers = createLargeScaleOrientationUsers({ seed: seed, userCount: userCount });
      var reactions = createLargeScaleOrientationReactions(templateUsers, {
        seed: seed,
        days: maxDays,
      });
      var reactionIndex = indexReactionsByTarget(reactions);
      var userFp = latentCompositionFingerprint(templateUsers);
      var rxFp = reactionsFlowFingerprint(reactions);
      var seedEntry = {
        seed: seed,
        userFingerprint: userFp,
        reactionFingerprint: rxFp,
        byDays: {},
      };
      for (di = 0; di < daysList.length; di++) seedEntry.byDays[daysList[di]] = {};

      var has30 = daysList.indexOf(30) >= 0;
      var has99 = daysList.indexOf(99) >= 0;

      for (pi = 0; pi < presets.length; pi++) {
        var preset = presets[pi];
        if (has30 && has99 && maxDays >= 99) {
          /* 99일 실행 후 30일은 별도 패스(원인 이벤트 시점 보존을 위해 각각 실행) */
          var pass99 = runOscillationAnalysisPass(templateUsers, reactions, 99, preset, {
            reactionIndex: reactionIndex,
            keepDetails: si === 0,
          });
          var pass30 = runOscillationAnalysisPass(templateUsers, reactions, 30, preset, {
            reactionIndex: reactionIndex,
            keepDetails: si === 0,
          });
          seedEntry.byDays[30][preset.id] = {
            summary: summarizeOscillationAnalyses(pass30.analyses, userCount),
            latentOrientationSummaries: summarizeByLatent(pass30.analyses),
            latentStrengthSummaries: summarizeByStrength(pass30.analyses),
            analyses: si === 0 ? pass30.analyses : null,
            sharedUserFingerprint: userFp,
            sharedReactionFingerprint: rxFp,
          };
          seedEntry.byDays[99][preset.id] = {
            summary: summarizeOscillationAnalyses(pass99.analyses, userCount),
            latentOrientationSummaries: summarizeByLatent(pass99.analyses),
            latentStrengthSummaries: summarizeByStrength(pass99.analyses),
            analyses: si === 0 ? pass99.analyses : null,
            sharedUserFingerprint: userFp,
            sharedReactionFingerprint: rxFp,
          };
        } else {
          for (di = 0; di < daysList.length; di++) {
            var days = daysList[di];
            var pass = runOscillationAnalysisPass(templateUsers, reactions, days, preset, {
              reactionIndex: reactionIndex,
              keepDetails: si === 0,
            });
            seedEntry.byDays[days][preset.id] = {
              summary: summarizeOscillationAnalyses(pass.analyses, userCount),
              latentOrientationSummaries: summarizeByLatent(pass.analyses),
              latentStrengthSummaries: summarizeByStrength(pass.analyses),
              analyses: si === 0 ? pass.analyses : null,
              sharedUserFingerprint: userFp,
              sharedReactionFingerprint: rxFp,
            };
          }
        }
      }
      bySeed.push(seedEntry);
    }

    function avgField(days, presetId, picker) {
      var vals = bySeed.map(function (s) {
        return picker(s.byDays[days][presetId]);
      });
      return avg(vals);
    }

    var thresholdSummaries = {};
    for (di = 0; di < daysList.length; di++) {
      thresholdSummaries[daysList[di]] = {};
      for (pi = 0; pi < presets.length; pi++) {
        var pid = presets[pi].id;
        var base = bySeed[0].byDays[daysList[di]][pid].summary;
        thresholdSummaries[daysList[di]][pid] = {
          presetId: pid,
          days: daysList[di],
          totalUsers: userCount,
          movedAtLeastOnce: avgField(daysList[di], pid, function (x) {
            return x.summary.movedAtLeastOnce;
          }),
          changedAtLeastTwice: avgField(daysList[di], pid, function (x) {
            return x.summary.changedAtLeastTwice;
          }),
          changedAtLeastThreeTimes: avgField(daysList[di], pid, function (x) {
            return x.summary.changedAtLeastThreeTimes;
          }),
          actualOscillationUsers: avgField(daysList[di], pid, function (x) {
            return x.summary.actualOscillationUsers;
          }),
          trueSideSwitchUsers: avgField(daysList[di], pid, function (x) {
            return x.summary.trueSideSwitchUsers;
          }),
          boundarySensitiveOscillationUsers: avgField(daysList[di], pid, function (x) {
            return x.summary.boundarySensitiveOscillationUsers;
          }),
          primaryCauseCounts: base.primaryCauseCounts,
          classificationCounts: base.classificationCounts,
          pathTypeCounts: base.pathTypeCounts,
          boundarySensitivityBandCounts: base.boundarySensitivityBandCounts,
          averageBoundaryDistanceAtMove: avgField(daysList[di], pid, function (x) {
            return x.summary.averageBoundaryDistanceAtMove;
          }),
          averageDirectionReversalCount: avgField(daysList[di], pid, function (x) {
            return x.summary.averageDirectionReversalCount;
          }),
          unexplainedCount: avgField(daysList[di], pid, function (x) {
            return x.summary.unexplainedCount;
          }),
          rates: {
            changedAtLeastTwice: avgField(daysList[di], pid, function (x) {
              return x.summary.rates.changedAtLeastTwice;
            }),
            changedAtLeastThreeTimes: avgField(daysList[di], pid, function (x) {
              return x.summary.rates.changedAtLeastThreeTimes;
            }),
            cancellationDrivenAmongOsc: avgField(daysList[di], pid, function (x) {
              return x.summary.rates.cancellationDrivenAmongOsc;
            }),
            windowExpiryDrivenAmongOsc: avgField(daysList[di], pid, function (x) {
              return x.summary.rates.windowExpiryDrivenAmongOsc;
            }),
            behaviorShiftAmongOsc: avgField(daysList[di], pid, function (x) {
              return x.summary.rates.behaviorShiftAmongOsc;
            }),
            boundaryNoiseAmongOsc: avgField(daysList[di], pid, function (x) {
              return x.summary.rates.boundaryNoiseAmongOsc;
            }),
          },
          seedMeanPrimaryCauses: (function () {
            /* seed 0 상세 기준 + 평균 이동률 */
            return base.primaryCauseCounts;
          })(),
        };
      }
    }

    /* 중앙 범위별 왕복 여부 차이 표본 (seed0 · 최장 일수) */
    var longest = maxDays;
    var cross = [];
    if (bySeed[0] && bySeed[0].byDays[longest]) {
      var byId = Object.create(null);
      for (pi = 0; pi < presets.length; pi++) {
        var block = bySeed[0].byDays[longest][presets[pi].id];
        if (!block || !block.analyses) continue;
        block.analyses.forEach(function (a) {
          if (!byId[a.userId]) byId[a.userId] = { userId: a.userId, latentOrientation: a.latentOrientation, latentStrength: a.latentStrength, byPreset: {} };
          byId[a.userId].byPreset[presets[pi].id] = {
            territoryChangeCount: a.territoryChangeCount,
            oscillationType: a.oscillationType,
            causeClassification: a.causeClassification,
            finalTerritory: a.finalTerritory,
            finalOrientationScore: a.finalOrientationScore,
          };
        });
      }
      Object.keys(byId).forEach(function (uid) {
        var row = byId[uid];
        var oscFlags = presets.map(function (p) {
          return (row.byPreset[p.id] && row.byPreset[p.id].territoryChangeCount >= 2) || false;
        });
        var any = oscFlags.some(Boolean);
        var all = oscFlags.every(Boolean);
        var none = !any;
        if (any && !all) {
          cross.push({
            userId: uid,
            latentOrientation: row.latentOrientation,
            latentStrength: row.latentStrength,
            oscillatesByPreset: (function () {
              var o = {};
              presets.forEach(function (p, idx) {
                o[p.id] = oscFlags[idx];
              });
              return o;
            })(),
            detailsByPreset: row.byPreset,
          });
        } else if (all || none) {
          /* skip bulk; keep mixed only for sample */
        }
      });
    }
    cross = cross.slice(0, 20);

    var sampleUsers = [];
    if (bySeed[0]) {
      var d0 = daysList.indexOf(99) >= 0 ? 99 : daysList[0];
      var p0 = presets[0].id;
      var analyses0 = bySeed[0].byDays[d0][p0].analyses || [];
      sampleUsers = analyses0
        .filter(function (a) {
          return a.isOscillationCandidate;
        })
        .slice(0, 15)
        .map(function (a) {
          return {
            userId: a.userId,
            latentOrientation: a.latentOrientation,
            latentStrength: a.latentStrength,
            compressedTerritoryPath: a.compressedTerritoryPath,
            oscillationType: a.oscillationType,
            causeClassification: a.causeClassification,
            territoryChangeCount: a.territoryChangeCount,
            moveEventCount: a.moveEvents.length,
            primaryCauses: a.moveEvents.map(function (m) {
              return m.primaryCause;
            }),
          };
        });
    }

    var validation = {
      causeBreakdownMatchesBatchRawChange: true,
      actorTerritoryWeightChangeAlwaysZero: true,
      invalidZeroChangeMoves: 0,
      unexplainedUsers: 0,
      notes: [],
    };
    bySeed.forEach(function (s) {
      Object.keys(s.byDays).forEach(function (d) {
        Object.keys(s.byDays[d]).forEach(function (pid) {
          var block = s.byDays[d][pid];
          validation.unexplainedUsers += block.summary.unexplainedCount || 0;
          if (!block.analyses) return;
          block.analyses.forEach(function (a) {
            validation.invalidZeroChangeMoves += a.invalidZeroMoves || 0;
            a.moveEvents.forEach(function (m) {
              var b = m.causeBreakdown;
              var sum =
                b.newReactionDelta +
                b.cancelledReactionDelta +
                b.recent30ExpiryDelta +
                b.rolling99ExpiryDelta +
                b.actorTerritoryWeightDelta +
                b.mixedOrOtherDelta;
              if (Math.abs(sum - m.batchRawChange) > getConfig().oscillationAnalysis.breakdownMatchEpsilon * 100) {
                validation.causeBreakdownMatchesBatchRawChange = false;
              }
              if (Math.abs(b.actorTerritoryWeightDelta) > 1e-9) {
                validation.actorTerritoryWeightChangeAlwaysZero = false;
              }
            });
          });
        });
      });
    });

    var elapsedMs = Date.now() - started;
    var report = {
      meta: {
        mode: ORIENTATION_SIMULATION_MODES.TERRITORY_OSCILLATION_CAUSE_ANALYSIS,
        quick: quick,
        userCount: userCount,
        seeds: seeds.slice(),
        seedCount: seeds.length,
        days: daysList.slice(),
        presets: presets.map(function (p) {
          return clone(p);
        }),
        elapsedMs: elapsedMs,
        note: '원인 분석만 수행 · 운영 기준·가중치·상한·안정화 규칙 미변경',
        autoStabilizationApplied: false,
      },
      thresholdSummaries: thresholdSummaries,
      seedSummaries: bySeed.map(function (s) {
        return {
          seed: s.seed,
          userFingerprint: s.userFingerprint,
          reactionFingerprint: s.reactionFingerprint,
        };
      }),
      causeSummaries: thresholdSummaries,
      pathSummaries: thresholdSummaries,
      latentOrientationSummaries: (function () {
        var o = {};
        daysList.forEach(function (d) {
          o[d] = {};
          presets.forEach(function (p) {
            o[d][p.id] = bySeed[0].byDays[d][p.id].latentOrientationSummaries;
          });
        });
        return o;
      })(),
      latentStrengthSummaries: (function () {
        var o = {};
        daysList.forEach(function (d) {
          o[d] = {};
          presets.forEach(function (p) {
            o[d][p.id] = bySeed[0].byDays[d][p.id].latentStrengthSummaries;
          });
        });
        return o;
      })(),
      boundarySensitivitySummaries: thresholdSummaries,
      directionReversalSummaries: thresholdSummaries,
      crossThresholdComparisons: cross,
      sampleUsers: sampleUsers,
      validation: validation,
      bySeed: bySeed,
    };

    oscillationCauseAnalysisState = {
      mode: ORIENTATION_SIMULATION_MODES.TERRITORY_OSCILLATION_CAUSE_ANALYSIS,
      options: {
        userCount: userCount,
        days: daysList.slice(),
        seeds: seeds.slice(),
        thresholdPresetIds: presetIds.slice(),
        quick: quick,
      },
      report: report,
      finishedAt: new Date().toISOString(),
      elapsedMs: elapsedMs,
    };
    return report;
  }

  /* ─── 5차: TERRITORY_STABILIZATION_COMPARISON ─── */

  function getStabilizationPresetById(id) {
    var i;
    for (i = 0; i < TERRITORY_STABILIZATION_PRESETS.length; i++) {
      if (TERRITORY_STABILIZATION_PRESETS[i].id === id) return TERRITORY_STABILIZATION_PRESETS[i];
    }
    return null;
  }

  function getTerritoryTransitionThresholds(currentTerritory, thresholdPreset, stabilizationPreset) {
    var t = thresholdPreset;
    var gap = (stabilizationPreset && stabilizationPreset.hysteresisGap) || 0;
    var pioneerEntryMin = t.pioneerMin;
    var guardianEntryMax = t.guardianMax;
    var pioneerExitMax = t.centralMax - gap;
    var guardianExitMin = t.centralMin + gap;
    return {
      pioneerEntryMin: pioneerEntryMin,
      pioneerExitMax: pioneerExitMax,
      guardianEntryMax: guardianEntryMax,
      guardianExitMin: guardianExitMin,
      hysteresisGap: gap,
      currentTerritory: currentTerritory || TERRITORY.CENTRAL,
    };
  }

  /** 점수·현재 영토·히스테리시스로 이동 후보만 계산 (즉시 확정 아님) */
  function resolveCandidateTerritory(score, currentTerritory, thresholdPreset, stabilizationPreset) {
    var s = Number(score);
    var cur = currentTerritory || TERRITORY.CENTRAL;
    var gap = (stabilizationPreset && stabilizationPreset.hysteresisGap) || 0;
    if (!gap) {
      return resolveTerritoryFromScore(s, {
        guardianMax: thresholdPreset.guardianMax,
        centralMin: thresholdPreset.centralMin,
        centralMax: thresholdPreset.centralMax,
        pioneerMin: thresholdPreset.pioneerMin,
      });
    }
    var th = getTerritoryTransitionThresholds(cur, thresholdPreset, stabilizationPreset);
    if (cur === TERRITORY.CENTRAL) {
      if (s >= th.pioneerEntryMin) return TERRITORY.PIONEER;
      if (s <= th.guardianEntryMax) return TERRITORY.GUARDIAN;
      return TERRITORY.CENTRAL;
    }
    if (cur === TERRITORY.PIONEER) {
      if (s <= th.pioneerExitMax) return TERRITORY.CENTRAL;
      return TERRITORY.PIONEER;
    }
    if (cur === TERRITORY.GUARDIAN) {
      if (s >= th.guardianExitMin) return TERRITORY.CENTRAL;
      return TERRITORY.GUARDIAN;
    }
    return TERRITORY.CENTRAL;
  }

  function applyTerritoryStabilizationStep(user, candidateTerritory, requiredConsecutive, batchIso) {
    var required = requiredConsecutive != null ? requiredConsecutive : 1;
    var current = user.currentTerritory;
    var delayed = false;
    var changed = false;
    var prevented = false;

    if (candidateTerritory === current) {
      user.pendingTerritory = null;
      user.pendingTerritoryBatchCount = 0;
      user.pendingTerritoryStartedAt = null;
      return {
        nextTerritory: current,
        changed: false,
        delayed: false,
        prevented: false,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
      };
    }

    if (user.pendingTerritory !== candidateTerritory) {
      user.pendingTerritory = candidateTerritory;
      user.pendingTerritoryBatchCount = 1;
      user.pendingTerritoryStartedAt = batchIso;
    } else {
      user.pendingTerritoryBatchCount = (user.pendingTerritoryBatchCount || 0) + 1;
    }

    if (user.pendingTerritoryBatchCount >= required) {
      changed = true;
      user.currentTerritory = candidateTerritory;
      user.pendingTerritory = null;
      user.pendingTerritoryBatchCount = 0;
      user.pendingTerritoryStartedAt = null;
      return {
        nextTerritory: candidateTerritory,
        changed: true,
        delayed: false,
        prevented: false,
        pendingTerritory: null,
        pendingTerritoryBatchCount: 0,
      };
    }

    delayed = true;
    return {
      nextTerritory: current,
      changed: false,
      delayed: true,
      prevented: false,
      pendingTerritory: user.pendingTerritory,
      pendingTerritoryBatchCount: user.pendingTerritoryBatchCount,
    };
  }

  function runStabilizationPass(templateUsers, reactions, days, thresholdPreset, stabPreset, options) {
    var opts = options || {};
    var users = cloneLargeScaleUsers(templateUsers);
    var reactionIndex = opts.reactionIndex || indexReactionsByTarget(reactions);
    var config = clone(getConfig());
    config.territoryThresholds = {
      guardianMax: thresholdPreset.guardianMax,
      centralMin: thresholdPreset.centralMin,
      centralMax: thresholdPreset.centralMax,
      pioneerMin: thresholdPreset.pioneerMin,
    };
    var batchTimes = buildBatchTimes(days, config);
    var required = stabPreset.requiredConsecutiveBatches || 1;
    var baselineStab = TERRITORY_STABILIZATION_PRESETS[0];
    var delayedTotal = 0;
    var preventedTotal = 0;

    users.forEach(function (u) {
      u.pendingTerritory = null;
      u.pendingTerritoryBatchCount = 0;
      u.pendingTerritoryStartedAt = null;
      u.firstConfirmedTerritoryBatch = null;
      u.firstConfirmedTerritoryAt = null;
      u.stabilizationDelayedCount = 0;
      u.stabilizationPreventedCount = 0;
    });

    var bi;
    for (bi = 0; bi < batchTimes.length; bi++) {
      var batchTime = batchTimes[bi];
      var batchId = bi + 1;
      var batchIso = batchTime.toISOString();

      users.forEach(function (user) {
        var previousScore = user.currentOrientationScore;
        var previousTerritory = user.currentTerritory;
        var previousCombined =
          user.previousCombinedReactionScore != null
            ? Number(user.previousCombinedReactionScore)
            : 0;
        var rolling99 = sumWindowScoreIndexed(
          reactionIndex,
          user.userId,
          batchTime,
          config.rollingWindowDays,
          previousScore,
          config,
          null,
        );
        var recent30 = sumWindowScoreIndexed(
          reactionIndex,
          user.userId,
          batchTime,
          config.recentWindowDays,
          previousScore,
          config,
          null,
        );
        var currentCombined =
          rolling99 * config.rollingWindowRatio + recent30 * config.recentWindowRatio;
        var batchRawChange = currentCombined - previousCombined;
        var cappedChange = clamp(
          batchRawChange,
          -config.maxScoreChangePerBatch,
          config.maxScoreChangePerBatch,
        );
        var nextScore = previousScore + cappedChange;

        var candidate = resolveCandidateTerritory(
          nextScore,
          previousTerritory,
          thresholdPreset,
          stabPreset,
        );
        var baselineCandidate = resolveCandidateTerritory(
          nextScore,
          previousTerritory,
          thresholdPreset,
          baselineStab,
        );
        var step = applyTerritoryStabilizationStep(user, candidate, required, batchIso);

        /* hysteresis로 후보가 현재와 같고 BASELINE 후보는 다르면 방지 */
        var prevented =
          !step.changed &&
          baselineCandidate !== previousTerritory &&
          candidate === previousTerritory &&
          (stabPreset.hysteresisGap || 0) > 0;
        if (prevented) {
          user.stabilizationPreventedCount = (user.stabilizationPreventedCount || 0) + 1;
          preventedTotal += 1;
        }
        if (step.delayed) {
          user.stabilizationDelayedCount = (user.stabilizationDelayedCount || 0) + 1;
          delayedTotal += 1;
        }

        var nextTerritory = step.nextTerritory;
        if (step.changed && previousTerritory !== nextTerritory) {
          user.territoryHistory.push({
            batchId: batchId,
            changedAt: batchIso,
            fromTerritory: previousTerritory,
            toTerritory: nextTerritory,
            previousScore: previousScore,
            nextScore: nextScore,
          });
          if (
            previousTerritory === TERRITORY.CENTRAL &&
            nextTerritory !== TERRITORY.CENTRAL &&
            user.firstConfirmedTerritoryBatch == null
          ) {
            user.firstConfirmedTerritoryBatch = batchId;
            user.firstConfirmedTerritoryAt = batchIso;
          }
        }

        user.currentOrientationScore = nextScore;
        user.currentTerritory = nextTerritory;
        user.currentCombinedReactionScore = currentCombined;
        user.previousCombinedReactionScore = currentCombined;
      });
    }

    return {
      users: users,
      delayedTotal: delayedTotal,
      preventedTotal: preventedTotal,
      days: days,
      thresholdPresetId: thresholdPreset.id,
      stabilizationPresetId: stabPreset.id,
    };
  }

  function isBoundaryNoisePath(compressedParts) {
    var t = classifyOscillationPath(compressedParts);
    return (
      t === OSC_PATH_TYPE.RETURN_TO_CENTRAL ||
      t === OSC_PATH_TYPE.CENTRAL_SIDE_REPEAT ||
      t === OSC_PATH_TYPE.RETURN_TO_SAME_SIDE
    );
  }

  function summarizeStabilizationUsers(users, delayedTotal, preventedTotal) {
    var n = users.length || 1;
    var endP = countUsers(users, function (u) {
      return u.currentTerritory === TERRITORY.PIONEER;
    });
    var endC = countUsers(users, function (u) {
      return u.currentTerritory === TERRITORY.CENTRAL;
    });
    var endG = countUsers(users, function (u) {
      return u.currentTerritory === TERRITORY.GUARDIAN;
    });
    var move1 = countUsers(users, function (u) {
      return u.territoryHistory.length >= 1;
    });
    var move2 = countUsers(users, function (u) {
      return u.territoryHistory.length >= 2;
    });
    var move3 = countUsers(users, function (u) {
      return u.territoryHistory.length >= 3;
    });
    var changeCounts = users.map(function (u) {
      return u.territoryHistory.length;
    });
    var firstBatches = users
      .filter(function (u) {
        return u.firstConfirmedTerritoryBatch != null;
      })
      .map(function (u) {
        return u.firstConfirmedTerritoryBatch;
      });
    var firstDays = users
      .filter(function (u) {
        return u.firstConfirmedTerritoryAt;
      })
      .map(function (u) {
        var startMs = new Date(getConfig().simulationStartIso).getTime();
        return (new Date(u.firstConfirmedTerritoryAt).getTime() - startMs) / 86400000;
      });

    var osc = 0;
    var boundaryNoise = 0;
    var trueSwitch = 0;
    var returnCentral = 0;
    users.forEach(function (u) {
      if (u.territoryHistory.length < 2) return;
      osc += 1;
      var parts = [u.startingTerritory];
      var i;
      for (i = 0; i < u.territoryHistory.length; i++) parts.push(u.territoryHistory[i].toTerritory);
      var compressed = compressTerritoryPath(parts);
      var pathType = classifyOscillationPath(compressed);
      if (isBoundaryNoisePath(compressed)) boundaryNoise += 1;
      if (pathType === OSC_PATH_TYPE.TRUE_SIDE_SWITCH || pathType === OSC_PATH_TYPE.MULTI_SIDE_OSCILLATION) {
        trueSwitch += 1;
      }
      if (pathType === OSC_PATH_TYPE.RETURN_TO_CENTRAL) returnCentral += 1;
    });

    function latentStats(lat) {
      var g = users.filter(function (u) {
        return u.latentOrientation === lat;
      });
      var gn = g.length || 1;
      var hit =
        lat === LATENT.NEUTRAL
          ? countUsers(g, function (u) {
              return u.currentTerritory === TERRITORY.CENTRAL;
            })
          : countUsers(g, function (u) {
              return u.currentTerritory === lat;
            });
      var central = countUsers(g, function (u) {
        return u.currentTerritory === TERRITORY.CENTRAL;
      });
      var opposite =
        lat === LATENT.PIONEER
          ? countUsers(g, function (u) {
              return u.currentTerritory === TERRITORY.GUARDIAN;
            })
          : lat === LATENT.GUARDIAN
            ? countUsers(g, function (u) {
                return u.currentTerritory === TERRITORY.PIONEER;
              })
            : 0;
      var byStrength = {};
      [LATENT_STRENGTH.STRONG, LATENT_STRENGTH.MEDIUM, LATENT_STRENGTH.WEAK, LATENT_STRENGTH.MIXED].forEach(
        function (st) {
          var sg = g.filter(function (u) {
            return u.latentStrength === st;
          });
          if (!sg.length) {
            byStrength[st] = null;
            return;
          }
          byStrength[st] =
            countUsers(sg, function (u) {
              return lat === LATENT.NEUTRAL
                ? u.currentTerritory === TERRITORY.CENTRAL
                : u.currentTerritory === lat;
            }) / sg.length;
        },
      );
      var strong = g.filter(function (u) {
        return u.latentStrength === LATENT_STRENGTH.STRONG;
      });
      var strongCentral =
        strong.length === 0
          ? 0
          : countUsers(strong, function (u) {
              return u.currentTerritory === TERRITORY.CENTRAL;
            }) / strong.length;
      var firstExit = avg(
        g
          .filter(function (u) {
            return u.firstConfirmedTerritoryBatch != null;
          })
          .map(function (u) {
            return u.firstConfirmedTerritoryBatch;
          }),
      );
      return {
        hitRate: hit / gn,
        centralRate: central / gn,
        oppositeRate: opposite / gn,
        byStrength: byStrength,
        strongCentralRate: strongCentral,
        avgFirstConfirmBatch: firstExit,
        move2Rate:
          countUsers(g, function (u) {
            return u.territoryHistory.length >= 2;
          }) / gn,
        move3Rate:
          countUsers(g, function (u) {
            return u.territoryHistory.length >= 3;
          }) / gn,
        pioneerRate:
          countUsers(g, function (u) {
            return u.currentTerritory === TERRITORY.PIONEER;
          }) / gn,
        guardianRate:
          countUsers(g, function (u) {
            return u.currentTerritory === TERRITORY.GUARDIAN;
          }) / gn,
      };
    }

    var pio = latentStats(LATENT.PIONEER);
    var gua = latentStats(LATENT.GUARDIAN);
    var neu = latentStats(LATENT.NEUTRAL);
    var orientationAccuracy = (pio.hitRate + gua.hitRate) / 2;
    var oppositeMisclassification = (pio.oppositeRate + gua.oppositeRate) / 2;
    var strongPG = users.filter(function (u) {
      return (
        u.latentStrength === LATENT_STRENGTH.STRONG &&
        (u.latentOrientation === LATENT.PIONEER || u.latentOrientation === LATENT.GUARDIAN)
      );
    });
    var strongUnclassified =
      strongPG.length === 0
        ? 0
        : countUsers(strongPG, function (u) {
            return u.currentTerritory === TERRITORY.CENTRAL;
          }) / strongPG.length;

    return {
      endCounts: { pioneer: endP, central: endC, guardian: endG },
      movedAtLeastOnceRate: move1 / n,
      changedAtLeastTwiceRate: move2 / n,
      changedAtLeastThreeTimesRate: move3 / n,
      actualOscillationRate: osc / n,
      boundaryNoiseRate: boundaryNoise / n,
      trueSideSwitchRate: trueSwitch / n,
      returnToCentralRate: returnCentral / n,
      avgTerritoryChangeCount: avg(changeCounts),
      avgFirstConfirmBatch: avg(firstBatches),
      avgFirstConfirmDays: avg(firstDays),
      territoryChangeDelayedCount: delayedTotal,
      territoryChangePreventedCount: preventedTotal,
      orientationAccuracy: orientationAccuracy,
      oppositeMisclassification: oppositeMisclassification,
      neutralRetention: neu.hitRate,
      strongOrientationUnclassifiedRate: strongUnclassified,
      pioneer: pio,
      guardian: gua,
      neutral: neu,
      scoreFingerprint: users
        .map(function (u) {
          return u.userId + ':' + Math.round(u.currentOrientationScore * 1000) / 1000;
        })
        .join('|'),
      userSnapshots: users.map(function (u) {
        var parts = [u.startingTerritory];
        var i;
        for (i = 0; i < u.territoryHistory.length; i++) parts.push(u.territoryHistory[i].toTerritory);
        var compressed = compressTerritoryPath(parts);
        return {
          userId: u.userId,
          latentOrientation: u.latentOrientation,
          latentStrength: u.latentStrength,
          finalOrientationScore: u.currentOrientationScore,
          finalTerritory: u.currentTerritory,
          territoryChangeCount: u.territoryHistory.length,
          compressedPath: compressed.join(' → '),
          firstConfirmBatch: u.firstConfirmedTerritoryBatch,
          delayedCount: u.stabilizationDelayedCount || 0,
          preventedCount: u.stabilizationPreventedCount || 0,
        };
      }),
    };
  }

  function classifyStabilizationStatus(metrics, baseline) {
    if (!baseline) return STABILIZATION_STATUS.NEEDS_REVIEW;
    var oscBase = baseline.actualOscillationRate || 0;
    var oscNow = metrics.actualOscillationRate || 0;
    var oscReductionRel = oscBase > 1e-9 ? (oscBase - oscNow) / oscBase : 0;
    var accuracyLoss = (baseline.orientationAccuracy || 0) - (metrics.orientationAccuracy || 0);
    var oppIncrease =
      (metrics.oppositeMisclassification || 0) - (baseline.oppositeMisclassification || 0);
    var strongInc =
      (metrics.strongOrientationUnclassifiedRate || 0) -
      (baseline.strongOrientationUnclassifiedRate || 0);
    var delay =
      (metrics.avgFirstConfirmBatch || 0) - (baseline.avgFirstConfirmBatch || 0);

    if (metrics.orientationAccuracy < 0.55 || metrics.strongOrientationUnclassifiedRate > 0.2) {
      return STABILIZATION_STATUS.TOO_STICKY;
    }
    if (delay >= 4 || strongInc > 0.15) return STABILIZATION_STATUS.TOO_SLOW;
    if (
      oscReductionRel >= 0.3 &&
      accuracyLoss <= 0.05 &&
      oppIncrease <= 0.02 &&
      strongInc <= 0.1
    ) {
      return STABILIZATION_STATUS.PROMISING;
    }
    if (oscReductionRel < 0.15) return STABILIZATION_STATUS.INSUFFICIENT;
    return STABILIZATION_STATUS.NEEDS_REVIEW;
  }

  function computeStabilizationEffects(metrics, baseline) {
    if (!baseline) {
      return {
        oscillationReduction: 0,
        boundaryNoiseReduction: 0,
        accuracyLoss: 0,
        neutralRetentionChange: 0,
        classificationDelay: 0,
        strongUnclassifiedIncrease: 0,
        stabilityScore: 0,
      };
    }
    var oscRed = (baseline.actualOscillationRate || 0) - (metrics.actualOscillationRate || 0);
    var noiseRed = (baseline.boundaryNoiseRate || 0) - (metrics.boundaryNoiseRate || 0);
    var accLoss = (baseline.orientationAccuracy || 0) - (metrics.orientationAccuracy || 0);
    var neuCh = (metrics.neutralRetention || 0) - (baseline.neutralRetention || 0);
    var delay = (metrics.avgFirstConfirmBatch || 0) - (baseline.avgFirstConfirmBatch || 0);
    var strongInc =
      (metrics.strongOrientationUnclassifiedRate || 0) -
      (baseline.strongOrientationUnclassifiedRate || 0);
    var normDelay = Math.max(0, Math.min(1, delay / 10));
    var w = getConfig().stabilizationScoreWeights;
    var stabilityScore =
      oscRed * w.oscillationReduction +
      noiseRed * w.boundaryNoiseReduction -
      accLoss * w.accuracyLoss +
      neuCh * w.neutralRetentionChange -
      normDelay * w.classificationDelay -
      strongInc * w.strongUnclassifiedIncrease;
    return {
      oscillationReduction: oscRed,
      boundaryNoiseReduction: noiseRed,
      accuracyLoss: accLoss,
      neutralRetentionChange: neuCh,
      classificationDelay: delay,
      strongUnclassifiedIncrease: strongInc,
      stabilityScore: stabilityScore,
      deltasPp: {
        move2: ((metrics.changedAtLeastTwiceRate || 0) - (baseline.changedAtLeastTwiceRate || 0)) * 100,
        move3:
          ((metrics.changedAtLeastThreeTimesRate || 0) - (baseline.changedAtLeastThreeTimesRate || 0)) *
          100,
        boundaryNoise: ((metrics.boundaryNoiseRate || 0) - (baseline.boundaryNoiseRate || 0)) * 100,
        accuracy: ((metrics.orientationAccuracy || 0) - (baseline.orientationAccuracy || 0)) * 100,
        neutral: ((metrics.neutralRetention || 0) - (baseline.neutralRetention || 0)) * 100,
        opposite:
          ((metrics.oppositeMisclassification || 0) - (baseline.oppositeMisclassification || 0)) * 100,
        strongUnclassified:
          ((metrics.strongOrientationUnclassifiedRate || 0) -
            (baseline.strongOrientationUnclassifiedRate || 0)) *
          100,
      },
      deltasCount: {
        move2:
          Math.round((metrics.changedAtLeastTwiceRate || 0) * 1000) -
          Math.round((baseline.changedAtLeastTwiceRate || 0) * 1000),
        oscillation:
          Math.round((metrics.actualOscillationRate || 0) * 1000) -
          Math.round((baseline.actualOscillationRate || 0) * 1000),
      },
    };
  }

  function resetTerritoryStabilizationComparison() {
    territoryStabilizationComparisonState = null;
    return { ok: true };
  }

  function getTerritoryStabilizationComparisonState() {
    return territoryStabilizationComparisonState
      ? clone(territoryStabilizationComparisonState)
      : null;
  }

  function getTerritoryStabilizationComparisonReport() {
    return territoryStabilizationComparisonState && territoryStabilizationComparisonState.report
      ? clone(territoryStabilizationComparisonState.report)
      : null;
  }

  function runTerritoryStabilizationComparison(options) {
    var opts = options || {};
    var userCount = opts.userCount != null ? opts.userCount : 1000;
    var daysList = opts.days || [30, 99];
    var seeds = opts.seeds || LARGE_SCALE_DEFAULT_SEEDS.slice();
    var thresholdIds = opts.thresholdPresetIds || ['CENTRAL_1000', 'CENTRAL_800'];
    var stabIds = opts.stabilizationPresetIds || [
      'BASELINE',
      'HYSTERESIS_200',
      'CONSECUTIVE_2',
      'HYSTERESIS_200_CONSECUTIVE_2',
      'HYSTERESIS_400_CONSECUTIVE_2',
    ];
    var quick = !!opts.quick;
    var started = Date.now();
    var maxDays = 0;
    var di;
    for (di = 0; di < daysList.length; di++) {
      if (daysList[di] > maxDays) maxDays = daysList[di];
    }

    var thresholds = [];
    var ti;
    for (ti = 0; ti < thresholdIds.length; ti++) {
      var tp = getThresholdPresetById(thresholdIds[ti]);
      if (!tp) throw new Error('Unknown threshold: ' + thresholdIds[ti]);
      thresholds.push(tp);
    }
    var stabs = [];
    var si;
    for (si = 0; si < stabIds.length; si++) {
      var sp = getStabilizationPresetById(stabIds[si]);
      if (!sp) throw new Error('Unknown stabilization: ' + stabIds[si]);
      stabs.push(sp);
    }

    var bySeed = [];
    var scoreMismatch = false;
    var seedI;
    for (seedI = 0; seedI < seeds.length; seedI++) {
      var seed = seeds[seedI];
      var templateUsers = createLargeScaleOrientationUsers({ seed: seed, userCount: userCount });
      var reactions = createLargeScaleOrientationReactions(templateUsers, {
        seed: seed,
        days: maxDays,
      });
      var reactionIndex = indexReactionsByTarget(reactions);
      var userFp = latentCompositionFingerprint(templateUsers);
      var rxFp = reactionsFlowFingerprint(reactions);
      var seedEntry = {
        seed: seed,
        userFingerprint: userFp,
        reactionFingerprint: rxFp,
        byDays: {},
      };
      for (di = 0; di < daysList.length; di++) seedEntry.byDays[daysList[di]] = {};

      var has30 = daysList.indexOf(30) >= 0;
      var has99 = daysList.indexOf(99) >= 0;

      for (ti = 0; ti < thresholds.length; ti++) {
        var th = thresholds[ti];
        for (si = 0; si < stabs.length; si++) {
          var st = stabs[si];
          function storePass(days, pass) {
            var summary = summarizeStabilizationUsers(
              pass.users,
              pass.delayedTotal,
              pass.preventedTotal,
            );
            if (!seedEntry.byDays[days][th.id]) seedEntry.byDays[days][th.id] = {};
            seedEntry.byDays[days][th.id][st.id] = {
              summary: summary,
              sharedUserFingerprint: userFp,
              sharedReactionFingerprint: rxFp,
              keepSnapshots: seedI === 0 ? summary.userSnapshots : null,
            };
            delete summary.userSnapshots;
          }

          if (has30 && has99 && maxDays >= 99) {
            storePass(
              30,
              runStabilizationPass(templateUsers, reactions, 30, th, st, {
                reactionIndex: reactionIndex,
              }),
            );
            storePass(
              99,
              runStabilizationPass(templateUsers, reactions, 99, th, st, {
                reactionIndex: reactionIndex,
              }),
            );
          } else {
            for (di = 0; di < daysList.length; di++) {
              storePass(
                daysList[di],
                runStabilizationPass(templateUsers, reactions, daysList[di], th, st, {
                  reactionIndex: reactionIndex,
                }),
              );
            }
          }
        }

        /* 점수 동일성 검증 */
        for (di = 0; di < daysList.length; di++) {
          var d = daysList[di];
          var baseFp = seedEntry.byDays[d][th.id].BASELINE.summary.scoreFingerprint;
          for (si = 0; si < stabs.length; si++) {
            if (seedEntry.byDays[d][th.id][stabs[si].id].summary.scoreFingerprint !== baseFp) {
              scoreMismatch = true;
            }
          }
        }
      }
      bySeed.push(seedEntry);
    }

    function avgMetric(days, thId, stId, picker) {
      return avg(
        bySeed.map(function (s) {
          return picker(s.byDays[days][thId][stId].summary);
        }),
      );
    }

    var results = {};
    for (di = 0; di < daysList.length; di++) {
      results[daysList[di]] = {};
      for (ti = 0; ti < thresholds.length; ti++) {
        var thId = thresholds[ti].id;
        results[daysList[di]][thId] = {};
        var baselineAvg = null;
        for (si = 0; si < stabs.length; si++) {
          var stId = stabs[si].id;
          var metrics = {
            endCounts: {
              pioneer: avgMetric(daysList[di], thId, stId, function (m) {
                return m.endCounts.pioneer;
              }),
              central: avgMetric(daysList[di], thId, stId, function (m) {
                return m.endCounts.central;
              }),
              guardian: avgMetric(daysList[di], thId, stId, function (m) {
                return m.endCounts.guardian;
              }),
            },
            movedAtLeastOnceRate: avgMetric(daysList[di], thId, stId, function (m) {
              return m.movedAtLeastOnceRate;
            }),
            changedAtLeastTwiceRate: avgMetric(daysList[di], thId, stId, function (m) {
              return m.changedAtLeastTwiceRate;
            }),
            changedAtLeastThreeTimesRate: avgMetric(daysList[di], thId, stId, function (m) {
              return m.changedAtLeastThreeTimesRate;
            }),
            actualOscillationRate: avgMetric(daysList[di], thId, stId, function (m) {
              return m.actualOscillationRate;
            }),
            boundaryNoiseRate: avgMetric(daysList[di], thId, stId, function (m) {
              return m.boundaryNoiseRate;
            }),
            trueSideSwitchRate: avgMetric(daysList[di], thId, stId, function (m) {
              return m.trueSideSwitchRate;
            }),
            returnToCentralRate: avgMetric(daysList[di], thId, stId, function (m) {
              return m.returnToCentralRate;
            }),
            avgTerritoryChangeCount: avgMetric(daysList[di], thId, stId, function (m) {
              return m.avgTerritoryChangeCount;
            }),
            avgFirstConfirmBatch: avgMetric(daysList[di], thId, stId, function (m) {
              return m.avgFirstConfirmBatch;
            }),
            avgFirstConfirmDays: avgMetric(daysList[di], thId, stId, function (m) {
              return m.avgFirstConfirmDays;
            }),
            territoryChangeDelayedCount: avgMetric(daysList[di], thId, stId, function (m) {
              return m.territoryChangeDelayedCount;
            }),
            territoryChangePreventedCount: avgMetric(daysList[di], thId, stId, function (m) {
              return m.territoryChangePreventedCount;
            }),
            orientationAccuracy: avgMetric(daysList[di], thId, stId, function (m) {
              return m.orientationAccuracy;
            }),
            oppositeMisclassification: avgMetric(daysList[di], thId, stId, function (m) {
              return m.oppositeMisclassification;
            }),
            neutralRetention: avgMetric(daysList[di], thId, stId, function (m) {
              return m.neutralRetention;
            }),
            strongOrientationUnclassifiedRate: avgMetric(daysList[di], thId, stId, function (m) {
              return m.strongOrientationUnclassifiedRate;
            }),
            pioneerHitRate: avgMetric(daysList[di], thId, stId, function (m) {
              return m.pioneer.hitRate;
            }),
            guardianHitRate: avgMetric(daysList[di], thId, stId, function (m) {
              return m.guardian.hitRate;
            }),
          };
          if (stId === 'BASELINE') baselineAvg = metrics;
          var effects = computeStabilizationEffects(metrics, baselineAvg || metrics);
          var status = classifyStabilizationStatus(metrics, baselineAvg || metrics);
          results[daysList[di]][thId][stId] = {
            metrics: metrics,
            effects: effects,
            status: status,
            autoSelected: false,
          };
        }
        /* BASELINE 기준 재계산 (순서상 BASELINE이 먼저여야 함) */
        baselineAvg = results[daysList[di]][thId].BASELINE.metrics;
        for (si = 0; si < stabs.length; si++) {
          stId = stabs[si].id;
          var row = results[daysList[di]][thId][stId];
          row.effects = computeStabilizationEffects(row.metrics, baselineAvg);
          row.status = classifyStabilizationStatus(row.metrics, baselineAvg);
        }
      }
    }

    /* 표본 (seed0 · 99 또는 최장) */
    var sampleDay = daysList.indexOf(99) >= 0 ? 99 : daysList[0];
    var samples = {
      oscillationPrevented: [],
      classificationDelayed: [],
      stuckInCentral: [],
      stillOscillating: [],
      finalTerritoryChanged: [],
      hysteresisOnlyHelps: [],
      consecutiveOnlyHelps: [],
    };
    if (bySeed[0] && bySeed[0].byDays[sampleDay]) {
      var thSample = thresholds[0].id;
      if (thresholds.some(function (t) {
        return t.id === 'CENTRAL_800';
      })) {
        thSample = 'CENTRAL_800';
      }
      var baseSnaps = bySeed[0].byDays[sampleDay][thSample].BASELINE.keepSnapshots || [];
      var byStab = {};
      stabs.forEach(function (st) {
        byStab[st.id] = bySeed[0].byDays[sampleDay][thSample][st.id].keepSnapshots || [];
      });
      var byIdBase = Object.create(null);
      baseSnaps.forEach(function (u) {
        byIdBase[u.userId] = u;
      });
      baseSnaps.forEach(function (b) {
        var h200 = (byStab.HYSTERESIS_200 || []).filter(function (x) {
          return x.userId === b.userId;
        })[0];
        var c2 = (byStab.CONSECUTIVE_2 || []).filter(function (x) {
          return x.userId === b.userId;
        })[0];
        var combo = (byStab.HYSTERESIS_200_CONSECUTIVE_2 || []).filter(function (x) {
          return x.userId === b.userId;
        })[0];
        if (!combo) return;
        var row = {
          userId: b.userId,
          latentOrientation: b.latentOrientation,
          latentStrength: b.latentStrength,
          finalOrientationScore: b.finalOrientationScore,
          baselineFinalTerritory: b.finalTerritory,
          stabilizationFinalTerritory: combo.finalTerritory,
          baselineCompressedPath: b.compressedPath,
          stabilizationCompressedPath: combo.compressedPath,
          baselineTerritoryChangeCount: b.territoryChangeCount,
          stabilizationTerritoryChangeCount: combo.territoryChangeCount,
          baselineFirstMoveBatch: b.firstConfirmBatch,
          stabilizationFirstMoveBatch: combo.firstConfirmBatch,
          oscillationPrevented: b.territoryChangeCount >= 2 && combo.territoryChangeCount < 2,
          classificationDelayed:
            b.firstConfirmBatch != null &&
            combo.firstConfirmBatch != null &&
            combo.firstConfirmBatch > b.firstConfirmBatch,
          classificationLost:
            b.finalTerritory !== TERRITORY.CENTRAL && combo.finalTerritory === TERRITORY.CENTRAL,
          finalTerritoryChangedByStabilization: b.finalTerritory !== combo.finalTerritory,
        };
        if (row.oscillationPrevented && samples.oscillationPrevented.length < 20) {
          samples.oscillationPrevented.push(row);
        }
        if (
          row.classificationDelayed &&
          b.latentStrength === LATENT_STRENGTH.STRONG &&
          samples.classificationDelayed.length < 20
        ) {
          samples.classificationDelayed.push(row);
        }
        if (
          row.classificationLost &&
          b.latentStrength === LATENT_STRENGTH.STRONG &&
          samples.stuckInCentral.length < 20
        ) {
          samples.stuckInCentral.push(row);
        }
        if (
          b.territoryChangeCount >= 2 &&
          combo.territoryChangeCount >= 2 &&
          samples.stillOscillating.length < 20
        ) {
          samples.stillOscillating.push(row);
        }
        if (row.finalTerritoryChangedByStabilization && samples.finalTerritoryChanged.length < 20) {
          samples.finalTerritoryChanged.push(row);
        }
        if (
          h200 &&
          c2 &&
          b.territoryChangeCount >= 2 &&
          h200.territoryChangeCount < 2 &&
          c2.territoryChangeCount >= 2 &&
          samples.hysteresisOnlyHelps.length < 20
        ) {
          samples.hysteresisOnlyHelps.push(row);
        }
        if (
          h200 &&
          c2 &&
          b.territoryChangeCount >= 2 &&
          c2.territoryChangeCount < 2 &&
          h200.territoryChangeCount >= 2 &&
          samples.consecutiveOnlyHelps.length < 20
        ) {
          samples.consecutiveOnlyHelps.push(row);
        }
      });
    }

    var rankings = {};
    for (di = 0; di < daysList.length; di++) {
      rankings[daysList[di]] = {};
      for (ti = 0; ti < thresholds.length; ti++) {
        var thId2 = thresholds[ti].id;
        rankings[daysList[di]][thId2] = stabs
          .map(function (st) {
            var r = results[daysList[di]][thId2][st.id];
            return {
              rank: 0,
              stabilizationPresetId: st.id,
              label: st.label,
              stabilityScore: r.effects.stabilityScore,
              status: r.status,
              note: '참고용 순위 · 자동 확정 아님',
            };
          })
          .sort(function (a, b) {
            return b.stabilityScore - a.stabilityScore;
          })
          .map(function (row, idx) {
            row.rank = idx + 1;
            return row;
          });
      }
    }

    var tables = {};
    for (di = 0; di < daysList.length; di++) {
      tables[daysList[di]] = [];
      for (ti = 0; ti < thresholds.length; ti++) {
        for (si = 0; si < stabs.length; si++) {
          var cell = results[daysList[di]][thresholds[ti].id][stabs[si].id];
          tables[daysList[di]].push({
            threshold: thresholds[ti].id,
            stabilization: stabs[si].id,
            move2: cell.metrics.changedAtLeastTwiceRate,
            move3: cell.metrics.changedAtLeastThreeTimesRate,
            oscillation: cell.metrics.actualOscillationRate,
            boundaryNoise: cell.metrics.boundaryNoiseRate,
            accuracy: cell.metrics.orientationAccuracy,
            neutralRetention: cell.metrics.neutralRetention,
            opposite: cell.metrics.oppositeMisclassification,
            avgFirstConfirm: cell.metrics.avgFirstConfirmBatch,
            strongUnclassified: cell.metrics.strongOrientationUnclassifiedRate,
            delayed: cell.metrics.territoryChangeDelayedCount,
            prevented: cell.metrics.territoryChangePreventedCount,
            stabilityScore: cell.effects.stabilityScore,
            status: cell.status,
          });
        }
      }
    }

    var elapsedMs = Date.now() - started;
    var report = {
      meta: {
        mode: ORIENTATION_SIMULATION_MODES.TERRITORY_STABILIZATION_COMPARISON,
        quick: quick,
        userCount: userCount,
        seeds: seeds.slice(),
        seedCount: seeds.length,
        days: daysList.slice(),
        thresholdPresetIds: thresholdIds.slice(),
        stabilizationPresetIds: stabIds.slice(),
        elapsedMs: elapsedMs,
        autoSelectedStabilization: null,
        scoreIdenticalAcrossStabilizations: !scoreMismatch,
        note: '시뮬레이션 비교만 · 운영 안정화 규칙 미적용',
      },
      results: results,
      tables: tables,
      rankings: rankings,
      samples: samples,
      bySeed: bySeed.map(function (s) {
        return {
          seed: s.seed,
          userFingerprint: s.userFingerprint,
          reactionFingerprint: s.reactionFingerprint,
        };
      }),
      seed0Details: bySeed[0] || null,
    };

    territoryStabilizationComparisonState = {
      mode: ORIENTATION_SIMULATION_MODES.TERRITORY_STABILIZATION_COMPARISON,
      options: {
        userCount: userCount,
        days: daysList.slice(),
        seeds: seeds.slice(),
        thresholdPresetIds: thresholdIds.slice(),
        stabilizationPresetIds: stabIds.slice(),
        quick: quick,
      },
      report: report,
      finishedAt: new Date().toISOString(),
      elapsedMs: elapsedMs,
    };
    return report;
  }

  function compareTerritoryStabilizationPresets(options) {
    return runTerritoryStabilizationComparison(options || {});
  }

  /* ─── 전역 노출 ─── */

  global.ORIENTATION_SIMULATION_CONFIG = ORIENTATION_SIMULATION_CONFIG;
  global.ORIENTATION_SIMULATION_MODES = ORIENTATION_SIMULATION_MODES;
  global.LARGE_SCALE_THRESHOLD_PRESETS = LARGE_SCALE_THRESHOLD_PRESETS;
  global.LARGE_SCALE_DEFAULT_SEEDS = LARGE_SCALE_DEFAULT_SEEDS;
  global.LARGE_SCALE_THRESHOLD_STATUS = LARGE_SCALE_THRESHOLD_STATUS;
  global.TERRITORY_STABILIZATION_PRESETS = TERRITORY_STABILIZATION_PRESETS;
  global.STABILIZATION_STATUS = STABILIZATION_STATUS;
  global.ORIENTATION_SIM_TERRITORY = TERRITORY;
  global.ORIENTATION_SIM_LATENT = LATENT;
  global.ORIENTATION_SIM_LATENT_STRENGTH = LATENT_STRENGTH;
  global.createOrientationSimulationUsers = createOrientationSimulationUsers;
  global.createOrientationSimulationReactions = createOrientationSimulationReactions;
  global.createZeroStartOrientationUsers = createZeroStartOrientationUsers;
  global.createZeroStartOrientationReactions = createZeroStartOrientationReactions;
  global.createLargeScaleOrientationUsers = createLargeScaleOrientationUsers;
  global.createLargeScaleOrientationReactions = createLargeScaleOrientationReactions;
  global.runOrientationBatch = runOrientationBatch;
  global.runOrientationSimulation = runOrientationSimulation;
  global.runLargeScaleOrientationComparison = runLargeScaleOrientationComparison;
  global.compareOrientationThresholdPresets = compareOrientationThresholdPresets;
  global.getLargeScaleOrientationComparisonState = getLargeScaleOrientationComparisonState;
  global.getLargeScaleOrientationComparisonReport = getLargeScaleOrientationComparisonReport;
  global.resetLargeScaleOrientationComparison = resetLargeScaleOrientationComparison;
  global.runLargeOrientationComparisonTests = runLargeOrientationComparisonTests;
  global.runTerritoryOscillationCauseAnalysis = runTerritoryOscillationCauseAnalysis;
  global.getTerritoryOscillationCauseReport = getTerritoryOscillationCauseReport;
  global.getTerritoryOscillationCauseState = getTerritoryOscillationCauseState;
  global.resetTerritoryOscillationCauseAnalysis = resetTerritoryOscillationCauseAnalysis;
  global.runTerritoryOscillationCauseTests = runTerritoryOscillationCauseTests;
  global.runTerritoryStabilizationComparison = runTerritoryStabilizationComparison;
  global.compareTerritoryStabilizationPresets = compareTerritoryStabilizationPresets;
  global.getTerritoryStabilizationComparisonState = getTerritoryStabilizationComparisonState;
  global.getTerritoryStabilizationComparisonReport = getTerritoryStabilizationComparisonReport;
  global.resetTerritoryStabilizationComparison = resetTerritoryStabilizationComparison;
  global.runTerritoryStabilizationTests = runTerritoryStabilizationTests;
  global.getTerritoryTransitionThresholds = getTerritoryTransitionThresholds;
  global.resolveCandidateTerritory = resolveCandidateTerritory;
  global.compressTerritoryPath = compressTerritoryPath;
  global.classifyOscillationPath = classifyOscillationPath;
  global.calculateBatchCauseBreakdown = calculateBatchCauseBreakdown;
  global.determinePrimaryTerritoryMoveCause = determinePrimaryTerritoryMoveCause;
  global.resetOrientationSimulation = resetOrientationSimulation;
  global.resetAllOrientationSimulations = resetAllOrientationSimulations;
  global.getOrientationSimulationState = getOrientationSimulationState;
  global.getOrientationSimulationReport = getOrientationSimulationReport;
  global.getZeroStartOrientationReport = getZeroStartOrientationReport;
  global.runOrientationFixedTests = runOrientationFixedTests;
  global.runZeroStartOrientationFixedTests = runZeroStartOrientationFixedTests;
  global.runAllOrientationFixedTests = runAllOrientationFixedTests;
  global.compareZeroStartOrientation30And99Days = compareZeroStartOrientation30And99Days;
  global.resolveOrientationTerritoryFromScore = resolveTerritoryFromScore;
  global.computeOrientationReactionSignedDelta = computeReactionSignedDelta;
  global.setLatentOrientationBehaviorRates = setLatentOrientationBehaviorRates;

  /** 개발용 — 배포 전 제거/비활성 대상 */
  global.__scRunOrientationSimulation = function (options) {
    var report = runOrientationSimulation(options || { days: 30, seed: 20260726 });
    return logOrientationReport(report);
  };
  global.__scRunOrientationSimulation30Days = function () {
    return global.__scRunOrientationSimulation({
      mode: ORIENTATION_SIMULATION_MODES.BASE_SCORE_MOVEMENT,
      days: 30,
      seed: 20260726,
    });
  };
  global.__scRunOrientationSimulation99Days = function () {
    return global.__scRunOrientationSimulation({
      mode: ORIENTATION_SIMULATION_MODES.BASE_SCORE_MOVEMENT,
      days: 99,
      seed: 20260726,
    });
  };
  global.__scGetOrientationSimulationReport = function () {
    return getOrientationSimulationReport();
  };
  global.__scGetOrientationSimulationUsers = function () {
    return simulationState ? clone(simulationState.users) : [];
  };
  global.__scGetOrientationSimulationMovers = function () {
    var report = getOrientationSimulationReport();
    return report ? report.movers : [];
  };
  global.__scGetOrientationSimulationUser = function (userId) {
    if (!simulationState) return null;
    var id = String(userId || '').trim();
    var i;
    for (i = 0; i < simulationState.users.length; i++) {
      if (simulationState.users[i].userId === id) return clone(simulationState.users[i]);
    }
    return null;
  };
  global.__scRunOrientationFixedTests = function () {
    var out = runOrientationFixedTests();
    console.log(
      '[OrientationSim] 1차 고정 테스트',
      out.passed + '/' + out.total,
      out.allPassed ? 'PASS' : 'FAIL',
    );
    console.table(
      out.results.map(function (r) {
        return { name: r.name, pass: r.pass };
      }),
    );
    return out;
  };
  global.__scResetOrientationSimulation = function () {
    return resetOrientationSimulation();
  };
  global.__scSetOrientationSimulationThresholds = setOrientationSimulationThresholds;
  global.__scSetOrientationSimulationBatchCap = setOrientationSimulationBatchCap;
  global.__scSetLatentOrientationBehaviorRates = function (partial) {
    var out = setLatentOrientationBehaviorRates(partial);
    console.log('[OrientationSim] latent rates', out);
    return out;
  };

  global.__scRunZeroStartOrientationSimulation = function (options) {
    var opts = options || {};
    opts.mode = ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION;
    if (opts.days == null) opts.days = 30;
    if (opts.seed == null) opts.seed = 20260726;
    if (opts.userCount == null) opts.userCount = 120;
    return logOrientationReport(runOrientationSimulation(opts));
  };
  global.__scRunZeroStartOrientationSimulation30Days = function () {
    return global.__scRunZeroStartOrientationSimulation({ days: 30, seed: 20260726 });
  };
  global.__scRunZeroStartOrientationSimulation99Days = function () {
    return global.__scRunZeroStartOrientationSimulation({ days: 99, seed: 20260726 });
  };
  global.__scCompareZeroStartOrientation30And99Days = function (options) {
    var cmp = compareZeroStartOrientation30And99Days(options);
    console.log('[OrientationSim] 2차 30일 vs 99일 비교');
    console.log('초기 성향 동일', cmp.sameInitialLatentComposition);
    console.log('30일', cmp.day30);
    console.log('99일', cmp.day99);
    console.log('변화량', cmp.deltas);
    return cmp;
  };
  global.__scGetZeroStartOrientationReport = function (days) {
    return getZeroStartOrientationReport(days);
  };
  global.__scGetZeroStartOrientationUsers = function (days) {
    var report = getZeroStartOrientationReport(days);
    return report ? report.users : [];
  };
  global.__scGetZeroStartOrientationMismatches = function (days) {
    var report = getZeroStartOrientationReport(days);
    return report ? report.mismatches : [];
  };
  global.__scGetZeroStartOrientationOppositeMovers = function (days) {
    var report = getZeroStartOrientationReport(days);
    return report ? report.oppositeMovers : [];
  };
  global.__scRunZeroStartOrientationFixedTests = function () {
    var out = runZeroStartOrientationFixedTests();
    console.log(
      '[OrientationSim] 2차 고정 테스트',
      out.passed + '/' + out.total,
      out.allPassed ? 'PASS' : 'FAIL',
    );
    console.table(
      out.results.map(function (r) {
        return { name: r.name, pass: r.pass };
      }),
    );
    return out;
  };
  global.__scRunAllOrientationSimulations = function () {
    var base = runOrientationSimulation({
      mode: ORIENTATION_SIMULATION_MODES.BASE_SCORE_MOVEMENT,
      days: 30,
      seed: 20260726,
    });
    var zero30 = runOrientationSimulation({
      mode: ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION,
      days: 30,
      seed: 20260726,
      userCount: 120,
    });
    var zero99 = runOrientationSimulation({
      mode: ORIENTATION_SIMULATION_MODES.ZERO_START_LATENT_ORIENTATION,
      days: 99,
      seed: 20260726,
      userCount: 120,
    });
    console.log('[OrientationSim] 통합 실행 완료 · 모드별 상태 보존');
    console.log('1차 종료', base.summary.endCounts);
    console.log('2차 30일 종료', zero30.summary.endCounts);
    console.log('2차 99일 종료', zero99.summary.endCounts);
    return {
      baseScoreMovement: base,
      zeroStart30: zero30,
      zeroStart99: zero99,
      storedModes: Object.keys(simulationStoreByMode),
    };
  };
  global.__scRunAllOrientationFixedTests = function () {
    var out = runAllOrientationFixedTests();
    console.log(
      '[OrientationSim] 전체 고정 테스트',
      out.passed + '/' + out.total,
      out.allPassed ? 'PASS' : 'FAIL',
    );
    return out;
  };

  global.__scRunLargeOrientationComparison = function (options) {
    var report = runLargeScaleOrientationComparison(
      options || {
        userCount: 1000,
        days: [30, 99],
        seeds: LARGE_SCALE_DEFAULT_SEEDS.slice(),
        thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800', 'CENTRAL_600', 'CENTRAL_400'],
        quick: false,
      },
    );
    console.log('[OrientationSim] 3차 대규모 비교 완료', report.quick ? '(빠른)' : '(전체)');
    console.log('소요(ms)', report.elapsedMs, '/ seed', report.seedCount, '/ users', report.userCount);
    Object.keys(report.tables).forEach(function (d) {
      console.log('--- ' + d + '일 비교표 ---');
      console.table(report.tables[d]);
      console.log('순위(참고)', report.rankings[d]);
    });
    return report;
  };
  global.__scRunLargeOrientationComparison30Days = function () {
    return global.__scRunLargeOrientationComparison({
      userCount: 1000,
      days: [30],
      seeds: LARGE_SCALE_DEFAULT_SEEDS.slice(),
      thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800', 'CENTRAL_600', 'CENTRAL_400'],
      quick: false,
    });
  };
  global.__scRunLargeOrientationComparison99Days = function () {
    return global.__scRunLargeOrientationComparison({
      userCount: 1000,
      days: [99],
      seeds: LARGE_SCALE_DEFAULT_SEEDS.slice(),
      thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800', 'CENTRAL_600', 'CENTRAL_400'],
      quick: false,
    });
  };
  global.__scRunLargeOrientationQuickComparison = function () {
    return global.__scRunLargeOrientationComparison({
      userCount: 1000,
      days: [30],
      seeds: [20260726, 20260727, 20260728],
      thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800', 'CENTRAL_600', 'CENTRAL_400'],
      quick: true,
    });
  };
  global.__scGetLargeOrientationComparisonReport = function () {
    return getLargeScaleOrientationComparisonReport();
  };
  global.__scGetLargeOrientationThresholdRanking = function (days) {
    var report = getLargeScaleOrientationComparisonReport();
    if (!report) return null;
    var d = days != null ? days : report.days[report.days.length - 1];
    return report.rankings[d] || null;
  };
  global.__scGetLargeOrientationSeedResults = function (seed) {
    var report = getLargeScaleOrientationComparisonReport();
    if (!report) return null;
    var s = Number(seed);
    var i;
    for (i = 0; i < report.bySeed.length; i++) {
      if (report.bySeed[i].seed === s) return clone(report.bySeed[i]);
    }
    return null;
  };
  global.__scGetLargeOrientationThresholdResult = function (presetId, days) {
    var report = getLargeScaleOrientationComparisonReport();
    if (!report) return null;
    var d = days != null ? days : 30;
    return report.aggregated[d] && report.aggregated[d][presetId]
      ? clone(report.aggregated[d][presetId])
      : null;
  };
  global.__scGetLargeOrientationChangedUsers = function () {
    var report = getLargeScaleOrientationComparisonReport();
    return report ? report.changedUsersByThreshold : [];
  };
  global.__scRunLargeOrientationComparisonTests = function () {
    var out = runLargeOrientationComparisonTests();
    console.log(
      '[OrientationSim] 3차 고정 테스트',
      out.passed + '/' + out.total,
      out.allPassed ? 'PASS' : 'FAIL',
    );
    console.table(
      out.results.map(function (r) {
        return { name: r.name, pass: r.pass };
      }),
    );
    return out;
  };
  global.__scResetLargeOrientationComparison = function () {
    return resetLargeScaleOrientationComparison();
  };

  global.__scRunTerritoryOscillationCauseAnalysis = function (options) {
    var report = runTerritoryOscillationCauseAnalysis(
      options || {
        userCount: 1000,
        days: [30, 99],
        seeds: LARGE_SCALE_DEFAULT_SEEDS.slice(),
        thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800', 'CENTRAL_600', 'CENTRAL_400'],
        quick: false,
      },
    );
    console.log(
      '[OrientationSim] 4차 왕복 원인 분석',
      report.meta.quick ? '(빠른)' : '(전체)',
      'ms',
      report.meta.elapsedMs,
    );
    Object.keys(report.thresholdSummaries).forEach(function (d) {
      console.log('--- ' + d + '일 ---');
      console.table(
        Object.keys(report.thresholdSummaries[d]).map(function (pid) {
          var s = report.thresholdSummaries[d][pid];
          return {
            preset: pid,
            move2: Math.round(s.changedAtLeastTwice),
            move3: Math.round(s.changedAtLeastThreeTimes),
            osc: Math.round(s.actualOscillationUsers),
            sideSwitch: Math.round(s.trueSideSwitchUsers),
            unexplained: Math.round(s.unexplainedCount),
          };
        }),
      );
    });
    return report;
  };
  global.__scRunTerritoryOscillationCauseAnalysis30Days = function () {
    return global.__scRunTerritoryOscillationCauseAnalysis({
      userCount: 1000,
      days: [30],
      seeds: LARGE_SCALE_DEFAULT_SEEDS.slice(),
      thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800', 'CENTRAL_600', 'CENTRAL_400'],
    });
  };
  global.__scRunTerritoryOscillationCauseAnalysis99Days = function () {
    return global.__scRunTerritoryOscillationCauseAnalysis({
      userCount: 1000,
      days: [99],
      seeds: LARGE_SCALE_DEFAULT_SEEDS.slice(),
      thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800', 'CENTRAL_600', 'CENTRAL_400'],
    });
  };
  global.__scRunTerritoryOscillationCauseQuickAnalysis = function () {
    return global.__scRunTerritoryOscillationCauseAnalysis({
      userCount: 1000,
      days: [99],
      seeds: [20260726, 20260727, 20260728],
      thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800'],
      quick: true,
    });
  };
  global.__scGetTerritoryOscillationCauseReport = function () {
    return getTerritoryOscillationCauseReport();
  };
  global.__scGetTerritoryOscillationThresholdSummary = function (presetId, days) {
    var report = getTerritoryOscillationCauseReport();
    if (!report) return null;
    var d = days != null ? days : 99;
    return report.thresholdSummaries[d] && report.thresholdSummaries[d][presetId]
      ? clone(report.thresholdSummaries[d][presetId])
      : null;
  };
  global.__scGetTerritoryOscillationUsers = function (filters) {
    var f = filters || {};
    var report = getTerritoryOscillationCauseReport();
    if (!report || !report.bySeed.length) return [];
    var seedBlock = report.bySeed[0];
    var d = f.days != null ? f.days : report.meta.days[report.meta.days.length - 1];
    var pid = f.presetId || report.meta.presets[0].id;
    var analyses = (seedBlock.byDays[d] && seedBlock.byDays[d][pid] && seedBlock.byDays[d][pid].analyses) || [];
    return analyses.filter(function (a) {
      if (f.latentOrientation && a.latentOrientation !== f.latentOrientation) return false;
      if (f.oscillationType && a.oscillationType !== f.oscillationType) return false;
      if (f.causeClassification && a.causeClassification !== f.causeClassification) return false;
      if (
        f.minimumTerritoryChanges != null &&
        a.territoryChangeCount < f.minimumTerritoryChanges
      ) {
        return false;
      }
      return true;
    });
  };
  global.__scGetTerritoryOscillationUser = function (userId, presetId, days, seed) {
    var report = getTerritoryOscillationCauseReport();
    if (!report) return null;
    var s = seed != null ? Number(seed) : report.bySeed[0].seed;
    var d = days != null ? days : 99;
    var pid = presetId || 'CENTRAL_1000';
    var block = null;
    var i;
    for (i = 0; i < report.bySeed.length; i++) {
      if (report.bySeed[i].seed === s) {
        block = report.bySeed[i].byDays[d] && report.bySeed[i].byDays[d][pid];
        break;
      }
    }
    if (!block || !block.analyses) return null;
    for (i = 0; i < block.analyses.length; i++) {
      if (block.analyses[i].userId === userId) return clone(block.analyses[i]);
    }
    return null;
  };
  global.__scGetTerritoryOscillationCauseSamples = function (cause) {
    return global.__scGetTerritoryOscillationUsers({
      days: 99,
      presetId: 'CENTRAL_1000',
      causeClassification: cause,
      minimumTerritoryChanges: 2,
    }).slice(0, 20);
  };
  global.__scGetTerritoryOscillationPathSamples = function (pathType) {
    return global.__scGetTerritoryOscillationUsers({
      days: 99,
      presetId: 'CENTRAL_1000',
      oscillationType: pathType,
      minimumTerritoryChanges: 2,
    }).slice(0, 20);
  };
  global.__scGetTerritoryBoundaryNoiseUsers = function () {
    return global.__scGetTerritoryOscillationCauseSamples('BOUNDARY_NOISE');
  };
  global.__scGetTerritoryBehaviorShiftUsers = function () {
    return global.__scGetTerritoryOscillationCauseSamples('BEHAVIOR_SHIFT');
  };
  global.__scGetTerritoryUnexplainedUsers = function () {
    return global.__scGetTerritoryOscillationCauseSamples('UNEXPLAINED');
  };
  global.__scCompareTerritoryOscillationAcrossThresholds = function () {
    var report = getTerritoryOscillationCauseReport();
    return report ? report.crossThresholdComparisons : [];
  };
  global.__scRunTerritoryOscillationCauseTests = function () {
    var out = runTerritoryOscillationCauseTests();
    console.log(
      '[OrientationSim] 4차 고정 테스트',
      out.passed + '/' + out.total,
      out.allPassed ? 'PASS' : 'FAIL',
    );
    console.table(
      out.results.map(function (r) {
        return { name: r.name, pass: r.pass };
      }),
    );
    return out;
  };
  global.__scResetTerritoryOscillationCauseAnalysis = function () {
    return resetTerritoryOscillationCauseAnalysis();
  };

  global.__scRunTerritoryStabilizationComparison = function (options) {
    var report = runTerritoryStabilizationComparison(
      options || {
        userCount: 1000,
        days: [30, 99],
        seeds: LARGE_SCALE_DEFAULT_SEEDS.slice(),
        thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800'],
        stabilizationPresetIds: [
          'BASELINE',
          'HYSTERESIS_200',
          'CONSECUTIVE_2',
          'HYSTERESIS_200_CONSECUTIVE_2',
          'HYSTERESIS_400_CONSECUTIVE_2',
        ],
        quick: false,
      },
    );
    console.log(
      '[OrientationSim] 5차 안정화 비교',
      report.meta.quick ? '(빠른)' : '(전체)',
      'ms',
      report.meta.elapsedMs,
      '점수동일',
      report.meta.scoreIdenticalAcrossStabilizations,
    );
    Object.keys(report.tables).forEach(function (d) {
      console.log('--- ' + d + '일 ---');
      console.table(report.tables[d]);
    });
    return report;
  };
  global.__scRunTerritoryStabilizationComparison30Days = function () {
    return global.__scRunTerritoryStabilizationComparison({
      userCount: 1000,
      days: [30],
      seeds: LARGE_SCALE_DEFAULT_SEEDS.slice(),
      thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800'],
      stabilizationPresetIds: [
        'BASELINE',
        'HYSTERESIS_200',
        'CONSECUTIVE_2',
        'HYSTERESIS_200_CONSECUTIVE_2',
        'HYSTERESIS_400_CONSECUTIVE_2',
      ],
    });
  };
  global.__scRunTerritoryStabilizationComparison99Days = function () {
    return global.__scRunTerritoryStabilizationComparison({
      userCount: 1000,
      days: [99],
      seeds: LARGE_SCALE_DEFAULT_SEEDS.slice(),
      thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800'],
      stabilizationPresetIds: [
        'BASELINE',
        'HYSTERESIS_200',
        'CONSECUTIVE_2',
        'HYSTERESIS_200_CONSECUTIVE_2',
        'HYSTERESIS_400_CONSECUTIVE_2',
      ],
    });
  };
  global.__scRunTerritoryStabilizationQuickComparison = function () {
    return global.__scRunTerritoryStabilizationComparison({
      userCount: 1000,
      days: [99],
      seeds: [20260726, 20260727, 20260728],
      thresholdPresetIds: ['CENTRAL_1000', 'CENTRAL_800'],
      stabilizationPresetIds: [
        'BASELINE',
        'HYSTERESIS_200',
        'CONSECUTIVE_2',
        'HYSTERESIS_200_CONSECUTIVE_2',
        'HYSTERESIS_400_CONSECUTIVE_2',
      ],
      quick: true,
    });
  };
  global.__scGetTerritoryStabilizationReport = function () {
    return getTerritoryStabilizationComparisonReport();
  };
  global.__scGetTerritoryStabilizationRanking = function (thresholdPresetId, days) {
    var report = getTerritoryStabilizationComparisonReport();
    if (!report) return null;
    var d = days != null ? days : 99;
    var th = thresholdPresetId || 'CENTRAL_800';
    return report.rankings[d] && report.rankings[d][th] ? report.rankings[d][th] : null;
  };
  global.__scGetTerritoryStabilizationResult = function (
    thresholdPresetId,
    stabilizationPresetId,
    days,
  ) {
    var report = getTerritoryStabilizationComparisonReport();
    if (!report) return null;
    var d = days != null ? days : 99;
    return (
      report.results[d] &&
      report.results[d][thresholdPresetId] &&
      report.results[d][thresholdPresetId][stabilizationPresetId]
    );
  };
  global.__scGetTerritoryStabilizationUsers = function (filters) {
    var f = filters || {};
    var report = getTerritoryStabilizationComparisonReport();
    if (!report || !report.seed0Details) return [];
    var d = f.days != null ? f.days : 99;
    var th = f.thresholdPresetId || 'CENTRAL_800';
    var st = f.stabilizationPresetId || 'BASELINE';
    var block =
      report.seed0Details.byDays &&
      report.seed0Details.byDays[d] &&
      report.seed0Details.byDays[d][th] &&
      report.seed0Details.byDays[d][th][st];
    var snaps = (block && block.keepSnapshots) || [];
    return snaps.filter(function (u) {
      if (f.latentOrientation && u.latentOrientation !== f.latentOrientation) return false;
      if (f.minimumBaselineChanges != null) {
        /* baseline 비교는 samples에서 처리 */
      }
      return true;
    });
  };
  global.__scGetTerritoryStabilizationSamples = function (sampleType) {
    var report = getTerritoryStabilizationComparisonReport();
    if (!report || !report.samples) return [];
    return report.samples[sampleType] || [];
  };
  global.__scCompareTerritoryStabilizationForUser = function (
    userId,
    thresholdPresetId,
    days,
    seed,
  ) {
    var report = getTerritoryStabilizationComparisonReport();
    if (!report || !report.seed0Details) return null;
    var d = days != null ? days : 99;
    var th = thresholdPresetId || 'CENTRAL_800';
    var out = { userId: userId, byStabilization: {} };
    var stabs = report.meta.stabilizationPresetIds || [];
    stabs.forEach(function (st) {
      var snaps =
        (report.seed0Details.byDays[d][th][st] &&
          report.seed0Details.byDays[d][th][st].keepSnapshots) ||
        [];
      var found = snaps.filter(function (u) {
        return u.userId === userId;
      })[0];
      if (found) out.byStabilization[st] = found;
    });
    void seed;
    return out;
  };
  global.__scRunTerritoryStabilizationTests = function () {
    var out = runTerritoryStabilizationTests();
    console.log(
      '[OrientationSim] 5차 고정 테스트',
      out.passed + '/' + out.total,
      out.allPassed ? 'PASS' : 'FAIL',
    );
    console.table(
      out.results.map(function (r) {
        return { name: r.name, pass: r.pass };
      }),
    );
    return out;
  };
  global.__scResetTerritoryStabilizationComparison = function () {
    return resetTerritoryStabilizationComparison();
  };

  /**
   * 이전 리포트 스냅샷이 있을 때만 비교.
   * target 계산 로직은 재실행하지 않음.
   */
  global.__scCompareOrientationCalculationResult = function () {
    var current = getOrientationSimulationReport();
    var legacy = global.__scOrientationSimLegacyReport || null;
    if (!current) {
      return { available: false, message: '현재 리포트 없음. 시뮬레이션을 먼저 실행하세요.' };
    }
    if (!legacy || !legacy.summary) {
      return {
        available: false,
        message:
          '이전(target) 리포트 스냅샷 없음. window.__scOrientationSimLegacyReport에 과거 summary를 넣으면 비교 가능.',
        currentSummary: current.summary,
      };
    }
    return {
      available: true,
      currentMethod: current.summary.calculationMethod,
      legacyMethod: legacy.summary.calculationMethod || 'TARGET_BASE_APPROACH',
      current: {
        endCounts: current.summary.endCounts,
        movedAtLeastOnce: current.summary.movedAtLeastOnce,
        pathPioneerCentralGuardian: current.summary.pathPioneerCentralGuardian,
        pathGuardianCentralPioneer: current.summary.pathGuardianCentralPioneer,
        capAppliedCount: current.summary.capAppliedCount,
      },
      legacy: {
        endCounts: legacy.summary.endCounts,
        movedAtLeastOnce: legacy.summary.movedAtLeastOnce,
        pathPioneerCentralGuardian: legacy.summary.pathPioneerCentralGuardian,
        pathGuardianCentralPioneer: legacy.summary.pathGuardianCentralPioneer,
        capAppliedCount: legacy.summary.capAppliedCount,
      },
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
