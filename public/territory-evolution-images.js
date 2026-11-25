/**
 * =============================================================================
 * 센텐스아레나 — 영토 발전단계 이미지 경로 목록
 * =============================================================================
 * 목적: 이미지 파일 경로의 Single Source of Truth (등록만).
 * 아직 패널 UI · 소속 인원 계산 · 발전단계 판정 · hover 연동 없음.
 *
 * 경로: public/assets/territory-evolution/
 * 원시(1단계): 개척·수호·중앙광장은 common-primitive 공유.
 * Hover 패널: territory-evolution-hover.js (Mock 단계·인원 · 지도 좌표 무변경)
 * =============================================================================
 */
(function (global) {
  'use strict';

  var BASE = '/assets/territory-evolution';

  var TERRITORY_EVOLUTION_STAGE_LABELS = Object.freeze({
    1: '원시',
    2: '고대',
    3: '중세',
    4: '근대',
    5: '현대',
    6: '미래',
  });

  /** 외계행성 Hover/UI 전용 단계 표시명 (이미지 파일명·명패와 별개) */
  var ALIEN_EVOLUTION_STAGE_LABELS = Object.freeze({
    1: '문명탄생',
    2: '문명형성',
    3: '문명발전',
    4: '문명확장',
    5: '문명번영',
    6: '문명포화',
  });

  var TERRITORY_EVOLUTION_STAGE_KEYS = Object.freeze({
    1: 'primitive',
    2: 'ancient',
    3: 'medieval',
    4: 'early-modern',
    5: 'modern',
    6: 'future',
  });

  var COMMON_PRIMITIVE = BASE + '/territory-evolution-common-primitive.png';

  /** /kr 과 /us 가 같은 파일을 공유하지 않는다. 기존 alien PNG 는 그대로 둔다. */
  var ALIEN_EVOLUTION_IMAGES_KR = Object.freeze({
    1: BASE + '/territory-evolution-alien-kr-1-tamsa.png',
    2: BASE + '/territory-evolution-alien-kr-2-outpost.png',
    3: BASE + '/territory-evolution-alien-kr-3-settlement.png',
    4: BASE + '/territory-evolution-alien-kr-4-expansion.png',
    5: BASE + '/territory-evolution-alien-kr-5-prosperity.png',
    6: BASE + '/territory-evolution-alien-kr-6-ascension.png',
  });

  var ALIEN_EVOLUTION_IMAGES_US = Object.freeze({
    1: BASE + '/territory-evolution-alien-en-1-exploration.png',
    2: BASE + '/territory-evolution-alien-en-2-outpost.png',
    3: BASE + '/territory-evolution-alien-en-3-settlement.png',
    4: BASE + '/territory-evolution-alien-en-4-expansion.png',
    5: BASE + '/territory-evolution-alien-en-5-prosperity.png',
    6: BASE + '/territory-evolution-alien-en-6-ascension.png',
  });

  function isUsEvolutionScreen() {
    try {
      if (global.SAActivityRegion && typeof global.SAActivityRegion.get === 'function') {
        return global.SAActivityRegion.get() === 'US';
      }
    } catch (e) {}
    try {
      var path = global.location && global.location.pathname ? String(global.location.pathname) : '';
      return path === '/us' || path.indexOf('/us/') === 0;
    } catch (e2) {}
    return false;
  }

  function getAlienTerritoryEvolutionImage(stage) {
    var safe = clampEvolutionStage(stage);
    var table = isUsEvolutionScreen() ? ALIEN_EVOLUTION_IMAGES_US : ALIEN_EVOLUTION_IMAGES_KR;
    return table[safe] || null;
  }

  /** /kr 과 /us 가 같은 파일을 공유하지 않는다. 기존 central PNG 와 common-primitive 는 그대로 둔다. */
  var CENTRAL_EVOLUTION_IMAGES_KR = Object.freeze({
    1: BASE + '/territory-evolution-central-kr-1-primitive.png',
    2: BASE + '/territory-evolution-central-kr-2-ancient.png',
    3: BASE + '/territory-evolution-central-kr-3-medieval.png',
    4: BASE + '/territory-evolution-central-kr-4-modern.png',
    5: BASE + '/territory-evolution-central-kr-5-contemporary.png',
    6: BASE + '/territory-evolution-central-kr-6-future.png',
  });

  var CENTRAL_EVOLUTION_IMAGES_US = Object.freeze({
    1: BASE + '/territory-evolution-central-en-1-primitive.png',
    2: BASE + '/territory-evolution-central-en-2-ancient.png',
    3: BASE + '/territory-evolution-central-en-3-medieval.png',
    4: BASE + '/territory-evolution-central-en-4-modern.png',
    5: BASE + '/territory-evolution-central-en-5-contemporary.png',
    6: BASE + '/territory-evolution-central-en-6-future.png',
  });

  function getCentralTerritoryEvolutionImage(stage) {
    var safe = clampEvolutionStage(stage);
    var table = isUsEvolutionScreen() ? CENTRAL_EVOLUTION_IMAGES_US : CENTRAL_EVOLUTION_IMAGES_KR;
    return table[safe] || null;
  }

  /** /kr 과 /us 가 같은 파일을 공유하지 않는다. 기존 guardian PNG 와 common-primitive 는 그대로 둔다. */
  var GUARDIAN_EVOLUTION_IMAGES_KR = Object.freeze({
    1: BASE + '/territory-evolution-guardian-kr-1-primitive.png',
    2: BASE + '/territory-evolution-guardian-kr-2-ancient.png',
    3: BASE + '/territory-evolution-guardian-kr-3-medieval.png',
    4: BASE + '/territory-evolution-guardian-kr-4-modern.png',
    5: BASE + '/territory-evolution-guardian-kr-5-contemporary.png',
    6: BASE + '/territory-evolution-guardian-kr-6-future.png',
  });

  var GUARDIAN_EVOLUTION_IMAGES_US = Object.freeze({
    1: BASE + '/territory-evolution-guardian-en-1-primitive.png',
    2: BASE + '/territory-evolution-guardian-en-2-ancient.png',
    3: BASE + '/territory-evolution-guardian-en-3-medieval.png',
    4: BASE + '/territory-evolution-guardian-en-4-modern.png',
    5: BASE + '/territory-evolution-guardian-en-5-contemporary.png',
    6: BASE + '/territory-evolution-guardian-en-6-future.png',
  });

  function getGuardianTerritoryEvolutionImage(stage) {
    var safe = clampEvolutionStage(stage);
    var table = isUsEvolutionScreen() ? GUARDIAN_EVOLUTION_IMAGES_US : GUARDIAN_EVOLUTION_IMAGES_KR;
    return table[safe] || null;
  }

  /** /kr 과 /us 가 같은 파일을 공유하지 않는다. 기존 pioneer PNG 와 common-primitive 는 그대로 둔다. */
  var PIONEER_EVOLUTION_IMAGES_KR = Object.freeze({
    1: BASE + '/territory-evolution-pioneer-kr-1-primitive.png',
    2: BASE + '/territory-evolution-pioneer-kr-2-ancient.png',
    3: BASE + '/territory-evolution-pioneer-kr-3-medieval.png',
    4: BASE + '/territory-evolution-pioneer-kr-4-modern.png',
    5: BASE + '/territory-evolution-pioneer-kr-5-contemporary.png',
    6: BASE + '/territory-evolution-pioneer-kr-6-future.png',
  });

  var PIONEER_EVOLUTION_IMAGES_US = Object.freeze({
    1: BASE + '/territory-evolution-pioneer-en-1-primitive.png',
    2: BASE + '/territory-evolution-pioneer-en-2-ancient.png',
    3: BASE + '/territory-evolution-pioneer-en-3-medieval.png',
    4: BASE + '/territory-evolution-pioneer-en-4-modern.png',
    5: BASE + '/territory-evolution-pioneer-en-5-contemporary.png',
    6: BASE + '/territory-evolution-pioneer-en-6-future.png',
  });

  function getPioneerTerritoryEvolutionImage(stage) {
    var safe = clampEvolutionStage(stage);
    var table = isUsEvolutionScreen() ? PIONEER_EVOLUTION_IMAGES_US : PIONEER_EVOLUTION_IMAGES_KR;
    return table[safe] || null;
  }

  var TERRITORY_EVOLUTION_IMAGES = Object.freeze({
    pioneer: Object.freeze({
      get 1() { return getPioneerTerritoryEvolutionImage(1); },
      get 2() { return getPioneerTerritoryEvolutionImage(2); },
      get 3() { return getPioneerTerritoryEvolutionImage(3); },
      get 4() { return getPioneerTerritoryEvolutionImage(4); },
      get 5() { return getPioneerTerritoryEvolutionImage(5); },
      get 6() { return getPioneerTerritoryEvolutionImage(6); },
    }),
    guardian: Object.freeze({
      get 1() { return getGuardianTerritoryEvolutionImage(1); },
      get 2() { return getGuardianTerritoryEvolutionImage(2); },
      get 3() { return getGuardianTerritoryEvolutionImage(3); },
      get 4() { return getGuardianTerritoryEvolutionImage(4); },
      get 5() { return getGuardianTerritoryEvolutionImage(5); },
      get 6() { return getGuardianTerritoryEvolutionImage(6); },
    }),
    central: Object.freeze({
      get 1() { return getCentralTerritoryEvolutionImage(1); },
      get 2() { return getCentralTerritoryEvolutionImage(2); },
      get 3() { return getCentralTerritoryEvolutionImage(3); },
      get 4() { return getCentralTerritoryEvolutionImage(4); },
      get 5() { return getCentralTerritoryEvolutionImage(5); },
      get 6() { return getCentralTerritoryEvolutionImage(6); },
    }),
    alien: Object.freeze({
      get 1() { return getAlienTerritoryEvolutionImage(1); },
      get 2() { return getAlienTerritoryEvolutionImage(2); },
      get 3() { return getAlienTerritoryEvolutionImage(3); },
      get 4() { return getAlienTerritoryEvolutionImage(4); },
      get 5() { return getAlienTerritoryEvolutionImage(5); },
      get 6() { return getAlienTerritoryEvolutionImage(6); },
    }),
  });

  /** 외계 명패 표기 (단계 키 → 이미지 하단 텍스트) — 원본 명패 문구 유지 */
  var TERRITORY_EVOLUTION_ALIEN_NAMEPLATES = Object.freeze({
    primitive: '문명 탄생',
    ancient: '문명 형성',
    medieval: '문명 발전',
    'early-modern': '문명 확장',
    modern: '문명 번영',
    future: '문명 포화',
  });

  function clampEvolutionStage(stage) {
    var v = Math.round(Number(stage));
    if (!isFinite(v)) return 1;
    return Math.max(1, Math.min(6, v));
  }

  /**
   * 영토별 발전 단계 표시명.
   * alien → ALIEN_EVOLUTION_STAGE_LABELS, 그 외 → TERRITORY_EVOLUTION_STAGE_LABELS
   */
  function getTerritoryEvolutionStageLabel(territoryKey, stage) {
    var safeStage = clampEvolutionStage(stage);
    if (territoryKey === 'alien') {
      return ALIEN_EVOLUTION_STAGE_LABELS[safeStage] || TERRITORY_EVOLUTION_STAGE_LABELS[safeStage] || String(safeStage);
    }
    return TERRITORY_EVOLUTION_STAGE_LABELS[safeStage] || String(safeStage);
  }

  global.TERRITORY_EVOLUTION_STAGE_LABELS = TERRITORY_EVOLUTION_STAGE_LABELS;
  global.ALIEN_EVOLUTION_STAGE_LABELS = ALIEN_EVOLUTION_STAGE_LABELS;
  global.TERRITORY_EVOLUTION_STAGE_KEYS = TERRITORY_EVOLUTION_STAGE_KEYS;
  global.TERRITORY_EVOLUTION_IMAGES = TERRITORY_EVOLUTION_IMAGES;
  global.ALIEN_EVOLUTION_IMAGES_KR = ALIEN_EVOLUTION_IMAGES_KR;
  global.ALIEN_EVOLUTION_IMAGES_US = ALIEN_EVOLUTION_IMAGES_US;
  global.getAlienTerritoryEvolutionImage = getAlienTerritoryEvolutionImage;
  global.CENTRAL_EVOLUTION_IMAGES_KR = CENTRAL_EVOLUTION_IMAGES_KR;
  global.CENTRAL_EVOLUTION_IMAGES_US = CENTRAL_EVOLUTION_IMAGES_US;
  global.getCentralTerritoryEvolutionImage = getCentralTerritoryEvolutionImage;
  global.GUARDIAN_EVOLUTION_IMAGES_KR = GUARDIAN_EVOLUTION_IMAGES_KR;
  global.GUARDIAN_EVOLUTION_IMAGES_US = GUARDIAN_EVOLUTION_IMAGES_US;
  global.getGuardianTerritoryEvolutionImage = getGuardianTerritoryEvolutionImage;
  global.PIONEER_EVOLUTION_IMAGES_KR = PIONEER_EVOLUTION_IMAGES_KR;
  global.PIONEER_EVOLUTION_IMAGES_US = PIONEER_EVOLUTION_IMAGES_US;
  global.getPioneerTerritoryEvolutionImage = getPioneerTerritoryEvolutionImage;
  global.TERRITORY_EVOLUTION_ALIEN_NAMEPLATES = TERRITORY_EVOLUTION_ALIEN_NAMEPLATES;
  global.getTerritoryEvolutionStageLabel = getTerritoryEvolutionStageLabel;
})(typeof window !== 'undefined' ? window : globalThis);
