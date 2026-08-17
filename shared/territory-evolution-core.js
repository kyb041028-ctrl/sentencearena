/**
 * 센텐스아레나 — 영토 발전 공용 규칙·계약 (단일 원천)
 * 브라우저(UMD) · Node(CommonJS)
 *
 * 확정 규칙:
 * - PIONEER/GUARDIAN 발전 인원 = 해당 영토 직접 소속
 * - CENTRAL 발전 인원 = CENTRAL + PIONEER + GUARDIAN (Earth 전체, ALIEN 제외)
 * - ALIEN은 지구 집계 제외. live count = citizenship_status KANTAPBIYA_RESIDENT
 * - 단계는 현재 population으로 매번 재판정 (하락 허용, highestStage 없음)
 * - 임계값·단계 label·이미지 경로는 이 파일만 수정
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TerritoryEvolutionCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function territoryEvolutionCoreFactory() {
  'use strict';

  var DATA_STATUS = Object.freeze({
    READY: 'READY',
    LOADING: 'LOADING',
    UNAVAILABLE: 'UNAVAILABLE',
    PARTIAL: 'PARTIAL',
    INVALID: 'INVALID',
    LEGACY_MOCK: 'LEGACY_MOCK',
  });

  var POPULATION_SOURCE = Object.freeze({
    OPERATIONAL_USER_DATA: 'OPERATIONAL_USER_DATA',
    OPERATIONAL_ALIGNMENT: 'OPERATIONAL_ALIGNMENT',
    LEGACY_MOCK: 'LEGACY_MOCK',
    MEMORY: 'MEMORY',
    UNAVAILABLE: 'UNAVAILABLE',
  });

  /** 운영 영토 ID */
  var OPERATIONAL_TERRITORIES = Object.freeze(['CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN']);

  /** UI/이미지용 소문자 key */
  var EVO_KEYS = Object.freeze(['central', 'pioneer', 'guardian', 'alien']);

  var OPERATIONAL_TO_EVO = Object.freeze({
    CENTRAL: 'central',
    PIONEER: 'pioneer',
    GUARDIAN: 'guardian',
    ALIEN: 'alien',
  });

  var EVO_TO_OPERATIONAL = Object.freeze({
    central: 'CENTRAL',
    pioneer: 'PIONEER',
    guardian: 'GUARDIAN',
    alien: 'ALIEN',
  });

  var LEGACY_TO_OPERATIONAL = Object.freeze({
    COMMON: 'CENTRAL',
    PROGRESSIVE: 'PIONEER',
    CONSERVATIVE: 'GUARDIAN',
    KANTAPBIYA: 'ALIEN',
    CENTER: 'CENTRAL',
  });

  var TERRITORY_LABELS = Object.freeze({
    CENTRAL: '중앙광장',
    PIONEER: '개척영토',
    GUARDIAN: '수호영토',
    ALIEN: '외계행성',
    central: '중앙광장',
    pioneer: '개척영토',
    guardian: '수호영토',
    alien: '외계행성',
  });

  var COMMON_STAGE_LABELS = Object.freeze({
    1: '원시',
    2: '고대',
    3: '중세',
    4: '근대',
    5: '현대',
    6: '미래',
  });

  var ALIEN_STAGE_LABELS = Object.freeze({
    1: '문명탄생',
    2: '문명형성',
    3: '문명발전',
    4: '문명확장',
    5: '문명번영',
    6: '문명포화',
  });

  var STAGE_KEYS = Object.freeze({
    1: 'primitive',
    2: 'ancient',
    3: 'medieval',
    4: 'early-modern',
    5: 'modern',
    6: 'future',
  });

  /** 단계 임계값 (단일 원천) */
  var STAGE_THRESHOLDS = Object.freeze([
    Object.freeze({ stage: 1, min: 0, max: 100, rangeLabel: '0~100명' }),
    Object.freeze({ stage: 2, min: 101, max: 300, rangeLabel: '101~300명' }),
    Object.freeze({ stage: 3, min: 301, max: 1000, rangeLabel: '301~1,000명' }),
    Object.freeze({ stage: 4, min: 1001, max: 2000, rangeLabel: '1,001~2,000명' }),
    Object.freeze({ stage: 5, min: 2001, max: 8000, rangeLabel: '2,001~8,000명' }),
    Object.freeze({ stage: 6, min: 8001, max: null, rangeLabel: '8,001명 이상' }),
  ]);

  var IMAGE_BASE = '/assets/territory-evolution';
  var COMMON_PRIMITIVE = IMAGE_BASE + '/territory-evolution-common-primitive.png';

  var EVOLUTION_IMAGES = Object.freeze({
    pioneer: Object.freeze({
      1: COMMON_PRIMITIVE,
      2: IMAGE_BASE + '/territory-evolution-pioneer-ancient.png',
      3: IMAGE_BASE + '/territory-evolution-pioneer-medieval.png',
      4: IMAGE_BASE + '/territory-evolution-pioneer-early-modern.png',
      5: IMAGE_BASE + '/territory-evolution-pioneer-modern.png',
      6: IMAGE_BASE + '/territory-evolution-pioneer-future.png',
    }),
    guardian: Object.freeze({
      1: COMMON_PRIMITIVE,
      2: IMAGE_BASE + '/territory-evolution-guardian-ancient.png',
      3: IMAGE_BASE + '/territory-evolution-guardian-medieval.png',
      4: IMAGE_BASE + '/territory-evolution-guardian-early-modern.png',
      5: IMAGE_BASE + '/territory-evolution-guardian-modern.png',
      6: IMAGE_BASE + '/territory-evolution-guardian-future.png',
    }),
    central: Object.freeze({
      1: COMMON_PRIMITIVE,
      2: IMAGE_BASE + '/territory-evolution-central-ancient.png',
      3: IMAGE_BASE + '/territory-evolution-central-medieval.png',
      4: IMAGE_BASE + '/territory-evolution-central-early-modern.png',
      5: IMAGE_BASE + '/territory-evolution-central-modern.png',
      6: IMAGE_BASE + '/territory-evolution-central-future.png',
    }),
    alien: Object.freeze({
      1: IMAGE_BASE + '/territory-evolution-alien-primitive.png',
      2: IMAGE_BASE + '/territory-evolution-alien-ancient.png',
      3: IMAGE_BASE + '/territory-evolution-alien-medieval.png',
      4: IMAGE_BASE + '/territory-evolution-alien-early-modern.png',
      5: IMAGE_BASE + '/territory-evolution-alien-modern.png',
      6: IMAGE_BASE + '/territory-evolution-alien-future.png',
    }),
  });

  /** Mock 기본 인원 (단일 원천) */
  var MOCK_POPULATION_DEFAULTS = Object.freeze({
    PIONEER: 820,
    GUARDIAN: 2480,
    CENTRAL: 3830,
    ALIEN: 310,
    pioneer: 820,
    guardian: 2480,
    central: 3830,
    alien: 310,
  });

  var CACHE_TTL_MS = 30000;
  var CENTRAL_AGGREGATION_MODE = 'EARTH_TOTAL';
  var STAGE_CAN_DECREASE = true;

  var EXPECTED_IMAGE_COUNT = 22; // common-primitive 1 + pioneer 5 + guardian 5 + central 5 + alien 6

  function clone(v) {
    if (v == null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  function clampStage(stage) {
    var v = Math.round(Number(stage));
    if (!isFinite(v) || isNaN(v)) return 1;
    return Math.max(1, Math.min(6, v));
  }

  /**
   * 레거시 UI용: 비정상 값은 0. (저장/운영 계약에는 쓰지 않음)
   */
  function normalizeTerritoryPopulation(value) {
    var n = Number(value);
    if (!isFinite(n) || isNaN(n)) return 0;
    return Math.max(0, Math.floor(n));
  }

  /**
   * 운영·계약용 엄격 검증.
   * 음수 → invalid. 소수는 floor. 문자열 숫자 허용.
   */
  function parsePopulationStrict(value) {
    if (value === null || value === undefined || value === '') {
      return { valid: false, error: 'POPULATION_MISSING', population: null };
    }
    if (typeof value === 'boolean') {
      return { valid: false, error: 'POPULATION_INVALID_TYPE', population: null };
    }
    var n = typeof value === 'string' ? Number(String(value).trim().replace(/,/g, '')) : Number(value);
    if (!isFinite(n) || isNaN(n)) {
      return { valid: false, error: 'POPULATION_NOT_NUMERIC', population: null };
    }
    if (n < 0) {
      return { valid: false, error: 'POPULATION_NEGATIVE', population: null };
    }
    return { valid: true, error: null, population: Math.floor(n) };
  }

  function toOperationalTerritory(value) {
    if (value == null || value === '') return null;
    var s = String(value).trim();
    if (!s) return null;
    var upper = s.toUpperCase();
    if (OPERATIONAL_TO_EVO[upper]) return upper;
    if (LEGACY_TO_OPERATIONAL[upper]) return LEGACY_TO_OPERATIONAL[upper];
    if (EVO_TO_OPERATIONAL[s.toLowerCase()]) return EVO_TO_OPERATIONAL[s.toLowerCase()];
    return null;
  }

  function toEvoKey(value) {
    var op = toOperationalTerritory(value);
    return op ? OPERATIONAL_TO_EVO[op] : null;
  }

  function assertEvolutionTerritory(value) {
    var op = toOperationalTerritory(value);
    if (!op) {
      return { valid: false, error: 'TERRITORY_EVOLUTION_TERRITORY_INVALID', territory: null };
    }
    return { valid: true, error: null, territory: op, evoKey: OPERATIONAL_TO_EVO[op] };
  }

  /** 운영 API: 레거시 ID 직접 거부 */
  function assertOperationalTerritoryStrict(value) {
    if (value == null) {
      return { valid: false, error: 'TERRITORY_EVOLUTION_TERRITORY_INVALID' };
    }
    var s = String(value).trim().toUpperCase();
    if (OPERATIONAL_TERRITORIES.indexOf(s) === -1) {
      return { valid: false, error: 'TERRITORY_EVOLUTION_LEGACY_OR_UNKNOWN' };
    }
    return { valid: true, territory: s, evoKey: OPERATIONAL_TO_EVO[s] };
  }

  function getEvolutionStageDefinitions(territory) {
    var evo = toEvoKey(territory) || 'central';
    var labels = evo === 'alien' ? ALIEN_STAGE_LABELS : COMMON_STAGE_LABELS;
    var defs = [];
    for (var i = 1; i <= 6; i++) {
      defs.push({
        stage: i,
        stageKey: STAGE_KEYS[i],
        stageLabel: labels[i],
        image: EVOLUTION_IMAGES[evo][i],
        range: STAGE_THRESHOLDS[i - 1],
      });
    }
    return defs;
  }

  function getTerritoryEvolutionStageByPopulation(territory, population) {
    void territory;
    var parsed = parsePopulationStrict(population);
    if (!parsed.valid) return null;
    var pop = parsed.population;
    for (var i = 0; i < STAGE_THRESHOLDS.length; i++) {
      var row = STAGE_THRESHOLDS[i];
      var max = row.max == null ? Infinity : row.max;
      if (pop >= row.min && pop <= max) return row.stage;
    }
    return 6;
  }

  function getTerritoryEvolutionStageRange(territory, stage) {
    void territory;
    var safe = clampStage(stage);
    return STAGE_THRESHOLDS[safe - 1] || null;
  }

  function getTerritoryEvolutionStageRangeLabel(territory, stage) {
    var row = getTerritoryEvolutionStageRange(territory, stage);
    return row ? row.rangeLabel : '';
  }

  function getTerritoryEvolutionNextThreshold(territory, stage) {
    void territory;
    var safe = clampStage(stage);
    if (safe >= 6) return null;
    var next = STAGE_THRESHOLDS[safe];
    return next ? next.min : null;
  }

  function getRequiredPopulationForNextStage(territory, population) {
    var parsed = parsePopulationStrict(population);
    if (!parsed.valid) return null;
    var stage = getTerritoryEvolutionStageByPopulation(territory, parsed.population);
    if (stage == null || stage >= 6) return null;
    var nextMin = getTerritoryEvolutionNextThreshold(territory, stage);
    if (nextMin == null) return null;
    return Math.max(0, nextMin - parsed.population);
  }

  function getTerritoryEvolutionImage(territory, stage) {
    var evo = toEvoKey(territory);
    if (!evo) return null;
    var safe = clampStage(stage);
    return EVOLUTION_IMAGES[evo][safe] || null;
  }

  function getStageLabel(territory, stage) {
    var evo = toEvoKey(territory) || 'central';
    var safe = clampStage(stage);
    if (evo === 'alien') return ALIEN_STAGE_LABELS[safe];
    return COMMON_STAGE_LABELS[safe];
  }

  function stageSide(territory, stage, role) {
    var safe = clampStage(stage);
    if (role === 'previous') {
      if (safe <= 1) {
        return { available: false, stage: null, stageKey: null, stageLabel: null, image: null };
      }
      var prev = safe - 1;
      return {
        available: true,
        stage: prev,
        stageKey: STAGE_KEYS[prev],
        stageLabel: getStageLabel(territory, prev),
        image: getTerritoryEvolutionImage(territory, prev),
      };
    }
    if (safe >= 6) {
      return {
        available: false,
        stage: null,
        stageKey: null,
        stageLabel: null,
        image: null,
        threshold: null,
        requiredPopulation: null,
      };
    }
    var next = safe + 1;
    var threshold = getTerritoryEvolutionNextThreshold(territory, safe);
    return {
      available: true,
      stage: next,
      stageKey: STAGE_KEYS[next],
      stageLabel: getStageLabel(territory, next),
      image: getTerritoryEvolutionImage(territory, next),
      threshold: threshold,
      requiredPopulation: null,
    };
  }

  /**
   * 직접 소속 인원만 반환 (CENTRAL = central only).
   * clientPopulation 무시.
   */
  function resolveDirectPopulation(territory, directCounts) {
    var evo = toEvoKey(territory);
    var src = directCounts || {};
    if (!evo) return null;
    var raw = src[evo] != null ? src[evo] : src[EVO_TO_OPERATIONAL[evo]];
    var parsed = parsePopulationStrict(raw == null ? 0 : raw);
    return parsed.valid ? parsed.population : null;
  }

  function readDirectCount(directCounts, operationalId) {
    var src = directCounts || {};
    var evo = OPERATIONAL_TO_EVO[operationalId];
    var raw = src[operationalId] != null ? src[operationalId] : (evo ? src[evo] : null);
    var parsed = parsePopulationStrict(raw == null ? 0 : raw);
    return parsed.valid ? parsed.population : 0;
  }

  /**
   * 발전 인원. CENTRAL = Earth 합산(C+P+G). ALIEN은 합산에 넣지 않음.
   */
  function resolveEvolutionPopulation(territory, directCounts) {
    var op = toOperationalTerritory(territory);
    if (!op) return null;
    if (op === 'CENTRAL') {
      return (
        readDirectCount(directCounts, 'CENTRAL') +
        readDirectCount(directCounts, 'PIONEER') +
        readDirectCount(directCounts, 'GUARDIAN')
      );
    }
    return readDirectCount(directCounts, op);
  }

  function emptyStageSide() {
    return { available: false, stage: null, stageKey: null, stageLabel: null, image: null };
  }

  function buildUnavailableEvolutionViewModel(territory, reason) {
    var check = assertEvolutionTerritory(territory);
    var op = check.territory || toOperationalTerritory(territory);
    return {
      territory: op,
      territoryLabel: op ? TERRITORY_LABELS[op] : null,
      population: null,
      populationAvailable: false,
      populationSource: POPULATION_SOURCE.UNAVAILABLE,
      currentStage: null,
      currentStageKey: null,
      currentStageLabel: null,
      currentStageImage: null,
      previousStage: emptyStageSide(),
      nextStage: Object.assign(emptyStageSide(), { threshold: null, requiredPopulation: null }),
      currentRange: { min: null, max: null, label: null },
      isMaxStage: false,
      isMinStage: false,
      dataStatus: DATA_STATUS.UNAVAILABLE,
      updatedAt: null,
      _reason: reason || null,
    };
  }

  function buildLoadingEvolutionViewModel(territory) {
    var base = buildUnavailableEvolutionViewModel(territory, 'LOADING');
    base.dataStatus = DATA_STATUS.LOADING;
    return base;
  }

  function buildInvalidEvolutionViewModel(territory, reason) {
    var base = buildUnavailableEvolutionViewModel(territory, reason);
    base.dataStatus = DATA_STATUS.INVALID;
    return base;
  }

  /**
   * @param {object} input
   * @param {string} input.territory
   * @param {number} input.population — 서버/어댑터가 확정한 직접 소속 인원
   * @param {string} [input.populationSource]
   * @param {string} [input.dataStatus]
   * @param {string} [input.updatedAt]
   * @param {number} [input.clientPopulation] — 무시됨
   */
  function getTerritoryEvolutionState(input) {
    var src = input || {};
    var frozen = clone(src);
    void frozen.clientPopulation;

    var check = assertEvolutionTerritory(src.territory);
    if (!check.valid) {
      return buildInvalidEvolutionViewModel(src.territory, check.error);
    }

    var parsed = parsePopulationStrict(src.population);
    if (!parsed.valid) {
      return buildInvalidEvolutionViewModel(check.territory, parsed.error);
    }

    var population = parsed.population;
    var stage = getTerritoryEvolutionStageByPopulation(check.territory, population);
    var range = getTerritoryEvolutionStageRange(check.territory, stage);
    var previous = stageSide(check.territory, stage, 'previous');
    var next = stageSide(check.territory, stage, 'next');
    if (next.available) {
      next.requiredPopulation = getRequiredPopulationForNextStage(check.territory, population);
    }

    var status = src.dataStatus || DATA_STATUS.READY;
    var source = src.populationSource || POPULATION_SOURCE.MEMORY;

    return {
      territory: check.territory,
      territoryLabel: TERRITORY_LABELS[check.territory],
      population: population,
      populationAvailable: true,
      populationSource: source,
      currentStage: stage,
      currentStageKey: STAGE_KEYS[stage],
      currentStageLabel: getStageLabel(check.territory, stage),
      currentStageImage: getTerritoryEvolutionImage(check.territory, stage),
      previousStage: previous,
      nextStage: next,
      currentRange: {
        min: range ? range.min : null,
        max: range ? range.max : null,
        label: range ? range.rangeLabel : null,
      },
      isMaxStage: stage >= 6,
      isMinStage: stage <= 1,
      dataStatus: status,
      updatedAt: src.updatedAt || null,
    };
  }

  function buildLegacyMockEvolutionState(territory, mockPopulations) {
    var check = assertEvolutionTerritory(territory);
    if (!check.valid) return buildInvalidEvolutionViewModel(territory, check.error);
    var pops = mockPopulations || MOCK_POPULATION_DEFAULTS;
    var pop = resolveDirectPopulation(check.territory, pops);
    return getTerritoryEvolutionState({
      territory: check.territory,
      population: pop != null ? pop : MOCK_POPULATION_DEFAULTS[check.territory],
      populationSource: POPULATION_SOURCE.LEGACY_MOCK,
      dataStatus: DATA_STATUS.LEGACY_MOCK,
    });
  }

  function listExpectedImagePaths() {
    var paths = [];
    var seen = {};
    EVO_KEYS.forEach(function (evo) {
      for (var s = 1; s <= 6; s++) {
        var p = EVOLUTION_IMAGES[evo][s];
        if (p && !seen[p]) {
          seen[p] = true;
          paths.push(p);
        }
      }
    });
    return paths;
  }

  return {
    DATA_STATUS: DATA_STATUS,
    POPULATION_SOURCE: POPULATION_SOURCE,
    OPERATIONAL_TERRITORIES: OPERATIONAL_TERRITORIES,
    EVO_KEYS: EVO_KEYS,
    OPERATIONAL_TO_EVO: OPERATIONAL_TO_EVO,
    EVO_TO_OPERATIONAL: EVO_TO_OPERATIONAL,
    LEGACY_TO_OPERATIONAL: LEGACY_TO_OPERATIONAL,
    TERRITORY_LABELS: TERRITORY_LABELS,
    COMMON_STAGE_LABELS: COMMON_STAGE_LABELS,
    ALIEN_STAGE_LABELS: ALIEN_STAGE_LABELS,
    STAGE_KEYS: STAGE_KEYS,
    STAGE_THRESHOLDS: STAGE_THRESHOLDS,
    EVOLUTION_IMAGES: EVOLUTION_IMAGES,
    IMAGE_BASE: IMAGE_BASE,
    COMMON_PRIMITIVE: COMMON_PRIMITIVE,
    MOCK_POPULATION_DEFAULTS: MOCK_POPULATION_DEFAULTS,
    CACHE_TTL_MS: CACHE_TTL_MS,
    CENTRAL_AGGREGATION_MODE: CENTRAL_AGGREGATION_MODE,
    STAGE_CAN_DECREASE: STAGE_CAN_DECREASE,
    EXPECTED_IMAGE_COUNT: EXPECTED_IMAGE_COUNT,
    clone: clone,
    clampStage: clampStage,
    normalizeTerritoryPopulation: normalizeTerritoryPopulation,
    parsePopulationStrict: parsePopulationStrict,
    toOperationalTerritory: toOperationalTerritory,
    toEvoKey: toEvoKey,
    assertEvolutionTerritory: assertEvolutionTerritory,
    assertOperationalTerritoryStrict: assertOperationalTerritoryStrict,
    getEvolutionStageDefinitions: getEvolutionStageDefinitions,
    getTerritoryEvolutionStageByPopulation: getTerritoryEvolutionStageByPopulation,
    getTerritoryEvolutionStageRange: getTerritoryEvolutionStageRange,
    getTerritoryEvolutionStageRangeLabel: getTerritoryEvolutionStageRangeLabel,
    getTerritoryEvolutionNextThreshold: getTerritoryEvolutionNextThreshold,
    getRequiredPopulationForNextStage: getRequiredPopulationForNextStage,
    getTerritoryEvolutionImage: getTerritoryEvolutionImage,
    getStageLabel: getStageLabel,
    resolveDirectPopulation: resolveDirectPopulation,
    resolveEvolutionPopulation: resolveEvolutionPopulation,
    getTerritoryEvolutionState: getTerritoryEvolutionState,
    buildUnavailableEvolutionViewModel: buildUnavailableEvolutionViewModel,
    buildLoadingEvolutionViewModel: buildLoadingEvolutionViewModel,
    buildInvalidEvolutionViewModel: buildInvalidEvolutionViewModel,
    buildLegacyMockEvolutionState: buildLegacyMockEvolutionState,
    listExpectedImagePaths: listExpectedImagePaths,
  };
});
